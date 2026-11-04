import assert from "node:assert/strict";
import test from "node:test";
import { Matrix4, Vector3, Vector4, Quaternion, Euler } from "three";
import { adaptUnityDataStage, compileUnityDataStageContract, validateUnityDataStageSourceText } from "./unity-data-stage.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

const adapt = (source, stage = "vertex") => adaptUnityDataStage(source, {
  stage, inputBasis: "unity-flattened",
});
const vertex = `precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 normal;
in vec4 tangent;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

test("converts raw Unity inputs without shadowing Three uniform initializers", () => {
  const result = adapt(vertex);
  assert.match(result.source, /pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld \* modelMatrix \* pcrUnityFromGlbObject;/);
  assert.match(result.source, /pcrUnityInput_tangent = vec4\(-tangent.x, tangent.yz, -tangent.w\);/);
  assert.match(result.source, /projectionMatrix \* pcrUnityInput_viewMatrix \* pcrUnityInput_modelMatrix \* vec4\(pcrUnityInput_position, 1.0\)/);
  assert.match(result.source, /vUv = pcrUnityInput_uv;/);
  assert.doesNotMatch(result.source, /highp mat4 modelMatrix\s*=/);
  assert.equal(result.runtimeEvidence, false);
  assert.equal(result.backendSemanticEquivalence, false);
  assert.throws(() => adapt(result.source), /already contains a basis adaptation/);
});

test("sampler2D sampling flips stored V after procedural UV/ST math; Cube stays in Unity data space", () => {
  const result = adapt(`precision highp float;
