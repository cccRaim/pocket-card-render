import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  selectCardQualityProfile,
  selectDynamicUIRenderScale,
} from "../public/render/quality-profile.js";
import {
  DYNAMIC_UI_COORDINATE_CONTRACT,
  createDynamicUIOrthographicCamera,
  createDynamicUIQuadGeometry,
} from "../public/render/tmp-sdf-renderer.js";
import {
  calcHomographyMatrix,
  calcInverseMatrix,
} from "../public/render/pipeline/official-homography.js";
import {
  fullRuntimeSourceFiles,
  fullRuntimeSourceIdentityMatches,
} from "./full-runtime-sources.mjs";
import {
  tmpRuntimeSourceFiles,
  tmpRuntimeSourceIdentityMatches,
} from "./tmp-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DISPLAY_CONTRACT_PATH =
  path.join(ROOT, "public", "render", "card-display-contract.json");
const APP_PATH = path.join(ROOT, "public", "app.js");
const TMP_RENDERER_PATH =
  path.join(ROOT, "public", "render", "tmp-sdf-renderer.js");
const DYNAMIC_TEXT_VERTEX_PATH =
  path.join(ROOT, "public", "shaders", "dynamic_ui_text.vert.glsl");
const DYNAMIC_TEXT_FRAGMENT_PATH =
  path.join(ROOT, "public", "shaders", "dynamic_ui_text.frag.glsl");
const DYNAMIC_TEXT_MANIFEST_PATH =
  path.join(ROOT, "public", "shaders", "dynamic_ui_text_uniforms.json");

function readText(filename) {
  return fs.readFileSync(filename, "utf8");
}

function readJson(filename) {
  return JSON.parse(readText(filename));
}

function sha256File(relative) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relative)))
    .digest("hex");
}

