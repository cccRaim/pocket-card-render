#!/usr/bin/env python3
"""Mutation tests for official vertex-input semantic closure."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from audit_official_vertex_inputs import glsl_inputs, join_official_semantics


def bind_contract(channels: list[tuple[int, str, int, str]]) -> dict:
    return {
        "bindChannels": [
            {
                "index": index,
                "source": source,
                "sourceName": source_name,
                "target": target,
                "targetName": target_name,
            }
            for index, (source, source_name, target, target_name) in enumerate(channels)
        ]
    }


class OfficialVertexInputTests(unittest.TestCase):
    def test_uv1_and_color_do_not_alias_uv2_or_tangent(self):
        result = join_official_semantics(
            bind_contract([
                (0, "Vertex", 13, "Attrib1"),
                (5, "UV1", 16, "Attrib4"),
                (3, "Color", 17, "Attrib5"),
            ]),
            [
                {"location": 0, "spirvName": "_11", "spirvType": "vec4"},
                {"location": 3, "spirvName": "_91", "spirvType": "vec2"},
                {"location": 4, "spirvName": "_134", "spirvType": "vec4"},
            ],
        )
        self.assertEqual(
            [(row["sourceName"], row["threeAttribute"]) for row in result["inputs"]],
            [("Vertex", "position"), ("UV1", "uv1"), ("Color", "color")],
        )

    def test_empty_bind_table_does_not_promote_spirv_locations(self):
        result = join_official_semantics(
            bind_contract([]),
            [{"location": 0, "spirvName": "_11", "spirvType": "vec4"}],
        )
        self.assertEqual(result["status"], "runtime-required")
        self.assertEqual(len(result["unresolvedSpirvInputs"]), 1)

    def test_target_location_drift_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "no SPIR-V input"):
            join_official_semantics(
                bind_contract([(5, "UV1", 15, "Attrib3")]),
                [{"location": 3, "spirvName": "_91", "spirvType": "vec2"}],
            )

    def test_unbound_spirv_input_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "absent from official bind channels"):
            join_official_semantics(
                bind_contract([(0, "Vertex", 13, "Attrib1")]),
                [
                    {"location": 0, "spirvName": "_11", "spirvType": "vec4"},
                    {"location": 1, "spirvName": "_extra", "spirvType": "vec2"},
                ],
            )

    def test_glsl_input_parser_accepts_layout_and_precision(self):
        with tempfile.TemporaryDirectory(prefix="pcr-vertex-input-test-") as temporary:
            source = Path(temporary) / "test.vert"
            source.write_text(
                "layout(location = 0) in highp vec3 position;\n"
                "in mediump vec2 uv1;\n",
                encoding="ascii",
            )
            self.assertEqual(glsl_inputs(source), {"position": "vec3", "uv1": "vec2"})


if __name__ == "__main__":
    unittest.main()
