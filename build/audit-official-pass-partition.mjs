// Read-only, screenshot-free audit of the official opaque/transparent pass split.
// It joins package-native pass/filter evidence, serialized prefab Material draws,
// the four checked-in scene recipes, active GLB primitives, and current runtime routing.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PYTHON = process.env.PYTHON || "python";
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted");
const APKM = path.resolve(process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm");
const JSON_MODE = process.argv.includes("--json");
const DETAILS = !process.argv.includes("--no-details");

const CARDS = Object.freeze([
  "cPK_10_000040_00_FUSHIGIBANAex_RR",
  "cPK_20_008900_02_HOUOUex_UR",
  "cTR_20_000230_00_LEAF_SR",
  "cTR_20_000670_00_IIBUINOBAKKU_UR",
]);

const SHADER_TAGS = Object.freeze([
  {
    value: "SRPDefaultUnlit", slotRva: "0x6c460e0",
    relocationBytesHex: "e060c4060000000003040000000000000821560700000000",
    relocationSha256: "228399877c63d0913a1888a8dc2e6d2c87719f9f7691468e5f7a293ac540cca6",
    recordBytesHex: "0f000000b4180a00",
    recordSha256: "71892b5672870f9e150dbd3aef85e883920ac89aed7d5509e0d78235dc0658e6",
    utf8BytesHex: "53525044656661756c74556e6c6974",
    utf8Sha256: "b2d23e6fb55ff01e7a64da56dc38cb015f551101d2b643208c2b573ff081cc24",
  },
  {
    value: "UniversalForward", slotRva: "0x6c460d8",
    relocationBytesHex: "d860c406000000000304000000000000e08a560700000000",
    relocationSha256: "8dc564b4888cac719ad555e455c34df21561f5c844e71549c2b05532aaaaa3ea",
    recordBytesHex: "1000000094600c00",
    recordSha256: "0d33d49be46e92572b4bf6d772af99d2a30e250f3e41cc28c48383c5faf15c02",
    utf8BytesHex: "556e6976657273616c466f7277617264",
    utf8Sha256: "aa354dcecd77a766b6447a88e3582355552bdd908e93b442a445606117e4d7e7",
  },
  {
    value: "UniversalForwardOnly", slotRva: "0x6c460f0",
    relocationBytesHex: "f060c406000000000304000000000000e88a560700000000",
    relocationSha256: "374d9939f0d449022caa1ac6a9f89744a691fe1385ae28bcb46de90e4ac9549f",
    recordBytesHex: "14000000a4600c00",
    recordSha256: "1066724baf0bedca8abedb1c12a5408d142f2814c5400ff534f747f975508d7f",
    utf8BytesHex: "556e6976657273616c466f72776172644f6e6c79",
    utf8Sha256: "b57096c4999b36eded414cc7487f6b6b1158fc4012b5b07e722d25400f37ce9c",
  },
  {
    value: "MultiPass1", slotRva: "0x6c460d0",
    relocationBytesHex: "d060c406000000000304000000000000f0c2550700000000",
    relocationSha256: "3f0ca78099271407bc42c8a98ab95fb46b2ccb06b18ce80eb4a5fe3f2d8fb595",
    recordBytesHex: "0a000000257f0800",
    recordSha256: "26dcac43b87ce4f6aed8b038c9fdba1509ee479e90a2d9fecea43768265979fa",
    utf8BytesHex: "4d756c74695061737331",
    utf8Sha256: "867945c301e33adb33a321e859eb1e17575d5bf828920f71db996a072a45ab20",
  },
  {
    value: "MultiPass2", slotRva: "0x6c460c8",
    relocationBytesHex: "c860c406000000000304000000000000f8c2550700000000",
    relocationSha256: "da2fe08beaeaeb949c6133a456424cdc2d3b89b1e9958f6570fb0bad5339ae53",
    recordBytesHex: "0a0000002f7f0800",
    recordSha256: "b63bde1dfb531bda549416516acfe86e21422033869f9fcebabc63c92371ebd8",
    utf8BytesHex: "4d756c74695061737332",
    utf8Sha256: "1337d17c7a7a2c110d50c8bd3a4af307605db2470e999ecb39e1c28496abfb59",
  },
  {
    value: "MultiPass3", slotRva: "0x6c460f8",
    relocationBytesHex: "f860c40600000000030400000000000000c3550700000000",
    relocationSha256: "8e999c179f06870087f2afa4e7d9c9133ca3d0a40b3247805cf0cee10f3de1f1",
    recordBytesHex: "0a000000397f0800",
    recordSha256: "35d40f8bae1cc53a31a62bc7a06be386eb1582565030a336765dd64fc8f86b24",
    utf8BytesHex: "4d756c74695061737333",
    utf8Sha256: "245381e91049af9ee49f019261cee5ed84428429319ce28244af37f3c5f142e3",
  },
  {
    value: "MultiPass4", slotRva: "0x6c460e8",
    relocationBytesHex: "e860c40600000000030400000000000008c3550700000000",
    relocationSha256: "a1737f77ba8fe0e2451e89d36175602b88a4f378e25f21d95ff90147ff5bb503",
    recordBytesHex: "0a000000437f0800",
    recordSha256: "1f330047274895f56585613c1ddb0ede6b56c035d039f977b99475965b8616ad",
    utf8BytesHex: "4d756c74695061737334",
    utf8Sha256: "f981882f0dc000846c0e8fa25c857c8e81e41190db873e9218510e06ef54def9",
  },
]);

const issues = [];

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(label, actual, expected) {
  if (stable(actual) !== stable(expected)) {
    issues.push(`${label}: expected ${stable(expected)}, got ${stable(actual)}`);
  }
}

function requireCondition(condition, label) {
  if (!condition) issues.push(label);
}

function sorted(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function mapObject(map) {
  return Object.fromEntries(sorted(map.keys()).map((key) => [key, map.get(key)]));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key] ?? "null"] = (counts[row[key] ?? "null"] || 0) + 1;
  return counts;
}

