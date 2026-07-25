#!/usr/bin/env python3
"""Extract the official UI Default To RT producer chain from decrypted 1.6.0 bundles.

The official prefab is authoritative for the UI Image -> Material PPtr. The
Material and Shader bundles are authoritative for the Material -> Shader PPtr,
serialized pass state, compiled variants, and Vulkan program bytes. No scene,
recipe, generated shader, browser runtime, or screenshot is read.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import warnings

import lz4.block
import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
UNITY_VERSION = "2022.3.62f2"

PREFAB_RELATIVE_PATH = Path(
    "Common/CardNew/Common/UI/Prefabs/CardEnergyIconView.prefab_bundles"
)
MATERIAL_RELATIVE_PATH = Path(
    "Common/CardNew/Common/UI/Materials/UI-Default-ToRT.mat_bundles"
)
SHADER_RELATIVE_PATH = Path(
    "Common/Shader/Common/CardNew/UI/Card_UI_Default_ToRT.shader_bundles"
)
MATERIAL_NAME = "UI-Default-ToRT"
SHADER_NAME = "Lettuce/Common/CardNew/UI/Default(to RT)"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25


def load_module(name: str, source: Path):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction helper: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SHADER_HELPER = load_module(
    "pcr_ui_default_to_rt_shader", ROOT / "build" / "extract_official_side_back.py"
)
SHADER_HELPER.UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data)}


def raw_record(data: bytes) -> dict:
    return {**hash_record(data), "rawHex": data.hex()}


def pptr(pointer: dict) -> dict:
    return {
        "fileId": int(pointer.get("m_FileID", 0)),
        "pathId": str(pointer.get("m_PathID", 0)),
    }


def external_record(serialized, file_id: int) -> dict:
    if file_id < 1 or file_id > len(serialized.externals):
        raise RuntimeError(f"invalid external FileID {file_id} in {serialized.name}")
    external = serialized.externals[file_id - 1]
    return {
        "path": str(external.path),
        "name": str(external.name),
        "guid": bytes(external.guid).hex(),
    }


def saved_properties(tree: dict) -> dict:
    saved = tree.get("m_SavedProperties", {})
    textures = {}
    for name, item in saved.get("m_TexEnvs", []):
        textures[str(name)] = {
            **pptr(item.get("m_Texture", {})),
            "scale": [float(item["m_Scale"]["x"]), float(item["m_Scale"]["y"])],
            "offset": [float(item["m_Offset"]["x"]), float(item["m_Offset"]["y"])],
        }
    return {
        "textures": textures,
        "ints": {str(name): int(value) for name, value in saved.get("m_Ints", [])},
        "floats": {str(name): float(value) for name, value in saved.get("m_Floats", [])},
        "colors": {
            str(name): [float(value[channel]) for channel in ("r", "g", "b", "a")]
            for name, value in saved.get("m_Colors", [])
        },
    }


def material_evidence(decrypted_root: Path) -> dict:
    bundle_path = decrypted_root / MATERIAL_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    materials = [item for item in environment.objects if item.type.name == "Material"]
    if len(materials) != 1:
        raise RuntimeError(f"expected one Material in {MATERIAL_RELATIVE_PATH}")
    material = materials[0]
    raw = bytes(material.get_raw_data())
    tree = material.read_typetree()
    shader_pointer = pptr(tree.get("m_Shader", {}))
    serialized = material.assets_file
    return {
        "relativePath": MATERIAL_RELATIVE_PATH.as_posix(),
        "bundle": raw_record(bundle_bytes),
        "serializedFile": str(serialized.name),
        "materialObject": {"pathId": str(material.path_id), **raw_record(raw)},
        "name": str(tree.get("m_Name")),
        "shaderPPtr": shader_pointer,
        "shaderExternal": external_record(serialized, shader_pointer["fileId"]),
        "validKeywords": list(tree.get("m_ValidKeywords", [])),
        "invalidKeywords": list(tree.get("m_InvalidKeywords", [])),
        "enableInstancingVariants": bool(tree.get("m_EnableInstancingVariants", False)),
        "customRenderQueue": int(tree.get("m_CustomRenderQueue", -1)),
        "disabledShaderPasses": list(tree.get("disabledShaderPasses", [])),
        "savedProperties": saved_properties(tree),
    }


def prefab_image_evidence(decrypted_root: Path, material: dict) -> dict:
    bundle_path = decrypted_root / PREFAB_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    objects = list(environment.objects)
    game_objects = {
        str(item.path_id): str(item.read_typetree().get("m_Name", ""))
        for item in objects if item.type.name == "GameObject"
    }
    image_fields = (
        "m_GameObject", "m_Script", "m_Material", "m_Color", "m_RaycastTarget",
        "m_Maskable", "m_Sprite", "m_Type", "m_PreserveAspect", "m_FillCenter",
        "m_FillMethod", "m_FillAmount", "m_FillClockwise", "m_FillOrigin",
        "m_UseSpriteMesh", "m_PixelsPerUnitMultiplier",
    )
    images = []
    for item in objects:
        if item.type.name != "MonoBehaviour":
            continue
        tree = item.read_typetree()
        material_pointer = pptr(tree.get("m_Material", {}))
        if material_pointer["pathId"] != material["materialObject"]["pathId"]:
            continue
        missing = [name for name in image_fields if name not in tree]
        if missing:
            raise RuntimeError(f"UI Image signature missing fields {missing}")
        serialized = item.assets_file
        material_external = external_record(serialized, material_pointer["fileId"])
        if material_external["name"] != material["serializedFile"]:
            raise RuntimeError("UI Image Material external CAB does not match Material bundle")
        game_object_pointer = pptr(tree["m_GameObject"])
        raw = bytes(item.get_raw_data())
        images.append({
            "object": {"pathId": str(item.path_id), **raw_record(raw)},
            "serializedFile": str(serialized.name),
            "gameObjectPPtr": game_object_pointer,
            "gameObjectName": game_objects.get(game_object_pointer["pathId"]),
            "scriptPPtr": pptr(tree["m_Script"]),
            "scriptExternal": external_record(serialized, int(tree["m_Script"]["m_FileID"])),
            "materialPPtr": material_pointer,
            "materialExternal": material_external,
            "imageSerializationSignature": list(image_fields),
            "spritePPtr": pptr(tree["m_Sprite"]),
            "enabled": bool(tree.get("m_Enabled", 0)),
            "raycastTarget": bool(tree["m_RaycastTarget"]),
            "maskable": bool(tree["m_Maskable"]),
            "imageType": int(tree["m_Type"]),
        })
    images.sort(key=lambda item: int(item["object"]["pathId"]))
    if [item["gameObjectName"] for item in images] != ["Outline", "icn_gra_img"]:
        raise RuntimeError("CardEnergyIconView ToRT Image set changed")
    return {
        "relativePath": PREFAB_RELATIVE_PATH.as_posix(),
        "bundle": raw_record(bundle_bytes),
        "serializedFile": images[0]["serializedFile"],
        "classification": (
            "MonoBehaviour objects with the complete UnityEngine.UI.Image serialized field "
            "signature and a non-null external m_Material PPtr"
        ),
        "images": images,
    }


def compiled_variants(shader_pass: dict, keyword_names: list[str], subshader_index: int,
                      pass_index: int) -> list[dict]:
    rows = []
    for stage_name in ("progVertex", "progFragment"):
        stage = shader_pass.get(stage_name, {})
        player_groups = stage.get("m_PlayerSubPrograms", [])
        parameter_groups = stage.get("m_ParameterBlobIndices", [])
        for group_index, players in enumerate(player_groups):
            parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
            for variant_index, player in enumerate(players or []):
                if variant_index >= len(parameters):
                    raise RuntimeError("compiled variant has no parameter entry")
                indices = [int(value) for value in player.get("m_KeywordIndices", [])]
                rows.append({
                    "subshaderIndex": subshader_index,
                    "passIndex": pass_index,
                    "stageMetadata": stage_name,
                    "groupIndex": group_index,
                    "variantIndex": variant_index,
                    "keywordIndices": indices,
                    "keywords": [keyword_names[index] for index in indices],
                    "parameterBlobIndex": int(parameters[variant_index]),
                    "programBlobIndex": int(player.get("m_BlobIndex")),
                    "gpuProgramType": int(player.get("m_GpuProgramType")),
                    "shaderRequirements": int(player.get("m_ShaderRequirements")),
                })
    return rows


def shader_evidence(decrypted_root: Path, material: dict) -> dict:
    bundle_path = decrypted_root / SHADER_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    shaders = [item for item in environment.objects if item.type.name == "Shader"]
    if len(shaders) != 1:
        raise RuntimeError(f"expected one Shader in {SHADER_RELATIVE_PATH}")
    shader_object = shaders[0]
    raw = bytes(shader_object.get_raw_data())
    shader = shader_object.read_typetree()
    parsed = shader.get("m_ParsedForm", {})
    if parsed.get("m_Name") != SHADER_NAME:
        raise RuntimeError(f"unexpected shader name {parsed.get('m_Name')!r}")
    if shader.get("platforms") != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected shader platforms {shader.get('platforms')}")
    if str(shader_object.assets_file.name) != material["shaderExternal"]["name"]:
        raise RuntimeError("Material external CAB does not match Shader serialized file")
    if str(shader_object.path_id) != material["shaderPPtr"]["pathId"]:
        raise RuntimeError("Material Shader PathID does not match Shader object")

    subshaders = parsed.get("m_SubShaders", [])
    if len(subshaders) != 2 or any(len(item.get("m_Passes", [])) != 1 for item in subshaders):
        raise RuntimeError("UI Default To RT must contain two one-pass subshaders")
    keyword_names = list(parsed.get("m_KeywordNames", []))
    pass_rows = []
    all_variants = []
    for subshader_index, subshader in enumerate(subshaders):
        shader_pass = subshader["m_Passes"][0]
        variants = compiled_variants(shader_pass, keyword_names, subshader_index, 0)
        all_variants.extend(variants)
        pass_rows.append({
            "subshaderIndex": subshader_index,
            "lod": int(subshader.get("m_LOD", 0)),
            "subshaderTags": dict(subshader.get("m_Tags", {}).get("tags", [])),
            "passIndex": 0,
            "name": str(shader_pass.get("m_State", {}).get("m_Name", "")),
            "type": int(shader_pass.get("m_Type", -1)),
            "programMask": int(shader_pass.get("m_ProgramMask", 0)),
            "passTags": dict(shader_pass.get("m_Tags", {}).get("tags", [])),
            "renderState": SHADER_HELPER.render_state(shader_pass),
            "compiledVariants": variants,
        })

    selected_rows = [
        item for item in all_variants
        if item["subshaderIndex"] == 0 and item["passIndex"] == 0
        and item["stageMetadata"] == "progVertex"
        and item["groupIndex"] == 3 and item["variantIndex"] == 0
    ]
    if len(selected_rows) != 1:
        raise RuntimeError("Default pass Vulkan empty-keyword variant is not unique")
    selected = selected_rows[0]
    expected_selection = {
        "keywordIndices": [], "keywords": [], "parameterBlobIndex": 0,
        "programBlobIndex": 4, "gpuProgramType": SPIRV_PROGRAM_TYPE,
        "shaderRequirements": 1,
    }
    for key, expected in expected_selection.items():
        if selected[key] != expected:
            raise RuntimeError(
                f"selected Vulkan variant {key} expected {expected!r}, got {selected[key]!r}"
            )

    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = shader["offsets"][0]
    compressed_lengths = shader["compressedLengths"][0]
    decompressed_lengths = shader["decompressedLengths"][0]
    if len(compressed_lengths) != 1 or len(decompressed_lengths) != 1:
        raise RuntimeError("expected one Vulkan compressed program block")
    offset = int(offsets[0] if isinstance(offsets, list) else offsets)
    compressed = compressed_blob[offset:offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(
        compressed, uncompressed_size=int(decompressed_lengths[0])
    )
    entries = SHADER_HELPER.parse_table(decompressed)
    parameter_entry = entries[selected["parameterBlobIndex"]]
    texture_names = {
        item["name"] for item in SHADER_HELPER.properties(parsed) if item["type"] == 4
    }
    parameters = SHADER_HELPER.parse_parameter_entry(
        bytes.fromhex(parameter_entry["rawHex"]), texture_names
    )
    selected_pass = subshaders[0]["m_Passes"][0]
    common_textures = SHADER_HELPER.common_textures(selected_pass)
    program_entry = entries[selected["programBlobIndex"]]
    modules = SHADER_HELPER.decode_modules(bytes.fromhex(program_entry["rawHex"]))
    return {
        "source": {
            "relativePath": SHADER_RELATIVE_PATH.as_posix(),
            "bundle": raw_record(bundle_bytes),
            "serializedFile": str(shader_object.assets_file.name),
            "shaderObject": {"pathId": str(shader_object.path_id), **raw_record(raw)},
        },
        "shader": {
            "name": parsed["m_Name"],
            "properties": SHADER_HELPER.properties(parsed),
            "keywordNames": keyword_names,
            "keywordFlags": [int(value) for value in parsed.get("m_KeywordFlags", [])],
            "subshaderCount": len(subshaders),
            "passes": pass_rows,
        },
        "selectedProgramTarget": {
            "status": "static-candidate-not-runtime-selection",
            "reason": (
                "first serialized subshader, Default pass, empty Material keyword set, "
                "Vulkan player group"
            ),
            **selected,
        },
        "programBlock": {
            "platform": VULKAN_PLATFORM,
            "compressed": raw_record(compressed),
            "decompressed": raw_record(decompressed),
            "entries": entries,
        },
        "bindings": {
            "commonTextures": common_textures,
            "parameterEntry": parameters,
        },
        "modules": modules,
    }


def extract(decrypted_root: Path) -> dict:
    material = material_evidence(decrypted_root)
    if material["name"] != MATERIAL_NAME:
        raise RuntimeError(f"unexpected Material name {material['name']!r}")
    if material["validKeywords"] or material["invalidKeywords"]:
        raise RuntimeError("serialized UI-Default-ToRT Material keywords changed")
    expected_main = {
        "fileId": 0, "pathId": "0", "scale": [1.0, 1.0], "offset": [0.0, 0.0]
    }
    if material["savedProperties"]["textures"].get("_MainTex") != expected_main:
        raise RuntimeError("serialized UI-Default-ToRT _MainTex slot changed")
    prefab = prefab_image_evidence(decrypted_root, material)
    shader = shader_evidence(decrypted_root, material)
    return {
        "schemaVersion": 1,
        "status": "proved-static-program-with-runtime-boundaries",
        "evidencePolicy": {
            "officialOnly": True,
            "readInputs": [
                "1.6.0 decrypted official CardEnergyIconView prefab bundle",
                "1.6.0 decrypted official UI-Default-ToRT Material bundle",
                "1.6.0 decrypted official Card_UI_Default_ToRT Shader bundle",
            ],
            "excludedInputs": [
                "scene.json", "recipes", "generated WebGL2 assets", "browser runtime",
                "screenshots", "UI-Default-FromRT Material and Shader",
            ],
        },
        "source": {"decryptedRoot": str(decrypted_root.resolve())},
        "uiImageUsage": prefab,
        "material": material,
        "shaderProgram": shader,
        "derived": {
            "assetChain": [
                "CardEnergyIconView Outline and icn_gra_img UI Image serializations point to UI-Default-ToRT Material",
                "the prefab Image m_Material FileID resolves to the Material serialized CAB and PathID",
                "the Material m_Shader FileID resolves to the Shader serialized CAB and PathID",
                "the selected port target is subshader 0 Default pass Vulkan group 3 variant 0 with no keywords",
            ],
            "producerRole": (
                "ToRT consumes a UI sprite texture and produces MRT color; it is distinct from "
                "UI Default From RT, which consumes the composed RenderTexture for display"
            ),
            "fragmentDataFlow": {
                "tint": "vertexColor * _Color",
                "uv": "uv0 * _MainTex_ST.xy + _MainTex_ST.zw",
                "primary": "(texture(_MainTex, uv) + _TextureSampleAdd) * tint",
                "mrt1": "vec4(0.0)",
            },
            "defaultPassBlend": {
                "source": "SrcAlpha", "destination": "OneMinusSrcAlpha",
                "sourceValue": 5, "destinationValue": 10,
                "serializedSeparateBlend": False,
            },
        },
        "runtimeBoundaries": [
            {
                "id": "runtime-subshader-pass-selection", "status": "unproved",
                "claim": (
                    "the actual Canvas draw selects serialized subshader 0 Default rather than "
                    "subshader 1 Alpha; static bundle order is not a runtime capture"
                ),
            },
            {
                "id": "dynamic-ui-keyword-state", "status": "unproved",
                "claim": (
                    "the actual UNITY_UI_CLIP_RECT, UNITY_UI_ALPHACLIP, and SUB_OFFSET "
                    "keyword set for each draw; the serialized Material has no keywords"
                ),
            },
            {
                "id": "dynamic-canvas-fixed-function-state", "status": "unproved",
                "claim": (
                    "resolved unity_GUIZTestMode, _ColorMask, _Stencil, _StencilComp, "
                    "_StencilOp, _StencilReadMask, and _StencilWriteMask values per Canvas draw"
                ),
            },
            {
                "id": "producer-render-target-contract", "status": "unproved",
                "claim": (
                    "the runtime MRT attachment formats, color spaces, clears, viewport, and "
                    "destination contents receiving this producer draw"
                ),
            },
            {
                "id": "texture-sample-add-per-draw-value", "status": "unproved",
                "claim": "the actual _TextureSampleAdd value supplied for each UI Image draw",
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root", type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.decrypted_root.is_dir():
        parser.error(f"decrypted root not found: {args.decrypted_root}")
    result = extract(args.decrypted_root.resolve())
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
