#!/usr/bin/env python3
"""dump_shader.py — extract a card shader's vertex + fragment SPIR-V from the DECRYPTED shader bundles.

The game ships shaders as Unity sub-program blobs: lz4-compressed, each holding SMOL-V-compressed Vulkan
SPIR-V. This finds the shader by name, lz4-decompresses every sub-program, SMOL-V-decodes it back to SPIR-V,
and writes the largest vertex + fragment module. Feed the .spv to SPIRV-Cross to get readable GLSL.
See SHADERS.md for the full workflow.

Requires:  pip install UnityPy lz4    (smolv.py / smolv.cpp ship next to this script — pure-Python decoder)

Usage:
  python build/shaderdec/dump_shader.py "<ShaderNameSuffix>" <prefix> \\
      --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
  # e.g.  "Frame-Holo-Tuning" framh   →  shaders_spv/framh_frag.spv  (+ _vert.spv)
"""
import os, sys, struct, argparse, lz4.block, UnityPy
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import smolv
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"


def find_shader(suf, shdir):
    for dp, _, fs in os.walk(shdir):
        for f in fs:
            try: env = UnityPy.load(os.path.join(dp, f))
            except Exception: continue
            for o in env.objects:
                if o.type.name != "Shader": continue
                try: d = o.read_typetree()
                except Exception: continue
                if d.get("m_ParsedForm", {}).get("m_Name", "").endswith(suf):
                    return d
    return None


def execmodel(spv):
    n = len(spv) // 4
    if n < 6: return -1
    w = struct.unpack("<%dI" % n, spv); i = 5
    while i < len(w):
        ln = w[i] >> 16
        if ln == 0: break
        if (w[i] & 0xFFFF) == 15 and i + 1 < len(w): return w[i + 1]   # OpEntryPoint → exec model
        i += ln
    return -1


def trim_to_last_function_end(spv):
    """SMOL-V decode can leave trailing garbage after the final OpFunctionEnd (op 56), making the module
    invalid (spirv-val/spirv-cross reject it). A valid module ends at its last OpFunctionEnd → truncate there."""
    n = len(spv) // 4
    if n < 6: return spv
    w = struct.unpack("<%dI" % n, spv); i = 5; end = None
    while i < len(w):
        ln = w[i] >> 16
        if ln == 0: break
        if (w[i] & 0xFFFF) == 56: end = i + ln
        i += ln
    return struct.pack("<%dI" % end, *w[:end]) if end else spv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("suffix", help="shader name suffix to match, e.g. \"Frame-Holo-Tuning\"")
    ap.add_argument("prefix", help="output filename prefix, e.g. framh")
    ap.add_argument("--shaders", default=os.environ.get("PCR_SHADERS", "decrypted/Common/Shader"),
                    help="decrypted Common/Shader dir")
    ap.add_argument("--out", default="shaders_spv", help="output dir for the .spv files")
    args = ap.parse_args()

    d = find_shader(args.suffix, args.shaders)
    if not d: sys.exit(f"shader not found (suffix {args.suffix!r}) under {args.shaders}")
    print("shader:", d["m_ParsedForm"]["m_Name"])

    plats = d.get("platforms", [])
    offs = d.get("offsets", []); clen = d.get("compressedLengths", []); dlen = d.get("decompressedLengths", [])
    blob = bytes(d["compressedBlob"])

    def all_decompressed():
        for pi in range(len(plats)):
            for si in range(len(clen[pi])):
                o = offs[pi][si] if isinstance(offs[pi], list) else offs[pi]
                try:
                    yield lz4.block.decompress(blob[o:o + clen[pi][si]], uncompressed_size=dlen[pi][si])
                except Exception:
                    continue

    allspv = []
    for dec in all_decompressed():
        for _, spv in smolv.find_and_decode(dec):
            if spv and len(spv) >= 20 and struct.unpack_from("<I", spv, 0)[0] == smolv.SPIRV_MAGIC:
                allspv.append(spv)

    verts = [trim_to_last_function_end(s) for s in allspv if execmodel(s) == 0]
    frags = [trim_to_last_function_end(s) for s in allspv if execmodel(s) == 4]
    os.makedirs(args.out, exist_ok=True)
    if verts: open(os.path.join(args.out, f"{args.prefix}_vert.spv"), "wb").write(max(verts, key=len))
    if frags: open(os.path.join(args.out, f"{args.prefix}_frag.spv"), "wb").write(max(frags, key=len))
    print(f"modules {len(allspv)} | vertex {len(verts)} | fragment {len(frags)} -> {args.out}/{args.prefix}_*.spv")
    print("next: spirv-cross <file>.spv --version 300 --es --flatten-ubo   (see SHADERS.md)")


if __name__ == "__main__":
    main()
