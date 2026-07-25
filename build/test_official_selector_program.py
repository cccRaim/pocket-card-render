import unittest
import struct

from extract_official_selector_program import close_constant_buffer_declarations
from extract_official_material_program_inventory import parse_program_bind_channels


def reflection(buffers, bindings=()):
    return {
        "constantBuffers": [{"name": name, "size": size} for name, size in buffers],
        "constantBufferBindings": [{"name": name} for name in bindings],
    }


class ConstantBufferClosureTests(unittest.TestCase):
    def test_serialized_common_declarations(self):
        result = close_constant_buffer_declarations(
            reflection((("PGlobals", 108), ("VGlobals", 232))),
            {"PGlobals": 108, "VGlobals": 232},
        )
        self.assertEqual(result["constantBufferDeclarationMode"], "serialized-common")
        self.assertEqual(result["variantConstantBufferCount"], 0)

    def test_variant_local_declarations(self):
        result = close_constant_buffer_declarations(
            reflection((("PGlobals", 124), ("VGlobals", 192)), ("PGlobals", "VGlobals")),
            {},
        )
        self.assertEqual(result["constantBufferDeclarationMode"], "variant-local")
        self.assertEqual(result["variantConstantBufferCount"], 2)

    def test_mixed_declarations(self):
        result = close_constant_buffer_declarations(
            reflection((("PGlobals", 64), ("VGlobals", 192)), ("PGlobals",)),
            {"VGlobals": 192},
        )
        self.assertEqual(result["constantBufferDeclarationMode"], "mixed-common-and-variant")

    def test_unknown_variant_binding_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "undeclared buffers"):
            close_constant_buffer_declarations(reflection((("PGlobals", 64),), ("Missing",)), {})

    def test_unclosed_parameter_buffer_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "not closed"):
            close_constant_buffer_declarations(reflection((("PGlobals", 64),)), {})

    def test_common_size_mismatch_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "sizes disagree"):
            close_constant_buffer_declarations(reflection((("PGlobals", 64),)), {"PGlobals": 60})


def program_entry(*, source_map=0x31, channels=((0, 13), (4, 15), (5, 16))):
    header = struct.pack("<7i", 202012090, 25, 0, 0, 0, 0, 0)
    program_data = b"SMOL"
    payload = header + struct.pack("<i", len(program_data)) + program_data
    payload += struct.pack("<ii", source_map, len(channels))
    payload += b"".join(struct.pack("<II", source, target) for source, target in channels)
    return payload


class ProgramBindChannelTests(unittest.TestCase):
    def test_parses_official_semantic_names_with_exact_eof(self):
        parsed = parse_program_bind_channels(program_entry())
        self.assertEqual(parsed["programDataOffset"], 32)
        self.assertEqual(parsed["programDataByteSize"], 4)
        self.assertEqual(
            [(row["sourceName"], row["targetName"]) for row in parsed["bindChannels"]],
            [("Vertex", "Attrib1"), ("UV0", "Attrib3"), ("UV1", "Attrib4")],
        )

    def test_rejects_source_map_drift(self):
        with self.assertRaisesRegex(RuntimeError, "source map"):
            parse_program_bind_channels(program_entry(source_map=0x11))

    def test_rejects_unknown_source_semantic(self):
        with self.assertRaisesRegex(RuntimeError, "unknown ShaderChannel"):
            parse_program_bind_channels(program_entry(source_map=1 << 14, channels=((14, 13),)))

    def test_rejects_unknown_target_component(self):
        with self.assertRaisesRegex(RuntimeError, "unknown VertexComponent"):
            parse_program_bind_channels(program_entry(source_map=1, channels=((0, 99),)))

    def test_rejects_trailing_bytes(self):
        with self.assertRaisesRegex(RuntimeError, "trailing bytes"):
            parse_program_bind_channels(program_entry() + b"\x00")

    def test_rejects_truncation(self):
        with self.assertRaisesRegex(RuntimeError, "truncated"):
            parse_program_bind_channels(program_entry()[:-1])


if __name__ == "__main__":
    unittest.main()
