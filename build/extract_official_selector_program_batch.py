#!/usr/bin/env python3
"""Batch official selector extraction with one proof/inventory and Unity bundle session.

The request is a JSON object. Relative paths are resolved from the current working
directory. The batch is fail-closed: all selectors are validated in a staging
directory before any artifact or result is published.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from extract_official_selector_program import (
    DEFAULT_INVENTORY,
    SelectorProgramExtractionSession,
    encode_metadata,
    fail,
)


REQUEST_SCHEMA = "pocket-card-render/official-selector-program-batch-request@1"
RESULT_SCHEMA = "pocket-card-render/official-selector-program-batch-result@1"
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
PREFIX_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def object_value(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def exact_keys(value: dict, required: set[str], optional: set[str], label: str) -> None:
    keys = set(value)
    missing = sorted(required - keys)
    unknown = sorted(keys - required - optional)
    if missing:
        fail(f"{label} is missing fields: {missing}")
    if unknown:
        fail(f"{label} has unknown fields: {unknown}")


def string_value(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        fail(f"{label} must be a non-empty string")
    return value


def hash_value(value: object, label: str) -> str:
    text = string_value(value, label)
    if not HASH_PATTERN.fullmatch(text):
        fail(f"{label} must be a lowercase SHA-256")
    return text


def integer_value(value: object, label: str) -> int:
    if type(value) is not int or value < 0:
        fail(f"{label} must be a non-negative integer")
    return value


def load_request(path_text: str) -> dict:
    if path_text == "-":
        return object_value(json.load(sys.stdin), "batch request")
    return object_value(
        json.loads(Path(path_text).read_text(encoding="utf-8-sig")),
        "batch request",
    )


def validate_request(value: dict) -> dict:
    exact_keys(
        value,
        {
            "schema",
            "decryptedRoot",
            "expectedProofGraphSha256",
            "expectedPortIndexSha256",
            "out",
            "requests",
        },
        {"inventory"},
        "batch request",
    )
    if value["schema"] != REQUEST_SCHEMA:
        fail(f"expected {REQUEST_SCHEMA}, got {value['schema']}")
    rows = value["requests"]
    if not isinstance(rows, list) or not rows:
        fail("batch request.requests must be a non-empty array")
    requests = []
    composite_keys = set()
    prefixes = set()
    for index, raw in enumerate(rows):
        label = f"batch request.requests[{index}]"
        row = object_value(raw, label)
        exact_keys(
            row,
            {"selectorId", "candidateWitnessId", "subshader", "pass", "prefix"},
            set(),
            label,
        )
        selector_id = hash_value(row["selectorId"], f"{label}.selectorId")
        candidate_witness_id = hash_value(
            row["candidateWitnessId"], f"{label}.candidateWitnessId"
        )
        subshader = integer_value(row["subshader"], f"{label}.subshader")
        pass_index = integer_value(row["pass"], f"{label}.pass")
        prefix = string_value(row["prefix"], f"{label}.prefix")
        if not PREFIX_PATTERN.fullmatch(prefix):
            fail(f"{label}.prefix contains unsafe path characters")
        composite_key = (selector_id, candidate_witness_id, subshader, pass_index)
        if composite_key in composite_keys:
            fail(f"{label} duplicates a composite selector key")
        if prefix in prefixes:
            fail(f"{label}.prefix duplicates another output prefix")
        composite_keys.add(composite_key)
        prefixes.add(prefix)
        requests.append({
            "selectorId": selector_id,
            "candidateWitnessId": candidate_witness_id,
            "subshader": subshader,
            "pass": pass_index,
            "prefix": prefix,
        })
    inventory = value.get("inventory")
    if inventory is None:
        inventory_path = DEFAULT_INVENTORY.resolve()
    else:
        inventory_path = Path(string_value(inventory, "inventory")).resolve()
    return {
        "inventory": inventory_path,
        "decryptedRoot": Path(string_value(value["decryptedRoot"], "decryptedRoot")).resolve(),
        "expectedProofGraphSha256": hash_value(
            value["expectedProofGraphSha256"], "expectedProofGraphSha256"
        ),
        "expectedPortIndexSha256": hash_value(
            value["expectedPortIndexSha256"], "expectedPortIndexSha256"
        ),
        "out": Path(string_value(value["out"], "out")).resolve(),
        "requests": requests,
    }


def extract_batch(config: dict) -> dict:
    out = config["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    inventory_header = object_value(
        json.loads(config["inventory"].read_text(encoding="utf-8-sig")),
        "official selector inventory",
    )
    unity_version = string_value(
        inventory_header.get("unityVersion"),
        "official selector inventory.unityVersion",
    )
    session = SelectorProgramExtractionSession(
        inventory_path=config["inventory"],
        decrypted_root=config["decryptedRoot"],
        unity_version=unity_version,
        expected_proof_graph_sha256=config["expectedProofGraphSha256"],
        expected_port_index_sha256=config["expectedPortIndexSha256"],
    )
    results = []
    with tempfile.TemporaryDirectory(prefix="pcr-selector-batch-", dir=out.parent) as temporary:
        staging = Path(temporary)
        for request in config["requests"]:
            metadata = session.extract(
                selector_id=request["selectorId"],
                candidate_witness_id=request["candidateWitnessId"],
                subshader=request["subshader"],
                pass_index=request["pass"],
                out=staging,
                prefix=request["prefix"],
            )
            selector = metadata["selector"]
            selector_key = {
                "selectorId": selector["selectorId"],
                "candidateWitnessId": selector["candidateWitnessId"],
                "subshader": selector["subshader"],
                "pass": selector["pass"],
            }
            expected_key = {key: request[key] for key in selector_key}
            if selector_key != expected_key:
                fail("extracted selector metadata differs from its composite request key")
            results.append({
                "selectorKey": selector_key,
                "prefix": request["prefix"],
                "metadata": metadata,
            })

        out.mkdir(parents=True, exist_ok=True)
        for result in results:
            for artifact in result["metadata"]["artifacts"].values():
                name = artifact["path"]
                source = staging / name
                if source.parent != staging or not source.is_file():
                    fail(f"staged artifact is absent or escapes its directory: {name}")
                os.replace(source, out / name)

    return {
        "schema": RESULT_SCHEMA,
        "inventory": {
            "proofGraphSha256": session.proof_hash,
            "portIndexSha256": session.port_hash,
        },
        "results": results,
        "statistics": session.statistics,
    }


def write_result(path: Path | None, result: dict) -> None:
    encoded = encode_metadata(result)
    if path is None:
        print(encoded, end="")
        return
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="ascii", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as temporary:
        temporary.write(encoded)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="request JSON path, or - for stdin")
    parser.add_argument("--result", type=Path, help="result JSON path; defaults to stdout")
    args = parser.parse_args()
    config = validate_request(load_request(args.request))
    write_result(args.result, extract_batch(config))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BAD official selector program batch extract: {error}", file=sys.stderr)
        raise SystemExit(1)
