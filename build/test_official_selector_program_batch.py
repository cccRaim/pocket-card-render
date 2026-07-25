#!/usr/bin/env python3
"""Focused integration tests for selector-program batch extraction."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from extract_official_material_program_inventory import DEFAULT_DECRYPTED_ROOT
from extract_official_selector_program import DEFAULT_INVENTORY


ROOT = Path(__file__).resolve().parents[1]
SINGLE = ROOT / "build" / "extract_official_selector_program.py"
BATCH = ROOT / "build" / "extract_official_selector_program_batch.py"
REQUEST_SCHEMA = "pocket-card-render/official-selector-program-batch-request@1"
RESULT_SCHEMA = "pocket-card-render/official-selector-program-batch-result@1"


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


class SelectorProgramBatchIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not DEFAULT_INVENTORY.is_file():
            raise unittest.SkipTest(f"official inventory is absent: {DEFAULT_INVENTORY}")
        cls.decrypted_root = Path(DEFAULT_DECRYPTED_ROOT).resolve()
        if not cls.decrypted_root.is_dir():
            raise unittest.SkipTest(f"decrypted root is absent: {cls.decrypted_root}")
        cls.inventory = json.loads(DEFAULT_INVENTORY.read_text(encoding="utf-8-sig"))
        cls.proof_hash = cls.inventory["digests"]["proofGraphSha256"]
        cls.port_hash = cls.inventory["digests"]["portIndexSha256"]
        rows_by_selector: dict[str, list[dict]] = {}
        for row in cls.inventory["portIndex"]:
            rows_by_selector.setdefault(row["selectorId"], []).append(row)
        cls.rows = next(
            sorted(rows, key=lambda row: (row["subshader"], row["pass"]))[:2]
            for rows in rows_by_selector.values()
            if len(rows) >= 2 and len({row["shaderIdentity"] for row in rows}) == 1
        )
        if len({row["shaderIdentity"] for row in cls.rows}) != 1:
            raise AssertionError("test selectors must share one official Shader object")

        cls.temporary = tempfile.TemporaryDirectory(prefix="pcr-selector-batch-test-")
        cls.temp = Path(cls.temporary.name)
        cls.batch_out = cls.temp / "batch"
        cls.legacy_out = cls.temp / "legacy"
        cls.batch_result_path = cls.temp / "batch-result.json"
        cls.request_path = cls.temp / "batch-request.json"
        requests = [
            {
                "selectorId": row["selectorId"],
                "candidateWitnessId": row["candidateWitnessId"],
                "subshader": row["subshader"],
                "pass": row["pass"],
                "prefix": f"port_{index}",
            }
            for index, row in enumerate(cls.rows)
        ]
        cls.request = {
            "schema": REQUEST_SCHEMA,
            "inventory": str(DEFAULT_INVENTORY.resolve()),
            "decryptedRoot": str(cls.decrypted_root),
            "expectedProofGraphSha256": cls.proof_hash,
            "expectedPortIndexSha256": cls.port_hash,
            "out": str(cls.batch_out),
            "requests": requests,
        }
        cls.request_path.write_text(
            json.dumps(cls.request, ensure_ascii=True, indent=2) + "\n", encoding="ascii"
        )
        cls.batch_process = run([
            sys.executable,
            str(BATCH),
            "--request",
            str(cls.request_path),
            "--result",
            str(cls.batch_result_path),
        ])
        if cls.batch_process.returncode != 0:
            raise AssertionError(
                "batch extraction failed:\n"
                + cls.batch_process.stdout
                + cls.batch_process.stderr
            )
        cls.batch_result = json.loads(cls.batch_result_path.read_text(encoding="ascii"))

        first = requests[0]
        cls.legacy_metadata_path = cls.temp / "legacy.json"
        cls.legacy_process = run([
            sys.executable,
            str(SINGLE),
            "--selector-id",
            first["selectorId"],
            "--candidate-witness-id",
            first["candidateWitnessId"],
            "--inventory",
            str(DEFAULT_INVENTORY.resolve()),
            "--decrypted-root",
            str(cls.decrypted_root),
            "--expected-proof-graph-sha256",
            cls.proof_hash,
            "--expected-port-index-sha256",
            cls.port_hash,
            "--out",
            str(cls.legacy_out),
            "--prefix",
            first["prefix"],
            "--metadata",
            str(cls.legacy_metadata_path),
        ])
        if cls.legacy_process.returncode != 0:
            raise AssertionError(
                "legacy extraction failed:\n"
                + cls.legacy_process.stdout
                + cls.legacy_process.stderr
            )
        cls.legacy_metadata = json.loads(cls.legacy_metadata_path.read_text(encoding="ascii"))

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "temporary"):
            cls.temporary.cleanup()

    def test_batch_preserves_independent_composite_results(self):
        self.assertEqual(self.batch_result["schema"], RESULT_SCHEMA)
        self.assertEqual(len(self.batch_result["results"]), 2)
        actual_keys = [row["selectorKey"] for row in self.batch_result["results"]]
        expected_keys = [
            {
                "selectorId": row["selectorId"],
                "candidateWitnessId": row["candidateWitnessId"],
                "subshader": row["subshader"],
                "pass": row["pass"],
            }
            for row in self.request["requests"]
        ]
        self.assertEqual(actual_keys, expected_keys)

    def test_batch_reuses_inventory_bundle_and_shader_object(self):
        statistics = self.batch_result["statistics"]
        self.assertEqual(statistics["inventoryLoadCount"], 1)
        self.assertEqual(statistics["bundleLoadCount"], 1)
        self.assertEqual(statistics["objectMapBuildCount"], 1)
        self.assertEqual(statistics["shaderObjectLoadCount"], 1)
        self.assertEqual(statistics["extractionCount"], 2)
        unique_programs = {
            (
                row["metadata"]["selector"]["shaderIdentity"],
                row["metadata"]["selector"]["programBlobIndex"],
            )
            for row in self.batch_result["results"]
        }
        self.assertEqual(statistics["programDecodeCount"], len(unique_programs))

    def test_batch_result_is_byte_equivalent_to_legacy_cli(self):
        batch_metadata = self.batch_result["results"][0]["metadata"]
        self.assertEqual(batch_metadata, self.legacy_metadata)
        for artifact in batch_metadata["artifacts"].values():
            name = artifact["path"]
            self.assertEqual(
                (self.batch_out / name).read_bytes(),
                (self.legacy_out / name).read_bytes(),
            )

    def test_mismatched_composite_key_fails_without_publishing(self):
        bad_request = json.loads(json.dumps(self.request))
        bad_request["out"] = str(self.temp / "bad-output")
        bad_request["requests"] = [dict(bad_request["requests"][0])]
        bad_request["requests"][0]["pass"] += 1
        bad_request_path = self.temp / "bad-request.json"
        bad_result_path = self.temp / "bad-result.json"
        bad_request_path.write_text(
            json.dumps(bad_request, ensure_ascii=True, indent=2) + "\n", encoding="ascii"
        )
        process = run([
            sys.executable,
            str(BATCH),
            "--request",
            str(bad_request_path),
            "--result",
            str(bad_result_path),
        ])
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("composite key", process.stderr)
        self.assertFalse(bad_result_path.exists())
        self.assertFalse((self.temp / "bad-output").exists())


if __name__ == "__main__":
    unittest.main()
