#!/usr/bin/env python3
"""Resolve card-face UGUI Image resources from official Unity bundle bytes.

The prefab Image PPtrs are followed through Sprite -> Texture2D and
Material -> Shader.  Generated scenes, recipes, exported PNGs, browser state,
and screenshots are deliberately outside this extractor's evidence boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import warnings

import UnityPy

from extract_official_material_sort_inputs import (
    OfficialBundleIndex,
    pptr_record,
    sha256_file,
)


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
DEFAULT_UNITY_VERSION = "2022.3.62f2"
SCHEMA = "pocket-card-render/official-ugui-resources@1"
PREFABS = {
    "pokemon": Path("Common/CardNew/System/Prefabs/PokemonCardUI.prefab_bundles"),
    "trainer": Path("Common/CardNew/System/Prefabs/TrainersCardUI.prefab_bundles"),
}

UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get(
    "PCR_UNITY_VERSION",
    DEFAULT_UNITY_VERSION,
)
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256(encoded)


def nullable_pptr_record(owner: object, pointer: object, label: str) -> dict | None:
    if not isinstance(pointer, dict):
        raise RuntimeError(f"{label} is not a serialized PPtr")
    if int(pointer.get("m_PathID", 0)) == 0:
        return None
    return pptr_record(owner, pointer, label)


def object_record(index: OfficialBundleIndex, obj: object, bundle: Path) -> dict:
    raw = bytes(obj.get_raw_data())
    return {
        "identity": f"{obj.assets_file.name}:{obj.path_id}",
        "pathId": str(obj.path_id),
        "sourceBundle": index.relative(bundle),
        "sourceBundleByteSize": bundle.stat().st_size,
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256(raw),
    }


def require_object(
    index: OfficialBundleIndex,
    identity: str,
    expected_type: str,
) -> tuple[object, Path]:
    return index.object(identity, expected_type)


def extract_prefab_images(
    index: OfficialBundleIndex,
    decrypted_root: Path,
    kind: str,
    relative: Path,
) -> tuple[dict, list[dict]]:
    bundle = (decrypted_root / relative).resolve()
    environment, objects = index.load(bundle)
    owned_cabs = sorted({str(obj.assets_file.name) for obj in environment.objects})
    if len(owned_cabs) != 1:
        raise RuntimeError(f"{relative}: expected one serialized CAB, got {owned_cabs}")
    source_cab = owned_cabs[0]
    index.cab_paths[source_cab] = bundle

    game_objects = {}
    for obj in environment.objects:
        if obj.type.name != "GameObject":
            continue
        tree = obj.read_typetree()
        game_objects[int(obj.path_id)] = str(tree.get("m_Name") or "")

    rows = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        if "m_Sprite" not in tree or "m_PixelsPerUnitMultiplier" not in tree:
            continue
        game_pointer = tree.get("m_GameObject", {})
        game_path_id = int(game_pointer.get("m_PathID", 0))
        raw = bytes(obj.get_raw_data())
        rows.append(
            {
                "prefabKind": kind,
                "imageIdentity": f"{source_cab}:{obj.path_id}",
                "imagePathId": str(obj.path_id),
                "imageRawByteSize": len(raw),
                "imageRawSha256": sha256(raw),
                "gameObjectPathId": str(game_path_id),
                "gameObjectName": game_objects.get(game_path_id, ""),
                "spritePointer": nullable_pptr_record(
                    obj, tree.get("m_Sprite"), f"Image {obj.path_id}.m_Sprite"
                ),
                "materialPointer": nullable_pptr_record(
                    obj, tree.get("m_Material"), f"Image {obj.path_id}.m_Material"
                ),
            }
        )
    rows.sort(key=lambda row: int(row["imagePathId"]))
    return (
        {
            "kind": kind,
            "relativePath": relative.as_posix(),
            "serializedCab": source_cab,
            "byteSize": bundle.stat().st_size,
            "sha256": sha256_file(bundle),
            "imageCount": len(rows),
        },
        rows,
    )


def sprite_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = require_object(index, identity, "Sprite")
    tree = obj.read_typetree()
    label = f"Sprite {identity}"
    render_data = tree.get("m_RD")
    if not isinstance(render_data, dict):
        raise RuntimeError(f"{label} is missing m_RD")
    texture_pointer = nullable_pptr_record(
        obj, render_data.get("texture"), f"{label}.m_RD.texture"
    )
    if texture_pointer is None:
        raise RuntimeError(f"{label} has no render-data Texture2D")
    return {
        **object_record(index, obj, bundle),
        "name": str(tree.get("m_Name") or ""),
        "rect": {key: float(tree.get("m_Rect", {}).get(key, 0)) for key in ("x", "y", "width", "height")},
        "border": {key: float(tree.get("m_Border", {}).get(key, 0)) for key in ("x", "y", "z", "w")},
        "pixelsToUnits": float(tree.get("m_PixelsToUnits", 0)),
        "pivot": {key: float(tree.get("m_Pivot", {}).get(key, 0)) for key in ("x", "y")},
        "isPolygon": bool(tree.get("m_IsPolygon", False)),
        "atlasPointer": nullable_pptr_record(
            obj, tree.get("m_SpriteAtlas"), f"{label}.m_SpriteAtlas"
        ),
        "texturePointer": texture_pointer,
        "alphaTexturePointer": nullable_pptr_record(
            obj, render_data.get("alphaTexture"), f"{label}.m_RD.alphaTexture"
        ),
        "secondaryTextureCount": len(render_data.get("secondaryTextures", [])),
    }


def texture_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = require_object(index, identity, "Texture2D")
    tree = obj.read_typetree()
    typed = obj.read()
    payload = bytes(typed.get_image_data())
    stream = tree.get("m_StreamData", {})
    settings = tree.get("m_TextureSettings", {})
    return {
        **object_record(index, obj, bundle),
        "name": str(tree.get("m_Name") or ""),
        "width": int(tree.get("m_Width", 0)),
        "height": int(tree.get("m_Height", 0)),
        "textureFormat": int(tree.get("m_TextureFormat", -1)),
        "mipCount": int(tree.get("m_MipCount", 0)),
        "colorSpace": int(tree.get("m_ColorSpace", -1)),
        "isReadable": bool(tree.get("m_IsReadable", False)),
        "sampler": {
            "filterMode": int(settings.get("m_FilterMode", -1)),
            "aniso": int(settings.get("m_Aniso", -1)),
            "mipBias": float(settings.get("m_MipBias", 0)),
            "wrapU": int(settings.get("m_WrapU", -1)),
            "wrapV": int(settings.get("m_WrapV", -1)),
            "wrapW": int(settings.get("m_WrapW", -1)),
        },
        "stream": {
            "offset": int(stream.get("offset", 0)),
            "size": int(stream.get("size", 0)),
            "path": str(stream.get("path", "")),
        },
        "payloadByteSize": len(payload),
        "payloadSha256": sha256(payload),
    }


def material_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = require_object(index, identity, "Material")
    tree = obj.read_typetree()
    shader_pointer = nullable_pptr_record(
        obj, tree.get("m_Shader"), f"Material {identity}.m_Shader"
    )
    if shader_pointer is None:
        raise RuntimeError(f"Material {identity} has no Shader")
    return {
        **object_record(index, obj, bundle),
        "name": str(tree.get("m_Name") or ""),
        "shaderPointer": shader_pointer,
        "customRenderQueue": int(tree.get("m_CustomRenderQueue", -1)),
        "validKeywords": [str(value) for value in tree.get("m_ValidKeywords", [])],
        "invalidKeywords": [str(value) for value in tree.get("m_InvalidKeywords", [])],
    }


def shader_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = require_object(index, identity, "Shader")
    tree = obj.read_typetree()
    parsed = tree.get("m_ParsedForm", {})
    return {
        **object_record(index, obj, bundle),
        "name": str(parsed.get("m_Name") or tree.get("m_Name") or ""),
    }


def cab_set(records: list[dict], pointer_key: str) -> set[str]:
    return {
        row[pointer_key]["targetCab"]
        for row in records
        if row.get(pointer_key) is not None
    }


def locate_complete(
    index: OfficialBundleIndex,
    target_cabs: set[str],
    candidates: list[Path],
    role: str,
) -> None:
    """Locate CAB owners, including bundles whose compressed header hides the CAB string."""
    unresolved = target_cabs - set(index.cab_paths)
    if not unresolved:
        return
    try:
        index.locate(unresolved, candidates, role)
        return
    except RuntimeError:
        unresolved = target_cabs - set(index.cab_paths)

    # Most bundles expose the CAB in their outer bytes and take the fast path
    # above. A small number do not; load only the remaining tiny UI bundles and
    # verify the owning serialized-file identity rather than guessing by name.
    for candidate in candidates:
        path = candidate.resolve()
        try:
            _, objects = index.load(path)
        except Exception:
            continue
        for cab, _ in objects:
            if cab not in unresolved:
                continue
            previous = index.cab_paths.get(cab)
            if previous is not None and previous != path:
                raise RuntimeError(f"duplicate official CAB {cab}: {previous} and {path}")
            index.cab_paths[cab] = path
            unresolved.remove(cab)
        if not unresolved:
            return
    raise RuntimeError(f"could not locate official {role} CABs: {', '.join(sorted(unresolved))}")


def extract(
    decrypted_root: Path,
    unity_version: str = DEFAULT_UNITY_VERSION,
) -> dict:
    decrypted_root = decrypted_root.resolve()
    if not decrypted_root.is_dir():
        raise RuntimeError(f"decrypted root does not exist: {decrypted_root}")
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    index = OfficialBundleIndex(decrypted_root)

    prefabs = []
    images = []
    for kind, relative in PREFABS.items():
        prefab, rows = extract_prefab_images(index, decrypted_root, kind, relative)
        prefabs.append(prefab)
        images.extend(rows)
    images.sort(key=lambda row: (row["prefabKind"], int(row["imagePathId"])))

    ui_root = decrypted_root / "Common" / "CardNew" / "Common" / "UI"
    card_bundles = sorted(ui_root.rglob("*_bundles"), key=lambda path: path.as_posix())
    sprite_cabs = cab_set(images, "spritePointer")
    material_cabs = cab_set(images, "materialPointer")
    unresolved = (sprite_cabs | material_cabs) - set(index.cab_paths)
    if unresolved:
        locate_complete(index, unresolved, card_bundles, "UGUI Sprite/Material")

    sprite_identities = sorted(
        {row["spritePointer"]["identity"] for row in images if row["spritePointer"]}
    )
    material_identities = sorted(
        {row["materialPointer"]["identity"] for row in images if row["materialPointer"]}
    )
    sprites = [sprite_record(index, identity) for identity in sprite_identities]
    materials = [material_record(index, identity) for identity in material_identities]

    texture_cabs = cab_set(sprites, "texturePointer") | cab_set(sprites, "alphaTexturePointer")
    unresolved_textures = texture_cabs - set(index.cab_paths)
    if unresolved_textures:
        locate_complete(index, unresolved_textures, card_bundles, "UGUI Texture2D")
    texture_identities = sorted(
        {
            row[key]["identity"]
            for row in sprites
            for key in ("texturePointer", "alphaTexturePointer")
            if row.get(key)
        }
    )
    textures = [texture_record(index, identity) for identity in texture_identities]

    shader_root = decrypted_root / "Common" / "Shader"
    shader_bundles = sorted(shader_root.rglob("*_bundles"), key=lambda path: path.as_posix())
    shader_cabs = cab_set(materials, "shaderPointer")
    unresolved_shaders = shader_cabs - set(index.cab_paths)
    if unresolved_shaders:
        locate_complete(index, unresolved_shaders, shader_bundles, "UGUI Material Shader")
    shader_identities = sorted(row["shaderPointer"]["identity"] for row in materials)
    shaders = [shader_record(index, identity) for identity in shader_identities]

    evidence = {
        "prefabs": prefabs,
        "images": images,
        "sprites": sprites,
        "textures": textures,
        "materials": materials,
        "shaders": shaders,
    }
    return {
        "schema": SCHEMA,
        "schemaVersion": 1,
        "unityVersion": unity_version,
        "locator": {
            "cardBundleFiles": len(card_bundles),
            "shaderBundleFiles": len(shader_bundles),
            "scannedBundleFiles": index.scanned_bundle_files,
            "loadedBundleFiles": len(index.loaded),
        },
        "summary": {
            "prefabs": len(prefabs),
            "images": len(images),
            "nonnullImageSprites": sum(row["spritePointer"] is not None for row in images),
            "uniqueSprites": len(sprites),
            "uniqueTextures": len(textures),
            "uniqueMaterials": len(materials),
            "uniqueShaders": len(shaders),
            "atlasSprites": sum(row["atlasPointer"] is not None for row in sprites),
            "alphaTextures": sum(row["alphaTexturePointer"] is not None for row in sprites),
        },
        **evidence,
        "digests": {
            key: canonical_digest(value) for key, value in evidence.items()
        },
        "evidenceSha256": canonical_digest(evidence),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument(
        "--unity-version",
        default=os.environ.get("PCR_UNITY_VERSION", DEFAULT_UNITY_VERSION),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    result = extract(args.decrypted_root, args.unity_version)
    print(
        json.dumps(
            result,
            ensure_ascii=True,
            indent=2 if args.pretty else None,
            separators=None if args.pretty else (",", ":"),
        )
    )


if __name__ == "__main__":
    main()
