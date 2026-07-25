// Base material strategies — the plain textured layers, the depth-parallax window, the SR effect
// sparkles, and the ShadowBox frame-outline ring. Shared by every rarity.
import * as THREE from "three";
import { defineMaterial } from "../registry.js";

const mainTexName = (r) => r.textures?._MainTex?.name || r.textures?._BaseTex?.name;
const mainTex = (r, ctx) => ctx.layerTexDefault(r, "_MainTex") || ctx.layerTexDefault(r, "_BaseTex");
const hasMainTex = (r, ctx) => !!mainTex(r, ctx);

function texturedExactMaterial(r, ctx, shaderName, straight) {
  const exact = ctx.exactShaderPort(r, shaderName);
  if (!exact) return null;
  const tex = mainTex(r, ctx);
  if (!tex) return null;
  const uniforms = exact.manifest?.runtime_contract
    ? ctx.exactPortUniforms(r, exact, (binding) => ctx.layerTexDefault(r, binding.slot))
    : { _13: { value: tex } };
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: exact.vert,
    fragmentShader: exact.frag,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.userData.straight = straight;
  m.userData.exactShader = shaderName;
  m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
  m.userData.officialSelector = exact.manifest?.official_selector || null;
  m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
  return m;
}

function texturedMrtFallbackMaterial(r, ctx, shaderName, straight) {
  const stageSource = ctx.exactShaders?.[shaderName];
  const tex = mainTex(r, ctx);
  if (!stageSource?.vert || !stageSource?.frag || !tex) return null;
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { _13: { value: tex } },
    vertexShader: stageSource.vert,
    fragmentShader: stageSource.frag,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  // This keeps the non-selector fallback compatible with the two-attachment card MRT. It deliberately
  // carries no exactShader/selector/pass identity and therefore cannot receive exact coverage credit.
  m.userData.straight = straight;
  m.userData.stageSourceFallback = shaderName;
  return m;
}

// ── textured: a plain albedo quad (Frame and other premult/simple layers) ──
// Physical card back and side wall. The exact fragment only mixes _BaseTex with _Blend; legacy
// material fields such as fog/specular are not bound by the official empty-keyword program.
defineMaterial("sideBack", {
  requires: (r, ctx) => !!ctx.layerTexDefault(r, "_BaseTex"),
  build(r, ctx) {
    const tex = ctx.layerTexDefault(r, "_BaseTex");
    const blend = r.colors?._Blend || { r: 0, g: 0, b: 0, a: 0 };
    const stageSource = ctx.compatibleStageSource("Side&Back");
    const uniforms = {
      _BaseTex: { value: tex },
      _Blend: { value: new THREE.Vector4(blend.r, blend.g, blend.b, blend.a) },
    };
    const m = stageSource ? new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: stageSource.vert,
      fragmentShader: stageSource.frag,
      toneMapped: false,
    }) : new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D _BaseTex; uniform vec4 _Blend; varying vec2 vUv;
        void main(){ vec4 t=texture2D(_BaseTex,vUv); gl_FragColor=vec4(mix(t.rgb,_Blend.rgb,_Blend.a),t.a); }`,
      toneMapped: false,
    });
    if (stageSource) m.userData.stageSourceFallback = "Side&Back";
    m.userData.straight = true;
    return m;
  },
});

defineMaterial("textured", {
  requires: hasMainTex,
  build(r, ctx) {
    const exact = r.shader === "Frame" ? texturedExactMaterial(r, ctx, "Frame", ctx.texStraight(mainTexName(r))) : null;
    if (exact) return exact;
    if (r.shader === "Frame") {
      const mrtFallback = texturedMrtFallbackMaterial(r, ctx, "Frame", ctx.texStraight(mainTexName(r)));
      if (mrtFallback) return mrtFallback;
    }
    const tex = mainTex(r, ctx);
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    m.userData.straight = ctx.texStraight(mainTexName(r));
    return m;
  },
});

// Card_Illust's official shader only samples _MainTex/_BaseTex, but its render state is
// SrcAlpha/OneMinusSrcAlpha and the vertex path can select UV0 or UV1 with _UseUv.
defineMaterial("illustTextured", {
  requires: hasMainTex,
  build(r, ctx) {
    const tex = mainTex(r, ctx);
    const exact = ctx.exactShaderPort(r, "Card_Illust");
    if (exact) {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: ctx.exactPortUniforms(r, exact, () => tex),
        vertexShader: exact.vert,
        fragmentShader: exact.frag,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      m.userData.straight = true;
      m.userData.exactShader = "Card_Illust";
      m.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
      m.userData.officialSelector = exact.manifest?.official_selector || null;
      m.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
      return m;
    }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        uUseUv: { value: r.floats?._UseUv ?? 0 },
      },
      vertexShader: `
        uniform float uUseUv;
        attribute vec2 uv1;
        varying vec2 vUv;
        void main() {
          vUv = mix(uv, uv1, step(0.5, uUseUv));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vUv);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = true;
    return m;
  },
});

