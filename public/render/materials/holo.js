// Holographic material strategies — the view-dependent diffraction/iridescence family shared across
// rarities: window holo, RR/SR/UR frame holo, the EX-UI foil, the rarity diamond, and the ShadowBox
// hologram body. All byte-traced from the game's fragment SPIR-V (see the per-function notes).
import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { EMISSIVE_MRT_RGB, VIEW_BASIS_WORLD_VS } from "../glsl.js";

const V3 = (c, d) => (c ? new THREE.Vector3(c.r, c.g, c.b) : d);
const V4 = (c, d) => (c ? new THREE.Vector4(c.r, c.g, c.b, c.a ?? 1) : d);
const hasFakeSpec = (r, ctx) => {
  const f = r.floats || {};
  const capabilities = r.runtimeDispatch?.capabilities || {};
  if (!ctx.layerTexDefault(r, "_FakeSpecularMask")) return 0;
  if (f._FakeSpecularEnabled != null) return f._FakeSpecularEnabled ? 1 : 0;
  if (capabilities.fakeSpecEnabledDefault != null) {
    return capabilities.fakeSpecEnabledDefault ? 1 : 0;
  }
  return (f._FakeSpecularIntensity ?? capabilities.fakeSpecIntensityDefault ?? 0) > 0 ? 1 : 0;
};

