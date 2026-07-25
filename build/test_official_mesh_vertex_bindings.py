#!/usr/bin/env python3
"""Mutation tests for canonical Mesh-to-selector vertex binding proofs."""

from __future__ import annotations

import unittest

from audit_official_mesh_vertex_bindings import (
    canonical_digest,
    classify_required_inputs,
    collect_guest_default_obligations,
    inventory_maps,
    material_selector,
)


class OfficialMeshVertexBindingTests(unittest.TestCase):
    def test_canonical_selector_digest_is_stable(self):
        material = {"shaderIdentity": "CAB-test:1", "keywords": ["A", "B"]}
        self.assertEqual(
            material_selector(material),
            "0e54e704c817145a75dcfb1fedd599d7a0c4662f0da63cd728c7bd75fcd1d15a",
        )
        self.assertEqual(
            material_selector(material),
            canonical_digest([material["shaderIdentity"], material["keywords"]]),
        )

    def test_all_present_channels_preserve_payload_identity(self):
        result = classify_required_inputs(
            [{
                "sourceName": "UV0",
                "threeAttribute": "uv",
                "location": 2,
            }],
            {"TEXCOORD_0": {"components": 2, "sha256": "a" * 64}},
        )
        self.assertEqual(result["status"], "exact-all-present")
        self.assertEqual(result["missing"], [])
        self.assertEqual(result["present"][0]["expandedPayloadSha256"], "a" * 64)

    def test_missing_uv1_keeps_guest_default_runtime_required(self):
        result = classify_required_inputs(
            [{
                "sourceName": "UV1",
                "threeAttribute": "uv1",
                "location": 3,
            }],
            {},
        )
        self.assertEqual(result["status"], "exact-static-with-missing-channels")
        self.assertEqual(result["present"], [])
        self.assertEqual(result["missing"][0]["localThreeDefault"], [0, 0])
        self.assertEqual(result["missing"][0]["officialGuestDefault"], "runtime-required")

    def test_unknown_semantic_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "unsupported Mesh semantic"):
            classify_required_inputs(
                [{
                    "sourceName": "BlendWeight",
                    "threeAttribute": "skinWeight",
                    "location": 7,
                }],
                {},
            )

    def test_duplicate_inventory_usage_fails_closed(self):
        duplicate = {
            "illustrationId": "card",
            "rendererIdentity": "CAB-test:1",
            "materialSlot": 0,
            "materialIdentity": "CAB-material:2",
        }
        with self.assertRaisesRegex(RuntimeError, "duplicate official material-slot usage"):
            inventory_maps({
                "proofGraph": {
                    "materials": [],
                    "usageRows": [duplicate, duplicate.copy()],
                }
            })

    def test_guest_default_obligations_group_duplicate_draw_passes(self):
        row = {
            "selectorId": "selector",
            "meshIdentity": "CAB-mesh:1",
            "illustrationId": "card",
            "rendererIdentity": "CAB-renderer:2",
            "nodePath": "root/layer",
            "materialSlot": 0,
            "materialIdentity": "CAB-material:3",
            "candidateWitnessId": "candidate",
            "subshader": 0,
            "pass": 0,
            "manifest": "manifest.json",
            "channelProof": {
                "missing": [{
                    "sourceName": "UV1",
                    "threeAttribute": "uv1",
                    "localThreeDefault": [0, 0],
                }]
            },
        }
        obligations = collect_guest_default_obligations([row, row.copy()])
        self.assertEqual(len(obligations), 1)
        self.assertEqual(obligations[0]["officialGuestDefault"], "runtime-required")
        self.assertEqual(len(obligations[0]["affectedDraws"]), 1)
        self.assertEqual(obligations[0]["affectedDraws"][0]["nodePath"], "root/layer")


if __name__ == "__main__":
    unittest.main()