function sourceComparator(source, method) {
  const match = new RegExp(`renderer\\.${method}\\(\\(a, b\\) =>\\s*([\\s\\S]*?)\\);`).exec(source);
  if (!match) {
    issues.push(`runtime ${method} callback could not be located`);
    return null;
  }
  try {
    return { expression: match[1].trim(), compare: new Function("a", "b", `return ${match[1]};`) };
  } catch (error) {
    issues.push(`runtime ${method} callback could not be compiled: ${error.message}`);
    return null;
  }
}

function auditSortComparator(source, method, depthDirection) {
  const parsed = sourceComparator(source, method);
  if (!parsed) return null;
  const item = (overrides = {}) => ({
    groupOrder: 0,
    renderOrder: 0,
    z: 0,
    material: { id: 0 },
    id: 0,
    ...overrides,
  });
  const sign = (value) => Math.sign(value);
  const checks = {
    groupOrderAscending: sign(parsed.compare(item({ groupOrder: 1 }), item())) === 1,
    renderOrderAscending: sign(parsed.compare(item({ renderOrder: 1 }), item())) === 1,
    depthDirection: sign(parsed.compare(item({ z: 1 }), item())) === depthDirection,
    materialIdAscending: sign(parsed.compare(item({ material: { id: 1 } }), item())) === 1,
    objectIdAscending: sign(parsed.compare(item({ id: 1 }), item())) === 1,
  };
  for (const [name, ok] of Object.entries(checks)) requireCondition(ok, `${method}: ${name} check failed`);
  return { method, expression: parsed.expression, checks };
}

function runExtractor() {
  const script = path.join(ROOT, "build", "extract_official_pass_partition.py");
  const stdout = execFileSync(PYTHON, [
    script,
    "--apkm", APKM,
    "--decrypted-root", DECRYPTED_ROOT,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

function parseGlbDrawMaterials(file) {
  const data = fs.readFileSync(file);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
  if (data.readUInt32LE(4) !== 2) throw new Error(`unsupported GLB version ${data.readUInt32LE(4)}`);
  if (data.readUInt32LE(8) !== data.length) throw new Error("GLB declared length does not match file size");

  let offset = 12;
  let gltf = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > data.length) throw new Error("GLB chunk extends past end of file");
    if (type === 0x4e4f534a) {
      if (gltf) throw new Error("GLB has multiple JSON chunks");
      gltf = JSON.parse(data.subarray(offset, offset + length).toString("utf8").replace(/\0+$/, ""));
    }
    offset += length;
  }
  if (!gltf) throw new Error("GLB JSON chunk is missing");

  const sceneIndex = Number.isInteger(gltf.scene) ? gltf.scene : 0;
  const roots = gltf.scenes?.[sceneIndex]?.nodes;
  if (!Array.isArray(roots)) throw new Error(`GLB scene ${sceneIndex} has no root nodes`);
  const materialNames = (gltf.materials || []).map((material) => material?.name || "");
  const active = new Set();
  const visited = new Set();
  const draws = [];

  function visit(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || !gltf.nodes?.[nodeIndex]) throw new Error(`invalid node index ${nodeIndex}`);
    if (active.has(nodeIndex)) throw new Error(`node cycle at index ${nodeIndex}`);
    if (visited.has(nodeIndex)) throw new Error(`node ${nodeIndex} is referenced more than once`);
    active.add(nodeIndex);
    visited.add(nodeIndex);
    const node = gltf.nodes[nodeIndex];
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) throw new Error(`invalid mesh index ${node.mesh}`);
      for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
        const material = materialNames[primitive.material];
        if (!material) throw new Error(`node ${nodeIndex} primitive ${primitiveIndex} has no named material`);
        draws.push({ node: node.name || `node:${nodeIndex}`, primitiveIndex, material });
      }
    }
    for (const child of node.children || []) visit(child);
    active.delete(nodeIndex);
  }

  for (const root of roots) visit(root);
  return draws;
}

