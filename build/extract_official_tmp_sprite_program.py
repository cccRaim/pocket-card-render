#!/usr/bin/env python3
"""Extract the official TextExSprite Material -> TMP Sprite Vulkan program chain.

Only immutable official bundle bytes and the versioned official-sample manifest
are inputs. Generated scenes, renderer code, screenshots, and existing TMP
contracts are deliberately excluded.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import warnings

import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))
sys.path.insert(0, str(ROOT / "build" / "shaderdec"))

from official_sample import load_official_sample  # noqa: E402
from extract_variant_bindings import parse_parameter_blob  # noqa: E402
from extract_official_material_program_inventory import (  # noqa: E402
    SHADER_STAGES,
    canonical_digest,
    canonical_identity,
    decode_program_modules,
    enabled_keywords,
    pass_contract,
    pptr_identity,
    shader_program_segments,
    spirv_execution_model,
    static_vulkan_candidates,
    trim_spirv,
)
import smolv  # noqa: E402


DEFAULT_DECRYPTED_ROOT = Path(os.environ.get(
    "PCR_DECRYPTED_ROOT",
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
))
FONT_BUNDLE_RELATIVE = Path("Common/Font_bundles")
SHADER_BUNDLE_RELATIVE = Path(
    "Common/Shader/Common/CardNew/UI/Card_TextMeshPro_Sprite_ToRT.shader_bundles"
)

SPRITE_ASSET_PATH_ID = 840073264968542736
MATERIAL_PATH_ID = -1050951510632854060
TEXTURE_PATH_ID = 3209478181533236899
SHADER_PATH_ID = 2168984029091550199
SHADER_NAME = "Lettuce/Common/Card/TextMeshPro/Sprite(to RT)"

PINNED = {
    "sampleId": "ptcgp-1.6.0-unity-2022.3.62f2",
    "sampleManifestSha256": "2515cae195ee58f06c32f5d0c7d063c6b7a1f03b5743696e2181786d074d4b4d",
    "fontBundle": {
        "byteSize": 79168397,
        "sha256": "88364448d71939764df209474b760b8d30623eba85a165d7b822e2488cc10589",
    },
    "spriteAssetObject": {
        "byteSize": 572,
        "sha256": "e6f1c89e38810a0d8f99ae1a382a3e2f0a0ed05b03281f40f0c57644eea2dd55",
    },
    "materialObject": {
        "byteSize": 1028,
        "sha256": "d5161b0bbbe99257643d3b9fd127b0433029beee5b87386eb796e20a5911b984",
    },
    "textureObject": {
        "byteSize": 216,
        "sha256": "579de24c79adec19a721dc8e786acd527f5d6648f9506d6c30ce6da5856e24ea",
    },
    "shaderBundle": {
        "byteSize": 19922,
        "sha256": "4aa7b6424b855d05c2e3da29a388983a121cb62e683496dabb404e5a0423bbbc",
    },
    "shaderObject": {
        "byteSize": 6532,
        "sha256": "bb8dbbecf77225be55cf713731e31a9e6e997548838dcd8ed737c89ca09d1bc6",
    },
    "selectorId": "efa03dcbfe79cd09734a60516654ad6dcd6a92d717eb54b9b01baccf92f56c17",
    "candidateWitnessId": "d3e59c58da95b14e62179d5f3b0fc1f546289eb4f1f469f80be2ebc3c52de8d4",
    "executableId": "983d233751c4653fbb7fcc71082de5994a5ce85952b54622f97ffff5c82d4d6e",
    "semanticExecutableId": "d349fa456062441c91a51916b1c8ac03efaffd15112cf55052a209e7e5cca9f3",
    "passStateSha256": "749196a0b5b748f75aed6e40f084fe22429407480f09a8688bfc51e2fd87f0cf",
    "commonBindingsSha256": "3ebda9f44bdf3c693cfbf91fc1e1c9e5334d70590e7a32f19300fddf198b3df4",
    "parameterEntry": {
        "byteSize": 348,
        "sha256": "a70bdad59d44e675a9b67fbdfe43ed639f4945fb56a0627c54e4694437f6691d",
    },
    "programEntry": {
        "byteSize": 1536,
        "sha256": "e941539c07c7193a7138d5f8ab12ef7e6834fdb25d88e6a50fc8b77d2be4d388",
    },
    "vertexSpirv": {
        "byteSize": 2736,
        "sha256": "5f2f316db1877ae0c0a1a1801384fcc7244a353961145e454878205eb7a4b058",
    },
    "fragmentSpirv": {
        "byteSize": 1740,
        "sha256": "43e4c386774200c649e187ccec51e9fa4ec7671af3cfb84aa7b368e83de72f14",
    },
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hash_record(value: bytes) -> dict:
    return {"byteSize": len(value), "sha256": sha256_bytes(value)}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def require_record(label: str, value: bytes, expected: dict) -> dict:
    actual = hash_record(value)
    require(actual == expected, f"{label} changed: expected {expected}, got {actual}")
    return actual


def require_one(rows: list, label: str):
    require(len(rows) == 1, f"{label} resolved to {len(rows)} rows")
    return rows[0]


def pptr(pointer: object) -> dict:
    require(isinstance(pointer, dict), "serialized PPtr is absent")
    return {
        "fileId": int(pointer.get("m_FileID", 0)),
        "pathId": str(pointer.get("m_PathID", 0)),
    }


def pair_map(value: object) -> dict:
    result = {}
    for row in value or []:
        require(isinstance(row, (list, tuple)) and len(row) == 2,
                "saved property row is malformed")
        result[str(row[0])] = row[1]
    return result


def vector(value: object) -> list[float]:
    require(isinstance(value, dict), "serialized vector is malformed")
    return [float(value[key]) for key in ("x", "y")]


def color(value: object) -> list[float]:
    require(isinstance(value, dict), "serialized color is malformed")
    return [float(value[key]) for key in ("r", "g", "b", "a")]


def value(record: object) -> dict:
    require(isinstance(record, dict) and "val" in record,
            "serialized render-state value is missing")
    name = str(record.get("name", "<noninit>"))
    return {
        "value": int(record["val"]),
        "property": None if name == "<noninit>" else name,
    }


def normalized_render_state(shader_pass: dict) -> dict:
    state = shader_pass.get("m_State") or {}
    blend = state.get("rtBlend0") or {}
    stencil = state.get("stencilOp") or {}
    return {
        "blend": {
            "srcColor": value(blend.get("srcBlend")),
            "dstColor": value(blend.get("destBlend")),
            "srcAlpha": value(blend.get("srcBlendAlpha")),
            "dstAlpha": value(blend.get("destBlendAlpha")),
            "colorOp": value(blend.get("blendOp")),
            "alphaOp": value(blend.get("blendOpAlpha")),
            "colorMask": value(blend.get("colMask")),
            "separate": bool(state.get("rtSeparateBlend", False)),
        },
        "depth": {
            "test": value(state.get("zTest")),
            "write": value(state.get("zWrite")),
            "clip": value(state.get("zClip")),
        },
        "cull": value(state.get("culling")),
        "stencil": {
            "reference": value(state.get("stencilRef")),
            "readMask": value(state.get("stencilReadMask")),
            "writeMask": value(state.get("stencilWriteMask")),
            "compare": value(stencil.get("comp")),
            "pass": value(stencil.get("pass")),
            "fail": value(stencil.get("fail")),
            "depthFail": value(stencil.get("zFail")),
        },
        "alphaToMask": value(state.get("alphaToMask")),
    }


def material_properties(material: dict) -> dict:
    saved = material.get("m_SavedProperties") or {}
    floats = {name: float(number) for name, number in pair_map(saved.get("m_Floats")).items()}
    colors = {name: color(number) for name, number in pair_map(saved.get("m_Colors")).items()}
    textures = pair_map(saved.get("m_TexEnvs"))
    main = textures.get("_MainTex")
    require(isinstance(main, dict), "TextExSprite _MainTex is absent")
    dynamic_names = (
        "_ColorMask", "_Stencil", "_StencilComp", "_StencilOp",
        "_StencilReadMask", "_StencilWriteMask",
    )
    return {
        "mainTexture": {
            **pptr(main.get("m_Texture")),
            "scale": vector(main.get("m_Scale")),
            "offset": vector(main.get("m_Offset")),
        },
        "color": colors.get("_Color"),
        "canvasStateDefaults": {name: floats.get(name) for name in dynamic_names},
    }


def common_binding_record(shader_pass: dict) -> dict:
    names = {
        int(index): str(name)
        for name, index in (shader_pass.get("m_NameIndices") or [])
    }
    textures = {}
    constant_buffers = {}
    for stage in SHADER_STAGES:
        common = (shader_pass.get(stage) or {}).get("m_CommonParameters") or {}
        for item in common.get("m_TextureParams") or []:
            name = names.get(int(item.get("m_NameIndex", -1)))
            require(bool(name), f"{stage} common texture name is unresolved")
            encoded = int(item.get("m_Index", 0))
            row = {
                "name": name,
                "binding": encoded & 0xFFFFFF,
                "encodedIndex": encoded,
                "samplerIndex": int(item.get("m_SamplerIndex", -1)),
                "dimension": int(item.get("m_Dim", -1)),
                "multisampled": bool(item.get("m_MultiSampled", False)),
                "stages": [stage],
            }
            previous = textures.get(name)
            if previous is None:
                textures[name] = row
            else:
                require(
                    {key: previous[key] for key in row if key != "stages"}
                    == {key: row[key] for key in row if key != "stages"},
                    f"common texture {name} differs by stage",
                )
                previous["stages"].append(stage)
        for item in common.get("m_ConstantBuffers") or []:
            name = names.get(int(item.get("m_NameIndex", -1)))
            require(bool(name), f"{stage} common constant buffer name is unresolved")
            row = {
                "name": name,
                "byteSize": int(item.get("m_Size", -1)),
                "stages": [stage],
            }
            previous = constant_buffers.get(name)
            if previous is None:
                constant_buffers[name] = row
            else:
                require(previous["byteSize"] == row["byteSize"],
                        f"common constant buffer {name} differs by stage")
                previous["stages"].append(stage)
    return {
        "textures": sorted(textures.values(), key=lambda row: (row["binding"], row["name"])),
        "constantBuffers": sorted(constant_buffers.values(), key=lambda row: row["name"]),
    }


def decoded_modules(program_entry: bytes) -> tuple[list[dict], dict]:
    decoded = decode_program_modules(program_entry)
    records = smolv.find_and_decode_records(program_entry)
    require(len(records) == len(decoded["modules"]), "SMOL-V record count changed")
    modules = []
    for metadata, record in zip(decoded["modules"], records):
        module = trim_spirv(record["decoded"])
        require(len(module) == len(record["decoded"]),
                "strict SMOL-V decoded size exceeds the SPIR-V module")
        require(spirv_execution_model(module) == metadata["executionModel"],
                "SPIR-V execution model changed")
        require(hash_record(module) == {
            "byteSize": metadata["byteSize"],
            "sha256": metadata["sha256"],
        }, "decoded SPIR-V bytes disagree with executable metadata")
        modules.append({**metadata, "spvHex": module.hex()})
    return modules, decoded


def extract(
    decrypted_root: Path,
    font_bundle_path: Path,
    shader_bundle_path: Path,
    expected_selector_id: str,
    expected_candidate_witness_id: str,
    manifest_path: str | None,
) -> dict:
    loaded = load_official_sample(manifest_path)
    sample = loaded["sample"]
    require(sample["sampleId"] == PINNED["sampleId"], "official sample ID changed")
    require(
        loaded["sampleManifestSha256"] == PINNED["sampleManifestSha256"],
        "official sample manifest changed",
    )
    UnityPy.config.FALLBACK_UNITY_VERSION = sample["unity"]["serializedVersion"]
    warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")

    font_bytes = font_bundle_path.read_bytes()
    font_bundle = require_record("official Font_bundles", font_bytes, PINNED["fontBundle"])
    font_environment = UnityPy.load(font_bytes)
    font_objects = {int(obj.path_id): obj for obj in font_environment.objects}
    sprite_object = font_objects.get(SPRITE_ASSET_PATH_ID)
    material_object = font_objects.get(MATERIAL_PATH_ID)
    texture_object = font_objects.get(TEXTURE_PATH_ID)
    require(sprite_object is not None and sprite_object.type.name == "MonoBehaviour",
            "TextExSprite SpriteAsset object is absent")
    require(material_object is not None and material_object.type.name == "Material",
            "TextExSprite Material object is absent")
    require(texture_object is not None and texture_object.type.name == "Texture2D",
            "TextExSprite Texture2D object is absent")

    sprite_raw = bytes(sprite_object.get_raw_data())
    material_raw = bytes(material_object.get_raw_data())
    texture_raw = bytes(texture_object.get_raw_data())
    sprite_record = require_record(
        "TextExSprite SpriteAsset object", sprite_raw, PINNED["spriteAssetObject"]
    )
    material_record = require_record(
        "TextExSprite Material object", material_raw, PINNED["materialObject"]
    )
    texture_record = require_record(
        "TextExSprite Texture2D object", texture_raw, PINNED["textureObject"]
    )
    sprite = sprite_object.read_typetree()
    material = material_object.read_typetree()
    require(sprite.get("m_Name") == "TextExSprite", "SpriteAsset name changed")
    require(material.get("m_Name") == "TextExSprite", "Material name changed")
    require(pptr(sprite.get("material")) == {"fileId": 0, "pathId": str(MATERIAL_PATH_ID)},
            "SpriteAsset Material PPtr changed")
    require(pptr(sprite.get("spriteSheet")) == {"fileId": 0, "pathId": str(TEXTURE_PATH_ID)},
            "SpriteAsset spriteSheet PPtr changed")

    keywords = enabled_keywords(material)
    require(keywords == [], "TextExSprite serialized Material keywords changed")
    require(list(material.get("m_InvalidKeywords") or []) == [],
            "TextExSprite invalid keyword set changed")
    require(not material.get("m_EnableInstancingVariants", False),
            "TextExSprite instancing state changed")
    require(list(material.get("disabledShaderPasses") or []) == [],
            "TextExSprite disabled pass set changed")
    require(int(material.get("m_CustomRenderQueue", -1)) == -1,
            "TextExSprite custom render queue changed")
    properties = material_properties(material)
    require(properties["mainTexture"] == {
        "fileId": 0,
        "pathId": str(TEXTURE_PATH_ID),
        "scale": [1.0, 1.0],
        "offset": [0.0, 0.0],
    }, "TextExSprite _MainTex binding changed")
    require(properties["color"] == [1.0, 1.0, 1.0, 1.0],
            "TextExSprite _Color changed")
    require(properties["canvasStateDefaults"] == {
        "_ColorMask": 15.0,
        "_Stencil": 0.0,
        "_StencilComp": 8.0,
        "_StencilOp": 0.0,
        "_StencilReadMask": 255.0,
        "_StencilWriteMask": 255.0,
    }, "TextExSprite Canvas-state Material defaults changed")

    material_identity = canonical_identity(
        str(material_object.assets_file.name), MATERIAL_PATH_ID
    )
    shader_identity = pptr_identity(
        material_object, material.get("m_Shader"), "TextExSprite Material.m_Shader"
    )

    shader_bytes = shader_bundle_path.read_bytes()
    shader_bundle = require_record(
        "official TMP Sprite shader bundle", shader_bytes, PINNED["shaderBundle"]
    )
    shader_environment = UnityPy.load(shader_bytes)
    shader_objects = [
        obj for obj in shader_environment.objects
        if obj.type.name == "Shader" and int(obj.path_id) == SHADER_PATH_ID
    ]
    shader_object = require_one(shader_objects, "official TMP Sprite Shader object")
    shader_raw = bytes(shader_object.get_raw_data())
    shader_record = require_record(
        "official TMP Sprite Shader object", shader_raw, PINNED["shaderObject"]
    )
    require(
        canonical_identity(str(shader_object.assets_file.name), SHADER_PATH_ID)
        == shader_identity,
        "Material Shader PPtr does not resolve to the official shader object",
    )
    shader = shader_object.read_typetree()
    parsed = shader.get("m_ParsedForm") or {}
    require(parsed.get("m_Name") == SHADER_NAME, "TMP Sprite Shader name changed")
    require([int(value) for value in shader.get("platforms") or []] == [18],
            "TMP Sprite Shader platform set changed")

    selector_id = canonical_digest([shader_identity, keywords])
    require(expected_selector_id == PINNED["selectorId"],
            "requested selector ID does not match the pinned contract")
    require(selector_id == expected_selector_id, "official selector ID changed")
    candidates, unknown_keywords = static_vulkan_candidates(shader, tuple(keywords))
    require(unknown_keywords == [], "Material keyword set is absent from Shader metadata")
    candidate = require_one(candidates, "empty-keyword Vulkan selector candidate")
    require(candidate == {
        "subshader": 0,
        "pass": 0,
        "programBlobIndex": 4,
        "parameterBlobIndex": 0,
        "gpuProgramType": 25,
        "keywordIndices": [],
        "keywords": [],
        "shaderRequirements": 33,
        "stages": [{
            "stageMetadata": "progVertex",
            "playerGroup": 3,
            "variantIndex": 0,
        }],
    }, "TMP Sprite static candidate route changed")
    witness_fields = {
        "shaderIdentity": shader_identity,
        "shaderObjectSha256": shader_record["sha256"],
        "platformIndex": 0,
        "platformValue": 18,
        "segmentIndex": 0,
        "subshaderIndex": candidate["subshader"],
        "passIndex": candidate["pass"],
        "stageContainers": candidate["stages"],
        "keywordIndices": candidate["keywordIndices"],
        "keywords": candidate["keywords"],
        "gpuProgramType": candidate["gpuProgramType"],
        "shaderRequirements": candidate["shaderRequirements"],
        "programBlobIndex": candidate["programBlobIndex"],
        "parameterBlobIndex": candidate["parameterBlobIndex"],
    }
    candidate_witness_id = canonical_digest(witness_fields)
    require(expected_candidate_witness_id == PINNED["candidateWitnessId"],
            "requested candidate witness ID does not match the pinned contract")
    require(candidate_witness_id == expected_candidate_witness_id,
            "official candidate witness ID changed")

    executable = None
    from extract_official_material_program_inventory import resolve_static_executable
    executable = resolve_static_executable(shader, candidate)
    require(executable["executableId"] == PINNED["executableId"],
            "official executable identity changed")
    require(executable["semanticExecutableId"] == PINNED["semanticExecutableId"],
            "official semantic executable identity changed")
    require(executable["pass"]["passStateSha256"] == PINNED["passStateSha256"],
            "official pass-state identity changed")
    require(executable["pass"]["commonBindingsSha256"] == PINNED["commonBindingsSha256"],
            "official common-binding identity changed")

    segments = shader_program_segments(shader)
    segment = require_one(segments, "Vulkan ShaderProgram segment")
    entries = segment["entries"]
    parameter_entry = entries[int(candidate["parameterBlobIndex"])]
    program_entry = entries[int(candidate["programBlobIndex"])]
    require({
        "byteSize": parameter_entry["byteSize"],
        "sha256": parameter_entry["sha256"],
    } == PINNED["parameterEntry"], "official parameter entry changed")
    require({
        "byteSize": program_entry["byteSize"],
        "sha256": program_entry["sha256"],
    } == PINNED["programEntry"], "official program entry changed")

    texture_names = {
        str(prop.get("m_Name"))
        for prop in ((parsed.get("m_PropInfo") or {}).get("m_Props") or [])
        if int(prop.get("m_Type", -1)) == 4 and prop.get("m_Name")
    }
    parameter_reflection = parse_parameter_blob(parameter_entry["raw"], texture_names)
    modules, decoded_program = decoded_modules(program_entry["raw"])
    by_stage = {module["stage"]: module for module in modules}
    for stage in ("vertex", "fragment"):
        require({
            "byteSize": by_stage[stage]["byteSize"],
            "sha256": by_stage[stage]["sha256"],
        } == PINNED[f"{stage}Spirv"], f"official {stage} SPIR-V changed")

    subshader = parsed["m_SubShaders"][candidate["subshader"]]
    shader_pass = subshader["m_Passes"][candidate["pass"]]
    pass_evidence = pass_contract(shader, candidate)
    common_raw = {
        "nameIndices": shader_pass.get("m_NameIndices") or [],
        "commonParameters": {
            stage: (shader_pass.get(stage) or {}).get("m_CommonParameters") or {}
            for stage in SHADER_STAGES
        },
    }
    require(canonical_digest(common_raw) == PINNED["commonBindingsSha256"],
            "official common bindings changed after extraction")
    common = common_binding_record(shader_pass)
    require(common["textures"] == [{
        "name": "_MainTex",
        "binding": 0,
        "encodedIndex": 134217728,
        "samplerIndex": -1,
        "dimension": 2,
        "multisampled": False,
        "stages": ["progVertex"],
    }], "official _MainTex common binding changed")
    require(parameter_reflection["constantBuffers"] == [
        {"name": "", "size": 0, "fields": []},
        {
            "name": "PGlobals610448065",
            "size": 16,
            "fields": [{
                "name": "_TextureSampleAdd",
                "offset": 0,
                "descriptor": [0, 1, 4, 0, 0, 0],
            }],
        },
        {
            "name": "VGlobals610448065",
            "size": 144,
            "fields": [
                {
                    "name": "_Color",
                    "offset": 128,
                    "descriptor": [0, 1, 4, 0, 0, 128],
                },
                {
                    "name": "unity_MatrixVP",
                    "offset": 64,
                    "descriptor": [0, 4, 4, 1, 0, 64],
                },
                {
                    "name": "unity_ObjectToWorld",
                    "offset": 0,
                    "descriptor": [0, 4, 4, 1, 0, 0],
                },
            ],
        },
    ], "official parameter constant-buffer layout changed")
    require(decoded_program["programBindChannels"]["bindChannels"] == [
        {
            "index": 0, "source": 0, "sourceName": "Vertex",
            "target": 13, "targetName": "Attrib1",
        },
        {
            "index": 1, "source": 3, "sourceName": "Color",
            "target": 14, "targetName": "Attrib2",
        },
        {
            "index": 2, "source": 4, "sourceName": "UV0",
            "target": 15, "targetName": "Attrib3",
        },
    ], "official TMP Sprite bind channels changed")

    render_state = normalized_render_state(shader_pass)
    require(render_state["blend"]["srcColor"] == {"value": 1, "property": None},
            "TMP Sprite source blend changed")
    require(render_state["blend"]["dstColor"] == {"value": 10, "property": None},
            "TMP Sprite destination blend changed")
    require(render_state["blend"]["separate"] is False,
            "TMP Sprite separate blend changed")
    require(render_state["depth"]["write"] == {"value": 0, "property": None},
            "TMP Sprite ZWrite changed")
    require(render_state["cull"] == {"value": 0, "property": None},
            "TMP Sprite cull state changed")

    composite_fields = {
        "selectorId": selector_id,
        "candidateWitnessId": candidate_witness_id,
        "subshader": candidate["subshader"],
        "pass": candidate["pass"],
    }
    return {
        "schema": "pocket-card-render/official-tmp-sprite-program-extract@1",
        "schemaVersion": 1,
        "status": "exact-static-source-with-runtime-boundaries",
        "provenance": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
        },
        "evidencePolicy": {
            "officialInputs": [
                FONT_BUNDLE_RELATIVE.as_posix(),
                SHADER_BUNDLE_RELATIVE.as_posix(),
                "build/official-samples/current.json",
            ],
            "excludedInputs": [
                "scene JSON",
                "render recipes",
                "generated WebGL sources",
                "browser or guest runtime",
                "screenshots",
            ],
        },
        "assetChain": {
            "fontBundle": {
                "sourceId": FONT_BUNDLE_RELATIVE.as_posix(),
                **font_bundle,
                "serializedFile": str(material_object.assets_file.name),
            },
            "spriteAsset": {
                "identity": canonical_identity(
                    str(sprite_object.assets_file.name), SPRITE_ASSET_PATH_ID
                ),
                **sprite_record,
                "name": "TextExSprite",
                "materialPPtr": pptr(sprite.get("material")),
                "spriteSheetPPtr": pptr(sprite.get("spriteSheet")),
            },
            "material": {
                "identity": material_identity,
                **material_record,
                "name": "TextExSprite",
                "shaderPPtr": pptr(material.get("m_Shader")),
                "shaderIdentity": shader_identity,
                "keywords": keywords,
                "invalidKeywords": [],
                "customRenderQueue": -1,
                "enableInstancingVariants": False,
                "disabledShaderPasses": [],
                "serializedProperties": properties,
            },
            "texture": {
                "identity": canonical_identity(
                    str(texture_object.assets_file.name), TEXTURE_PATH_ID
                ),
                **texture_record,
                "name": "TextExSprite",
            },
            "shaderBundle": {
                "sourceId": SHADER_BUNDLE_RELATIVE.as_posix(),
                **shader_bundle,
                "serializedFile": str(shader_object.assets_file.name),
            },
            "shader": {
                "identity": shader_identity,
                **shader_record,
                "name": SHADER_NAME,
                "platforms": [18],
                "keywordNames": [str(value) for value in parsed.get("m_KeywordNames") or []],
            },
        },
        "selector": {
            **composite_fields,
            "compositeIdentitySha256": canonical_digest(composite_fields),
            "shaderIdentity": shader_identity,
            "shaderName": SHADER_NAME,
            "keywords": keywords,
            "candidateSelection": "exact-keywords",
            "selectionMode": "unique-exact-keywords",
            "candidate": candidate,
            "witnessFields": witness_fields,
        },
        "executable": {
            "executableId": executable["executableId"],
            "semanticExecutableId": executable["semanticExecutableId"],
            "identityFields": executable["identityFields"],
            "semanticIdentityFields": executable["semanticIdentityFields"],
            "segment": executable["segment"],
            "programEntry": executable["programEntry"],
            "parameterEntry": executable["parameterEntry"],
            "programContainerLayout": decoded_program["containerLayout"],
            "programContainerLayoutSha256": decoded_program["containerLayoutSha256"],
            "modules": modules,
        },
        "pass": {
            "passStateSha256": pass_evidence["passStateSha256"],
            "commonBindingsSha256": pass_evidence["commonBindingsSha256"],
            "contract": pass_evidence["contract"],
            "renderState": render_state,
        },
        "bindings": {
            "programBindChannels": decoded_program["programBindChannels"],
            "parameterReflection": parameter_reflection,
            "parameterReflectionSha256": canonical_digest(parameter_reflection),
            "common": common,
        },
        "runtimeBoundaries": [
            {
                "id": "guest-runtime-dispatch",
                "status": "runtime-required",
                "claim": (
                    "the guest Canvas draw selects this empty-keyword selector candidate; "
                    "the serialized Material candidate is not a guest dispatch capture"
                ),
            },
            {
                "id": "dynamic-canvas-keywords",
                "status": "runtime-required",
                "claim": (
                    "the guest UNITY_UI_CLIP_RECT and UNITY_UI_ALPHACLIP keyword state"
                ),
            },
            {
                "id": "dynamic-canvas-fixed-function-state",
                "status": "runtime-required",
                "claim": (
                    "resolved unity_GUIZTestMode, _ColorMask, _Stencil, _StencilComp, "
                    "_StencilOp, _StencilReadMask, and _StencilWriteMask per draw"
                ),
            },
            {
                "id": "texture-sample-add-value",
                "status": "runtime-required",
                "claim": "the guest _TextureSampleAdd value for the TextExSprite atlas draw",
            },
            {
                "id": "render-target-attachments",
                "status": "runtime-required",
                "claim": (
                    "guest MRT attachment formats, colorspace, clear, viewport, and "
                    "destination contents"
                ),
            },
            {
                "id": "tmp-submesh-canvas-order",
                "status": "runtime-required",
                "claim": (
                    "the submitted TMP_SubMeshUI sibling/draw order in the official Canvas batch"
                ),
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED_ROOT)
    parser.add_argument("--font-bundle", type=Path)
    parser.add_argument("--shader-bundle", type=Path)
    parser.add_argument("--expected-selector-id", default=PINNED["selectorId"])
    parser.add_argument(
        "--expected-candidate-witness-id", default=PINNED["candidateWitnessId"]
    )
    parser.add_argument("--official-sample-manifest")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    decrypted_root = args.decrypted_root.resolve()
    font_bundle = (args.font_bundle or decrypted_root / FONT_BUNDLE_RELATIVE).resolve()
    shader_bundle = (
        args.shader_bundle or decrypted_root / SHADER_BUNDLE_RELATIVE
    ).resolve()
    require(font_bundle.is_file(), f"official Font_bundles is absent: {font_bundle}")
    require(shader_bundle.is_file(), f"official TMP Sprite shader bundle is absent: {shader_bundle}")
    report = extract(
        decrypted_root,
        font_bundle,
        shader_bundle,
        args.expected_selector_id,
        args.expected_candidate_witness_id,
        args.official_sample_manifest,
    )
    json.dump(
        report,
        sys.stdout,
        ensure_ascii=True,
        indent=2 if args.pretty else None,
        sort_keys=True,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
