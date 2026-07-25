// Audit the official Android display-transfer policy without rendering screenshots.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const APKM = process.env.PCR_APKM
  || path.resolve(ROOT, "..", "ptcg-apk-parser", "apks", "jp.pokemon.pokemontcgp_1.6.0.apkm");

const EXPECTED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
    manifestSha256: "3ed19eb8b3cf767946b03df8682b33bea6daf8c1ad0cceecfa436cac36779e7a",
    libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  },
  functions: {
    configuredColorGamut: ["0x514d48", 124, "2cdd1ac8f5a88de737f47098547b2c1f97d687ba1da910b6ac24142318bfd307"],
    wideColorSupport: ["0x6db504", 160, "3dc1b3e79d069cd10b69be0bbaa1f4286b9f19347d805233babe3b1d69ac902c"],
    selectSurfaceFormat: ["0xaf0bd4", 1796, "58e224f53c2f7f748843c84c88e69eb4e1a98a10396ef43c0a261aaeeadc5818"],
    createSwapchainPolicy: ["0xaf2028", 1256, "3408d62df2ab78cf4d6d510c1dcc7bda8103cbff67805885e8638f0eddf50cd0"],
  },
  finalBlit: {
    fragmentBytes: 1056,
    fragmentSha256: "d146c34d1f09e1cf8c814e410a6be8bbcdb8903c0c0c09eb71e69b44377f2397",
  },
};

