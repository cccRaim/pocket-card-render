import tempfile
import unittest
from pathlib import Path

from dump_recipe import bundle_owner_cab, locate_cab_bundles


class DumpRecipeDependencyTests(unittest.TestCase):
    def test_locates_bundle_by_owner_cab_header(self):
        with tempfile.TemporaryDirectory() as root:
            target = "CAB-0123456789abcdef0123456789abcdef"
            bundle = Path(root) / "nested" / "material_bundles"
            bundle.parent.mkdir()
            bundle.write_bytes(b"UnityFS\x00" + b"x" * 31 + target.encode("ascii"))

            self.assertEqual(bundle_owner_cab(bundle), target)
            self.assertEqual(
                locate_cab_bundles([root], {target}),
                {target: str(bundle.resolve())},
            )

    def test_missing_owner_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(RuntimeError, "could not locate"):
                locate_cab_bundles(
                    [root],
                    {"CAB-fedcba9876543210fedcba9876543210"},
                )


if __name__ == "__main__":
    unittest.main()