// ── holo (Card_Parallax_Hologram_Tuning) — BYTE-TRACED from holo_frag.spv. Diffraction sparkle from
// _PhaseTex + a rainbow _RampTex lookup, both driven by view-vs-normal; the vertex also applies the
// Card_Parallax UV offset (this is a parallax-hologram). Additive. ──
function holoMaterial(L, ctx, overOpacity = 0) {
  const f = L.floats || {};
  const rot = L.colors?._Rotation || { r: 0, g: 0, b: 0 };
  const exact = ctx.exactShaderPort(L);
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _256: { value: ctx.layerTexDefault(L, "_PhaseTex") },
        _323: { value: ctx.layerTexDefault(L, "_RampMaskTex") },
        _382: { value: ctx.layerTexDefault(L, "_RampTex") },
        _397: { value: ctx.layerTexDefault(L, "_HologramMaskTex") },
        _FakeCameraHeight: { value: f._FakeCameraHeight ?? 0 },
        _Height: { value: f._Height ?? -1 },
        _HeightPower: { value: f._HeightPower ?? 0 },
        _Scale: { value: f._Scale ?? 1 },
        _UseUv: { value: Math.trunc(f._UseUv ?? 0) },
        _UseMaskUv: { value: Math.trunc(f._UseMaskUv ?? 0) },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Card_Parallax_Hologram_Tuning";
    m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exact.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return m;
  }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uOver: { value: overOpacity },
      phase: { value: ctx.layerTexDefault(L, "_PhaseTex") }, rampMask: { value: ctx.layerTexDefaultRepeat(L, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(L, "_RampTex") },
      holoMask: { value: ctx.layerTexDefault(L, "_HologramMaskTex") },
      uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 }, uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
      uUseUv: { value: f._UseUv ?? 0 }, uUseMaskUv: { value: f._UseMaskUv ?? 0 },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: `
      uniform float uHeight, uHeightPower, uScale, uFakeH, uUseUv, uUseMaskUv;
      attribute vec4 tangent;
      attribute vec2 uv1;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec3 vNrmW;
      void main() {
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        camObj.y += uFakeH;
        vec3 viewObj = normalize(camObj - position);
        vec3 n = normalize(normal);
        vec3 t = normalize(tangent.xyz);
        vec3 b = normalize(cross(n, t) * tangent.w);
        vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
        vec2 off = (tv.xy / (tv.z + 0.41999998688697815)) * (uHeightPower * (uHeight - 0.5));
        vec2 phaseUv = mix(uv, uv1, step(0.5, uUseUv));
        vec2 maskUv = mix(uv, uv1, step(0.5, uUseMaskUv));
        vUv = (((phaseUv * 2.0) - 1.0) / uScale) * 0.5 + off + 0.5;
        vMaskUv = (((maskUv * 2.0) - 1.0) / uScale) * 0.5 + off + 0.5;
        vNrmW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D phase, rampMask, ramp, holoMask;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uOver;
      uniform vec3 uRotation;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec3 vNrmW;
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      void main() {
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 Rv = rotateXYZ(camFwd, uRotation) * 0.5 + 0.5;
        vec3 Rn = rotateXYZ(normalize(vNrmW), uRotation) * 0.5 + 0.5;
        float s  = dot(Rn.xy, Rv.xy);
        vec4  ph = texture2D(phase, vUv);
        vec2  pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2  dd = 1.0 - min(abs(vec2(s) - pc), vec2(1.0));
        dd = pow(dd, vec2(uDiffPow)) * ph.zw;
        float diffraction = dd.x + dd.y;
        float vd = dot(Rn * uSpeed, Rv);
        float m1 = texture2D(rampMask, vUv).r;
        float U  = clamp(fract((vd - m1) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3  rainbow = texture2D(ramp, vec2(U, 0.5)).rgb;
        vec3  col = diffraction * rainbow * uDiffInt;
        col *= texture2D(holoMask, vMaskUv).r;
        float over = step(0.001, uOver);
        float cov = clamp(diffraction, 0.0, 1.0);
        vec3 rgbOut = mix(col, clamp(col, 0.0, 1.0), over);
        float a = mix(1.0, cov * uOver, over);
        gl_FragColor = vec4(rgbOut, a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  return m;
}
defineMaterial("holo", {
  requires: (r, ctx) => !!(ctx.layerTexDefault(r, "_PhaseTex") && ctx.layerTexDefault(r, "_RampMaskTex") && ctx.layerTexDefault(r, "_RampTex")),
  build: (r, ctx) => holoMaterial(r, ctx),
});

// ── frameHolo (Frame-Holo-Tuning + the SR/UR frame variants) — FULL SSA trace of framh_frag.spv (1219
// instrs, 7 samplers). Names stripped; UBO layout recovered from the sibling Transparent_HologramLayer.
//   out.rgb = mix(base.rgb, base·(1+foil)+cube·spec, A);  out.a = base.a ;  foil = rainbow·diffraction·_DiffInt
// One branch-free combine: the per-card _PhaseScale/_RampScale/_RampRotate knobs turn the SAME formula from
// Venusaur's subtle streaks (neutral params) into the SR dense rainbow marble (scale 15 / rotate 35.49). The
// UR fake-spec + broad rainbow-gold reflection are gated by _FakeSpecularEnabled (UR-frame-only). ──
function frameHoloMaterial(r, ctx, mode) {
  const f = r.floats || {};
  const rot = r.colors?._Rotation || { r: 0, g: 0, b: 0 };
  const exactFrame = mode === "classic-frame" ? ctx.exactShaderPort(r) : null;
  if (exactFrame) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _13: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
        _748: { value: ctx.layerTexDefault(r, "_BaseTex") },
        _693: { value: ctx.layerCubeDefault(r) },
        _523: { value: ctx.layerTexDefaultRepeat(r, "_PhaseTex") },
        _125: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex") },
        _467: { value: ctx.layerTexDefault(r, "_RampTex") },
        _767: { value: ctx.layerTexDefault(r, "_HologramFrontMaskTex") },
        _Shininess: { value: f._Shininess ?? 32 },
        _BaseColorIntensity: { value: f._BaseColorIntensity ?? 0.5 },
        _SpecularIntensity: { value: f._SpecularIntensity ?? 1 },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _RampUVOffset: { value: f._RampUVOffset ?? 0 },
        _RampUVTiltOffset: { value: f._RampUVTiltOffset ?? 0 },
        _PhaseScale: { value: f._PhaseScale ?? 1 },
        _RampScale: { value: f._RampScale ?? 1 },
        _PhaseRotate: { value: f._PhaseRotate ?? 0 },
        _RampRotate: { value: f._RampRotate ?? 0 },
        _FrontMaskPower: { value: f._FrontMaskPower ?? 64 },
        _AlphaBlend: { value: f._AlphaBlend ?? 0 },
        _MaskEmissive: { value: f._MaskEmissive ?? 0 },
        _CutOut: { value: f._CutOut ?? 0.009999999776482582 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exactFrame.vert,
      fragmentShader: exactFrame.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = true;
    m.userData.exactShader = "Frame-Holo-Tuning";
    m.userData.officialPassRuntime = exactFrame.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exactFrame.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exactFrame.manifest?.official_executable_identity || null;
    return m;
  }
  const exact = mode === "card-hologram" ? ctx.exactShaderPort(r) : null;
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _13: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
        _488: { value: ctx.layerTexDefaultRepeat(r, "_PhaseTex") },
        _386: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex") },
        _458: { value: ctx.layerTexDefault(r, "_RampTex") },
        _595: { value: ctx.layerTexDefault(r, "_HologramFrontMaskTex") },
        _UseUv: { value: Math.trunc(f._UseUv ?? 0) },
        _UseMaskUv: { value: Math.trunc(f._UseMaskUv ?? 0) },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _RampUVOffset: { value: f._RampUVOffset ?? 0 },
        _RampUVTiltOffset: { value: f._RampUVTiltOffset ?? 0 },
        _RampScale: { value: f._RampScale ?? 1 },
        _PhaseScale: { value: f._PhaseScale ?? 1 },
        _RampRotate: { value: f._RampRotate ?? 0 },
        _PhaseRotate: { value: f._PhaseRotate ?? 0 },
        _AlphaBlend: { value: f._AlphaBlend ?? 0 },
        _MaskPower: { value: f._MaskPower ?? 64 },
        _CutOut: { value: f._CutOut ?? 0.009999999776482582 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
        _UseAlphaAsAlphaBlendMask: { value: Math.trunc(f._UseAlphaAsAlphaBlendMask ?? 0) },
        _UseReflectionAlpha: { value: Math.trunc(f._UseReflectionAlpha ?? 1) },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Card_Hologram_Tuning";
    m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exact.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return m;
  }
  const specOn = hasFakeSpec(r, ctx);
  const rep = (slot) => ctx.layerTexDefaultRepeat(r, slot);
  const phaseMask = ctx.layerTexDefault(r, "_PhaseMaskTex") || ctx.layerTexDefault(r, "_PhaseTex") || ctx.layerTex(r, "_BaseTex") || ctx.layerTex(r, "_HologramMaskTex") || ctx.layerTex(r, "_LayerMaskTex");
  const baseTex = ctx.layerTexDefault(r, "_BaseTex") || ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTex(r, "_LayerMaskTex");
  const maskTex = ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTex(r, "_LayerMaskTex");
  const m = new THREE.ShaderMaterial({
    uniforms: {
      baseTex: { value: baseTex },
      mask: { value: maskTex },
      uHasBase: { value: ctx.layerTexDefault(r, "_BaseTex") ? 1 : 0 },
      uAlpha: { value: f._AlphaBlend ?? 0 },
      phaseR: { value: rep("_PhaseTex") }, swirl: { value: rep("_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      phaseMask: { value: phaseMask },
      uHasPhaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") ? 1 : 0 },
      frontMask: { value: ctx.layerTexDefault(r, "_HologramFrontMaskTex") || maskTex },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uDiff1Pow: { value: f._DiffractionPower ?? 64 }, uDiff1Int: { value: 0 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      layerMask: { value: ctx.layerTex(r, "_LayerMaskTex") || ctx.layerTexDefault(r, "_HologramMaskTex") },
      swirl2: { value: rep("_RampMaskTex2") || rep("_RampMaskTex") }, ramp2: { value: ctx.layerTexDefault(r, "_RampTex2") || ctx.layerTexDefault(r, "_RampTex") },
      uHasLayerMask: { value: ctx.layerTex(r, "_LayerMaskTex") ? 1 : 0 },
      uHasLayer2: { value: 0 },
      uDiffPow2: { value: f._DiffractionPower2 ?? f._DiffractionPower ?? 64 }, uDiffInt2: { value: f._DiffractionIntensity2 ?? 0 },
      uRepeat2: { value: f._RampRepeat2 ?? f._RampRepeat ?? 2 }, uOffset2: { value: f._RampOffset ?? 0 },
      uSpeed2: { value: f._RampSpeed2 ?? f._RampSpeed ?? 1 }, uInterval2: { value: f._RampInterval2 ?? f._RampInterval ?? 0 },
      uRMaskScale2: { value: f._RampMaskScale2 ?? f._RampScale ?? 1 }, uRMaskRot2: { value: f._RampMaskRotation2 ?? f._RampRotate ?? 0 },
      uRScale: { value: f._RampScale ?? 1 }, uRRot: { value: f._RampRotate ?? 0 },
      uRMaskScale: { value: f._RampMaskScale ?? f._RampScale ?? 1 },
      uRMaskRot: { value: f._RampMaskRotation ?? 0 },
      uUseSimpleRamp: { value: f._UseSimpleRampMaskAndRotation ?? 0 },
      uRUVOff: { value: f._RampUVOffset ?? 0 }, uRTiltOff: { value: f._RampUVTiltOffset ?? 0 },
      uPScale: { value: f._PhaseScale ?? 1 }, uPRot: { value: f._PhaseRotate ?? 0 },
      uUseUv: { value: f._UseUv ?? 0 }, uUseMaskUv: { value: f._UseMaskUv ?? 0 },
      uCutOut: { value: f._CutOut ?? 0.009999999776482582 },
      uMaskPower: { value: f._FrontMaskPower ?? f._MaskPower ?? 64 },
      uCardHolo: { value: mode === "card-hologram" ? 1 : 0 },
      uUseAlphaMask: { value: mode === "card-hologram" ? (f._UseAlphaAsAlphaBlendMask ?? 0) : 0 },
      uUseReflectionAlpha: { value: mode === "card-hologram" ? (f._UseReflectionAlpha ?? 1) : 0 },
      uStraight: { value: 0 },
      envCube: { value: ctx.envCubeTex },
      uFrameHolo: { value: mode === "classic-frame" ? 1 : 0 },
      uHasEnv: { value: (ctx.envCubeTex && r.textures?._CubeMap && mode === "classic-frame") ? 1 : 0 },
      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 },
      uRemoveMetallic: { value: f._RemoveMetallic ?? f._RemoveMetalic ?? 0 },
      uShininess: { value: f._Shininess ?? 32 },
      uSpecularIntensity: { value: f._SpecularIntensity ?? 1 },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      uUseRotation: { value: r.colors?._Rotation ? 1 : 0 },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
      uHasSpec: { value: specOn },
      uEnvRefl: { value: 0 },
      uSpecColor: { value: V3(r.colors && (r.colors._FakeSpecularColor || r.colors._EmissiveColor), new THREE.Vector3(0, 0, 0)) },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 1 }, uSpecPow: { value: f._FakeSpecularPower ?? 1 }, uSpecScale: { value: f._FakeSpecularMaskScale ?? 1 },
    },
    vertexShader: `
      uniform float uUseUv, uUseMaskUv;
      attribute vec2 uv1;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 vdW = normalize(cameraPosition - wp.xyz);
        vVdO = normalize((inverse(modelMatrix) * vec4(vdW, 0.0)).xyz);
        vNrm = normalize(normal);
        vVdW = vdW;
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vUv = mix(uv, uv1, step(0.5, uUseUv));
        vMaskUv = mix(uv, uv1, step(0.5, uUseMaskUv));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D baseTex, mask, frontMask, phaseR, phaseMask, swirl, ramp, layerMask, swirl2, ramp2, specMask;
      uniform float uHasBase, uAlpha, uDiffPow, uDiffInt, uDiff1Pow, uDiff1Int, uRepeat, uOffset, uSpeed, uInterval, uStraight;
      uniform float uHasLayerMask, uHasLayer2, uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2, uRMaskScale2, uRMaskRot2;
      uniform float uRScale, uRRot, uRMaskScale, uRMaskRot, uUseSimpleRamp, uRUVOff, uRTiltOff, uPScale, uPRot, uHasPhaseMask, uCutOut, uMaskPower;
      uniform float uCardHolo, uUseAlphaMask, uUseReflectionAlpha;
      uniform samplerCube envCube; uniform float uFrameHolo, uHasEnv, uBaseInt, uRemoveMetallic, uShininess, uSpecularIntensity;
      uniform vec3 uRotation; uniform float uUseRotation;
      uniform float uHasSpec, uSpecInt, uSpecPow, uSpecScale, uEnvRefl; uniform vec3 uSpecColor;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      void main() {
        vec4 maskSample = texture2D(mask, vMaskUv);
        float coverage = maskSample.r;
        float alphaCoverage = mix(maskSample.r, maskSample.a, step(0.5, uUseAlphaMask));
        if (coverage < uCutOut) discard;
        vec4 base = texture2D(baseTex, vMaskUv) * uHasBase;   // overlay-only layer (no _BaseTex) → base = 0
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 rotN = rotateXYZ(normalize(vNrmW), uRotation);
        vec3 rotCam = rotateXYZ(camFwd, uRotation);
        vec3 rotView = rotateXYZ(normalize(vVdW), uRotation);
        vec3 holoN = normalize(mix(vNrm, rotN, uUseRotation));
        vec3 holoV = normalize(mix(vVdO, rotCam, uUseRotation));
        vec3 Rn = holoN * 0.5 + 0.5, Rv = holoV * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        float pr = uPRot * 0.0174533; mat2 Rp = mat2(cos(pr), -sin(pr), sin(pr), cos(pr));
        float rr = uRRot * 0.0174533; mat2 Rm = mat2(cos(rr), -sin(rr), sin(rr), cos(rr));
        vec2 puv = Rp * (vUv - 0.5) * uPScale + 0.5;     // phase coord (×_PhaseScale, rot _PhaseRotate)
        vec2 ruv = Rm * (vUv - 0.5) * uRScale + 0.5;     // swirl coord (×_RampScale, rot _RampRotate)
        vec4 ph = texture2D(phaseR, puv);
        vec2 phaseGate = mix(ph.zw, texture2D(phaseMask, puv).xy, uHasPhaseMask);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd0 = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * phaseGate;
        vec2 dd1 = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiff1Pow)) * phaseGate;
        float rawDiffraction = dd0.x + dd0.y;
        float diffraction = rawDiffraction * uDiffInt + (dd1.x + dd1.y) * uDiff1Int;
        float m = texture2D(swirl, ruv).x;
        vec2 simpleDir = vec2(cos(uRMaskRot), sin(-uRMaskRot));
        float simpleRampU = dot(simpleDir, (vUv - 0.5) * uRMaskScale) + 0.5;
        float simpleM = texture2D(swirl, vec2(simpleRampU, 0.5)).x;
        vec3 refl = reflect(-holoV, holoN);                                  // official reflection basis, rotated when _Rotation is present
        float ang = (uRRot + uRUVOff + uRTiltOff * refl.x) * 0.0174533;
        float rc = refl.x * cos(ang) - refl.y * sin(ang);
        float colorU = fract((rc * uRScale + m) * uRepeat + uOffset);      // matcap + swirl fragmentation
        float simpleColorU = clamp(fract((dot(Rn * uSpeed, Rv) - simpleM) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        colorU = mix(colorU, simpleColorU, step(0.5, uUseSimpleRamp));
        vec3 rainbow = texture2D(ramp, vec2(colorU, 0.5)).rgb;
        float ndv = clamp(dot(normalize(holoN), -normalize(holoV)), 0.0, 1.0);
        float front = texture2D(frontMask, vMaskUv).r;
        float reflectionMask = clamp(front - pow(max(ndv, 0.000001), uMaskPower) + 1.0, 0.0, 1.0);
        float A = coverage * reflectionMask;                  // _HologramMaskTex = metallic border coverage
        vec2 lm = mix(vec2(1.0, 0.0), texture2D(layerMask, vMaskUv).rg, uHasLayerMask);
        float band = clamp(m * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0) * uDiff1Int * uHasBase;
        float alphaStrength = (band + diffraction) * mix(uAlpha, 1.0, uHasBase);   // diffraction already ×intensities
        float strength = mix(alphaStrength, diffraction, uCardHolo);
        strength *= lm.r;
        float k = clamp(strength * A, 0.0, 1.0);
        vec3 holoFoil = rainbow * strength;
        vec3 holoAdd = holoFoil * A;                     // the rainbow sheen (term1)
        float rr2 = uRMaskRot2 * 0.0174533; mat2 Rm2 = mat2(cos(rr2), -sin(rr2), sin(rr2), cos(rr2));
        vec2 ruv2 = Rm2 * (vUv - 0.5) * uRMaskScale2 + 0.5;
        vec2 dd2 = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow2)) * phaseGate;
        float diffraction2 = (dd2.x + dd2.y) * uDiffInt2;
        float m2 = texture2D(swirl2, ruv2).x;
        float U2 = clamp(fract((dot(Rn * uSpeed2, Rv) - m2) * uRepeat2 + uOffset2) * (uInterval2 + 1.0) - uInterval2 * 0.5, 0.0, 1.0);
        vec3 holoAdd2 = texture2D(ramp2, vec2(U2, 0.5)).rgb * diffraction2 * A * lm.g * uHasLayer2;
        vec3 Rw = mix(reflect(-normalize(vVdW), normalize(vNrmW)), reflect(-rotView, rotN), uUseRotation);
        vec3 env = vec3(0.0);
        if (uHasEnv > 0.5) {
          env = textureCube(envCube, Rw.yzx).rgb * pow(clamp(-Rw.x, 0.0, 1.0), uShininess) * uSpecularIntensity;
        }
        vec3 litBase = base.rgb * (vec3(mix(1.0, uBaseInt, uFrameHolo)) + env);
        vec3 additiveBaseMix = litBase + holoAdd;                  // overlay-only/card-holo role
        vec3 frameLit = litBase * (1.0 - clamp(rawDiffraction * uRemoveMetallic, 0.0, 1.0)) + holoFoil;
        vec3 maskedFrameMix = base.rgb + A * (frameLit - base.rgb);
        vec3 baseMix = mix(additiveBaseMix, maskedFrameMix, uFrameHolo * uHasBase);
        vec3 outRgb = mix(holoAdd, baseMix, uHasBase);
        outRgb += holoAdd2;
        float reflectionAlpha = mix(1.0, rawDiffraction, step(0.5, uUseReflectionAlpha));
        float cardAlpha = alphaCoverage * uAlpha * reflectionMask * reflectionAlpha;
        float noBaseAlpha = clamp(alphaStrength, 0.0, 1.0) * A;
        float outA = mix(mix(noBaseAlpha, cardAlpha, uCardHolo), base.a, uHasBase);
        float envU = fract(atan(refl.y, refl.x) * 0.15915 + uOffset);   // reflection angle → ramp coord
        vec3 envRainbow = texture2D(ramp, vec2(envU, 0.5)).rgb;
        outRgb += envRainbow * uEnvRefl * A * 0.6;
        vec3 spec = vec3(0.0);
        if (uHasSpec > 0.5) {
          spec = uSpecColor * uSpecInt * pow(max(texture2D(specMask, vMaskUv).x * uSpecScale, 0.0), uSpecPow) * (0.5 + 0.5 * (1.0 - s));
        }
        outRgb += spec * base.a;                         // on the frame coverage only
        gl_FragColor = vec4(outRgb * mix(1.0, base.a, uStraight), outA);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.straight = mode === "classic-frame";
  return m;
}
defineMaterial("frameHoloClassic", {
  requires: (r, ctx) => !!(ctx.layerTexDefault(r, "_RampTex") && (ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTex(r, "_LayerMaskTex"))),
  build: (r, ctx) => frameHoloMaterial(r, ctx, "classic-frame"),
});
defineMaterial("cardHologram", {
  requires: (r, ctx) => !!(ctx.layerTexDefault(r, "_RampTex") && (ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTex(r, "_LayerMaskTex"))),
  build: (r, ctx) => frameHoloMaterial(r, ctx, "card-hologram"),
});

