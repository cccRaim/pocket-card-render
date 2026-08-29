#!/usr/bin/env python3
"""Fail-closed tests for the Unity 6 partial static native proof."""

from __future__ import annotations

import os
from pathlib import Path
import struct
import subprocess
import sys
import unittest

from extract_candidate_unity_native import (
    normalize_body,
    normalize_semantic_body,
)


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "build" / "build-candidate-unity-native-report.mjs"
MUTATION_ENV = "PCR_CANDIDATE_UNITY_NATIVE_TEST_MUTATION"


def run_builder(mutation: str = "") -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    if mutation:
        environment[MUTATION_ENV] = mutation
    else:
        environment.pop(MUTATION_ENV, None)
    return subprocess.run(
        ["node", str(BUILDER), "--check"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


class CandidateUnityNativeProofTests(unittest.TestCase):
    def test_normalizer_preserves_unconditional_branch_targets(self):
        first = struct.pack("<I", 0x14000000)
        second = struct.pack("<I", 0x14000001)
        self.assertNotEqual(normalize_body(first), normalize_body(second))

    def test_normalizer_masks_bl_only_for_initial_relocation_search(self):
        first = struct.pack("<I", 0x94000000)
        second = struct.pack("<I", 0x94000001)
        self.assertEqual(normalize_body(first), normalize_body(second))

    def test_semantic_normalizer_preserves_direct_calls(self):
        first = struct.pack("<I", 0x94000000)
        second = struct.pack("<I", 0x94000001)
        self.assertNotEqual(
            normalize_semantic_body(first),
            normalize_semantic_body(second),
        )

    def test_semantic_normalizer_preserves_field_offsets(self):
        load_first = struct.pack("<I", 0xB9400000)
        load_second = struct.pack("<I", 0xB9400400)
        add_first = struct.pack("<I", 0x91000000)
        add_second = struct.pack("<I", 0x91000400)
        self.assertNotEqual(
            normalize_semantic_body(load_first),
            normalize_semantic_body(load_second),
        )
        self.assertNotEqual(
            normalize_semantic_body(add_first),
            normalize_semantic_body(add_second),
        )

    def test_generated_report_is_current(self):
        result = run_builder()
        self.assertEqual(
            result.returncode,
            0,
            result.stderr or result.stdout,
        )

    def test_proof_mutations_fail_closed(self):
        mutations = {
            "caller-edge": "is not a paired BL",
            "branch-target": "required helper target shape changed",
            "thunk-rejoin": "linker thunk rejoin offset changed",
            "promote-stripped-global":
                "stripped candidate global was promoted",
            "sort-semantic-count-drift":
                "sort semantic exact denominator changed",
            "sort-semantic-shape-drift":
                "exact static semantic proof changed",
        }
        for mutation, expected in mutations.items():
            with self.subTest(mutation=mutation):
                result = run_builder(mutation)
                combined = result.stdout + result.stderr
                self.assertNotEqual(
                    result.returncode,
                    0,
                    f"{mutation} mutation was accepted",
                )
                self.assertIn(expected, combined)


if __name__ == "__main__":
    unittest.main()