const PYTHON_EXTRACTOR = String.raw`
import hashlib, io, json, struct, sys, zipfile
import UnityPy
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN

def sha(data):
    return hashlib.sha256(data).hexdigest()

def pick(tree, *names):
    for name in names:
        if name in tree:
            return tree[name]
    raise KeyError(names)

def parse_manifest(data):
    if len(data) < 8 or struct.unpack_from("<I", data, 0)[0] != 0x00080003:
        raise RuntimeError("AndroidManifest.xml is not binary AXML")
    offset = 8
    while offset + 8 <= len(data):
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
        if chunk_type == 0x0001:
            count = struct.unpack_from("<I", data, offset + 8)[0]
            flags = struct.unpack_from("<I", data, offset + 16)[0]
            strings_start = struct.unpack_from("<I", data, offset + 20)[0]
            utf8 = bool(flags & 0x100)
            offsets = struct.unpack_from("<" + "I" * count, data, offset + header_size)
            base = offset + strings_start
            out = []
            for relative in offsets:
                pos = base + relative
                if utf8:
                    first = data[pos]
                    pos += 2 if first & 0x80 else 1
                    first = data[pos]
                    if first & 0x80:
                        length = ((first & 0x7f) << 8) | data[pos + 1]
                        pos += 2
                    else:
                        length = first
                        pos += 1
                    out.append(data[pos:pos + length].decode("utf-8"))
                else:
                    first = struct.unpack_from("<H", data, pos)[0]
                    if first & 0x8000:
                        length = ((first & 0x7fff) << 16) | struct.unpack_from("<H", data, pos + 2)[0]
                        pos += 4
                    else:
                        length = first
                        pos += 2
                    out.append(data[pos:pos + length * 2].decode("utf-16le"))
            strings = out
            break
        if chunk_size < 8:
            break
        offset += chunk_size
    else:
        raise RuntimeError("AndroidManifest.xml has no string pool")

    elements = []
    offset = 8
    while offset + 8 <= len(data):
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
        if chunk_type == 0x0102:
            name_index = struct.unpack_from("<I", data, offset + 20)[0]
            attribute_start, attribute_size, attribute_count = struct.unpack_from("<HHH", data, offset + 24)
            attributes = {}
            attribute_offset = offset + 16 + attribute_start
            for index in range(attribute_count):
                item = attribute_offset + index * attribute_size
                attr_name, raw_value = struct.unpack_from("<II", data, item + 4)
                data_type = data[item + 15]
                typed_value = struct.unpack_from("<I", data, item + 16)[0]
                if raw_value != 0xffffffff:
                    value = strings[raw_value]
                elif data_type == 0x03:
                    value = strings[typed_value]
                elif data_type == 0x12:
                    value = bool(typed_value)
                else:
                    value = typed_value
                attributes[strings[attr_name]] = value
            elements.append((strings[name_index], attributes))
        if chunk_size < 8:
            break
        offset += chunk_size
    return strings, elements

apkm_path = sys.argv[1]
apkm = open(apkm_path, "rb").read()
outer = zipfile.ZipFile(io.BytesIO(apkm))
base_apk = outer.read("base.apk")
arm64_name = next(name for name in outer.namelist() if "arm64_v8a" in name and name.endswith(".apk"))
arm64_apk = outer.read(arm64_name)
base = zipfile.ZipFile(io.BytesIO(base_apk))
arm64 = zipfile.ZipFile(io.BytesIO(arm64_apk))
ggm = base.read("assets/bin/Data/globalgamemanagers")
manifest = base.read("AndroidManifest.xml")
libunity = arm64.read("lib/arm64-v8a/libunity.so")

env = UnityPy.load(ggm)
player = next(obj.read_typetree() for obj in env.objects if obj.type.name == "PlayerSettings")
build = next(obj.read_typetree() for obj in env.objects if obj.type.name == "BuildSettings")

text_offset = 0x3ab850
text_address = 0x3af850
functions = {
    "configuredColorGamut": (0x514d48, 0x514dc4),
    "wideColorSupport": (0x6db504, 0x6db5a4),
    "selectSurfaceFormat": (0xaf0bd4, 0xaf12d8),
    "createSwapchainPolicy": (0xaf2028, 0xaf2510),
}

def body(start, end):
    offset = text_offset + start - text_address
    return libunity[offset:offset + end - start]

md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
instruction_addresses = {
    0xaf0c68, 0xaf0c6c, 0xaf0c74,
    0xaf1064, 0xaf1068,
    0xaf10a4, 0xaf10b0, 0xaf10d8, 0xaf10e4,
    0xaf114c, 0xaf1158, 0xaf11b4, 0xaf11c0,
    0xaf121c, 0xaf1228, 0xaf1250, 0xaf125c,
    0xaf12b4, 0xaf12c0,
    0xaf20a0, 0xaf20ac, 0xaf20b0, 0xaf20b4,
    0xaf2198,
}
instructions = {}
for name in ("selectSurfaceFormat", "createSwapchainPolicy"):
    start, end = functions[name]
    for insn in md.disasm(body(start, end), start):
        if insn.address in instruction_addresses:
            instructions[hex(insn.address)] = insn.mnemonic + (" " + insn.op_str if insn.op_str else "")

manifest_string_list, manifest_elements = parse_manifest(manifest)
strings = set(manifest_string_list)
vulkan_feature = next(attrs for name, attrs in manifest_elements
                      if name == "uses-feature" and attrs.get("name") == "android.hardware.vulkan.version")
unity_activity = next(attrs for name, attrs in manifest_elements
                      if name == "activity" and attrs.get("name") == "com.unity3d.player.UnityPlayerActivity")
result = {
    "source": {
        "apkmSha256": sha(apkm),
        "baseApkSha256": sha(base_apk),
        "arm64SplitSha256": sha(arm64_apk),
        "globalgamemanagersSha256": sha(ggm),
        "manifestSha256": sha(manifest),
        "libunitySha256": sha(libunity),
    },
    "manifest": {
        "hasVulkanFeature": "android.hardware.vulkan.version" in strings,
        "hasUnityPlayerActivity": "com.unity3d.player.UnityPlayerActivity" in strings,
        "hasColorModeAttribute": "colorMode" in strings,
        "hasHardwareAcceleratedAttribute": "hardwareAccelerated" in strings,
        "vulkanFeatureRequired": vulkan_feature.get("required"),
        "unityActivityHardwareAccelerated": unity_activity.get("hardwareAccelerated"),
        "unityActivityHasColorMode": "colorMode" in unity_activity,
    },
    "buildSettings": {
        "graphicsAPIs": list(pick(build, "m_GraphicsAPIs")),
    },
    "playerSettings": {
        "activeColorSpace": int(pick(player, "m_ActiveColorSpace")),
        "use32BitDisplayBuffer": bool(pick(player, "use32BitDisplayBuffer", "m_Use32BitDisplayBuffer")),
        "preserveFramebufferAlpha": bool(pick(player, "preserveFramebufferAlpha", "m_PreserveFramebufferAlpha")),
        "androidBlitType": int(pick(player, "androidBlitType", "m_AndroidBlitType")),
        "vulkanEnableSetSRGBWrite": bool(pick(player, "vulkanEnableSetSRGBWrite")),
        "vulkanNumSwapchainBuffers": int(pick(player, "vulkanNumSwapchainBuffers")),
        "allowHDRDisplaySupport": bool(pick(player, "allowHDRDisplaySupport")),
        "useHDRDisplay": bool(pick(player, "useHDRDisplay")),
        "hdrBitDepth": int(pick(player, "hdrBitDepth")),
        "colorGamuts": list(pick(player, "m_ColorGamuts")),
    },
    "functions": {
        name: {
            "start": hex(start),
            "byteSize": end - start,
            "sha256": sha(body(start, end)),
        }
        for name, (start, end) in functions.items()
    },
    "instructions": instructions,
}
print(json.dumps(result, separators=(",", ":")))
`;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function runPython(script, args, maxBuffer = 8 * 1024 * 1024) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-display-transfer-python-"));
  const source = path.join(tmp, "extract.py");
  fs.writeFileSync(source, script);
  try {
    const result = spawnSync(PYTHON, ["-B", source, ...args], {
      cwd: ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8",
      maxBuffer,
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "display-transfer extractor failed").trim());
    }
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function extractFinalBlit() {
  const result = spawnSync(PYTHON, ["-B", "build/extract_official_final_blit.py"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PCR_APKM: APKM },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "FinalBlit extractor failed").trim());
  return JSON.parse(result.stdout);
}

