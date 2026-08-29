#!/usr/bin/env python3
"""Extract the official per-card text design, font-group and DynamicUI contract."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import warnings

import UnityPy

from official_sample import load_official_sample


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
DEFAULT_MASTERDATA_ROOT = Path(
    "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/"
    "ptcgp-masterdata/MasterData"
)
DEFAULT_IL2CPP = (
    ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "libil2cpp.so"
)

CARD_ROOT = Path("Common/CardNew/Face")
DESIGN_ROOT = Path("Common/CardNew/Template/L/Settings/DesignSettings")
FONT_CONDITION_ROOT = Path(
    "Common/CardNew/Template/L/Settings/FontGroupConditions"
)
FONT_GROUP_ROOT = Path("Common/CardNew/Template/L/Settings/FontGroupSettings")
UI_PREFABS = (
    Path("Common/CardNew/System/Prefabs/PokemonCardUI.prefab_bundles"),
    Path("Common/CardNew/System/Prefabs/TrainersCardUI.prefab_bundles"),
)

CARD_SETTING_FIELDS = (
    "_id",
    "_name",
    "_rarity",
    "_cardType",
    "_stageType",
    "_energyType",
)
KNOWN_FONT_CONDITION_BITS = 1
CAB_PATTERN = re.compile(r"CAB-[0-9a-fA-F]+")
NATIVE_PRODUCERS = (
    (
        "fontGroupSelection",
        "Lettuce.Infrastructure.Card.Core.FontGroupConditions.GetFontGroup",
        0x4448838,
        0x4448928,
        "799d93755ea6ad879250b437ad62d6776634e1644ca099548389949cc68ad648",
    ),
    (
        "dynamicUIControllerApply",
        "Lettuce.Infrastructure.Card.Core.CardDynamicUIView.Apply",
        0x441EEA0,
        0x441EF58,
        "b13ff59db86f766dba9da9f0af9aae091fd923d2c50d57bff383090c7b5e5936",
    ),
    (
        "dynamicUILabelDispatch",
        "Lettuce.Infrastructure.Card.Core.CardDynamicUIViewExtensions.Apply",
        0x441EF60,
        0x441F290,
        "e8fcd8943bff6bb69e882c201507460482790db6b13e21b50a1f767b6eb62a54",
    ),
)

warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_sha256(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256(payload)


def elf_load_segments(payload: bytes) -> list[tuple[int, int, int]]:
    if payload[:4] != b"\x7fELF" or payload[4] != 2 or payload[5] != 1:
        raise ValueError("official libil2cpp is not little-endian ELF64")
    program_offset = int.from_bytes(payload[32:40], "little")
    entry_size = int.from_bytes(payload[54:56], "little")
    entry_count = int.from_bytes(payload[56:58], "little")
    segments = []
    for index in range(entry_count):
        cursor = program_offset + index * entry_size
        if int.from_bytes(payload[cursor:cursor + 4], "little") != 1:
            continue
        segments.append((
            int.from_bytes(payload[cursor + 16:cursor + 24], "little"),
            int.from_bytes(payload[cursor + 8:cursor + 16], "little"),
            int.from_bytes(payload[cursor + 32:cursor + 40], "little"),
        ))
    return segments


def elf_range(
    payload: bytes,
    segments: list[tuple[int, int, int]],
    start: int,
    end: int,
) -> bytes:
    for virtual_address, file_offset, file_size in segments:
        if start >= virtual_address and end <= virtual_address + file_size:
            offset = file_offset + start - virtual_address
            return payload[offset:offset + end - start]
    raise ValueError(f"RVA {start:#x}..{end:#x} is not file-backed")


def native_producer_contract(sample: dict) -> dict:
    path = Path(os.environ.get("PCR_IL2CPP", DEFAULT_IL2CPP)).resolve()
    payload = path.read_bytes()
    expected = sample["artifacts"]["libil2cpp"]
    if len(payload) != expected["byteLength"] or sha256(payload) != expected["sha256"]:
        raise ValueError("libil2cpp does not match the selected official sample")
    segments = elf_load_segments(payload)
    result = {}
    for key, name, start, end, expected_hash in NATIVE_PRODUCERS:
        body = elf_range(payload, segments, start, end)
        actual_hash = sha256(body)
        if actual_hash != expected_hash:
            raise ValueError(
                f"{name} method hash {actual_hash} does not match {expected_hash}"
            )
        result[key] = {
            "name": name,
            "startRva": f"0x{start:x}",
            "endRva": f"0x{end:x}",
            "byteSize": len(body),
            "sha256": actual_hash,
        }
    return result


def logical_path(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def normalized_cab(value: str) -> str:
    return value.lower()


def external_cab(value: str) -> str:
    matches = CAB_PATTERN.findall(value or "")
    if not matches:
        raise ValueError(f"external pointer is not CAB-addressed: {value!r}")
    return normalized_cab(matches[-1])


def pointer_key(obj: object, pointer: object) -> tuple[str | None, int]:
    if not isinstance(pointer, dict):
        raise TypeError(f"invalid PPtr value: {pointer!r}")
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if path_id == 0:
        return (None, 0)
    if file_id == 0:
        return (normalized_cab(obj.assets_file.name), path_id)
    externals = obj.assets_file.externals
    if file_id < 1 or file_id > len(externals):
        raise ValueError(
            f"PPtr fileId {file_id} exceeds {len(externals)} externals "
            f"for {obj.assets_file.name}:{obj.path_id}"
        )
    return (external_cab(externals[file_id - 1].path), path_id)


def serialized_identity(key: tuple[str | None, int]) -> dict:
    cab, path_id = key
    return {"cab": cab, "pathId": str(path_id)}


def bundle_identity(decrypted_root: Path, path: Path) -> dict:
    payload = path.read_bytes()
    return {
        "source": logical_path(decrypted_root, path),
        "byteSize": len(payload),
        "sha256": sha256(payload),
    }


def load_bundle_index(paths: list[Path]) -> tuple[dict, list]:
    index = {}
    environments = []
    for path in sorted(paths):
        environment = UnityPy.load(str(path))
        environments.append(environment)
        for obj in environment.objects:
            key = (normalized_cab(obj.assets_file.name), int(obj.path_id))
            if key in index:
                previous = index[key][0]
                raise ValueError(
                    f"duplicate CAB:pathId {key} in {previous} and {path}"
                )
            index[key] = (path, obj)
    return index, environments


def asset_paths(root: Path, suffix: str) -> list[Path]:
    return sorted(
        path
        for path in root.rglob(f"*{suffix}")
        if path.is_file()
    )


def mono_tree(obj: object) -> dict | None:
    if obj.type.name != "MonoBehaviour":
        return None
    try:
        return obj.read_typetree()
    except Exception:
        return None


def object_contract(
    decrypted_root: Path,
    path: Path,
    obj: object,
    name: str,
) -> dict:
    return {
        "name": name,
        "identity": serialized_identity(
            (normalized_cab(obj.assets_file.name), int(obj.path_id))
        ),
        "objectSha256": sha256(obj.get_raw_data()),
        "bundle": bundle_identity(decrypted_root, path),
    }


def build_font_groups(
    decrypted_root: Path,
) -> tuple[dict, dict, list]:
    group_paths = asset_paths(decrypted_root / FONT_GROUP_ROOT, ".asset_bundles")
    group_index, group_environments = load_bundle_index(group_paths)
    groups_by_key = {}
    groups = {}
    for key, (path, obj) in group_index.items():
        tree = mono_tree(obj)
        if tree is None or "_fonts" not in tree or "_default" not in tree:
            continue
        name = str(tree.get("m_Name", ""))
        if not name:
            raise ValueError(f"unnamed FontGroupSettings at {key}")
        if name in groups:
            raise ValueError(f"duplicate FontGroupSettings name {name}")
        contract = object_contract(decrypted_root, path, obj, name)
        img_tag_font_type = int(tree.get("_imgTagFontType", 0))
        if img_tag_font_type not in (1, 2, 3, 4):
            raise ValueError(
                f"{name} has unsupported ImgTagFontType {img_tag_font_type}"
            )
        contract["imgTagFontType"] = img_tag_font_type
        groups[name] = contract
        groups_by_key[key] = contract
    return groups, groups_by_key, group_environments


def build_font_conditions(
    decrypted_root: Path,
    groups_by_key: dict,
) -> tuple[dict, dict, list]:
    condition_paths = asset_paths(
        decrypted_root / FONT_CONDITION_ROOT,
        ".asset_bundles",
    )
    condition_index, environments = load_bundle_index(condition_paths)
    conditions_by_key = {}
    conditions = {}
    for key, (path, obj) in condition_index.items():
        tree = mono_tree(obj)
        if tree is None or "_conditions" not in tree or "_default" not in tree:
            continue
        name = str(tree.get("m_Name", ""))
        if not name:
            raise ValueError(f"unnamed FontGroupConditions at {key}")
        if name in conditions:
            raise ValueError(f"duplicate FontGroupConditions name {name}")
        default_key = pointer_key(obj, tree["_default"])
        default_group = groups_by_key.get(default_key)
        if default_group is None:
            raise ValueError(
                f"{name} default FontGroupSettings is unresolved: {default_key}"
            )
        entries = []
        for index, condition in enumerate(tree.get("_conditions", [])):
            group_key = pointer_key(obj, condition.get("_font"))
            group = groups_by_key.get(group_key)
            if group is None:
                raise ValueError(
                    f"{name} condition {index} FontGroupSettings is unresolved: "
                    f"{group_key}"
                )
            condition_type = int(condition.get("_conditionType", 0))
            if condition_type != -1 and condition_type & ~KNOWN_FONT_CONDITION_BITS:
                raise ValueError(
                    f"{name} condition {index} has unknown bits "
                    f"{condition_type:#x}"
                )
            entries.append({
                "conditionType": condition_type,
                "energyType": int(condition.get("_energyType", 0)),
                "fontGroup": group["name"],
                "fontGroupIdentity": group["identity"],
            })
        contract = {
            **object_contract(decrypted_root, path, obj, name),
            "defaultFontGroup": default_group["name"],
            "defaultFontGroupIdentity": default_group["identity"],
            "conditions": entries,
        }
        conditions[name] = contract
        conditions_by_key[key] = contract
    return conditions, conditions_by_key, environments


def game_object_paths(index: dict) -> dict:
    game_objects = {}
    transforms = {}
    transform_for_game_object = {}
    for key, (_, obj) in index.items():
        if obj.type.name == "GameObject":
            game_objects[key] = obj
        elif obj.type.name in ("Transform", "RectTransform"):
            tree = obj.read_typetree()
            game_key = pointer_key(obj, tree.get("m_GameObject"))
            transforms[key] = (obj, tree)
            transform_for_game_object[game_key] = key

    cache = {}

    def resolve(game_key: tuple[str | None, int], visiting: set) -> str:
        if game_key in cache:
            return cache[game_key]
        if game_key in visiting:
            raise ValueError(f"cyclic GameObject hierarchy at {game_key}")
        game_obj = game_objects.get(game_key)
        if game_obj is None:
            raise ValueError(f"GameObject {game_key} is unresolved")
        tree = game_obj.read_typetree()
        name = str(tree.get("m_Name", ""))
        transform_key = transform_for_game_object.get(game_key)
        if transform_key is None:
            result = f"/{name}"
        else:
            transform_obj, transform_tree = transforms[transform_key]
            father_key = pointer_key(transform_obj, transform_tree.get("m_Father"))
            if father_key[1] == 0:
                result = f"/{name}"
            else:
                father = transforms.get(father_key)
                if father is None:
                    raise ValueError(
                        f"Transform father {father_key} for {game_key} is unresolved"
                    )
                father_game = pointer_key(
                    father[0],
                    father[1].get("m_GameObject"),
                )
                result = f"{resolve(father_game, visiting | {game_key})}/{name}"
        cache[game_key] = result
        return result

    for game_key in game_objects:
        resolve(game_key, set())
    return cache


def build_ui_index(
    decrypted_root: Path,
) -> tuple[dict, dict, list]:
    paths = [decrypted_root / relative for relative in UI_PREFABS]
    index, environments = load_bundle_index(paths)
    paths_by_game_object = game_object_paths(index)
    return index, paths_by_game_object, environments


def build_designs(
    decrypted_root: Path,
    conditions_by_key: dict,
    ui_index: dict,
    ui_paths: dict,
) -> tuple[dict, dict, list]:
    design_paths = asset_paths(
        decrypted_root / DESIGN_ROOT,
        ".asset_bundles",
    )
    design_index, environments = load_bundle_index(design_paths)
    designs = {}
    designs_by_key = {}
    for key, (path, obj) in design_index.items():
        tree = mono_tree(obj)
        if tree is None or "_dynamicUIs" not in tree or "_fonts" not in tree:
            continue
        name = str(tree.get("m_Name", ""))
        if not name:
            raise ValueError(f"unnamed CardDesignSettings at {key}")
        if name in designs:
            raise ValueError(f"duplicate CardDesignSettings name {name}")
        font_key = pointer_key(obj, tree["_fonts"])
        font_condition = conditions_by_key.get(font_key)
        if font_condition is None:
            raise ValueError(
                f"{name} FontGroupConditions is unresolved: {font_key}"
            )
        dynamic_ui = []
        for index, item in enumerate(tree.get("_dynamicUIs", [])):
            key_identity = pointer_key(obj, item.get("_key"))
            key_hit = ui_index.get(key_identity)
            if key_hit is None:
                raise ValueError(
                    f"{name} DynamicUI key {index} is unresolved: {key_identity}"
                )
            key_tree = mono_tree(key_hit[1])
            if key_tree is None or "_label" not in key_tree:
                raise ValueError(
                    f"{name} DynamicUI key {index} lacks CardDynamicUIView._label"
                )
            controller_identity = pointer_key(
                key_hit[1],
                key_tree.get("m_GameObject"),
            )
            controller_hit = ui_index.get(controller_identity)
            if (
                controller_hit is None
                or controller_hit[1].type.name != "GameObject"
            ):
                raise ValueError(
                    f"{name} DynamicUI controller {index} is unresolved: "
                    f"{controller_identity}"
                )
            controller_tree = controller_hit[1].read_typetree()
            controller = {
                "name": str(controller_tree.get("m_Name", "")),
                "path": ui_paths[controller_identity],
                "identity": serialized_identity(controller_identity),
                "objectSha256": sha256(controller_hit[1].get_raw_data()),
            }
            game_identity = pointer_key(obj, item.get("_gameObject"))
            target = None
            if game_identity[1] != 0:
                game_hit = ui_index.get(game_identity)
                if game_hit is None or game_hit[1].type.name != "GameObject":
                    raise ValueError(
                        f"{name} DynamicUI target {index} is unresolved: "
                        f"{game_identity}"
                    )
                game_tree = game_hit[1].read_typetree()
                target = {
                    "name": str(game_tree.get("m_Name", "")),
                    "path": ui_paths[game_identity],
                    "identity": serialized_identity(game_identity),
                    "objectSha256": sha256(game_hit[1].get_raw_data()),
                }
                if target["path"].rsplit("/", 1)[0] != controller["path"]:
                    raise ValueError(
                        f"{name} DynamicUI target {target['path']} is not a "
                        f"direct child of controller {controller['path']}"
                    )
            dynamic_ui.append({
                "label": str(key_tree["_label"]),
                "keyIdentity": serialized_identity(key_identity),
                "keyObjectSha256": sha256(key_hit[1].get_raw_data()),
                "controller": controller,
                "target": target,
            })
        contract = {
            **object_contract(decrypted_root, path, obj, name),
            "uiBasePrefabIdentity": serialized_identity(
                pointer_key(obj, tree.get("_uiBasePrefab"))
            ),
            "templatePrefabIdentity": serialized_identity(
                pointer_key(obj, tree.get("_templatePrefab"))
            ),
            "fontCondition": font_condition["name"],
            "fontConditionIdentity": font_condition["identity"],
            "dynamicUIs": dynamic_ui,
        }
        designs[name] = contract
        designs_by_key[key] = contract
    return designs, designs_by_key, environments


def select_font_group(font_condition: dict, energy_type: int | None) -> str:
    for condition in font_condition["conditions"]:
        condition_type = int(condition["conditionType"])
        checks_energy = condition_type == -1 or (
            condition_type & KNOWN_FONT_CONDITION_BITS
        ) != 0
        if checks_energy and energy_type == int(condition["energyType"]):
            return str(condition["fontGroup"])
    return str(font_condition["defaultFontGroup"])


def load_masterdata(masterdata_root: Path, sample: dict) -> dict:
    cards = {}
    files = (
        ("PokemonCard.json", sample["snapshots"]["masterdata"]["pokemonSha256"]),
        ("TrainerCard.json", sample["snapshots"]["masterdata"]["trainerSha256"]),
    )
    for name, expected_hash in files:
        path = masterdata_root / name
        actual_hash = file_sha256(path)
        if actual_hash != expected_hash:
            raise ValueError(
                f"{name} hash {actual_hash} does not match official sample "
                f"{expected_hash}"
            )
        rows = json.loads(path.read_text(encoding="utf-8-sig"))
        for row in rows:
            illustration = str(row["IllustrationID"])
            if illustration in cards:
                raise ValueError(f"duplicate IllustrationID {illustration}")
            cards[illustration] = {
                "cardId": str(row["CardID"]),
                "rarity": int(row["Rarity"]),
                "seriesId": str(row["SeriesID"]),
            }
    return cards


def build_cards(
    decrypted_root: Path,
    designs_by_key: dict,
    conditions: dict,
    masterdata_cards: dict,
) -> tuple[dict, list]:
    cards = {}
    environments = []
    settings_paths = sorted(
        path.resolve()
        for path in (decrypted_root / CARD_ROOT).rglob(
            "CardSettings.asset_bundles"
        )
        if path.is_file()
    )
    for settings_path in settings_paths:
        card_directory = settings_path.parent
        illustration_id = card_directory.name
        if illustration_id in cards:
            raise ValueError(
                f"duplicate CardSettings bundle for {illustration_id}"
            )
        environment = UnityPy.load(str(settings_path))
        environments.append(environment)
        matches = []
        for obj in environment.objects:
            tree = mono_tree(obj)
            if tree is not None and "_cardDesignSettings" in tree:
                matches.append((obj, tree))
        if len(matches) != 1:
            raise ValueError(
                f"{illustration_id} has {len(matches)} CardSettings objects"
            )
        obj, tree = matches[0]
        design_key = pointer_key(obj, tree["_cardDesignSettings"])
        design = designs_by_key.get(design_key)
        if design is None:
            raise ValueError(
                f"{illustration_id} design is unresolved: {design_key}"
            )
        masterdata = masterdata_cards.get(illustration_id)
        if masterdata is None:
            raise ValueError(
                f"{illustration_id} is absent from official masterdata"
            )
        if str(tree.get("_id", "")) != masterdata["cardId"]:
            raise ValueError(
                f"{illustration_id} CardSettings id {tree.get('_id')} "
                f"does not match masterdata {masterdata['cardId']}"
            )
        values = {
            field[1:]: (
                None
                if field not in tree
                else int(tree[field])
                if field not in ("_id", "_name")
                else str(tree[field])
            )
            for field in CARD_SETTING_FIELDS
        }
        font_condition = conditions[design["fontCondition"]]
        selected_font_group = select_font_group(
            font_condition,
            values["energyType"],
        )
        cards[illustration_id] = {
            **values,
            "masterdataRarity": masterdata["rarity"],
            "seriesId": masterdata["seriesId"],
            "design": design["name"],
            "designIdentity": design["identity"],
            "fontCondition": font_condition["name"],
            "fontGroup": selected_font_group,
            "cardSettingsIdentity": serialized_identity(
                (normalized_cab(obj.assets_file.name), int(obj.path_id))
            ),
            "cardSettingsObjectSha256": sha256(obj.get_raw_data()),
            "cardSettingsBundle": bundle_identity(
                decrypted_root,
                settings_path,
            ),
        }
    return cards, environments


def compact_bundle_roots(items: dict) -> list:
    unique = {}
    for item in items.values():
        bundle = item["bundle"]
        unique[bundle["source"]] = bundle
    return [unique[key] for key in sorted(unique)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=DEFAULT_DECRYPTED_ROOT,
    )
    parser.add_argument(
        "--masterdata-root",
        type=Path,
        default=DEFAULT_MASTERDATA_ROOT,
    )
    parser.add_argument("--static-only", action="store_true")
    args = parser.parse_args()
    loaded = load_official_sample(args.manifest)
    sample = loaded["sample"]
    UnityPy.config.FALLBACK_UNITY_VERSION = sample["unity"]["serializedVersion"]
    decrypted_root = Path(
        os.environ.get("PCR_DECRYPTED_ROOT", args.decrypted_root)
    ).resolve()
    masterdata_root = Path(
        os.environ.get("PCR_MASTERDATA_ROOT", args.masterdata_root)
    ).resolve()

    groups, groups_by_key, group_environments = build_font_groups(decrypted_root)
    conditions, conditions_by_key, condition_environments = build_font_conditions(
        decrypted_root,
        groups_by_key,
    )
    ui_index, ui_paths, ui_environments = build_ui_index(decrypted_root)
    designs, designs_by_key, design_environments = build_designs(
        decrypted_root,
        conditions_by_key,
        ui_index,
        ui_paths,
    )
    masterdata_cards = load_masterdata(masterdata_root, sample)
    cards, card_environments = build_cards(
        decrypted_root,
        designs_by_key,
        conditions,
        masterdata_cards,
    )

    referenced_designs = Counter(card["design"] for card in cards.values())
    selected_font_groups = Counter(card["fontGroup"] for card in cards.values())
    internal_rarities = Counter(str(card["rarity"]) for card in cards.values())
    masterdata_rarities = Counter(
        str(card["masterdataRarity"]) for card in cards.values()
    )
    missing_witness = [
        [
            masterdata["cardId"],
            illustration_id,
            masterdata["seriesId"],
            masterdata["rarity"],
        ]
        for illustration_id, masterdata in masterdata_cards.items()
        if illustration_id not in cards
    ]
    missing_illustrations = sorted(row[1] for row in missing_witness)
    if len(cards) != sample["snapshots"]["faceBundles"]["count"]:
        raise ValueError(
            f"CardSettings count {len(cards)} does not match official sample "
            f"{sample['snapshots']['faceBundles']['count']}"
        )
    if len(missing_illustrations) != sample["snapshots"]["faceBundles"][
        "missingIllustrations"
    ]:
        raise ValueError("missing illustration count drifted")
    if stable_sha256(missing_witness) != sample["snapshots"]["faceBundles"][
        "missingIllustrationsSha256"
    ]:
        raise ValueError("missing illustration identity set drifted")

    bundle_roots = {
        "fontGroups": compact_bundle_roots(groups),
        "fontConditions": compact_bundle_roots(conditions),
        "designSettings": compact_bundle_roots(designs),
        "cardSettings": [
            card["cardSettingsBundle"]
            for _, card in sorted(cards.items())
        ],
        "uiPrefabs": [
            bundle_identity(decrypted_root, decrypted_root / relative)
            for relative in UI_PREFABS
        ],
    }
    proof_roots = {
        key: {
            "count": len(values),
            "aggregateSha256": stable_sha256(values),
        }
        for key, values in bundle_roots.items()
    }
    native_producers = (
        {
            "status": "runtime-required",
            "reason":
                "candidate IL2CPP producer methods must be relocated and "
                "hash-bound before runtime selection semantics can be exact",
            "requiredMethods": [
                {"key": key, "name": name}
                for key, name, *_ in NATIVE_PRODUCERS
            ],
        }
        if args.static_only
        else native_producer_contract(sample)
    )
    report = {
        "schema": "pocket-card-render/card-text-design-contract@1",
        "schemaVersion": 1,
        "sampleId": sample["sampleId"],
        "sampleManifestSha256": loaded["sampleManifestSha256"],
        "unityVersion": sample["unity"]["serializedVersion"],
        "selectionSemantics": {
            "fontConditionKnownBits": {
                "EnergyType": KNOWN_FONT_CONDITION_BITS,
            },
            "conditionValueMinusOne": "all-known-condition-bits",
            "fontConditionOrder": "serialized-first-match-then-default",
            "dynamicUI": "CardDynamicUIView label to selected GameObject",
        },
        "nativeProducerStatus":
            "runtime-required" if args.static_only else "exact",
        "nativeProducers": native_producers,
        "summary": {
            "masterdataIllustrationCount": len(masterdata_cards),
            "cardSettingsCount": len(cards),
            "missingIllustrationCount": len(missing_illustrations),
            "designSettingsCount": len(designs),
            "referencedDesignSettingsCount": len(referenced_designs),
            "fontConditionCount": len(conditions),
            "fontGroupCount": len(groups),
            "selectedFontGroupCount": len(selected_font_groups),
            "internalRarityCount": len(internal_rarities),
            "masterdataRarityCount": len(masterdata_rarities),
            "unresolvedCardDesignCount": 0,
            "unresolvedFontConditionCount": 0,
            "unresolvedDynamicUICount": 0,
        },
        "proofRoots": proof_roots,
        "counts": {
            "cardsByDesign": dict(sorted(referenced_designs.items())),
            "cardsByFontGroup": dict(sorted(selected_font_groups.items())),
            "cardsByInternalRarity": dict(sorted(internal_rarities.items())),
            "cardsByMasterdataRarity": dict(sorted(masterdata_rarities.items())),
        },
        "missingIllustrations": missing_illustrations,
        "fontGroups": dict(sorted(groups.items())),
        "fontConditions": dict(sorted(conditions.items())),
        "designs": dict(sorted(designs.items())),
        "cards": dict(sorted(cards.items())),
    }
    # Keep loaded environments alive until all ObjectReader raw bytes are consumed.
    _ = (
        group_environments,
        condition_environments,
        ui_environments,
        design_environments,
        card_environments,
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
