// Holographic material strategies — the view-dependent diffraction/iridescence family shared across
// rarities: window holo, RR/SR/UR frame holo, the EX-UI foil, the rarity diamond, and the ShadowBox
// hologram body. All byte-traced from the game's fragment SPIR-V (see the per-function notes).
import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { VIEW_BASIS_VS, VIEW_BASIS_WORLD_VS } from "../glsl.js";

const V3 = (c, d) => (c ? new THREE.Vector3(c.r, c.g, c.b) : d);

// ── holo (Card_Parallax_Hologram_Tuning) — BYTE-TRACED from holo_frag.spv. Diffraction sparkle from
// _PhaseTex + a rainbow _RampTex lookup, both driven by view-vs-normal; the vertex also applies the
// Card_Parallax UV offset (this is a parallax-hologram). Additive. ──
function holoMaterial(L, ctx, overOpacity = 0) {
  const f = L.floats;
  return new THREE.ShaderMaterial({
    uniforms: {
      uOver: { value: overOpacity },
      phase: { value: ctx.layerTex(L, "_PhaseTex") }, rampMask: { value: ctx.layerTex(L, "_RampMaskTex") }, ramp: { value: ctx.layerTex(L, "_RampTex") },
      holoMask: { value: ctx.layerTex(L, "_HologramMaskTex") }, uHasMask: { value: ctx.layerTex(L, "_HologramMaskTex") ? 1 : 0 },
      uHeight: { value: f._Height ?? 0 }, uHeightPower: { value: f._HeightPower ?? 0 }, uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0.19 },
      uDiffPow: { value: f._DiffractionPower ?? 1 }, uDiffInt: { value: f._DiffractionIntensity ?? 1 },
      uRepeat: { value: f._RampRepeat ?? 1 }, uOffset: { value: f._RampOffset ?? 0 }, uSpeed: { value: f._RampSpeed ?? 0 }, uInterval: { value: f._RampInterval ?? 0 },
    },
    vertexShader: `
      uniform float uHeight, uHeightPower, uScale, uFakeH;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 vdW = normalize(cameraPosition - wp.xyz);
        vVdO = normalize((inverse(modelMatrix) * vec4(vdW, 0.0)).xyz);
        vNrm = normalize(normal);
        vec2 off = (vVdO.xy / (vVdO.z * uScale + uFakeH + 0.42)) * (uHeight * uHeightPower * uScale);
        vUv = uv + off;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D phase, rampMask, ramp, holoMask;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uHasMask, uOver;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
      void main() {
        if (vUv.x<0.0||vUv.x>1.0||vUv.y<0.0||vUv.y>1.0) discard;
        vec3 Rv = vVdO * 0.5 + 0.5;          // R = identity (geometric tilt carries the angle)
        vec3 Rn = vNrm * 0.5 + 0.5;
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
        col *= mix(1.0, texture2D(holoMask, vUv).r, uHasMask);   // _HologramMaskTex region gate (1.0 if absent)
        float over = step(0.001, uOver);
        float cov = clamp(diffraction, 0.0, 1.0);
        vec3 rgbOut = mix(col, clamp(col, 0.0, 1.0), over);
        float a = mix(1.0, cov * uOver, over);
        gl_FragColor = vec4(rgbOut, a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
defineMaterial("holo", { build: (r, ctx) => holoMaterial(r, ctx) });

// ── frameHolo (Frame-Holo-Tuning + the SR/UR frame variants) — FULL SSA trace of framh_frag.spv (1219
// instrs, 7 samplers). Names stripped; UBO layout recovered from the sibling Transparent_HologramLayer.
//   out.rgb = mix(base.rgb, base·(1+foil)+cube·spec, A);  out.a = base.a ;  foil = rainbow·diffraction·_DiffInt
// One branch-free combine: the per-card _PhaseScale/_RampScale/_RampRotate knobs turn the SAME formula from
// Venusaur's subtle streaks (neutral params) into the SR dense rainbow marble (scale 15 / rotate 35.49). The
// UR fake-spec + broad rainbow-gold reflection are gated by _FakeSpecularEnabled (UR-frame-only). ──
function frameHoloMaterial(r, ctx) {
  const f = r.floats;
  const rep = (slot) => ctx.layerTexRepeat(r, slot);
  return new THREE.ShaderMaterial({
    uniforms: {
      baseTex: { value: ctx.layerTex(r, "_BaseTex") || ctx.layerTex(r, "_HologramMaskTex") }, mask: { value: ctx.layerTex(r, "_HologramMaskTex") },
      uHasBase: { value: ctx.layerTex(r, "_BaseTex") ? 1 : 0 },
      uAlpha: { value: f._AlphaBlend ?? 1 },
      phaseR: { value: rep("_PhaseTex") }, swirl: { value: rep("_RampMaskTex") }, ramp: { value: ctx.layerTex(r, "_RampTex") },
      uDiffPow: { value: f._DiffractionPower ?? 30 }, uDiffInt: { value: f._DiffractionIntensity ?? 1.2 },
      uDiff1Pow: { value: f._Layer1DiffractionPower ?? 30 }, uDiff1Int: { value: f._Layer1DiffractionIntensity ?? 0 },
      uRepeat: { value: f._RampRepeat ?? 1 }, uOffset: { value: f._RampOffset ?? -0.45 }, uSpeed: { value: f._RampSpeed ?? 3 }, uInterval: { value: f._RampInterval ?? 0 },
      uRScale: { value: f._RampScale ?? 1 }, uRRot: { value: f._RampRotate ?? 0 },
      uRUVOff: { value: f._RampUVOffset ?? 0 }, uRTiltOff: { value: f._RampUVTiltOffset ?? 0 },
      uPScale: { value: f._PhaseScale ?? 1 }, uPRot: { value: f._PhaseRotate ?? 0 },
      uStraight: { value: ctx.texStraight(r.textures?._BaseTex?.name) ? 1 : 0 },
      specMask: { value: ctx.layerTex(r, "_FakeSpecularMask") || ctx.layerTex(r, "_HologramMaskTex") },
      uHasSpec: { value: (ctx.layerTex(r, "_FakeSpecularMask") && f._FakeSpecularEnabled) ? 1 : 0 },
      uEnvRefl: { value: (f._EnvironmentReflections && f._FakeSpecularEnabled) ? 1 : 0 },
      uSpecColor: { value: V3(r.colors && r.colors._EmissiveColor, new THREE.Vector3(0.68, 0.52, 0.29)) },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 4 }, uSpecPow: { value: f._FakeSpecularPower ?? 1.3 }, uSpecScale: { value: f._FakeSpecularMaskScale ?? 0.9 },
    },
    vertexShader: VIEW_BASIS_VS,
    fragmentShader: `
      uniform sampler2D baseTex, mask, phaseR, swirl, ramp, specMask;
      uniform float uHasBase, uAlpha, uDiffPow, uDiffInt, uDiff1Pow, uDiff1Int, uRepeat, uOffset, uSpeed, uInterval, uStraight;
      uniform float uRScale, uRRot, uRUVOff, uRTiltOff, uPScale, uPRot;
      uniform float uHasSpec, uSpecInt, uSpecPow, uSpecScale, uEnvRefl; uniform vec3 uSpecColor;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
      void main() {
        vec4 base = texture2D(baseTex, vUv) * uHasBase;   // overlay-only layer (no _BaseTex) → base = 0
        vec3 Rn = vNrm * 0.5 + 0.5, Rv = vVdO * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        float pr = uPRot * 0.0174533; mat2 Rp = mat2(cos(pr), -sin(pr), sin(pr), cos(pr));
        float rr = uRRot * 0.0174533; mat2 Rm = mat2(cos(rr), -sin(rr), sin(rr), cos(rr));
        vec2 puv = Rp * (vUv - 0.5) * uPScale + 0.5;     // phase coord (×_PhaseScale, rot _PhaseRotate)
        vec2 ruv = Rm * (vUv - 0.5) * uRScale + 0.5;     // swirl coord (×_RampScale, rot _RampRotate)
        vec4 ph = texture2D(phaseR, puv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd0 = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * ph.zw;
        vec2 dd1 = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiff1Pow)) * ph.zw;
        float diffraction = (dd0.x + dd0.y) * uDiffInt + (dd1.x + dd1.y) * uDiff1Int;
        float m = texture2D(swirl, ruv).x;
        vec3 refl = reflect(-vVdO, vNrm);                                  // object-space reflection (per-pixel)
        float ang = (uRRot + uRUVOff + uRTiltOff * refl.x) * 0.0174533;
        float rc = refl.x * cos(ang) - refl.y * sin(ang);
        float colorU = fract((rc * uRScale + m) * uRepeat + uOffset);      // matcap + swirl fragmentation
        vec3 rainbow = texture2D(ramp, vec2(colorU, 0.5)).rgb;
        float A = texture2D(mask, vUv).r;                // _HologramMaskTex = metallic border coverage
        float band = clamp(m * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0) * uDiff1Int * uHasBase;
        float strength = (band + diffraction) * mix(uAlpha, 1.0, uHasBase);   // diffraction already ×intensities
        float k = clamp(strength * A, 0.0, 1.0);
        vec3 holoAdd = rainbow * strength * A;                     // the rainbow sheen (term1)
        vec3 baseMix = base.rgb + holoAdd;                          // base pattern (term0) + rainbow superimposed
        vec3 outRgb = mix(holoAdd, baseMix, uHasBase);
        float outA = mix(clamp(strength, 0.0, 1.0) * A, base.a, uHasBase);
        float envU = fract(atan(refl.y, refl.x) * 0.15915 + uOffset);   // reflection angle → ramp coord
        vec3 envRainbow = texture2D(ramp, vec2(envU, 0.5)).rgb;
        outRgb += envRainbow * uEnvRefl * A * 0.6;
        vec3 spec = uSpecColor * uSpecInt * pow(clamp(texture2D(specMask, vUv).x * uSpecScale, 0.0, 1.0), uSpecPow) * (0.5 + 0.5 * (1.0 - s)) * uHasSpec;
        outRgb += spec * base.a;                         // on the frame coverage only
        gl_FragColor = vec4(outRgb * mix(1.0, base.a, uStraight), outA);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
defineMaterial("frameHolo", {
  requires: (r, ctx) => !!(ctx.layerTex(r, "_RampTex") && ctx.layerTex(r, "_HologramMaskTex")),
  build: frameHoloMaterial,
});

// ── exHolo (Transparent_Hologram_Tuning) — the EX badge + rule-banner foil. Same iridescent core as holo
// with the EX ramp/phase, MASKED by the DynamicUI canvas alpha (the _UseDynamicUI=1 banner/badge coverage).
// The EX mesh UVs are card-fraction space (== the canvas). Flat UI quad. Premultiplied over. ──
function exHoloMaterial(r, ctx) {
  const f = r.floats;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      dynUI: { value: ctx.dynUITex }, foilMask: { value: ctx.foilTex },
      phase: { value: ctx.layerTex(r, "_PhaseTex") }, rampMask: { value: ctx.layerTex(r, "_RampMaskTex") }, ramp: { value: ctx.layerTex(r, "_RampTex") },
      holoMask: { value: ctx.layerTex(r, "_HologramMaskTex") }, envCube: { value: ctx.envCubeTex },
      uDiffPow: { value: f._DiffractionPower ?? 20 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.8 },
      uRepeat: { value: f._RampRepeat ?? 3 }, uOffset: { value: f._RampOffset ?? 0.216 }, uSpeed: { value: f._RampSpeed ?? 1 }, uInterval: { value: f._RampInterval ?? 0 },
      uShin: { value: f._Shininess ?? 2 }, uSpec: { value: f._SpecularIntensity ?? 0.75 }, uDiffuse: { value: f._DiffuseIntensity ?? f._BaseColorIntensity ?? 0.75 },
      uAlphaBlend: { value: f._AlphaBlend ?? 0 }, uHasEnv: { value: ctx.envCubeTex ? 1 : 0 }, uHasMask: { value: ctx.layerTex(r, "_HologramMaskTex") ? 1 : 0 },
    },
    vertexShader: VIEW_BASIS_WORLD_VS,
    fragmentShader: `
      uniform sampler2D dynUI, foilMask, phase, rampMask, ramp, holoMask;
      uniform samplerCube envCube;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uShin, uSpec, uDiffuse, uAlphaBlend, uHasEnv, uHasMask;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      void main() {
        float m = texture2D(foilMask, vUv).a;         // ex glyph + rule banner coverage
        if (m < 0.02) discard;
        vec4 ui = texture2D(dynUI, vUv);              // FULL UI canvas: .rgb = gold AND the black rule text
        vec3 Rn = vNrm * 0.5 + 0.5, Rv = vVdO * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec4 ph = texture2D(phase, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = 1.0 - min(abs(vec2(s) - pc), vec2(1.0));
        dd = pow(dd, vec2(uDiffPow)) * ph.zw;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - texture2D(rampMask, vUv).x) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 rainbow = texture2D(ramp, vec2(U, 0.5)).rgb * diffraction * uDiffInt;
        vec3 base = ui.rgb;
        vec3 R = reflect(-normalize(vVdW), normalize(vNrmW));
        vec3 env = textureCube(envCube, R).rgb * uHasEnv;
        float spec = pow(clamp(-R.x, 0.0, 1.0), uShin) * uSpec;
        vec3 litBase = base * (env * spec + vec3(uDiffuse));
        vec3 shaded = litBase * (1.0 - uAlphaBlend * diffraction) + rainbow;
        float hm = mix(1.0, texture2D(holoMask, vUv).r, uHasMask);
        vec3 outc = mix(base, shaded, hm);
        gl_FragColor = vec4(outc * m, m);              // premultiplied over → replaces the dim 2900 gold
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  ctx.exHoloMats.push(m);                              // keep ref for the language switch (rebuilds dynUI/foil)
  return m;
}
defineMaterial("exHolo", {
  requires: (r, ctx) => !!(ctx.dynUITex && ctx.foilTex && ctx.layerTex(r, "_PhaseTex") && ctx.layerTex(r, "_RampMaskTex") && ctx.layerTex(r, "_RampTex")),
  build: exHoloMaterial,
});

// ── rarity (Opaque_Hologram_Tuning) — BYTE-TRACED from raredia_frag.spv. The holographic rarity diamond:
//   out.rgb = MainTex.rgb·_BaseColorIntensity + holo ;  out.a = MainTex.a (diamond shape via alpha cutout). ──
function rarityMaterial(r, ctx) {
  const f = r.floats;
  return new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: ctx.layerTex(r, "_MainTex") }, envCube: { value: ctx.envCubeTex },
      phase: { value: ctx.layerTex(r, "_PhaseTex") }, rampMask: { value: ctx.layerTex(r, "_RampMaskTex") }, ramp: { value: ctx.layerTex(r, "_RampTex") },
      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 }, uShin: { value: f._Shininess ?? 2 }, uSpec: { value: f._SpecularIntensity ?? 0.65 },
      uDiffPow: { value: f._DiffractionPower ?? 10 }, uDiffInt: { value: f._DiffractionIntensity ?? 1 },
      uRepeat: { value: f._RampRepeat ?? 1 }, uSpeed: { value: f._RampSpeed ?? 2 }, uOffset: { value: f._RampOffset ?? 0 }, uInterval: { value: f._RampInterval ?? 0 },
    },
    vertexShader: VIEW_BASIS_WORLD_VS,
    fragmentShader: `
      uniform sampler2D mainTex, phase, rampMask, ramp;
      uniform samplerCube envCube;
      uniform float uBaseInt, uShin, uSpec, uDiffPow, uDiffInt, uRepeat, uSpeed, uOffset, uInterval;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm; varying vec3 vVdW; varying vec3 vNrmW;
      void main() {
        vec4 T0 = texture2D(mainTex, vUv);
        if (T0.a < 0.5) discard;                       // diamond shape from MainTex alpha
        vec3 Rn = vNrm * 0.5 + 0.5, Rv = vVdO * 0.5 + 0.5;
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
defineMaterial("rarity", { build: rarityMaterial });

// ── sbHolo (Simple-Opaque-Hologram_Tuning / Opaque-Hologram_Tuning / Opaque-UR-Oklab) — the AM ShadowBox
// body PLUS a holographic shimmer gated by _HologramMaskTex (sbholo_frag.spv, NAMED uniforms). Optional 2nd
// holo layer (_Hologram2Enabled, split by _NormalMap.x), a gold OUTLINE rim (fake-spec), and an env-cube
// reflection (the frag really samples a samplerCube). base = _MainTex AM (opaque cutout via alpha). ──
function sbHoloMaterial(r, ctx) {
  const f = r.floats;
  return new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: ctx.layerTex(r, "_MainTex") }, mask: { value: ctx.layerTex(r, "_HologramMaskTex") || ctx.layerTex(r, "_MaskTex") },
      phase: { value: ctx.layerTex(r, "_PhaseTex") }, rampMask: { value: ctx.layerTex(r, "_RampMaskTex") || ctx.layerTex(r, "_RampMaskTex2") }, ramp: { value: ctx.layerTex(r, "_RampTex") },
      uDiffPow: { value: f._DiffractionPower ?? 20 }, uDiffInt: { value: f._DiffractionIntensity ?? 4 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uOffset: { value: f._RampOffset ?? -0.5 }, uSpeed: { value: f._RampSpeed ?? 3 }, uInterval: { value: f._RampInterval ?? 0 },
      uUseMask: { value: (ctx.layerTex(r, "_HologramMaskTex") || ctx.layerTex(r, "_MaskTex")) ? (f._UseMask ?? 1) : 0 },
      uSrSB: { value: (r.shader === "Opaque-Hologram_Tuning" && ctx.layerTex(r, "_MaskTex") && ctx.layerTex(r, "_PhaseTex2") && ctx.layerTex(r, "_RampTex2")) ? 1 : 0 },
      uOrient: { value: new THREE.Vector2(f._OrientationU ?? 1, f._OrientationV ?? 1) },
      uDual: { value: f._Hologram2Enabled ? 1 : 0 },
      normalMap: { value: ctx.layerTex(r, "_NormalMap") }, uHasNM: { value: ctx.layerTex(r, "_NormalMap") ? 1 : 0 },
      phase2: { value: ctx.layerTex(r, "_PhaseTex2") }, ramp2: { value: ctx.layerTex(r, "_RampTex2") }, rampMask2: { value: ctx.layerTex(r, "_RampMaskTex2") },
      uDiffPow2: { value: f._DiffractionPower2 ?? 30 }, uDiffInt2: { value: f._DiffractionIntensity2 ?? 0.5 },
      uRepeat2: { value: f._RampRepeat2 ?? 3 }, uOffset2: { value: f._RampOffset2 ?? 0.2 }, uSpeed2: { value: f._RampSpeed2 ?? 2 }, uInterval2: { value: f._RampInterval2 ?? 0 },
      uOutColor: { value: V3(r.colors && r.colors._FakeSpecularColor_Outline, new THREE.Vector3(1, 0.95, 0.65)) },
      uMaskColor: { value: V3(r.colors && r.colors._OutlineColor, new THREE.Vector3(0, 0, 0)) },
      uOutInt: { value: (f._FakeSpecularEnabled && f._FakeSpecularIntensity_Outline != null) ? f._FakeSpecularIntensity_Outline : 0 },
      uOutCorner: { value: f._FakeSpecularCornerPower ?? 10 }, uOutScale: { value: f._FakeSpecularMaskScale_Outline ?? 1.5 }, uOutPow: { value: f._FakeSpecularPower_Outline ?? 1 },
      envCube: { value: ctx.envCubeTex },
      uReflInt: { value: f._ReflectionIntensity ?? 2.86 }, uReflPow: { value: f._ReflectionPower ?? 2.03 },
      uHasRefl: { value: (ctx.envCubeTex && f._ReflectionEnabled) ? 1 : 0 },
    },
    vertexShader: VIEW_BASIS_VS,
    fragmentShader: `
      uniform sampler2D mainTex, mask, phase, rampMask, ramp, phase2, ramp2, rampMask2, normalMap;
      uniform float uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, uUseMask, uSrSB, uDual, uHasNM;
      uniform vec2 uOrient;
      uniform float uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2;
      uniform vec3 uOutColor, uMaskColor; uniform float uOutInt, uOutCorner, uOutScale, uOutPow;
      uniform samplerCube envCube; uniform float uReflInt, uReflPow, uHasRefl;
      varying vec2 vUv; varying vec3 vVdO; varying vec3 vNrm;
      vec3 holoLayer(sampler2D phaseT, sampler2D rampT, sampler2D rampMaskT, float diffPow, float diffInt,
                     float repeat, float offset, float speed, float interval, vec3 Rn, vec3 Rv, float s) {
        vec4 ph = texture2D(phaseT, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(diffPow)) * ph.zw;
        float diffraction = dd.x + dd.y;
        float U = clamp(fract((dot(Rn * speed, Rv) - texture2D(rampMaskT, vUv).x) * repeat + offset) * (interval + 1.0) - interval * 0.5, 0.0, 1.0);
        return diffraction * texture2D(rampT, vec2(U, 0.5)).rgb * diffInt;
      }
      void main() {
        vec4 base = texture2D(mainTex, vUv);
        if (base.a < 0.5) discard;                       // AM coverage (opaque cutout)
        vec3 Rn = vNrm * 0.5 + 0.5, Rv = vVdO * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        float maskVal = texture2D(mask, vUv).r;
        float m = mix(1.0, maskVal, uUseMask);   // Pokémon: eyes mask gates; SR ShadowBox: HM outline mask
        float nm = mix(0.5, texture2D(normalMap, vUv).x, uHasNM);
        vec3 h1 = holoLayer(phase, ramp, rampMask, uDiffPow, uDiffInt, uRepeat, uOffset, uSpeed, uInterval, Rn, Rv, s) * m;
        float edgePhase = texture2D(phase, vUv).x * 0.5 + 0.25;
        float edge = pow(1.0 - min(abs(dot(Rn.xy, vec2(0.5)) - edgePhase), 1.0), uDiffPow) * m;
        float edgeU = fract(dot(vUv, uOrient) + dot(Rn, vec3(uSpeed)) + uOffset);
        vec3 srOutline = texture2D(ramp, vec2(edgeU, 0.5)).rgb * edge * uDiffInt;
        h1 = mix(h1, srOutline, uSrSB);
        vec3 h2 = holoLayer(phase2, ramp2, rampMask2, uDiffPow2, uDiffInt2, uRepeat2, uOffset2, uSpeed2, uInterval2, Rn, Rv, s);
        vec3 foilNormal = h1 * nm + h2 * (1.0 - nm);
        vec3 foilSr = h1 + h2 * (1.0 - maskVal);
        vec3 foil = mix(h1, mix(foilNormal, foilSr, uSrSB), uDual);
        float grazing = pow(1.0 - abs(dot(vNrm, vVdO)), uOutCorner);
        vec3 outline = uOutColor * uOutInt * pow(clamp(grazing * uOutScale, 0.0, 1.0), uOutPow);
        vec3 env = textureCube(envCube, reflect(-vVdO, vNrm)).rgb;
        float refl = pow(clamp(1.0 - abs(dot(vNrm, vVdO)), 0.0, 1.0), uReflPow) * uReflInt;
        vec3 baseRgb = mix(base.rgb, mix(base.rgb, uMaskColor, maskVal), uSrSB);
        gl_FragColor = vec4(baseRgb * (1.0 + foil) + outline + env * refl * uHasRefl, base.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
defineMaterial("sbHolo", {
  requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),   // AM base = the shadowbox body
  build: sbHoloMaterial,
});
