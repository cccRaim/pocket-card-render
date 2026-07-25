#!/usr/bin/env python3
"""SMOL-V decoder (Python port of aras-p/smol-v Decode). Turns Unity's compressed
Vulkan shader programs back into SPIR-V. Opcode flag table is parsed from smolv.cpp."""
import os, re, struct

HERE = os.path.dirname(os.path.abspath(__file__))

def _load_optable():
    txt = open(os.path.join(HERE, "smolv.cpp"), encoding="utf-8", errors="replace").read()
    m = re.search(r'kSpirvOpData\[\]\s*=\s*\{(.*?)\n\};', txt, re.S)
    rows = re.findall(r'\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}', m.group(1))
    return [tuple(int(x) for x in r) for r in rows]   # (hasResult,hasType,deltaFromResult,varrest)

OPDATA = _load_optable()
KNOWN = len(OPDATA)   # == SpvOpGroupNonUniformQuadSwap+1 (366)

SMOL_MAGIC = 0x534D4F4C
SPIRV_MAGIC = 0x07230203

# SpvOp constants (standard SPIR-V opcode numbers) used by smolv_RemapOp / DecodeLen
Nop, Undef, SourceContinued, Source, SourceExtension = 0, 1, 2, 3, 4
Name, MemberName, String, Line = 5, 6, 7, 8
Extension, ExtInstImport, ExtInst = 10, 11, 12
VectorShuffleCompact = 13
MemoryModel, EntryPoint = 14, 15
TypePointer, Variable, Load, Store, AccessChain = 32, 59, 61, 62, 65
Decorate, MemberDecorate, VectorShuffle = 71, 72, 79
FNegate, FAdd, FMul, Label = 127, 129, 133, 248

_SWAPS = [(Decorate,Nop),(Load,Undef),(Store,SourceContinued),(AccessChain,Source),
          (VectorShuffle,SourceExtension),(MemberDecorate,String),(Label,Line),
          (Variable,9),(FMul,Extension),(FAdd,ExtInstImport),(TypePointer,MemoryModel),
          (FNegate,EntryPoint)]
_SWAPMAP = {}
for a,b in _SWAPS: _SWAPMAP[a]=b; _SWAPMAP[b]=a
def remap_op(op): return _SWAPMAP.get(op, op)

def decode_len(op, ln):
    ln += 1
    if op in (VectorShuffle, VectorShuffleCompact): ln += 4
    if op == Decorate: ln += 2
    if op == Load: ln += 3
    if op == AccessChain: ln += 3
    return ln

def zig_decode(u):
    return ((u >> 1) ^ 0xFFFFFFFF) & 0xFFFFFFFF if (u & 1) else (u >> 1)

def known_ops(version):
    if version == 1: return KNOWN
    if version == 0: return 331   # SpvOpModuleProcessed+1
    return 0

def has_result(op, n): return 0 <= op < n and OPDATA[op][0]
def has_type(op, n):   return 0 <= op < n and OPDATA[op][1]
def delta_from_result(op, n): return OPDATA[op][2] if 0 <= op < n else 0
def var_rest(op, n):   return 0 <= op < n and OPDATA[op][3]
def decoration_extra_ops(dec):
    if dec == 0 or (2 <= dec <= 5): return 0
    if 29 <= dec <= 37: return 1
    return -1

class _R:
    def __init__(s, b): s.b=b; s.i=0; s.n=len(b)
    def varint(s):
        v=0; sh=0
        while s.i < s.n:
            byte=s.b[s.i]; s.i+=1
            v |= (byte & 127) << sh; sh += 7
            if not (byte & 128): break
        return v & 0xFFFFFFFF
    def read4(s):
        v=struct.unpack_from('<I', s.b, s.i)[0]; s.i+=4; return v
    def byte(s):
        x=s.b[s.i]; s.i+=1; return x
    def length_op(s):
        val=s.varint()
        ln=((val>>20)<<4)|((val>>4)&0xF)
        op=((val>>4)&0xFFF0)|(val&0xF)
        op=remap_op(op); ln=decode_len(op, ln)
        return ln, op

