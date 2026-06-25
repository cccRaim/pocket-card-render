// Base material strategies — the plain textured layers, the depth-parallax window, the SR effect
// sparkles, and the ShadowBox frame-outline ring. Shared by every rarity.
import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { SIMPLE_VS } from "../glsl.js";

const mainTexName = (r) => r.textures?._MainTex?.name || r.textures?._BaseTex?.name;
const hasMainTex = (r, ctx) => !!(ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex"));

// ── textured: a plain albedo quad (Card_Illust / Simple-Transparent / Frame) ──
defineMaterial("textured", {
  requires: hasMainTex,
  build(r, ctx) {
    const tex = ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex");
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    m.userData.straight = ctx.texStraight(mainTexName(r));
    return m;
  },
});

// ── depthParallax (Card_Parallax): per-layer virtual-depth parallax (decompiled from parallax_vert
// SPIR-V). Each quad is flat but the vertex shader offsets its UV along the tangent-space view direction
// scaled by _Height·_HeightPower·_Scale, so when the card tilts the layers shift at different depths
// (the window's 2.5D). At frontal view the offset is ~0 (view dir ≈ +Z). ──
defineMaterial("depthParallax", {
  requires: hasMainTex,
  build(r, ctx) {
    const f = r.floats;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: ctx.layerTex(r, "_MainTex") || ctx.layerTex(r, "_BaseTex") },
        uHeight: { value: f._Height ?? 0 }, uHeightPower: { value: f._HeightPower ?? 0 },
        uScale: { value: f._Scale ?? 1 }, uFakeH: { value: f._FakeCameraHeight ?? 0.19 },
      },
      vertexShader: `
        uniform float uHeight, uHeightPower, uScale, uFakeH;
        varying vec2 vUv;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 vdW = normalize(cameraPosition - wp.xyz);
          vec3 vdO = normalize((inverse(modelMatrix) * vec4(vdW, 0.0)).xyz);  // object/tangent space
          // offset magnitude = _Height·_HeightPower·_Scale (byte-traced). _HeightPower=0 → amt=0 → flat (sticks).
          float amt = uHeight * uHeightPower * uScale;
          vec2 off = (vdO.xy / (vdO.z * uScale + uFakeH + 0.42)) * amt;
          vUv = uv + off;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          // The real Card_Parallax FRAGMENT has NO discard (parx_frag.spv: OpKill 0) — sample the offset UV
          // with ClampToEdge and let the STENCIL clip the window (a UV-bounds discard = the window black border).
          gl_FragColor = texture2D(map, clamp(vUv, 0.0, 1.0));
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
    m.userData.straight = ctx.texStraight(mainTexName(r));
    return m;
  },
});

// ── effect (Lettuce/Common/CardNew/Effect): SR cards pack 3 sparkle layers in one _MainTex's R/G/B; the
// _LAYER_EFF1/2/3 keyword selects the channel, then _GradationMap (128×1 ramp) recolours it. Pokémon cards
// instead carry a separate full-colour EFF texture → drawn direct (plain textured). ──
defineMaterial("effect", {
  requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),
  build(r, ctx) {
    if (!ctx.layerTex(r, "_GradationMap")) {                 // Pokémon: full-colour EFF, draw direct
      const m = new THREE.MeshBasicMaterial({ map: ctx.layerTex(r, "_MainTex"), side: THREE.DoubleSide, toneMapped: false });
      m.userData.straight = ctx.texStraight(r.textures?._MainTex?.name);
      return m;
    }
    const kw = r.keywords || [];
    const ch = kw.includes("_LAYER_EFF2") ? 1 : kw.includes("_LAYER_EFF3") ? 2 : 0;   // EFF1→R, EFF2→G, EFF3→B
    return new THREE.ShaderMaterial({
      uniforms: {
        effTex: { value: ctx.layerTex(r, "_MainTex") }, gradMap: { value: ctx.layerTex(r, "_GradationMap") },
        uChannel: { value: ch }, uPower: { value: r.floats._MainPower ?? 1 },
      },
      vertexShader: SIMPLE_VS,
      fragmentShader: `
        uniform sampler2D effTex, gradMap;
        uniform float uChannel, uPower;
        varying vec2 vUv;
        void main() {
          vec4 e = texture2D(effTex, vUv);
          float v = uChannel < 0.5 ? e.r : (uChannel < 1.5 ? e.g : e.b);   // _LAYER_EFFx → channel
          v = pow(clamp(v, 0.0, 1.0), uPower);
          vec3 col = texture2D(gradMap, vec2(v, 0.5)).rgb;                  // gradation ramp colours the sparkle
          gl_FragColor = vec4(col * v, v);                                 // premultiplied; additive
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
  },
});

// ── frameOutline (Simple-Opaque): the rare-mark FLAME ring. ShadowBox shader whose visible colour is the
// BLACK secondary target (not the white placeholder) → render the ring black, masked by the texture coverage.
// The ring SHAPE is the mesh geometry; alphaTest (cfg-driven) cuts the atlas. ──
defineMaterial("frameOutline", {
  build(r, ctx) {
    const ft = ctx.layerTex(r, "_MainTex");
    return new THREE.MeshBasicMaterial({ color: 0x000000, map: ft, side: THREE.DoubleSide, toneMapped: false });
  },
});