uniform sampler2D colorTex;
uniform samplerCube envTex;
uniform vec4 texST;
in vec2 vUv;
out vec4 color;
void main() {
  // texture(colorTex, uv) must not be interpreted from a comment.
  color = texture (colorTex, mix(vUv * texST.xy + texST.zw, vec2(.2, .4), .5));
  color += textureLod(colorTex, vUv + texture(colorTex, vUv).xy, 1.0);
  color += texture(envTex, vec3(vUv, 1.0));
}`, "fragment");
  assert.equal(result.storedVSampleCount, 3);
  assert.match(result.source, /pcrStoredUv\( mix\(vUv \* texST.xy \+ texST.zw/);
  assert.match(result.source, /texture\(envTex, vec3\(vUv, 1.0\)\)/);
  assert.match(result.source, /texture\(colorTex, pcrStoredUv\( vUv\)\)\.xy/);
});

test("rejects unsupported global/helper/preprocessor/sampler shapes instead of partly converting", () => {
  for (const [source, pattern] of [
    [vertex.replace("void main()", "vec3 helper() { return position; }\nvoid main()"), /outside main/],
    [vertex + "\nvec3 helper() { return cameraPosition; }", /final declaration/],
    [vertex.replace("void main()", "#define position alternate\nvoid main()"), /preprocessor/],
    [vertex.replace("in vec3 position;", "in vec4 position;"), /unsupported position/],
    [vertex.replace("vUv = uv;", "vec2 uv = vec2(0.0); vUv = uv;"), /shadows converted/],
    [vertex.replace("vUv = uv;", "vec3 pcrUnityWorldNormal = normal;"), /already contains/],
    [vertex.slice(0, -1), /main must be complete/],
  ]) assert.throws(() => adapt(source), pattern);
  assert.throws(() => adaptUnityDataStage(vertex, { stage: "vertex" }), /explicit unity-flattened/);
  for (const [declaration, expression, pattern] of [
    ["uniform sampler2D tex;", "textureGrad(tex, vec2(0.0), vec2(1.0), vec2(1.0))", /unsupported sampler2D/],
    ["uniform sampler2D tex[2];", "texture(tex[0], vec2(0.0))", /unsupported sampler type/],
    ["uniform sampler2DShadow tex;", "texture(tex, vec3(0.0))", /unsupported sampler type/],
    ["uniform sampler2D tex;", "texture(other, vec2(0.0))", /unresolved sampler/],
  ]) assert.throws(() => adapt(`${declaration}\nout vec4 color;\nvoid main() { color = ${expression}; }`, "fragment"), pattern);
});

const close = (a, b) => a.forEach((value, index) => assert(Math.abs(value - b[index]) < 1e-10, `${a} != ${b}`));

test("input/matrix conversions preserve clip coordinates across tilted, mirrored and nonuniform transforms", () => {
  const C = new Matrix4().makeScale(1, 1, -1);
  const A = new Matrix4().makeScale(-1, 1, 1);
  const P = new Matrix4().makePerspective(-.2, .3, .2, -.3, .3, 100);
  for (const angle of [-.5, 0, .5]) {
    const M = new Matrix4().compose(new Vector3(.4, -.2, .6), new Quaternion().setFromEuler(new Euler(angle, .3, -.2)), new Vector3(-1.1, .7, 1.3));
    const V = new Matrix4().compose(new Vector3(0, 0, -2), new Quaternion().setFromEuler(new Euler(.1, -.2, .2)), new Vector3(1, 1, 1));
    const position = new Vector4(.17, -.28, .06, 1);
    const threeClip = position.clone().applyMatrix4(M).applyMatrix4(V).applyMatrix4(P);
    const unityClip = position.clone().applyMatrix4(A)
      .applyMatrix4(new Matrix4().multiplyMatrices(C, M).multiply(A))
      .applyMatrix4(V.clone().multiply(C)).applyMatrix4(P);
    close(unityClip.toArray(), threeClip.toArray());
  }
});

test("tangent W correction preserves the oriented bitangent under GLB X reflection", () => {
  const n = new Vector3(.2, .3, .9).normalize();
  const t = new Vector3(.7, -.4, .1).normalize();
  for (const sign of [-1, 1]) {
    const expected = new Vector3().crossVectors(n, t).multiplyScalar(sign).multiply(new Vector3(-1, 1, 1));
    const actual = new Vector3().crossVectors(
      n.clone().multiply(new Vector3(-1, 1, 1)), t.clone().multiply(new Vector3(-1, 1, 1)),
    ).multiplyScalar(-sign);
    close(actual.toArray(), expected.toArray());
  }
});

test("UV conversion respects nonunit TexEnv scale/offset and leaves cube vectors separate", () => {
  const glbUv = [.23, .71], scale = [1.6, -.8], offset = [.13, -.27];
  const unityUv = [glbUv[0], 1 - glbUv[1]];
  const unityST = unityUv.map((value, i) => value * scale[i] + offset[i]);
  const storedUv = [unityST[0], 1 - unityST[1]];
  const directThree = [glbUv[0] * scale[0] + offset[0], glbUv[1] * scale[1] + 1 - scale[1] - offset[1]];
  close(storedUv, directThree);
});

test("data-stage contract binds emitted source and rejects rehashed structural mutations", () => {
  const result = adapt(vertex);
  assert.deepEqual(validateUnityDataStageSourceText(result.source, result.contract), result.contract);
  assert.throws(() => validateUnityDataStageSourceText(result.source + "\n", result.contract), /source hash/);
  assert.throws(() => compileUnityDataStageContract({ ...result.contract, inputs: ["notAnInput"] }), /Unsupported/);
  assert.throws(() => validateUnityDataStageSourceText(result.source, { ...result.contract, inputs: [] }), /alias mismatch/);
  assert.throws(() => validateUnityDataStageSourceText(result.source, { ...result.contract, storedVSampleCount: 1 }), /sample count/);
});

test("typed adaptation binds data-stage evidence and rejects mixed basis paths", () => {
  const result = adapt(vertex);
  const hash = "1".repeat(64);
  const operation = { kind: "unity-data-stage-boundary", contract: "unity-flattened-to-three-input-and-storage" };
  const input = {
    vertex: { officialSpirvSha256: hash, spirvCrossGlslSha256: hash, outputSha256: result.contract.outputSourceSha256,
      operations: [operation, { kind: "clip-space-y-conversion", from: "unity-vulkan", to: "webgl", operation: "remove-y-inversion" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" }] },
    fragment: { officialSpirvSha256: hash, spirvCrossGlslSha256: hash, outputSha256: hash,
      operations: [{ kind: "glsl-version-ownership", owner: "three-raw-shader-material" }] },
    interfaceSha256: hash, officialVertexInputs: {}, officialProgramBindings: {},
    runtimeContract: { engine_uniforms: {}, backend_data_stages: { vertex: result.contract } },
  };
  const built = buildWebglAdaptationV2(input);
  assert.match(built.vertex.operations[0].dataStageContractSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => buildWebglAdaptationV2({ ...input, runtimeContract: { engine_uniforms: {} } }), /Invalid Unity/);
  assert.throws(() => buildWebglAdaptationV2({ ...input, vertex: { ...input.vertex, outputSha256: hash } }), /source\/stage mismatch/);
  assert.throws(() => buildWebglAdaptationV2({ ...input, vertex: { ...input.vertex, operations: [
    ...input.vertex.operations, { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
  ] } }), /cannot be combined/);
  assert.throws(() => buildWebglAdaptationV2({ ...input, vertex: { ...input.vertex, operations: [
    { ...operation, dataStageContractSha256: hash }, ...input.vertex.operations.slice(1),
  ] } }), /does not match/);
});
