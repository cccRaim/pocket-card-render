// UR (Ultra Rare) foil material strategies — the gold Uzumaki plate + diagonal parallax base, the lens
// flare, the metallic window sheen, and the glitter flow-map sparkle. All byte-traced from the UR shaders.
// (A self-contained example of "one rarity's materials in one file" — see CONTRIBUTING.md.)
import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { SIMPLE_VS } from "../glsl.js";

const mainTexName = (r) => r.textures?._MainTex?.name || r.textures?._BaseTex?.name;
const hasFoilTex = (r, ctx) => !!(ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex"));
const V3 = (c, d) => (c ? new THREE.Vector3(c.r, c.g, c.b) : d);
const V4 = (c, d) => (c ? new THREE.Vector4(c.r, c.g, c.b, c.a ?? 1) : d);
const parallaxTex = (r, ctx) => ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex") || ctx.layerTexDefault(r, "_MainTex");
const plateTex = (r, ctx) => ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex") || ctx.layerTexDefault(r, "_MainTex");
const flareBaseMap = (r, ctx) => ctx.layerTex(r, "_BaseMap") || ctx.layerTex(r, "_MainTex") || ctx.layerTexDefault(r, "_BaseMap");
const flareVAT = (r, ctx) => ctx.layerTexDefaultRepeat(r, "_FlareVAT");

// ── plate (Card_UR_Plate) + parallax (Card_Parallax_UR base) — BYTE-TRACED from urplate_frag.spv. Same
// spiral-foil combine: final = mix(baseWithHolo, baseWithHolo·_DarknessColor, darkMask) + fake-spec.
// darkMask = sin²(viewAngle·3)·(1 - clamp(luminance(fakeSpec) - _DarknessOffset, 0, 1)); the plate shader
// darkens around the fake-spec highlight, matching Card_UR_Plate fragment bytecode. ──
function plateMaterial(r, ctx) {
  const f = r.floats || {};
  const tex = plateTex(r, ctx);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      mainTex: { value: tex },
      uDarkColor: { value: V3(r.colors && r.colors._DarknessColor, new THREE.Vector3(0, 0, 0)) },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") }, uHasSpec: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") ? 1 : 0 },
      uSpecColor: { value: V3(r.colors && r.colors._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      uSpecAdd: { value: f._FakeSpecularIntensity ?? 1 },
      envCube: { value: ctx.envCubeTex }, uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
      uShininess: { value: f._Shininess ?? 32 }, uSpecInt: { value: f._SpecularIntensity ?? 1 },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
      rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      holoMask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uSpeed: { value: f._RampSpeed ?? 1 },
      uOffset: { value: f._RampOffset ?? 0 }, uInterval: { value: f._RampInterval ?? 0 },
      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 }, uRemoveMetallic: { value: f._RemoveMetallic ?? f._RemoveMetalic ?? 1 },
      uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 },
      uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
      uUseUv2: { value: f._UseUv2 ?? 0 },
      uSpecMaskScale: { value: f._FakeSpecularMaskScale ?? 1 },
      uSpecCorner: { value: f._FakeSpecularCornerPower ?? 0 },
      uSpecNotCorner: { value: f._FakeSpecularNotCornerOffset ?? 0 },
    },
    vertexShader: `
      uniform float uHeight, uHeightPower, uScale, uFakeH, uUseUv2;
      uniform float uSpecMaskScale, uSpecAdd, uSpecPow, uSpecCorner, uSpecNotCorner;
      attribute vec2 uv2;
      attribute vec4 tangent;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec2 vSpecUv; varying vec2 vSpecParam; varying vec3 vVdO; varying vec3 vNrm;
      varying vec3 vNrmW; varying vec3 vWpos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        camObj.y += uFakeH;
        vec3 viewObj = normalize(camObj - position);
        vec3 n = normalize(normal);
        vec3 t = normalize(tangent.xyz);
        vec3 b = normalize(cross(n, t) * tangent.w);
        vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
        vWpos = wp.xyz;
        vNrmW = normalize(mat3(modelMatrix) * normal);
        float amt = uHeightPower * (uHeight - 0.5);
        vec2 off = (tv.xy / (tv.z + 0.42)) * amt;
        vec2 centeredUv = ((uv * 2.0 - 1.0) / uScale) * 0.5 + off;
        vec2 selectedMaskUv = mix(uv, uv2, step(0.5, uUseUv2));
        vec2 centeredMaskUv = ((selectedMaskUv * 2.0 - 1.0) / uScale) * 0.5 + off;
        vUv = centeredUv + 0.5;
        vMaskUv = centeredMaskUv + 0.5;
        vVdO = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vNrm = vNrmW;

        vec3 specDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        float cardAngle = atan(length(specDir.yz), specDir.x);
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        float cornerPulse = 0.0;
        if (uSpecCorner != 0.0 && tri != 0.0) {
          vec2 v = normalize(-specDir.yz);
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, uSpecCorner);
          corner = mix(uSpecNotCorner, 1.0, corner);
          tri *= corner;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + uSpecMaskScale;
        float specAmp = tri * uSpecAdd * 0.5;
        float specPow = tri * 0.25 + uSpecPow - 0.25;
        vec2 specVec = normalize(-specDir.yz);
        float a = atan(specVec.x, specVec.y);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vSpecUv = (R * centeredUv) / denom + 0.5;
        vSpecParam = vec2(specAmp, specPow);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D mainTex, specMask, phase, phaseMask, rampMask, ramp, holoMask;
      uniform float uDarkOffset, uHasSpec, uHasEnv, uShininess, uSpecInt;
      uniform float uDiffPow, uDiffInt, uRepeat, uSpeed, uOffset, uInterval, uBaseInt, uRemoveMetallic;
      uniform vec3 uDarkColor, uSpecColor; uniform samplerCube envCube;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec2 vSpecUv; varying vec2 vSpecParam; varying vec3 vVdO; varying vec3 vNrm;
      varying vec3 vNrmW; varying vec3 vWpos;
      void main() {
        vec4 mainSample = texture2D(mainTex, vUv);
        vec3 Rn = vNrm * 0.5 + 0.5;
        vec3 Rv = vVdO * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        float rm = texture2D(rampMask, vUv).x;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - rm) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 rainbow = texture2D(ramp, vec2(U, 0.5)).rgb;
        vec4 ph = texture2D(phase, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * texture2D(phaseMask, vUv).xy;
        float diffraction = (dd.x + dd.y) * uDiffInt;
        float hm = texture2D(holoMask, vMaskUv).x;

        vec3 V = normalize(cameraPosition - vWpos);
        vec3 R = reflect(-V, normalize(vNrmW));
        vec3 envBase = vec3(uBaseInt);
        if (uHasEnv > 0.5) {
          float envSpec = pow(clamp(-R.z, 0.0, 1.0), uShininess) * uSpecInt;
          envBase += textureCube(envCube, R).rgb * envSpec;
        }
        vec3 color = mainSample.rgb * envBase;
        color *= 1.0 - diffraction * uRemoveMetallic;
        color += rainbow * diffraction * hm;

        float sp = 0.0;
        if (uHasSpec > 0.5) {
          sp = pow(max(texture2D(specMask, vSpecUv).r * vSpecParam.x, 0.0), vSpecParam.y);
        }
        vec3 fake = uSpecColor * sp;
        vec3 darkDir = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        float darkAngle = atan(length(darkDir.xy), darkDir.z);
        float darkWave = sin(darkAngle * 3.0);
        darkWave *= darkWave;
        float darkMask = darkWave * (1.0 - clamp(dot(fake, vec3(0.298912, 0.586611, 0.114478)) - uDarkOffset, 0.0, 1.0));
        color = mix(color, color * uDarkColor, darkMask);
        color += fake;
        gl_FragColor = vec4(color, mainSample.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
  });
  m.userData.straight = ctx.texStraight(mainTexName(r));
  return m;
}
defineMaterial("plate", { requires: (r, ctx) => !!plateTex(r, ctx), build: plateMaterial });     // semi-transparent Uzumaki spiral (top)

// ── parallaxUR (Card_Parallax_UR) — byte-checked against parur_frag.spv. Unlike Card_UR_Plate, the
// diagonal gold base samples ONLY _MainTex and applies the view-angle darkness tint from the material data.
function parallaxUrMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const tex = parallaxTex(r, ctx);
  const dark = c._DarknessColor ? new THREE.Vector3(c._DarknessColor.r, c._DarknessColor.g, c._DarknessColor.b) : new THREE.Vector3(0, 0, 0);
  const exact = ctx.exactShaders?.Card_Parallax_UR;
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        _242: { value: tex },
        _DarknessColor: { value: dark },
        _DarknessOffset: { value: f._DarknessOffset ?? 0 },
        _Height: { value: f._Height ?? -1 },
        _HeightPower: { value: f._HeightPower ?? 0 },
        _Scale: { value: f._Scale ?? 1 },
        _FakeCameraHeight: { value: f._FakeCameraHeight ?? 0 },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = true;
    m.userData.exactShader = "Card_Parallax_UR";
    return m;
  }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uDarkColor: { value: dark },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 },
      uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
    },
    vertexShader: `
      uniform float uHeight, uHeightPower, uScale, uFakeH;
      attribute vec4 tangent;
      varying vec2 vUv;
      void main() {
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        camObj.y += uFakeH;
        vec3 viewObj = normalize(camObj - position);
        vec3 n = normalize(normal);
        vec3 t = normalize(tangent.xyz);
        vec3 b = normalize(cross(n, t) * tangent.w);
        vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
        vec2 off = (tv.xy / (tv.z + 0.41999998688697815)) * (uHeightPower * (uHeight - 0.5));
        vUv = ((uv * 2.0 - 1.0) / uScale) * 0.5 + off + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 uDarkColor; uniform float uDarkOffset;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        vec3 darkDir = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        float darkAngle = atan(length(darkDir.xy), darkDir.z);
        float darkWave = sin(darkAngle * 3.0);
        darkWave *= darkWave;
        float darkMask = darkWave * (1.0 - clamp(-uDarkOffset, 0.0, 1.0));
        vec3 rgb = mix(t.rgb, t.rgb * uDarkColor, darkMask);
        gl_FragColor = vec4(rgb, t.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.straight = true;
  return m;
}
defineMaterial("parallaxUR", { requires: (r, ctx) => !!parallaxTex(r, ctx), build: parallaxUrMaterial });

function urBgHoloMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const exact = ctx.exactShaders?.Card_Parallax_Hologram_UR_New;
  if (exact) {
    const m = new THREE.RawShaderMaterial({
      uniforms: {
        _257: { value: ctx.layerTexDefault(r, "_PhaseTex") },
        _321: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
        _335: { value: ctx.layerTexDefault(r, "_RampMaskTex") },
        _396: { value: ctx.layerTexDefault(r, "_RampTex") },
        _411: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
        _614: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
        _FakeCameraHeight: { value: f._FakeCameraHeight ?? 0 },
        _Height: { value: f._Height ?? -1 },
        _HeightPower: { value: f._HeightPower ?? 0 },
        _Scale: { value: f._Scale ?? 1 },
        _UseUv2: { value: Math.trunc(f._UseUv2 ?? 0) },
        _FakeSpecularMaskScale: { value: f._FakeSpecularMaskScale ?? 1 },
        _FakeSpecularIntensity: { value: f._FakeSpecularIntensity ?? 1 },
        _FakeSpecularPower: { value: f._FakeSpecularPower ?? 1 },
        _FakeSpecularCornerPower: { value: f._FakeSpecularCornerPower ?? 0 },
        _FakeSpecularNotCornerOffset: { value: f._FakeSpecularNotCornerOffset ?? 0 },
        _DiffractionIntensity: { value: f._DiffractionIntensity ?? 0.5 },
        _DiffractionPower: { value: f._DiffractionPower ?? 64 },
        _RampRepeat: { value: f._RampRepeat ?? 2 },
        _RampSpeed: { value: f._RampSpeed ?? 1 },
        _RampOffset: { value: f._RampOffset ?? 0 },
        _RampInterval: { value: f._RampInterval ?? 0 },
        _FakeSpecularColor: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
        _DarknessColor: { value: V3(c._DarknessColor, new THREE.Vector3(0, 0, 0)) },
        _DarknessOffset: { value: f._DarknessOffset ?? 0 },
        _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.exactShader = "Card_Parallax_Hologram_UR_New";
    return m;
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") }, phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
      rampMask: { value: ctx.layerTexDefault(r, "_RampMaskTex") }, ramp: { value: ctx.layerTexDefault(r, "_RampTex") },
      holoMask: { value: ctx.layerTexDefault(r, "_HologramMaskTex") },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
      uDiffPow: { value: f._DiffractionPower ?? 64 }, uDiffInt: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat: { value: f._RampRepeat ?? 2 }, uSpeed: { value: f._RampSpeed ?? 1 },
      uOffset: { value: f._RampOffset ?? 0 }, uInterval: { value: f._RampInterval ?? 0 },
      uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 },
      uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
      uUseUv2: { value: f._UseUv2 ?? 0 },
      uSpecScale: { value: f._FakeSpecularMaskScale ?? 1 }, uSpecPow: { value: f._FakeSpecularPower ?? 1 },
      uSpecInt: { value: f._FakeSpecularIntensity ?? 1 },
      uSpecCorner: { value: f._FakeSpecularCornerPower ?? 0 },
      uSpecNotCorner: { value: f._FakeSpecularNotCornerOffset ?? 0 },
      uSpecColor: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uDarkColor: { value: V3(c._DarknessColor, new THREE.Vector3(0, 0, 0)) },
      uDarkOffset: { value: f._DarknessOffset ?? 0 },
      uRot: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
    },
    vertexShader: `
      uniform float uHeight, uHeightPower, uScale, uFakeH, uUseUv2;
      uniform float uSpecScale, uSpecInt, uSpecPow, uSpecCorner, uSpecNotCorner;
      uniform vec3 uRot;
      attribute vec2 uv2;
      attribute vec4 tangent;
      varying vec2 vUv; varying vec2 vMaskUv; varying vec2 vSpecUv; varying vec2 vSpecParam; varying vec3 vVdO; varying vec3 vNrm;
      vec3 rx(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }
      vec3 ry(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
      vec3 rz(vec3 p, float a){ float s=sin(a), c=cos(a); return vec3(c*p.x-s*p.y, s*p.x+c*p.y, p.z); }
      vec3 rotateView(vec3 p) {
        vec3 r = -uRot * 0.01745329252;
        return rz(ry(rx(p, r.x), r.y), r.z);
      }
      vec4 specCoord(vec2 centeredUv, vec3 d) {
        float cardAngle = atan(length(d.yz), d.x);
        float tri = sin(cardAngle * 3.0);
        tri *= tri;
        float cornerWave = sin(cardAngle * 2.0 + 1.69645965);
        cornerWave *= cornerWave;
        cornerWave = cornerWave * cornerWave * cornerWave * cornerWave * 3.0;
        float cornerPulse = 0.0;
        vec2 v = normalize(-d.yz);
        if (uSpecCorner != 0.0 && tri != 0.0) {
          vec2 cdir = vec2(v.x < 0.0 ? -0.315 : 0.315, v.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float cornerDot = clamp(dot(v, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          float corner = pow(cornerDot, uSpecCorner);
          corner = mix(uSpecNotCorner, 1.0, corner);
          tri *= corner;
          cornerWave = sin(corner * 2.0943947 + 1.69645965);
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= cornerWave;
          cornerWave *= 3.0;
          cornerPulse = cornerWave;
        }
        float denom = max(cornerPulse, cornerWave) + uSpecScale;
        float specAmp = tri * uSpecInt * 0.5;
        float specPow = tri * 0.25 + uSpecPow - 0.25;
        float a = atan(v.x, v.y);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 suv = (R * centeredUv) / denom + 0.5;
        return vec4(suv, specAmp, specPow);
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        camObj.y += uFakeH;
        vec3 viewObj = normalize(camObj - position);
        vec3 n = normalize(normal);
        vec3 t = normalize(tangent.xyz);
        vec3 b = normalize(cross(n, t) * tangent.w);
        vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
        float amt = uHeightPower * (uHeight - 0.5);
        vec2 off = (tv.xy / (tv.z + 0.42)) * amt;
        vec2 centeredUv = ((uv * 2.0 - 1.0) / uScale) * 0.5 + off;
        vec2 selectedMaskUv = mix(uv, uv2, step(0.5, uUseUv2));
        vec2 centeredMaskUv = ((selectedMaskUv * 2.0 - 1.0) / uScale) * 0.5 + off;
        vec2 puv = centeredUv + 0.5;
        vec3 specDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        vec4 spec = specCoord(centeredUv, specDir);
        vUv = puv; vMaskUv = centeredMaskUv + 0.5; vSpecUv = spec.xy; vSpecParam = spec.zw;
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vVdO = normalize(rotateView(camFwd));
        vNrm = normalize(rotateView(mat3(modelMatrix) * normal));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D phase, phaseMask, rampMask, ramp, holoMask, specMask;
      uniform float uDiffPow, uDiffInt, uRepeat, uSpeed, uOffset, uInterval, uDarkOffset;
      uniform vec3 uSpecColor, uDarkColor; varying vec2 vUv; varying vec2 vMaskUv; varying vec2 vSpecUv; varying vec2 vSpecParam; varying vec3 vVdO; varying vec3 vNrm;
      void main() {
        vec3 Rn = vNrm * 0.5 + 0.5;
        vec3 Rv = vVdO * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec4 ph = texture2D(phase, vUv);
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);
        vec2 dd = pow(1.0 - min(abs(vec2(s) - pc), vec2(1.0)), vec2(uDiffPow)) * texture2D(phaseMask, vUv).xy;
        float diffraction = (dd.x + dd.y) * uDiffInt;
        float U = clamp(fract((dot(Rn * uSpeed, Rv) - texture2D(rampMask, vUv).x) * uRepeat + uOffset) * (uInterval + 1.0) - uInterval * 0.5, 0.0, 1.0);
        vec3 col = texture2D(ramp, vec2(U, 0.5)).rgb * diffraction * texture2D(holoMask, vMaskUv).x;
        float sp = pow(max(texture2D(specMask, vSpecUv).r * vSpecParam.x, 0.0), vSpecParam.y);
        vec3 fake = uSpecColor * sp;
        vec3 darkDir = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        float darkAngle = atan(length(darkDir.xy), darkDir.z);
        float darkWave = sin(darkAngle * 3.0);
        darkWave *= darkWave;
        float darkMask = darkWave * (1.0 - clamp(dot(fake, vec3(0.298912, 0.586611, 0.114478)) - uDarkOffset, 0.0, 1.0));
        col = mix(col, col * uDarkColor, darkMask) + fake;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
defineMaterial("urBgHolo", {
  requires: (r, ctx) => !!(ctx.layerTexDefault(r, "_PhaseTex") && ctx.layerTexDefault(r, "_RampMaskTex") && ctx.layerTexDefault(r, "_RampTex") && ctx.layerTexDefault(r, "_FakeSpecularMask")),
  build: urBgHoloMaterial,
});

// ── flare (Card_UR_LensFlare) — official VAT billboard. The vertex shader samples _FlareVAT by card
// angle, moves the flare center in view space, and modulates intensity with corner/tilt/flicker fields.
// Fragment: out = clamp(_BaseMap - _RemoveTextureArtifact, 0, 1) * vertexColor. ──
defineMaterial("flare", {
  requires: (r, ctx) => !!(flareBaseMap(r, ctx) && flareVAT(r, ctx)),
  build(r, ctx) {
    const f = r.floats || {}, c = r.colors || {};
    const tint = c._BaseColor ? new THREE.Vector3(c._BaseColor.r, c._BaseColor.g, c._BaseColor.b) : new THREE.Vector3(1, 1, 1);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        baseMap: { value: flareBaseMap(r, ctx) },
        flareVAT: { value: flareVAT(r, ctx) },
        uCutoff: { value: f._RemoveTextureArtifact ?? 0 },
        uTint: { value: tint },
        uAlpha: { value: c._BaseColor?.a ?? 1 },
        uIntensity: { value: f._BaseColorRGBIntensity ?? 1 },
        uScale: { value: new THREE.Vector2(f._ScaleX ?? 1, f._ScaleY ?? 1) },
        uTexScale: { value: f._TexScale ?? 1 },
        uTexPixels: { value: new THREE.Vector2(f._TexPixelsX ?? 1024, f._TexPixelsY ?? 256) },
        uIsBack: { value: f._IsBack ? 1 : 0 },
        uCornerPower: { value: f._CornerPower ?? 2 },
        uNotCornerOffset: { value: f._NotCornerOffset ?? 0 },
        uTiltThreshold: { value: f._TiltThreshold ?? 0.5 },
        uTiltPower: { value: f._TiltPower ?? 2 },
        uShouldFlicker: { value: f._ShouldDoFlicker ?? 1 },
        uFlickerSpeed: { value: f._FlickerAnimSpeed ?? 5 },
        uTiltFlickerSpeed: { value: f._TiltFlickerAnimSpeed ?? 3 },
        uFlickerDelay: { value: f._FlickerTimeDelay ?? 0 },
        uFlickerFloor: { value: f._FlickResultIntensityLowestPoint ?? 0.5 },
        uEmissivePattern: { value: f._EmissivePattern ?? 0 },
        uEmissiveColor: { value: V4(c._EmissiveColor, new THREE.Vector4(1, 1, 1, 1)) },
        uBloomOnly: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D flareVAT;
        uniform vec2 uScale, uTexPixels;
        uniform float uTexScale, uIsBack, uCornerPower, uNotCornerOffset, uTiltThreshold, uTiltPower;
        uniform float uShouldFlicker, uFlickerSpeed, uTiltFlickerSpeed, uFlickerDelay, uFlickerFloor, uTime;
        uniform vec3 uTint; uniform float uIntensity, uAlpha;
        varying vec2 vUv; varying vec4 vColor;
        float cornerAmount(vec2 dir, float power, float floorV) {
          vec2 cdir = vec2(dir.x < 0.0 ? -0.315 : 0.315, dir.y < 0.0 ? -0.44 : 0.44);
          cdir = normalize(cdir);
          float c = clamp(dot(dir, cdir) - 0.5821119, 0.0, 1.0) * 2.3929851;
          return mix(floorV, 1.0, pow(c, power));
        }
        void main() {
          vUv = uv;
          vec3 cardDir = normalize(-modelMatrix[2].xyz);
          if (cardDir.z >= 0.0) {
            gl_Position = vec4(0.0);
            vColor = vec4(uTint * uIntensity, uAlpha);
            return;
          }
          vec2 dir = normalize(cardDir.xy);
          dir = mix(-dir, dir, step(0.5, uIsBack));
          float angle = atan(dir.y, dir.x);
          float vatU = angle * 0.1591549813747406;
          vec2 center = (texture2D(flareVAT, vec2(vatU, 0.0)).xy - 0.5) * uScale;

          float corner = cornerAmount(dir, uCornerPower, uNotCornerOffset);
          float tiltAngle = atan(length(cardDir.xy), abs(cardDir.z));
          float tilt = sin(tiltAngle * 3.0);
          tilt = clamp((tilt * tilt - uTiltThreshold) / max(1.0 - uTiltThreshold, 0.0001), 0.0, 1.0);
          tilt = tilt * tilt * (3.0 - 2.0 * tilt);
          tilt = pow(tilt, uTiltPower);
          float strength = corner * tilt;

          float flickA = max(sin((angle * uTiltFlickerSpeed + uTime + uFlickerDelay) * uFlickerSpeed), 0.0);
          flickA = mix(uFlickerFloor, 1.0, flickA);
          float flickB = max(sin((angle * uTiltFlickerSpeed + uTime + uFlickerDelay) * 0.6437), 0.0);
          flickB = mix(uFlickerFloor, 1.0, flickB);
          float flicker = clamp((flickA + flickB) * 0.5, 0.0, 1.0);
          strength = mix(strength, strength * flicker, step(0.000001, abs(uShouldFlicker)));

          vec4 localCenter = vec4(center, 0.0, 1.0);
          vec4 worldCenter = modelMatrix * localCenter;
          vec4 viewCenter = viewMatrix * worldCenter;
          // Official bytecode scales Y by _TexPixelsX / _TexPixelsY before projection.
          vec2 aspect = vec2(1.0, uTexPixels.x / max(uTexPixels.y, 1.0));
          viewCenter.xy += position.xy * uTexScale * aspect * strength;
          gl_Position = projectionMatrix * viewCenter;
          vColor = vec4(uTint * uIntensity * strength, uAlpha);
        }`,
      fragmentShader: `
        uniform sampler2D baseMap; uniform float uCutoff, uEmissivePattern, uBloomOnly; uniform vec4 uEmissiveColor; varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(baseMap, vUv);
          vec4 color = clamp(t - vec4(uCutoff), 0.0, 1.0) * vColor;
          vec4 emissive = color * uEmissiveColor * (1.0 - step(0.5, abs(uEmissivePattern - 1.0)));
          if (uBloomOnly > 0.5) { gl_FragColor = vec4(emissive.rgb, 1.0); return; }
          gl_FragColor = color;
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false,
    });
    m.userData.bloomSource = true;
    ctx.animMats.push(m);
    return m;
  },
});

// ── metal (Card_Parallax_Metal) — env-cube specular on the metallic window submesh, MULTIPLY blend.
// metal_frag (SPIRV-Cross + shader PropInfo): out ≈ 1 + cube(reflect(-V,N))·pow(clamp(-reflect.z,0,1), _Shininess)·
// _SpecularIntensity → a metallic env sheen at grazing/tilt (≈no-op head-on, so multiply doesn't darken). ──
defineMaterial("metal", {
  build(r, ctx) {
    const f = r.floats || {};
    const rot = r.colors?._Rotation || { r: 0, g: 0, b: 0 };
    const exact = ctx.exactShaders?.Card_Parallax_Metal;
    if (exact && ctx.envCubeTex && ctx.layerTexDefault(r, "_MetalMaskTex")) {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          _CubeMap: { value: ctx.envCubeTex },
          _MetalMaskTex: { value: ctx.layerTexDefault(r, "_MetalMaskTex") },
          _FakeCameraHeight: { value: f._FakeCameraHeight ?? 0 },
          _Height: { value: f._Height ?? -1 },
          _HeightPower: { value: f._HeightPower ?? 0 },
          _Scale: { value: f._Scale ?? 1 },
          _UseUv: { value: Math.trunc(f._UseUv ?? 0) },
          _BaseColorIntensity: { value: f._BaseColorIntensity ?? 0.5 },
          _Shininess: { value: f._Shininess ?? 32 },
          _SpecularIntensity: { value: f._SpecularIntensity ?? 1 },
          _MetalMaskIntensity: { value: f._MetalMaskIntensity ?? 1 },
          _Rotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
        },
        vertexShader: exact.vert,
        fragmentShader: exact.frag,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      m.userData.exactShader = "Card_Parallax_Metal";
      return m;
    }
    return new THREE.ShaderMaterial({
      uniforms: {
        envCube: { value: ctx.envCubeTex }, uHasEnv: { value: (ctx.envCubeTex && r.textures && r.textures._CubeMap) ? 1 : 0 },
        maskTex: { value: ctx.layerTexDefault(r, "_MetalMaskTex") },
        uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 },
        uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
        uUseUv: { value: f._UseUv ?? 0 },
        uBaseInt: { value: f._BaseColorIntensity ?? 0.5 },
        uMetalMaskInt: { value: f._MetalMaskIntensity ?? 1 },
        uSpecInt: { value: f._SpecularIntensity ?? 1 }, uSpecPow: { value: f._Shininess ?? 32 },
        uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      },
      vertexShader: `
        uniform float uHeight, uHeightPower, uScale, uFakeH, uUseUv;
        attribute vec4 tangent;
        attribute vec2 uv2;
        varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldNrm;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNrm = normalize(mat3(modelMatrix) * normal);
          vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
          camObj.y += uFakeH;
          vec3 viewObj = normalize(camObj - position);
          vec3 n = normalize(normal);
          vec3 t = normalize(tangent.xyz);
          vec3 b = normalize(cross(n, t) * tangent.w);
          vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
          vec2 off = (tv.xy / (tv.z + 0.41999998688697815)) * (uHeightPower * (uHeight - 0.5));
          vec2 srcUv = mix(uv, uv2, step(0.5, uUseUv));
          vUv = (((srcUv * 2.0) - 1.0) / uScale) * 0.5 + off + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform samplerCube envCube; uniform sampler2D maskTex;
        uniform float uHasEnv, uSpecInt, uSpecPow, uBaseInt, uMetalMaskInt;
        uniform vec3 uRotation;
        varying vec2 vUv; varying vec3 vWorldPos; varying vec3 vWorldNrm;
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
        void main(){
          vec3 V = rotateXYZ(normalize(cameraPosition - vWorldPos), uRotation);
          vec3 N = rotateXYZ(normalize(vWorldNrm), uRotation);
          vec3 R = reflect(-V, N);
          float grazing = pow(clamp(-R.z, 0.0, 1.0), uSpecPow);
          vec3 env = vec3(0.0);
          if (uHasEnv > 0.5) env = textureCube(envCube, R).rgb;
          float mask = texture2D(maskTex, clamp(vUv, 0.0, 1.0)).r * uMetalMaskInt;
          vec3 mul = vec3(1.0) + mask * ((env * grazing * uSpecInt + vec3(uBaseInt)) - vec3(1.0));
          gl_FragColor = vec4(mul, 1.0);
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
  const f = r.floats || {}, c = r.colors || {}, lc = c._LightColor || { r: 1, g: 1, b: 1 };
  const rep = (slot) => ctx.layerTexDefaultRepeat(r, slot);
  const V4 = (x, y, z, w) => new THREE.Vector4(x, y, z, w);
  const _78 = Array.from({ length: 18 }, () => V4(0, 0, 0, 0));
  _78[13].set(f._FakeCameraHeight ?? 0, f._Height ?? -1, f._HeightPower ?? 0, f._Scale ?? 1);
  _78[15].set(0, 0, 0, 0);   // undeclared flow-field rotation angles; official cbuffer leaves them at identity
  _78[16].set(f._FlowScale ?? 1.4, f._FakeCameraHeightB ?? 0, f._HeightB ?? -1, f._HeightPowerB ?? 0);
  _78[17].set(f._ScaleB ?? 1, f._FlowScaleB ?? 1.4, 0, 0);
  // fragment cbuffer (declaration order, anchored by _LightColor at byte @48 = _37[3]):
  //   _37[2] = (_FadeDuration, _FlowAPower, _FlowBPower)   @32/36/40
  //   _37[3] = _LightColor                                 @48
  //   _37[4] = (_LightTime, _EmitThreshold)                @64/68
  // _37[4].x = _LightTime is the twinkle PULSE half-width (frag: _133 = _37[4].x*0.5; emit where |phase|<_133).
  // It was previously UNSET (=0) → the pulse window was zero → no sparkle flashes at all (the missing twinkle).
  const _37 = Array.from({ length: 5 }, () => V4(0, 0, 0, 0));
  _37[2].set(f._FadeDuration ?? 0.2, f._FlowAPower ?? 1, f._FlowBPower ?? 1, 0);
  _37[3].set(lc.r, lc.g, lc.b, 1);
  _37[4].set(f._LightTime ?? 0.1, f._EmitThreshold ?? 0.01, 0, 0);
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
  // _78[15] (vertex byte @240) is read by the shader as the two flow-field rotation angles (sin/cos), but it
  // is an UNDECLARED cbuffer slot (not a shader Property; _RotateSpeedA/B exist in the material's m_Floats but
  // are NOT in this shader's Properties → vestigial). Undeclared ⇒ reads 0 in-game ⇒ identity rotation ⇒ NO
  // field rotation. It stays at its initial (0,0,0,0); the twinkle is the fragment flow + pulse, not rotation.
  ctx.exactGlitMats.push(m);   // per-frame: only _37[0] (flow time) is animated — see app.js loop
  return m;
}
// hand port (used when the SPIRV-Cross shader is absent) — base_rgb × light.GREEN, two layers B-over-A,
// layer B's flow staggers the per-pixel scintillation (the twinkle), no field rotation.
function glitterMaterialHand(r, ctx) {
  const f = r.floats || {};
  const rep = (slot) => ctx.layerTexDefaultRepeat(r, slot);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      baseA: { value: rep("_ABaseTex") }, lightA: { value: rep("_ALightTex") },
      baseB: { value: rep("_BBaseTex") }, lightB: { value: rep("_BLightTex") },
      flowB: { value: rep("_FlowBMap") },
      uFlowB: { value: f._FlowBPower ?? 1 }, uSpeed: { value: 1 },
      uScale: { value: 1 / (f._Scale || 1) }, uTime: { value: 0 },
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
  requires: (r, ctx) => !!(ctx.layerTexDefault(r, "_ABaseTex") && ctx.layerTexDefault(r, "_FlowAMap")),
  build: (r, ctx) => (ctx.exactGlit ? glitterMaterialExact(r, ctx) : glitterMaterialHand(r, ctx)),
});
