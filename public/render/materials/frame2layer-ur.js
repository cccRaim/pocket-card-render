import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { EMISSIVE_MRT_RGB } from "../glsl.js";

const V3 = (c, d) => (c ? new THREE.Vector3(c.r, c.g, c.b) : d);
const V4 = (c, d) => (c ? new THREE.Vector4(c.r, c.g, c.b, c.a ?? 1) : d);
const rawColorTex = (r, ctx, slot) => ctx.layerTexNoColorSpace(r, slot) || ctx.layerTexDefault(r, slot);

function frame2LayerUrMaterial(r, ctx) {
  const f = r.floats || {};
  const c = r.colors || {};
  const rot = c._Rotation || { r: 0, g: 0, b: 0 };
  const exact = ctx.exactShaderPort(r);
  if (exact) {
    const manifest = exact.manifest;
    const uniforms = ctx.exactPortUniforms(r, exact, ({ slot }) => {
      if (slot === "_CubeMap") return ctx.layerCubeDefault(r);
      if (slot === "_BaseTex" || slot === "_RampTex" || slot === "_RampTex2") {
        return rawColorTex(r, ctx, slot);
      }
      if (slot === "_RampMaskTex" || slot === "_RampMaskTex2") {
        return ctx.layerTexDefaultRepeat(r, slot);
      }
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
    m.userData.bloomSource = true;
    m.userData.exactShader = "Frame-2Layer-UR";
    m.userData.officialPassRuntime = manifest.official_pass_runtime || null;
    m.userData.officialSelector = manifest.official_selector || null;
    m.userData.officialExecutableIdentity = manifest.official_executable_identity || null;
    return m;
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      baseTex: { value: rawColorTex(r, ctx, "_BaseTex") },
      layerMask: { value: ctx.layerTexDefault(r, "_LayerMaskTex") },
      envCube: { value: ctx.envCubeTex },
      phase: { value: ctx.layerTexDefault(r, "_PhaseTex") },
      phaseMask: { value: ctx.layerTexDefault(r, "_PhaseMaskTex") },
      rampMask1: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex") },
      ramp1: { value: rawColorTex(r, ctx, "_RampTex") },
      rampMask2: { value: ctx.layerTexDefaultRepeat(r, "_RampMaskTex2") },
      ramp2: { value: rawColorTex(r, ctx, "_RampTex2") },
      specMask: { value: ctx.layerTexDefault(r, "_FakeSpecularMask") },
      uStraight: { value: ctx.texStraight(r.textures?._BaseTex?.name) ? 1 : 0 },

      uBaseInt: { value: f._BaseColorIntensity ?? 0.5 },
      uShininess: { value: f._Shininess ?? 32 },
      uSpecularIntensity: { value: f._SpecularIntensity ?? 1 },
      uRemoveMetallic: { value: f._RemoveMetallic ?? f._RemoveMetalic ?? 1 },

      uDiffPow1: { value: f._DiffractionPower ?? 64 },
      uDiffInt1: { value: f._DiffractionIntensity ?? 0.5 },
      uRepeat1: { value: f._RampRepeat ?? 2 },
      uSpeed1: { value: f._RampSpeed ?? 1 },
      uOffset1: { value: f._RampOffset ?? 0 },
      uInterval1: { value: f._RampInterval ?? 0 },
      uRampMaskRot1: { value: f._RampMaskRotation ?? 0 },
      uRampMaskScale1: { value: f._RampMaskScale ?? 1 },
      uUseSimple1: { value: f._UseSimpleRampMaskAndRotation ?? 0 },

      uDiffPow2: { value: f._DiffractionPower2 ?? 64 },
      uDiffInt2: { value: f._DiffractionIntensity2 ?? 0.5 },
      uRepeat2: { value: f._RampRepeat2 ?? 2 },
      uSpeed2: { value: f._RampSpeed2 ?? 1 },
      uOffset2: { value: f._RampOffset2 ?? 0 },
      uInterval2: { value: f._RampInterval2 ?? 0 },
      uRampMaskRot2: { value: f._RampMaskRotation2 ?? 0 },
      uRampMaskScale2: { value: f._RampMaskScale2 ?? 1 },
      uUseSimple2: { value: f._UseSimpleRampMaskAndRotation2 ?? 0 },

      uSpecColor1: { value: V3(c._FakeSpecularColor, new THREE.Vector3(0, 0, 0)) },
      uSpecColor2: { value: V3(c._FakeSpecularColor2, new THREE.Vector3(0, 0, 0)) },
      uSpecInt1: { value: f._FakeSpecularIntensity ?? 1 },
      uSpecPow1: { value: f._FakeSpecularPower ?? 1 },
      uSpecScale1: { value: f._FakeSpecularMaskScale ?? 1 },
      uSpecCorner1: { value: f._FakeSpecularCornerPower ?? 0 },
      uSpecNotCorner1: { value: f._FakeSpecularNotCornerOffset ?? 0 },
      uSpecInt2: { value: f._FakeSpecularIntensity2 ?? 1 },
      uSpecPow2: { value: f._FakeSpecularPower2 ?? 1 },
      uSpecScale2: { value: f._FakeSpecularMaskScale2 ?? 1 },
      uSpecCorner2: { value: f._FakeSpecularCornerPower2 ?? 0 },
      uSpecNotCorner2: { value: f._FakeSpecularNotCornerOffset2 ?? 0 },

      uDarkColor1: { value: V3(c._DarknessColor1, new THREE.Vector3(0, 0, 0)) },
      uDarkColor2: { value: V3(c._DarknessColor2, new THREE.Vector3(0, 0, 0)) },
      uDarkOffset1: { value: f._DarknessOffset1 ?? 0 },
      uDarkOffset2: { value: f._DarknessOffset2 ?? 0 },
      uTilt: { value: f._Tilt ?? 0 },
      uEmissivePattern: { value: f._EmissivePattern ?? 1 },
      uEmissiveColor: { value: V4(c._EmissiveColor, new THREE.Vector4(1, 1, 1, 1)) },
      uRotation: { value: new THREE.Vector3(rot.r || 0, rot.g || 0, rot.b || 0) },
      uBloomOnly: { value: 0 },
    },
    vertexShader: `
      uniform float uRampMaskRot1, uRampMaskScale1, uRampMaskRot2, uRampMaskScale2;
      uniform float uSpecInt1, uSpecPow1, uSpecScale1, uSpecCorner1, uSpecNotCorner1;
      uniform float uSpecInt2, uSpecPow2, uSpecScale2, uSpecCorner2, uSpecNotCorner2;
      varying vec2 vUv;
      varying vec3 vVdO;
      varying vec3 vNrm;
      varying vec3 vVdW;
      varying vec3 vNrmW;
      varying float vRampU1;
      varying float vRampU2;
      varying vec4 vSpec1;
      varying vec4 vSpec2;

      float rampCoord(vec2 p, float rot, float scale) {
        float a = rot;
        vec2 dir = vec2(cos(a), sin(-a));
        vec2 q = (p - 0.5) * scale;
        return dot(dir, q) + 0.5;
      }

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
        vVdW = normalize(cameraPosition - wp.xyz);
        vNrmW = normalize(mat3(modelMatrix) * normal);
        vVdO = normalize((inverse(modelMatrix) * vec4(vVdW, 0.0)).xyz);
        vNrm = normalize(normal);
        vUv = uv;
        vRampU1 = rampCoord(uv, uRampMaskRot1, uRampMaskScale1);
        vRampU2 = rampCoord(uv, uRampMaskRot2, uRampMaskScale2);
        vec3 specDir = normalize(vec3(-modelMatrix[2].z, -modelMatrix[2].x, -modelMatrix[2].y));
        vSpec1 = specCoord(uv, specDir, uSpecScale1, uSpecInt1, uSpecPow1, uSpecCorner1, uSpecNotCorner1);
        vSpec2 = specCoord(uv, specDir, uSpecScale2, uSpecInt2, uSpecPow2, uSpecCorner2, uSpecNotCorner2);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D baseTex, layerMask, phase, phaseMask, rampMask1, ramp1, rampMask2, ramp2, specMask;
      uniform samplerCube envCube;
      uniform float uBaseInt, uShininess, uSpecularIntensity, uRemoveMetallic, uStraight;
      uniform float uDiffPow1, uDiffInt1, uRepeat1, uSpeed1, uOffset1, uInterval1, uUseSimple1;
      uniform float uDiffPow2, uDiffInt2, uRepeat2, uSpeed2, uOffset2, uInterval2, uUseSimple2;
      uniform vec3 uSpecColor1, uSpecColor2, uDarkColor1, uDarkColor2, uRotation;
      uniform float uDarkOffset1, uDarkOffset2, uTilt, uEmissivePattern, uBloomOnly;
      uniform vec4 uEmissiveColor;
      ${EMISSIVE_MRT_RGB}
      varying vec2 vUv;
      varying vec3 vVdO;
      varying vec3 vNrm;
      varying vec3 vVdW;
      varying vec3 vNrmW;
      varying float vRampU1;
      varying float vRampU2;
      varying vec4 vSpec1;
      varying vec4 vSpec2;

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

      vec4 layerFoil(
        sampler2D rampMask, sampler2D rampTex, float maskValue, float rampU, float useSimple,
        float diffPow, float diffInt, float repeatv, float speedv, float offsetv, float intervalv,
        vec3 Rn, vec3 Rv, float s, vec2 phaseCenter, vec2 phaseGate
      ) {
        float rmUv = texture2D(rampMask, vUv).x;
        float rmSimple = texture2D(rampMask, vec2(rampU, 0.5)).x;
        float rm = mix(rmUv, rmSimple, step(0.5, useSimple));
        vec2 dd = pow(1.0 - min(abs(vec2(s) - phaseCenter), vec2(1.0)), vec2(diffPow)) * phaseGate;
        float diffraction = dd.x + dd.y;
        float u0 = clamp(fract((dot(Rn * speedv, Rv) - rmSimple) * repeatv + offsetv) * (intervalv + 1.0) - intervalv * 0.5, 0.0, 1.0);
        float u1 = clamp(fract((dot(Rn * speedv, Rv) - rm) * repeatv + offsetv) * (intervalv + 1.0) - intervalv * 0.5, 0.0, 1.0);
        vec3 simpleRamp = texture2D(rampTex, vec2(u0, 0.5)).rgb * diffraction * diffInt;
        vec3 uvRamp = texture2D(rampTex, vec2(u1, 0.5)).rgb * diffraction * diffInt;
        return vec4(mix(uvRamp, simpleRamp, step(0.5, useSimple)) * maskValue, diffraction * diffInt * maskValue);
      }

      float fakeSpecStrength(vec4 specData) {
        float m = texture2D(specMask, specData.xy).x * specData.z;
        return pow(max(m, 0.0), specData.w);
      }

      void main() {
        vec4 base = texture2D(baseTex, vUv);
        if (base.a == 0.0) discard;

        vec2 lm = texture2D(layerMask, vUv).rg;
        float hasLayer1 = lm.r > 0.0 ? 1.0 : 0.0;
        float hasLayer2 = lm.g > 0.0 ? 1.0 : 0.0;
        vec3 camFwd = normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]));
        vec3 rotN = rotateXYZ(normalize(vNrmW), uRotation);
        vec3 rotCam = rotateXYZ(camFwd, uRotation);
        vec3 rotView = rotateXYZ(normalize(vVdW), uRotation);
        vec3 Rn = rotN * 0.5 + 0.5;
        vec3 Rv = rotCam * 0.5 + 0.5;
        float s = dot(Rn.xy, Rv.xy);
        vec2 ph = texture2D(phase, vUv).xy;
        vec2 pm = texture2D(phaseMask, vUv).xy;
        vec2 pc = vec2(ph.x * 0.25 + 0.25, (2.0 - ph.y) * 0.25 + 0.25);

        vec3 R = reflect(-rotView, rotN);
        float envSpec = pow(clamp(-R.x, 0.0, 1.0), uShininess) * uSpecularIntensity;
        vec3 env = textureCube(envCube, R.yzx).rgb * envSpec;
        vec3 color = base.rgb * (vec3(uBaseInt) + env);

        vec4 foil1 = layerFoil(rampMask1, ramp1, lm.r, vRampU1, uUseSimple1, uDiffPow1, uDiffInt1, uRepeat1, uSpeed1, uOffset1, uInterval1, Rn, Rv, s, pc, pm);
        vec4 foil2 = layerFoil(rampMask2, ramp2, lm.g, vRampU2, uUseSimple2, uDiffPow2, uDiffInt2, uRepeat2, uSpeed2, uOffset2, uInterval2, Rn, Rv, s, pc, pm);
        float metallicCut = clamp(foil1.a * uRemoveMetallic, 0.0, 1.0);
        color *= 1.0 - metallicCut;
        color += foil1.rgb + foil2.rgb / (base.a + 0.001);

        vec3 baseLab = linearToOklab(srgbToLinear(color));
        vec3 specColorLab1 = linearToOklab(srgbToLinear(uSpecColor1));
        vec3 specColorLab2 = linearToOklab(srgbToLinear(uSpecColor2));
        float specStrength1 = fakeSpecStrength(vSpec1) * hasLayer1;
        float specStrength2 = fakeSpecStrength(vSpec2) * hasLayer2;
        vec3 specLab1 = specColorLab1 * specStrength1;
        vec3 specLab2 = specColorLab2 * specStrength2;
        vec3 darkLab1 = linearToOklab(srgbToLinear(color * uDarkColor1));
        vec3 darkLab2 = linearToOklab(srgbToLinear(color * uDarkColor2));
        float darkMix1 = (1.0 - clamp(specStrength1 * specColorLab1.x - uDarkOffset1, 0.0, 1.0)) * uTilt * hasLayer1;
        float darkMix2 = (1.0 - clamp(specStrength2 * specColorLab2.x - uDarkOffset2, 0.0, 1.0)) * uTilt * hasLayer2;
        darkLab1 = mix(baseLab, darkLab1, darkMix1);
        darkLab2 = mix(baseLab, darkLab2, darkMix2);
        float layerMix = lm.g / (lm.r + lm.g + 0.001);
        vec3 specRgb = linearToSrgb(oklabToLinear(mix(specLab1, specLab2, layerMix)));
        vec3 darkRgb = linearToSrgb(oklabToLinear(mix(darkLab1, darkLab2, layerMix)));
        color = darkRgb + specRgb / (base.a + 0.001);
        vec3 emissive = emissiveMrtRgb(specRgb, color, uEmissivePattern, uEmissiveColor, 1.0, 1.0);
        if (uBloomOnly > 0.5) { gl_FragColor = vec4(emissive, 1.0); return; }
        gl_FragColor = vec4(color * mix(1.0, base.a, uStraight), base.a);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.userData.bloomSource = true;
  return m;
}

defineMaterial("frame2LayerUR", {
  requires: (_r, ctx) => !!ctx.envCubeTex,
  build: frame2LayerUrMaterial,
});