function exactHologramMaterial(r, ctx) {
  const exact = ctx.exactShaderPort(r);
  if (!exact) return null;
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: ctx.exactPortUniforms(r, exact, ({ slot }) => (
      slot === "_CubeMap"
        ? ctx.layerCubeDefault(r, slot)
        : ctx.layerTexDefault(r, slot)
    )),
    vertexShader: exact.vert,
    fragmentShader: exact.frag,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.userData.exactShader = r.runtimeDispatch.shaderKey;
  material.userData.officialPassRuntime = exact.manifest.official_pass_runtime;
  material.userData.officialSelector = exact.manifest.official_selector;
  material.userData.officialExecutableIdentity = exact.manifest.official_executable_identity;
  return material;
}

defineMaterial("immersiveFrame", {
  requires: (r, ctx) => !!ctx.exactShaderPort(r),
  build: exactHologramMaterial,
});

defineMaterial("shadowboxTransparentHologram", {
  requires: (r, ctx) => !!ctx.exactShaderPort(r),
  build: exactHologramMaterial,
});

defineMaterial("shadowParallaxHologram", {
  requires: (r, ctx) => !!ctx.exactShaderPort(r),
  build: exactHologramMaterial,
});

defineMaterial("shadowOpaqueHologram", {
  requires: (r, ctx) => !!ctx.exactShaderPort(r),
  build: exactHologramMaterial,
});

function frameHoloUrMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const baseName = r.textures?._BaseTex?.name;
  const exact = ctx.exactShaderPort(r);
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _13: { value: ctx.layerTexDefault(r, "_BaseTex") },
        _302: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
        _333: { value: ctx.layerCubeDefault(r) },
        _388: { value: ctx.layerTexDefault(r, "_PhaseTex") },
        _396: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
        _410: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex") },
        _570: { value: ctx.layerTexDefault(r, "_RampTex") },
        _721: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
        _RampMaskRotation: { value: f._RampMaskRotation ?? 0 },
        _RampMaskScale: { value: f._RampMaskScale ?? 1 },
        _UseSimpleRampMaskAndRotation: { value: Math.trunc(f._UseSimpleRampMaskAndRotation ?? 0) },
        _FakeSpecularMaskScale: { value: f._FakeSpecularMaskScale ?? 1 },
        _FakeSpecularIntensity: { value: f._FakeSpecularIntensity ?? 1 },
        _FakeSpecularPower: { value: f._FakeSpecularPower ?? 1 },
        _FakeSpecularCornerPower: { value: f._FakeSpecularCornerPower ?? 0 },
        _FakeSpecularNotCornerOffset: { value: f._FakeSpecularNotCornerOffset ?? 0 },
        _Shininess: { value: f._Shininess ?? 32 },
        _BaseColorIntensity: { value: f._BaseColorIntensity ?? 0.5 },
        _SpecularIntensity: { value: f._SpecularIntensity ?? 1 },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _RemoveMetalic: { value: f._RemoveMetalic ?? f._RemoveMetallic ?? 1 },
        _FakeSpecularEnabled: { value: Math.trunc(f._FakeSpecularEnabled ?? 0) },
        _FakeSpecularColor: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
        _DarknessEnabled: { value: Math.trunc(f._DarknessEnabled ?? 0) },
        _DarknessColor: { value: V3(c._DarknessColor, new THREE.Vector3(0, 0, 0)) },
        _DarknessOffset: { value: f._DarknessOffset ?? 0 },
        _EmissivePattern: { value: Math.trunc(f._EmissivePattern ?? 1) },
        _EmissiveColor: { value: V4(c._EmissiveColor, new THREE.Vector4(1, 1, 1, 1)) },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.bloomSource = true;
    m.userData.straight = true;
    m.userData.exactShader = "Frame-Holo-UR-New";
    m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exact.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return m;
  }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      baseTex: { value: ctx.layerTexDefault(r, "_BaseTex") },
      maskTex: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") },
      phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
      rampMask: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex") },
      ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
      envCube: { value: ctx.envCubeTex },
      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 },
      uShininess: { value: f._Shininess ?? 32 },
      uSpecularIntensity: { value: f._SpecularIntensity ?? 1 },
      uHasEnv: { value: (ctx.envCubeTex && r.textures?._CubeMap) ? 1 : 0 },
      uRemoveMetallic: { value: f._RemoveMetallic ?? f._RemoveMetalic ?? 1 },
      uDiffPow: { value: f._DiffractionPower ?? 64 },
      uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 },
      uSpeed: { value: f._RampSpeed ?? 1 },
      uOffset: { value: f._RampOffset ?? 0 },
      uInterval: { value: f._RampInterval ?? 0 },
      uUseSimple: { value: f._UseSimpleRampMaskAndRotation ?? 0 },
      uRampMaskRot: { value: f._RampMaskRotation ?? 0 },
      uRampMaskScale: { value: f._RampMaskScale ?? 1 },
      uSpecColor: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 1 },
      uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      uSpecScale: { value: f._FakeSpecularMaskScale ?? 1 },
      uSpecCorner: { value: f._FakeSpecularCornerPower ?? 0 },
      uSpecNotCorner: { value: f._FakeSpecularNotCornerOffset ?? 0 },
      uFakeSpecEnabled: { value: f._FakeSpecularEnabled ?? 0 },
      uDarkColor: { value: V3(c._DarknessColor, new THREE.Vector3(0, 0, 0)) },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      uDarkEnabled: { value: f._DarknessEnabled ?? 0 },
      uEmissivePattern: { value: f._EmissivePattern ?? 1 },
      uEmissiveColor: { value: V4(c._EmissiveColor, new THREE.Vector4(1, 1, 1, 1)) },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      uStraight: { value: ctx.texStraight(baseName) ? 1 : 0 },
      uBloomOnly: { value: 0 },
    },
    vertexShader: `
      uniform float uRampMaskRot, uRampMaskScale, uUseSimple;
      uniform float uSpecInt, uSpecPow, uSpecScale, uSpecCorner, uSpecNotCorner;
      varying vec2 vUv; varying vec3 vWpos; varying vec3 vNrmW; varying float vRampU; varying vec4 vSpec;
      vec4 specCoord(vec2 uv, vec3 d, float scale, float intensity, float power, float cornerPower, float notCornerOffset) {
        float cardAngle = atan(length(d.yz), d.x);
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        float cornerPulse = 0.0;
        vec2 v = normalize(-d.yz);
        float ampScale = intensity;
        if (cornerPower != 0.0 && tri != 0.0) {
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, cornerPower);
          corner = mix(notCornerOffset, 1.0, corner);
          ampScale = corner * intensity;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + scale;
        float amp = tri * ampScale * 0.5;
        float powv = tri * 0.25 + power - 0.25;
        float a = atan(v.x, v.y);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 suv = (R * (uv - 0.5)) / denom + 0.5;
        return vec4(suv, amp, powv);
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWpos = wp.xyz;
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        vec2 p = uv - 0.5;
        vec2 dir = vec2(cos(uRampMaskRot), sin(-uRampMaskRot));
        vRampU = mix(0.0, dot(dir, p * uRampMaskScale) + 0.5, step(0.5, uUseSimple));
        vec3 specDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        vSpec = specCoord(uv, specDir, uSpecScale, uSpecInt, uSpecPow, uSpecCorner, uSpecNotCorner);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D baseTex, maskTex, phase, phaseMask, rampMask, ramp, specMask;
      uniform samplerCube envCube;
      uniform float uBaseInt, uShininess, uSpecularIntensity, uHasEnv, uRemoveMetallic, uStraight;
      uniform float uDiffPow, uDiffInt, uRepeat, uSpeed, uOffset, uInterval, uUseSimple;
      uniform float uFakeSpecEnabled, uDarkOffset, uDarkEnabled, uEmissivePattern, uBloomOnly;
      uniform vec3 uSpecColor, uDarkColor, uRotation;
      uniform vec4 uEmissiveColor;
      varying vec2 vUv; varying vec3 vWpos; varying vec3 vNrmW; varying float vRampU; varying vec4 vSpec;
      ${EMISSIVE_MRT_RGB}
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      float lum(vec3 c) { return dot(c, vec3(0.298912, 0.586611, 0.114478)); }
      void main() {
        vec4 base = texture2D(baseTex, vUv);
        vec3 baseRgb = base.rgb * mix(1.0, base.a, uStraight);
        vec2 maskRg = texture2D(maskTex, vUv).rg;
        float mask = maskRg.r;
        vec3 N = normalize(vNrmW);
        vec3 V = normalize(cameraPosition - vWpos);
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 rotN = rotateXYZ(N, uRotation);
        vec3 rotView = rotateXYZ(V, uRotation);
        vec3 rotCam = rotateXYZ(camFwd, uRotation);
        vec3 R = reflect(-rotView, rotN);
        vec3 env = vec3(0.0);
        if (uHasEnv > 0.5) {
          env = textureCube(envCube, R.yzx).rgb * pow(clamp(-R.x, 0.0, 1.0), uShininess) * uSpecularIntensity;
        }
        vec3 litBase = baseRgb * (vec3(uBaseInt) + env);
        vec3 Rn = rotN * 0.5 + 0.5;
        vec3 Rv = rotCam * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec2 ph = texture2D(phase, vUv).xy;
        vec2 pm = texture2D(phaseMask, vUv).xy;
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * pm;
        float diffraction = dd.x + dd.y;
        float rmUv = texture2D(rampMask, vUv).x;
        float rmSimple = texture2D(rampMask, vec2(vRampU, 0.5)).x;
        float rm = mix(rmUv, rmSimple, step(0.5, uUseSimple));
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - rm) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 foil = texture2D(ramp, vec2(U, 0.5)).rgb * diffraction * uDiffInt;
        vec3 shaded = litBase * (1.0 - clamp(diffraction * uDiffInt * uRemoveMetallic, 0.0, 1.0)) + foil;
        vec3 color = mix(baseRgb, shaded, mask);
        float specStrength = 0.0;
        if (uFakeSpecEnabled > 0.5) {
          specStrength = pow(max(texture2D(specMask, vSpec.xy).x * vSpec.z, 0.0), vSpec.w);
        }
        vec3 spec = uSpecColor * specStrength;
        vec3 darkDir = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        float darkAngle = atan(length(darkDir.xy), darkDir.z);
        float darkWave = sin(darkAngle * 3.0);
        darkWave *= darkWave;
        float darkMix = (1.0 - clamp(lum(spec) - uDarkOffset, 0.0, 1.0)) * darkWave * step(0.5, uDarkEnabled);
        color = mix(color, color * uDarkColor, darkMix) + spec;
        vec3 emissive = emissiveMrtRgb(spec, color, uEmissivePattern, uEmissiveColor, base.a, maskRg.g);
        if (uBloomOnly > 0.5) { gl_FragColor = vec4(emissive, 1.0); return; }
        gl_FragColor = vec4(color, base.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.bloomSource = true;
  m.userData.straight = true;
  return m;
}
defineMaterial("frameHoloUR", {
  requires: (r, ctx) => !!(
    ctx.layerTexDefault(r, "_BaseTex") &&
    ctx.layerTexDefault(r, "_HologramMaskTex") &&
    ctx.layerTexDefault(r, "_PhaseTex") &&
    ctx.layerTexDefault(r, "_PhaseMaskTex") &&
    ctx.layerTexDefault(r, "_RampMaskTex") &&
    ctx.layerTexDefault(r, "_RampTex") &&
    ctx.layerTexDefault(r, "_FakeSpecularMask")
  ),
  build: frameHoloUrMaterial,
});

// ── exHolo (Transparent_Hologram_Tuning) — the EX badge + rule-banner foil. Same iridescent core as holo
// with the EX ramp/phase, MASKED by the DynamicUI canvas alpha (the _UseDynamicUI=1 banner/badge coverage).
// The EX mesh UVs are card-fraction space (== the canvas). Flat UI quad. Premultiplied over. ──
function exHoloMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const foilOnly = /EXIcon|EXRule/.test(r.go || "");
  const exact = ctx.exactShaderPort(r);
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _278: { value: ctx.layerTexDefault(r, "_RampMaskTex") },
        _332: { value: ctx.layerTexDefault(r, "_RampTex") },
        _355: { value: ctx.layerTexDefault(r, "_PhaseTex") },
        _510: { value: ctx.layerCubeDefault(r) },
        _563: { value: ctx.dynHoloTex || ctx.dynUITex },
        _596: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
        _Shininess: { value: f._Shininess ?? 32 },
        _BaseColorIntensity: { value: f._BaseColorIntensity ?? 0.5 },
        _SpecularIntensity: { value: f._SpecularIntensity ?? 1 },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _AlphaBlend: { value: f._AlphaBlend ?? 0 },
        _EmitMasking: { value: f._EmitMasking ?? 0 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = true;
    m.userData.fullFaceHolo = !foilOnly;
    m.userData.exactShader = "Transparent_Hologram_Tuning";
    m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exact.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    ctx.exHoloMats.push(m);
    return m;
  }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      dynUI: { value: ctx.dynUITex }, dynHolo: { value: ctx.dynHoloTex || ctx.dynUITex }, foilMask: { value: ctx.foilTex },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      holoMask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") }, envCube: { value: ctx.envCubeTex },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      uShin: { value: f._Shininess ?? 32 }, uSpec: { value: f._SpecularIntensity ?? 1 }, uDiffuse: { value: f._BaseColorIntensity ?? 0.5 },
      uAlphaBlend: { value: f._AlphaBlend ?? 0 }, uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 }, uHasMask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") ? 1 : 0 },
      uFoilOnly: { value: foilOnly ? 1 : 0 },
      uRot: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: VIEW_BASIS_WORLD_VS,
    fragmentShader: `
      uniform sampler2D dynUI, dynHolo, foilMask, phase, rampMask, ramp, holoMask;
      uniform samplerCube envCube;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uShin, uSpec, uDiffuse, uAlphaBlend, uHasEnv, uHasMask, uFoilOnly;
      uniform vec3 uRot;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      vec3 rx(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }
      vec3 ry(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
      vec3 rz(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(c*p.x-s*p.y, s*p.x+c*p.y, p.z); }
      vec3 rotateView(vec3 p) {
        vec3 r = -uRot * 0.01745329238474369;
        return rz(ry(rx(p, r.x), r.y), r.z);
      }
      void main() {
        vec4 ui = texture2D(dynHolo, vUv);            // game RT semantics: .a = 1 - DynamicUI coverage
        float uiCoverage = 1.0 - ui.a;
        float exMask = texture2D(foilMask, vUv).a;     // ex glyph + rule banner coverage
        float m = mix(uiCoverage, exMask, uFoilOnly);  // EX layers use ex-only mask; trainer/goods UI holo uses DynamicUI
        vec3 rotN = rotateView(normalize(vNrmW));
        vec3 rotCam = rotateView(normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2])));
        vec3 rotView = rotateView(normalize(vVdW));
        vec3 Rn = rotN * 0.5 + 0.5, Rv = rotCam * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec4 ph = texture2D(phase, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = 1.0 - min(abs(vec2(s) - pc), vec2(1.0));
        dd = pow(dd, vec2(uDiffPow)) * ph.zw;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - texture2D(rampMask, vUv).x) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 rainbow = texture2D(ramp, vec2(U, 0.5)).rgb * diffraction * uDiffInt;
        vec3 base = clamp(ui.rgb / vec3(max(uiCoverage, 0.0001)), 0.0, 1.0);
        vec3 R = reflect(-rotView, rotN);
        vec3 env = vec3(0.0);
        if (uHasEnv > 0.5) env = textureCube(envCube, R.yzx).rgb;
        float spec = pow(clamp(-R.x, 0.0, 1.0), uShin) * uSpec;
        vec3 litBase = base * (env * spec + vec3(uDiffuse));
        vec3 shaded = litBase * (1.0 - uAlphaBlend * diffraction) + rainbow;
        float hm = mix(1.0, texture2D(holoMask, vUv).r, uHasMask);
        vec3 outc = mix(base, shaded, hm);
        gl_FragColor = vec4(outc, m);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.straight = true;
  m.userData.fullFaceHolo = !foilOnly;
  ctx.exHoloMats.push(m);                              // keep ref for the language switch (rebuilds dynUI/foil)
  return m;
}
defineMaterial("exHolo", {
  requires: (r, ctx) => !!(ctx.dynUITex && ctx.dynHoloTex && ctx.foilTex && ctx.layerTexDefault(r, "_PhaseTex") && ctx.layerTexDefault(r, "_RampMaskTex") && ctx.layerTexDefault(r, "_RampTex")),
  build: exHoloMaterial,
});

function exHoloUrMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const exact = ctx.exactShaderPort(r);
  if (exact) {
    const manifest = exact.manifest;
    const uniforms = ctx.exactPortUniforms(r, exact, ({ slot }) => {
      if (slot === "_DynamicUITex") return ctx.dynHoloTex || ctx.dynUITex;
      if (slot === "_CubeMap") return ctx.layerCubeDefault(r);
      return ctx.layerTexDefault(r, slot);
    });
    const m = new THREE.RawShaderMaterial({
      uniforms,
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = true;
    m.userData.exactShader = "Transparent-UR-New";
    m.userData.officialPassRuntime = manifest.official_pass_runtime || null;
    m.userData.officialSelector = manifest.official_selector || null;
    m.userData.officialExecutableIdentity = manifest.official_executable_identity || null;
    ctx.exHoloMats.push(m);
    return m;
  }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      dynHolo: { value: ctx.dynHoloTex || ctx.dynUITex },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
      rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      holoMask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") }, envCube: { value: ctx.envCubeTex },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
      uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
      uHasSpec: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") ? 1 : 0 },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      uShin: { value: f._Shininess ?? 32 }, uSpecularIntensity: { value: f._SpecularIntensity ?? 1 }, uDiffuse: { value: f._BaseColorIntensity ?? 0.5 },
      uSpecColor: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uDarkColor: { value: V3(c._DarknessColor, new THREE.Vector3(0, 0, 0)) },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 1 }, uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      uSpecScale: { value: f._FakeSpecularMaskScale ?? 1 }, uSpecCorner: { value: f._FakeSpecularCornerPower ?? 0 }, uSpecNotCorner: { value: f._FakeSpecularNotCornerOffset ?? 0 },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: `
      uniform float uSpecInt, uSpecPow, uSpecScale, uSpecCorner, uSpecNotCorner;
      varying vec2 vUv; varying vec3 vVdW; varying vec3 vNrmW; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vDarkDir; varying vec4 vSpec;
      vec4 specCoord(vec2 uv, vec3 d, float scale, float intensity, float power, float cornerPower, float notCornerOffset) {
        float cardAngle = atan(length(d.yz), d.x);
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        vec2 v = normalize(-d.yz);
        float ampScale = intensity;
        float cornerPulse = 0.0;
        if (cornerPower != 0.0 && tri != 0.0) {
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, cornerPower);
          corner = mix(notCornerOffset, 1.0, corner);
          ampScale = corner * intensity;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + scale;
        float amp = tri * ampScale * 0.5;
        float powv = tri * 0.25 + power - 0.25;
        float a = atan(v.x, v.y);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 suv = (R * (uv - 0.5)) / denom + 0.5;
        return vec4(suv, amp, powv);
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vVdW = normalize(cameraPosition - wp.xyz);
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vVdO = normalize((inverse(modelMatrix) * vec4(vVdW, 0.0)).xyz);
        vNrm = normalize(normal);
        vDarkDir = normalize(-modelMatrix[2].xyz);
        vUv = uv;
        vec3 specDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        vSpec = specCoord(uv, specDir, uSpecScale, uSpecInt, uSpecPow, uSpecCorner, uSpecNotCorner);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D dynHolo, phase, phaseMask, rampMask, ramp, holoMask, specMask;
      uniform samplerCube envCube;
      uniform float uHasEnv, uHasSpec, uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uShin, uSpecularIntensity, uDiffuse, uDarkOffset;
      uniform vec3 uSpecColor, uDarkColor, uRotation;
      varying vec2 vUv; varying vec3 vVdW; varying vec3 vNrmW; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vDarkDir; varying vec4 vSpec;
      float lum(vec3 c) { return dot(c, vec3(0.298912, 0.586611, 0.114478)); }
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      void main() {
        vec4 ui = texture2D(dynHolo, vUv);
        float uiCoverage = 1.0 - ui.a;
        float m = uiCoverage;
        vec3 base = clamp(ui.rgb / vec3(max(uiCoverage, 0.0001)), 0.0, 1.0);
        vec4 ph = texture2D(phase, vUv);
        vec2 pm = texture2D(phaseMask, vUv).xy;
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 rotN = rotateXYZ(normalize(vNrmW), uRotation);
        vec3 rotCam = rotateXYZ(camFwd, uRotation);
        vec3 rotView = rotateXYZ(normalize(vVdW), uRotation);
        vec3 Rn = rotN * 0.5 + 0.5;
        vec3 Rv = rotCam * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * pm;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - texture2D(rampMask, vUv).x) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 rainbow = texture2D(ramp, vec2(U, 0.5)).rgb * diffraction * uDiffInt;
        vec3 R = reflect(-rotView, rotN);
        vec3 env = vec3(0.0);
        if (uHasEnv > 0.5) {
          env = textureCube(envCube, R.yzx).rgb * pow(clamp(-R.x, 0.0, 1.0), uShin) * uSpecularIntensity;
        }
        vec3 shaded = base * (vec3(uDiffuse) + env) + rainbow;
        float hm = texture2D(holoMask, vUv).r;
        vec3 color = mix(base, shaded, hm);
        float specStrength = 0.0;
        if (uHasSpec > 0.5) {
          specStrength = pow(max(texture2D(specMask, vSpec.xy).x * vSpec.z, 0.0), vSpec.w);
        }
        vec3 spec = uSpecColor * specStrength;
        vec3 darkDir = normalize(vDarkDir);
        float darkAngle = atan(length(darkDir.xy), darkDir.z);
        float darkWave = sin(darkAngle * 3.0);
        darkWave *= darkWave;
        float darkMix = (1.0 - clamp(lum(spec) - uDarkOffset, 0.0, 1.0)) * darkWave;
        color = mix(color, color * uDarkColor, darkMix) + spec;
        gl_FragColor = vec4(color, m);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.straight = true;
  ctx.exHoloMats.push(m);
  return m;
}
defineMaterial("exHoloUR", {
  requires: (_r, ctx) => !!(ctx.dynUITex && ctx.dynHoloTex),
  build: exHoloUrMaterial,
});

// ── rarity (Opaque_Hologram_Tuning) — BYTE-TRACED from raredia_frag.spv. The holographic rarity diamond:
//   out.rgb = MainTex.rgb·_BaseColorIntensity + holo ;  out.a = MainTex.a (diamond shape via alpha cutout). ──
function rarityMaterial(r, ctx) {
  const f = r.floats || {};
  const rot = r.colors?._Rotation || { r: 0, g: 0, b: 0 };
  const exact = ctx.exactShaderPort(r);
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: ctx.exactPortUniforms(r, exact, (binding) => (
        binding.slot === "_CubeMap"
          ? ctx.layerCubeDefault(r, binding.slot)
          : ctx.layerTexDefault(r, binding.slot)
      )),
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Opaque_Hologram_Tuning";
    m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exact.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return m;
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: ctx.layerTex(r, "_MainTex") }, envCube: { value: ctx.envCubeTex },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 }, uShin: { value: f._Shininess ?? 32 }, uSpec: { value: f._SpecularIntensity ?? 1 },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uSpeed: { value: f._RampSpeed ?? 1 }, uOffset: { value: f._RampOffset ?? 0 }, uInterval: { value: f._RampInterval ?? 0 },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: VIEW_BASIS_WORLD_VS,
    fragmentShader: `
      uniform sampler2D mainTex, phase, rampMask, ramp;
      uniform samplerCube envCube;
      uniform float uBaseInt, uShin, uSpec, uDiffPow, uDiffInt, uRepeat, uSpeed, uOffset, uInterval;
      uniform vec3 uRotation;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      void main() {
        vec4 T0 = texture2D(mainTex, vUv);
        if (T0.a < 0.5) discard;                       // diamond shape from MainTex alpha
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 Rn = rotateXYZ(normalize(vNrmW), uRotation) * 0.5 + 0.5;
        vec3 Rv = rotateXYZ(camFwd, uRotation) * 0.5 + 0.5;
        vec4 ph = texture2D(phase, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        float s = dot(Rn.xy, Rv.xy);
        vec2 dd = 1.0 - min(abs(vec2(s) - pc), vec2(1.0));
        dd = pow(dd, vec2(uDiffPow)) * ph.zw;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - texture2D(rampMask, vUv).x) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 holo = diffraction * texture2D(ramp, vec2(U, 0.5)).rgb * uDiffInt;
        gl_FragColor = vec4(T0.rgb * uBaseInt + holo, T0.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
defineMaterial("rarity", {
  requires: (r, ctx) => !!(ctx.layerTex(r, "_MainTex") && ctx.layerTexDefault(r, "_PhaseTex") && ctx.layerTexDefault(r, "_RampMaskTex") && ctx.layerTexDefault(r, "_RampTex")),
  build: rarityMaterial,
});

// ── sbHolo (Simple-Opaque-Hologram_Tuning / Opaque-Hologram_Tuning / Opaque-UR-Oklab) — the AM ShadowBox
// body PLUS a holographic shimmer gated by _HologramMaskTex (sbholo_frag.spv, NAMED uniforms). Optional 2nd
// holo layer (_Hologram2Enabled, split by _NormalMap.x), a gold OUTLINE rim (fake-spec), and an env-cube
// reflection (the frag really samples a samplerCube). base = _MainTex AM (opaque cutout via alpha). ──
function sbHoloMaterial(r, ctx, mode) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const exactSimple = mode === "simple" ? ctx.exactShaderPort(r) : null;
  if (exactSimple) {
    const uniforms = ctx.exactPortUniforms(
      r,
      exactSimple,
      ({ slot }) => ctx.layerTexDefault(r, slot),
    );
    const m = new THREE.RawShaderMaterial({
      uniforms,
      vertexShader: exactSimple.vert,
      fragmentShader: exactSimple.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Simple-Opaque-Hologram_Tuning";
    m.userData.officialPassRuntime = exactSimple.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exactSimple.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exactSimple.manifest?.official_executable_identity || null;
    return m;
  }
  const exactUr = mode === "ur-oklab" ? ctx.exactShaderPort(r) : null;
  if (exactUr) {
    const manifest = exactUr.manifest;
    const uniforms = ctx.exactPortUniforms(r, exactUr, ({ slot }) => {
      if (slot === "_CubeMap") return ctx.layerCubeDefault(r);
      if (slot === "_MainTex" || slot === "_RampTex" || slot === "_RampTex2") {
        return ctx.layerTexNoColorSpace(r, slot) || ctx.layerTexDefault(r, slot);
      }
      return ctx.layerTexDefault(r, slot);
    });
    const m = new THREE.RawShaderMaterial({
      uniforms,
      vertexShader: exactUr.vert,
      fragmentShader: exactUr.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.bloomSource = true;
    m.userData.exactShader = manifest.shader || r.shader;
    m.userData.officialPassRuntime = manifest.official_pass_runtime || null;
    m.userData.officialSelector = manifest.official_selector || null;
    m.userData.officialExecutableIdentity = manifest.official_executable_identity || null;
    return m;
  }
  const exactClassic = mode === "trainer" ? ctx.exactShaderPort(r) : null;
  if (exactClassic) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _624: { value: ctx.layerTex(r, "_MainTex") },
        _62: { value: ctx.layerTexDefault(r, "_MaskTex") },
        _13: { value: ctx.layerTexDefault(r, "_NormalMap") },
        _352: { value: ctx.layerCubeDefault(r) },
        _532: { value: ctx.layerTexDefault(r, "_PhaseTex") },
        _609: { value: ctx.layerTexDefault(r, "_RampTex") },
        _742: { value: ctx.layerTexDefault(r, "_PhaseTex2") },
        _685: { value: ctx.layerTexDefault(r, "_RampMaskTex2") },
        _731: { value: ctx.layerTexDefault(r, "_RampTex2") },
        _DiffuseIntensity: { value: f._DiffuseIntensity ?? 0.5 },
        _Shininess: { value: f._Shininess ?? 32 },
        _SpecularIntensity: { value: f._SpecularIntensity ?? 1 },
        _DiffractionPower: { value: f._DiffractionPower ?? 32 },
        _OrientationU: { value: f._OrientationU ?? 1 },
        _OrientationV: { value: f._OrientationV ?? 1 },
        _ChangeSpeed: { value: f._ChangeSpeed ?? 3 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _UsePositionAsUV: { value: Math.trunc(f._UsePositionAsUV ?? 0) },
        _UseOutlineNormalFilter: { value: Math.trunc(f._UseOutlineNormalFilter ?? 0) },
        _OutlineNormalFilterThreshold: { value: f._OutlineNormalFilterThreshold ?? 0.05000000074505806 },
        _DiffractionIntensity2: { value: f._DiffractionIntensity2 ?? 0.5 },
        _DiffractionPower2: { value: f._DiffractionPower2 ?? 64 },
        _RampRepeat2: { value: f._RampRepeat2 ?? 2 },
        _RampSpeed2: { value: f._RampSpeed2 ?? 1 },
        _RampOffset2: { value: f._RampOffset2 ?? 0 },
        _RampInterval2: { value: f._RampInterval2 ?? 0 },
        _OutlineColor: { value: V3(c._OutlineColor, new THREE.Vector3(0, 0, 0)) },
        _TiltEnabled: { value: Math.trunc(f._TiltEnabled ?? 0) },
        _TiltPower: { value: f._TiltPower ?? 2 },
        _TiltOffset: { value: f._TiltOffset ?? 0 },
        _TiltIntensity: { value: f._TiltIntensity ?? 1 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exactClassic.vert,
      fragmentShader: exactClassic.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Opaque-Hologram_Tuning";
    m.userData.officialPassRuntime = exactClassic.manifest?.official_pass_runtime || null;
    m.userData.officialSelector = exactClassic.manifest?.official_selector || null;
    m.userData.officialExecutableIdentity = exactClassic.manifest?.official_executable_identity || null;
    return m;
  }
  const mainTex = mode === "ur-oklab" ? ctx.layerTexNoColorSpace(r, "_MainTex") : ctx.layerTex(r, "_MainTex");
  const rampTex1 = mode === "ur-oklab" ? ctx.layerTexNoColorSpace(r, "_RampTex") : ctx.layerTexDefault(r, "_RampTex");
  const rampTex2 = mode === "ur-oklab" ? ctx.layerTexNoColorSpace(r, "_RampTex2") : ctx.layerTexDefault(r, "_RampTex2");
  const hasMaskTex = !!(ctx.layerTex(r, "_HologramMaskTex") || ctx.layerTex(r, "_MaskTex"));
  const hasSecondHoloTex = !!(ctx.layerTex(r, "_PhaseTex2") && ctx.layerTex(r, "_RampMaskTex2") && ctx.layerTex(r, "_RampTex2"));
  const dualHolo = mode === "ur-oklab" ? (f._Hologram2Enabled ? 1 : 0) : (hasSecondHoloTex ? 1 : 0);
  // Official Opaque-Hologram_Tuning bytecode does not read _DiffractionIntensity; its primary
  // diffraction path is effectively intensity 1. Other sbHolo family shaders still use the field.
  const primaryDiffInt = mode === "trainer" ? 1 : (f._DiffractionIntensity ?? 0.5);
  return new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: mainTex }, mask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTexDefault(r, "_MaskTex") },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") || ctx.layerTexDefault(r, "_RampMaskTex2") }, ramp: { value: rampTex1 },
      phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") || ctx.layerTexDefault(r, "_PhaseTex") },
      uHasPhaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") ? 1 : 0 },
      uDiffPow: { value: f._DiffractionPower ?? (mode === "trainer" ? 32 : 64) }, uDiffInt: { value: primaryDiffInt },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? f._ChangeSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      uUseMask: { value: hasMaskTex ? 1 : 0 },
      uSimpleHolo: { value: mode === "simple" ? 1 : 0 },
      uHoloAlphaBlend: { value: mode === "simple" && (f._UseHoloAlphaBlend ?? 0) ? (f._HoloAlphaBlend ?? 0) : 0 },
      uSrSB: { value: mode === "trainer" ? 1 : 0 },
      uOrient: { value: new THREE.Vector2(f._OrientationU ?? 1, f._OrientationV ?? 1) },
      uTiltEnabled: { value: f._TiltEnabled ?? (mode === "simple" ? 1 : 0) },
      uTiltPow: { value: f._TiltPower ?? 2 },
      uTiltOffset: { value: f._TiltOffset ?? 0 },
      uTiltInt: { value: f._TiltIntensity ?? 1 },
      uDual: { value: dualHolo },
      normalMap: { value: ctx.layerTexDefault(r, "_NormalMap") || ctx.layerTexDefault(r, "_NormalMap2") },
      uHasNM: { value: (ctx.layerTexDefault(r, "_NormalMap") || ctx.layerTexDefault(r, "_NormalMap2")) ? 1 : 0 },
      phase2: { value: ctx.layerTexDefault(r, "_PhaseTex2") }, ramp2: { value: rampTex2 }, rampMask2: { value: ctx.layerTexDefault(r, "_RampMaskTex2") },
      uDiffPow2: { value: f._DiffractionPower2 ?? 64 }, uDiffInt2: { value: f._DiffractionIntensity2 ?? 0.5 },
      uRepeat2: { value: f._RampRepeat2 ?? 2 }, uOffset2: { value: f._RampOffset2 ?? 0 }, uSpeed2: { value: f._RampSpeed2 ?? 1 }, uInterval2: { value: f._RampInterval2 ?? 0 },
      uOutColor: { value: V3(r.colors && r.colors._FakeSpecularColor_Outline, new THREE.Vector3(0, 0, 0)) },
      uSpecColor: { value: V3(r.colors && r.colors._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uDarkColor: { value: V3(r.colors && r.colors._DarknessColor, new THREE.Vector3(0, 0, 0)) },
      uReflectionColor: { value: V3(r.colors && r.colors._ReflectionColor, new THREE.Vector3(0, 0, 0)) },
      uMaskColor: { value: V3(r.colors && r.colors._OutlineColor, new THREE.Vector3(0, 0, 0)) },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") || ctx.layerTexDefault(r, "_HologramMaskTex") || ctx.layerTexDefault(r, "_MaskTex") },
      uHasSpec: { value: hasFakeSpec(r, ctx) },
      uUseOklab: { value: mode === "ur-oklab" ? 1 : 0 },
      uTiltInt2: { value: f._TiltIntensity2 ?? 1 },
      uTilt: { value: f._Tilt ?? 0 },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 1 },
      uSpecScale: { value: f._FakeSpecularMaskScale ?? 1 },
      uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      uOutInt: { value: f._FakeSpecularEnabled ? (f._FakeSpecularIntensity_Outline ?? 1) : 0 },
      uOutCorner: { value: f._FakeSpecularCornerPower ?? 0 }, uOutScale: { value: f._FakeSpecularMaskScale_Outline ?? 1 }, uOutPow: { value: f._FakeSpecularPower_Outline ?? 1 },
      uSpecNotCorner: { value: f._FakeSpecularNotCornerOffset ?? 0 },
      uRemoveBase: { value: f._RemoveBase ?? 0 },
      uBaseInt: { value: f._BaseColorIntensity ?? f._DiffuseIntensity ?? 0.5 },
      uShininess: { value: f._Shininess ?? 32 },
      uEnvSpec: { value: f._SpecularIntensity ?? 1 },
      uTiltPow2: { value: f._TiltPower2 ?? 2 },
      uTiltOffset2: { value: f._TiltOffset2 ?? 0 },
      envCube: { value: ctx.envCubeTex },
      uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
      reflectionMask: { value: ctx.layerTexDefault(r, "_ReflectionMask") },
      uReflInt: { value: f._ReflectionIntensity ?? 1 }, uReflPow: { value: f._ReflectionPower ?? 0 },
      uReflCenter: { value: f._ReflectionCenterAdjust ?? 0.4 },
      uRefTiltEnabled: { value: f._RefTiltEnabled ?? 1 },
      uRefTiltPow: { value: f._RefTiltPower ?? 2 },
      uRefTiltOffset: { value: f._RefTiltOffset ?? 0 },
      uRefTiltInt: { value: f._RefTiltIntensity ?? 1 },
      uHasRefl: { value: f._ReflectionEnabled ? 1 : 0 },
      uHasReflMask: { value: ctx.layerTexDefault(r, "_ReflectionMask") ? 1 : 0 },
      uUsePosUv: { value: f._UsePositionAsUV ? 1 : 0 },
      uUseTangentNormal: { value: mode === "trainer" ? 1 : 0 },
      uUseOutlineNormalFilter: { value: f._UseOutlineNormalFilter ?? 0 },
      uOutlineNormalFilterThreshold: { value: f._OutlineNormalFilterThreshold ?? 0.05000000074505806 },
      uEmissiveColor: { value: V4(c._EmissiveColor, new THREE.Vector4(1, 1, 1, 1)) },
      uBloomOnly: { value: 0 },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: `
      uniform float uSpecScale, uSpecInt, uSpecPow, uOutScale, uOutInt, uOutPow, uOutCorner, uSpecNotCorner;
      uniform float uUsePosUv, uReflCenter;
      attribute vec4 tangent;
      varying vec2 vUv; varying vec2 vPosUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      varying vec3 vTanW; varying vec3 vBitanW; varying vec4 vSpec1; varying vec4 vSpec2; varying vec3 vReflAxis;

      vec4 specCoord(vec2 uv, vec3 vdO, float scale, float intensity, float power, float cornerPower, float notCornerOffset) {
        float cardAngle = atan(length(vdO.xy), abs(vdO.z));
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        float cornerPulse = 0.0;
        if (cornerPower != 0.0 && tri != 0.0) {
          vec2 v = normalize(-vdO.xy);
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, cornerPower);
          corner = mix(notCornerOffset, 1.0, corner);
          tri *= corner;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + scale;
        float amp = tri * intensity * 0.5;
        float powv = max(tri * 0.25 + power - 0.25, 0.0001);
        float a = atan(-vdO.y, -vdO.x);
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 suv = (R * (uv - 0.5)) / denom + 0.5;
        return vec4(suv, amp, powv);
      }

      vec4 specCoordOklab(vec2 uv, vec3 d, float scale, float intensity, float power, float cornerPower, float notCornerOffset) {
        float cardAngle = atan(length(d.yz), d.x);
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        vec2 v = normalize(-d.yz);
        float cornerPulse = 0.0;
        float ampScale = intensity;
        if (cornerPower != 0.0 && tri != 0.0) {
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, cornerPower);
          corner = mix(notCornerOffset, 1.0, corner);
          ampScale = corner * intensity;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + scale;
        float amp = tri * ampScale * 0.5;
        float powv = tri * 0.25 + power - 0.25;
        float a = atan(v.x, v.y);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 suv = (R * (uv - 0.5)) / denom + 0.5;
        return vec4(suv, amp, powv);
      }
      vec3 safeNormalize(vec3 v, vec3 fallback) {
        float l2 = dot(v, v);
        return l2 > 0.00000001 ? v * inversesqrt(l2) : fallback;
      }

      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 vdW = safeNormalize(cameraPosition - wp.xyz, vec3(0.0, 0.0, 1.0));
        vVdW = vdW;
        vNrmW = safeNormalize(mat3(modelMatrix) * normal, vec3(0.0, 0.0, 1.0));
        vTanW = safeNormalize(mat3(modelMatrix) * tangent.xyz, vec3(1.0, 0.0, 0.0));
        vBitanW = safeNormalize(cross(vNrmW, vTanW) * tangent.w, vec3(0.0, 1.0, 0.0));
        vVdO = safeNormalize((inverse(modelMatrix) * vec4(vdW, 0.0)).xyz, vec3(0.0, 0.0, 1.0));
        vNrm = safeNormalize(normal, vec3(0.0, 0.0, 1.0));
        vUv = uv;
        vPosUv = position.xy * vec2(1.2698411942, 0.9090908766) + vec2(0.5);
        vec2 specUv = mix(uv, vPosUv, uUsePosUv);
        vec2 reflCenter = normalize(vec2(uReflCenter, -1.0));
        vReflAxis = safeNormalize(modelMatrix[1].xyz * reflCenter.x + modelMatrix[2].xyz * reflCenter.y, vec3(0.0, 0.0, 1.0));
        vec3 oklabSpecDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        if (uUsePosUv > 0.5) {
          vSpec1 = specCoordOklab(specUv, oklabSpecDir, uOutScale, uOutInt, uOutPow, uOutCorner, uSpecNotCorner);
          vSpec2 = specCoordOklab(specUv, oklabSpecDir, uSpecScale, uSpecInt, uSpecPow, uSpecPow, uSpecNotCorner);
        } else {
          vSpec1 = specCoord(specUv, vVdO, uOutScale, uOutInt, uOutPow, uOutCorner, uSpecNotCorner);
          vSpec2 = specCoord(specUv, vVdO, uSpecScale, uSpecInt, uSpecPow, uSpecPow, uSpecNotCorner);
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D mainTex, mask, phase, phaseMask, rampMask, ramp, phase2, ramp2, rampMask2, normalMap, specMask;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uUseMask, uSimpleHolo, uHoloAlphaBlend, uSrSB, uDual, uHasNM, uHasPhaseMask;
      uniform float uTiltEnabled, uTiltPow, uTiltOffset, uTiltInt;
      uniform vec2 uOrient;
      uniform float uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2;
      uniform vec3 uOutColor, uSpecColor, uDarkColor, uReflectionColor, uMaskColor; uniform float uHasSpec, uUseOklab, uTiltInt2, uTilt, uDarkOffset, uRemoveBase, uBloomOnly;
      uniform vec4 uEmissiveColor;
      uniform float uBaseInt, uShininess, uEnvSpec, uTiltPow2, uTiltOffset2;
      uniform sampler2D reflectionMask;
      uniform samplerCube envCube; uniform float uReflInt, uReflPow, uReflCenter, uRefTiltEnabled, uRefTiltPow, uRefTiltOffset, uRefTiltInt, uHasRefl, uHasReflMask;
      uniform float uHasEnv, uUsePosUv, uUseTangentNormal, uUseOutlineNormalFilter, uOutlineNormalFilterThreshold;
      uniform vec3 uRotation;
      varying vec2 vUv; varying vec2 vPosUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      varying vec3 vTanW; varying vec3 vBitanW; varying vec4 vSpec1; varying vec4 vSpec2; varying vec3 vReflAxis;
      vec3 rotateXYZ(vec3 v, vec3 deg) {
        vec3 r = deg * -0.01745329238474369;
        float cx = cos(r.x), sx = sin(r.x);
        float cy = cos(r.y), sy = sin(r.y);
        float cz = cos(r.z), sz = sin(r.z);
        v.yz = vec2(cx * v.y - sx * v.z, sx * v.y + cx * v.z);
        v.xz = vec2(cy * v.x + sy * v.z, -sy * v.x + cy * v.z);
        v.xy = vec2(cz * v.x - sz * v.y, sz * v.x + cz * v.y);
        return v;
      }
      vec3 safeNormalize(vec3 v, vec3 fallback) {
        float l2 = dot(v, v);
        return l2 > 0.00000001 ? v * inversesqrt(l2) : fallback;
      }
      vec3 srgbToLinear(vec3 c) {
        vec3 lo = c * 0.0773993805;
        vec3 hi = pow(max((c + 0.055) * 0.9478673339, vec3(0.0)), vec3(2.4000000954));
        return mix(lo, hi, step(vec3(0.0404499993), c));
      }
      vec3 linearToSrgb(vec3 c) {
        c = max(c, vec3(0.0));
        vec3 lo = c * 12.9200000763;
        vec3 hi = pow(c, vec3(0.4166666567)) * 1.0549999475 - 0.055;
        return mix(lo, hi, step(vec3(0.0031308001), c));
      }
      vec3 linearToOklab(vec3 c) {
        c = max(c, vec3(0.0));
        vec3 lms = vec3(
          dot(c, vec3(0.4121656120, 0.5362752080, 0.0514575653)),
          dot(c, vec3(0.2118591070, 0.6807189584, 0.1074065790)),
          dot(c, vec3(0.0883097947, 0.2818474174, 0.6302613616))
        );
        lms = pow(max(lms, vec3(0.0)), vec3(0.3333333433));
        return vec3(
          dot(lms, vec3(0.2104542553, 0.7936177850, 0.0040720468)),
          dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
          dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660))
        );
      }
      vec3 oklabToLinear(vec3 c) {
        vec3 lms = vec3(
          dot(c, vec3(1.0, 0.3963377774, 0.2158037573)),
          dot(c, vec3(1.0, -0.1055613458, -0.0638541728)),
          dot(c, vec3(1.0, -0.0894841775, -1.2914855480))
        );
        lms = lms * lms * lms;
        return vec3(
          dot(lms, vec3(4.0767416954, -3.3077116013, 0.2309699357)),
          dot(lms, vec3(-1.2684379816, 2.6097574234, -0.3413193822)),
          dot(lms, vec3(-0.0041960864, -0.7034186125, 1.7076146603))
        );
      }
      vec4 holoLayer(vec2 uvS, sampler2D phaseT, sampler2D phaseMaskT, sampler2D rampT, sampler2D rampMaskT, float diffPow, float diffInt,
                     float repeat, float offset, float speed, float interval, vec3 Rn, vec3 Rv, float s) {
        vec4 ph = texture2D(phaseT, uvS);
        vec2 phMask = mix(ph.zw, texture2D(phaseMaskT, uvS).xy, uHasPhaseMask);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(diffPow)) * phMask;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * speed, Rv) - texture2D(rampMaskT, uvS).x) * repeat + offset) * (interval + 1.0) - interval * 0.5, 0.0, 1.0);
        float energy = diffraction * diffInt;
        return vec4(texture2D(rampT, vec2(U, 0.5)).rgb * energy, energy);
      }
      vec4 srSecondLayer(vec2 uvS, vec3 geomN, vec3 camFwd, sampler2D phaseT, sampler2D rampT, sampler2D rampMaskT,
                         float diffPow, float diffInt, float repeat, float offset, float speed, float interval) {
        vec3 Nh = normalize(geomN) * 0.5 + 0.5;
        vec3 Vh = normalize(camFwd) * 0.5 + 0.5;
        float U = dot(Nh * speed, Vh) - texture2D(rampMaskT, uvS).x;
        U = fract(U * repeat + offset);
        U = clamp(U * (interval + 1.0) - interval * 0.5, 0.0, 1.0);
        vec4 ph = texture2D(phaseT, uvS);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        float nDotV = dot(Nh.xy, Vh.xy);
        vec2 dd = pow(1.0 - min(abs(vec2(nDotV) - pc), vec2(1.0)), vec2(diffPow)) * ph.zw;
        float energy = (dd.x + dd.y) * diffInt;
        return vec4(texture2D(rampT, vec2(U, 0.5)).rgb * energy, energy);
      }
      void main() {
        vec4 base = texture2D(mainTex, vUv);
        if (base.a < 0.5) discard;                       // AM coverage (opaque cutout)
        vec3 camFwdW = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        float maskVal = texture2D(mask, vUv).r;
        vec3 tangentN = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
        float outlineFilter = step(0.5, uUseOutlineNormalFilter) * step(uOutlineNormalFilterThreshold, maskVal);
        tangentN = safeNormalize(mix(tangentN, vec3(0.0, 0.0, 1.0), outlineFilter), vec3(0.0, 0.0, 1.0));
        vec3 tbnN = safeNormalize(vTanW * tangentN.x + vBitanW * tangentN.y + vNrmW * tangentN.z, vNrmW);
        vec3 worldN = safeNormalize(mix(vNrmW, tbnN, uUseTangentNormal), vNrmW);
        vec3 rotN = safeNormalize(rotateXYZ(worldN, uRotation), worldN);
        vec3 rotCam = safeNormalize(rotateXYZ(camFwdW, uRotation), camFwdW);
        vec3 rotView = safeNormalize(rotateXYZ(safeNormalize(vVdW, vec3(0.0, 0.0, 1.0)), uRotation), vec3(0.0, 0.0, 1.0));
        float useWorldHolo = max(uUseOklab, uUseTangentNormal);
        vec3 holoN = safeNormalize(mix(vNrm, rotN, useWorldHolo), vec3(0.0, 0.0, 1.0));
        vec3 holoV = safeNormalize(mix(vVdO, rotCam, useWorldHolo), vec3(0.0, 0.0, 1.0));
        vec3 Rn = holoN * 0.5 + 0.5, Rv = holoV * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        float tilt = 1.0 - pow(clamp(dot(rotN, -rotCam) - uTiltOffset, 0.0, 1.0), uTiltPow);
        tilt = clamp(tilt * uTiltInt, 0.0, 1.0);
        tilt = mix(1.0, tilt, step(0.5, uTiltEnabled));
        float srTilt = 1.0 - pow(clamp(dot(safeNormalize(vNrmW, vec3(0.0, 0.0, 1.0)), -camFwdW) - uTiltOffset, 0.0, 1.0), uTiltPow);
        srTilt = clamp(srTilt * uTiltInt, 0.0, 1.0);
        srTilt = mix(1.0, srTilt, step(0.5, uTiltEnabled));
        float m = mix(1.0, maskVal, uUseMask) * tilt;   // Pokemon: eyes mask gates; SR ShadowBox: HM outline mask
        float nm = mix(0.5, texture2D(normalMap, vUv).x, uHasNM);
        vec2 holoUv = mix(vUv, vPosUv, uUsePosUv);
        vec4 h1Layer = holoLayer(holoUv, phase, phaseMask, ramp, rampMask, uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, Rn, Rv, s);
        vec3 h1Raw = h1Layer.rgb;
        float h1Mask = mix(m, 1.0, uUseOklab);
        vec3 h1 = h1Raw * h1Mask;
        float h1Strength = h1Layer.a * h1Mask / max(uDiffInt, 0.000001);
        float edgePhase = texture2D(phase, holoUv).x * 0.5 + 0.25;
        float edge = pow(1.0 - min(abs(dot(Rn.xy, vec2(0.5)) - edgePhase), 1.0), uDiffPow) * maskVal;
        float edgeU = dot(holoUv, uOrient) + dot(Rn, vec3(uSpeed)) + uOffset;
        vec3 srOutline = texture2D(ramp, vec2(edgeU, 0.5)).rgb * edge;
        h1 = mix(h1, srOutline, uSrSB);
        vec4 h2Generic = holoLayer(mix(vUv, vPosUv, uUseOklab), phase2, phaseMask, ramp2, rampMask2, uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2, Rn, Rv, s);
        vec4 h2Sr = srSecondLayer(vPosUv, vNrmW, camFwdW, phase2, ramp2, rampMask2, uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2);
        h2Sr.rgb *= srTilt;
        h2Sr.a *= srTilt;
        vec4 h2Layer = mix(h2Generic, h2Sr, uSrSB);
        vec3 h2 = h2Layer.rgb;
        vec3 foilNormal = h1 * nm + h2 * (1.0 - nm);
        vec3 foilSr = h1 + h2 * (1.0 - maskVal);
        vec3 foil = mix(h1, mix(foilNormal, foilSr, uSrSB), uDual);
        vec3 spec = vec3(0.0);
        if (uHasSpec > 0.5) {
          float specOutline = pow(max(texture2D(specMask, vSpec1.xy).x * vSpec1.z, 0.0), max(vSpec1.w, 0.0001));
          float specBody = pow(max(texture2D(specMask, vSpec2.xy).x * vSpec2.z, 0.0), max(vSpec2.w, 0.0001));
          spec = uOutColor * specOutline + uSpecColor * specBody;
          if (uUseOklab > 0.5) {
            vec3 specLabOutline = linearToOklab(srgbToLinear(uOutColor)) * specOutline;
            vec3 specLabBody = linearToOklab(srgbToLinear(uSpecColor)) * specBody;
            spec = oklabToLinear(mix(specLabOutline, specLabBody, maskVal));
          }
        }
        vec3 reflRgb = vec3(0.0);
        if (uHasRefl > 0.5) {
          vec2 reflNm = texture2D(normalMap, vUv).xy * 2.0 - 1.0;
          vec2 reflCenter = normalize(vec2(uReflCenter, -1.0));
          vec3 reflAxis = safeNormalize(vReflAxis, vec3(0.0, 0.0, 1.0));
          vec2 reflDir = normalize(-reflAxis.xy + vec2(-0.002, -0.01));
          float reflMask = pow(clamp(dot(reflNm, reflDir), 0.0, 1.0), uReflPow) * uReflInt;
          float tiltGate = 1.0 - pow(clamp(dot(reflAxis, -holoV) - uRefTiltOffset, 0.0, 1.0), uRefTiltPow);
          tiltGate = clamp(tiltGate * uRefTiltInt, 0.0, 1.0);
          tiltGate = mix(1.0, tiltGate, step(0.5, uRefTiltEnabled));
          float reflTex = 1.0;
          if (uHasReflMask > 0.5) reflTex = texture2D(reflectionMask, vUv).x;
          float refl = reflMask * tiltGate * reflTex;
          vec3 reflOklab = oklabToLinear(linearToOklab(srgbToLinear(uReflectionColor)) * refl);
          reflRgb = mix(uReflectionColor * refl, reflOklab, uUseOklab);
        }
        vec3 R = mix(reflect(-vVdO, vNrm), reflect(-rotView, rotN), useWorldHolo);
        float srEnvStrength = mix(uEnvSpec, srTilt, step(0.5, uTiltEnabled));
        float envStrength = mix(uEnvSpec, srEnvStrength, uSrSB);
        float envGrazing = pow(clamp(-R.x, 0.0, 1.0), uShininess) * envStrength;
        vec3 envSpec = vec3(0.0);
        vec3 cubeCoord = mix(R.yzx, R, uSrSB);
        if (uHasEnv > 0.5) envSpec = textureCube(envCube, cubeCoord).rgb * envGrazing;
        float baseIntensity = mix(1.0, uBaseInt, maskVal);
        vec3 oklabBase = mix(base.rgb, uMaskColor, maskVal);
        vec3 lit1 = oklabBase * (baseIntensity + envSpec) + h1;
        vec3 baseOklabPath = mix(oklabBase, lit1, maskVal);
        float tilt2 = 1.0 - pow(clamp(dot(holoN, -holoV) - uTiltOffset2, 0.0, 1.0), uTiltPow2);
        tilt2 = clamp(tilt2 * uTiltInt2, 0.0, 1.0);
        float holo2Energy = h2Layer.a;
        baseOklabPath = baseOklabPath * (1.0 - holo2Energy * tilt2 * uRemoveBase) + h2 * tilt2;
        vec3 baseRgb = mix(base.rgb, mix(base.rgb, uMaskColor, maskVal), uSrSB);
        vec3 legacyBaseLit = baseRgb * (1.0 + foil);
        vec3 srBaseLit = baseRgb * (baseIntensity + envSpec) + h1 + h2 * (1.0 - maskVal);
        legacyBaseLit = mix(legacyBaseLit, srBaseLit, uSrSB);
        vec3 simpleBaseLit = baseRgb * (1.0 - h1Strength * uHoloAlphaBlend) + h1;
        legacyBaseLit = mix(legacyBaseLit, simpleBaseLit, uSimpleHolo);
        vec3 baseLit = mix(legacyBaseLit, baseOklabPath, uUseOklab);
        vec3 baseLab = linearToOklab(srgbToLinear(baseLit));
        vec3 darkLab = linearToOklab(srgbToLinear(baseLit * uDarkColor));
        vec3 specSrgb = mix(spec, linearToSrgb(spec), uUseOklab);
        float specDarkGate = specSrgb.x;
        float darkMix = (1.0 - clamp(specDarkGate - uDarkOffset, 0.0, 1.0)) * uTilt;
        vec3 baseOklab = oklabToLinear(mix(baseLab, darkLab, darkMix));
        baseLit = mix(baseLit, baseOklab, uUseOklab);
        vec3 finalColor = baseLit + spec + reflRgb;
        vec3 reflSrgb = mix(reflRgb, linearToSrgb(reflRgb), uUseOklab);
        vec3 emissive = (specSrgb * maskVal + reflSrgb) * uEmissiveColor.rgb * uUseOklab;
        if (uBloomOnly > 0.5) { gl_FragColor = vec4(emissive, 1.0); return; }
        gl_FragColor = vec4(finalColor, base.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.bloomSource = mode === "ur-oklab";
  return m;
}
defineMaterial("sbHoloSimple", {
  requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),   // AM base = the shadowbox body
  build: (r, ctx) => sbHoloMaterial(r, ctx, "simple"),
});
defineMaterial("sbHoloTrainer", {
  requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),
  build: (r, ctx) => sbHoloMaterial(r, ctx, "trainer"),
});
defineMaterial("sbHoloUr", {
  requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),
  build: (r, ctx) => sbHoloMaterial(r, ctx, "ur-oklab"),
});