function runtimeRoute(draw, recipe) {
  if (draw.material === "OuterStencil" || draw.material.startsWith("InnerStencil")) {
    return {
      coverage: "implemented",
      route: "stencil-writer/direct-MRT",
      runtimePartition: "direct-MRT/opaque-list",
      runtimeOrder: -100,
      note: "MeshBasic stencil writer; official queue is replaced by the dedicated writer order",
    };
  }
  if (draw.material === "L_FullFace_Text") {
    return {
      coverage: "implemented",
      route: "DynamicUI-bridge/direct-MRT",
      runtimePartition: "direct-MRT/transparent-list",
      runtimeOrder: 2900,
      note: "conditional on dynUITex; bridge is explicit in app.js",
    };
  }

  const cfg = SHADER[draw.shortShader];
  if (!cfg) {
    return {
      coverage: "missing",
      route: "unmapped-shader",
      runtimePartition: null,
      runtimeOrder: null,
      note: "no SHADER registry entry",
    };
  }
  if (cfg.defer) {
    return {
      coverage: "deferred",
      route: "deferred",
      runtimePartition: null,
      runtimeOrder: null,
      note: "cfg.defer returns before material construction",
    };
  }

  const lensFlare = draw.shortShader === "Card_UR_LensFlare";
  const renderList = draw.effectiveQueue <= 2500 ? "opaque-list" : "transparent-list";
  return {
    coverage: "implemented",
    route: lensFlare ? "restored-builtin-Quad/direct-MRT" : "direct-MRT",
    runtimePartition: `direct-MRT/${renderList}`,
    runtimeOrder: recipe?.queue ?? draw.effectiveQueue,
    note: lensFlare
      ? "serialized Transform + recipe restore Unity built-in Quad"
      : "applyRenderQueueState maps the effective Unity queue to the three.js opaque/transparent list",
  };
}

let evidence;
try {
  evidence = runExtractor();
} catch (error) {
  console.error(`BAD official pass extractor failed: ${error.message}`);
  process.exit(1);
}

const nativePasses = new Map((evidence.native?.passes || []).map((row) => [row.pass, row]));
same("encrypted metadata evidence", evidence.source?.metadata && {
  path: evidence.source.metadata.path,
  encryptedByteSize: evidence.source.metadata.encryptedByteSize,
  encryptedSha256: evidence.source.metadata.encryptedSha256,
  plaintextByteSize: evidence.source.metadata.plaintextByteSize,
  plaintextSha256: evidence.source.metadata.plaintextSha256,
  magic: evidence.source.metadata.magic,
  version: evidence.source.metadata.version,
  keyTableRva: evidence.source.metadata.keyTableRva,
  keyTableBytesHex: evidence.source.metadata.keyTableBytesHex,
  keyTableSha256: evidence.source.metadata.keyTableSha256,
}, {
  path: "assets/bin/Data/Managed/Metadata/global-metadata.dat",
  encryptedByteSize: 31429300,
  encryptedSha256: "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2",
  plaintextByteSize: 31429296,
  plaintextSha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
  magic: "0xfab11baf",
  version: 31,
  keyTableRva: "0x7a52554",
  keyTableBytesHex: "b195674699a63503e79e67149da46f04",
  keyTableSha256: "1d36f6dc069f4de139538327e8dbd42ad4c7a45d7465446c127283e9278faf5d",
});
same("native partition status", evidence.native?.status, "proved");
same("native partition remaining", evidence.native?.remaining, []);
same("native pass set", sorted(nativePasses.keys()), ["DrawOpaque", "DrawTransparent"]);
same("native pass order", evidence.native?.passOrder, ["DrawOpaque", "DrawTransparent"]);
same("DrawOpaque queue range", nativePasses.get("DrawOpaque")?.renderQueueRange && {
  lowerBound: nativePasses.get("DrawOpaque").renderQueueRange.lowerBound,
  upperBound: nativePasses.get("DrawOpaque").renderQueueRange.upperBound,
}, { lowerBound: 0, upperBound: 2500 });
same("DrawTransparent queue range", nativePasses.get("DrawTransparent")?.renderQueueRange && {
  lowerBound: nativePasses.get("DrawTransparent").renderQueueRange.lowerBound,
  upperBound: nativePasses.get("DrawTransparent").renderQueueRange.upperBound,
}, { lowerBound: 2501, upperBound: 5000 });
same("DrawOpaque render event", nativePasses.get("DrawOpaque")?.renderPassEvent, 250);
same("DrawTransparent render event", nativePasses.get("DrawTransparent")?.renderPassEvent, 450);
same("DrawOpaque sorting", nativePasses.get("DrawOpaque")?.sortingCriteria && {
  value: nativePasses.get("DrawOpaque").sortingCriteria.value,
  name: nativePasses.get("DrawOpaque").sortingCriteria.name,
}, { value: 59, name: "CommonOpaque" });
same("DrawTransparent sorting", nativePasses.get("DrawTransparent")?.sortingCriteria && {
  value: nativePasses.get("DrawTransparent").sortingCriteria.value,
  name: nativePasses.get("DrawTransparent").sortingCriteria.name,
}, { value: 23, name: "CommonTransparent" });
same("DrawOpaque sorting keys", nativePasses.get("DrawOpaque")?.sortingCriteria?.keys,
  ["SortingLayer", "RenderQueue", "QuantizedFrontToBack", "OptimizeStateChanges", "CanvasOrder"]);
same("DrawTransparent sorting keys", nativePasses.get("DrawTransparent")?.sortingCriteria?.keys,
  ["SortingLayer", "RenderQueue", "BackToFront", "OptimizeStateChanges"]);
