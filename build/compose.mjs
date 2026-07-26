// Node composer — turn (already-extracted UGUI layout + dynamic card text) into the positioned text elements
// the renderer's buildDynamicUITexture draws. This is the node equivalent of build_face.py/build_ui.py, but its
// LAYOUT comes from the hash-pinned official compact prefab contract; TEXT comes from
// carddata.mjs (masterdata+locale). Works for any card type covered by the two canonical UI prefabs.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCardData } from "./carddata.mjs";
import { inlineElementTypeFromSentinel } from "./card-text-resolver.mjs";
import { compactOfficialUIImageState } from "../public/render/official-ugui-image.js";
import {
  IDENTITY_UI_AFFINE,
  rectTransformUiAffine,
} from "../public/render/ui-affine-transform.js";
import {
  replayUGUIState,
  UGUI_STATE_REPLAY_SCHEMA,
} from "../public/render/ugui-state-reducer.js";
import {
  indexOfficialTmpFonts,
} from "../public/render/tmp-font-data.js";
import {
  resolveOfficialCardLayout,
} from "../public/render/official-card-layout.js";
import {
  resolveOfficialImgTagFontType,
} from "../public/render/official-img-tag-font-type.js";

function firstExistingDir(paths) {
  return paths.find((p) => p && existsSync(p)) || paths[0];
}

const OUTDIR = process.env.PCR_RECIPES || firstExistingDir([
  join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output"),
  join(import.meta.dirname, "..", "..", "apks", "output"),
]);
const ASSETS = join(OUTDIR, "..", "assets");
const UI_LAYOUT = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "card-ui-layout-contract.json"),
  "utf8",
));
if (UI_LAYOUT.schemaVersion !== 3) throw new Error("unsupported card UI layout contract schema");
const UI_RESOURCES = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "card-ui-resource-contract.json"),
  "utf8",
));
if (UI_RESOURCES.schemaVersion !== 1) throw new Error("unsupported card UI resource contract schema");
const TMP_SPRITE = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "tmp-sprite-contract.json"),
  "utf8",
));
if (TMP_SPRITE.schemaVersion !== 1) throw new Error("unsupported TMP sprite contract schema");
const CARD_TEXT_DESIGN = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "card-text-design-contract.json"),
  "utf8",
));
if (CARD_TEXT_DESIGN.schemaVersion !== 1) {
  throw new Error("unsupported card text design contract schema");
}
const LAYOUT_FITTERS = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "official-layout-fitters.json"),
  "utf8",
));
if (LAYOUT_FITTERS.schemaVersion !== 1) {
  throw new Error("unsupported official layout fitter contract schema");
}
const TMP_SETTINGS = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "tmp-settings-contract.json"),
  "utf8",
));
const TMP_FONT_MANIFEST = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "game", "tmp-fonts", "manifest.json"),
  "utf8",
));
const TMP_FONTS = indexOfficialTmpFonts(TMP_FONT_MANIFEST, TMP_SETTINGS);

const xy = (value) => [Number(value?.x || 0), Number(value?.y || 0)];
const xyScale = (value) => [Number(value?.x ?? 1), Number(value?.y ?? 1)];
const quaternion = (value) => [
  Number(value?.x ?? 0), Number(value?.y ?? 0), Number(value?.z ?? 0), Number(value?.w ?? 1),
];
const rgba = (value) => [
  Number(value?.r ?? 1), Number(value?.g ?? 1), Number(value?.b ?? 1), Number(value?.a ?? 1),
];
function contractNode(entry) {
  const rect = entry.rectTransform;
  const tmp = entry.tmp;
  return {
    gameObjectId: String(entry.gameObject.pathId),
    gameObjectObjectSha256: entry.gameObject.objectSha256,
    rectTransformId: String(rect.pathId),
    rectTransformObjectSha256: rect.objectSha256,
    tmpId: tmp ? String(tmp.pathId) : null,
    tmpEnabled: tmp ? Boolean(tmp.m_Enabled) : null,
    go: entry.gameObject.name,
    unityLayer: Number(entry.gameObject.layer),
    active: entry.gameObject.active,
    siblingIndex: Number(entry.siblingIndex || 0),
    pos: xy(rect.m_AnchoredPosition),
    size: xy(rect.m_SizeDelta),
    aMin: xy(rect.m_AnchorMin),
    aMax: xy(rect.m_AnchorMax),
    piv: xy(rect.m_Pivot),
    rotation: quaternion(rect.m_LocalRotation),
    scale: xyScale(rect.m_LocalScale),
    children: (entry.children || []).map(contractNode),
    style: tmp ? {
      fs: Number(tmp.m_fontSize),
      fsbase: Number(tmp.m_fontSizeBase),
      fsmin: Number(tmp.m_fontSizeMin),
      fsmax: Number(tmp.m_fontSizeMax),
      align: Number(tmp.m_HorizontalAlignment),
      valign: Number(tmp.m_VerticalAlignment),
      color: rgba(tmp.m_fontColor),
      componentColor: rgba(tmp.m_Color),
      autosize: Boolean(tmp.m_enableAutoSizing),
      wrap: Boolean(tmp.m_enableWordWrapping),
      key: tmp.fontGroupKey,
      fontWeight: Number(tmp.m_fontWeight),
      fontStyle: Number(tmp.m_fontStyle),
      characterSpacing: Number(tmp.m_characterSpacing),
      wordSpacing: Number(tmp.m_wordSpacing),
      lineSpacing: Number(tmp.m_lineSpacing),
      lineSpacingMax: Number(tmp.m_lineSpacingMax),
      paragraphSpacing: Number(tmp.m_paragraphSpacing),
      charWidthMaxAdj: Number(tmp.m_charWidthMaxAdj),
      wordWrappingRatios: Number(tmp.m_wordWrappingRatios),
      overflowMode: Number(tmp.m_overflowMode),
      kerning: Boolean(tmp.m_enableKerning),
      extraPadding: Boolean(tmp.m_enableExtraPadding),
      richText: Boolean(tmp.m_isRichText),
      parseCtrlCharacters: Boolean(tmp.m_parseCtrlCharacters),
      orthographic: Boolean(tmp.m_isOrthographic),
      margin: [tmp.m_margin.x, tmp.m_margin.y, tmp.m_margin.z, tmp.m_margin.w].map(Number),
      objectSha256: tmp.objectSha256,
    } : null,
    tagFontSizes: entry.tagFontSizes ? {
      element: Number(entry.tagFontSizes.element),
      ex: Number(entry.tagFontSizes.ex),
      pathId: entry.tagFontSizes.pathId,
      objectSha256: entry.tagFontSizes.objectSha256,
    } : null,
    image: entry.image || null,
    canvasRenderer: entry.canvasRenderer || null,
  };
}
const prefabs = UI_LAYOUT.prefabs.map((prefab) => ({
  kind: prefab.kind,
  prefab: prefab.bundle,
  tree: prefab.roots.map(contractNode),
}));

// TMP m_HorizontalAlignment / m_VerticalAlignment → css align (build_face.py:137) and the real dark face colour
// (white prefab placeholder → #231813, the font material's _FaceColor — build_face.py:63/319-323).
const ALIGN = { 1: "left", 2: "center", 4: "right", 8: "left", 16: "left" };
const VALIGN = { 256: "top", 512: "middle", 1024: "bottom" };
const DARK = [0.137, 0.094, 0.082];

