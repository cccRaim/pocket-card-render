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


def object_evidence(bundle: Path, decrypted_root: Path, obj: object, tree: dict) -> dict:
    settings = tree.get("m_TextureSettings") or {}
    filter_value = as_int(settings.get("m_FilterMode"), -1)
    wrap_u = as_int(settings.get("m_WrapU"), -1)
    wrap_v = as_int(settings.get("m_WrapV"), -1)
    wrap_w = as_int(settings.get("m_WrapW"), -1)
    return {
        "identity": {
            "bundle": bundle.relative_to(decrypted_root).as_posix(),
            "bundleSha256": sha256_file(bundle),
            "cab": str(getattr(obj.assets_file, "name", "")),
            "pathId": str(obj.path_id),
            "class": obj.type.name,
        },
        "serialized": {
            "name": tree.get("m_Name"),
            "width": as_int(tree.get("m_Width")),
            "height": as_int(tree.get("m_Height")),
            "textureFormat": as_int(tree.get("m_TextureFormat"), -1),
            "colorSpace": as_int(tree.get("m_ColorSpace"), -1),
            "mipCount": as_int(tree.get("m_MipCount"), 1),
            "mipsStripped": as_int(tree.get("m_MipsStripped")),
            "streamingMipmaps": bool(tree.get("m_StreamingMipmaps", False)),
            "isPreProcessed": bool(tree.get("m_IsPreProcessed", False)),
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
    }


def sampler_fingerprint(candidate: dict) -> str:
    payload = {
        "sampler": candidate["sampler"],
        "serialized": candidate["serialized"],
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
        sampler = candidates[0]["sampler"]
        serialized = candidates[0]["serialized"]
    elif len(candidates) > 1 and len(fingerprints) == 1:
        status = "equivalent-candidates"
        sampler = candidates[0]["sampler"]
        serialized = candidates[0]["serialized"]
    elif len(candidates) > 1:
        status = "ambiguous"
        sampler = None
        serialized = None
    else:
        status = "missing"
        sampler = None
        serialized = None

    return {
        "url": url,
        "objectName": object_name,
        "resolution": status,
        "resolutionBasis": resolution_basis,
        "contexts": contexts,
        "sampler": sampler,
        "serialized": serialized,
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
    equivalent = [url for url, item in textures.items() if item["resolution"] == "equivalent-candidates"]

    output = {
        "schemaVersion": 1,
        "authority": "official decrypted Unity Texture2D/Cubemap serialized objects",
        "referenceSetAuthority": "scene files select URLs only; they do not supply sampler fields",
        "source": {
            "decryptedRoot": str(decrypted_root),
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
        },
    }
    json.dump(output, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
