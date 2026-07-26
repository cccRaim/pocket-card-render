import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import {
  createOfficialTmpSpriteMaterial,
} from "../public/render/tmp-sprite-program.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const contract = JSON.parse(read("public/render/tmp-sprite-program.json"));
const program = {
  contract,
  vertexShader: read("public/shaders/tmp_sprite_to_rt.vert.glsl"),
  fragmentShader: read("public/shaders/tmp_sprite_to_rt.frag.glsl"),
};
const texture = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
const material = createOfficialTmpSpriteMaterial(program, {
  texture,
  textureSampleAdd: [0.1, 0.2, 0.3, 0.4],
});

assert.equal(material.blending, THREE.CustomBlending);
assert.equal(material.blendSrc, THREE.OneFactor);
assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
assert.equal(material.blendSrcAlpha, THREE.OneFactor);
assert.equal(material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
assert.equal(material.depthTest, false);
assert.equal(material.depthWrite, false);
assert.equal(material.side, THREE.DoubleSide);
assert.equal(material.uniforms._MainTex.value, texture);
assert.deepEqual(
  material.uniforms._TextureSampleAdd.value.toArray(),
  [0.1, 0.2, 0.3, 0.4],
);
assert.equal(
  material.userData.officialTmpSprite.selectorId,
  contract.officialSelector.selectorId,
);
assert.equal(
  material.userData.officialTmpSprite.webglAdaptationStatus,
  "source-hash-bound",
);
assert.equal(
  material.userData.officialTmpSprite.runtimeBoundaries.length,
  contract.runtimeBoundaries.length,
);

const mutate = (callback) => {
  const value = structuredClone(contract);
  callback(value);
  assert.throws(
    () => createOfficialTmpSpriteMaterial({ ...program, contract: value }, { texture }),
  );
};
mutate((value) => { value.schema = "future"; });
mutate((value) => { value.classification.isUnityUiImage = true; });
mutate((value) => { value.officialSelector.candidateWitnessId = ""; });
mutate((value) => { value.officialPass.fixedSerializedState.blend.source = "SrcAlpha"; });
mutate((value) => { value.officialBindings.attributes[2].webglName = "uv2"; });
mutate((value) => { value.fragmentSemantics.alphaModel = "straight"; });

const appSource = read("public/app.js");
const rendererSource = read("public/render/tmp-sdf-renderer.js");
assert.match(appSource, /registerTmpSpriteDraw/u);
assert.match(appSource, /loadOfficialTmpSpriteProgram/u);
assert.match(rendererSource, /kind:\s*"TMP-Sprite"/u);
assert.match(rendererSource, /createOfficialTmpSpriteMaterial/u);

material.dispose();
texture.dispose();

console.log("Official TMP Sprite runtime route contract OK");
console.log("  dedicated TMP-Sprite draw, premultiplied pass, selector evidence and mutations passed");
