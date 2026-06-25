// UR (Ultra Rare) foil material strategies — the gold Uzumaki plate + diagonal parallax base, the lens
// flare, the metallic window sheen, and the glitter flow-map sparkle. All byte-traced from the UR shaders.
// (A self-contained example of "one rarity's materials in one file" — see CONTRIBUTING.md.)
import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { SIMPLE_VS, VIEW_BASIS_VS } from "../glsl.js";

const mainTexName = (r) => r.textures?._MainTex?.name || r.textures?._BaseTex?.name;
const hasFoilTex = (r, ctx) => !!(ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex"));

// ── plate (Card_UR_Plate) + parallax (Card_Parallax_UR base) — BYTE-TRACED from urplate_frag.spv. Same
// spiral-foil combine: final = mix(goldBase, goldBase·_DarknessColor, spiralMask) + fake-spec + env reflect.
// spiralMask = sin²(viewAngle·3)·(1 - clamp(luminance(goldBase) - bias, 0, 1)); the view sin folds to a
// constant for a static view → the radial pattern comes from the texture luminance (grooves darken). ──
function plateMaterial(r, ctx) {
  const f = r.floats;
  const tex = ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex");
  const V3 = (c, d) => (c ? new THREE.Vector3(c.r, c.g, c.b) : d);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: tex },
      uDarkColor: { value: V3(r.colors && r.colors._DarknessColor, new THREE.Vector3(0.8, 0.77, 0.70)) },
      uBias: { value: f._RampOffset ?? 0.15 },
      specMask: { value: ctx.layerTex(r, "_FakeSpecularMask") }, uHasSpec: { value: ctx.layerTex(r, "_FakeSpecularMask") ? 1 : 0 },
      uSpecColor: { value: V3(r.colors && r.colors._FakeSpecularColor, new THREE.Vector3(1, 0.93, 0)) },
      uSpecScale: { value: f._FakeSpecularMaskScale ?? 0.74 }, uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      envCube: { value: ctx.envCubeTex }, uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
      uShininess: { value: f._Shininess ?? 2 }, uSpecInt: { value: f._SpecularIntensity ?? 0.2 },
    },
    vertexShader: VIEW_BASIS_VS,
    fragmentShader: `
      uniform sampler2D mainTex, specMask; uniform float uBias, uHasSpec, uSpecScale, uSpecPow, uHasEnv, uShininess, uSpecInt;
      uniform vec3 uDarkColor, uSpecColor; uniform samplerCube envCube; varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
      void main() {
        vec4 t = texture2D(mainTex, vUv); vec3 base = t.rgb;
        float lum = dot(base, vec3(0.2989, 0.5866, 0.1145));
        float mask = 1.0 - clamp(lum - uBias, 0.0, 1.0);                // high in the dark grooves
        vec3 spiral = mix(base, base * uDarkColor, mask);               // grooves × _DarknessColor (mild)
        vec3 env = textureCube(envCube, reflect(-vVdO, vNrm)).rgb;
        float specPow = pow(clamp(abs(dot(vNrm, vVdO)), 0.0, 1.0), uShininess) * uSpecInt;
        spiral += base * env * specPow * uHasEnv;
        float fr = uSpecScale * (0.5 + 0.5 * (1.0 - abs(dot(vNrm, vVdO))));
        float sp = texture2D(specMask, vUv).r;
        spiral += uSpecColor * pow(clamp(sp * fr, 0.0, 1.0), uSpecPow) * uHasSpec;
        float a = clamp(lum * 1.4 + 0.25 + sp * uHasSpec, 0.0, 1.0) * t.a;   // ridges opaque, grooves see-through
        gl_FragColor = vec4(spiral, a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
  });
  m.userData.straight = ctx.texStraight(mainTexName(r));
  return m;
}
defineMaterial("plate", { requires: hasFoilTex, build: plateMaterial });     // semi-transparent Uzumaki spiral (top)
defineMaterial("parallax", { requires: hasFoilTex, build: plateMaterial });  // diagonal gold base (same combine)

// ── flare (Card_UR_LensFlare) — BYTE-TRACED from urflare_frag.spv: out = clamp(flareTex - _Cutoff, 0, 1)·
// (_BaseColor·_BaseColorRGBIntensity). Additive thresholded gold sprite on its star-ray mesh. ──
defineMaterial("flare", {
  requires: (r, ctx) => !!(ctx.layerTex(r, "_BaseMap") || ctx.layerTex(r, "_MainTex")),
  build(r, ctx) {
    const f = r.floats, c = r.colors || {};
    const tint = c._BaseColor ? new THREE.Vector3(c._BaseColor.r, c._BaseColor.g, c._BaseColor.b) : new THREE.Vector3(1, 0.95, 0.6);
    return new THREE.ShaderMaterial({
      uniforms: {
        baseMap: { value: ctx.layerTex(r, "_BaseMap") || ctx.layerTex(r, "_MainTex") },
        uCutoff: { value: f._Cutoff ?? 0.5 }, uTint: { value: tint }, uIntensity: { value: f._BaseColorRGBIntensity ?? 1.5 },
      },
      vertexShader: SIMPLE_VS,
      fragmentShader: `
        uniform sampler2D baseMap; uniform float uCutoff, uIntensity; uniform vec3 uTint; varying vec2 vUv;
        void main() {
          vec4 t = texture2D(baseMap, vUv);
          vec3 rgb = clamp(t.rgb - uCutoff, 0.0, 1.0) * uTint * uIntensity;   // threshold-cut gold flare
          gl_FragColor = vec4(rgb, clamp(t.a - uCutoff, 0.0, 1.0));
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
    });
  },
});

