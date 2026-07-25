#!/usr/bin/env node
// Read-only, screenshot-free audit of shader-pass candidate generation for the
// four official reference cards. Authority is limited to decrypted Unity
// bundles and the package-matched APKM/native binaries; no scene or recipe
// output is consumed.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted");
const APKM = path.resolve(process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm");
const JSON_MODE = process.argv.includes("--json");

const EXPECTED_PACKAGE = Object.freeze({
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  encryptedMetadataSha256: "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2",
  plaintextMetadataSha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
});

const CARDS = Object.freeze({
  cPK_10_000040_00_FUSHIGIBANAex_RR: Object.freeze({
    meshRenderers: 23, draws: 30,
    prefabSha256: "5cd3dfd1fa5514f106cb575bbcf17344f4cc87dda51cf5fc6f1bfd20b004b560",
  }),
  cPK_20_008900_02_HOUOUex_UR: Object.freeze({
    meshRenderers: 18, draws: 22,
    prefabSha256: "e960197906b1d192c5426c4bc280cba670b94d04a74a900807a021ada5981ee2",
  }),
  cTR_20_000230_00_LEAF_SR: Object.freeze({
    meshRenderers: 18, draws: 23,
    prefabSha256: "97e131723201ba98d18224d3efc5ea4c95e6f307c08cfc875b2d7d3b032e8dca",
  }),
  cTR_20_000670_00_IIBUINOBAKKU_UR: Object.freeze({
    meshRenderers: 19, draws: 23,
    prefabSha256: "737840d2d8dd532793d758b92c15efa75caad968603fcd99b936107ffe922ce5",
  }),
});

const SHADER_TAGS = Object.freeze([
  ["SRPDefaultUnlit", 0x6c460e0, "e060c4060000000003040000000000000821560700000000"],
  ["UniversalForward", 0x6c460d8, "d860c406000000000304000000000000e08a560700000000"],
  ["UniversalForwardOnly", 0x6c460f0, "f060c406000000000304000000000000e88a560700000000"],
  ["MultiPass1", 0x6c460d0, "d060c406000000000304000000000000f0c2550700000000"],
  ["MultiPass2", 0x6c460c8, "c860c406000000000304000000000000f8c2550700000000"],
  ["MultiPass3", 0x6c460f8, "f860c40600000000030400000000000000c3550700000000"],
  ["MultiPass4", 0x6c460e8, "e860c40600000000030400000000000008c3550700000000"],
].map(([value, slotRva, relocationHex]) => Object.freeze({ value, slotRva, relocationHex })));

const PASS_CONSTRUCTORS = Object.freeze({
  DrawOpaque: Object.freeze({
    startRva: 0x430b714, endRva: 0x430ba24,
    sha256: "8d3381a10b2aa01841fd2a391c2e7288a0846d40a2983f3442cdd98010cb846f",
    instructions: Object.freeze([
      [0x430b818, "d67240f9"], [0x430b884, "c10240f9"], [0x430b894, "6efb8894"], [0x430b8e8, "8068b697"],
      [0x430b8bc, "396f40f9"], [0x430b8ec, "210340f9"], [0x430b8fc, "54fb8894"], [0x430b914, "7568b697"],
      [0x430b8c4, "5a7b40f9"], [0x430b918, "410340f9"], [0x430b928, "49fb8894"], [0x430b940, "6a68b697"],
      [0x430b8cc, "7b6b40f9"], [0x430b944, "610340f9"], [0x430b954, "3efb8894"], [0x430b96c, "5f68b697"],
      [0x430b8d0, "186740f9"], [0x430b970, "010340f9"], [0x430b980, "33fb8894"], [0x430b998, "5468b697"],
      [0x430b8d4, "f77e40f9"], [0x430b99c, "e10240f9"], [0x430b9ac, "28fb8894"], [0x430b9c4, "4968b697"],
      [0x430b8d8, "d67640f9"], [0x430b9c8, "c10240f9"], [0x430b9d8, "1dfb8894"], [0x430b9f0, "3e68b697"],
    ]),
  }),
  DrawTransparent: Object.freeze({
    startRva: 0x430bbd0, endRva: 0x430bee0,
    sha256: "7fff5f064edc884501cdaefeed761a21e5d5e97134099e9e0ca9786fee2ae493",
    instructions: Object.freeze([
      [0x430bcd4, "d67240f9"], [0x430bd40, "c10240f9"], [0x430bd50, "3ffa8894"], [0x430bda4, "5167b697"],
      [0x430bd78, "396f40f9"], [0x430bda8, "210340f9"], [0x430bdb8, "25fa8894"], [0x430bdd0, "4667b697"],
      [0x430bd80, "5a7b40f9"], [0x430bdd4, "410340f9"], [0x430bde4, "1afa8894"], [0x430bdfc, "3b67b697"],
      [0x430bd88, "7b6b40f9"], [0x430be00, "610340f9"], [0x430be10, "0ffa8894"], [0x430be28, "3067b697"],
      [0x430bd8c, "186740f9"], [0x430be2c, "010340f9"], [0x430be3c, "04fa8894"], [0x430be54, "2567b697"],
      [0x430bd90, "f77e40f9"], [0x430be58, "e10240f9"], [0x430be68, "f9f98894"], [0x430be80, "1a67b697"],
      [0x430bd94, "d67640f9"], [0x430be84, "c10240f9"], [0x430be94, "eef98894"], [0x430beac, "0f67b697"],
    ]),
  }),
});

const UNITY_FUNCTIONS = Object.freeze({
  FindPasses: Object.freeze({
    startRva: 0x54cac4, endRva: 0x54cbbc,
    sha256: "2cadf11a2953921955bf5b5c71a7bce2d2d1a38951560093f8b4581f9dd54cd3",
  }),
  PrepareScriptableLoopObjectData: Object.freeze({
    startRva: 0x54cc10, endRva: 0x54db78,
    sha256: "440935172837465a015f4bcf481c831aa800129fb7b8c40a1dffe9d11c2c88ac",
  }),
  PrepareScriptableDrawRenderersJob: Object.freeze({
    startRva: 0x54e37c, endRva: 0x54e438,
    sha256: "7a2874960d2556520dde456f7eed37ad0a6d488cfafcc5bfa23fe8bc0dafae1a",
  }),
});

const UNITY_INSTRUCTIONS = Object.freeze([
  // FindPasses: consume ShaderTagId in list order, resolve a pass, compact valid results.
  [0x54cb20, "a17a7bb8"], [0x54cb78, "81520294"], [0x54cb7c, "8000f837"],
  [0x54cb84, "60da37b8"], [0x54cb8c, "7b070091"],
  // Candidate ordinal starts at zero; selected pass and ordinal are stored at +0x48/+0x4c.
  [0x54d3a8, "f3031faa"], [0x54d3c0, "1479b3b8"], [0x54d3f8, "144d0929"],
  [0x54d3fc, "73060091"],
  // visibleNodeIndex is sourced from the runtime visible-node table, not serialized prefab order.
  [0x54e3bc, "076969b8"], [0x54e3c0, "15210091"], [0x54e3d0, "e6031faa"],
  [0x54e3d8, "0efaff97"], [0x54cdd8, "fd5a139b"], [0x54cff8, "ebeb0ea9"],
  [0x54d408, "11250129"], [0x54db34, "5a070091"],
]);

const PYTHON_EXTRACTOR = String.raw`
import hashlib, json, sys, warnings
from pathlib import Path
import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")
root = Path(sys.argv[1]).resolve()
cards = ${JSON.stringify(Object.keys(CARDS))}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def prefab(card):
    return root / "Common" / "CardNew" / "Face" / card / "L" / "Prefabs" / (card + "_L.prefab_bundles")

class Index:
    def __init__(self):
        self.cabs = {}
        self.loaded = {}
        self.hashes = {}

    def register(self, filename):
        filename = filename.resolve()
        env = UnityPy.load(str(filename))
        for cab in sorted({str(obj.assets_file.name) for obj in env.objects}):
            prior = self.cabs.get(cab)
            if prior is not None and prior != filename:
                raise RuntimeError("duplicate CAB " + cab)
            self.cabs[cab] = filename

    def load(self, filename):
        filename = filename.resolve()
        if filename not in self.loaded:
            env = UnityPy.load(str(filename))
            objects = {(str(obj.assets_file.name), int(obj.path_id)): obj for obj in env.objects}
            self.loaded[filename] = (env, objects)
        return self.loaded[filename]

    def sha(self, filename):
        filename = filename.resolve()
        if filename not in self.hashes:
            self.hashes[filename] = digest(filename.read_bytes())
        return self.hashes[filename]

    def relative(self, filename):
        return filename.resolve().relative_to(root).as_posix()

    def resolve(self, source, source_bundle, pointer):
        file_id = int(pointer.get("m_FileID", 0))
        path_id = int(pointer.get("m_PathID", 0))
        if path_id == 0:
            raise RuntimeError("null PPtr")
        if file_id == 0:
            cab = str(source.assets_file.name)
            target_bundle = source_bundle.resolve()
        else:
            externals = source.assets_file.externals
            if file_id < 1 or file_id > len(externals):
                raise RuntimeError("PPtr file id out of range")
            cab = str(externals[file_id - 1].name)
            target_bundle = self.cabs.get(cab)
            if target_bundle is None:
                raise RuntimeError("unresolved official external CAB " + cab)
        target = self.load(target_bundle)[1].get((cab, path_id))
        if target is None:
            raise RuntimeError("missing official PPtr target %s:%s" % (cab, path_id))
        return target, target_bundle

prefabs = [prefab(card) for card in cards]
for filename in prefabs:
    if not filename.is_file():
        raise RuntimeError("missing official prefab " + str(filename))

index = Index()
paths = set(prefabs)
for scan_root in (root / "Common" / "CardNew" / "Common", root / "Common" / "Shader"):
    paths.update(scan_root.rglob("*_bundles"))
for filename in sorted(paths):
    index.register(filename)

card_rows = []
draws = []
shaders = {}
for card, filename in zip(cards, prefabs):
    objects = index.load(filename)[1]
    renderers = sorted(
        (obj for obj in objects.values() if obj.type.name == "MeshRenderer"),
        key=lambda obj: int(obj.path_id),
    )
    card_draws = 0
    for renderer in renderers:
        tree = renderer.read_typetree()
        for slot, material_pointer in enumerate(tree.get("m_Materials") or []):
            material_obj, material_bundle = index.resolve(renderer, filename, material_pointer)
            if material_obj.type.name != "Material":
                raise RuntimeError("renderer material PPtr did not resolve to Material")
            material = material_obj.read_typetree()
            shader_obj, shader_bundle = index.resolve(material_obj, material_bundle, material.get("m_Shader") or {})
            if shader_obj.type.name != "Shader":
                raise RuntimeError("material shader PPtr did not resolve to Shader")
            shader = shader_obj.read_typetree()
            parsed = shader.get("m_ParsedForm") or {}
            subshaders = parsed.get("m_SubShaders") or []
            pass_tags = []
            for subshader in subshaders:
                for shader_pass in subshader.get("m_Passes") or []:
                    pairs = (shader_pass.get("m_Tags") or {}).get("tags") or []
                    pass_tags.append([[str(pair[0]), str(pair[1])] for pair in pairs])
            identity = "%s:%s" % (shader_obj.assets_file.name, shader_obj.path_id)
            raw = bytes(shader_obj.get_raw_data())
            row = {
                "identity": identity,
                "name": str(parsed.get("m_Name") or ""),
                "bundle": index.relative(shader_bundle),
                "bundleSha256": index.sha(shader_bundle),
                "rawByteSize": len(raw),
                "rawSha256": digest(raw),
                "subshaderCount": len(subshaders),
                "passCount": sum(len(item.get("m_Passes") or []) for item in subshaders),
                "passTags": pass_tags,
            }
            prior = shaders.get(identity)
            if prior is not None and prior != row:
                raise RuntimeError("one Shader identity decoded inconsistently")
            shaders[identity] = row
            draws.append({
                "card": card,
                "rendererPathId": str(renderer.path_id),
                "materialSlot": slot,
                "shaderIdentity": identity,
            })
            card_draws += 1
    card_rows.append({
        "card": card,
        "prefab": index.relative(filename),
        "prefabSha256": index.sha(filename),
        "meshRenderers": len(renderers),
        "draws": card_draws,
    })

print(json.dumps({"cards": card_rows, "draws": draws, "shaders": list(shaders.values())}, separators=(",", ":")))
`;

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(actual, expected, label) {
  requireCondition(stable(actual) === stable(expected),
    `${label}: expected ${stable(expected)}, got ${stable(actual)}`);
}

function zipEntry(zip, wantedName) {
  const minimum = Math.max(0, zip.length - 0x10000 - 22);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  requireCondition(eocd >= 0, "ZIP end-of-central-directory was not found");
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    requireCondition(zip.readUInt32LE(cursor) === 0x02014b50, "invalid ZIP central directory");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      requireCondition(zip.readUInt32LE(localOffset) === 0x04034b50, `invalid ZIP entry ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      const value = method === 0 ? Buffer.from(compressed)
        : method === 8 ? inflateRawSync(compressed) : null;
      requireCondition(value, `unsupported ZIP method ${method} for ${name}`);
      requireCondition(value.length === uncompressedSize, `ZIP size mismatch for ${name}`);
      return value;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${wantedName}`);
}

function safeUint64(buffer, offset, label) {
  const value = buffer.readBigUInt64LE(offset);
  requireCondition(value <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds exact integer range`);
  return Number(value);
}

function elfRange(elf, startRva, endRva) {
  requireCondition(elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "not ELF");
  const phoff = safeUint64(elf, 0x20, "program header offset");
  const entrySize = elf.readUInt16LE(0x36);
  const count = elf.readUInt16LE(0x38);
  for (let index = 0; index < count; index += 1) {
    const cursor = phoff + index * entrySize;
    if (elf.readUInt32LE(cursor) !== 1) continue;
    const fileOffset = safeUint64(elf, cursor + 8, "segment file offset");
    const virtualAddress = safeUint64(elf, cursor + 16, "segment address");
    const fileSize = safeUint64(elf, cursor + 32, "segment file size");
    if (startRva >= virtualAddress && endRva <= virtualAddress + fileSize) {
      const start = fileOffset + startRva - virtualAddress;
      return elf.subarray(start, start + endRva - startRva);
    }
  }
  throw new Error(`ELF RVA 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`);
}

function checkInstruction(elf, rva, expectedHex, label) {
  const actual = elfRange(elf, rva, rva + expectedHex.length / 2).toString("hex");
  requireCondition(actual === expectedHex, `${label} at 0x${rva.toString(16)}: ${actual}`);
}

function decryptMetadata(encrypted, libil2cpp) {
  requireCondition(encrypted.readUInt32LE(0) === encrypted.length - 4,
    "encrypted metadata length header mismatch");
  const table = elfRange(libil2cpp, 0x7a52554, 0x7a52564);
  requireCondition(table.toString("hex") === "b195674699a63503e79e67149da46f04",
    "metadata key table changed");
  const mask = Buffer.from("d4ac0576fb920d61", "hex");
  const key = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) key[index] = table[index] ^ mask[index & 7];
  const ciphertext = encrypted.subarray(4);
  const counters = Buffer.alloc(ciphertext.length);
  for (let offset = 0, counter = 1; offset < counters.length; offset += 16, counter += 1) {
    counters.writeUInt32BE(counter, offset + 12);
  }
  const aes = createCipheriv("aes-128-ecb", key, null);
  aes.setAutoPadding(false);
  const stream = Buffer.concat([aes.update(counters), aes.final()]);
  const plaintext = Buffer.allocUnsafe(ciphertext.length);
  for (let index = 0; index < ciphertext.length; index += 1) plaintext[index] = ciphertext[index] ^ stream[index];
  return plaintext;
}

function metadataLiteral(metadata, usageAddress) {
  const usageBase = 0x7542a00;
  const delta = usageAddress - usageBase;
  requireCondition(delta >= 0 && delta % 8 === 0, "unaligned metadata literal usage");
  const tableOffset = metadata.readUInt32LE(8);
  const tableSize = metadata.readUInt32LE(12);
  const dataOffset = metadata.readUInt32LE(16);
  const index = delta / 8;
  requireCondition(index < tableSize / 8, "metadata literal usage out of range");
  const record = tableOffset + index * 8;
  const length = metadata.readUInt32LE(record);
  const relativeOffset = metadata.readUInt32LE(record + 4);
  return metadata.toString("utf8", dataOffset + relativeOffset, dataOffset + relativeOffset + length);
}

function shaderAggregate(shaders) {
  const lines = shaders.map((shader) => [
    shader.identity, shader.rawByteSize, shader.rawSha256, shader.bundle, shader.bundleSha256,
    shader.name, shader.subshaderCount, shader.passCount, JSON.stringify(shader.passTags),
  ].join("\t")).sort();
  return sha256(lines.join("\n"));
}

function runBundleAudit() {
  requireCondition(fs.existsSync(DECRYPTED_ROOT) && fs.statSync(DECRYPTED_ROOT).isDirectory(),
    `official decrypted root missing: ${DECRYPTED_ROOT}`);
  const result = spawnSync(PYTHON, ["-", DECRYPTED_ROOT], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    input: PYTHON_EXTRACTOR,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  requireCondition(result.status === 0,
    (result.stderr || result.stdout || result.error?.message || `Python exited ${result.status}`).trim());
  const evidence = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  same(evidence.cards.map((card) => card.card), Object.keys(CARDS), "official card order");
  for (const card of evidence.cards) {
    const expected = CARDS[card.card];
    same({ meshRenderers: card.meshRenderers, draws: card.draws, prefabSha256: card.prefabSha256 },
      expected, `${card.card} official prefab`);
  }
  same(evidence.cards.reduce((sum, card) => sum + card.meshRenderers, 0), 78, "MeshRenderer count");
  same(evidence.draws.length, 98, "material draw count");
  same(evidence.shaders.length, 27, "unique Shader asset count");
  same(shaderAggregate(evidence.shaders),
    "211e66dbc3da364a2875fe8590590c015401956992b655830843cefb9c180a2c",
    "official Shader aggregate");

  for (const shader of evidence.shaders) {
    same(shader.subshaderCount, 1, `${shader.name} subshader count`);
    same(shader.passCount, 1, `${shader.name} pass count`);
    const explicitLightMode = shader.passTags.flat().filter(([key]) => key.toLowerCase() === "lightmode");
    same(explicitLightMode, [], `${shader.name} explicit LightMode tags`);
  }
  for (const draw of evidence.draws) {
    requireCondition(evidence.shaders.some((shader) => shader.identity === draw.shaderIdentity),
      `${draw.card}:${draw.rendererPathId}:${draw.materialSlot} has unresolved Shader identity`);
  }
  return evidence;
}

function runNativeAudit() {
  requireCondition(fs.existsSync(APKM) && fs.statSync(APKM).isFile(), `official APKM missing: ${APKM}`);
  const apkm = fs.readFileSync(APKM);
  const baseApk = zipEntry(apkm, "base.apk");
  const arm64 = zipEntry(apkm, "split_config.arm64_v8a.apk");
  const libunity = zipEntry(arm64, "lib/arm64-v8a/libunity.so");
  const libil2cpp = zipEntry(arm64, "lib/arm64-v8a/libil2cpp.so");
  const encrypted = zipEntry(baseApk, "assets/bin/Data/Managed/Metadata/global-metadata.dat");
  same(sha256(apkm), EXPECTED_PACKAGE.apkmSha256, "APKM SHA-256");
  same(sha256(baseApk), EXPECTED_PACKAGE.baseApkSha256, "base.apk SHA-256");
  same(sha256(arm64), EXPECTED_PACKAGE.arm64SplitSha256, "arm64 split SHA-256");
  same(sha256(libunity), EXPECTED_PACKAGE.libunitySha256, "libunity SHA-256");
  same(sha256(libil2cpp), EXPECTED_PACKAGE.libil2cppSha256, "libil2cpp SHA-256");
  same(sha256(encrypted), EXPECTED_PACKAGE.encryptedMetadataSha256, "encrypted metadata SHA-256");

  const metadata = decryptMetadata(encrypted, libil2cpp);
  same(sha256(metadata), EXPECTED_PACKAGE.plaintextMetadataSha256, "plaintext metadata SHA-256");
  same([metadata.readUInt32LE(0), metadata.readUInt32LE(4)], [0xfab11baf, 31], "metadata header");

  for (const [passName, constructor] of Object.entries(PASS_CONSTRUCTORS)) {
    const body = elfRange(libil2cpp, constructor.startRva, constructor.endRva);
    same(sha256(body), constructor.sha256, `${passName} constructor SHA-256`);
    for (const [rva, hex] of constructor.instructions) checkInstruction(libil2cpp, rva, hex, passName);
  }
  for (const tag of SHADER_TAGS) {
    const relocation = Buffer.from(tag.relocationHex, "hex");
    const first = libil2cpp.indexOf(relocation);
    requireCondition(first >= 0 && libil2cpp.indexOf(relocation, first + 1) < 0,
      `${tag.value} relocation is not unique`);
    same(Number(relocation.readBigUInt64LE(0)), tag.slotRva, `${tag.value} relocation target`);
    same(Number(relocation.readBigUInt64LE(8) & 0xffffffffn), 1027, `${tag.value} relocation type`);
    same(Number(relocation.readBigUInt64LE(8) >> 32n), 0, `${tag.value} relocation symbol`);
    same(metadataLiteral(metadata, Number(relocation.readBigInt64LE(16))), tag.value,
      `${tag.value} metadata literal`);
  }

  for (const [name, expected] of Object.entries(UNITY_FUNCTIONS)) {
    same(sha256(elfRange(libunity, expected.startRva, expected.endRva)), expected.sha256,
      `${name} native body SHA-256`);
  }
  for (const [rva, hex] of UNITY_INSTRUCTIONS) checkInstruction(libunity, rva, hex, "pass candidate native flow");
  return {
    shaderTags: SHADER_TAGS.map((tag) => tag.value),
    functions: Object.keys(UNITY_FUNCTIONS),
  };
}

try {
  const bundles = runBundleAudit();
  const native = runNativeAudit();
  const shadersByIdentity = new Map(bundles.shaders.map((shader) => [shader.identity, shader]));
  const candidateRows = bundles.draws.map((draw) => {
    const shader = shadersByIdentity.get(draw.shaderIdentity);
    requireCondition(shader, `${draw.card}:${draw.rendererPathId}:${draw.materialSlot} Shader missing`);
    const explicitLightModes = shader.passTags.flat()
      .filter(([key]) => key.toLowerCase() === "lightmode")
      .map(([, value]) => value);
    const effectiveLightMode = explicitLightModes[0] || "SRPDefaultUnlit";
    const candidates = native.shaderTags
      .map((tag, ordinal) => ({ tag, ordinal }))
      .filter(({ tag }) => tag === effectiveLightMode)
      .map(() => 0);
    same(candidates, [0], `${draw.card}:${draw.rendererPathId}:${draw.materialSlot} candidates`);
    return Object.freeze({ selectedShaderPassIndex: candidates[0], drawCandidateOrdinal: 0 });
  });
  same(candidateRows.length, 98, "per-draw candidate result count");
  requireCondition(candidateRows.every((row) => row.selectedShaderPassIndex === 0
    && row.drawCandidateOrdinal === 0), "per-draw pass candidate result drifted");
  const result = {
    status: "proved-with-explicit-boundary",
    authority: "official decrypted Unity bundles + package-matched APKM/native bytes",
    cards: bundles.cards,
    meshRenderers: 78,
    draws: 98,
    shaderAssets: 27,
    shaderFacts: {
      oneSubshaderAndOnePass: true,
      explicitLightModeTags: 0,
      shaderTagOrder: native.shaderTags,
    },
    candidateResult: {
      selectedShaderPassIndex: 0,
      drawCandidateOrdinal: 0,
      drawsVerified: candidateRows.length,
    },
    boundary: {
      visibleNodeIndex: "unproved",
      reason: "native code sources it from the runtime culling visible-node table; serialized prefab pathID/hierarchy order is not evidence of that runtime index",
    },
  };
  if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Official pass-candidate audit OK");
    console.log("  official prefabs   4 cards / 78 MeshRenderers / 98 material draws");
    console.log("  official Shaders   27 assets / 27 single-pass / 0 explicit LightMode tags");
    console.log(`  ShaderTag order    ${native.shaderTags.join(" -> ")}`);
    console.log("  all 98 draws       selectedShaderPassIndex=0 / drawCandidateOrdinal=0");
    console.log("  visibleNodeIndex   UNPROVED (runtime culling table index; no serialized surrogate claimed)");
    console.log("  sources            official bundles + APKM/libunity/libil2cpp/metadata; no scene/recipe/browser/screenshot");
  }
} catch (error) {
  console.error(`BAD official pass-candidate audit: ${error.message}`);
  process.exit(1);
}