// ── simpleTransparent (Simple-Transparent): official fragment samples _MainTex and premultiplies RGB
// by alpha before the One/OneMinusSrcAlpha blend.
defineMaterial("simpleTransparent", {
  requires: hasMainTex,
  build(r, ctx) {
    const exact = texturedExactMaterial(r, ctx, "Simple-Transparent", false);
    if (exact) return exact;
    const mrtFallback = texturedMrtFallbackMaterial(r, ctx, "Simple-Transparent", false);
    if (mrtFallback) return mrtFallback;
    const tex = mainTex(r, ctx);
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * t.a, t.a);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.userData.straight = false;
    return m;
  },
});

// Newer RR ShadowBox layers combine a premultiplied base texture with the official diffraction
// hologram. There is deliberately no approximate fallback: losing the five-sampler diffraction,
// vertex-color alpha gate, or selector-owned pass state would silently render a different material.
defineMaterial("simplePremultiplyHologram", {
  requires: hasMainTex,
  build(r, ctx) {
    return texturedExactMaterial(r, ctx, "Simple-PreMultiply-Hologram", false);
  },
});

// ── depthParallax (Card_Parallax): per-layer virtual-depth parallax (decompiled from parallax_vert
// SPIR-V). Each quad is flat but the vertex shader offsets its UV along the tangent-space view direction
// scaled by _HeightPower * (_Height - 0.5), so when the card tilts the layers shift at different depths
// (the window's 2.5D). At frontal view the offset is ~0 (view dir ≈ +Z). ──
defineMaterial("depthParallax", {
  requires: hasMainTex,
  build(r, ctx) {
    const f = r.floats;
    const exact = ctx.exactShaderPort(r, "Card_Parallax");
    if (exact) {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: ctx.exactPortUniforms(r, exact, (binding) => ctx.layerTexDefault(r, binding.slot)),
        vertexShader: exact.vert,
        fragmentShader: exact.frag,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      m.userData.straight = false;
      m.userData.exactShader = "Card_Parallax";
      m.userData.exactVariant = exact.manifest.official_selector.selectionMode;
      m.userData.officialPassRuntime = exact.manifest.official_pass_runtime;
      m.userData.officialSelector = exact.manifest.official_selector;
      m.userData.officialExecutableIdentity = exact.manifest.official_executable_identity;
      return m;
    }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: mainTex(r, ctx) },
        uHeight: { value: f._Height ?? -1 }, uHeightPower: { value: f._HeightPower ?? 0 },
        uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0 },
        uUseUv: { value: f._UseUv ?? 0 },
        uAspectY: { value: (f._UVAspectRatio ?? 0) === 0 ? 1 : 1.6087000370025635 },
      },
      vertexShader: `
        uniform float uHeight, uHeightPower, uScale, uFakeH, uUseUv, uAspectY;
        attribute vec4 tangent;
        attribute vec2 uv1;
        varying vec2 vUv;
        void main() {
          vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
          camObj.y += uFakeH;
          vec3 viewObj = normalize(camObj - position);
          vec3 n = normalize(normal);
          vec3 t = normalize(tangent.xyz);
          vec3 b = normalize(cross(n, t) * tangent.w);
          vec3 tv = normalize(vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj)));
          // Official vertex path: select UV0/UV1, scale around center, then add tangent-view offset.
          vec2 off = (tv.xy / (tv.z + 0.41999998688697815)) * (uHeightPower * (uHeight - 0.5));
          off.y *= uAspectY;
          vec2 srcUv = mix(uv, uv1, step(0.5, uUseUv));
          vUv = (((srcUv * 2.0) - 1.0) / uScale) * 0.5 + off + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          // Official fragment: no discard; sample the offset UV and premultiply before One/OneMinusSrcAlpha.
          vec4 t = texture2D(map, clamp(vUv, 0.0, 1.0));
          gl_FragColor = vec4(t.rgb * t.a, t.a);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
    m.userData.straight = false;
    return m;
  },
});

// ── effect (Lettuce/Common/CardNew/Effect): SR cards pack 3 sparkle layers in one _MainTex's R/G/B; the
// _LAYER_EFF1/2/3 keyword selects the channel, then _GradationMap (128×1 ramp) recolours it. Pokémon cards
// instead carry a separate full-colour EFF texture → drawn direct (plain textured). ──
defineMaterial("effect", {
  requires: (r, ctx) => !!ctx.layerTexDefault(r, "_MainTex"),
  build(r, ctx) {
    const f = r.floats || {};
    const kw = r.keywords || [];
    const exact = ctx.exactShaderPort(r, "Effect");
    if (exact) {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: ctx.exactPortUniforms(r, exact, (binding) => ctx.layerTexDefault(r, binding.slot)),
        vertexShader: exact.vert,
        fragmentShader: exact.frag,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      m.userData.straight = false;
      m.userData.exactShader = "Effect";
      m.userData.officialPassRuntime = exact.manifest.official_pass_runtime;
      m.userData.officialSelector = exact.manifest.official_selector;
      m.userData.officialExecutableIdentity = exact.manifest.official_executable_identity;
      return m;
    }
    const layer = f._Layer != null ? f._Layer : (kw.includes("_LAYER_EFF2") ? 1 : kw.includes("_LAYER_EFF3") ? 2 : 0);
    const grad = ctx.layerTexDefault(r, "_GradationMap");
    const useGrad = f._UseGradationMap != null ? f._UseGradationMap : (r.textures?._GradationMap ? 1 : 0);
    const stageSource = ctx.compatibleStageSource("Effect");
    if (stageSource) {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          _MainTex: { value: ctx.layerTexDefault(r, "_MainTex") },
          _GradationMap: { value: grad || ctx.layerTexDefault(r, "_MainTex") },
          _Layer: { value: layer },
          _UseGradationMap: { value: useGrad },
          _UseViewMask: { value: f._UseViewMask ?? (kw.includes("_UseViewMask") ? 1 : 0) },
          _MainPower: { value: f._MainPower ?? 1 },
          _MaskPower: { value: f._MaskPower ?? 0 },
          _AnglePower: { value: f._AnglePower ?? 0 },
          _Edge: { value: f._Edge ?? 0 },
          _Progress: { value: f._Progress ?? 0 },
          _AlphaBlend: { value: f._AlphaBlend ?? 1 },
          uDepthOffset: { value: f._DepthOffset ?? 0 },
        },
        vertexShader: stageSource.vert,
        fragmentShader: stageSource.frag,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      m.userData.stageSourceFallback = "Effect";
      return m;
    }
    return new THREE.ShaderMaterial({
      uniforms: {
        effTex: { value: ctx.layerTexDefault(r, "_MainTex") },
        gradMap: { value: grad || ctx.layerTexDefault(r, "_MainTex") },
        uLayer: { value: layer },
        uUseGrad: { value: useGrad },
        uUseViewMask: { value: f._UseViewMask ?? (kw.includes("_UseViewMask") ? 1 : 0) },
        uMainPower: { value: f._MainPower ?? 1 },
        uMaskPower: { value: f._MaskPower ?? 0 },
        uAnglePower: { value: f._AnglePower ?? 0 },
        uEdge: { value: f._Edge ?? 0 },
        uProgress: { value: f._Progress ?? 0 },
        uAlphaBlend: { value: f._AlphaBlend ?? 1 },
        uDepthOffset: { value: f._DepthOffset ?? 0 },
      },
      vertexShader: `
        uniform float uDepthOffset;
        attribute vec4 tangent;
        varying vec2 vUv;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
          vec3 n = normalize(normal);
          vec3 t = normalize(tangent.xyz);
          vec3 b = normalize(cross(n, t) * tangent.w);
          vec3 viewObj = normalize(camObj);
          vView = vec3(dot(t, viewObj), dot(b, viewObj), dot(n, viewObj));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          mvPosition.z -= uDepthOffset;
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform sampler2D effTex, gradMap;
        uniform float uLayer, uUseGrad, uUseViewMask, uMainPower, uMaskPower, uAnglePower, uEdge, uProgress, uAlphaBlend;
        varying vec2 vUv;
        varying vec3 vView;
        float layerValue(vec4 s) {
          return uLayer < 0.5 ? s.r : (uLayer < 1.5 ? s.g : s.b);
        }
        float edgeProgress(float raw) {
          float denom = max(abs(uEdge * 2.0), 0.000001);
          float t = (raw - uProgress + 2.0 * uEdge * (1.0 - uProgress)) / denom;
          t = clamp(t, 0.0, 1.0);
          return t * t * (3.0 - 2.0 * t);
        }
        void main() {
          vec4 e = texture2D(effTex, vUv);
          float raw = mix(e.a, layerValue(e), step(0.5, uUseGrad));
          float shaped = edgeProgress(raw);
          float gradU = mix(raw, shaped, step(0.5, uUseViewMask));
          vec3 baseRgb = mix(e.rgb, texture2D(gradMap, vec2(gradU, 0.5)).rgb, step(0.5, uUseGrad));
          vec3 poweredRgb = baseRgb * uMainPower;
          float poweredAlpha = raw * uMainPower;
          float alphaCore = poweredAlpha;
          if (uUseViewMask > 0.5) {
            float viewMask = texture2D(effTex, vUv + vView.xy * uAnglePower).a * uMaskPower;
            alphaCore = mix(shaped, poweredAlpha, viewMask);
          }
          gl_FragColor = vec4(poweredRgb * alphaCore, alphaCore * uAlphaBlend);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
  },
});

// ── frameOutline (Simple-Opaque): official fragment outputs _MainTex directly; this shared white texture
// gets its shape from the mesh geometry (the secondary MRT output is zero). ──
defineMaterial("frameOutline", {
  build(r, ctx) {
    const exact = texturedExactMaterial(r, ctx, "Simple-Opaque", false);
    if (exact) return exact;
    const ft = ctx.layerTex(r, "_MainTex");
    return new THREE.MeshBasicMaterial({ map: ft, side: THREE.DoubleSide, toneMapped: false });
  },
});
