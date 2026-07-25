"""Strict Unity 2022.3 serialized shader parameter-entry parser."""
from __future__ import annotations

import hashlib
import struct

FORMAT_VERSION = 202012090


def _u32(data: bytes, offset: int) -> tuple[int, int]:
    if offset < 0 or offset + 4 > len(data):
        raise ValueError(f"u32 at {offset} exceeds {len(data)}-byte parameter entry")
    return struct.unpack_from("<I", data, offset)[0], offset + 4


def _aligned_string(data: bytes, offset: int) -> tuple[str, int]:
    length, offset = _u32(data, offset)
    end = offset + length
    aligned_end = (end + 3) & ~3
    if end > len(data) or aligned_end > len(data):
        raise ValueError(f"aligned string at {offset - 4} exceeds parameter entry")
    value = data[offset:end].decode("utf-8")
    if any(data[end:aligned_end]):
        raise ValueError(f"aligned string {value!r} has nonzero padding")
    return value, aligned_end


def parse_parameter_entry(
    data: bytes,
    texture_names: set[str] | None = None,
    *,
    parse_resources: bool = True,
) -> dict:
    if len(data) < 12:
        raise ValueError("parameter entry is truncated")
    version, block_count = struct.unpack_from("<II", data, 0)
    if version != FORMAT_VERSION:
        raise ValueError(f"unsupported parameter format version {version}")
    if block_count > 256:
        raise ValueError(f"implausible constant block count {block_count}")

    offset = 8
    buffers = []
    for _ in range(block_count):
        name, offset = _aligned_string(data, offset)
        size, offset = _u32(data, offset)
        member_count, offset = _u32(data, offset)
        if member_count > 4096:
            raise ValueError(f"invalid member count for constant block {name!r}")
        fields = []
        for _ in range(member_count):
            field_name, offset = _aligned_string(data, offset)
            if offset + 24 > len(data):
                raise ValueError(f"constant member {field_name!r} is truncated")
            descriptor = list(struct.unpack_from("<6I", data, offset))
            offset += 24
            fields.append({"name": field_name, "offset": descriptor[5], "descriptor": descriptor})
        secondary_count, offset = _u32(data, offset)
        if secondary_count != 0:
            raise ValueError(f"unsupported secondary records in {name!r}: {secondary_count}")
        buffers.append({"name": name, "size": size, "fields": fields})

    resource_count, offset = _u32(data, offset)
    if not parse_resources:
        tail = data[offset:]
        return {
            "version": version,
            "constantBlockCount": block_count,
            "constantBuffers": buffers,
            "resourceCount": resource_count,
            "resourceDecoding": "unparsed",
            "unparsedResourceByteSize": len(tail),
            "unparsedResourceSha256": hashlib.sha256(tail).hexdigest(),
        }

    if resource_count and texture_names is None:
        raise ValueError("resource entries require an independently sourced texture-name set")
    texture_names = texture_names or set()
    textures = []
    buffer_bindings = []
    for _ in range(resource_count):
        name, offset = _aligned_string(data, offset)
        if name in texture_names:
            if offset + 16 > len(data):
                raise ValueError(f"texture binding {name!r} is truncated")
            descriptor = list(struct.unpack_from("<4I", data, offset))
            offset += 16
            textures.append({
                "name": name,
                "binding": descriptor[1] & 0xFFFFFF,
                "encodedIndex": descriptor[1],
                "descriptor": descriptor,
            })
        else:
            if offset + 12 > len(data):
                raise ValueError(f"constant-buffer binding {name!r} is truncated")
            descriptor = list(struct.unpack_from("<3I", data, offset))
            offset += 12
            buffer_bindings.append({"name": name, "descriptor": descriptor})
    if offset != len(data):
        raise ValueError(f"parameter entry has {len(data) - offset} trailing bytes")
    return {
        "version": version,
        "constantBlockCount": block_count,
        "constantBuffers": buffers,
        "resourceCount": resource_count,
        "resourceDecoding": "empty-exact" if resource_count == 0 else "material-property-disambiguated",
        "textures": textures,
        "constantBufferBindings": buffer_bindings,
    }
