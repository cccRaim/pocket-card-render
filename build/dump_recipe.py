#!/usr/bin/env python3
"""dump_recipe.py — generate a card's MATERIAL RECIPE (<illId>_render_full.json) from the DECRYPTED
Unity material bundles. This is the one input the renderer needs that the AssetRipper glb does NOT
carry (the glb has geometry + material NAMES only). See ASSETS.md / SETUP.md.

For every MeshRenderer it dumps each material's full m_Floats / m_Colors / m_TexEnvs (texture name +
scale + offset), shaderKeywords, render queue, the resolved shader NAME, and the accumulated world
transform. Optionally merges shader render-state (blend/stencil/queue) from a card_shader_state.json.

Requires:  pip install UnityPy        (reads the decrypted *_bundles files — bring your own.)

Usage:
  python build/dump_recipe.py <DECRYPTED>/Common/CardNew/Face/<illId>/L \\
      --shared <DECRYPTED>/Common/CardNew/Common --shared <DECRYPTED>/Common/Shader \\
      --out <illId>_render_full.json
"""
import os, sys, json, glob, argparse
import UnityPy
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

def tt(o):
    try: return o.read_typetree()
    except Exception: return {}

def kvlist(lst):
    """Unity serializes maps as [[k,v],...] OR [{'first':k,'second':v}]. Normalize."""
    out = {}
    for kv in lst or []:
        if isinstance(kv, (list, tuple)) and len(kv) == 2:
            k, v = kv
        elif isinstance(kv, dict):
            k, v = kv.get("first"), kv.get("second")
        else:
            continue
        out[k] = v
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="the card's decrypted Face/<illId>/L dir (its prefab bundle root)")
    ap.add_argument("--shared", action="append", default=[], help="extra shared bundle dir(s) so PPtrs resolve (Common/CardNew/Common, Common/Shader)")
    ap.add_argument("--out", default="card_render_full.json", help="output recipe path")
    ap.add_argument("--shader-state", default=None, help="optional card_shader_state.json to merge per-shader render state")
    args = ap.parse_args()

    # load prefab + every bundle under the card root + shared dirs so cross-bundle PPtrs resolve
    files = [args.path]
    card_bundles = glob.glob(os.path.join(args.path, "**", "*_bundles"), recursive=True)
    files += card_bundles
    for sd in args.shared:
        files += glob.glob(os.path.join(sd, "**", "*_bundles"), recursive=True)
    # only renderers from THESE bundles are emitted as layers; shared bundles exist purely to resolve
    # PPtrs (materials/textures/shaders/meshes) — NOT to inject sibling prefabs' renderers.
    card_bundle_names = {os.path.basename(p) for p in [args.path] + card_bundles}
    def src_bundle(o):
        p = getattr(getattr(o, "assets_file", None), "parent", None)
        return getattr(p, "name", None)
    env = None
    for _ in range(5):
        env = UnityPy.load(*files)
        if any(o.type.name == "Material" for o in env.objects): break
    objs = list(env.objects)

    gos, trans, rends, mats, texs = {}, {}, {}, {}, {}
    shaders = {}  # path_id -> shader name
    meshes = {}   # path_id -> mesh name
    mf_by_go = {} # go path_id -> mesh path_id (from MeshFilter)
    for o in objs:
        t = o.type.name; d = tt(o)
        if t == "GameObject":
            gos[o.path_id] = {"name": d.get("m_Name",""),
                              "components": [c.get("m_PathID") for c in d.get("m_Component",[]) if isinstance(c,dict)]}
        elif t == "MeshFilter":
            mf_by_go[(d.get("m_GameObject") or {}).get("m_PathID")] = (d.get("m_Mesh") or {}).get("m_PathID")
        elif t == "Mesh":
            meshes[o.path_id] = d.get("m_Name","")
        elif t in ("Transform","RectTransform"):
            trans[o.path_id] = {"go": (d.get("m_GameObject") or {}).get("m_PathID"),
                "pos": d.get("m_LocalPosition"), "rot": d.get("m_LocalRotation"),
                "scale": d.get("m_LocalScale"), "father": (d.get("m_Father") or {}).get("m_PathID")}
        elif t == "MeshRenderer":
            if src_bundle(o) not in card_bundle_names: continue   # skip sibling-prefab renderers
            rends[o.path_id] = {"go": (d.get("m_GameObject") or {}).get("m_PathID"),
                "enabled": d.get("m_Enabled"), "sortingOrder": d.get("m_SortingOrder"),
                "sortingLayer": d.get("m_SortingLayerID"),
                "materials": [m.get("m_PathID") for m in d.get("m_Materials",[]) if isinstance(m,dict)]}
        elif t == "Material":
            sp = d.get("m_SavedProperties", {}) or {}
            texenvs = {}
            for k, v in kvlist(sp.get("m_TexEnvs", [])).items():
                v = v or {}
                texenvs[k] = {"tex_pid": ((v.get("m_Texture") or {}).get("m_PathID")),
                              "scale": v.get("m_Scale"), "offset": v.get("m_Offset")}
            mats[o.path_id] = {"name": d.get("m_Name",""),
                "shader_pid": (d.get("m_Shader") or {}).get("m_PathID"),
                "renderQueue": d.get("m_CustomRenderQueue"),
                "keywords": d.get("m_ShaderKeywords") or d.get("m_ValidKeywords"),
                "floats": {k: v for k, v in kvlist(sp.get("m_Floats", [])).items()},
                "ints": {k: v for k, v in kvlist(sp.get("m_Ints", [])).items()},
                "colors": {k: v for k, v in kvlist(sp.get("m_Colors", [])).items()},
                "texenvs": texenvs}
        elif t in ("Texture2D", "Cubemap"):
            texs[o.path_id] = {"name": d.get("m_Name",""), "w": d.get("m_Width"), "h": d.get("m_Height"), "type": t}
        elif t == "Shader":
            nm = (d.get("m_ParsedForm") or {}).get("m_Name") or d.get("m_Name","")
            shaders[o.path_id] = nm

    def tex_name(pid):
        if not pid: return None
        if pid in texs: return texs[pid]["name"]
        return f"pptr:{pid}"
    def go_name(pid): return gos.get(pid, {}).get("name", f"?{pid}")

    tr_by_go = {v["go"]: (k, v) for k, v in trans.items() if v.get("go")}
    def world(pid_go):
        x=y=z=0.0; sx=sy=sz=1.0; cur = tr_by_go.get(pid_go); g=0; rot=None
        while cur and g < 40:
            _, tv = cur; g += 1
            p = tv.get("pos") or {}; s = tv.get("scale") or {}
            x += p.get("x",0); y += p.get("y",0); z += p.get("z",0)
            sx *= s.get("x",1); sy *= s.get("y",1); sz *= s.get("z",1)
            if rot is None: rot = tv.get("rot")
            f = tv.get("father"); cur = (f, trans[f]) if f in trans else None
        return {"x":x,"y":y,"z":z,"sx":sx,"sy":sy,"sz":sz,"rot":rot}

    # optional: shader render state by name (blend/stencil/ztest/zwrite/queue), if a card_shader_state.json is given
    sstate = {}
    if args.shader_state:
        try: sstate = json.load(open(args.shader_state, encoding="utf-8"))
        except Exception as e: print(f"(shader-state not merged: {e})", file=sys.stderr)

    layers = []
    for rpid, r in rends.items():
        w = world(r["go"])
        for mpid in r["materials"]:
            m = mats.get(mpid, {})
            sname = shaders.get(m.get("shader_pid"), f"pptr:{m.get('shader_pid')}")
            texenvs = {k: {"tex": tex_name(v["tex_pid"]), "scale": v["scale"], "offset": v["offset"]}
                       for k, v in (m.get("texenvs") or {}).items() if v["tex_pid"]}
            mesh_pid = mf_by_go.get(r["go"])
            mesh_name = meshes.get(mesh_pid) or (f"pptr:{mesh_pid}" if mesh_pid else None)
            layers.append({
                "go": go_name(r["go"]), "renderer_enabled": r["enabled"],
                "sortingOrder": r["sortingOrder"],
                "material": m.get("name"), "shader": sname,
                "mesh": mesh_name,
                "renderQueue": m.get("renderQueue"), "keywords": m.get("keywords"),
                "world": w,
                "textures": texenvs,
                "floats": m.get("floats"), "ints": m.get("ints"), "colors": m.get("colors"),
                "shader_state": sstate.get(sname),
            })
    layers.sort(key=lambda L: (round((L["world"]["z"] or 0), 4), L["material"] or ""))

    out = os.path.abspath(args.out)
    json.dump({"card": os.path.basename(args.path.rstrip("/\\")), "layers": layers},
              open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False, default=str)
    print(f"materials:{len(mats)} renderers:{len(rends)} shaders_resolved:{len(shaders)} -> {len(layers)} layers")
    print(f"wrote {out}")
    # quick console summary: per layer, the FULL float/color set
    for L in layers:
        print(f"\n[{L['material']}] shader={L['shader']} go={L['go']} z={L['world']['z']:+.4f} sort={L['sortingOrder']} q={L['renderQueue']}")
        texstr = ", ".join(f"{k}={v['tex']}" for k, v in L['textures'].items())
        print(f"   tex: {{ {texstr} }}")
        print(f"   floats: {json.dumps(L['floats'])}")
        if L['colors']: print(f"   colors: {json.dumps(L['colors'])}")
        if L['keywords']: print(f"   keywords: {L['keywords']}")

if __name__ == "__main__":
    main()
