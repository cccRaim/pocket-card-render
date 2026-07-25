import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "render", "tmp-settings-contract.json");
const check = process.argv.includes("--check") || process.env.PCR_TMP_SETTINGS_CHECK === "1";
const extracted = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["-B", "build/extract_official_tmp_settings.py"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 4 * 1024 * 1024,
  },
));

assert.equal(extracted.schemaVersion, 2);
assert.equal(extracted.officialSample, "PTCGP 1.6.0");
assert.equal(extracted.unityVersion, "2022.3.62f2");
assert.equal(extracted.textMeshProVersion, "3.0.6");
assert.deepEqual(extracted.source, {
  ...extracted.source,
  apkm: "jp.pokemon.pokemontcgp_1.6.0.apkm",
  baseApkByteSize: 43516766,
  baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
});
assert.deepEqual({
  byteSize: extracted.source.il2cpp.byteSize,
  sha256: extracted.source.il2cpp.sha256,
  scriptSha256: extracted.source.il2cppDumperScriptSha256,
}, {
  byteSize: 128218264,
  sha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  scriptSha256: "c6bbe3dd41b5530fae30c3b8f6d27bdcf212e442c024da71478621b8818c1e21",
});
assert.deepEqual({
  package: extracted.source.textMeshProPackage.package.sha256,
  settings: extracted.source.textMeshProPackage.settings.sha256,
  utilities: extracted.source.textMeshProPackage.fontAssetUtilities.sha256,
  singleSearch: extracted.source.textMeshProPackage.fontAssetUtilities.ranges.singleFontRecursiveSearch.sha256,
  listSearch: extracted.source.textMeshProPackage.fontAssetUtilities.ranges.fontListRecursiveSearch.sha256,
  ugui: extracted.source.textMeshProPackage.uguiGenerator.sha256,
  missingGlyph: extracted.source.textMeshProPackage.uguiGenerator.ranges.missingGlyphResolution.sha256,
}, {
  package: "640c3c9ea8d7e5431bfefaccc70d85ea7aed204686d16a596d412286d2b9ba0b",
  settings: "3ce458b588247f4b364bbf607ed019f7e135d9bec0aa3610ec827333f4960131",
  utilities: "fb2d13588d6ebacc34ba1fd32e75780d16f3df90347546482a9cc4bf1328cf60",
  singleSearch: "4aaa65ed897dfd3a4f9ba753f382ca1bddae97aa7ba979e2748f913cc25ced52",
  listSearch: "e613263b623c9acbb3cd85f34e8a06b1c2244b3f29e91a32ce5edcbe19a53b92",
  ugui: "1f8ba223bdd284bd0dfff1aefcf5988c872c9f6dd616673a8d4d58a9b2bf816a",
  missingGlyph: "4bd4b22df978c0354cc7512c56a3e8242fe5701f53a500e7af30707f27772f9e",
});
assert.deepEqual({
  assetFile: extracted.settings.assetFile,
  pathId: extracted.settings.pathId,
  rawByteSize: extracted.settings.rawByteSize,
  rawSha256: extracted.settings.rawSha256,
  enableWordWrapping: extracted.settings.enableWordWrapping,
  enableKerning: extracted.settings.enableKerning,
  enableExtraPadding: extracted.settings.enableExtraPadding,
  enableTintAllSprites: extracted.settings.enableTintAllSprites,
  enableParseEscapeCharacters: extracted.settings.enableParseEscapeCharacters,
  enableRaycastTarget: extracted.settings.enableRaycastTarget,
  getFontFeaturesAtRuntime: extracted.settings.getFontFeaturesAtRuntime,
  missingGlyphCharacter: extracted.settings.missingGlyphCharacter,
  warningsDisabled: extracted.settings.warningsDisabled,
  defaultFontAssetPPtr: extracted.settings.defaultFontAssetPPtr,
  defaultFontAssetPath: extracted.settings.defaultFontAssetPath,
  defaultFontSize: extracted.settings.defaultFontSize,
  defaultAutoSizeMinRatio: extracted.settings.defaultAutoSizeMinRatio,
  defaultAutoSizeMaxRatio: extracted.settings.defaultAutoSizeMaxRatio,
  defaultTextMeshProTextContainerSize: extracted.settings.defaultTextMeshProTextContainerSize,
  defaultTextMeshProUITextContainerSize: extracted.settings.defaultTextMeshProUITextContainerSize,
  autoSizeTextContainer: extracted.settings.autoSizeTextContainer,
  isTextObjectScaleStatic: extracted.settings.isTextObjectScaleStatic,
  fallbackFontAssetPPtrs: extracted.settings.fallbackFontAssetPPtrs,
  matchMaterialPreset: extracted.settings.matchMaterialPreset,
  defaultSpriteAssetPPtr: extracted.settings.defaultSpriteAssetPPtr,
  defaultSpriteAssetPath: extracted.settings.defaultSpriteAssetPath,
  enableEmojiSupport: extracted.settings.enableEmojiSupport,
  missingCharacterSpriteUnicode: extracted.settings.missingCharacterSpriteUnicode,
  defaultColorGradientPresetsPath: extracted.settings.defaultColorGradientPresetsPath,
  defaultStyleSheetPPtr: extracted.settings.defaultStyleSheetPPtr,
  styleSheetsResourcePath: extracted.settings.styleSheetsResourcePath,
  leadingCharactersPPtr: extracted.settings.leadingCharactersPPtr,
  followingCharactersPPtr: extracted.settings.followingCharactersPPtr,
  useModernHangulLineBreakingRules: extracted.settings.useModernHangulLineBreakingRules,
}, {
  assetFile: "3f5b5dff67a942289a9defa416b206f3",
  pathId: 1,
  rawByteSize: 248,
  rawSha256: "61213932599fe55e49d0d3ea1010c17df74eb7027edb7a8d7501b0c824bad8de",
  enableWordWrapping: true,
  enableKerning: true,
  enableExtraPadding: false,
  enableTintAllSprites: false,
  enableParseEscapeCharacters: true,
  enableRaycastTarget: true,
  getFontFeaturesAtRuntime: true,
  missingGlyphCharacter: 0,
  warningsDisabled: true,
  defaultFontAssetPPtr: { fileId: 0, pathId: 0 },
  defaultFontAssetPath: "",
  defaultFontSize: 36,
  defaultAutoSizeMinRatio: 0.5,
  defaultAutoSizeMaxRatio: 2,
  defaultTextMeshProTextContainerSize: { x: 20, y: 5 },
  defaultTextMeshProUITextContainerSize: { x: 200, y: 50 },
  autoSizeTextContainer: false,
  isTextObjectScaleStatic: false,
  fallbackFontAssetPPtrs: [],
  matchMaterialPreset: true,
  defaultSpriteAssetPPtr: { fileId: 0, pathId: 0 },
  defaultSpriteAssetPath: "ImageInText/",
  enableEmojiSupport: true,
  missingCharacterSpriteUnicode: 0,
  defaultColorGradientPresetsPath: "Color Gradient Presets/",
  defaultStyleSheetPPtr: { fileId: 0, pathId: 0 },
  styleSheetsResourcePath: "",
  leadingCharactersPPtr: { fileId: 2, pathId: 1 },
  followingCharactersPPtr: { fileId: 3, pathId: 1 },
  useModernHangulLineBreakingRules: false,
});
assert.deepEqual(extracted.native, {
  getTextElement: {
    name: "TMPro.TMP_Text$$GetTextElement",
    rva: "0x648f924",
    endRva: "0x648fd1c",
    byteSize: 1016,
    sha256: "979ea9dc300aca750014140698048e5c9f3405d578e291bcdd66e41ea1c2470d",
  },
  generateTextMesh: {
    name: "TMPro.TextMeshProUGUI$$GenerateTextMesh",
    rva: "0x644f2f8",
    endRva: "0x6456dfc",
    byteSize: 31492,
    sha256: "63e11353317c008927215ccb1d6d7977a18ee8b4d3d2728ace5b5d9cf65240b8",
  },
});
assert.deepEqual([
  extracted.lineBreaking.leadingCharacters.rawByteSize,
  extracted.lineBreaking.leadingCharacters.rawSha256,
  extracted.lineBreaking.followingCharacters.rawByteSize,
  extracted.lineBreaking.followingCharacters.rawSha256,
], [
  148,
  "43f49c58b3866d85ccb3b40ab114a04e981d1f2a79e37b2547aac1f8c42a1772",
  316,
  "b532d78da17863828461c8333a58c4ece4e3cba001a3a327045c51948d98dad3",
]);
assert.equal([...extracted.lineBreaking.leadingCharacters.text].length, 41);
assert.equal([...extracted.lineBreaking.followingCharacters.text].length, 97);

const serialized = `${JSON.stringify(extracted, null, 1)}\n`;
if (check) {
  assert.equal(fs.readFileSync(OUTPUT, "utf8"), serialized, "official TMP settings contract is stale");
  console.log("Official TMP settings contract audit OK");
} else {
  fs.writeFileSync(OUTPUT, serialized);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
}
console.log(`  ${[...extracted.lineBreaking.leadingCharacters.text].length} leading, ${[...extracted.lineBreaking.followingCharacters.text].length} following characters`);
