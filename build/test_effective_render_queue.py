#!/usr/bin/env python3
"""Regression tests for official Material/Shader render queue resolution."""

from __future__ import annotations

import unittest

from dump_recipe import resolve_shader_queue_tag, shader_queue_evidence


def subshader(queue_tag=...):
    tags = [] if queue_tag is ... else [["Queue", queue_tag]]
    return {"m_Tags": {"tags": tags}}


class EffectiveRenderQueueTests(unittest.TestCase):
    def test_shaderlab_default_is_geometry(self):
        self.assertEqual(
            resolve_shader_queue_tag(None),
            (2000, "shaderlab-default-geometry"),
        )

    def test_named_queues_and_offsets_are_exact(self):
        self.assertEqual(resolve_shader_queue_tag("Background"), (1000, "serialized-shader-queue-tag"))
        self.assertEqual(resolve_shader_queue_tag("Transparent-800"), (2200, "serialized-shader-queue-tag"))
        self.assertEqual(resolve_shader_queue_tag("Overlay-1100"), (2900, "serialized-shader-queue-tag"))

    def test_unknown_queue_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "unresolved serialized Shader Queue tag"):
            resolve_shader_queue_tag("FutureQueue+1")

    def test_subshader_dependent_queue_fails_closed(self):
        parsed = {
            "m_SubShaders": [
                subshader("Background"),
                subshader("Geometry"),
            ],
        }
        with self.assertRaisesRegex(RuntimeError, "subshader-dependent render queues"):
            shader_queue_evidence("CAB:test:1", parsed)

    def test_equivalent_subshader_queues_are_preserved(self):
        parsed = {
            "m_SubShaders": [
                subshader("Transparent-800"),
                subshader("Transparent-800"),
            ],
        }
        evidence = shader_queue_evidence("CAB:test:2", parsed)
        self.assertEqual(evidence["effectiveRenderQueue"], 2200)
        self.assertEqual(len(evidence["subshaders"]), 2)


if __name__ == "__main__":
    unittest.main()