for (const pass of nativePasses.values()) {
  same(`${pass.pass} renderingLayerMask`, pass.filteringSettings?.renderingLayerMask, 0xffffffff);
  same(`${pass.pass} excludeMotionVectorObjects`, pass.filteringSettings?.excludeMotionVectorObjects, false);
  same(`${pass.pass} ShaderTagId count`, pass.filteringSettings?.shaderTagIdCount, 7);
  same(`${pass.pass} ShaderTagId order`, pass.filteringSettings?.shaderTagIdValues,
    SHADER_TAGS.map((row) => row.value));
  same(`${pass.pass} ShaderTagId metadata evidence`,
    (pass.filteringSettings?.shaderTagIdEvidence || []).map((row) => ({
      value: row.value,
      slotRva: row.metadataUsage?.slotRva,
      relocationBytesHex: row.metadataUsage?.relocation?.bytesHex,
      relocationSha256: row.metadataUsage?.relocation?.sha256,
      recordBytesHex: row.metadataUsage?.metadataLiteral?.recordBytesHex,
      recordSha256: row.metadataUsage?.metadataLiteral?.recordSha256,
      utf8BytesHex: row.metadataUsage?.metadataLiteral?.utf8BytesHex,
      utf8Sha256: row.metadataUsage?.metadataLiteral?.utf8Sha256,
    })), SHADER_TAGS);
  same(`${pass.pass} layerMask source`, pass.filteringSettings?.layerMaskSource,
    "RenderingData.cameraData.camera.cullingMask");
  same(`${pass.pass} layerMask value`, pass.filteringSettings?.layerMaskValue, 2097152);
}
same("DrawOpaque constructor body hash", nativePasses.get("DrawOpaque")?.constructor?.bodySha256,
  "8d3381a10b2aa01841fd2a391c2e7288a0846d40a2983f3442cdd98010cb846f");
same("DrawTransparent constructor body hash", nativePasses.get("DrawTransparent")?.constructor?.bodySha256,
  "7fff5f064edc884501cdaefeed761a21e5d5e97134099e9e0ca9786fee2ae493");
same("native MRT binding status", evidence.native?.mrtBinding?.status, "proved");
same("native MRT OnCameraSetup pass set",
  (evidence.native?.mrtBinding?.onCameraSetup || []).map((row) => row.pass),
  ["DrawOpaque", "DrawTransparent"]);
same("native opaque/transparent same targets", evidence.native?.mrtBinding?.sameColorAndDepthTargets, true);
same("native clear between opaque/transparent", evidence.native?.mrtBinding?.clearBetweenOpaqueAndTransparent, false);
for (const row of evidence.native?.mrtBinding?.onCameraSetup || []) {
  same(`${row.pass} MRT attachments`, row.attachments, ["ColorRT", "EmissiveRT"]);
  same(`${row.pass} color target field`, row.colorTargetFieldOffset, "0x498");
  same(`${row.pass} depth target field`, row.depthTargetFieldOffset, "0x30");
  same(`${row.pass} clear calls`, row.clearCalls, []);
}
const expectedOnCameraSetupHashes = {
  DrawOpaque: "e0372a597b0200ac0a34b982cf790e58ea16886ad8f2588a2bb9f766d02038b2",
  DrawTransparent: "1a944fc339f35c0c3c21da1eca3ec9f77e007d6dc91a14aaa58450383b2fa811",
};
for (const row of evidence.native?.mrtBinding?.onCameraSetup || []) {
  same(`${row.pass} OnCameraSetup body hash`, row.method?.bodySha256, expectedOnCameraSetupHashes[row.pass]);
}

const nativeAsset3D = evidence.native?.asset3D;
same("Asset3D resource loader method hash", nativeAsset3D?.resourceLoader?.method?.bodySha256,
  "1b115acf5c80e47ac35c2b6ac5e6fd82f8803fe10196cd1db81811fcb278c286");
same("Asset3D ModelRenderStudio resource literal", nativeAsset3D?.resourceLoader?.resourcePath && {
  value: nativeAsset3D.resourceLoader.resourcePath.value,
  relocationBytesHex: nativeAsset3D.resourceLoader.resourcePath.relocation?.bytesHex,
  relocationSha256: nativeAsset3D.resourceLoader.resourcePath.relocation?.sha256,
  recordBytesHex: nativeAsset3D.resourceLoader.resourcePath.metadataLiteral?.recordBytesHex,
  recordSha256: nativeAsset3D.resourceLoader.resourcePath.metadataLiteral?.recordSha256,
  utf8BytesHex: nativeAsset3D.resourceLoader.resourcePath.metadataLiteral?.utf8BytesHex,
  utf8Sha256: nativeAsset3D.resourceLoader.resourcePath.metadataLiteral?.utf8Sha256,
}, {
  value: "Lettuce.Infrastructure.Asset3D.Core/ModelRenderStudio",
  relocationBytesHex: "986fc406000000000304000000000000e893550700000000",
  relocationSha256: "906ad6e1e7a7d15711dc6d5a19d3357021915b71d74808472f46a3121a850117",
  recordBytesHex: "3500000060820700",
  recordSha256: "8c2d60c735dd952ddd7a929a6161c7b6eeb5371b7c7f47ddf0568f921e533a56",
  utf8BytesHex: "4c6574747563652e496e6672617374727563747572652e417373657433442e436f72652f4d6f64656c52656e64657253747564696f",
  utf8Sha256: "61fe86834c7bbf5e9713d62d0941237b80cf1b0e44b5deefdaf4779c5c16e2b2",
});
same("CardRenderer layer getter method hash", nativeAsset3D?.cardLayer?.method?.bodySha256,
  "38539b64432f3d9995ff4464bafdb1946be4059717577874fd74dbe9464973e7");