// the localized trainer UI label sprites (Supporter / Trainer …) live in this atlas dir (extracted to apks/assets).
const TRAINER_UI = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUITrainersFormat5x5";
const POKEMON_UI5 = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5";
const POKEMON_UI8 = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat8x8";
const PUBLIC_GAME = join(import.meta.dirname, "..", "public", "game");
// locale → sprite filename suffix (the sprite files use _zh/_cn/_en/_jp…, distinct from the prefab node suffix).
const LOC_SUF = { zh_TW: "zh", zh_CN: "cn", en_US: "en", id_ID: "en", ja_JP: "jp", ko_KR: "ko", fr_FR: "fr",
                  de_DE: "de", es_ES: "es", es_419: "es", it_IT: "it", pt_BR: "pt" };
const sufFor = (lc) => LOC_SUF[lc] || lc.slice(0, 2).toLowerCase();
// trainer TYPE (top-left) label: prefab box-node prefix + sprite-file series, by Trainer.TrainerType.
const TRAINER_NODE_SUF = {
  ja_JP: "jp", en_US: "en_id", id_ID: "en_id", fr_FR: "fr", it_IT: "it", de_DE: "de",
  es_ES: "es_es419", es_419: "es_es419", ko_KR: "ko", zh_TW: "zh", pt_BR: "pt", zh_CN: "cn",
};
const CATEGORY_NODE_SUF = {
  ja_JP: "jp", en_US: "en", id_ID: "en", fr_FR: "fr", it_IT: "it", de_DE: "de",
  es_ES: "es", es_419: "es", ko_KR: "ko", zh_TW: "zh", zh_CN: "zh", pt_BR: "pt",
};
const EX_RULE_NODE_SUF = {
  ja_JP: "jp", en_US: "en", id_ID: "id", fr_FR: "fr", it_IT: "it", de_DE: "de",
  es_ES: "es_es419", es_419: "es_es419", ko_KR: "ko", zh_TW: "zh", zh_CN: "cn", pt_BR: "pt",
};
const ABILITY_NODE_SUF = {
  ja_JP: "jp_zh_cn", zh_TW: "jp_zh_cn", zh_CN: "jp_zh_cn", en_US: "en_id", id_ID: "en_id",
  fr_FR: "jp_fr", it_IT: "jp_it", de_DE: "jp_de", es_ES: "jp_es_es419", es_419: "jp_es_es419",
  ko_KR: "jp_ko", pt_BR: "pt",
};
const ABILITY_SPRITE_SUF = {
  ja_JP: "jp_zh", zh_TW: "jp_zh", zh_CN: "jp_zh", en_US: "en", id_ID: "en", fr_FR: "fr",
  it_IT: "it", de_DE: "de", es_ES: "es", es_419: "es", ko_KR: "ko", pt_BR: "pt",
};
const TRAINER_TYPE = {
  1: { name: "TxtSupportCardNameElm/txt_support_card_name_main", sub: "TxtSupportCardNameElm/txt_support_card_name_sub", label: "support_txt/support_txt_img", sprite: "card_txt_support" },
  2: { name: "TxtToolsCardNameElm/txt_tools_card_name_main", sub: "TxtToolsCardNameElm/txt_tools_card_name_sub", label: "goods_txt/tools_txt_img", sprite: "card_txt_tools" },
  3: { name: "TxtItemCardNameElm/txt_item_card_name_main", sub: "TxtItemCardNameElm/txt_item_card_name_sub", label: "item_txt/poketools_art_frm_ttl_img", sprite: "card_txt_pketools" },
  4: { name: "TxtFossilCardNameElm/txt_fossil_card_name_main", label: "goods_txt/tools_txt_img", sprite: "card_txt_tools" },
  5: { name: "TxtStadiumCardNameElm/txt_stadium_card_name_main", label: "stadium_txt/stadium_txt_img", sprite: "card_txt_stadium" },
};
const DAMAGE_SYMBOL = { 0: "", 1: "+", 2: "x", 3: "-" };
const ENERGY_ICON = {
  Grass: "01", Fire: "02", Water: "03", Lightning: "04", Psychic: "05",
  Fighting: "06", Darkness: "07", Metal: "08", Dragon: "09", Colorless: "10",
};
const STAGE_SPRITE = { 1: "card_pla_evo_basic", 2: "card_pla_evo_stage1", 3: "card_pla_evo_stage2" };

// font role by element name (build_face.py F_NAME/F_BODY/F_NUM): card names → name font, illustrator credit →
// Futura/num, everything else (rule/description) → body.
function fontRole(go) {
  if (/card_name|skill_name/i.test(go)) return "name";
  if (/illustrator|damage|TxtWeak/i.test(go)) return "num";
  return "body";
}

// Text outline is NOT blanket — it's whatever font PRESET the field's FontGroup _key selects, resolved to the
// preset material's locale-specific Default CardTextType material (public/render/card-font-contract.json).
// The FontGroup depends on the card LAYOUT: a full-art trainer (text
// OVER the illustration) uses `Trainers_OverNumber` → name/rule/illustrator get a white outline but the footer
// (`Rule`, which has no outline variant) stays plain; a windowed trainer uses `Trainers_Normal` → all plain.
const CARD_FONT = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "render", "card-font-contract.json"), "utf8"));
if (CARD_FONT.schemaVersion !== 2) throw new Error("unsupported card font contract schema");
const resolveFontStyle = (style) => style ? {
  ...style,
  font: style.fontId ? CARD_FONT.fonts?.[style.fontId] || null : null,
  material: style.materialId ? CARD_FONT.materials?.[style.materialId] || null : null,
} : null;
const sdfContract = (style) => style?.font && style?.material ? {
  fontId: style.fontId,
  materialId: style.materialId,
  pointSize: style.font.pointSize,
  gradientScale: style.material.gradientScale,
  faceDilate: style.material.faceDilate,
  outlineWidth: style.material.outlineWidth,
  outlineSoftness: style.material.outlineSoftness,
  scaleRatioA: style.material.scaleRatioA,
  weightNormal: style.material.weightNormal,
  weightBold: style.material.weightBold,
  perspectiveFilter: style.material.perspectiveFilter,
  sharpness: style.material.sharpness,
  faceColor: style.material.faceColor,
  outlineColor: style.material.outlineColor,
} : null;
const fontTable = (lc, group) => {
  const table = Object.fromEntries(Object.entries(CARD_FONT.groups?.[group] || {}).map(([key, preset]) => [
    key,
    preset ? (() => {
      const selected = CARD_FONT.locales?.[lc]?.presets?.[preset];
      if (!selected) return null;
      return {
        ...resolveFontStyle(selected),
        types: Object.fromEntries(Object.entries(selected.types || {}).map(([name, style]) => [name, resolveFontStyle(style)])),
      };
    })() : null,
  ]));
  const serializedType = CARD_TEXT_DESIGN.fontGroups?.[group]?.imgTagFontType;
  const imgTagFontType = resolveOfficialImgTagFontType(serializedType, group);
  Object.defineProperty(table, "imgTagFontType", {
    value: imgTagFontType,
    enumerable: false,
  });
  return table;
};

