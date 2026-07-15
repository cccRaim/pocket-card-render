#!/usr/bin/env python3
"""Extract the official card MRT and Bloom pipeline directly from the Android APKM.

Method RVAs are package-matched locators only. All reported instructions, method
body hashes, serialized shader bytes, and SPIR-V modules come from the APKM.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import zipfile

try:
    from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("capstone is required: python -m pip install capstone") from exc

try:
    import lz4.block
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("lz4 is required: python -m pip install lz4") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
GGM_PATH = "assets/bin/Data/globalgamemanagers"
GGM_RESOURCE_PREFIX = "assets/bin/Data/globalgamemanagers.assets.split"
IL2CPP_PATH = "lib/arm64-v8a/libil2cpp.so"
BLOOM_SHADER_NAME = b"Hidden/CustomPostEffect/Bloom"

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402


# End RVAs are the next package-matched method locators. They delimit the exact
# official byte range and include IL2CPP's post-ret exception thunks.
METHODS = {
    "rendererDataCtor": {
        "name": "Lettuce.Graphics.Rendering.RendererData..ctor",
        "rva": 0x430B254,
        "endRva": 0x430B648,
    },
    "customRendererSetup": {
        "name": "Lettuce.Graphics.Rendering.CustomRenderer.Setup",
        "rva": 0x430C2A8,
        "endRva": 0x430C39C,
    },
    "drawOpaqueOnCameraSetup": {
        "name": "Lettuce.Graphics.Rendering.DrawOpaquePass.OnCameraSetup",
        "rva": 0x430D3C4,
        "endRva": 0x430D3E8,
    },
    "drawPostProcessExecute": {
        "name": "Lettuce.Graphics.Rendering.DrawPostProcessPass.Execute",
        "rva": 0x430D694,
        "endRva": 0x430D764,
    },
    "drawTransparentOnCameraSetup": {
        "name": "Lettuce.Graphics.Rendering.DrawTransparentPass.OnCameraSetup",
        "rva": 0x430D914,
        "endRva": 0x430D938,
    },
    "rendererDataGetTemporary": {
        "name": "Lettuce.Graphics.Rendering.RendererData.GetTemporary",
        "rva": 0x430E344,
        "endRva": 0x430E570,
    },
    "bloomPassExecute": {
        "name": "Lettuce.Graphics.PostProcessing.Bloom.BloomPass.Execute",
        "rva": 0x43076EC,
        "endRva": 0x43084FC,
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Elf64:
    def __init__(self, data: bytes):
        if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
            raise RuntimeError("libil2cpp is not a little-endian ELF64 image")
        self.data = data
        phoff = struct.unpack_from("<Q", data, 32)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 54)
        self.loads = []
        for index in range(phnum):
            off = phoff + index * phentsize
            p_type, p_flags, p_offset, p_vaddr, _, p_filesz, p_memsz, _ = struct.unpack_from(
                "<IIQQQQQQ", data, off
            )
            if p_type == 1:
                self.loads.append(
                    {
                        "flags": p_flags,
                        "offset": p_offset,
                        "vaddr": p_vaddr,
                        "fileSize": p_filesz,
                        "memorySize": p_memsz,
                    }
                )

    def rva_to_offset(self, rva: int) -> int:
        for segment in self.loads:
            start = segment["vaddr"]
            if start <= rva < start + segment["fileSize"]:
                return segment["offset"] + rva - start
        raise RuntimeError(f"RVA 0x{rva:x} is outside ELF file-backed PT_LOAD segments")

    def range(self, start_rva: int, end_rva: int) -> bytes:
        start = self.rva_to_offset(start_rva)
        end = self.rva_to_offset(end_rva)
        if end - start != end_rva - start_rva:
            raise RuntimeError("method range crosses non-contiguous ELF segments")
        return self.data[start:end]


def disassemble(elf: Elf64, start_rva: int, end_rva: int):
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    return list(decoder.disasm(elf.range(start_rva, end_rva), start_rva))


def instruction_map(instructions):
    return {item.address: f"{item.mnemonic} {item.op_str}".strip() for item in instructions}


def require_instructions(instructions, expected: dict[int, str], method: str):
    actual = instruction_map(instructions)
    mismatches = []
    for address, signature in expected.items():
        if actual.get(address) != signature:
            mismatches.append(f"0x{address:x}: expected {signature!r}, got {actual.get(address)!r}")
    if mismatches:
        raise RuntimeError(f"{method} ARM64 signature changed: {'; '.join(mismatches)}")


def method_evidence(elf: Elf64, key: str, spec: dict) -> dict:
    body = elf.range(spec["rva"], spec["endRva"])
    instructions = disassemble(elf, spec["rva"], spec["endRva"])
    calls = [
        {"address": f"0x{item.address:x}", "target": item.op_str.removeprefix("#")}
        for item in instructions
        if item.mnemonic == "bl"
    ]
    return {
        "key": key,
        "method": spec["name"],
        "architecture": "arm64-v8a",
        "rva": f"0x{spec['rva']:x}",
        "endRvaExclusive": f"0x{spec['endRva']:x}",
        "fileOffset": f"0x{elf.rva_to_offset(spec['rva']):x}",
        "bodySize": len(body),
        "bodySha256": sha256(body),
        "retAddresses": [f"0x{item.address:x}" for item in instructions if item.mnemonic == "ret"],
        "calls": calls,
    }


def decode_native_pipeline(elf_bytes: bytes) -> dict:
    elf = Elf64(elf_bytes)
    decoded = {key: disassemble(elf, spec["rva"], spec["endRva"]) for key, spec in METHODS.items()}

    require_instructions(
        decoded["rendererDataCtor"],
        {
            0x430B3CC: "mov w1, #2",
            0x430B3E0: "str x1, [x19, #0x498]",
            0x430B3EC: "mov w1, #2",
            0x430B3FC: "str x1, [x19, #0x4a0]",
        },
        METHODS["rendererDataCtor"]["name"],
    )
    require_instructions(
        decoded["rendererDataGetTemporary"],
        {
            0x430E364: "mov w1, wzr",
            0x430E36C: "bl #0x650e700",
            0x430E3B8: "bl #0x653d590",
            0x430E3E4: "bl #0x653d590",
            0x430E3EC: "mov w1, #0x18",
            0x430E3F4: "bl #0x650e648",
            0x430E3FC: "mov w1, #1",
            0x430E404: "bl #0x650e700",
            0x430E430: "bl #0x653d590",
            0x430E45C: "bl #0x653d590",
        },
        METHODS["rendererDataGetTemporary"]["name"],
    )
    require_instructions(
        decoded["customRendererSetup"],
        {
            0x430C2D4: "bl #0x63cf4e4",
            0x430C2E4: "bl #0x63cf4e4",
            0x430C300: "bl #0x63cf4e4",
            0x430C320: "bl #0x63cf4e4",
            0x430C330: "bl #0x63cf4e4",
            0x430C368: "bl #0x63cf4e4",
            0x430C380: "bl #0x63cf4e4",
        },
        METHODS["customRendererSetup"]["name"],
    )
    for key in ("drawOpaqueOnCameraSetup", "drawTransparentOnCameraSetup"):
        expected = {
            METHODS[key]["rva"] + 0xC: "ldr x1, [x8, #0x498]",
            METHODS[key]["rva"] + 0x14: "ldr x2, [x8, #0x30]",
            METHODS[key]["rva"] + 0x1C: "b #0x63c66ac",
        }
        require_instructions(decoded[key], expected, METHODS[key]["name"])
    require_instructions(
        decoded["bloomPassExecute"],
        {
            0x4307AB4: "mov w4, wzr",
            0x4307AD8: "bl #0x653fce8",
            0x4307C2C: "mov w4, #1",
            0x4307C48: "bl #0x653fce8",
            0x4307EB0: "mov w5, #2",
            0x4307ED0: "bl #0x653f3c0",
            0x4308080: "mov w4, #3",
            0x43080A4: "bl #0x653fce8",
            0x430816C: "mov w4, #3",
            0x4308198: "bl #0x653fce8",
            0x43082EC: "mov w5, #4",
            0x4308304: "bl #0x653f3c0",
            0x43083F8: "mov w4, #5",
            0x4308424: "bl #0x653fce8",
        },
        METHODS["bloomPassExecute"]["name"],
    )

    pass_graph = [
        {"order": 0, "pass": "PrePass", "fieldOffset": "0x1b0", "enqueueCall": "0x430c2d4", "condition": "always"},
        {"order": 1, "pass": "DrawOpaque", "fieldOffset": "0x1b8", "enqueueCall": "0x430c2e4", "condition": "always"},
        {"order": 2, "pass": "DrawSkybox", "fieldOffset": "0x1c0", "enqueueCall": "0x430c300", "condition": "IsSkybox"},
        {"order": 3, "pass": "CopyDepth", "fieldOffset": "0x1c8", "enqueueCall": "0x430c320", "condition": "UseDepthTexture"},
        {"order": 4, "pass": "DrawTransparent", "fieldOffset": "0x1d0", "enqueueCall": "0x430c330", "condition": "always"},
        {"order": 5, "pass": "DrawPostProcess", "fieldOffset": "0x1d8", "enqueueCall": "0x430c368", "condition": "IsPostGroupLast"},
        {"order": 6, "pass": "FinalBlit", "fieldOffset": "0x1e0", "enqueueCall": "0x430c380", "condition": "resolveFinalTarget"},
    ]
    bloom_calls = [
        {"order": 0, "pass": 0, "operation": "Blit", "call": "0x4307ad8"},
        {"order": 1, "pass": 1, "operation": "Blit/downsample loop", "call": "0x4307c48"},
        {"order": 2, "pass": 2, "operation": "DrawMesh/Image2Sheet", "call": "0x4307ed0"},
        {"order": 3, "pass": 3, "operation": "Blit/blur", "call": "0x43080a4"},
        {"order": 4, "pass": 3, "operation": "Blit/blur", "call": "0x4308198"},
        {"order": 5, "pass": 4, "operation": "DrawMesh/Sheet2Image", "call": "0x4308304"},
        {"order": 6, "pass": 5, "operation": "Blit/final", "call": "0x4308424"},
    ]
    methods = {key: method_evidence(elf, key, spec) for key, spec in METHODS.items()}
    return {
        "elfLoadSegments": elf.loads,
        "methods": methods,
        "mrt": {
            "colorAttachmentCount": 2,
            "multiRenderTargetArrayLength": 2,
            "colorFormatValue": 0,
            "colorFormat": "ARGB32",
            "depthBufferBits": 24,
            "depthFormatValue": 1,
            "depthFormat": "Depth",
            "colorAllocCalls": ["0x430e3b8", "0x430e3e4"],
            "depthAllocCalls": ["0x430e430", "0x430e45c"],
            "opaqueAndTransparentBindMrt": True,
        },
        "customRendererPassGraph": pass_graph,
        "drawPostProcess": {
            "iteratesSerializedPassList": True,
            "virtualExecuteCall": "0x430d738",
            "methodBodySha256": methods["drawPostProcessExecute"]["bodySha256"],
        },
        "bloomExecuteSequence": bloom_calls,
    }


def align4(value: int) -> int:
    return (value + 3) & ~3


def read_u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def exec_model(spv: bytes) -> int:
    words = struct.unpack(f"<{len(spv) // 4}I", spv)
    index = 5
    while index < len(words):
        length = words[index] >> 16
        opcode = words[index] & 0xFFFF
        if length < 1 or index + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        if opcode == 15:
            return words[index + 1]
        index += length
    raise RuntimeError("SPIR-V module has no OpEntryPoint")


def spirv_summary(spv: bytes) -> dict:
    words = struct.unpack(f"<{len(spv) // 4}I", spv)
    index = 5
    opcodes = Counter()
    types = {}
    float_constants = []
    unsigned_constants = []
    ext_instructions = []
    while index < len(words):
        length = words[index] >> 16
        opcode = words[index] & 0xFFFF
        if length < 1 or index + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        opcodes[opcode] += 1
        if opcode == 21 and length == 4:
            types[words[index + 1]] = ("int", words[index + 2], words[index + 3])
        elif opcode == 22 and length == 3:
            types[words[index + 1]] = ("float", words[index + 2])
        elif opcode == 43 and length >= 4:
            kind = types.get(words[index + 1])
            if kind == ("float", 32):
                raw = words[index + 3]
                float_constants.append({"bits": f"0x{raw:08x}", "value": struct.unpack("<f", struct.pack("<I", raw))[0]})
            elif kind == ("int", 32, 0):
                unsigned_constants.append(words[index + 3])
        elif opcode == 12 and length >= 5:
            ext_instructions.append(words[index + 4])
        index += length
    if index != len(words):
        raise RuntimeError("SPIR-V module did not end on an instruction boundary")
    return {
        "executionModel": exec_model(spv),
        "opCounts": {str(key): opcodes[key] for key in sorted(opcodes)},
        "floatConstants": float_constants,
        "unsignedConstants": unsigned_constants,
        "extendedInstructionNumbers": ext_instructions,
    }


def decode_bloom_shader(resource: bytes) -> dict:
    occurrences = []
    cursor = 0
    while True:
        found = resource.find(BLOOM_SHADER_NAME, cursor)
        if found < 0:
            break
        occurrences.append(found)
        cursor = found + 1
    if len(occurrences) != 1:
        raise RuntimeError(f"expected one Bloom shader in globalgamemanagers.assets, found {len(occurrences)}")

    name_offset = occurrences[0]
    fields = align4(name_offset + len(BLOOM_SHADER_NAME))
    expected = {
        fields + 20: 1,
        fields + 24: 18,
        fields + 28: 1,
        fields + 32: 1,
        fields + 36: 0,
        fields + 40: 1,
        fields + 44: 1,
        fields + 52: 1,
        fields + 56: 1,
    }
    for offset, value in expected.items():
        actual = read_u32(resource, offset)
        if actual != value:
            raise RuntimeError(f"Bloom serialized layout changed at 0x{offset:x}: expected {value}, got {actual}")
    compressed_length = read_u32(resource, fields + 48)
    decompressed_length = read_u32(resource, fields + 60)
    blob_length = read_u32(resource, fields + 64)
    if blob_length != compressed_length:
        raise RuntimeError("Bloom compressedBlob length does not match compressedLengths")
    blob_offset = fields + 68
    compressed = resource[blob_offset : blob_offset + blob_length]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=decompressed_length)
    if len(decompressed) != decompressed_length:
        raise RuntimeError("Bloom shader decompressed length changed")

    magic = struct.pack("<I", smolv.SMOL_MAGIC)
    offsets = []
    cursor = 0
    while True:
        found = decompressed.find(magic, cursor)
        if found < 0:
            break
        offsets.append(found)
        cursor = found + 4
    modules = []
    for index, offset in enumerate(offsets):
        end = offsets[index + 1] if index + 1 < len(offsets) else len(decompressed)
        decoded = smolv.decode(decompressed[offset:end])
        declared_size = read_u32(decompressed, offset + 20)
        if declared_size < 20 or declared_size % 4 or declared_size > len(decoded):
            raise RuntimeError(f"invalid decoded SPIR-V size for Bloom module {index}")
        spv = decoded[:declared_size]
        if read_u32(spv, 0) != smolv.SPIRV_MAGIC:
            raise RuntimeError(f"Bloom module {index} is not SPIR-V")
        summary = spirv_summary(spv)
        modules.append(
            {
                "index": index,
                "pass": index // 2,
                "stage": {0: "vertex", 4: "fragment"}.get(summary["executionModel"], f"model-{summary['executionModel']}"),
                "smolvOffset": offset,
                "decodedSize": declared_size,
                "sha256": sha256(spv),
                **summary,
            }
        )
    if len(modules) != 12:
        raise RuntimeError(f"expected 12 Bloom modules, found {len(modules)}")
    expected_stages = ["fragment", "vertex"] * 6
    if [module["stage"] for module in modules] != expected_stages:
        raise RuntimeError("Bloom module stage ordering changed")

    fragment = {module["pass"]: module for module in modules if module["stage"] == "fragment"}
    pass0_bits = [item["bits"] for item in fragment[0]["floatConstants"]]
    pass1_ext = fragment[1]["extendedInstructionNumbers"]
    pass3_taps = [
        value
        for value in fragment[3]["unsignedConstants"]
        if value in {1059481190, 1044885012, 1075545375, 1044482359, 1082906378, 1035342132, 1086995825, 1021182162}
    ]
    pass5_arithmetic = {
        opcode: count
        for opcode, count in fragment[5]["opCounts"].items()
        if 124 <= int(opcode) <= 200
    }
    pass0_threshold_ops = {
        opcode: count
        for opcode, count in fragment[0]["opCounts"].items()
        if 169 <= int(opcode) <= 191
    }
    return {
        "name": BLOOM_SHADER_NAME.decode("ascii"),
        "nameOffset": name_offset,
        "platforms": [18],
        "compressedBlobOffset": blob_offset,
        "compressedLength": compressed_length,
        "decompressedLength": decompressed_length,
        "compressedSha256": sha256(compressed),
        "decompressedSha256": sha256(decompressed),
        "moduleCount": len(modules),
        "passCountFromModulePairs": len(modules) // 2,
        "modules": modules,
        "math": {
            "pass0": {
                "operation": "rgb *= rgb * (rgb * a + b) + c",
                "constantBits": pass0_bits,
                "imageSampleCount": fragment[0]["opCounts"].get("87", 0),
                "fAddCount": fragment[0]["opCounts"].get("129", 0),
                "fMulCount": fragment[0]["opCounts"].get("133", 0),
                "thresholdOrKneeDetected": bool(
                    pass0_threshold_ops or fragment[0]["extendedInstructionNumbers"]
                ),
            },
            "pass1": {
                "operation": "four diagonal samples, component-wise max",
                "imageSampleCount": fragment[1]["opCounts"].get("87", 0),
                "fMaxExtInstruction": 40,
                "fMaxCount": pass1_ext.count(40),
            },
            "pass3": {
                "operation": "symmetric 8-tap directional blur",
                "tapU32Bits": [f"0x{value:08x}" for value in pass3_taps],
                "tapFloats": [struct.unpack("<f", struct.pack("<I", value))[0] for value in pass3_taps],
                "staticImageSampleInstructions": fragment[3]["opCounts"].get("87", 0),
                "loopMergeCount": fragment[3]["opCounts"].get("246", 0),
            },
            "pass5": {
                "operation": "single texture sample and store",
                "imageSampleCount": fragment[5]["opCounts"].get("87", 0),
                "arithmeticOpcodes124To200": pass5_arithmetic,
                "toneMapDetected": bool(pass5_arithmetic),
            },
        },
    }


def extract(apkm_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_split = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        globalgamemanagers = apk.read(GGM_PATH)
        resource_parts = []
        index = 0
        while True:
            name = f"{GGM_RESOURCE_PREFIX}{index}"
            try:
                data = apk.read(name)
            except KeyError:
                break
            resource_parts.append((name, data))
            index += 1
    if not resource_parts:
        raise RuntimeError("globalgamemanagers.assets.split* was not found in base.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_split)) as apk:
        libil2cpp = apk.read(IL2CPP_PATH)
    resource = b"".join(data for _, data in resource_parts)

    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_split),
            "globalgamemanagersPath": GGM_PATH,
            "globalgamemanagersSha256": sha256(globalgamemanagers),
            "globalgamemanagersResourceSha256": sha256(resource),
            "globalgamemanagersResourceSize": len(resource),
            "globalgamemanagersResourceParts": [
                {"path": name, "size": len(data), "sha256": sha256(data)} for name, data in resource_parts
            ],
            "libil2cppPath": IL2CPP_PATH,
            "libil2cppSha256": sha256(libil2cpp),
        },
        "native": decode_native_pipeline(libil2cpp),
        "bloomShader": decode_bloom_shader(resource),
        "claims": {
            "mrt": "Two ARGB32 color attachments plus 24-bit Depth and CopyDepth; no format inference beyond Unity enum values.",
            "passGraph": "Pass order is decoded from CustomRenderer.Setup; optional branch predicates remain explicit.",
            "bloom": "Pass 0/1/3 math and pass 5 no-tone-map are limited to this exact official Bloom module set.",
        },
        "unproven": [
            "Exact serialized post-process list membership and whether Bloom is the only active post-process pass.",
            "Per-card material MRT1 emissive write formulas and keyword variants.",
            "Bloom volume values, GetBufferSize results, sheet mesh intensity/scatter encoding, and final blend state.",
            "Physical Vulkan image formats selected by a particular Android device for Unity ARGB32/Depth enums.",
            "Any tone mapping outside the audited official Bloom shader and BloomPass.Execute range.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
        help="Official Android APKM path (default: PCR_APKM or upstream local package)",
    )
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    json.dump(extract(args.apkm), sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
