#!/usr/bin/env python3
"""Extract byte-pinned CircularKiraObject facts from official PTCGP 1.6.0 inputs."""

import argparse
import hashlib
import io
import json
import os
import re
import warnings
import zipfile
from pathlib import Path

import UnityPy
import UnityPy.config
from elftools.elf.elffile import ELFFile


warnings.simplefilter("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

DEFAULT_APKM = "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm"
DEFAULT_IL2CPP = "D:/DevProjectes/ptcg-apk-parser/apks/output/libil2cpp.so"
DEFAULT_METADATA = "D:/DevProjectes/ptcg-apk-parser/apks/output/global-metadata.dat"
DEFAULT_DUMP_CS = "D:/DevProjectes/ptcg-apk-parser/tools/vendor/Il2CppDumper/out/dump.cs"
DEFAULT_PREFAB = (
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/"
    "Common/CardNew/Face/cPK_20_000010_01_FUSHIGIDANE_S/L/Prefabs/"
    "cPK_20_000010_01_FUSHIGIDANE_S_L.prefab_bundles"
)

EXPECTED_HASHES = {
    "apkm": "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    "split": "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    "libil2cpp": "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
    "metadata": "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
    "dumpCs": "c4cb0e42469f1ad76cabdc01be989f9b761f8bc7ffc9ee5139ba5a1496d9e213",
    "prefabBundle": "1045aacae94f27e6d3f7afd2050a85c166ec22dfd3a67e16aa7b2d7d27132798",
    "componentRaw": "6fa68dc7f30909371db836bba3fcfe91457ba93636905536704675f1433517c1",
}

EXPECTED_COMPONENT_IDENTITY = "CAB-42b1637987e79a0644d26419b2f62d05:-6620796137463397572"
EXPECTED_SCRIPT_IDENTITY = "CAB-1e36700dd93ee778e75c5e8df73b6de5:-2522668416060048609"

# End RVAs are inferred from the next distinct method RVA in the hash-pinned dump.cs.
EXPECTED_METHOD_RANGES = {
    "get_IsAnimationStopped": (0x442D0A4, 0x442D0AC),
    "set_IsAnimationStopped": (0x442D0AC, 0x442D0B4),
    "GetSymmetryCount": (0x442D0B4, 0x442D0E8),
    "Awake": (0x442D0E8, 0x442D100),
    "Initialize": (0x442D100, 0x442D4F8),
    "LateUpdate": (0x442D4F8, 0x442D574),
    "Validate": (0x442D574, 0x442D9F4),
    "UpdateTilt": (0x442D9F4, 0x442DAFC),
    "UpdateCircularParams": (0x442DAFC, 0x442DB34),
    "UpdateParticleParams": (0x442DB34, 0x442DEBC),
    "UpdateTrailParams": (0x442DEBC, 0x442E4EC),
    "ApplyVerticesParams": (0x442E4EC, 0x442E66C),
    "ApplyParams": (0x442E66C, 0x442EA38),
    "ResetBrakeParams": (0x442EA38, 0x442EA94),
    "CalculateBrakeTiming": (0x442EA94, 0x442EBCC),
    "OnDestroy": (0x442EBCC, 0x442EC8C),
    ".ctor": (0x442EC8C, 0x442ECFC),
    ".cctor": (0x442ECFC, 0x442EFC4),
}

EXPECTED_METHOD_SHA256 = {
    "get_IsAnimationStopped": "6a3089bcd1a502252a4af98cf8cc226f9014f6ad0f163adc3b460aaf48bc8579",
    "set_IsAnimationStopped": "ea3186096a658cc608654c4f87c1a782e2a440d83d9360af3c884e78cbf716e8",
    "GetSymmetryCount": "96185b4c2f9295d9624300ae95fa82490e8b7b8c9fc8f38bb8ba817fa9407487",
    "Awake": "87e69f0f1e4411af7af8e1444772afdb0fb440c2827c97a879066d98c54306e1",
    "Initialize": "1c4a038bf1611349c6674f84962145534b78bdf84f7cc84377aabbade4e8462d",
    "LateUpdate": "2ade648aa8b7335454764b245d66a1149b20bcff4d3ddb535fd0f894239fc7cc",
    "Validate": "f2af2b30099251ddf50d09a18eafe40e689cda32c12b737df4702e2b1b48159d",
    "UpdateTilt": "df54752df33c11514df3954ad64b15c581fbc0c1a7f4ee6ffba8b71673d4527e",
    "UpdateCircularParams": "cae62ab73faa37fec7b62978f6cca0021e03689f41fcb608fe42ee7f774c49b3",
    "UpdateParticleParams": "495469b218a32bb70692c22049fed2e468b01b078c88fedc4a3b89dbbaf01fcd",
    "UpdateTrailParams": "c7e09244cc3b6c44e34656b236707188dfde7c5c67a2c2a6a58c92128f7618ef",
    "ApplyVerticesParams": "6881b8a2571597ae5012b3c15f150b2b9d29010047e010483b7a4b6f670b83cc",
    "ApplyParams": "385aa7cf10354b6bca895fe5e9c61c325c5318441fea5d64f18b6a497b8d138e",
    "ResetBrakeParams": "7114a23b21bdc4f2f1fbe1e98c8978e467a816730fcef1c4120c077a7eea7e15",
    "CalculateBrakeTiming": "3d08f49b786eb1b951842ddb38722b7b9e6562016cb46a77a0384bcdb817b54c",
    "OnDestroy": "8371b216c084446843e59712d3c12a7c3fb6855b9a4d9a78ede0cd2a3ee32b3c",
    ".ctor": "fda7b00f2c55ad3ec10f381cfd0d34206337c39a75b236a1d4deb496315aa3ff",
    ".cctor": "5e6ae9757963d297e07f87cc620521eb4bf608f71f00dd561c33da39ad2fa00e",
}
EXPECTED_UPDATE_TRAIL_WINDOWS = {
    "tiesToEvenIndex": (0x442DF04, 0x442DFC8, "da92e4f3cd88bcaffb2337b7be7b8f95deaa4231ecb1b2a621c9f8238e1fe61e"),
    "expandEndpointScanAndFade": (0x442DFF0, 0x442E250, "998ac0c0b824c6b25ae1e65ecd7df5f2a9fbc1b617017a6298c2cb289eb459bb"),
    "lengthEndpointShrink": (0x442E250, 0x442E344, "277828292c9284b24554eb698077a1c87228d75685434b10a2edf4e175b4892d"),
    "lengthCurveCap": (0x442E344, 0x442E43C, "e1205973a1b900ddfb891eb57af9ea11817868df2c5c411937bf3a66a20c4787"),
    "foldAndCommit": (0x442E43C, 0x442E4BC, "ad6933658ff27481e199d7ca8bf1b2d310e25ccfcea802355dcfc0e3221a7113"),
}
EXPECTED_BRAKE_WINDOWS = {
    "brakeStateBranch": (0x442DB68, 0x442DC1C, "f6307134331d1f074d747615b97ea8e9b2fd72ce76f49c76135197b3a3fa7b4c"),
    "brakeOldTimeThenIncrement": (0x442DBC4, 0x442DC04, "715f64cf72303f3197601cc92a07e4b11fcc6e40e1fcfd5a94121092f85d1d4a"),
    "resetBrakeParams": (0x442EA38, 0x442EA94, "7114a23b21bdc4f2f1fbe1e98c8978e467a816730fcef1c4120c077a7eea7e15"),
}
BRAKE_FIELD_OFFSETS = {
    "primitiveSpeed": "0x44",
    "primitiveAngle": "0x48",
    "primitiveBrakeGoalAngle": "0x4c",
    "primitiveBrakeStartAngle": "0x50",
    "primitiveBrakingTime": "0x54",
    "primitiveSpeedAtBrakeStart": "0x58",
    "componentBrakeDuration": "0x48",
    "componentTiltState": "0xd4",
    "componentSpeedState": "0xec",
    "componentDeltaTime": "0x18c",
}
UPDATE_TRAIL_FIELD_OFFSETS = {
    "meshDivideCount": "0x80",
    "centerIntensity": "0x88",
    "fadeOut": "0x8c",
    "fadeOutEnd": "0x90",
    "expandLength": "0x94",
    "expandPower": "0x98",
    "useLengthLimit": "0x9c",
    "limitLengthRatio": "0xa0",
    "limitAdjustCurvePower": "0xa4",
    "limitAdjustSpeed": "0xa8",
    "useDistanceFadeOut": "0xac",
    "distanceFadeOutSpeed": "0xb0",
    "distanceFadeOutCurvePower": "0xb4",
    "kiraLastPosIndex": "0xf8",
    "moveAngle": "0x10c",
    "expandBrightnessCap": "0x110",
    "brightnesses": "0x160",
    "tempBrightnesses": "0x168",
    "deltaTime": "0x18c",
}

RENDERER_FIELDS = {
    "movingA": "_movingKiraARenderer",
    "movingB": "_movingKiraBRenderer",
    "trailA": "_trailKiraARenderer",
    "trailB": "_trailKiraBRenderer",
}
MESH_FILTER_FIELDS = {
    "trailA": "_trailKiraAMeshFilter",
    "trailB": "_trailKiraBMeshFilter",
}
SCALAR_FIELDS = (
    "_defaultCircularAnglePattern",
    "_defaultCircularAngleManual",
    "_tiltPower",
    "_tiltThreshold",
    "_tiltStateChangeDelay",
    "_rotateAccel",
    "_brakeDuration",
    "_primTypeASymmetryCount",
    "_primTypeBSymmetryCount",
    "_primTypeCSymmetryCount",
    "_meshDivideCount",
    "_moveAngleScale",
    "_centerIntensity",
    "_fadeOut",
    "_fadeOutEnd",
    "_expandLength",
    "_expandPower",
    "_useLengthLimit",
    "_limitLengthRatio",
    "_LimitAdjustCurvePower",
    "_LimitAdjustSpeed",
    "_useDistanceFadeOut",
    "_distanceFadeOutSpeed",
    "_distanceFadeOutCurvePower",
    "<IsAnimationStopped>k__BackingField",
)
PRIMITIVE_FIELDS = (
    "PrimType",
    "BaseScale",
    "BaseIntensity",
    "MinIntensity",
    "MaxIntensity",
    "FlickerSpeed",
    "FlickerScaling",
    "StartAngle",
    "UseMorphing",
    "UseMorphingNoise",
    "MorphingSpeed",
    "MorphingClearly",
    "MaxRotateSpeed",
    "ReverseRotation",
)
EXPECTED_TYPETREE_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    "_prims",
    *RENDERER_FIELDS.values(),
    *MESH_FILTER_FIELDS.values(),
    *SCALAR_FIELDS,
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require_hash(label, data, expected_key):
    actual = sha256(data)
    expected = EXPECTED_HASHES[expected_key]
    if actual != expected:
        raise RuntimeError(f"{label}: SHA-256 {actual}, expected {expected}")
    return actual


def read_apkm(path):
    apkm = path.read_bytes()
    require_hash(path, apkm, "apkm")
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        names = outer.namelist()
        split_name = "split_config.arm64_v8a.apk"
        if names.count(split_name) != 1:
            raise RuntimeError(f"{path}: expected exactly one {split_name}, got {names.count(split_name)}")
        split = outer.read(split_name)
    require_hash(split_name, split, "split")
    with zipfile.ZipFile(io.BytesIO(split)) as inner:
        lib_name = "lib/arm64-v8a/libil2cpp.so"
        if inner.namelist().count(lib_name) != 1:
            raise RuntimeError(f"{split_name}: expected exactly one {lib_name}")
        embedded_libil2cpp = inner.read(lib_name)
    require_hash(lib_name, embedded_libil2cpp, "libil2cpp")
    return apkm, split, embedded_libil2cpp


def read_elf_range(elf_bytes, start, end):
    if not 0 <= start < end:
        raise RuntimeError(f"invalid ELF range 0x{start:x}..0x{end:x}")
    elf = ELFFile(io.BytesIO(elf_bytes))
    if elf.elfclass != 64 or not elf.little_endian or elf.header["e_machine"] != "EM_AARCH64":
        raise RuntimeError("libil2cpp.so is not a little-endian ELF64 AArch64 binary")
    matches = []
    for segment in elf.iter_segments():
        if segment["p_type"] != "PT_LOAD":
            continue
        va = int(segment["p_vaddr"])
        file_size = int(segment["p_filesz"])
        if va <= start and end <= va + file_size:
            offset = int(segment["p_offset"]) + start - va
            matches.append(elf_bytes[offset:offset + end - start])
    if len(matches) != 1 or len(matches[0]) != end - start:
        raise RuntimeError(f"ELF range 0x{start:x}..0x{end:x} maps to {len(matches)} PT_LOAD segments")
    return matches[0]


def parse_dump_methods(dump_text):
    class_declaration = "public class CircularKiraObject : MonoBehaviour, ICardAnimationController"
    declarations = [match.start() for match in re.finditer(re.escape(class_declaration), dump_text)]
    if len(declarations) != 1:
        raise RuntimeError(f"dump.cs: expected one CircularKiraObject declaration, got {len(declarations)}")
    block_start = dump_text.rfind("// Namespace:", 0, declarations[0])
    block_end = dump_text.find("\n// Namespace:", declarations[0])
    if block_start < 0 or block_end < 0:
        raise RuntimeError("dump.cs: could not isolate CircularKiraObject class block")
    class_block = dump_text[block_start:block_end]
    method_pattern = re.compile(
        r"// RVA: 0x([0-9A-Fa-f]+)[^\n]*\n"
        r"\s*(?:public|private|protected|internal)\s+[^\n{]*?\s+([^\s(]+)\([^\n]*\)\s*\{\s*\}"
    )
    parsed = [(name, int(rva, 16)) for rva, name in method_pattern.findall(class_block)]
    names = [name for name, _rva in parsed]
    if len(names) != len(set(names)):
        raise RuntimeError(f"dump.cs: overloaded or duplicate CircularKiraObject methods: {names}")
    all_rvas = sorted({int(value, 16) for value in re.findall(r"// RVA: 0x([0-9A-Fa-f]+)", dump_text)})
    methods = {}
    for name, start in parsed:
        later = [rva for rva in all_rvas if rva > start]
        if not later:
            raise RuntimeError(f"dump.cs: no following RVA for CircularKiraObject.{name}")
        methods[name] = (start, later[0])
    if methods != EXPECTED_METHOD_RANGES:
        missing = sorted(set(EXPECTED_METHOD_RANGES) - set(methods))
        extra = sorted(set(methods) - set(EXPECTED_METHOD_RANGES))
        changed = {
            name: {"actual": methods[name], "expected": EXPECTED_METHOD_RANGES[name]}
            for name in sorted(set(methods) & set(EXPECTED_METHOD_RANGES))
            if methods[name] != EXPECTED_METHOD_RANGES[name]
        }
        raise RuntimeError(f"dump.cs: CircularKiraObject method drift; missing={missing}, extra={extra}, changed={changed}")
    return methods


def pptr(owner, pointer, label):
    if not isinstance(pointer, dict) or set(pointer) != {"m_FileID", "m_PathID"}:
        raise RuntimeError(f"{label}: invalid PPtr {pointer!r}")
    file_id = int(pointer["m_FileID"])
    path_id = int(pointer["m_PathID"])
    if path_id == 0:
        raise RuntimeError(f"{label}: null PPtr")
    if file_id == 0:
        source = owner.assets_file.name
    else:
        index = file_id - 1
        externals = owner.assets_file.externals
        if not 0 <= index < len(externals):
            raise RuntimeError(f"{label}: external file ID {file_id} is out of range")
        source = Path(externals[index].path).name
        if not source:
            raise RuntimeError(f"{label}: external file ID {file_id} has no source name")
    return {
        "fileId": file_id,
        "pathId": path_id,
        "identity": f"{source}:{path_id}",
    }


def read_component(path):
    bundle = path.read_bytes()
    require_hash(path, bundle, "prefabBundle")
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if set(RENDERER_FIELDS.values()).issubset(tree) and set(MESH_FILTER_FIELDS.values()).issubset(tree):
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected exactly one CircularKiraObject TypeTree, got {len(matches)}")
    obj, tree = matches[0]
    if set(tree) != EXPECTED_TYPETREE_FIELDS:
        missing = sorted(EXPECTED_TYPETREE_FIELDS - set(tree))
        extra = sorted(set(tree) - EXPECTED_TYPETREE_FIELDS)
        raise RuntimeError(f"{path}: CircularKiraObject TypeTree drift; missing={missing}, extra={extra}")
    identity = f"{obj.assets_file.name}:{int(obj.path_id)}"
    if identity != EXPECTED_COMPONENT_IDENTITY:
        raise RuntimeError(f"{path}: component identity {identity}, expected {EXPECTED_COMPONENT_IDENTITY}")
    raw = bytes(obj.get_raw_data())
    require_hash(identity, raw, "componentRaw")
    script = pptr(obj, tree["m_Script"], "m_Script")
    if script["identity"] != EXPECTED_SCRIPT_IDENTITY:
        raise RuntimeError(f"{path}: script identity {script['identity']}, expected {EXPECTED_SCRIPT_IDENTITY}")
    primitives = tree["_prims"]
    if not isinstance(primitives, list) or len(primitives) != 4:
        raise RuntimeError(f"{path}: expected exactly four CircularKiraObject primitives")
    for index, primitive in enumerate(primitives):
        if not isinstance(primitive, dict) or set(primitive) != set(PRIMITIVE_FIELDS):
            raise RuntimeError(f"{path}: primitive {index} field drift")
        if int(primitive["PrimType"]) not in {0, 1, 2}:
            raise RuntimeError(f"{path}: primitive {index} has invalid PrimType {primitive['PrimType']}")
        for field in ("UseMorphing", "UseMorphingNoise", "ReverseRotation"):
            if int(primitive[field]) not in {0, 1}:
                raise RuntimeError(f"{path}: primitive {index}.{field} is not boolean")
    for field in ("_useLengthLimit", "_useDistanceFadeOut", "<IsAnimationStopped>k__BackingField"):
        if int(tree[field]) not in {0, 1}:
            raise RuntimeError(f"{path}: {field} is not boolean")
    renderers = {role: pptr(obj, tree[field], field) for role, field in RENDERER_FIELDS.items()}
    mesh_filters = {role: pptr(obj, tree[field], field) for role, field in MESH_FILTER_FIELDS.items()}
    if any(value["fileId"] != 0 for value in (*renderers.values(), *mesh_filters.values())):
        raise RuntimeError(f"{path}: renderer or MeshFilter escaped the owning prefab bundle")
    local_objects = {
        (candidate.assets_file.name, int(candidate.path_id)): candidate
        for candidate in environment.objects
    }
    game_objects = {}
    transforms_by_game_object = {}
    mesh_filters_by_game_object = {}
    for candidate in environment.objects:
        if candidate.type.name == "GameObject":
            value = candidate.read_typetree()
            game_objects[int(candidate.path_id)] = value.get("m_Name", "")
        elif candidate.type.name == "Transform":
            value = candidate.read_typetree()
            game_object = pptr(candidate, value.get("m_GameObject"), "Transform.m_GameObject")
            transforms_by_game_object[game_object["pathId"]] = value
        elif candidate.type.name == "MeshFilter":
            value = candidate.read_typetree()
            game_object = pptr(candidate, value.get("m_GameObject"), "MeshFilter.m_GameObject")
            if game_object["pathId"] in mesh_filters_by_game_object:
                raise RuntimeError(f"{path}: GameObject {game_object['identity']} has multiple MeshFilters")
            mesh_filters_by_game_object[game_object["pathId"]] = (candidate, value)

    def game_object_path(pointer):
        names = []
        current = pointer["pathId"]
        seen = set()
        while current:
            if current in seen:
                raise RuntimeError(f"{path}: Transform hierarchy cycle at GameObject {current}")
            seen.add(current)
            if current not in game_objects:
                raise RuntimeError(f"{path}: unresolved GameObject {current}")
            names.append(game_objects[current])
            transform = transforms_by_game_object.get(current)
            if transform is None:
                raise RuntimeError(f"{path}: GameObject {current} has no Transform")
            father = transform.get("m_Father") or {}
            father_path_id = int(father.get("m_PathID", 0))
            if father_path_id == 0:
                current = 0
            else:
                father_object = local_objects.get((obj.assets_file.name, father_path_id))
                if father_object is None or father_object.type.name != "Transform":
                    raise RuntimeError(f"{path}: unresolved parent Transform {father_path_id}")
                father_tree = father_object.read_typetree()
                current = pptr(father_object, father_tree.get("m_GameObject"), "parent Transform.m_GameObject")["pathId"]
        return "/".join(reversed(names))

    renderer_game_objects = {}
    roles = {}
    for role, pointer in renderers.items():
        renderer = local_objects.get((obj.assets_file.name, pointer["pathId"]))
        if renderer is None or renderer.type.name != "MeshRenderer":
            raise RuntimeError(f"{path}: {role} does not resolve to a local MeshRenderer")
        renderer_tree = renderer.read_typetree()
        renderer_game_objects[role] = pptr(renderer, renderer_tree.get("m_GameObject"), f"{role}.m_GameObject")
        materials = renderer_tree.get("m_Materials")
        if not isinstance(materials, list) or len(materials) != 1:
            raise RuntimeError(f"{path}: {role} must have exactly one serialized Material slot")
        mesh_filter_row = mesh_filters_by_game_object.get(renderer_game_objects[role]["pathId"])
        if mesh_filter_row is None:
            raise RuntimeError(f"{path}: {role} GameObject has no MeshFilter")
        mesh_filter_object, mesh_filter_tree = mesh_filter_row
        roles[role] = {
            "renderer": pointer,
            "rendererRawSha256": sha256(bytes(renderer.get_raw_data())),
            "gameObject": renderer_game_objects[role],
            "gameObjectName": game_objects[renderer_game_objects[role]["pathId"]],
            "gameObjectPath": game_object_path(renderer_game_objects[role]),
            "materialSlot": 0,
            "material": pptr(renderer, materials[0], f"{role}.m_Materials[0]"),
            "meshFilter": {
                "fileId": 0,
                "pathId": int(mesh_filter_object.path_id),
                "identity": f"{mesh_filter_object.assets_file.name}:{int(mesh_filter_object.path_id)}",
            },
            "mesh": pptr(mesh_filter_object, mesh_filter_tree.get("m_Mesh"), f"{role}.MeshFilter.m_Mesh"),
        }
    meshes = {}
    mesh_filter_game_objects = {}
    for role, pointer in mesh_filters.items():
        mesh_filter = local_objects.get((obj.assets_file.name, pointer["pathId"]))
        if mesh_filter is None or mesh_filter.type.name != "MeshFilter":
            raise RuntimeError(f"{path}: {role} does not resolve to a local MeshFilter")
        mesh_filter_tree = mesh_filter.read_typetree()
        if set(mesh_filter_tree) != {"m_GameObject", "m_Mesh"}:
            raise RuntimeError(f"{path}: {role} MeshFilter TypeTree drift")
        mesh_filter_game_objects[role] = pptr(
            mesh_filter, mesh_filter_tree["m_GameObject"], f"{role}.MeshFilter.m_GameObject"
        )
        meshes[role] = pptr(mesh_filter, mesh_filter_tree["m_Mesh"], f"{role}.MeshFilter.m_Mesh")
        if mesh_filter_game_objects[role] != renderer_game_objects[role]:
            raise RuntimeError(f"{path}: {role} renderer and MeshFilter target different GameObjects")
    return {
        "bundlePath": path.as_posix(),
        "bundleSha256": sha256(bundle),
        "identity": identity,
        "rawSize": len(raw),
        "rawSha256": sha256(raw),
        "gameObject": pptr(obj, tree["m_GameObject"], "m_GameObject"),
        "script": script,
        "enabled": int(tree["m_Enabled"]),
        "name": tree["m_Name"],
        "renderers": renderers,
        "rendererGameObjects": renderer_game_objects,
        "meshFilters": mesh_filters,
        "meshFilterGameObjects": mesh_filter_game_objects,
        "meshes": meshes,
        "roles": roles,
        "serializedScalars": {field: tree[field] for field in SCALAR_FIELDS},
        "primitives": [{field: primitive[field] for field in PRIMITIVE_FIELDS} for primitive in primitives],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apkm", default=os.environ.get("PCR_APKM", DEFAULT_APKM))
    parser.add_argument("--libil2cpp", default=os.environ.get("PCR_LIBIL2CPP", DEFAULT_IL2CPP))
    parser.add_argument("--metadata", default=os.environ.get("PCR_METADATA", DEFAULT_METADATA))
    parser.add_argument("--dump-cs", default=os.environ.get("PCR_DUMP_CS", DEFAULT_DUMP_CS))
    parser.add_argument("--prefab", default=os.environ.get("PCR_CIRCULAR_KIRA_PREFAB", DEFAULT_PREFAB))
    args = parser.parse_args()

    apkm_path = Path(args.apkm)
    libil2cpp_path = Path(args.libil2cpp)
    metadata_path = Path(args.metadata)
    dump_path = Path(args.dump_cs)
    prefab_path = Path(args.prefab)

    apkm, split, embedded_libil2cpp = read_apkm(apkm_path)
    libil2cpp = libil2cpp_path.read_bytes()
    require_hash(libil2cpp_path, libil2cpp, "libil2cpp")
    if libil2cpp != embedded_libil2cpp:
        raise RuntimeError("external libil2cpp.so differs from the APKM ARM64 split payload")
    metadata = metadata_path.read_bytes()
    require_hash(metadata_path, metadata, "metadata")
    dump_bytes = dump_path.read_bytes()
    require_hash(dump_path, dump_bytes, "dumpCs")
    try:
        dump_text = dump_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{dump_path}: dump.cs is not UTF-8") from error

    parsed_methods = parse_dump_methods(dump_text)
    methods = {}
    for name, (start, end) in sorted(parsed_methods.items(), key=lambda item: item[1][0]):
        body = read_elf_range(libil2cpp, start, end)
        body_hash = sha256(body)
        expected_body_hash = EXPECTED_METHOD_SHA256.get(name)
        if expected_body_hash is not None and body_hash != expected_body_hash:
            raise RuntimeError(f"CircularKiraObject.{name}: body SHA-256 {body_hash}, expected {expected_body_hash}")
        methods[name] = {
            "rvaStart": f"0x{start:x}",
            "rvaEnd": f"0x{end:x}",
            "size": len(body),
            "sha256": body_hash,
        }
    if EXPECTED_METHOD_SHA256 and set(EXPECTED_METHOD_SHA256) != set(methods):
        raise RuntimeError("internal expected method-body hash set does not match parsed CircularKiraObject methods")

    trail_windows = {}
    for label, (start, end, expected_hash) in EXPECTED_UPDATE_TRAIL_WINDOWS.items():
        raw = read_elf_range(libil2cpp, start, end)
        actual_hash = sha256(raw)
        if actual_hash != expected_hash:
            raise RuntimeError(f"UpdateTrailParams.{label}: SHA-256 {actual_hash}, expected {expected_hash}")
        trail_windows[label] = {
            "rvaStart": f"0x{start:x}",
            "rvaEnd": f"0x{end:x}",
            "size": len(raw),
            "sha256": actual_hash,
        }

    brake_windows = {}
    for name, (start, end, expected_hash) in EXPECTED_BRAKE_WINDOWS.items():
        data = read_elf_range(libil2cpp, start, end)
        actual_hash = sha256(data)
        if actual_hash != expected_hash:
            raise RuntimeError(f"{name}: SHA-256 {actual_hash}, expected {expected_hash}")
        brake_windows[name] = {
            "rvaStart": hex(start),
            "rvaEnd": hex(end),
            "size": len(data),
            "sha256": actual_hash,
        }

    semantic_witnesses = {
        "UpdateTrailParams": {
            "methodSha256": methods["UpdateTrailParams"]["sha256"],
            "fieldOffsets": UPDATE_TRAIL_FIELD_OFFSETS,
            "windows": trail_windows,
            "controlFlow": [
                "float32 ties-to-even index from (moveAngle + 360) * meshDivideCount / 360",
                "expand then detect at most two non-zero interval endpoints before fade",
                "fade stores the first negative crossing and clears it on the following frame",
                "when over limit, repeatedly shrink the dimmer endpoint and attenuate the removed slot",
                "apply center-relative power cap across the retained interval, then max-fold 2N to N",
            ],
            "scope": "hash-pinned ARM64 managed control flow; native powf and frame inputs remain runtime boundaries",
        },
        "UpdateParticleParamsBrake": {
            "methodSha256": methods["UpdateParticleParams"]["sha256"],
            "fieldOffsets": BRAKE_FIELD_OFFSETS,
            "windows": {
                "brakeStateBranch": brake_windows["brakeStateBranch"],
                "brakeOldTimeThenIncrement": brake_windows["brakeOldTimeThenIncrement"],
            },
            "controlFlow": [
                "when angle reaches goal, zero speed and snap angle to goal",
                "inside the braking interval, calculate speed from the old brakingTime",
                "increment brakingTime only after the speed calculation",
            ],
            "scope": "hash-pinned ARM64 managed control flow; native acosf/sinf ULP remains a runtime boundary",
        },
        "ResetBrakeParams": {
            "methodSha256": methods["ResetBrakeParams"]["sha256"],
            "fieldOffsets": BRAKE_FIELD_OFFSETS,
            "windows": {"resetBrakeParams": brake_windows["resetBrakeParams"]},
            "controlFlow": [
                "clear brakeGoalAngle, brakeStartAngle, brakingTime and speedAtBrakeStart as two contiguous 64-bit stores",
            ],
            "scope": "hash-pinned ARM64 managed control flow",
        },
    }

    print(json.dumps({
        "schema": "pocket-card-render/official-circular-kira-evidence@2",
        "source": {
            "apkmPath": apkm_path.as_posix(),
            "apkmSha256": sha256(apkm),
            "splitName": "split_config.arm64_v8a.apk",
            "splitSha256": sha256(split),
            "libil2cppPath": libil2cpp_path.as_posix(),
            "libil2cppSha256": sha256(libil2cpp),
            "metadataPath": metadata_path.as_posix(),
            "metadataSha256": sha256(metadata),
            "dumpCsPath": dump_path.as_posix(),
            "dumpCsSha256": sha256(dump_bytes),
        },
        "methodBoundarySource": "hash-pinned dump.cs; end RVA is the next distinct dump.cs method RVA",
        "methods": methods,
        "semanticWitnesses": semantic_witnesses,
        "component": read_component(prefab_path),
    }, separators=(",", ":"), sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