// recipe manifest for a card (per-card if present else per-type default) — used to tell full-art from windowed.
function officialTextDesign(cardId, illId) {
  if (!illId) {
    throw new Error(`official CardSettings illustration id is required for ${cardId}`);
  }
  const card = CARD_TEXT_DESIGN.cards?.[illId];
  if (!card) {
    throw new Error(
      `official CardSettings is unavailable for ${illId}; `
      + "the selected official Face snapshot cannot prove this card's text design",
    );
  }
  if (card.id !== cardId) {
    throw new Error(
      `official CardSettings ${illId} belongs to ${card.id}, not ${cardId}`,
    );
  }
  const design = CARD_TEXT_DESIGN.designs?.[card.design];
  if (!design) throw new Error(`official CardDesignSettings ${card.design} is absent`);
  if (!CARD_FONT.groups?.[card.fontGroup]) {
    throw new Error(
      `official FontGroupSettings ${card.fontGroup} for ${illId} is absent`,
    );
  }
  return {
    card,
    design,
    fontGroup: card.fontGroup,
    dynamicUIProgram: design.dynamicUIs,
    dynamicUI: Object.fromEntries(
      design.dynamicUIs.map((entry) => [entry.label, entry.target]),
    ),
  };
}

export function replayDynamicUIHierarchy(root, dynamicUIProgram = []) {
  const entries = [];
  function collect(node, parent = null) {
    const path = `${parent?.path || ""}/${node.go}`;
    const hierarchyOrder = entries.length;
    const entry = {
      node,
      identity: `node:${hierarchyOrder}`,
      path,
      hierarchyOrder,
      parentIdentity: parent?.identity || null,
      parentHierarchyOrder: parent?.hierarchyOrder ?? null,
    };
    entries.push(entry);
    for (const child of node.children || []) collect(child, entry);
  }
  collect(root);

  const entriesByPath = new Map();
  for (const entry of entries) {
    const matches = entriesByPath.get(entry.path) || [];
    matches.push(entry);
    entriesByPath.set(entry.path, matches);
  }
  const controlledIdentities = new Set();
  const groups = [];
  const operations = [];
  for (const [programIndex, program] of dynamicUIProgram.entries()) {
    const controllerPath = program?.controller?.path;
    if (!controllerPath) throw new Error("DynamicUI controller path is missing");
    const controllers = entriesByPath.get(controllerPath) || [];
    if (controllers.length !== 1) {
      throw new Error(
        `DynamicUI controller ${controllerPath} resolved to ${controllers.length} hierarchy nodes`,
      );
    }
    const controller = controllers[0];
    const candidates = entries
      .filter((entry) => entry.parentIdentity === controller.identity)
      .sort((left, right) => (
        left.node.siblingIndex - right.node.siblingIndex
        || left.hierarchyOrder - right.hierarchyOrder
      ));
    if (!candidates.length) {
      throw new Error(`DynamicUI controller ${controllerPath} has no direct children`);
    }
    const targetPath = program.target?.path || null;
    const targets = targetPath
      ? candidates.filter((entry) => entry.path === targetPath)
      : [];
    if (targetPath && targets.length !== 1) {
      throw new Error(
        `DynamicUI target ${targetPath} resolved to ${targets.length} direct children of ${controllerPath}`,
      );
    }
    const targetIdentity = targets[0]?.identity || null;
    const operationIndices = [];
    for (const candidate of candidates) {
      controlledIdentities.add(candidate.identity);
      operationIndices.push(operations.length);
      operations.push({
        opcode: "SetActive",
        target: candidate.identity,
        value: candidate.identity === targetIdentity,
      });
    }
    groups.push({
      programIndex,
      label: program.label,
      controllerPath,
      targetPath,
      candidates,
      operationIndices,
    });
  }

  const replay = replayUGUIState({
    schema: UGUI_STATE_REPLAY_SCHEMA,
    sprites: [],
    nodes: entries.map((entry) => ({
      identity: entry.identity,
      parent: entry.parentIdentity,
      siblingIndex: Number(entry.node.siblingIndex),
      initialActive: Boolean(entry.node.active),
      rectTransform: {
        localRotation: entry.node.rotation,
        localScale: [
          Number(entry.node.scale[0]),
          Number(entry.node.scale[1]),
          Number(entry.node.scale[2] ?? 1),
        ],
      },
      components: [],
    })),
    operations,
  });
  const stateByIdentity = new Map(
    replay.hierarchy.map((state) => [state.identity, state]),
  );
  return {
    entries,
    groups,
    controlledIdentities,
    replay,
    stateByIdentity,
  };
}