// ── metal (Card_Parallax_Metal) — env-cube specular on the metallic window submesh, MULTIPLY blend.
// metal_frag (SPIRV-Cross): out ≈ 1 + cube(reflect(-V,N))·pow(clamp(-reflect.z,0,1), _DiffractionPower)·
// _SpecularIntensity → a metallic env sheen at grazing/tilt (≈no-op head-on, so multiply doesn't darken). ──
defineMaterial("metal", {
  build(r, ctx) {
    const f = r.floats;
    return new THREE.ShaderMaterial({
      uniforms: {
        envCube: { value: ctx.envCubeTex }, uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
        uSpecInt: { value: f._SpecularIntensity ?? 0.5 }, uSpecPow: { value: f._DiffractionPower ?? 16 },
      },
      vertexShader: `varying vec3 vVdO; varying vec3 vNrm;
        void main(){
          vec3 vdW = normalize(cameraPosition - (modelMatrix * vec4(position,1.0)).xyz);
          vVdO = normalize((inverse(modelMatrix) * vec4(vdW,0.0)).xyz); vNrm = normalize(normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform samplerCube envCube; uniform float uHasEnv, uSpecInt, uSpecPow; varying vec3 vVdO; varying vec3 vNrm;
        void main(){
          vec3 R = reflect(-vVdO, vNrm);
          float grazing = pow(clamp(-R.z, 0.0, 1.0), uSpecPow);
          vec3 spec = textureCube(envCube, R).rgb * grazing * uSpecInt * uHasEnv;
          gl_FragColor = vec4(1.0 + spec, 1.0);          // MULTIPLY blend: dst·(1+spec)
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
    });
  },
});

// ── glitter (Card_UR_Glitter_FlowMaps) — two strategies behind one kind: the EXACT real vertex+fragment
// bytecode (SPIRV-Cross → RawShaderMaterial) when available, else a byte-traced hand port. The exact path
// reproduces the field rotation that DATA-proved (sc_twinkle.py) to be the twinkle, not a swirl. ──
function glitterMaterialExact(r, ctx) {
  const f = r.floats, c = r.colors || {}, lc = c._LightColor || { r: 1, g: 0.975, b: 0.769 };
  const rep = (slot) => ctx.layerTexRepeat(r, slot);
  const V4 = (x, y, z, w) => new THREE.Vector4(x, y, z, w);
  const _78 = Array.from({ length: 18 }, () => V4(0, 0, 0, 0));
  _78[13].set(f._FakeCameraHeight ?? 0, f._Height ?? 0, f._HeightPower ?? 0.6, f._Scale ?? 0.675);
  _78[15].set(0, 0, 0, 0);   // engine-bound field-rotation angle; fed the real Unity _Time per frame (see loop)
  _78[16].set(f._FlowScale ?? 1.35, f._FakeCameraHeightB ?? 0, f._HeightB ?? 0, f._HeightPowerB ?? 0.5);
  _78[17].set(f._ScaleB ?? 0.6, f._FlowScaleB ?? 1.35, 0, 0);
  const _37 = Array.from({ length: 5 }, () => V4(0, 0, 0, 0));
  _37[2].set(f._EmitThreshold ?? 0.08, f._FlowAPower ?? 0.1, f._FlowBPower ?? 0.1, 0);
  _37[3].set(lc.r, lc.g, lc.b, 1);
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      _78: { value: _78 }, _37: { value: _37 },
      _13: { value: rep("_FlowAMap") }, _205: { value: rep("_ALightTex") }, _404: { value: rep("_ABaseTex") },
      _644: { value: rep("_FlowBMap") }, _690: { value: rep("_BLightTex") }, _843: { value: rep("_BBaseTex") },
    },
    vertexShader: ctx.exactGlit.vert, fragmentShader: ctx.exactGlit.frag,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  ctx.exactGlitMats.push(m);   // per-frame: _37[0] and _78[15] = the real Unity _Time (drives flow + rotation)
  return m;
}
// hand port (used when the SPIRV-Cross shader is absent) — base_rgb × light.GREEN, two layers B-over-A,
// layer B's flow staggers the per-pixel scintillation (the twinkle), no field rotation.
function glitterMaterialHand(r, ctx) {
  const f = r.floats;
  const rep = (slot) => ctx.layerTexRepeat(r, slot);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      baseA: { value: rep("_ABaseTex") }, lightA: { value: rep("_ALightTex") },
      baseB: { value: rep("_BBaseTex") }, lightB: { value: rep("_BLightTex") },
      flowB: { value: rep("_FlowBMap") },
      uFlowB: { value: f._FlowBPower ?? 0.1 }, uSpeed: { value: f._FlowBSpeed ?? 1 },
      uScale: { value: 1 / (f._Scale || 0.675) }, uTime: { value: 0 },
    },
    vertexShader: SIMPLE_VS,
    fragmentShader: `
      uniform sampler2D baseA, lightA, baseB, lightB, flowB;
      uniform float uFlowB, uSpeed, uScale, uTime; varying vec2 vUv;
      void main() {
        vec2 uvS = vUv * uScale;
        vec4 bA = texture2D(baseA, uvS); vec3 A = bA.rgb * texture2D(lightA, uvS).y;
        vec2 fvB = (texture2D(flowB, uvS).xy - 0.5) * uFlowB;
        float t = uTime * uSpeed * 0.1, ft = fract(t), w = abs(1.0 - 2.0 * ft);
        vec2 b1 = uvS + fvB * ft;
        vec4 bB1 = texture2D(baseB, b1); vec3 p1 = bB1.rgb * texture2D(lightB, b1).y;
        vec4 bB2 = texture2D(baseB, uvS); vec3 p2 = bB2.rgb * texture2D(lightB, uvS).y;   // phase2 static (bytecode)
        vec3 B = p1 * (1.0 - w) + p2 * w;
        float aB = bB1.a * (1.0 - w) + bB2.a * w;                        // coverage = base_B alpha
        vec3 glit = A * (1.0 - aB) + B;                                  // B over A
        gl_FragColor = vec4(glit, max(max(A.r, A.g), max(B.r, max(B.g, aB))));
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
  });
  ctx.animMats.push(m);   // uTime updated each frame → the sparkle flows/twinkles (slowly)
  return m;
}
defineMaterial("glitter", {
  requires: (r, ctx) => !!(ctx.layerTex(r, "_ABaseTex") && ctx.layerTex(r, "_FlowAMap")),
  build: (r, ctx) => (ctx.exactGlit ? glitterMaterialExact(r, ctx) : glitterMaterialHand(r, ctx)),
});