same("CardRenderer layer literal", nativeAsset3D?.cardLayer?.layerName && {
  value: nativeAsset3D.cardLayer.layerName.value,
  relocationBytesHex: nativeAsset3D.cardLayer.layerName.relocation?.bytesHex,
  relocationSha256: nativeAsset3D.cardLayer.layerName.relocation?.sha256,
  recordBytesHex: nativeAsset3D.cardLayer.layerName.metadataLiteral?.recordBytesHex,
  recordSha256: nativeAsset3D.cardLayer.layerName.metadataLiteral?.recordSha256,
  utf8BytesHex: nativeAsset3D.cardLayer.layerName.metadataLiteral?.utf8BytesHex,
  utf8Sha256: nativeAsset3D.cardLayer.layerName.metadataLiteral?.utf8Sha256,
}, {
  value: "UICardViewRenderer",
  relocationBytesHex: "88b3c406000000000304000000000000107d560700000000",
  relocationSha256: "324981afa61277b62224f48753712397064e86729c902944b7e47169118103c4",
  recordBytesHex: "1200000045120c00",
  recordSha256: "e7413341c98cd561670327f56c00d0ff3b4cf8fe6f193bfebd1a8fbfd8e2d292",
  utf8BytesHex: "5549436172645669657752656e6465726572",
  utf8Sha256: "df09477fc24d32f6a5118a41f8452d7de12cb599686de0240655b415f7fdd861",
});

const asset3DCardCamera = evidence.serializedScenes?.asset3DCardCamera;
same("serialized Asset3D camera status", asset3DCardCamera?.status, "proved");
same("serialized ModelRenderStudio resource", asset3DCardCamera && {
  path: asset3DCardCamera.resourcePath,
  byteSize: asset3DCardCamera.resourceByteSize,
  sha256: asset3DCardCamera.resourceSha256,
  studioPathId: asset3DCardCamera.studio?.gameObjectPathId,
  studioName: asset3DCardCamera.studio?.gameObject,
  studioRawSha256: asset3DCardCamera.studio?.gameObjectRawSha256,
  studioComponents: asset3DCardCamera.studio?.componentPathIds,
  studioTransform: asset3DCardCamera.studio?.transformPathId,
  studioTransformSha256: asset3DCardCamera.studio?.transformRawSha256,
}, {
  path: "assets/bin/Data/9d297022bee770046a337555c38bc47a",
  byteSize: 2404,
  sha256: "cd50054d1f2a06bc78a58f614a01ec159e5efa83eff0597e76b9ec5d369f3c8f",
  studioPathId: "7",
  studioName: "ModelRenderStudio",
  studioRawSha256: "d3b50b43b516230a6c37b828c04a29eedb9882781c68d4bf25c1c94c7208b194",
  studioComponents: ["13", "18"],
  studioTransform: "13",
  studioTransformSha256: "6107fad6c880dc5dd6891303c5a69cb4679fd0349334abc10deb5da528410901",
});
same("serialized ModelRenderStudio Camera bytes", asset3DCardCamera?.camera && {
  pathId: asset3DCardCamera.camera.pathId,
  gameObjectPathId: asset3DCardCamera.camera.gameObjectPathId,
  gameObject: asset3DCardCamera.camera.gameObject,
  gameObjectRawSha256: asset3DCardCamera.camera.gameObjectRawSha256,
  componentPathIds: asset3DCardCamera.camera.componentPathIds,
  transformPathId: asset3DCardCamera.camera.transformPathId,
  parentTransformPathId: asset3DCardCamera.camera.parentTransformPathId,
  rawByteSize: asset3DCardCamera.camera.rawByteSize,
  rawSha256: asset3DCardCamera.camera.rawSha256,
  cullingMask: asset3DCardCamera.camera.cullingMask,
  cullingMaskHex: asset3DCardCamera.camera.cullingMaskHex,
  cullingMaskFieldOffset: asset3DCardCamera.camera.cullingMaskFieldOffset,
  cullingMaskBytesHex: asset3DCardCamera.camera.cullingMaskBytesHex,
  cullingMaskBytesSha256: asset3DCardCamera.camera.cullingMaskBytesSha256,
}, {
  pathId: "17", gameObjectPathId: "3", gameObject: "Camera",
  gameObjectRawSha256: "b04d5184f5bc7c7129b10d564d044b42c0906b74605b45d3a5f1bd9344272eb2",
  componentPathIds: ["10", "17", "20", "19"],
  transformPathId: "10", parentTransformPathId: "13", rawByteSize: 184,
  rawSha256: "ad9758f33c51b0e53973ffc76d5772d7ae18cffd291fe5da613e70cc9781cfef",
  cullingMask: 2097152, cullingMaskHex: "0x00200000", cullingMaskFieldOffset: 140,
  cullingMaskBytesHex: "00002000",
  cullingMaskBytesSha256: "4383af4fd372332676db3e050000c22438deb3f8352a00aa8c8d652b7298d96f",
});
same("serialized card layer semantics", asset3DCardCamera?.layerSemantics, {
  tagManagerPathId: "3",
  tagManagerRawSha256: "a86c8072a1a6f9e0ac6179df18942fa0805c3cf3fa1770f3702cd2dbff4ddc71",
  layerName: "UICardViewRenderer",
  layerIndex: 21,
  layerBit: 2097152,
  cameraSelectsOnlyLayer: true,
});
same("identified serialized card camera count",
  evidence.serializedScenes?.identifiedCardCameras?.length, 1);
