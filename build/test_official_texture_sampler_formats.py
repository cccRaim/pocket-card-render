from extract_official_texture_sampler import (
    ASTC_MAGIC,
    build_astc_container,
    mip_level_byte_length,
    parse_radiance_hdr,
)
from UnityPy.enums import TextureFormat


def require(actual: int, expected: int, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")


require(mip_level_byte_length(TextureFormat.R8.value, 7, 5, 1), 35, "R8")
require(mip_level_byte_length(TextureFormat.R16.value, 7, 5, 2), 140, "R16")
require(mip_level_byte_length(TextureFormat.RGB24.value, 7, 5, 1), 105, "RGB24")
require(mip_level_byte_length(TextureFormat.RGBA32.value, 7, 5, 1), 140, "RGBA32")
require(mip_level_byte_length(TextureFormat.ETC_RGB4.value, 7, 5, 1), 32, "ETC_RGB4")
require(mip_level_byte_length(TextureFormat.ASTC_HDR_6x6.value, 32, 32, 1), 576, "ASTC HDR 6x6")

astc = build_astc_container(b"\x00" * 16, 6, 5, 6, 6)
if astc[:4] != ASTC_MAGIC or astc[4:7] != bytes((6, 6, 1)):
    raise AssertionError("ASTC container header is invalid")
if astc[7:10] != b"\x06\x00\x00" or astc[10:13] != b"\x05\x00\x00":
    raise AssertionError("ASTC dimensions are not uint24 little-endian")

hdr = (
    b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n"
    + b"\x02\x02\x00\x08"
    + b"\x88\x89"
    + b"\x88\x4a"
    + b"\x88\x3d"
    + b"\x88\x7b"
)
pixels = parse_radiance_hdr(hdr, 8, 1)
expected = (137 * 2**-13, 74 * 2**-13, 61 * 2**-13)
if len(pixels) != 8 or any(
    abs(actual - target) > 1e-12
    for actual, target in zip(pixels[0], expected)
):
    raise AssertionError(f"Radiance HDR decode mismatch: {pixels[0]} != {expected}")

try:
    mip_level_byte_length(TextureFormat.Alpha8.value, 1, 1, 1)
except ValueError:
    pass
else:
    raise AssertionError("unsupported texture formats must fail closed")

print("Official texture sampler format tests OK")
print("  R8/R16/RGB24/RGBA32/ETC_RGB4/ASTC_HDR byte lengths exact")
print("  ASTC container and Radiance HDR RLE decode exact")