function approximatelyEqual(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function assertSize(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} size drifted`);
  assert(actual.every((value) => Number.isInteger(value) && value > 0));
}

function clampDpr(devicePixelRatio) {
  return Math.min(devicePixelRatio, 2);
}

function drawingBufferSize(cssViewport, rendererPixelRatio) {
  return cssViewport.map((value) =>
    Math.max(1, Math.floor(value * rendererPixelRatio)));
}

function rotateByQuaternion(point, quaternion) {
  const [x, y, z] = point;
  const [qx, qy, qz, qw] = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot(left, right) {
  return left.reduce(
    (sum, value, index) => sum + value * right[index],
    0,
  );
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value) {
  const length = Math.sqrt(dot(value, value));
  assert(length > 0 && Number.isFinite(length));
  return value.map((entry) => entry / length);
}

function projectOfficialKeypoints(contract) {
  const camera = contract.camera;
  const cameraPosition = [
    camera.local_position[0],
    camera.local_position[1],
    -camera.local_position[2],
  ];
  const forward = normalize(cameraPosition.map((value) => -value));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanHalfFov =
    Math.tan(camera.field_of_view_degrees * Math.PI / 360);
  const aspect = camera.aspect;
  return contract.homography.keypoints.map((keypoint) => {
    const world = rotateByQuaternion(
      keypoint.local_position,
      contract.homography.keypoint_root_rotation,
    );
    const relative = subtract(world, cameraPosition);
    const depth = dot(relative, forward);
    assert(depth > 0);
    const ndcX = dot(relative, right) / (depth * tanHalfFov * aspect);
    const ndcY = dot(relative, up) / (depth * tanHalfFov);
    return [(ndcX + 1) * 0.5, (ndcY + 1) * 0.5];
  });
}

function applyHomography(matrix, point) {
  const [x, y] = point;
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  assert(Number.isFinite(denominator) && Math.abs(denominator) > 1e-8);
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  ];
}

function containSquare(drawingBuffer) {
  const side = Math.min(...drawingBuffer);
  return {
    left: (drawingBuffer[0] - side) / 2,
    top: (drawingBuffer[1] - side) / 2,
    side,
  };
}

function deriveDensityState({
  name,
  cssViewport,
  devicePixelRatio,
  quality,
  maxTextureSize,
}, contract) {
  const profiles = contract.quality_profiles;
  const rendererPixelRatio = clampDpr(devicePixelRatio);
  const drawingBuffer = drawingBufferSize(cssViewport, rendererPixelRatio);
  const requestedDisplaySide = Math.round(Math.min(...drawingBuffer));
  const selectedProfile = selectCardQualityProfile(
    quality,
    profiles,
    requestedDisplaySide,
    maxTextureSize,
  );
  const dynamicUIRenderScale = selectDynamicUIRenderScale(
    quality,
    selectedProfile,
    profiles,
  );
  const cardView =
    contract.profiles
      .ordinary_android_default_middle_without_persisted_override
      .card_view;
  const logicalSize = [cardView.pixel_width, cardView.pixel_height];
  const dynamicUITextureSize = logicalSize.map((value) =>
    Math.max(1, Math.round(value * dynamicUIRenderScale)));
  const sourceSize = [
    selectedProfile.source_render_target_request.width,
    selectedProfile.source_render_target_request.height,
  ];
  const viewportPoints = projectOfficialKeypoints(contract);
  const homography = calcHomographyMatrix(viewportPoints);
  const inverseHomography = calcInverseMatrix(homography);
  const displayBounds = containSquare(drawingBuffer);
  const sampleProbes = [
    [0.125, 0.25],
    [0.5, 0.5],
    [0.875, 0.75],
  ].map((normalized) => {
    const viewport = applyHomography(homography, normalized);
    return {
      normalized,
      logicalPixel: [
        normalized[0] * logicalSize[0],
        normalized[1] * logicalSize[1],
      ],
      dynamicUIPixel: [
        normalized[0] * dynamicUITextureSize[0],
        normalized[1] * dynamicUITextureSize[1],
      ],
      cardSamplerUV: [...normalized],
      sourceViewportUV: viewport,
      displayPixel: [
        displayBounds.left + viewport[0] * displayBounds.side,
        displayBounds.top + viewport[1] * displayBounds.side,
      ],
    };
  });
  return {
    name,
    cssViewport,
    devicePixelRatio,
    rendererPixelRatio,
    drawingBuffer,
    canvasBackingSize: [...drawingBuffer],
    requestedDisplaySide,
    quality,
    selectedProfile,
    sourceSize,
    dynamicUIRenderScale,
    logicalSize,
    dynamicUITextureSize,
    tmpRenderTargetSize: [...dynamicUITextureSize],
    displayTargetSize: [...drawingBuffer],
    displayBounds,
    viewportPoints,
    homography: [...homography],
    inverseHomography: [...inverseHomography],
    sampleProbes,
    maxTextureSize,
  };
}

function validateDensityState(state, contract) {
  const profiles = contract.quality_profiles;
  const expectedRatio = clampDpr(state.devicePixelRatio);
  approximatelyEqual(
    state.rendererPixelRatio,
    expectedRatio,
    1e-12,
    `${state.name} renderer DPR`,
  );
  assertSize(
    state.drawingBuffer,
    drawingBufferSize(state.cssViewport, expectedRatio),
    `${state.name} drawing buffer`,
  );
  assertSize(
    state.canvasBackingSize,
    state.drawingBuffer,
    `${state.name} canvas backing`,
  );
  assert.equal(
    state.requestedDisplaySide,
    Math.round(Math.min(...state.drawingBuffer)),
  );

  const expectedProfile = selectCardQualityProfile(
    state.quality,
    profiles,
    state.requestedDisplaySide,
    state.maxTextureSize,
  );
  assert.deepEqual(state.selectedProfile, expectedProfile);
  assertSize(state.sourceSize, [
    expectedProfile.source_render_target_request.width,
    expectedProfile.source_render_target_request.height,
  ], `${state.name} source RT`);
  assert.equal(state.sourceSize[0], state.sourceSize[1]);

  const expectedScale = selectDynamicUIRenderScale(
    state.quality,
    expectedProfile,
    profiles,
  );
  approximatelyEqual(
    state.dynamicUIRenderScale,
    expectedScale,
    1e-12,
    `${state.name} DynamicUI scale`,
  );
  assertSize(
    state.dynamicUITextureSize,
    state.logicalSize.map((value) =>
      Math.max(1, Math.round(value * expectedScale))),
    `${state.name} DynamicUI`,
  );
  assertSize(
    state.tmpRenderTargetSize,
    state.dynamicUITextureSize,
    `${state.name} TMP RT`,
  );
  assertSize(
    state.displayTargetSize,
    state.drawingBuffer,
    `${state.name} display RT`,
  );

  if (state.quality === "auto") {
    const middleSide = profiles.middle.source_render_target_request.width;
    const expectedSourceSide = Math.min(
      state.maxTextureSize,
      Math.max(middleSide, Math.round(state.requestedDisplaySide)),
    );
    assert.equal(state.sourceSize[0], expectedSourceSide);
    for (let axis = 0; axis < 2; axis += 1) {
      const expectedDensity = state.logicalSize[axis] / middleSide;
      const actualDensity =
        state.dynamicUITextureSize[axis] / state.sourceSize[axis];
      approximatelyEqual(
        actualDensity,
        expectedDensity,
        0.5 / state.sourceSize[axis] + Number.EPSILON,
        `${state.name} auto raster density axis ${axis}`,
      );
    }
  } else {
    assert.equal(state.dynamicUIRenderScale, 1);
    assert.deepEqual(state.dynamicUITextureSize, state.logicalSize);
    assert.equal(state.selectedProfile, profiles[state.quality]);
  }

  const expectedPoints = projectOfficialKeypoints(contract);
  for (let index = 0; index < expectedPoints.length; index += 1) {
    for (let axis = 0; axis < 2; axis += 1) {
      approximatelyEqual(
        state.viewportPoints[index][axis],
        expectedPoints[index][axis],
        1e-12,
        `${state.name} viewport point ${index}/${axis}`,
      );
    }
  }
  for (const [index, unitCorner] of
    [[0, 0], [1, 0], [0, 1], [1, 1]].entries()) {
    const projected = applyHomography(state.homography, unitCorner);
    const recovered = applyHomography(state.inverseHomography, projected);
    for (let axis = 0; axis < 2; axis += 1) {
      approximatelyEqual(
        projected[axis],
        state.viewportPoints[index][axis],
        2e-6,
        `${state.name} H corner ${index}/${axis}`,
      );
      approximatelyEqual(
        recovered[axis],
        unitCorner[axis],
        2e-5,
        `${state.name} Hinv corner ${index}/${axis}`,
      );
    }
  }

  const expectedBounds = containSquare(state.drawingBuffer);
  assert.deepEqual(state.displayBounds, expectedBounds);
  for (const probe of state.sampleProbes) {
    const [u, v] = probe.normalized;
    assert.deepEqual(probe.cardSamplerUV, [u, v]);
    assert.deepEqual(probe.logicalPixel, [
      u * state.logicalSize[0],
      v * state.logicalSize[1],
    ]);
    assert.deepEqual(probe.dynamicUIPixel, [
      u * state.dynamicUITextureSize[0],
      v * state.dynamicUITextureSize[1],
    ]);
    const viewport = applyHomography(state.homography, [u, v]);
    for (let axis = 0; axis < 2; axis += 1) {
      approximatelyEqual(
        probe.sourceViewportUV[axis],
        viewport[axis],
        1e-12,
        `${state.name} source sample ${u},${v}/${axis}`,
      );
    }
    assert.deepEqual(probe.displayPixel, [
      expectedBounds.left + viewport[0] * expectedBounds.side,
      expectedBounds.top + viewport[1] * expectedBounds.side,
    ]);
  }
  const center = state.sampleProbes.find(
    ({ normalized }) => normalized[0] === 0.5 && normalized[1] === 0.5,
  );
  approximatelyEqual(
    center.displayPixel[0],
    state.drawingBuffer[0] / 2,
    0.001 * expectedBounds.side,
    `${state.name} display center x`,
  );
  approximatelyEqual(
    center.displayPixel[1],
    state.drawingBuffer[1] / 2,
    0.001 * expectedBounds.side,
    `${state.name} display center y`,
  );
}

function assertMutationRejected(state, mutate, contract, label) {
  const changed = structuredClone(state);
  mutate(changed);
  assert.throws(
    () => validateDensityState(changed, contract),
    undefined,
    `${label} did not fail closed`,
  );
}

const contract = readJson(DISPLAY_CONTRACT_PATH);
assert.equal(contract.schema_version, 6);
assert.equal(contract.camera.near_clip_plane, 0.30000001192092896);
assert.equal(contract.camera.far_clip_plane, 1000);
assert.deepEqual(Object.keys(contract.quality_profiles).sort(), [
  "high",
  "low",
  "middle",
]);
const defaultProfile =
  contract.profiles.ordinary_android_default_middle_without_persisted_override;
assert.equal(
  defaultProfile.applicability.quality_name,
  contract.quality_profiles.middle.quality_name,
);
assert.deepEqual(
  Object.fromEntries(
    ["width", "height", "square", "size_formula"].map((key) => [
      key,
      defaultProfile.source_render_target_request[key],
    ]),
  ),
  Object.fromEntries(
    ["width", "height", "square", "size_formula"].map((key) => [
      key,
      contract.quality_profiles.middle.source_render_target_request[key],
    ]),
  ),
);
assert.equal(contract.display_modes.source_texture_property, "_DynamicUITex");
assert.equal(contract.homography.texture_uv.y_flip, false);
assert.equal(contract.homography.texture_uv.transform, "identity");
assert.equal(
  contract.homography.texture_uv.managed_blit_or_flip_before_consumer,
  false,
);

const logicalWidth = defaultProfile.card_view.pixel_width;
const logicalHeight = defaultProfile.card_view.pixel_height;
const camera = createDynamicUIOrthographicCamera(
  logicalWidth,
  logicalHeight,
);
assert.equal(camera.left, 0);
assert.equal(camera.right, logicalWidth);
assert.equal(camera.top, logicalHeight);
assert.equal(camera.bottom, 0);
assert.equal(DYNAMIC_UI_COORDINATE_CONTRACT.logicalOrigin, "top-left");
assert.equal(DYNAMIC_UI_COORDINATE_CONTRACT.logicalPositiveY, "down");
assert.equal(DYNAMIC_UI_COORDINATE_CONTRACT.logicalTopRenderTargetV, 0);
assert.equal(
  DYNAMIC_UI_COORDINATE_CONTRACT.sources.renderTarget.logicalTopSampleV,
  0,
);
assert.equal(
  DYNAMIC_UI_COORDINATE_CONTRACT.sources.canvas.logicalTopSampleV,
  1,
);

const canvasQuad = createDynamicUIQuadGeometry(
  logicalWidth,
  logicalHeight,
  "canvas",
);
const renderTargetQuad = createDynamicUIQuadGeometry(
  logicalWidth,
  logicalHeight,
  "renderTarget",
);
assert.deepEqual(
  [...canvasQuad.getAttribute("uv").array],
  [0, 1, 0, 0, 1, 0, 1, 1],
);
assert.deepEqual(
  [...renderTargetQuad.getAttribute("uv").array],
  [0, 0, 0, 1, 1, 1, 1, 0],
);
canvasQuad.dispose();
renderTargetQuad.dispose();

const appSource = readText(APP_PATH);
const tmpRendererSource = readText(TMP_RENDERER_PATH);
const dynamicTextVertex = readText(DYNAMIC_TEXT_VERTEX_PATH);
const dynamicTextFragment = readText(DYNAMIC_TEXT_FRAGMENT_PATH);
const dynamicTextManifest = readJson(DYNAMIC_TEXT_MANIFEST_PATH);

assert.match(
  appSource,
  /renderer\.setPixelRatio\(Math\.min\(devicePixelRatio,\s*2\)\);/u,
);
assert.match(
  appSource,
  /requestedDisplaySide\s*=\s*Math\.round\(Math\.min\(drawingBuffer\.x,\s*drawingBuffer\.y\)\)/u,
);
assert.match(
  appSource,
  /selectCardQualityProfile\(\s*qualityParam,\s*qualityProfiles,\s*requestedDisplaySide,\s*renderer\.capabilities\.maxTextureSize/u,
);
assert.match(
  appSource,
  /selectDynamicUIRenderScale\(\s*qualityParam,\s*selectedQualityProfile,\s*qualityProfiles/u,
);
assert.match(
  appSource,
  /textureW\s*=\s*Math\.max\(1,\s*Math\.round\(W\s*\*\s*renderScale\)\)/u,
);
assert.match(
  appSource,
  /textureH\s*=\s*Math\.max\(1,\s*Math\.round\(H\s*\*\s*renderScale\)\)/u,
);
assert.match(
  appSource,
  /textureWidth:\s*textureW,\s*textureHeight:\s*textureH/u,
);
assert.match(
  appSource,
  /resizeSourceToDrawingBuffer:\s*true/u,
);
assert.match(
  tmpRendererSource,
  /const ui = target\(textureWidth,\s*textureHeight/u,
);
assert.match(
  tmpRendererSource,
  /const holo = target\(textureWidth,\s*textureHeight/u,
);
assert.match(dynamicTextVertex, /vs_TEXCOORD0 = _87;/u);
assert.match(dynamicTextVertex, /vec2 _87 = uv;/u);
assert.match(
  dynamicTextFragment,
  /texture\(_13,\s*vs_TEXCOORD0\)/u,
);
assert.deepEqual(dynamicTextManifest.runtime_contract.attributes, {
  position: "vec3",
  uv: "vec2",
});
assert.equal(
  dynamicTextManifest.official_vertex_inputs.inputs
    .find(({ sourceName }) => sourceName === "UV0")
    ?.threeAttribute,
  "uv",
);

const scenarios = [
  {
    name: "official-middle-portrait-dpr-cap",
    cssViewport: [390, 844],
    devicePixelRatio: 3,
    quality: "middle",
    maxTextureSize: 4096,
  },
  {
    name: "official-high-landscape-fractional-dpr",
    cssViewport: [1280, 720],
    devicePixelRatio: 1.25,
    quality: "high",
    maxTextureSize: 4096,
  },
  {
    name: "official-low-square",
    cssViewport: [768, 768],
    devicePixelRatio: 1,
    quality: "low",
    maxTextureSize: 4096,
  },
  {
    name: "auto-middle-floor",
    cssViewport: [320, 568],
    devicePixelRatio: 1,
    quality: "auto",
    maxTextureSize: 4096,
  },
  {
    name: "auto-native-display",
    cssViewport: [1280, 900],
    devicePixelRatio: 2,
    quality: "auto",
    maxTextureSize: 4096,
  },
  {
    name: "auto-max-texture-cap",
    cssViewport: [3840, 2160],
    devicePixelRatio: 2,
    quality: "auto",
    maxTextureSize: 4096,
  },
];
const states = scenarios.map((scenario) =>
  deriveDensityState(scenario, contract));
for (const state of states) validateDensityState(state, contract);

assertMutationRejected(
  states[0],
  (state) => { state.drawingBuffer[0] += 1; },
  contract,
  "CSS-to-drawing-buffer mutation",
);
assertMutationRejected(
  states[0],
  (state) => { state.displayTargetSize[1] -= 1; },
  contract,
  "drawing-buffer-to-display-RT mutation",
);
assertMutationRejected(
  states[4],
  (state) => { state.dynamicUITextureSize[0] += 1; },
  contract,
  "source-to-DynamicUI density mutation",
);
assertMutationRejected(
  states[4],
  (state) => { state.tmpRenderTargetSize[1] -= 1; },
  contract,
  "DynamicUI-to-TMP-RT mutation",
);
assertMutationRejected(
  states[4],
  (state) => {
    state.sampleProbes[0].cardSamplerUV[1] =
      1 - state.sampleProbes[0].cardSamplerUV[1];
  },
  contract,
  "card-sampler Y-flip mutation",
);
assertMutationRejected(
  states[4],
  (state) => { state.sampleProbes[1].displayPixel[0] += 1; },
  contract,
  "homography display-sampling mutation",
);

const fullSources = fullRuntimeSourceFiles(ROOT);
const tmpSources = tmpRuntimeSourceFiles(ROOT);
const requiredFullSources = [
  "public/app.js",
  "public/render/card-display-contract.json",
  "public/render/materials/text.js",
  "public/render/pipeline/homography-display.js",
  "public/render/pipeline/official-homography.js",
  "public/render/quality-profile.js",
  "public/render/tmp-sdf-renderer.js",
  "public/shaders/dynamic_ui_text.vert.glsl",
  "public/shaders/dynamic_ui_text.frag.glsl",
  "public/shaders/dynamic_ui_text_uniforms.json",
];
const requiredTmpSources = [
  "public/app.js",
  "public/render/official-ui-rt.js",
  "public/render/quality-profile.js",
  "public/render/tmp-sdf-renderer.js",
  "public/shaders/tmp_sdf.vert.glsl",
  "public/shaders/tmp_sdf.frag.glsl",
  "public/shaders/tmp_sdf_program.json",
];
for (const file of requiredFullSources) {
  assert(fullSources.includes(file), `${file} is absent from full runtime identity`);
}
for (const file of requiredTmpSources) {
  assert(tmpSources.includes(file), `${file} is absent from TMP runtime identity`);
}

const fullHashes = Object.fromEntries(
  requiredFullSources.map((file) => [file, sha256File(file)]),
);
const fullArtifact = {
  sourceFiles: [...requiredFullSources],
  sourceHashes: { ...fullHashes },
};
assert.equal(
  fullRuntimeSourceIdentityMatches(
    fullArtifact,
    requiredFullSources,
    fullHashes,
  ),
  true,
);
fullArtifact.sourceHashes["public/render/quality-profile.js"] = "0".repeat(64);
assert.equal(
  fullRuntimeSourceIdentityMatches(
    fullArtifact,
    requiredFullSources,
    fullHashes,
  ),
  false,
);

const tmpHashes = Object.fromEntries(
  requiredTmpSources.map((file) => [file, sha256File(file)]),
);
assert.equal(tmpRuntimeSourceIdentityMatches({ ...tmpHashes }, tmpHashes), true);
const changedTmpHashes = { ...tmpHashes, "public/app.js": "0".repeat(64) };
assert.equal(tmpRuntimeSourceIdentityMatches(changedTmpHashes, tmpHashes), false);

const autoStates = states.filter(({ quality }) => quality === "auto");
console.log("Display density integration gate OK (pure numeric, no browser)");
console.log([
  `${states.length} CSS/DPR scenarios`,
  `DPR cap ${Math.max(...states.map(({ rendererPixelRatio }) => rendererPixelRatio))}`,
  `${Object.keys(contract.quality_profiles).length} official profiles`,
  `${autoStates.length} auto floor/native/cap paths`,
  `${logicalWidth}x${logicalHeight} logical DynamicUI`,
  "DynamicUI/TMP RT sizes closed",
  "UV0/no-flip/H/Hinv/card sampling closed",
  `${requiredFullSources.length} full-runtime sources`,
  `${requiredTmpSources.length} TMP-runtime sources`,
  "6 density/sampling mutations rejected",
].join(", "));