same("serialized card camera cullingMask status",
  evidence.serializedScenes?.cardCameraCullingMaskStatus, "proved");

same("serialized prefab card set", (evidence.serializedPrefabs?.cards || []).map((row) => row.card), CARDS);
same("serialized prefab card count", evidence.serializedPrefabs?.summary?.cards, 4);
same("serialized prefab unassigned draws", evidence.serializedPrefabs?.summary?.unassigned, 0);
same("serialized prefab enabled draw count", evidence.serializedPrefabs?.summary?.enabledDraws,
  evidence.serializedPrefabs?.summary?.draws);

const appSource = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const contextSource = fs.readFileSync(path.join(PUBLIC, "render", "context.js"), "utf8");
const opaqueSortAudit = auditSortComparator(appSource, "setOpaqueSort", 1);
const transparentSortAudit = auditSortComparator(appSource, "setTransparentSort", -1);
requireCondition(
  /export function applyRenderQueueState\(mat, queue\)[\s\S]*?mat\.transparent\s*=\s*queue\s*>=\s*2501/.test(contextSource),
  "runtime official queue boundary mapping could not be located",
);
requireCondition(
  appSource.includes("if (!applyRenderQueueState(mat, r.queue))"),
  "runtime material dispatcher no longer applies effective render queue state",
);
requireCondition(
  appSource.includes("applyRenderQueueState(m, 2900)"),
  "runtime DynamicUI bridge no longer applies its official queue state",
);
requireCondition(
  appSource.includes("if (!cfg || cfg.defer) { deferred++; return; }"),
  "runtime deferred branch could not be located",
);
requireCondition(
  appSource.includes("fgGroup.add(mesh)"),
  "runtime direct foreground/MRT route could not be located",
);
requireCondition(
  !appSource.includes("isBackgroundLayer(r.shader, cfg, r)"),
  "runtime still routes card draws through the legacy UR background precompose",
);
requireCondition(
  !/\bbgRT\s*=\s*new THREE\.WebGLRenderTarget/.test(appSource),
  "runtime still creates the legacy single-attachment UR background target",
);
requireCondition(
  !appSource.includes("window.__bg ="),
  "runtime still publishes a legacy UR background precompose route",
);
requireCondition(
  appSource.includes('if (matName === "OuterStencil" || matName.startsWith("InnerStencil"))'),
  "runtime stencil writer branch could not be located",
);
requireCondition(
  appSource.includes('if (matName === "L_FullFace_Text")'),
  "runtime DynamicUI bridge branch could not be located",
);
requireCondition(
  appSource.includes('recipe.shader !== "Card_UR_LensFlare"'),
  "runtime LensFlare built-in Quad restoration could not be located",
);

const officialDraws = evidence.serializedPrefabs?.draws || [];
const drawKeys = new Set();
const reportRows = [];
const cardReports = [];
let defaultMaterialPlaceholders = 0;

