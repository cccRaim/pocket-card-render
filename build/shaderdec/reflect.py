#!/usr/bin/env python3
"""reflect.py — recover a shader's constant-buffer member NAMES → byte offsets from its blob.

The card shaders have their uniform names STRIPPED, so SPIRV-Cross emits anonymous `_NN[k]` UBO members.
To map those back to real names (`_DiffractionPower`, `_RampSpeed`, …) read a SIBLING shader variant that
kept its reflection — each cbuffer member is laid out as `<offset:u32><nameLen:u32><name bytes>`. This
scans every such entry. Cross-reference the offsets with the stripped shader's flatten-ubo layout to label
its params. See SHADERS.md.

Requires:  pip install UnityPy lz4

Usage:
  python build/shaderdec/reflect.py "<ShaderNameSuffix>" --shaders "<DECRYPTED>/Common/Shader"
"""
import os, sys, re, json, struct, argparse, lz4.block
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

IDENT = re.compile(rb"^[A-Za-z_][A-Za-z0-9_]*$")


def find_shader(suf, shdir):
    for dp, _, fs in os.walk(shdir):
        for f in fs:
            try: env = UnityPy.load(os.path.join(dp, f))
            except Exception: continue
            for o in env.objects:
                if o.type.name != "Shader": continue
                try: d = o.read_typetree()
                except Exception: continue
                if d.get("m_ParsedForm", {}).get("m_Name", "").endswith(suf): return d
    return None


def decompressed(d):
    plats = d.get("platforms", []); blob = bytes(d.get("compressedBlob", b""))
    offs = d.get("offsets", []); clen = d.get("compressedLengths", []); dlen = d.get("decompressedLengths", [])
    out = []
    for pi in range(len(plats)):
        cl = clen[pi] if isinstance(clen[pi], list) else [clen[pi]]
        dl = dlen[pi] if isinstance(dlen[pi], list) else [dlen[pi]]
        of = offs[pi] if isinstance(offs[pi], list) else [offs[pi]]
        for si in range(len(cl)):
            try: out.append(lz4.block.decompress(blob[of[si]:of[si] + cl[si]], uncompressed_size=dl[si]))
            except Exception: pass
    return out


def scan(dec):
    """All <offset:u32><nameLen:u32><name> reflection entries (scan every byte — entries aren't contiguous)."""
    refl = {}; n = len(dec)
    for i in range(n - 8):
        ln = struct.unpack_from("<I", dec, i + 4)[0]
        if not (2 <= ln <= 64) or i + 8 + ln > n: continue
        name = dec[i + 8:i + 8 + ln]
        if not IDENT.match(name): continue
        nm = name.decode()
        if not (nm.startswith("_") or nm.startswith("unity_")): continue
        off = struct.unpack_from("<I", dec, i)[0]
        if off < (1 << 20): refl.setdefault(nm, off)
    return refl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("suffix", help="shader name suffix to match (use a SIBLING that kept names)")
    ap.add_argument("--shaders", default=os.environ.get("PCR_SHADERS", "decrypted/Common/Shader"))
    ap.add_argument("--out", default=None, help="optional <name>_refl.json output path")
    args = ap.parse_args()
    d = find_shader(args.suffix, args.shaders)
    if not d: sys.exit(f"shader not found (suffix {args.suffix!r}) under {args.shaders}")
    print("shader:", d["m_ParsedForm"]["m_Name"])
    refl = {}
    for dec in decompressed(d):
        for k, v in scan(dec).items(): refl.setdefault(k, v)
    if args.out:
        json.dump(refl, open(args.out, "w"), indent=1); print(f"-> {args.out}")
    print(f"{len(refl)} reflected members:")
    for nm, off in sorted(refl.items(), key=lambda x: x[1]):
        print(f"  @{off:<5} {nm}")


if __name__ == "__main__":
    main()