function assertInstruction(actual, address, expected) {
  assert.equal(actual[address], expected, `libunity instruction ${address}`);
}

const evidence = runPython(PYTHON_EXTRACTOR, [APKM]);
assert.deepEqual(evidence.source, EXPECTED.source);
assert.deepEqual(evidence.manifest, {
  hasVulkanFeature: true,
  hasUnityPlayerActivity: true,
  hasColorModeAttribute: false,
  hasHardwareAcceleratedAttribute: true,
  vulkanFeatureRequired: false,
  unityActivityHardwareAccelerated: true,
  unityActivityHasColorMode: false,
});
assert.deepEqual(evidence.buildSettings, { graphicsAPIs: [21] });
assert.deepEqual(evidence.playerSettings, {
  activeColorSpace: 0,
  use32BitDisplayBuffer: true,
  preserveFramebufferAlpha: false,
  androidBlitType: 0,
  vulkanEnableSetSRGBWrite: false,
  vulkanNumSwapchainBuffers: 2,
  allowHDRDisplaySupport: false,
  useHDRDisplay: false,
  hdrBitDepth: 0,
  colorGamuts: [0],
});

for (const [name, [start, byteSize, hash]] of Object.entries(EXPECTED.functions)) {
  assert.deepEqual(evidence.functions[name], { start, byteSize, sha256: hash });
}