for (const card of CARDS) {
  const sceneName = `scene.${card}.json`;
  const scenePath = path.join(PUBLIC, sceneName);
  let scene;
  try {
    scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
  } catch (error) {
    issues.push(`${card}: cannot read ${sceneName}: ${error.message}`);
    continue;
  }
  same(`${card}: scene card id`, scene.card?.id, card);

  const cardDraws = officialDraws.filter((draw) => draw.card === card);
  const officialCounts = new Map();
  const expectedGlbCounts = new Map();
  for (const draw of cardDraws) {
    if (drawKeys.has(draw.key)) issues.push(`duplicate serialized draw key: ${draw.key}`);
    drawKeys.add(draw.key);
    increment(officialCounts, draw.material);
    if (draw.shortShader !== "Card_UR_LensFlare") increment(expectedGlbCounts, draw.material);

    const recipe = scene.materials?.[draw.material] || null;
    if (draw.material === "L_FullFace_Text") {
      requireCondition(!recipe, `${draw.key}: Text bridge unexpectedly has a scene recipe`);
      same(`${draw.key}: Text runtime queue`, draw.effectiveQueue, 2900);
    } else {
      requireCondition(!!recipe, `${draw.key}: scene recipe is missing for ${draw.material}`);
      if (recipe) {
        same(`${draw.key}: scene shader`, recipe.shader, draw.shortShader);
        if (!SHADER[draw.shortShader]?.defer) {
          same(`${draw.key}: scene queue`, recipe.queue, draw.effectiveQueue);
        }
      }
    }

    const route = runtimeRoute(draw, recipe);
    if (route.coverage === "missing") issues.push(`${draw.key}: ${route.note} (${draw.shortShader})`);
    reportRows.push({
      key: draw.key,
      card,
      rendererPathId: draw.rendererPathId,
      materialSlot: draw.materialSlot,
      gameObject: draw.gameObject,
      sortingLayerId: draw.sortingLayerId,
      sortingLayer: draw.sortingLayer,
      sortingOrder: draw.sortingOrder,
      renderingLayerMask: draw.renderingLayerMask,
      rendererPriority: draw.rendererPriority,
      material: draw.material,
      shader: draw.shortShader,
      customRenderQueue: draw.customRenderQueue,
      shaderQueueTag: draw.shaderQueueTag,
      queue: draw.effectiveQueue,
      queueDerivation: draw.queueDerivation,
      sceneQueue: recipe?.queue ?? (draw.material === "L_FullFace_Text" ? 2900 : null),
      sceneQueueMatch: (recipe?.queue ?? (draw.material === "L_FullFace_Text" ? 2900 : null)) === draw.effectiveQueue,
      officialPass: draw.officialPass,
      ...route,
      passParity: route.runtimePartition?.endsWith("opaque-list")
        ? draw.officialPass === "DrawOpaque"
        : route.runtimePartition?.endsWith("transparent-list")
          ? draw.officialPass === "DrawTransparent"
          : false,
    });
  }

  let glbDraws = [];
  try {
    const glbUrl = scene.prefabGlb;
    requireCondition(typeof glbUrl === "string" && glbUrl.startsWith("/game/"),
      `${card}: invalid scene prefabGlb ${glbUrl}`);
    glbDraws = parseGlbDrawMaterials(path.join(PUBLIC, glbUrl.slice(1)));
  } catch (error) {
    issues.push(`${card}: cannot inspect active GLB draws: ${error.message}`);
  }
  const actualGlbCounts = new Map();
  for (const draw of glbDraws) {
    if (draw.material === "DefaultMaterial") {
      defaultMaterialPlaceholders += 1;
      continue;
    }
    increment(actualGlbCounts, draw.material);
  }
  same(`${card}: active GLB draw multiset`, mapObject(actualGlbCounts), mapObject(expectedGlbCounts));

  const rows = reportRows.filter((row) => row.card === card);
  cardReports.push({
    card,
    scene: sceneName,
    official: countBy(rows, "officialPass"),
    runtimeCoverage: countBy(rows, "coverage"),
    runtimeRoute: countBy(rows, "route"),
    passParity: rows.filter((row) => row.passParity).length,
    draws: rows.length,
    activeGlbDraws: [...actualGlbCounts.values()].reduce((sum, value) => sum + value, 0),
  });
}

same("joined serialized draw count", reportRows.length, evidence.serializedPrefabs?.summary?.draws);
same("joined draw key count", drawKeys.size, reportRows.length);

const coverage = countBy(reportRows, "coverage");
const officialPartition = countBy(reportRows, "officialPass");
const runtimePartition = countBy(reportRows, "runtimePartition");
const parityCount = reportRows.filter((row) => row.passParity).length;
const deferredRows = reportRows.filter((row) => row.coverage === "deferred");
const nonParityRows = reportRows.filter((row) => row.coverage === "implemented" && !row.passParity);
const deferredSceneQueueMismatches = deferredRows.filter((row) => !row.sceneQueueMatch);
const serializedSortFields = {
  sortingLayerIds: sorted(new Set(reportRows.map((row) => row.sortingLayerId))),
  sortingLayers: sorted(new Set(reportRows.map((row) => row.sortingLayer))),
  sortingOrders: sorted(new Set(reportRows.map((row) => row.sortingOrder))),
  renderingLayerMasks: sorted(new Set(reportRows.map((row) => row.renderingLayerMask))),
  rendererPriorities: sorted(new Set(reportRows.map((row) => row.rendererPriority))),
};
same("serialized draw sorting layers", serializedSortFields.sortingLayerIds, [0]);
same("serialized draw sorting layer values", serializedSortFields.sortingLayers, [0]);
same("serialized draw sorting orders", serializedSortFields.sortingOrders, [0]);
same("serialized draw rendering layer masks", serializedSortFields.renderingLayerMasks, [1]);
same("serialized draw renderer priorities", serializedSortFields.rendererPriorities, [0]);
const queueStateIndex = appSource.indexOf("applyRenderQueueState(mat, r.queue)");
requireCondition(
  queueStateIndex >= 0 && appSource.indexOf("mesh.renderOrder =", queueStateIndex) > queueStateIndex,
  "runtime must assign official queue membership before applying within-pass renderOrder overrides",
);

const remaining = [
  ...(evidence.native?.remaining || []),
  "Runtime sorting key order is implemented for the four serialized prefabs; projected z is a continuous stand-in and is not proved equivalent to Unity's native QuantizedFrontToBack bucket.",
  "This audit proves dispatcher/route coverage without running material requires()/build() or issuing GPU draws; asset-dependent runtime construction remains outside this no-render audit.",
];
if (deferredRows.length) {
  remaining.push(`Side&Back remains explicitly deferred for ${deferredRows.length} serialized draws.`);
}
if (deferredSceneQueueMismatches.length) {
  remaining.push(
    `${deferredSceneQueueMismatches.length} deferred Side&Back recipes do not match their serialized effective queue.`,
  );
}

