#!/usr/bin/env python3
"""Extract candidate UGUI producer evidence from manifest-matched IL2CPP bytes.

Il2CppDumper output is an address locator only. Every semantic claim below is
checked against the ARM64 libil2cpp.so embedded in the candidate split APK.
Live CardData, enumerable contents, and Unity object state remain runtime
boundaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

from capstone import CS_ARCH_ARM64, CS_MODE_ARM, Cs


EXPECTED_SAMPLE_ID = "ptcgp-1.7.0-unity-6000.0.69f1-candidate"
EXPECTED_UNITY_VERSION = "6000.0.69f1"
IL2CPP_ENTRY = "lib/arm64-v8a/libil2cpp.so"
TEST_MUTATION = os.environ.get("PCR_TEST_CANDIDATE_UGUI_NATIVE_MUTATION")

METHOD_NAMES = {
    "fontGroupSelection":
        "Lettuce.Infrastructure.Card.Core.FontGroupConditions$$GetFontGroup",
    "dynamicUIControllerApply":
        "Lettuce.Infrastructure.Card.Core.CardDynamicUIView$$Apply",
    "dynamicUILabelDispatch":
        "Lettuce.Infrastructure.Card.Core.CardDynamicUIViewExtensions$$Apply",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def identity(data: bytes) -> dict:
    return {"byteLength": len(data), "sha256": sha256(data)}


def canonical_digest(value: object) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256(serialized)


def read_manifest(selection_path: Path) -> tuple[dict, str]:
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    if isinstance(selection.get("manifest"), str):
        manifest_path = (selection_path.parent / selection["manifest"]).resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = selection
    if manifest.get("sampleId") != EXPECTED_SAMPLE_ID:
        raise RuntimeError(f"unexpected candidate sample: {manifest.get('sampleId')}")
    if manifest.get("status") != "candidate":
        raise RuntimeError("candidate UGUI extraction requires status=candidate")
    if manifest.get("unity", {}).get("serializedVersion") != EXPECTED_UNITY_VERSION:
        raise RuntimeError(
            "candidate UGUI extractor is pinned to Unity "
            f"{EXPECTED_UNITY_VERSION}"
        )
    return manifest, canonical_digest(manifest)


def verify_identity(label: str, data: bytes, expected: dict) -> None:
    actual = identity(data)
    if expected.get("status") == "unresolved":
        raise RuntimeError(f"{label} is unresolved in candidate manifest")
    if (
        actual["byteLength"] != expected.get("byteLength")
        or actual["sha256"] != expected.get("sha256")
    ):
        raise RuntimeError(
            f"{label} identity mismatch: expected "
            f"{expected.get('byteLength')}/{expected.get('sha256')}, got "
            f"{actual['byteLength']}/{actual['sha256']}"
        )


def instruction_text(instruction) -> str:
    return instruction.mnemonic + (
        f" {instruction.op_str}" if instruction.op_str else ""
    )


class Elf64:
    def __init__(self, data: bytes):
        if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
            raise RuntimeError("candidate libil2cpp is not little-endian ELF64")
        self.data = data
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
        self.loads: list[tuple[int, int, int, int]] = []
        for index in range(phnum):
            offset = phoff + index * phentsize
            values = struct.unpack_from("<IIQQQQQQ", data, offset)
            if values[0] == 1:
                self.loads.append((values[2], values[3], values[5], values[6]))
        if not self.loads:
            raise RuntimeError("candidate libil2cpp has no PT_LOAD segments")

    def read(self, virtual_address: int, size: int) -> bytes:
        for offset, base, file_size, _memory_size in self.loads:
            relative = virtual_address - base
            if relative >= 0 and relative + size <= file_size:
                start = offset + relative
                return self.data[start : start + size]
        raise RuntimeError(
            f"candidate virtual range {virtual_address:#x}+{size:#x} "
            "is not file-backed"
        )


class ScriptIndex:
    def __init__(self, path: Path):
        raw = path.read_bytes()
        parsed = json.loads(raw)
        rows = parsed.get("ScriptMethod")
        if not isinstance(rows, list):
            raise RuntimeError("Il2CppDumper script.json has no ScriptMethod array")
        self.identity = identity(raw)
        self.rows = [row for row in rows if int(row.get("Address", 0)) > 0]
        self.addresses = sorted({int(row["Address"]) for row in self.rows})
        self.by_address: dict[int, list[dict]] = {}
        for row in self.rows:
            self.by_address.setdefault(int(row["Address"]), []).append(row)

    def unique(self, name: str) -> dict:
        rows = [row for row in self.rows if row.get("Name") == name]
        if len(rows) != 1:
            raise RuntimeError(f"Il2CppDumper locator {name!r} occurs {len(rows)} times")
        return rows[0]

    def next_address(self, address: int) -> int:
        try:
            return next(item for item in self.addresses if item > address)
        except StopIteration as error:
            raise RuntimeError(f"no method boundary follows {address:#x}") from error

    def names_at(self, address: int) -> list[str]:
        return sorted(row["Name"] for row in self.by_address.get(address, []))


def method_evidence(
    elf: Elf64,
    index: ScriptIndex,
    name: str,
) -> tuple[dict, dict]:
    locator = index.unique(name)
    start = int(locator["Address"])
    end = index.next_address(start)
    body = elf.read(start, end - start)
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    instructions = {
        item.address: item for item in decoder.disasm(body, start)
    }
    if not instructions:
        raise RuntimeError(f"{name} decoded no ARM64 instructions")
    calls = []
    for item in instructions.values():
        if item.mnemonic not in {"b", "bl"}:
            continue
        match = re.fullmatch(r"#0x([0-9a-f]+)", item.op_str)
        if not match:
            continue
        target = int(match.group(1), 16)
        names = index.names_at(target)
        if names:
            calls.append(
                {
                    "address": f"0x{item.address:x}",
                    "relativeOffset": f"0x{item.address - start:x}",
                    "kind": item.mnemonic,
                    "target": f"0x{target:x}",
                    "targetNames": names,
                }
            )
    return (
        {
            "name": name,
            "signature": locator.get("Signature"),
            "rvaStart": f"0x{start:x}",
            "rvaEndExclusive": f"0x{end:x}",
            **identity(body),
            "directResolvedCalls": calls,
        },
        instructions,
    )


def require_instruction(
    methods: dict[str, dict],
    instructions: dict[str, dict],
    method_key: str,
    relative: int,
    expected: str,
) -> dict:
    start = int(methods[method_key]["rvaStart"], 16)
    address = start + relative
    item = instructions[method_key].get(address)
    actual = instruction_text(item) if item is not None else None
    if actual != expected:
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x}: "
            f"expected {expected!r}, got {actual!r}"
        )
    return {
        "address": f"0x{address:x}",
        "relativeOffset": f"0x{relative:x}",
        "text": actual,
        "bytesHex": item.bytes.hex(),
        "sha256": sha256(item.bytes),
    }


def direct_target(instruction) -> int:
    match = re.fullmatch(r"#0x([0-9a-f]+)", instruction.op_str)
    if instruction.mnemonic not in {"b", "bl"} or not match:
        raise RuntimeError(
            f"instruction has no direct branch target: "
            f"{instruction_text(instruction)}"
        )
    return int(match.group(1), 16)


def require_call(
    methods: dict[str, dict],
    instructions: dict[str, dict],
    index: ScriptIndex,
    method_key: str,
    relative: int,
    target_name: str,
) -> dict:
    start = int(methods[method_key]["rvaStart"], 16)
    address = start + relative
    item = instructions[method_key].get(address)
    if item is None or item.mnemonic != "bl":
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x} is not bl"
        )
    target = direct_target(item)
    names = index.names_at(target)
    if target_name not in names:
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x}: "
            f"expected call to {target_name!r}, got {names!r}"
        )
    return {
        "address": f"0x{address:x}",
        "relativeOffset": f"0x{relative:x}",
        "text": instruction_text(item),
        "target": f"0x{target:x}",
        "targetName": target_name,
        "bytesHex": item.bytes.hex(),
        "sha256": sha256(item.bytes),
    }


def extract_native(elf: Elf64, script: ScriptIndex) -> dict:
    methods: dict[str, dict] = {}
    instructions: dict[str, dict] = {}
    for key, name in METHOD_NAMES.items():
        methods[key], instructions[key] = method_evidence(elf, script, name)

    font_card_energy_offset = 0xB8
    dynamic_set_active_offset = 0x8C
    label_dispatch_offset = 0x228
    if TEST_MUTATION == "font-card-energy":
        font_card_energy_offset += 4
    if TEST_MUTATION == "dynamic-set-active":
        dynamic_set_active_offset += 4
    if TEST_MUTATION == "label-dispatch":
        label_dispatch_offset += 4

    font_checks = [
        require_instruction(
            methods, instructions, "fontGroupSelection", 0x70,
            "ldr x9, [x19, #0x18]",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0x7C,
            "ldr x0, [x19, #0x20]",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0x84,
            "b.lt #0x48125b8",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xA4,
            "ldr w14, [x13, #0x10]",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xA8,
            "cbz w14, #0x48125a4",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xB0,
            "tbz w14, #0, #0x48125b4",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xB4,
            "ldr w14, [x13, #0x14]",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection",
            font_card_energy_offset,
            "ldr w15, [x8, #0x68]",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xBC,
            "cmp w14, w15",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xC4,
            "add w11, w11, #1",
        ),
        require_instruction(
            methods, instructions, "fontGroupSelection", 0xD4,
            "ldr x0, [x13, #0x18]",
        ),
    ]
    dynamic_checks = [
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x18,
            "UnityEngine.Component$$get_transform",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x28,
            "UnityEngine.Transform$$get_childCount",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x4C,
            "UnityEngine.Transform$$GetChild",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x5C,
            "UnityEngine.Component$$get_gameObject",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x6C,
            "UnityEngine.Object$$get_name",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply", 0x78,
            "System.String$$op_Equality",
        ),
        require_instruction(
            methods, instructions, "dynamicUIControllerApply", 0x80,
            "and w1, w0, #1",
        ),
        require_call(
            methods, instructions, script, "dynamicUIControllerApply",
            dynamic_set_active_offset,
            "UnityEngine.GameObject$$SetActive",
        ),
    ]
    dispatch_checks = [
        require_instruction(
            methods, instructions, "dynamicUILabelDispatch", 0x1D0,
            "ldr x0, [x21, #0x20]",
        ),
        require_call(
            methods, instructions, script, "dynamicUILabelDispatch", 0x1DC,
            "System.String$$op_Equality",
        ),
        require_call(
            methods, instructions, script, "dynamicUILabelDispatch", 0x200,
            "UnityEngine.Object$$op_Inequality",
        ),
        require_call(
            methods, instructions, script, "dynamicUILabelDispatch", 0x214,
            "UnityEngine.Object$$get_name",
        ),
        require_call(
            methods, instructions, script, "dynamicUILabelDispatch",
            label_dispatch_offset,
            METHOD_NAMES["dynamicUIControllerApply"],
        ),
    ]

    return {
        "locator": {
            "kind": "Il2CppDumper-script-method-address-only",
            **script.identity,
        },
        "methods": methods,
        "contracts": {
            "fontGroupSelection": {
                "status": "exact-candidate-il2cpp-control-flow",
                "methodKey": "fontGroupSelection",
                "verifiedFieldOffsets": {
                    "FontGroupConditions._conditions": "0x18",
                    "FontGroupConditions._default": "0x20",
                    "FontGroupCondition._conditionType": "0x10",
                    "FontGroupCondition._energyType": "0x14",
                    "FontGroupCondition._font": "0x18",
                    "CardData.energySelectorField": "0x68",
                },
                "controlFlow": [
                    "load serialized conditions and default",
                    "iterate the conditions array in serialized order",
                    "skip conditionType zero entries",
                    "test conditionType bit zero before reading energy type",
                    "select the first branch which reaches the condition font load",
                    "retain the default when no condition selects a font",
                ],
                "selectedInstructionChecks": font_checks,
                "liveInputs": [
                    "candidate CardData object and its energy field",
                    "runtime ScriptableObject instances and condition array contents",
                ],
            },
            "dynamicUIControllerApply": {
                "status": "exact-candidate-il2cpp-control-flow",
                "methodKey": "dynamicUIControllerApply",
                "controlFlow": [
                    "iterate every direct Transform child in index order",
                    "read each child GameObject name",
                    "set active exactly when String.op_Equality(childName, requestedName) is true",
                ],
                "selectedInstructionChecks": dynamic_checks,
                "liveInputs": [
                    "runtime Transform child order",
                    "runtime GameObject names and active state",
                ],
            },
            "dynamicUILabelDispatch": {
                "status": "exact-candidate-il2cpp-control-flow",
                "methodKey": "dynamicUILabelDispatch",
                "verifiedFieldOffsets": {
                    "CardDynamicUIView._label": "0x20",
                },
                "controlFlow": [
                    "iterate the supplied CardDynamicUIView enumerable",
                    "compare each serialized label with the requested key",
                    "derive the requested child name from a non-null GameObject",
                    "invoke CardDynamicUIView.Apply for matching labels",
                ],
                "selectedInstructionChecks": dispatch_checks,
                "liveInputs": [
                    "runtime IEnumerable contents and iteration order",
                    "runtime key and GameObject identity/name",
                ],
            },
        },
        "runtimeBoundaries": [
            {
                "id": "card-design-native-runtime-state",
                "status": "runtime-required",
                "reason":
                    "candidate producer bodies are exact, but live CardData, "
                    "enumerable membership/order, Unity object names, and "
                    "SetActive outcomes require runtime evidence",
            },
        ],
    }


def extract(args) -> dict:
    manifest, manifest_digest = read_manifest(args.candidate_manifest)
    split_name = manifest["game"]["packageSource"]["splits"]["arm64Split"]
    arm64_path = args.split_root / split_name
    if not arm64_path.is_file():
        raise RuntimeError(f"candidate arm64 split is missing: {arm64_path}")
    arm64_bytes = arm64_path.read_bytes()
    verify_identity("arm64 split", arm64_bytes, manifest["artifacts"]["arm64Split"])
    with zipfile.ZipFile(arm64_path) as archive:
        libil2cpp = archive.read(IL2CPP_ENTRY)
    verify_identity("libil2cpp", libil2cpp, manifest["artifacts"]["libil2cpp"])

    locator_libil2cpp = args.locator_libil2cpp.read_bytes()
    if locator_libil2cpp != libil2cpp:
        raise RuntimeError(
            "Il2CppDumper locator libil2cpp does not match candidate split bytes"
        )
    script = ScriptIndex(args.script_json)
    native = extract_native(Elf64(libil2cpp), script)
    return {
        "schema": "pocket-card-render/candidate-ugui-native-producers@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": manifest["sampleId"],
            "sampleManifestSha256": manifest_digest,
            "gameVersion": manifest["game"]["versionName"],
            "unityVersion": EXPECTED_UNITY_VERSION,
        },
        "policy": {
            "locatorOnly": True,
            "semanticClaimsRecheckedAgainstCandidateLibil2cpp": True,
            "runtimeStateInferred": False,
        },
        "sources": {
            "arm64Split": identity(arm64_bytes),
            "libil2cpp": {
                "entry": IL2CPP_ENTRY,
                **identity(libil2cpp),
            },
            "locatorScript": native["locator"],
        },
        "methods": native["methods"],
        "contracts": native["contracts"],
        "runtimeBoundaries": native["runtimeBoundaries"],
        "summary": {
            "requiredMethodCount": len(METHOD_NAMES),
            "exactCandidateMethodCount": len(native["methods"]),
            "controlFlowContractCount": len(native["contracts"]),
            "exactControlFlowContractCount": sum(
                1
                for contract in native["contracts"].values()
                if contract["status"] == "exact-candidate-il2cpp-control-flow"
            ),
            "runtimeBoundaryCount": len(native["runtimeBoundaries"]),
        },
    }


def parse_args(argv: list[str]):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True, type=Path)
    parser.add_argument("--split-root", required=True, type=Path)
    parser.add_argument("--locator-libil2cpp", required=True, type=Path)
    parser.add_argument("--script-json", required=True, type=Path)
    args = parser.parse_args(argv)
    for name in ("candidate_manifest", "locator_libil2cpp", "script_json"):
        path = getattr(args, name)
        if not path.is_file():
            parser.error(f"{name.replace('_', '-')} not found: {path}")
    if not args.split_root.is_dir():
        parser.error(f"split root not found: {args.split_root}")
    return args


def main(argv: list[str]) -> int:
    result = extract(parse_args(argv))
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as error:
        raise SystemExit(
            f"candidate UGUI native extraction failed: {error}"
        ) from error
