#!/usr/bin/env python3
"""Decode canonical Material sort inputs directly from official Unity bundles.

The canonical scenes provide only the CAB:pathID identities to inspect.  All
sort inputs and Shader keyword spaces are decoded again from decrypted Face,
CardNew/Common, and Common/Shader bundles; no recipe data is consumed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import warnings

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - exercised only on an unprepared host
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
UNITY_VERSION = "2022.3.62f2"
SCHEMA = "pocket-card-render/official-material-sort-inputs@1"
CANONICAL_CARDS = (
    "cPK_10_000040_00_FUSHIGIBANAex_RR",
    "cPK_20_008900_02_HOUOUex_UR",
    "cTR_20_000230_00_LEAF_SR",
    "cTR_20_000670_00_IIBUINOBAKKU_UR",
)
IDENTITY_RE = re.compile(r"^(CAB-[0-9a-f]{32}):(-?[0-9]+)$")
CAB_BYTES_RE = re.compile(rb"CAB-[0-9a-f]{32}")

UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256_bytes(encoded)


def parse_identity(value: object, label: str) -> tuple[str, int, str]:
    if not isinstance(value, str):
        raise RuntimeError(f"{label} must be a CAB:pathID string")
    match = IDENTITY_RE.fullmatch(value)
    if match is None:
        raise RuntimeError(f"{label} has invalid official identity {value!r}")
    cab = match.group(1)
    path_id = int(match.group(2))
    return cab, path_id, f"{cab}:{path_id}"


def require_list(tree: dict, field: str, label: str) -> list:
    if field not in tree:
        raise RuntimeError(f"{label} is missing serialized field {field}")
    value = tree[field]
    if not isinstance(value, (list, tuple)):
        raise RuntimeError(f"{label}.{field} is not an array")
    return list(value)


def require_field(tree: dict, field: str, label: str) -> object:
    if field not in tree:
        raise RuntimeError(f"{label} is missing serialized field {field}")
    return tree[field]


class OfficialBundleIndex:
    """Locate requested CABs while loading only their owning bundle files."""

    def __init__(self, decrypted_root: Path):
        self.decrypted_root = decrypted_root.resolve()
        self.loaded: dict[Path, tuple[object, dict[tuple[str, int], object]]] = {}
        self.cab_paths: dict[str, Path] = {}
        self.bundle_hashes: dict[Path, str] = {}
        self.scanned_bundle_files = 0

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.decrypted_root).as_posix()

    def load(self, path: Path) -> tuple[object, dict[tuple[str, int], object]]:
        path = path.resolve()
        cached = self.loaded.get(path)
        if cached is not None:
            return cached
        environment = UnityPy.load(str(path))
        objects = {
            (str(obj.assets_file.name), int(obj.path_id)): obj
            for obj in environment.objects
        }
        if not objects:
            raise RuntimeError(f"official bundle has no serialized objects: {path}")
        self.loaded[path] = (environment, objects)
        return environment, objects

    def locate(self, target_cabs: set[str], candidates: list[Path], role: str) -> None:
        unresolved = set(target_cabs)
        seen_paths: set[Path] = set()
        for candidate in candidates:
            path = candidate.resolve()
            if path in seen_paths:
                continue
            seen_paths.add(path)
            if not path.is_file():
                raise RuntimeError(f"missing official {role} bundle: {path}")
            self.scanned_bundle_files += 1
            mentions = {
                match.group(0).decode("ascii")
                for match in CAB_BYTES_RE.finditer(path.read_bytes())
            }
            if not (mentions & unresolved):
                continue

            _, objects = self.load(path)
            owned_cabs = {cab for cab, _ in objects}
            for cab in sorted(owned_cabs & unresolved):
                previous = self.cab_paths.get(cab)
                if previous is not None and previous != path:
                    raise RuntimeError(
                        f"duplicate official CAB {cab}: {previous} and {path}"
                    )
                self.cab_paths[cab] = path
                unresolved.remove(cab)
            if not unresolved:
                break

        if unresolved:
            missing = ", ".join(sorted(unresolved))
            raise RuntimeError(
                f"could not locate {role} CABs under official bundle roots: {missing}"
            )

    def object(self, identity: str, expected_type: str) -> tuple[object, Path]:
        cab, path_id, canonical = parse_identity(identity, expected_type)
        bundle = self.cab_paths.get(cab)
        if bundle is None:
            raise RuntimeError(f"official CAB was not indexed for {canonical}")
        obj = self.load(bundle)[1].get((cab, path_id))
        if obj is None:
            raise RuntimeError(f"official object is absent from its CAB: {canonical}")
        if obj.type.name != expected_type:
            raise RuntimeError(
                f"official object {canonical} is {obj.type.name}, expected {expected_type}"
            )
        return obj, bundle

    def bundle_sha256(self, path: Path) -> str:
        path = path.resolve()
        if path not in self.bundle_hashes:
            self.bundle_hashes[path] = sha256_file(path)
        return self.bundle_hashes[path]


def scene_targets() -> tuple[list[dict], list[dict]]:
    scenes: list[dict] = []
    rows: list[dict] = []
    for card_id in CANONICAL_CARDS:
        scene_file = f"scene.{card_id}.json"
        scene_path = ROOT / "public" / scene_file
        if not scene_path.is_file():
            raise RuntimeError(f"canonical scene is missing: {scene_path}")
        scene = json.loads(scene_path.read_text(encoding="utf-8-sig"))
        if (scene.get("card") or {}).get("id") != card_id:
            raise RuntimeError(f"{scene_file}: card.id does not match its canonical filename")
        scene_materials = scene.get("materials")
        if not isinstance(scene_materials, dict):
            raise RuntimeError(f"{scene_file}: materials must be an object")

        for material_name in sorted(scene_materials):
            material = scene_materials[material_name]
            official = material.get("official") if isinstance(material, dict) else None
            if not isinstance(official, dict):
                raise RuntimeError(f"{scene_file}:{material_name}: official identity block missing")
            _, _, material_identity = parse_identity(
                official.get("material"), f"{scene_file}:{material_name}.official.material"
            )
            _, _, shader_identity = parse_identity(
                official.get("shader"), f"{scene_file}:{material_name}.official.shader"
            )
            rows.append(
                {
                    "sceneFile": scene_file,
                    "cardId": card_id,
                    "materialName": material_name,
                    "materialIdentity": material_identity,
                    "sceneShaderIdentity": shader_identity,
                }
            )
        scenes.append(
            {
                "sceneFile": scene_file,
                "cardId": card_id,
                "materialRows": len(scene_materials),
            }
        )
    return scenes, rows


def pptr_record(owner: object, pointer: object, label: str) -> dict:
    if not isinstance(pointer, dict):
        raise RuntimeError(f"{label} is not a serialized PPtr")
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if path_id == 0:
        raise RuntimeError(f"{label} is a null PPtr")
    source_cab = str(owner.assets_file.name)
    if file_id == 0:
        target_cab = source_cab
    else:
        externals = owner.assets_file.externals
        if file_id < 1 or file_id > len(externals):
            raise RuntimeError(f"{label} file ID {file_id} is outside the external table")
        target_cab = str(externals[file_id - 1].name)
        if not re.fullmatch(r"CAB-[0-9a-f]{32}", target_cab):
            raise RuntimeError(f"{label} external does not name an official CAB: {target_cab}")
    return {
        "sourceCab": source_cab,
        "fileId": file_id,
        "pathId": str(path_id),
        "targetCab": target_cab,
        "identity": f"{target_cab}:{path_id}",
    }


def material_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = index.object(identity, "Material")
    tree = obj.read_typetree()
    label = f"Material {identity}"
    raw = bytes(obj.get_raw_data())
    valid_keywords = [str(value) for value in require_list(tree, "m_ValidKeywords", label)]
    invalid_keywords = [str(value) for value in require_list(tree, "m_InvalidKeywords", label)]
    shader_pointer = pptr_record(
        obj,
        require_field(tree, "m_Shader", label),
        f"{label}.m_Shader",
    )
    return {
        "identity": identity,
        "name": str(tree.get("m_Name") or ""),
        "sourceBundle": index.relative(bundle),
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "customRenderQueue": int(require_field(tree, "m_CustomRenderQueue", label)),
        "enableInstancingVariants": bool(
            require_field(tree, "m_EnableInstancingVariants", label)
        ),
        "validKeywords": valid_keywords,
        "invalidKeywords": invalid_keywords,
        "shaderPointer": shader_pointer,
        "shaderIdentity": shader_pointer["identity"],
    }


def shader_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = index.object(identity, "Shader")
    tree = obj.read_typetree()
    label = f"Shader {identity}"
    parsed = tree.get("m_ParsedForm")
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{label} is missing serialized m_ParsedForm")
    keyword_names = [str(value) for value in require_list(parsed, "m_KeywordNames", label)]
    keyword_flags = [int(value) for value in require_list(parsed, "m_KeywordFlags", label)]
    if len(keyword_names) != len(keyword_flags):
        raise RuntimeError(f"{label} keyword names/flags length mismatch")
    raw = bytes(obj.get_raw_data())
    return {
        "identity": identity,
        "name": str(parsed.get("m_Name") or tree.get("m_Name") or ""),
        "sourceBundle": index.relative(bundle),
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "keywordNames": keyword_names,
        "keywordFlags": keyword_flags,
    }


def source_bundle_records(
    index: OfficialBundleIndex,
    material_cabs: set[str],
    shader_cabs: set[str],
) -> list[dict]:
    records = []
    for cab in sorted(material_cabs | shader_cabs):
        path = index.cab_paths[cab]
        roles = []
        if cab in material_cabs:
            roles.append("Material")
        if cab in shader_cabs:
            roles.append("Shader")
        records.append(
            {
                "cab": cab,
                "roles": roles,
                "relativePath": index.relative(path),
                "byteSize": path.stat().st_size,
                "sha256": index.bundle_sha256(path),
            }
        )
    return records


def extract(decrypted_root: Path) -> dict:
    decrypted_root = decrypted_root.resolve()
    if not decrypted_root.is_dir():
        raise RuntimeError(f"decrypted root does not exist: {decrypted_root}")
    scenes, target_rows = scene_targets()

    material_identities = sorted({row["materialIdentity"] for row in target_rows})
    scene_shader_identities = sorted({row["sceneShaderIdentity"] for row in target_rows})
    material_cabs = {parse_identity(value, "Material")[0] for value in material_identities}
    scene_shader_cabs = {
        parse_identity(value, "Shader")[0] for value in scene_shader_identities
    }

    common_root = decrypted_root / "Common" / "CardNew" / "Common"
    shader_root = decrypted_root / "Common" / "Shader"
    if not common_root.is_dir() or not shader_root.is_dir():
        raise RuntimeError("official CardNew/Common or Common/Shader bundle root is missing")
    common_bundles = sorted(common_root.rglob("*_bundles"), key=lambda path: path.as_posix())
    face_bundles = [
        decrypted_root
        / "Common"
        / "CardNew"
        / "Face"
        / card_id
        / "L"
        / "Prefabs"
        / f"{card_id}_L.prefab_bundles"
        for card_id in CANONICAL_CARDS
    ]
    shader_bundles = sorted(shader_root.rglob("*_bundles"), key=lambda path: path.as_posix())

    index = OfficialBundleIndex(decrypted_root)
    # Common precedes Face so shared Material CAB references in a prefab never
    # cause that prefab to be loaded merely as an external-reference candidate.
    index.locate(material_cabs, common_bundles + face_bundles, "Material")
    index.locate(scene_shader_cabs, shader_bundles, "Shader")

    materials = [material_record(index, identity) for identity in material_identities]
    material_by_identity = {record["identity"]: record for record in materials}
    actual_shader_identities = sorted(
        {record["shaderIdentity"] for record in materials}
    )
    actual_shader_cabs = {
        parse_identity(identity, "Shader")[0] for identity in actual_shader_identities
    }
    unresolved_actual_cabs = actual_shader_cabs - set(index.cab_paths)
    if unresolved_actual_cabs:
        index.locate(unresolved_actual_cabs, shader_bundles, "Material.m_Shader")
    shaders = [shader_record(index, identity) for identity in actual_shader_identities]

    rows = []
    for target in target_rows:
        material = material_by_identity[target["materialIdentity"]]
        rows.append(
            {
                "sceneFile": target["sceneFile"],
                "cardId": target["cardId"],
                "materialName": target["materialName"],
                "materialIdentity": material["identity"],
                "shaderIdentity": material["shaderIdentity"],
            }
        )

    source_bundles = source_bundle_records(
        index,
        material_cabs,
        actual_shader_cabs,
    )
    evidence = {
        "sourceBundles": source_bundles,
        "rows": rows,
        "materials": materials,
        "shaders": shaders,
    }
    digests = {
        "sourceBundlesSha256": canonical_digest(source_bundles),
        "rowsSha256": canonical_digest(rows),
        "materialsSha256": canonical_digest(materials),
        "shadersSha256": canonical_digest(shaders),
        "evidenceSha256": canonical_digest(evidence),
    }
    return {
        "schema": SCHEMA,
        "schemaVersion": 1,
        "unityVersion": UNITY_VERSION,
        "canonicalScenes": scenes,
        "locator": {
            "materialBundleFiles": len(common_bundles) + len(face_bundles),
            "shaderBundleFiles": len(shader_bundles),
            "scannedBundleFiles": index.scanned_bundle_files,
            "loadedBundleFiles": len(index.loaded),
        },
        "summary": {
            "sceneRows": len(rows),
            "uniqueMaterials": len(materials),
            "uniqueShaders": len(shaders),
            "sourceBundles": len(source_bundles),
        },
        **evidence,
        "digests": digests,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
        help="masterdata_decoder .output/decrypted root",
    )
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON evidence")
    args = parser.parse_args()
    output = extract(args.decrypted_root)
    if args.pretty:
        print(json.dumps(output, ensure_ascii=True, indent=2))
    else:
        print(json.dumps(output, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
