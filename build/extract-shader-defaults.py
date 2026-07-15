#!/usr/bin/env python3
import json
import os
import sys
import warnings

import UnityPy

warnings.filterwarnings("ignore", message="No valid Unity version found.*")
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"


def param(v):
    if not isinstance(v, dict):
        return None
    return {
        "val": v.get("val"),
        "name": None if v.get("name") == "<noninit>" else v.get("name"),
    }


def stencil_op(v):
    if not isinstance(v, dict):
        return None
    return {
        "pass": param(v.get("pass")),
        "fail": param(v.get("fail")),
        "zFail": param(v.get("zFail")),
        "comp": param(v.get("comp")),
    }


def pass_state(p):
    st = p.get("m_State", {}) if isinstance(p, dict) else {}
    blend = st.get("rtBlend0", {}) or {}
    return {
        "name": p.get("m_Name", "") if isinstance(p, dict) else "",
        "blend": {
            "src": param(blend.get("srcBlend")),
            "dst": param(blend.get("destBlend")),
            "srcAlpha": param(blend.get("srcBlendAlpha")),
            "dstAlpha": param(blend.get("destBlendAlpha")),
            "op": param(blend.get("blendOp")),
            "opAlpha": param(blend.get("blendOpAlpha")),
            "colMask": param(blend.get("colMask")),
        },
        "zTest": param(st.get("zTest")),
        "zWrite": param(st.get("zWrite")),
        "zClip": param(st.get("zClip")),
        "culling": param(st.get("culling")),
        "offsetFactor": param(st.get("offsetFactor")),
        "offsetUnits": param(st.get("offsetUnits")),
        "alphaToMask": param(st.get("alphaToMask")),
        "conservative": param(st.get("conservative")),
        "stencilRef": param(st.get("stencilRef")),
        "stencilReadMask": param(st.get("stencilReadMask")),
        "stencilWriteMask": param(st.get("stencilWriteMask")),
        "stencilOp": stencil_op(st.get("stencilOp")),
    }


def program_bindings(parsed):
    """Recover compiled property names, offsets, and texture bindings from ShaderLab metadata."""
    out = []
    for subshader in parsed.get("m_SubShaders", []):
        for shader_pass in subshader.get("m_Passes", []):
            names = {index: name for name, index in shader_pass.get("m_NameIndices", [])}
            textures = {}
            constant_buffers = {}
            for stage_name in ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain"):
                common = shader_pass.get(stage_name, {}).get("m_CommonParameters", {})
                for item in common.get("m_TextureParams", []):
                    name = names.get(item.get("m_NameIndex"))
                    if name:
                        textures[name] = {
                            "name": name,
                            "binding": int(item.get("m_Index", 0)) & 0xFFFFFF,
                            "dim": item.get("m_Dim"),
                        }
                for cb in common.get("m_ConstantBuffers", []):
                    name = names.get(cb.get("m_NameIndex"))
                    if not name:
                        continue
                    constant_buffers[name] = {
                        "name": name,
                        "size": cb.get("m_Size"),
                        "matrices": sorted(({
                            "name": names.get(item.get("m_NameIndex")),
                            "offset": item.get("m_Index"),
                            "arraySize": item.get("m_ArraySize"),
                            "type": item.get("m_Type"),
                            "rowCount": item.get("m_RowCount"),
                        } for item in cb.get("m_MatrixParams", [])), key=lambda item: item["offset"]),
                        "vectors": sorted(({
                            "name": names.get(item.get("m_NameIndex")),
                            "offset": item.get("m_Index"),
                            "arraySize": item.get("m_ArraySize"),
                            "type": item.get("m_Type"),
                            "dim": item.get("m_Dim"),
                        } for item in cb.get("m_VectorParams", [])), key=lambda item: item["offset"]),
                    }
            if textures or constant_buffers:
                out.append({
                    "name": shader_pass.get("m_Name", ""),
                    "type": shader_pass.get("m_Type"),
                    "programMask": shader_pass.get("m_ProgramMask"),
                    "textures": sorted(textures.values(), key=lambda item: item["binding"]),
                    "constantBuffers": sorted(constant_buffers.values(), key=lambda item: item["name"]),
                })
    return out


def main():
    raw = sys.stdin.read()
    start = min([i for i in (raw.find("{"), raw.find("[")) if i >= 0], default=-1)
    req = json.loads(raw[start:] if start >= 0 else raw)
    root = req["root"]
    wanted = set(req["shaders"])
    found = {}

    for dp, _, files in os.walk(root):
        for fn in files:
            try:
                env = UnityPy.load(os.path.join(dp, fn))
            except Exception:
                continue
            for obj in env.objects:
                if obj.type.name != "Shader":
                    continue
                try:
                    data = obj.read_typetree()
                except Exception:
                    continue
                full_name = data.get("m_ParsedForm", {}).get("m_Name", "")
                shader = full_name.split("/")[-1]
                if shader not in wanted:
                    continue
                texture_defaults = {}
                float_defaults = {}
                texture_props = []
                float_props = []
                color_defaults = {}
                vector_defaults = {}
                color_props = []
                vector_props = []
                keyword_names = data.get("m_ParsedForm", {}).get("m_KeywordNames", [])
                keyword_flags = data.get("m_ParsedForm", {}).get("m_KeywordFlags", [])
                pass_states = []
                for sub in data.get("m_ParsedForm", {}).get("m_SubShaders", []):
                    for p in sub.get("m_Passes", []):
                        pass_states.append(pass_state(p))
                variant = {
                    "fullName": full_name,
                    "sourcePath": os.path.join(dp, fn),
                    "keywords": keyword_names,
                    "keywordFlags": keyword_flags,
                    "passStates": pass_states,
                    "programBindings": program_bindings(data.get("m_ParsedForm", {})),
                }
                if shader in found:
                    found[shader]["variants"].append(variant)
                    continue
                props = data.get("m_ParsedForm", {}).get("m_PropInfo", {}).get("m_Props", [])
                for prop in props:
                    name = prop.get("m_Name")
                    tex = prop.get("m_DefTexture", {})
                    default_name = tex.get("m_DefaultName", "")
                    default_vec = [
                        prop.get("m_DefValue[0]"),
                        prop.get("m_DefValue[1]"),
                        prop.get("m_DefValue[2]"),
                        prop.get("m_DefValue[3]"),
                    ]
                    if prop.get("m_Type") == 4:
                        texture_props.append(name)
                        if default_name:
                            texture_defaults[name] = default_name
                    elif prop.get("m_Type") == 0:
                        color_props.append(name)
                        color_defaults[name] = default_vec
                    elif prop.get("m_Type") == 1:
                        vector_props.append(name)
                        vector_defaults[name] = default_vec
                    elif prop.get("m_Type") in (2, 3):
                        float_props.append(name)
                        float_defaults[name] = prop.get("m_DefValue[0]")
                found[shader] = {
                    "textures": texture_defaults,
                    "floats": float_defaults,
                    "colors": color_defaults,
                    "vectors": vector_defaults,
                    "textureProps": texture_props,
                    "floatProps": float_props,
                    "colorProps": color_props,
                    "vectorProps": vector_props,
                    "keywords": keyword_names,
                    "keywordFlags": keyword_flags,
                    "passStates": pass_states,
                    "programBindings": variant["programBindings"],
                    "variants": [variant],
                }

    json.dump({"found": found, "missing": sorted(wanted - set(found))}, sys.stdout, sort_keys=True)


if __name__ == "__main__":
    main()
