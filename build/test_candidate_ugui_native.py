#!/usr/bin/env python3
"""Mutation tests for the candidate UGUI native producer extractor."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = ROOT.parent / "ptcg-apk-parser" / "apks"
EXTRACTOR = ROOT / "build" / "extract_candidate_ugui_native.py"
ARGS = [
    sys.executable,
    "-B",
    str(EXTRACTOR),
    "--candidate-manifest",
    str(ROOT / "build" / "official-samples" / "candidate.json"),
    "--split-root",
    str(
        UPSTREAM
        / "apkeep-downloads"
        / "jp.pokemon.pokemontcgp"
        / "jp.pokemon.pokemontcgp"
    ),
    "--locator-libil2cpp",
    str(UPSTREAM / "output" / "libil2cpp.so"),
    "--script-json",
    str(UPSTREAM / "output" / "Il2CppDumper" / "script.json"),
]

EXPECTED_HASHES = {
    "fontGroupSelection":
        "5272361ca47ef898ba3473864d96eb848e7cc2a8cb6e47abb1737d940067d2b3",
    "dynamicUIControllerApply":
        "e63154a1f67571c2ababcddcb9cbd29f983c1e67b8ed223d6f100b378cd48c97",
    "dynamicUILabelDispatch":
        "4b67e8310106a5581ee2f8d0fff64c5c87bb21e2c797df84df5a50f6f721df9a",
}


def run(mutation: str | None = None) -> subprocess.CompletedProcess[str]:
    environment = {
        **os.environ,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
    }
    if mutation is not None:
        environment["PCR_TEST_CANDIDATE_UGUI_NATIVE_MUTATION"] = mutation
    return subprocess.run(
        ARGS,
        cwd=ROOT,
        env=environment,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )


baseline = run()
if baseline.returncode != 0:
    raise AssertionError(baseline.stderr or baseline.stdout)
report = json.loads(baseline.stdout)
assert report["schema"] == "pocket-card-render/candidate-ugui-native-producers@1"
assert report["summary"] == {
    "requiredMethodCount": 3,
    "exactCandidateMethodCount": 3,
    "controlFlowContractCount": 3,
    "exactControlFlowContractCount": 3,
    "runtimeBoundaryCount": 1,
}
assert {
    key: method["sha256"] for key, method in report["methods"].items()
} == EXPECTED_HASHES
assert all(
    contract["status"] == "exact-candidate-il2cpp-control-flow"
    for contract in report["contracts"].values()
)
assert report["runtimeBoundaries"][0]["status"] == "runtime-required"

for mutation, expected in (
    ("font-card-energy", "expected 'ldr w15, [x8, #0x68]'"),
    ("dynamic-set-active", "is not bl"),
    ("label-dispatch", "is not bl"),
):
    mutated = run(mutation)
    assert mutated.returncode != 0, f"{mutation} mutation was accepted"
    output = f"{mutated.stdout}\n{mutated.stderr}"
    assert expected in output, (
        f"{mutation} mutation failed for an unrelated reason:\n{output}"
    )

print("Candidate UGUI native producer mutation tests OK")
