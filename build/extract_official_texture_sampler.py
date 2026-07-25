#!/usr/bin/env python3
"""Extract per-texture sampler evidence from official decrypted AssetBundles.

Reference scenes are used only to determine the texture URL set. Every sampler
field is read from an official Texture2D/Cubemap serialized object. Ambiguous
basenames are retained as explicit candidates; the extractor never uses a
first-match policy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import warnings

try:
    import UnityPy
    from UnityPy.enums import TextureFormat
    from UnityPy.export.Texture2DConverter import parse_image_data
except ImportError as exc:
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc


UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
DEFAULT_SCENES = (
    "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json",
    "scene.cPK_20_008900_02_HOUOUex_UR.json",
    "scene.cTR_20_000230_00_LEAF_SR.json",
    "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
)
SHARED_URL_PREFIX = "/game/Assets/Lettuce/_Data/"
FLAT_TEXTURE_PREFIX = "/game/Assets/Texture2D/"
TEXTURE_TYPES = {"Texture2D", "Cubemap"}
FILTER_NAMES = {0: "Point", 1: "Bilinear", 2: "Trilinear"}
WRAP_NAMES = {0: "Repeat", 1: "Clamp", 2: "Mirror", 3: "MirrorOnce"}
RGBA_FALLBACK_DIR = ".official-texture-mips"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_texture_urls(value: object, output: set[str]) -> None:
    if isinstance(value, dict):
        for child in value.values():
            collect_texture_urls(child, output)
    elif isinstance(value, list):
        for child in value:
            collect_texture_urls(child, output)
    elif (
        isinstance(value, str)
        and value.startswith("/game/")
        and PurePosixPath(value).suffix.lower() in {".png", ".jpg", ".jpeg"}
    ):
        output.add(value)


def as_int(value: object, default: int = 0) -> int:
    if value is None:
        return default
    return int(value)


def texture_format_name(value: int) -> str:
    try:
        return TextureFormat(value).name
    except ValueError:
        return f"Unknown({value})"


def mip_level_byte_length(texture_format: int, width: int, height: int, image_count: int) -> int:
    fmt = TextureFormat(texture_format)
    if fmt == TextureFormat.R8:
        return width * height * image_count
    if fmt == TextureFormat.RGB24:
        return width * height * 3 * image_count
    if fmt == TextureFormat.RGBA32:
        return width * height * 4 * image_count
    if fmt == TextureFormat.ETC_RGB4:
        blocks_x = max(1, (width + 3) // 4)
        blocks_y = max(1, (height + 3) // 4)
        return blocks_x * blocks_y * 8 * image_count
    if fmt.name.startswith("ASTC"):
        block_width, block_height = (int(item) for item in fmt.name.rsplit("_", 1)[1].split("x"))
        blocks_x = max(1, (width + block_width - 1) // block_width)
        blocks_y = max(1, (height + block_height - 1) // block_height)
        return blocks_x * blocks_y * 16 * image_count
    raise ValueError(f"unsupported official texture format for mip split: {fmt.name} ({texture_format})")


def split_mip_payload(data: object, obj: object, payload: bytes) -> list[dict]:
    levels = []
    offset = 0
    image_count = as_int(getattr(data, "m_ImageCount", 1), 1)
    for level in range(as_int(data.m_MipCount, 1)):
        width = max(1, as_int(data.m_Width) >> level)
        height = max(1, as_int(data.m_Height) >> level)
        length = mip_level_byte_length(as_int(data.m_TextureFormat), width, height, image_count)
        chunk = payload[offset : offset + length]
        if len(chunk) != length:
            raise ValueError(
                f"{data.m_Name}: mip {level} truncated at {offset}: expected {length}, got {len(chunk)}"
            )
        levels.append(
            {
                "level": level,
                "width": width,
                "height": height,
                "imageCount": image_count,
                "offset": offset,
                "length": length,
                "sha256": sha256_bytes(chunk),
            }
        )
        offset += length
    if offset != len(payload):
        raise ValueError(f"{data.m_Name}: mip payload consumed {offset}, stored {len(payload)}")
    return levels


def build_rgba8_fallback(data: object, obj: object, payload: bytes, levels: list[dict]) -> tuple[bytes, dict] | None:
    if obj.type.name != "Texture2D" or len(levels) <= 1:
        return None
    output = bytearray()
    fallback_levels = []
    texture_format = as_int(data.m_TextureFormat)
    for level in levels:
        chunk = payload[level["offset"] : level["offset"] + level["length"]]
        image = parse_image_data(
            chunk,
            level["width"],
            level["height"],
            texture_format,
            obj.version,
            obj.platform,
            getattr(data, "m_PlatformBlob", None),
            True,
        ).convert("RGBA")
        rgba = image.tobytes()
        expected = level["width"] * level["height"] * 4
        if len(rgba) != expected:
            raise ValueError(f"{data.m_Name}: mip {level['level']} RGBA length {len(rgba)} != {expected}")
        offset = len(output)
        output.extend(rgba)
        fallback_levels.append(
            {
                "level": level["level"],
                "width": level["width"],
                "height": level["height"],
                "offset": offset,
                "length": len(rgba),
                "sha256": sha256_bytes(rgba),
            }
        )
    raw = bytes(output)
    payload_sha = sha256_bytes(payload)
    return raw, {
        "encoding": "rgba8-mip-chain-v1",
        "url": f"/game/{RGBA_FALLBACK_DIR}/{payload_sha}.rgba8mips",
        "byteLength": len(raw),
        "sha256": sha256_bytes(raw),
        "levels": fallback_levels,
    }


def stream_data_record(tree: dict) -> dict:
    stream = tree.get("m_StreamData") or {}
    return {
        "path": str(stream.get("path", "")),
        "offset": as_int(stream.get("offset")),
        "size": as_int(stream.get("size")),
    }


def object_evidence(bundle: Path, decrypted_root: Path, obj: object, tree: dict) -> dict:
    settings = tree.get("m_TextureSettings") or {}
    filter_value = as_int(settings.get("m_FilterMode"), -1)
    wrap_u = as_int(settings.get("m_WrapU"), -1)
    wrap_v = as_int(settings.get("m_WrapV"), -1)
    wrap_w = as_int(settings.get("m_WrapW"), -1)
    data = obj.read()
    object_bytes = bytes(obj.get_raw_data())
    payload_bytes = bytes(data.get_image_data())
    mip_levels = split_mip_payload(data, obj, payload_bytes)
    rgba_fallback = build_rgba8_fallback(data, obj, payload_bytes, mip_levels)
    fallback_bytes, rgba_fallback_record = rgba_fallback if rgba_fallback else (None, None)
    payload_sha = sha256_bytes(payload_bytes)
    texture_format = as_int(tree.get("m_TextureFormat"), -1)
    color_space = as_int(tree.get("m_ColorSpace"), -1)
    result = {
        "bundle": bundle.relative_to(decrypted_root).as_posix(),
        "pathId": str(obj.path_id),
        "format": {
            "value": texture_format,
            "name": texture_format_name(texture_format),
        },
        "colorSpace": color_space,
        "identity": {
            "bundle": bundle.relative_to(decrypted_root).as_posix(),
            "bundleSha256": sha256_file(bundle),
            "cab": str(getattr(obj.assets_file, "name", "")),
            "pathId": str(obj.path_id),
            "class": obj.type.name,
            "objectSha256": sha256_bytes(object_bytes),
            "payloadSha256": payload_sha,
        },
        "serialized": {
            "name": tree.get("m_Name"),
            "width": as_int(tree.get("m_Width")),
            "height": as_int(tree.get("m_Height")),
            "textureFormat": texture_format,
            "textureFormatName": texture_format_name(texture_format),
            "colorSpace": color_space,
            "mipCount": as_int(tree.get("m_MipCount"), 1),
            "imageCount": as_int(tree.get("m_ImageCount"), 1),
            "textureDimension": as_int(tree.get("m_TextureDimension"), -1),
            "mipsStripped": as_int(tree.get("m_MipsStripped")),
            "streamingMipmaps": bool(tree.get("m_StreamingMipmaps", False)),
            "isPreProcessed": bool(tree.get("m_IsPreProcessed", False)),
            "forcedFallbackFormat": as_int(tree.get("m_ForcedFallbackFormat"), -1),
            "forcedFallbackFormatName": texture_format_name(as_int(tree.get("m_ForcedFallbackFormat"), -1)),
            "downscaleFallback": bool(tree.get("m_DownscaleFallback", False)),
            "isAlphaChannelOptional": bool(tree.get("m_IsAlphaChannelOptional", False)),
            "platformBlob": list(tree.get("m_PlatformBlob") or []),
        },
        "sampler": {
            "filterMode": filter_value,
            "filter": FILTER_NAMES.get(filter_value, f"Unknown({filter_value})"),
            "anisotropy": as_int(settings.get("m_Aniso")),
            "mipBias": float(settings.get("m_MipBias", 0.0)),
            "wrapUValue": wrap_u,
            "wrapU": WRAP_NAMES.get(wrap_u, f"Unknown({wrap_u})"),
            "wrapVValue": wrap_v,
            "wrapV": WRAP_NAMES.get(wrap_v, f"Unknown({wrap_v})"),
            "wrapWValue": wrap_w,
            "wrapW": WRAP_NAMES.get(wrap_w, f"Unknown({wrap_w})"),
        },
        "object": {
            "byteLength": len(object_bytes),
            "sha256": sha256_bytes(object_bytes),
        },
        "payload": {
            "byteLength": len(payload_bytes),
            "sha256": payload_sha,
            "streamData": stream_data_record(tree),
            "mipLevels": mip_levels,
        },
        "fallback": {
            "forcedFormat": as_int(tree.get("m_ForcedFallbackFormat"), -1),
            "forcedFormatName": texture_format_name(as_int(tree.get("m_ForcedFallbackFormat"), -1)),
            "downscale": bool(tree.get("m_DownscaleFallback", False)),
            "rgba8MipChain": rgba_fallback_record,
        },
    }
    if fallback_bytes is not None:
        result["_rgba8FallbackBytes"] = fallback_bytes
    return result


def sampler_fingerprint(candidate: dict) -> str:
    payload = {
        "sampler": candidate["sampler"],
        "serialized": candidate["serialized"],
        "payloadSha256": candidate["payload"]["sha256"],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


class OfficialObjectIndex:
    def __init__(self, decrypted_root: Path):
        self.decrypted_root = decrypted_root
        self._bundle_cache: dict[Path, list[tuple[object, dict]]] = {}
        self._filename_index: dict[str, list[Path]] = {}

    def load_bundle(self, bundle: Path) -> list[tuple[object, dict]]:
        bundle = bundle.resolve()
        if bundle not in self._bundle_cache:
            environment = UnityPy.load(str(bundle))
            found: list[tuple[object, dict]] = []
            for obj in environment.objects:
                if obj.type.name in TEXTURE_TYPES:
                    found.append((obj, obj.read_typetree()))
            self._bundle_cache[bundle] = found
        return self._bundle_cache[bundle]

    def filename_candidates(self, filename: str) -> list[Path]:
        target = filename.lower()
        if target not in self._filename_index:
            matches = []
            scan_root = self.decrypted_root / "Common" / "CardNew"
            for directory, _, files in os.walk(scan_root):
                for name in files:
                    if name.lower() == target:
                        matches.append(Path(directory) / name)
            self._filename_index[target] = sorted(matches)
        return self._filename_index[target]

    def evidence_from_bundle(self, bundle: Path, object_name: str) -> list[dict]:
        if not bundle.is_file():
            return []
        candidates = []
        for obj, tree in self.load_bundle(bundle):
            if tree.get("m_Name") == object_name:
                evidence = object_evidence(bundle, self.decrypted_root, obj, tree)
                candidates.append(evidence)
        return candidates


def shared_bundle_for_url(url: str, decrypted_root: Path) -> Path:
    relative = PurePosixPath(url.removeprefix(SHARED_URL_PREFIX))
    return decrypted_root.joinpath(*relative.parts).with_name(relative.name + "_bundles")


def shared_bundle_candidates(url: str, object_name: str, decrypted_root: Path) -> list[Path]:
    expected = shared_bundle_for_url(url, decrypted_root)
    if expected.is_file():
        return [expected]
    # AssetRipper exports Cubemap faces as PNG even when the official source
    # object retains another extension (for example L_001_ENV.tif_bundles).
    # Keep the original directory and stem as identity constraints.
    return sorted(expected.parent.glob(f"{object_name}.*_bundles"))


def card_prefab_bundle(card_id: str, decrypted_root: Path) -> Path:
    return (
        decrypted_root
        / "Common"
        / "CardNew"
        / "Face"
        / card_id
        / "L"
        / "Prefabs"
        / f"{card_id}_L.prefab_bundles"
    )


def resolve_texture(
    url: str,
    contexts: list[dict],
    index: OfficialObjectIndex,
) -> dict:
    object_name = PurePosixPath(url).stem
    bundles: set[Path] = set()
    resolution_basis = ""

    if url.startswith(SHARED_URL_PREFIX):
        bundles.update(shared_bundle_candidates(url, object_name, index.decrypted_root))
        resolution_basis = "scene URL mirrors the decrypted shared-asset path; exported extension may differ for Cubemap"
    elif url.startswith(FLAT_TEXTURE_PREFIX):
        matching_cards = sorted(
            {context["cardId"] for context in contexts if object_name.startswith(context["cardId"] + "_L_")}
        )
        if matching_cards:
            bundles.update(card_prefab_bundle(card_id, index.decrypted_root) for card_id in matching_cards)
            resolution_basis = "card-scoped texture object inside the official L prefab bundle"
        else:
            bundles.update(index.filename_candidates(PurePosixPath(url).name + "_bundles"))
            resolution_basis = "all exact official bundle filenames retained; no basename first-win"

    candidates: list[dict] = []
    missing_bundles = []
    for bundle in sorted(bundles):
        if not bundle.is_file():
            missing_bundles.append(str(bundle))
            continue
        candidates.extend(index.evidence_from_bundle(bundle, object_name))

    candidates.sort(
        key=lambda item: (
            item["identity"]["bundle"],
            item["identity"]["cab"],
            int(item["identity"]["pathId"]),
        )
    )
    fingerprints = sorted({sampler_fingerprint(candidate) for candidate in candidates})
    if len(candidates) == 1:
        status = "exact"
        selected = candidates[0]
    elif len(candidates) > 1 and len(fingerprints) == 1:
        status = "payload-equivalent-candidates"
        selected = candidates[0]
    elif len(candidates) > 1:
        status = "ambiguous"
        selected = None
    else:
        status = "missing"
        selected = None

    return {
        "url": url,
        "objectName": object_name,
        "resolution": status,
        "resolutionBasis": resolution_basis,
        "contexts": contexts,
        "bundle": selected["bundle"] if selected else None,
        "pathId": selected["pathId"] if selected else None,
        "format": selected["format"] if selected else None,
        "colorSpace": selected["colorSpace"] if selected else None,
        "identity": selected["identity"] if selected else None,
        "sampler": selected["sampler"] if selected else None,
        "serialized": selected["serialized"] if selected else None,
        "object": selected["object"] if selected else None,
        "payload": selected["payload"] if selected else None,
        "fallback": selected["fallback"] if selected else None,
        "candidates": candidates,
        "missingBundles": missing_bundles,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--scene", action="append", type=Path, default=[])
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--emit-rgba-fallback-root", type=Path)
    parser.add_argument("--no-json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    decrypted_root = args.decrypted_root.resolve()
    scene_paths = [path.resolve() for path in args.scene]
    if not scene_paths:
        scene_paths = [(ROOT / "public" / name).resolve() for name in DEFAULT_SCENES]
    if not decrypted_root.is_dir():
        raise SystemExit(f"decrypted root does not exist: {decrypted_root}")

    references: dict[str, list[dict]] = {}
    scenes = []
    for scene_path in scene_paths:
        with scene_path.open("r", encoding="utf-8") as handle:
            scene = json.load(handle)
        urls: set[str] = set()
        collect_texture_urls(scene, urls)
        card_id = str(scene.get("card", {}).get("id", ""))
        rarity = str(scene.get("card", {}).get("rarityToken", ""))
        scene_record = {
            "file": scene_path.name,
            "sha256": sha256_file(scene_path),
            "cardId": card_id,
            "rarity": rarity,
            "textureUrls": sorted(urls),
        }
        scenes.append(scene_record)
        for url in urls:
            references.setdefault(url, []).append(
                {"scene": scene_path.name, "cardId": card_id, "rarity": rarity}
            )

    index = OfficialObjectIndex(decrypted_root)
    textures = {
        url: resolve_texture(
            url,
            sorted(references[url], key=lambda item: (item["scene"], item["cardId"])),
            index,
        )
        for url in sorted(references)
    }
    unresolved = [url for url, item in textures.items() if item["resolution"] in {"missing", "ambiguous"}]
    equivalent = [url for url, item in textures.items() if item["resolution"] == "payload-equivalent-candidates"]

    emitted_files: dict[str, bytes] = {}
    for item in textures.values():
        for candidate in item["candidates"]:
            fallback_bytes = candidate.pop("_rgba8FallbackBytes", None)
            chain = candidate.get("fallback", {}).get("rgba8MipChain")
            if fallback_bytes is not None and chain:
                emitted_files.setdefault(chain["url"], fallback_bytes)
    if args.emit_rgba_fallback_root:
        output_root = args.emit_rgba_fallback_root.resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        for stale in output_root.glob("*.rgba8mips"):
            stale.unlink()
        for url, fallback_bytes in sorted(emitted_files.items()):
            destination = output_root / PurePosixPath(url).name
            destination.write_bytes(fallback_bytes)

    output = {
        "schemaVersion": 1,
        "authority": "official decrypted Unity Texture2D/Cubemap serialized objects",
        "referenceSetAuthority": "scene files select URLs only; they do not supply sampler fields",
        "source": {
            "decryptedRoot": "PCR_OFFICIAL_DECRYPTED_ROOT",
            "extractor": Path(__file__).name,
            "extractorSha256": sha256_file(Path(__file__)),
            "unityVersionFallback": UnityPy.config.FALLBACK_UNITY_VERSION,
        },
        "scenes": scenes,
        "textures": textures,
        "summary": {
            "sceneCount": len(scenes),
            "uniqueTextureCount": len(textures),
            "exactCount": sum(item["resolution"] == "exact" for item in textures.values()),
            "equivalentCandidateCount": len(equivalent),
            "unresolvedCount": len(unresolved),
            "equivalentCandidates": equivalent,
            "unresolved": unresolved,
            "rgba8FallbackFileCount": len(emitted_files),
            "rgba8FallbackByteLength": sum(len(value) for value in emitted_files.values()),
        },
    }
    if not args.no_json:
        json.dump(output, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None, sort_keys=True)
        sys.stdout.write("\n")
    elif args.emit_rgba_fallback_root:
        print(
            f"emitted {len(emitted_files)} official RGBA8 mip chains "
            f"({sum(len(value) for value in emitted_files.values())} bytes) "
            f"to {args.emit_rgba_fallback_root}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