def decode_with_consumed(smolv: bytes):
    """Decode exactly one SMOL-V module and return (SPIR-V, input bytes consumed)."""
    if len(smolv) < 24 or struct.unpack_from('<I', smolv, 0)[0] != SMOL_MAGIC:
        raise ValueError("not SMOL-V")
    w = struct.unpack_from('<6I', smolv, 0)
    decoded_size = int(w[5])
    if decoded_size < 20 or decoded_size % 4:
        raise ValueError(f"invalid SMOL-V decoded byte size {decoded_size}")
    smol_version = w[1] >> 24
    out = bytearray()
    def W(v): out.extend(struct.pack('<I', v & 0xFFFFFFFF))
    W(SPIRV_MAGIC)
    W(w[1] & 0x00FFFFFF)   # version
    W(w[2]); W(w[3]); W(w[4])   # generator, bound, schema
    r = _R(smolv); r.i = 24    # skip 6-word header
    n = known_ops(smol_version)
    prev_result = 0; prev_dec = 0
    while len(out) < decoded_size:
        instr_len, op = r.length_op()
        was_swizzle = (op == VectorShuffleCompact)
        if was_swizzle: op = VectorShuffle
        W((instr_len << 16) | op)
        ioffs = 1
        if has_type(op, n):
            W(r.varint()); ioffs += 1
        if has_result(op, n):
            val = (prev_result + zig_decode(r.varint())) & 0xFFFFFFFF
            W(val); prev_result = val; ioffs += 1
        if op == Decorate or op == MemberDecorate:
            val = (prev_dec + zig_decode(r.varint())) & 0xFFFFFFFF
            W(val); prev_dec = val; ioffs += 1
        if op == MemberDecorate:
            count = r.byte(); prev_index = 0; prev_offset = 0
            for m in range(count):
                member_index = (r.varint() + prev_index) & 0xFFFFFFFF; prev_index = member_index
                member_dec = r.varint()
                ke = decoration_extra_ops(member_dec)
                member_len = (r.varint() + 4) if ke == -1 else (4 + ke)
                if m != 0:
                    W((member_len << 16) | op); W(prev_dec)
                W(member_index); W(member_dec)
                if member_dec == 35:
                    val = (r.varint() + prev_offset) & 0xFFFFFFFF; W(val); prev_offset = val
                else:
                    for _ in range(4, member_len): W(r.varint())
            continue
        rel = delta_from_result(op, n)
        i = 0
        while i < rel and ioffs < instr_len:
            val = zig_decode(r.varint())
            W((prev_result - val) & 0xFFFFFFFF); i += 1; ioffs += 1
        if was_swizzle and instr_len <= 9:
            sw = r.byte()
            if instr_len > 5: W((sw >> 6) & 3)
            if instr_len > 6: W((sw >> 4) & 3)
            if instr_len > 7: W((sw >> 2) & 3)
            if instr_len > 8: W(sw & 3)
        elif var_rest(op, n):
            while ioffs < instr_len: W(r.varint()); ioffs += 1
        else:
            while ioffs < instr_len: W(r.read4()); ioffs += 1
    if len(out) != decoded_size:
        raise ValueError(
            f"SMOL-V decoded size mismatch: header={decoded_size}, actual={len(out)}"
        )
    return bytes(out), r.i

def decode(smolv: bytes) -> bytes:
    return decode_with_consumed(smolv)[0]

def find_and_decode(blob: bytes):
    """Find every SMOL-V module in a buffer and decode each to SPIR-V."""
    mg = struct.pack('<I', SMOL_MAGIC)
    outs = []
    start = 0
    while True:
        idx = blob.find(mg, start)
        if idx < 0: break
        try:
            decoded, consumed = decode_with_consumed(blob[idx:])
            outs.append((idx, decoded))
            start = idx + consumed
        except Exception as e:
            outs.append((idx, None))
            start = idx + 4
    return outs

def find_and_decode_records(blob: bytes):
    """Return strict module records including exact compressed input boundaries."""
    mg = struct.pack('<I', SMOL_MAGIC)
    records = []
    start = 0
    while True:
        idx = blob.find(mg, start)
        if idx < 0:
            break
        try:
            decoded, consumed = decode_with_consumed(blob[idx:])
            records.append({
                "offset": idx,
                "compressed_size": consumed,
                "compressed": blob[idx:idx + consumed],
                "decoded": decoded,
            })
            start = idx + consumed
        except Exception:
            start = idx + 4
    return records

if __name__ == "__main__":
    import sys
    data = open(sys.argv[1], "rb").read()
    for off, spv in find_and_decode(data):
        ok = spv and struct.unpack_from('<I', spv, 0)[0] == SPIRV_MAGIC
        print(f"@{off}: {'SPIR-V '+str(len(spv))+'B' if ok else 'FAIL'}")
        if ok and len(sys.argv) > 2:
            open(sys.argv[2], "wb").write(spv); print("  wrote", sys.argv[2]); break