// UGUI RectTransform → normalised box {l,r,t,b}∈[0,1] AND the node's real TMP style, carried together so the
// composer is fully DATA-DRIVEN (fs/align/colour/autosize/wrap from the prefab, never guessed). Math = build_face.py:91-109.
export function resolveBoxes(root, dynamicUIProgram = []) {
  const out = {};
  const entries = [];
  const runtimeActiveByGameObjectId = new Map();
  const activeOverrides = new Map();
  const hierarchyReplay = replayDynamicUIHierarchy(root, dynamicUIProgram);
  let hierarchyOrder = 0;
  function walk(n, P) {
    const aL = P.L + n.aMin[0] * P.w, aR = P.L + n.aMax[0] * P.w;
    const aB = P.B + n.aMin[1] * P.h, aT = P.B + n.aMax[1] * P.h;
    const w = (aR - aL) + n.size[0], h = (aT - aB) + n.size[1];
    const pivX = aL + n.piv[0] * (aR - aL) + n.pos[0], pivY = aB + n.piv[1] * (aT - aB) + n.pos[1];
    const L = pivX - n.piv[0] * w, B = pivY - n.piv[1] * h;
    const uiTransform = rectTransformUiAffine({
      pivot: [pivX, pivY],
      rotation: n.rotation,
      scale: n.scale,
    }, P.uiTransform || IDENTITY_UI_AFFINE);
    const nodePath = (P.path || "") + "/" + n.go;
    const replayIdentity = `node:${hierarchyOrder}`;
    const replayState = hierarchyReplay.stateByIdentity.get(replayIdentity);
    if (!replayState) throw new Error(`UGUI replay lost hierarchy node ${replayIdentity}`);
    const runtimeGameObjectActive = replayState.selfActive;
    const activeInHierarchy = replayState.effectiveActive;
    const node = {
      go: n.go,
      unityLayer: n.unityLayer,
      gameObjectId: n.gameObjectId,
      gameObjectObjectSha256: n.gameObjectObjectSha256,
      rectTransformId: n.rectTransformId,
      rectTransformObjectSha256: n.rectTransformObjectSha256,
      tmpId: n.tmpId,
      L, R: L + w, B, T: B + h, w, h,
      style: n.style,
      tagFontSizes: n.tagFontSizes,
      image: n.image,
      canvasRenderer: n.canvasRenderer,
      prefabGameObjectActive: n.active,
      prefabActiveInHierarchy: P.prefabActiveInHierarchy !== false && n.active,
      runtimeGameObjectActive,
      dynamicUIControlled: hierarchyReplay.controlledIdentities.has(replayIdentity),
      hierarchyOrder: hierarchyOrder++,
      activeInHierarchy,
      uiTransform,
    };
    node.path = nodePath;
    runtimeActiveByGameObjectId.set(
      String(n.gameObjectId),
      runtimeGameObjectActive,
    );
    entries.push(node);
    out[n.go] = out[n.go] || node;             // first (highest) wins for duplicate names
    for (const c of (n.children || [])) walk(c, node);
  }
  // root rect centred at origin (its own size), matching the prefab canvas
  walk(root, { L: -root.size[0] / 2, B: -root.size[1] / 2, w: root.size[0], h: root.size[1], path: "" });
  const CW = root.size[0], CH = root.size[1];
  const box = (n) => ({
    l: (n.L + CW / 2) / CW, r: (n.R + CW / 2) / CW,
    t: (CH / 2 - n.T) / CH, b: (CH / 2 - n.B) / CH });
  const node = (g) => fromEntry(out[g]);
  // first node whose name starts with `prefix` (locale label variants e.g. support_txt_img_* all share ~one box).
  const nodeByPrefix = (prefix) => { const g = Object.keys(out).find((k) => k.startsWith(prefix)); return g ? node(g) : null; };
  const fromEntry = (n) => n ? {
    go: n.go,
    layoutNodeId: n.gameObjectId,
    gameObjectObjectSha256: n.gameObjectObjectSha256,
    rectTransformId: n.rectTransformId,
    rectTransformObjectSha256: n.rectTransformObjectSha256,
    tmpComponentId: n.tmpId,
    path: n.path,
    unityLayer: n.unityLayer,
    box: box(n),
    style: n.style,
    tagFontSizes: n.tagFontSizes,
    uiImage: compactOfficialUIImageState(n.image, n.canvasRenderer, n),
    uiTransform: n.uiTransform,
    prefabGameObjectActive: n.prefabGameObjectActive,
    prefabActiveInHierarchy: n.prefabActiveInHierarchy,
    runtimeGameObjectActive: n.runtimeGameObjectActive,
    activeInHierarchy: n.activeInHierarchy,
    dynamicUIControlled: n.dynamicUIControlled,
    hierarchyOrder: n.hierarchyOrder,
  } : null;
  const nodeByPath = (suffix) => fromEntry(entries.find((n) => n.path.endsWith(suffix)));
  const nodesByPath = (suffix) => entries.filter((n) => n.path.endsWith(suffix)).map(fromEntry);
  const nodeByPrefixPath = (prefix) => fromEntry(entries.find((n) => n.path.split("/").pop().startsWith(prefix)));
  const setActive = (target, value) => {
    if (!target?.layoutNodeId) {
      throw new Error("official layout active override target is absent");
    }
    activeOverrides.set(String(target.layoutNodeId), Boolean(value));
  };
  const setActiveCount = (targets, count) => {
    const enabledCount = Math.max(0, Math.min(Number(count) || 0, targets.length));
    targets.forEach((target, index) => setActive(target, index < enabledCount));
  };
  const dynamicUIState = hierarchyReplay.groups.map((group) => ({
    label: group.label,
    controllerPath: group.controllerPath,
    targetPath: group.targetPath,
    operationIndices: group.operationIndices,
    candidates: group.candidates.map((candidate) => {
      const state = hierarchyReplay.stateByIdentity.get(candidate.identity);
      return {
        path: candidate.path,
        hierarchyOrder: candidate.hierarchyOrder,
        active: state.selfActive,
        effectiveActive: state.effectiveActive,
      };
    }),
  }));
  const dynamicUIReplay = {
    schema: hierarchyReplay.replay.schema,
    operationCount: hierarchyReplay.replay.appliedOperations.length,
    appliedOperations: hierarchyReplay.replay.appliedOperations.map((operation) => {
      const target = hierarchyReplay.entries.find(
        (entry) => entry.identity === operation.target,
      );
      return {
        operationIndex: operation.operationIndex,
        opcode: operation.opcode,
        targetPath: target.path,
        targetHierarchyOrder: target.hierarchyOrder,
        value: operation.value,
      };
    }),
  };
  return {
    node,
    nodeByPrefix,
    nodeByPath,
    nodesByPath,
    nodeByPrefixPath,
    dynamicUIState,
    dynamicUIReplay,
    root,
    runtimeActiveByGameObjectId,
    activeOverrides,
    setActive,
    setActiveCount,
    CW,
    CH,
  };
}

// a localized label SPRITE (Supporter / Trainer …) drawn as an icon at its real prefab box. `prefix` = sprite-file
// series; falls back to the no-locale sprite, else null (skip) — never invents a position.
function labelIcon(nodeObj, prefix, lc) {
  if (!nodeObj) return null;
  const official = officialPrefabIcon(nodeObj, "stretch");
  if (official) return official;
  for (const suf of [sufFor(lc), ""]) {
    const rel = `${TRAINER_UI}/${prefix}${suf ? "_" + suf : ""}.png`;
    if (existsSync(join(ASSETS, rel))) return officialIcon(nodeObj, "/game/" + rel, "stretch");
  }
  return null;
}

function officialIcon(nodeObj, url, fallbackFit = "contain", extra = {}) {
  const element = {
    kind: "icon",
    box: nodeObj.box,
    layoutNodeId: nodeObj.layoutNodeId,
    gameObjectObjectSha256: nodeObj.gameObjectObjectSha256,
    rectTransformId: nodeObj.rectTransformId,
    rectTransformObjectSha256: nodeObj.rectTransformObjectSha256,
    fit: fallbackFit,
    url,
    layoutPath: nodeObj.path,
    unityLayer: nodeObj.unityLayer,
    uiTransform: nodeObj.uiTransform,
    hierarchyOrder: nodeObj.hierarchyOrder,
    ...extra,
  };
  if (nodeObj.uiImage) {
    element.uiImage = nodeObj.uiImage;
    element.fit = nodeObj.uiImage.preserveAspect ? "contain" : "stretch";
    element.color = nodeObj.uiImage.color;
  }
  return element;
}