// These instructions bind the pinned bodies to the interpreted Vulkan policy.
assertInstruction(evidence.instructions, "0xaf0c68", "bl #0x514dc4");
assertInstruction(evidence.instructions, "0xaf0c6c", "cmp w0, #3");
assertInstruction(evidence.instructions, "0xaf0c74", "bl #0x6f3fc0");
assertInstruction(evidence.instructions, "0xaf1064", "bl #0xa4b22c");
assertInstruction(evidence.instructions, "0xaf1068", "cmp w0, #1");
for (const [address, format] of [
  ["0xaf10a4", "0x25"], ["0xaf10d8", "0x2c"], ["0xaf114c", "0x33"],
  ["0xaf11b4", "0x17"], ["0xaf121c", "0x1e"], ["0xaf1250", "0x1d"],
  ["0xaf12b4", "0x24"],
]) {
  assert.match(evidence.instructions[address], new RegExp(`^cmp w(?:10|12), #${format}$`));
}
for (const address of ["0xaf10b0", "0xaf10e4", "0xaf1158", "0xaf11c0", "0xaf1228", "0xaf125c", "0xaf12c0"]) {
  assert.match(evidence.instructions[address], /^cbnz w(?:10|12), #0x[0-9a-f]+$/);
}
assertInstruction(evidence.instructions, "0xaf20a0", "bl #0xa4b22c");
assertInstruction(evidence.instructions, "0xaf20ac", "mov w8, #0x25");
assertInstruction(evidence.instructions, "0xaf20b0", "mov w9, #0x2b");
assertInstruction(evidence.instructions, "0xaf20b4", "csel w8, w9, w8, eq");
assertInstruction(evidence.instructions, "0xaf2198", "bl #0xaf0bd4");

const finalBlit = extractFinalBlit();
assert.equal(finalBlit.source.apkmSha256, EXPECTED.source.apkmSha256);
assert.equal(finalBlit.source.baseApkSha256, EXPECTED.source.baseApkSha256);
assert.equal(finalBlit.source.globalgamemanagersSha256, EXPECTED.source.globalgamemanagersSha256);
const fragment = finalBlit.shaderProgram.pass.modules.find((module) => module.stage === "fragment");
assert.ok(fragment, "official FinalBlit fragment module is missing");
const fragmentBytes = Buffer.from(fragment.spvHex, "hex");
assert.equal(fragmentBytes.length, EXPECTED.finalBlit.fragmentBytes);
assert.equal(sha256(fragmentBytes), EXPECTED.finalBlit.fragmentSha256);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-display-transfer-final-blit-"));
try {
  const spv = path.join(tmp, "final-blit.frag.spv");
  fs.writeFileSync(spv, fragmentBytes);
  const glsl = execFileSync(SPIRV_CROSS, [spv, "--version", "300", "--es"], { encoding: "utf8" });
  assert.match(glsl, /_9\s*=\s*textureLod\(SPIRV_Cross_Combined,\s*vs_TEXCOORD0,\s*_26\._m0\);/);
  assert.equal((glsl.match(/\btextureLod\s*\(/g) || []).length, 1);
  assert.doesNotMatch(glsl, /\b(?:pow|exp2|log2)\s*\(|sRGB|SRGB|Gamma|LinearTo|ToLinear/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const contract = {
  officialAndroidPolicy: {
    status: "proven",
    graphicsApi: "Vulkan",
    workflow: "Gamma",
    finalBlit: "identity textureLod",
    shaderWriteEncoding: "gamma-domain values written without an sRGB attachment conversion",
    requestedSurfaceFormat: { vkFormat: 37, name: "VK_FORMAT_R8G8B8A8_UNORM" },
    surfaceFormatPriority: [37, 44, 51, 23, 30, 29, 36],
    requiredColorSpace: { value: 0, name: "VK_COLOR_SPACE_SRGB_NONLINEAR_KHR" },
    alpha: "opaque compositor input (preserveFramebufferAlpha=false)",
  },
  actualAndroidSwapchain: {
    status: "device-state",
    condition: "the selected pair depends on vkGetPhysicalDeviceSurfaceFormatsKHR for the running device",
  },
  compositorInput: {
    status: "conditionally-proven",
    condition: "the runtime-selected VkSurfaceFormatKHR is the pinned policy's UNORM + SRGB_NONLINEAR pair",
  },
  deviceOutput: {
    status: "not-observable",
    boundary: "Android compositor, display color management, panel transfer, and viewing conditions",
  },
};

console.log("Official display-transfer static audit OK");
console.log(JSON.stringify(contract));