const report = {
  status: issues.length ? "bad" : remaining.length ? "partial" : "proved",
  source: evidence.source,
  officialNative: {
    status: evidence.native?.status,
    passes: evidence.native?.passes,
    mrtBinding: evidence.native?.mrtBinding,
    asset3D: evidence.native?.asset3D,
    serializedScenes: evidence.serializedScenes,
  },
  runtimeSorting: {
    opaque: opaqueSortAudit,
    transparent: transparentSortAudit,
    serializedDrawFields: serializedSortFields,
  },
  summary: {
    cards: cardReports.length,
    draws: reportRows.length,
    officialPartition,
    runtimeCoverage: coverage,
    runtimePartition,
    passParity: {
      matching: parityCount,
      implementedButDifferent: nonParityRows.length,
      notDrawn: reportRows.length - parityCount - nonParityRows.length,
    },
    defaultMaterialPlaceholdersIgnored: defaultMaterialPlaceholders,
  },
  cards: cardReports,
  draws: reportRows,
  remaining,
  issues,
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Official pass evidence (APKM/libil2cpp)");
  for (const passName of ["DrawOpaque", "DrawTransparent"]) {
    const pass = nativePasses.get(passName);
    console.log(
      `${passName.padEnd(16)} q${pass.renderQueueRange.lowerBound}..${pass.renderQueueRange.upperBound}`
      + `  sort=${pass.sortingCriteria.name}(${pass.sortingCriteria.value})`
      + `  event=${pass.renderPassEvent}  tags=${pass.filteringSettings.shaderTagIdCount}`,
    );
  }
  console.log(`shader tags        ${SHADER_TAGS.map((row) => row.value).join(" -> ")}`);
  console.log("filter             layerMask=Camera.cullingMask=0x00200000, renderingLayerMask=0xffffffff, excludeMotion=false");
  console.log("targets            both passes bind MRT[ColorRT,EmissiveRT] + DepthRT; clearBetween=false");
  console.log(`runtime sort       opaque=${opaqueSortAudit ? "key-order OK" : "BAD"}; transparent=${transparentSortAudit ? "key-order OK" : "BAD"}; projected-z bucket parity partial`);
  console.log("");
  console.log("Per-card partition and runtime coverage");
  console.log(`${"card".padEnd(43)} ${"opaque".padStart(7)} ${"transp".padStart(7)} ${"impl".padStart(7)} ${"defer".padStart(7)} ${"parity".padStart(7)} ${"draws".padStart(7)}`);
  for (const card of cardReports) {
    console.log(
      `${card.card.padEnd(43)}`
      + ` ${String(card.official.DrawOpaque || 0).padStart(7)}`
      + ` ${String(card.official.DrawTransparent || 0).padStart(7)}`
      + ` ${String(card.runtimeCoverage.implemented || 0).padStart(7)}`
      + ` ${String(card.runtimeCoverage.deferred || 0).padStart(7)}`
      + ` ${String(card.passParity).padStart(7)}`
      + ` ${String(card.draws).padStart(7)}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(43)}`
    + ` ${String(officialPartition.DrawOpaque || 0).padStart(7)}`
    + ` ${String(officialPartition.DrawTransparent || 0).padStart(7)}`
    + ` ${String(coverage.implemented || 0).padStart(7)}`
    + ` ${String(coverage.deferred || 0).padStart(7)}`
    + ` ${String(parityCount).padStart(7)}`
    + ` ${String(reportRows.length).padStart(7)}`,
  );

  if (DETAILS) {
    console.log("");
    console.log("Every serialized Material draw");
    for (const row of reportRows) {
      const shortCard = row.card.split("_").slice(-2).join("_");
      console.log(
        `${shortCard.padEnd(18)} r${row.rendererPathId}:${row.materialSlot}`
        + ` q${String(row.queue).padEnd(4)} ${row.officialPass.padEnd(15)}`
        + ` ${row.coverage.padEnd(11)} ${row.route.padEnd(35)} ${row.material}`,
      );
    }
  }

  console.log("");
  if (issues.length) {
    for (const issue of issues) console.error(`BAD ${issue}`);
  }
  console.log(`Official pass partition audit ${report.status.toUpperCase()}`);
  console.log(`Sources: APKM/libil2cpp/metadata + Asset3D serialized resource + ${evidence.serializedScenes.levels.length} APK scenes + ${cardReports.length} card prefabs/scenes`);
  console.log(`Draw join: ${reportRows.length} serialized draws, ${defaultMaterialPlaceholders} DefaultMaterial GLB placeholders ignored`);
  console.log(`Runtime: ${coverage.implemented || 0} route-covered, ${coverage.deferred || 0} deferred, ${coverage.missing || 0} missing`);
  console.log("Remaining:");
  for (const item of remaining) console.log(`- ${item}`);
}

if (issues.length) process.exit(1);