function officialPrefabIcon(nodeObj, fit = "stretch", extra = {}) {
  const imageHash = nodeObj?.uiImage?.imageObjectSha256;
  const url = imageHash ? UI_RESOURCES.images?.[imageHash]?.sprite?.texture?.url : null;
  if (!url || !existsSync(join(ASSETS, url.replace(/^\/game\//, "")))) return null;
  return officialIcon(nodeObj, url, fit, extra);
}

function publicIcon(nodeObj, rel, fit = "contain", extra = {}) {
  if (!nodeObj || !existsSync(join(PUBLIC_GAME, rel))) return null;
  return officialIcon(nodeObj, "/game/" + rel, fit, extra);
}

function pokemonUiSprite(nodeObj, prefix, lc, fit = "stretch", extra = {}) {
  if (!nodeObj) return null;
  const official = officialPrefabIcon(nodeObj, fit, extra);
  if (official) return official;
  const base = `${POKEMON_UI5}/${prefix}`;
  const candidates = [
    `${base}_${sufFor(lc)}.png`,
    `${base}_${sufFor(lc) === "es" ? "es_it" : sufFor(lc)}.png`,
    `${base}_en.png`,
    `${base}.png`,
  ];
  for (const rel of candidates) {
    if (existsSync(join(PUBLIC_GAME, rel))) return officialIcon(nodeObj, "/game/" + rel, fit, extra);
  }
  return null;
}

function energyIcon(nodeObj, type, fit = "contain", extra = {}) {
  const code = ENERGY_ICON[type];
  return code ? publicIcon(nodeObj, `${POKEMON_UI8}/card_icn_attribute_${code}.png`, fit, extra) : null;
}

function inlineElementSprites(text, fontStyle, color) {
  const sprites = {};
  const contract = CARD_FONT.inlineElements;
  if (!contract) return sprites;
  const materialKind = fontStyle?.outline
    ? "BlackWithWhiteOutline"
    : color?.slice(0, 3).every((value) => value > 0.9) ? "White" : "Black";
  const font = CARD_FONT.fonts?.[contract.fontId];
  const materialId = contract.materialIds?.[materialKind];
  const material = CARD_FONT.materials?.[materialId];
  for (const character of String(text || "")) {
    const type = inlineElementTypeFromSentinel(character);
    const glyph = contract.glyphs?.[type];
    if (!glyph || !font || !material || sprites[character]) continue;
    sprites[character] = {
      type,
      glyph,
      fontSize: contract.defaultFontSize,
      sdf: sdfContract({ fontId: contract.fontId, materialId, font, material }),
    };
  }
  return sprites;
}

function inlineExSpriteBinding(nodeObj, fontType) {
  const spriteIndex = TMP_SPRITE.preprocessor.fontTypeToSpriteIndex[fontType];
  if (!Number.isInteger(spriteIndex)) {
    throw new Error(`official TMP EX sprite has no FontType ${fontType}`);
  }
  const spriteCharacter = TMP_SPRITE.spriteAsset.characters.find(
    (entry) => entry.glyphIndex === spriteIndex,
  );
  if (!spriteCharacter) {
    throw new Error(`official TMP EX sprite index ${spriteIndex} is absent`);
  }
  return {
    spriteAssetId: TMP_SPRITE.spriteAsset.pathId,
    materialId: TMP_SPRITE.material.pathId,
    textureId: TMP_SPRITE.texture.pathId,
    textureUrl: TMP_SPRITE.texture.url,
    spriteIndex,
    characterName: spriteCharacter.name,
    fontType,
    fontSize: Number(
      nodeObj?.tagFontSizes?.ex
        || TMP_SPRITE.preprocessor.defaultFontSize,
    ),
    tagSizePathId: nodeObj?.tagFontSizes?.pathId || null,
    tagSizeObjectSha256: nodeObj?.tagFontSizes?.objectSha256 || null,
  };
}

function energyOutline(nodeObj, fit = "contain", extra = {}) {
  return publicIcon(nodeObj, `${POKEMON_UI8}/card_icn_attribute_outline.png`, fit, extra);
}

function categoryElements(layout, categories, lc, root) {
  const active = new Set(categories || []);
  const els = [];
  const nodeSuffix = CATEGORY_NODE_SUF[lc] || "en";

  if (root === "/PokemonCardUI" && active.has(1)) {
    const shadow = publicIcon(
      layout.nodeByPath(`${root}/UltraBeastView/ub_txt_img_shadow`),
      `${POKEMON_UI5}/card_plate_ub_shadow.png`,
      "stretch",
      { sprite: "card_plate_ub_shadow", category: "ultraBeast" },
    );
    const label = publicIcon(
      layout.nodeByPath(`${root}/UltraBeastView/ub_txt_img_${TRAINER_NODE_SUF[lc] || "en_id"}`),
      `${POKEMON_UI5}/card_plate_ub_${sufFor(lc)}.png`,
      "stretch",
      { sprite: `card_plate_ub_${sufFor(lc)}`, category: "ultraBeast" },
    );
    if (shadow) els.push(shadow);
    if (label) els.push(label);
  }

  for (const [category, kind] of [[2, "ancient"], [3, "future"]]) {
    if (!active.has(category)) continue;
    const plate = publicIcon(
      layout.nodeByPath(`${root}/${kind === "ancient" ? "AncientView" : "FutureView"}/${kind}_txt_img_${nodeSuffix}`),
      `${POKEMON_UI5}/card_plate_${kind}_${nodeSuffix}.png`,
      "stretch",
      { sprite: `card_plate_${kind}_${nodeSuffix}`, category: kind },
    );
    const mask = publicIcon(
      layout.nodeByPath(`${root}/${kind === "ancient" ? "AncientView" : "FutureView"}/${kind}_txt_img_${nodeSuffix}_mask`),
      `${POKEMON_UI5}/card_pokemon_${kind}_logo_mask_${nodeSuffix}.png`,
      "stretch",
      { sprite: `card_pokemon_${kind}_logo_mask_${nodeSuffix}`, category: kind, mask: true },
    );
    if (plate) els.push(plate);
    if (mask) els.push(mask);
  }
  return els;
}

function pokemonAbilityElements(layout, ability, lc, ol) {
  const root = "/PokemonCardUI/PokemonSkillContainerView/PokemonAbilityContainerView/ability_elm";
  const iconRoot = `${root}/ability_name_elm/ability_icn`;
  const els = [];
  const base = publicIcon(
    layout.nodeByPath(`${iconRoot}/ability_icn_img`),
    `${POKEMON_UI5}/card_pla_ability.png`,
    "stretch",
    { sprite: "card_pla_ability", abilityPlate: "base" },
  );
  const spriteSuffix = ABILITY_SPRITE_SUF[lc] || "en";
  const localized = publicIcon(
    layout.nodeByPath(`${iconRoot}/ability_icn_txt_img_${ABILITY_NODE_SUF[lc] || "en_id"}`),
    `${POKEMON_UI5}/card_plate_ability_txt_${spriteSuffix}.png`,
    "stretch",
    { sprite: `card_plate_ability_txt_${spriteSuffix}`, abilityPlate: "locale" },
  );
  const name = textEl(layout.nodeByPath(`${root}/ability_name_elm/ability_name_txt`), ability.name, ol);
  const desc = textEl(
    layout.nodeByPath(`${root}/ability_description_txt`),
    ability.desc || "",
    ol,
    { allowEmpty: true },
  );
  if (base) els.push(base);
  if (localized) els.push(localized);
  if (name) els.push(name);
  if (desc) els.push(desc);
  return els;
}

function nameWithoutEx(name, isEX) {
  return isEX ? String(name || "").replace(/\s*ex$/i, "") : name;
}

function pokemonNameLayoutPath(cardData) {
  if (cardData.isMega) return "/PokemonCardUI/mega_name_elm/card_name_txt";
  const nodeName = /\r\n|\r|\n/.test(String(cardData.name || ""))
    ? "card_name_two_line_txt"
    : "card_name_txt";
  return `/PokemonCardUI/name_elm/${nodeName}`;
}

function prefabTree(name) {
  const kind = name.startsWith("Pokemon") ? "pokemon" : "trainer";
  const e = prefabs.find((candidate) => candidate.kind === kind);
  return e ? e.tree[0] : null;
}

// Build a text draw-op from a resolved node + string — fs/align/colour/autosize/wrap ALL from the node's real
// prefab TMP style (build_face.py parity). White placeholder colour → the real dark face colour. Returns null
// if the node/string is missing, so callers can .filter(Boolean).
function textEl(node, text, outlineTbl, { allowEmpty = false } = {}) {
  if (!node || !node.style || text == null || (!allowEmpty && text === "")) return null;
  const s = node.style;
  let color = s.color.slice();
  if (color[0] > 0.9 && color[1] > 0.9 && color[2] > 0.9) color = [...DARK, color[3] ?? 1];
  const el = { kind: "text", text, box: node.box,
               layoutNodeId: node.layoutNodeId,
               tmpComponentId: node.tmpComponentId,
               gameObjectObjectSha256: node.gameObjectObjectSha256,
               rectTransformId: node.rectTransformId,
               rectTransformObjectSha256: node.rectTransformObjectSha256,
               layoutPath: node.path, unityLayer: node.unityLayer,
               uiTransform: node.uiTransform,
               hierarchyOrder: node.hierarchyOrder,
               font: fontRole(node.go),
               fs: s.fs, fsbase: s.fsbase, fsmin: s.fsmin, fsmax: s.fsmax,
               align: ALIGN[s.align] || "left", valign: VALIGN[s.valign] || "middle",
               horizontalAlignment: s.align, verticalAlignment: s.valign,
               color, vertexColor: s.color.slice(),
               fontWeight: s.fontWeight, fontStyle: s.fontStyle,
               characterSpacing: s.characterSpacing, wordSpacing: s.wordSpacing,
               lineSpacing: s.lineSpacing, lineSpacingMax: s.lineSpacingMax,
               paragraphSpacing: s.paragraphSpacing, charWidthMaxAdj: s.charWidthMaxAdj,
               wordWrappingRatios: s.wordWrappingRatios, overflowMode: s.overflowMode,
               kerning: s.kerning, richText: s.richText, parseCtrlCharacters: s.parseCtrlCharacters,
               margin: s.margin, layoutObjectSha256: s.objectSha256 };
  // outline iff this field's FontGroup preset (keyed by the prefab _key) carries one — data, never blanket.
  const fontStyle = outlineTbl && s.key != null ? outlineTbl[s.key] : null;
  const outline = fontStyle?.outline;
  if (outline) el.outline = { color: outline.color, width: outline.width };
  el.sdf = sdfContract(fontStyle);
  const inlineSprites = inlineElementSprites(text, fontStyle, color);
  if (Object.keys(inlineSprites).length) el.inlineSprites = inlineSprites;
  if (String(text).includes("\x03")) {
    el.inlineEx = inlineExSpriteBinding(node, outlineTbl.imgTagFontType);
  }
  const boldStyle = fontStyle?.types?.Bold;
  if (boldStyle?.font && boldStyle?.material) {
    el.boldStyle = {
      fontId: boldStyle.fontId,
      materialId: boldStyle.materialId,
      fontFamily: boldStyle.font.family,
      fontStyle: boldStyle.font.style,
      outline: boldStyle.outline,
      sdf: sdfContract(boldStyle),
    };
  }
  if (s.wrap) el.wrap = true;
  // autosize (shrink-to-fit width) only for a real-width box; a point-anchored box (w≈0, e.g. illustrator)
  // overflows in-engine, so shrinking it to fit width 0 would vanish the text — keep the authored fs.
  if (s.autosize && (node.box.r - node.box.l) > 0.02) el.autosize = true;
  return el;
}

function finalizeOfficialLayout(layout, kind, elements) {
  return resolveOfficialCardLayout({
    kind,
    root: layout.root,
    fitterContract: LAYOUT_FITTERS,
    elements,
    fonts: TMP_FONTS,
    spriteContract: TMP_SPRITE,
    runtimeActiveByGameObjectId: layout.runtimeActiveByGameObjectId,
    activeOverrides: layout.activeOverrides,
  });
}

function pokemonAttackElements(layout, attack, basePath, ol) {
  const { nodeByPath, nodesByPath } = layout;
  const els = [];
  const energyNodes = nodesByPath(`${basePath}/SkillName/PokemonCardFaceEnergyContainerView/CardEnergyIconView`);
  layout.setActiveCount(energyNodes, (attack.cost || []).length);
  (attack.cost || []).slice(0, energyNodes.length).forEach((type, i) => {
    const outline = energyOutline(energyNodes[i]);
    const icon = energyIcon(energyNodes[i], type);
    if (outline) els.push(outline);
    if (icon) els.push(icon);
  });
  const name = textEl(nodeByPath(`${basePath}/SkillName/skill_name_txt`), attack.name, ol);
  if (name) { name.font = "name"; name.autosize = true; name.fsmin = name.fsmin || name.fs * 0.1; els.push(name); }
  const damage = textEl(
    nodeByPath(`${basePath}/SkillName/damage_num_elm/damage_txt`),
    attack.damage ? String(attack.damage) : "",
    ol,
    { allowEmpty: true },
  );
  if (damage) { damage.font = "num"; els.push(damage); }
  const symbol = textEl(
    nodeByPath(`${basePath}/SkillName/damage_num_elm/plus_txt`),
    DAMAGE_SYMBOL[attack.damageSymbol] ?? "",
    ol,
    { allowEmpty: true },
  );
  if (symbol) {
    symbol.font = "num";
    symbol.damageSymbol = attack.damageSymbol;
    symbol.evidence = attack.damageSymbol <= 1 ? "exact" : "inferred";
    els.push(symbol);
  }
  const desc = textEl(
    nodeByPath(`${basePath}/skill_description_txt`),
    attack.desc || "",
    ol,
    { allowEmpty: true },
  );
  if (desc) els.push(desc);
  return els;
}

function composePokemonFace(cd, lc, officialDesign) {
  const tree = prefabTree("PokemonCardUI");
  if (!tree) throw new Error("PokemonCardUI layout is absent from the official layout contract");
  const layout = resolveBoxes(tree, officialDesign.dynamicUIProgram);
  const { node, nodeByPath, nodeByPrefixPath, nodesByPath, CW, CH } = layout;
  const ol = fontTable(lc, officialDesign.fontGroup);
  const els = [];

  const topEnergyRoot = "/PokemonCardUI/energy_view/CardEnergyIconView";
  const topEnergyOutline = energyOutline(nodeByPath(`${topEnergyRoot}/Outline`));
  const topEnergy = energyIcon(nodeByPath(`${topEnergyRoot}/icn_gra_img`), cd.type);
  if (topEnergyOutline) els.push(topEnergyOutline);
  if (topEnergy) els.push(topEnergy);
  const stagePrefix = STAGE_SPRITE[cd.stage];
  if (stagePrefix) {
    const stageSuffix = TRAINER_NODE_SUF[lc] || "en_id";
    const stageNode = nodeByPath(`/PokemonCardUI/PokemonSourceView/phase_elm/phase${cd.stage}_txt/phase_txt_img_0${cd.stage}_${stageSuffix}`);
    const stage = pokemonUiSprite(stageNode, stagePrefix, lc, "stretch");
    if (stage) els.push(stage);
  }
  if (cd.evolutionSource) {
    const sourceRoot = "/PokemonCardUI/PokemonSourceView/source_elm";
    const sourceText = textEl(nodeByPath(`${sourceRoot}/source_txt`), cd.evolutionSource.text, ol);
    const sourceImage = publicIcon(
      nodeByPath(`${sourceRoot}/source_img`),
      `Assets/Lettuce/_Data/Common/CardNew/Pokemon/${cd.evolutionSource.characterId}/${cd.evolutionSource.characterId}.png`,
      "contain",
      { sourceCharacterId: cd.evolutionSource.characterId },
    );
    if (sourceImage) els.push(sourceImage);
    if (sourceText) els.push(sourceText);
  }
  els.push(...categoryElements(layout, cd.additionalCategories, lc, "/PokemonCardUI"));
  const namePath = pokemonNameLayoutPath(cd);
  const name = textEl(nodeByPath(namePath), nameWithoutEx(cd.name, cd.isEX), ol);
  if (name) {
    name.autosize = true; name.fsmin = name.fsmin || name.fs * 0.1;
    if (cd.isEX) {
      const nameElmPath = cd.isMega
        ? "/PokemonCardUI/mega_name_elm"
        : "/PokemonCardUI/name_elm";
      const exPath = `${nameElmPath}/Ex`;
      const exVariantPath = `${exPath}/${cd.isMega ? "MegaEX" : "EX"}`;
      const nameElm = nodeByPath(nameElmPath);
      const exParent = nodeByPath(exPath);
      if (!nameElm || !exParent) {
        throw new Error(`official Pokemon EX hierarchy is absent for ${officialDesign.design.name}`);
      }
      name.nameExLayout = {
        contractId: "PokemonCardNameView.UpdateExLayout",
        parentPath: exPath,
        anchorX: nameElm.box.l,
        authoredParentX: exParent.box.l,
        maxW: 300 / CW,
      };
      const exLayers = [];
      const exOutlineTarget = officialDesign.dynamicUI.ExOutlineWhite;
      if (!cd.isMega && exOutlineTarget) {
        exLayers.push([
          "white-outline",
          exOutlineTarget.path,
          {
            dynamicUILabel: "ExOutlineWhite",
            dynamicUIDesign: officialDesign.design.name,
          },
        ]);
      }
      exLayers.push(
        ["base", `${exVariantPath}/ImgEx`, {}],
        ["outline", `${exVariantPath}/ImgExOutline`, {}],
      );
      for (const [layer, layoutPath, extra] of exLayers) {
        const icon = officialPrefabIcon(nodeByPath(layoutPath), "stretch", {
          ...extra,
          nameExLayer: layer,
          nameExOwnerPath: namePath,
        });
        if (!icon) {
          throw new Error(`official Pokemon EX Image is absent at ${layoutPath}`);
        }
        els.push(icon);
      }
    }
    els.push(name);
  }
  if (cd.hp) {
    const hpLabel = textEl(
      nodeByPath("/PokemonCardUI/hp_elm/hp_txt_elm/hp_txt"),
      cd.ui.hpLabel || "HP",
      ol,
    );
    const hpNumber = textEl(
      nodeByPath("/PokemonCardUI/hp_elm/hp_num_txt"),
      String(cd.hp),
      ol,
    );
    if (hpLabel) els.push(hpLabel);
    if (hpNumber) {
      hpNumber.font = "num";
      els.push(hpNumber);
    }
  }

  const attacks = cd.attacks || [];
  const abilities = cd.abilities || [];
  const abilityBranch = nodeByPath(
    "/PokemonCardUI/PokemonSkillContainerView/PokemonAbilityContainerView",
  );
  const oneAttackBranch = nodeByPath(
    "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_01",
  );
  const twoAttackBranch = nodeByPath(
    "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_02",
  );
  const usesAbilityBranch = abilities.length === 1 && attacks.length === 1;
  const usesTwoAttackBranch = !usesAbilityBranch && attacks.length >= 2;
  const usesOneAttackBranch = !usesAbilityBranch && !usesTwoAttackBranch
    && attacks.length === 1;
  layout.setActive(abilityBranch, usesAbilityBranch);
  layout.setActive(oneAttackBranch, usesOneAttackBranch);
  layout.setActive(twoAttackBranch, usesTwoAttackBranch);
  if (usesAbilityBranch) {
    els.push(...pokemonAbilityElements(layout, abilities[0], lc, ol));
    els.push(...pokemonAttackElements(layout, attacks[0], "/PokemonCardUI/PokemonSkillContainerView/PokemonAbilityContainerView/PokemonAttackView", ol));
  } else if (usesTwoAttackBranch) {
    els.push(...pokemonAttackElements(layout, attacks[0], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_02/PokemonAttackView1", ol));
    els.push(...pokemonAttackElements(layout, attacks[1], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_02/PokemonAttackView2", ol));
  } else if (usesOneAttackBranch) {
    els.push(...pokemonAttackElements(layout, attacks[0], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_01/PokemonAttackView", ol));
  }

  const weakLabel = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/weak_txt"), cd.ui.weakLabel, ol);
  if (weakLabel) els.push(weakLabel);
  const weakIcon = energyIcon(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/energy_icon/CardEnergyIconView"), cd.weakness);
  if (weakIcon) els.push(weakIcon);
  const weakSign = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/TxtWeakSign"), cd.weakness ? "+" : "", ol);
  if (weakSign) { weakSign.font = "num"; els.push(weakSign); }
  const weakVal = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/TxtWeakValue"), cd.weakness ? "20" : "", ol);
  if (weakVal) { weakVal.font = "num"; els.push(weakVal); }

  const retreatLabel = textEl(nodeByPrefixPath("escape_txt_"), cd.ui.retreatLabel, ol);
  if (retreatLabel) els.push(retreatLabel);
  const retreatNodes = nodesByPath("/PokemonCardUI/PokemonEscapeView/Attributes/CardEnergyIconView");
  layout.setActiveCount(retreatNodes, cd.retreat || 0);
  for (let i = 0; i < Math.min(cd.retreat || 0, retreatNodes.length); i++) {
    const icon = energyIcon(retreatNodes[i], "Colorless");
    if (icon) els.push(icon);
  }

  if (!cd.isMega) {
    const flavor = textEl(
      nodeByPath("/PokemonCardUI/library_flavor_txt"),
      cd.flavor,
      ol,
    );
    if (flavor) els.push(flavor);
  }

  if (cd.illustrator) {
    const illustratorLabel = textEl(
      nodeByPath(
        "/PokemonCardUI/CollectionView/illustrator_elm/illust_width_elm/Illustrator_txt",
      ),
      "Illus.",
      ol,
    );
    const illustratorName = textEl(
      nodeByPath(
        "/PokemonCardUI/CollectionView/illustrator_elm/name_width_elm/illustrator_name_txt",
      ),
      cd.illustrator,
      ol,
    );
    if (illustratorLabel) els.push(illustratorLabel);
    if (illustratorName) els.push(illustratorName);
  }

  if (cd.isEX) {
    const root = cd.isMega ? "/PokemonCardUI/PokemoMegaExRuleView" : "/PokemonCardUI/PokemonExRuleView";
    const shadow = publicIcon(nodeByPath(`${root}/frm_bg_shadow`), `${POKEMON_UI5}/card_pla_rule_bg_shadow.png`, "stretch", { sprite: "card_pla_rule_bg_shadow" });
    const bg = publicIcon(nodeByPath(`${root}/frm_bg`), `${POKEMON_UI5}/card_pla_rule_bg.png`, "stretch", { sprite: "card_pla_rule_bg" });
    const titleBg = publicIcon(nodeByPath(`${root}/frm`), `${POKEMON_UI5}/card_pla_rule_txt_bg.png`, "stretch", { sprite: "card_pla_rule_txt_bg" });
    if (shadow) els.push(shadow);
    if (bg) els.push(bg);
    if (titleBg) els.push(titleBg);
    const ruleSuffix = EX_RULE_NODE_SUF[lc] || "en";
    const ttl = pokemonUiSprite(
      nodeByPath(`${root}/ex_rule_ttl_txt/ex_rule_ttl_txt_${ruleSuffix}`),
      "card_pla_rule_txt",
      lc,
      "stretch",
      { sprite: "card_pla_rule_txt" },
    );
    if (ttl) els.push(ttl);
    const bodyNode = nodeByPath(
      `${root}/${cd.isMega ? "ex_rule_description_txt_02" : "ex_rule_description_txt_01"}`,
    );
    const body = textEl(bodyNode, cd.ui.exRuleBody, ol);
    if (body) {
      const fontType = cd.isMega
        ? TMP_SPRITE.preprocessor.pokemonRuleSelection.megaEx
        : TMP_SPRITE.preprocessor.pokemonRuleSelection.normalEx;
      body.inlineEx = inlineExSpriteBinding(bodyNode, fontType);
      body.indent = (cd.ui.exRuleIndent || 0) / CW;
      body.layoutIndent = Number(cd.ui.exRuleIndent || 0);
      if (!cd.isMega) {
        // PokemonCardRuleView switches the normal EX body from the authored compact
        // placeholder size to the TMP base size, then lets TMP wrap and shrink it.
        body.fs = body.fsbase;
        body.fsmax = body.fsbase;
        body.fsmin = body.fsbase / 2;
        body.wrap = true;
        body.autosize = true;
      }
      els.push(body);
    }
  }

  const resolvedLayout = finalizeOfficialLayout(layout, "pokemon", els);
  return {
    card: cd.cardId,
    locale: lc,
    kind: "pokemon",
    design: officialDesign.design.name,
    fontCondition: officialDesign.card.fontCondition,
    fontGroup: officialDesign.fontGroup,
    branchEvidence: "official-card-design-settings",
    dynamicUI: officialDesign.dynamicUI,
    dynamicUIState: layout.dynamicUIState,
    dynamicUIReplay: layout.dynamicUIReplay,
    layoutRuntime: resolvedLayout.diagnostics,
    canvasWH: [Math.round(CW), Math.round(CH)],
    elements: resolvedLayout.elements,
  };
}

export function composeFace(cardId, lc = "zh_TW", illId = "") {
  const cd = buildCardData(cardId, lc);
  const officialDesign = officialTextDesign(cardId, illId);

  if (cd.kind === "trainer") {
    const tree = prefabTree("TrainersCardUI");
    if (!tree) throw new Error("TrainersCardUI layout is absent from the official layout contract");
    const layout = resolveBoxes(tree, officialDesign.dynamicUIProgram);
    const { nodeByPath, CW, CH } = layout;
    const type = TRAINER_TYPE[cd.trainerType];
    if (!type) throw new Error(`unsupported TrainerType ${cd.trainerType}`);

    const fontGroup = officialDesign.fontGroup;
    const ol = fontTable(lc, fontGroup);
    const typeBranch = officialDesign.dynamicUI.CardType?.name;
    const titleBranch = officialDesign.dynamicUI.Title?.name;
    if (!typeBranch || !titleBranch) {
      throw new Error(
        `official CardDesignSettings ${officialDesign.design.name} `
        + "does not select Trainer Title/CardType DynamicUI targets",
      );
    }
    const trainerSuffix = TRAINER_NODE_SUF[lc] || "en_id";
    const labelSuffix = cd.trainerType === 5 ? CATEGORY_NODE_SUF[lc] || "en" : trainerSuffix;
    const typeLabelPath = `/TrainersCardUI/Base/card_frm_elm/cmn_card_type_txt_elm/${typeBranch}/${type.label}_${labelSuffix}`;
    const categoryLabelPath = `/TrainersCardUI/Base/card_frm_elm/normal_card_frm_elm/normal_ttl_base_elm/${titleBranch}/normal_ttl_txt_img_${trainerSuffix}`;
    const footerNode = cd.trainerType === 5 && ["it_IT", "de_DE", "es_ES", "es_419", "id_ID"].includes(lc)
      ? nodeByPath("/TrainersCardUI/CollectionView/card_rule_four_line_txt")
      : nodeByPath("/TrainersCardUI/CollectionView/card_rule_txt");

    const els = [
      labelIcon(nodeByPath(typeLabelPath), type.sprite, lc),
      labelIcon(nodeByPath(categoryLabelPath), "card_fra_trainers_top_txt_nor", lc),
      textEl(nodeByPath(`/TrainersCardUI/CollectionView/${type.name}`), cd.name, ol),
      type.sub
        ? textEl(
          nodeByPath(`/TrainersCardUI/CollectionView/${type.sub}`),
          cd.rightEndDisplayName || "",
          ol,
          { allowEmpty: true },
        )
        : null,
      textEl(nodeByPath("/TrainersCardUI/description_txt"), cd.rule, ol),
      textEl(footerNode, cd.ui.footer, ol),
      textEl(
        nodeByPath(
          "/TrainersCardUI/CollectionView/illustrator_elm/illust_width_elm/Illustrator_txt",
        ),
        "Illus.",
        ol,
      ),
      textEl(
        nodeByPath(
          "/TrainersCardUI/CollectionView/illustrator_elm/name_width_elm/illustrator_name_txt",
        ),
        cd.illustrator || "",
        ol,
        { allowEmpty: true },
      ),
    ].filter(Boolean);

    if (cd.trainerType === 4 && cd.fossilHp) {
      const hpLabel = textEl(nodeByPath("/TrainersCardUI/CollectionView/TxtFossilCardNameElm/hp_elm/hp_txt_elm/hp_txt"), "HP", ol);
      const hpNumber = textEl(nodeByPath("/TrainersCardUI/CollectionView/TxtFossilCardNameElm/hp_elm/hp_num_txt"), String(cd.fossilHp), ol);
      if (hpLabel) els.push(hpLabel);
      if (hpNumber) { hpNumber.font = "num"; els.push(hpNumber); }
    }
    els.push(...categoryElements(layout, cd.additionalCategories, lc, "/TrainersCardUI"));

    const resolvedLayout = finalizeOfficialLayout(layout, "trainer", els);
    return {
      card: cardId,
      locale: lc,
      kind: "trainer",
      design: officialDesign.design.name,
      fontCondition: officialDesign.card.fontCondition,
      fontGroup,
      branchEvidence: "official-card-design-settings",
      dynamicUI: officialDesign.dynamicUI,
      dynamicUIState: layout.dynamicUIState,
      dynamicUIReplay: layout.dynamicUIReplay,
      layoutRuntime: resolvedLayout.diagnostics,
      canvasWH: [Math.round(CW), Math.round(CH)],
      elements: resolvedLayout.elements,
    };
  }

  // pokemon: reuse the existing static card_face for now (the Pokémon path already works); the generic
  // pokemon composer (name/hp/attacks boxes from PokemonCardUI) is the next iteration.
  return composePokemonFace(cd, lc, officialDesign);
}

if (process.argv[1] && process.argv[1].endsWith("compose.mjs")) {
  const [, , id = "TR_20_000230_00", lc = "zh_TW", ill = "cTR_20_000230_00_LEAF_SR"] = process.argv;
  console.log(JSON.stringify(composeFace(id, lc, ill), null, 1));
}
