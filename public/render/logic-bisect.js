export const LOGIC_BISECT_SCHEMA = "pocket-card-render/logic-bisect@1";

const CASES = [
  {
    id: "baseline",
    group: "基线",
    label: "正式基线",
    description: "不改变渲染逻辑，用来确认纹路出现的倾角。",
  },
  {
    id: "post-half-off",
    group: "二分 1/2",
    label: "关闭后处理半区",
    description: "同时关闭 Bloom 并绕过 Homography，用于一次排除整个后处理/展示分支。",
    disableBloom: true,
    bypassHomography: true,
  },
  {
    id: "draw-half-off",
    group: "二分 1/2",
    label: "关闭绘制半区",
    description: "同时切换 Parallax fallback、静止 UV，并关闭其 depth 写入与 stencil。",
    disableExactShaders: ["Card_Parallax"],
    freezeParallaxUv: true,
    disableParallaxDepthWrite: true,
    disableParallaxStencil: true,
  },
  {
    id: "raster-sampling-half",
    group: "二分 1/2",
    label: "增强栅格与采样",
    description: "源 MRT 提升到 2 倍，并给 Parallax 纹理启用 trilinear mip 与最大 anisotropy。",
    sourceRenderScale: 2,
    forceParallaxLowpass: true,
  },
  {
    id: "uv-input-half",
    group: "二分 1/2",
    label: "切换 Parallax UV 输入",
    description: "强制 Card_Parallax 使用 UV0，用于排除 GLTF UV1 顶点输入。",
    forceParallaxUv0: true,
  },
  {
    id: "hide-parallax-draws",
    group: "决定性排除",
    label: "隐藏全部 Parallax draw",
    description: "隐藏所有 Card_Parallax draw，验证纹路是否真的由该 shader family 产出。",
    hideParallaxDraws: true,
  },
  {
    id: "all-no-depth",
    group: "Composition",
    label: "Disable all depth",
    description: "Keep shader, blend, stencil, queue, and sort order; disable depth test/write for every card draw.",
    disableAllDepth: true,
  },
  {
    id: "canonical-object-clip",
    group: "Composition",
    label: "Canonical object clip",
    description: "Use the baseline identical object-to-clip expression for manifest-proven standard vertex programs.",
    canonicalizeObjectClipPosition: true,
  },
  {
    id: "raw-object-clip",
    group: "Composition",
    label: "Raw per-program clip",
    description: "Disable the WebGL cross-program position adaptation to reproduce coplanar depth interference.",
    disableCanonicalObjectClipPosition: true,
  },
  {
    id: "bisect-nonparallax",
    group: "图层二分",
    label: "Parallax 作为固定上下文",
    description: "显示已排除的 Parallax，但不把它们放入候选集合，只二分其余 draw。",
    excludeParallaxFromBisect: true,
  },
  {
    id: "bisect-effects",
    group: "图层二分",
    label: "保留背景，只二分特效",
    description: "结构层、主图、文字与 Parallax 固定显示，只二分透明特效、全息和 foil draw。",
    bisectEffectDraws: true,
  },
  {
    id: "no-homography",
    group: "展示链",
    label: "绕过 Homography",
    description: "直接显示卡片 MRT0，隔离最终透视展示与二次 FinalBlit。",
    bypassHomography: true,
  },
  {
    id: "no-bloom",
    group: "后处理",
    label: "关闭 Bloom",
    description: "保留 Homography，只停用 Bloom 合成。",
    disableBloom: true,
  },
  {
    id: "parallax-fallback",
    group: "Shader",
    label: "Parallax fallback",
    description: "停用 selector-bound Card_Parallax port，改用兼容实现。",
    disableExactShaders: ["Card_Parallax"],
  },
  {
    id: "parallax-static-uv",
    group: "Shader",
    label: "静止 Parallax UV",
    description: "保留 exact shader 和贴图，只把 _HeightPower 设为 0。",
    freezeParallaxUv: true,
  },
  {
    id: "parallax-no-depth-write",
    group: "Pass state",
    label: "关闭 Parallax depth 写入",
    description: "保留 depth test，只禁止 Card_Parallax 写入深度缓冲。",
    disableParallaxDepthWrite: true,
  },
  {
    id: "parallax-no-stencil",
    group: "Pass state",
    label: "关闭 Parallax stencil",
    description: "只关闭 Card_Parallax 的 stencil test，用于识别区域裁剪问题。",
    disableParallaxStencil: true,
  },
];

export const LOGIC_BISECT_CASES = Object.freeze(CASES.map((entry) => Object.freeze({
  ...entry,
  disableExactShaders: Object.freeze([...(entry.disableExactShaders || [])]),
})));

const CASE_BY_ID = new Map(LOGIC_BISECT_CASES.map((entry) => [entry.id, entry]));

export function resolveLogicBisectCase(id) {
  return CASE_BY_ID.get(id) || CASE_BY_ID.get("baseline");
}

export function logicBisectCaseUrl(currentUrl, caseId) {
  const selected = resolveLogicBisectCase(caseId);
  const next = new URL(currentUrl);
  next.searchParams.set("logicbisect", "1");
  next.searchParams.set("logiccase", selected.id);
  next.searchParams.delete("bisect");
  return next.href;
}
