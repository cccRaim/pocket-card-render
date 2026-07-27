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
import os, sys, json, glob, argparse, re
import UnityPy
from extract_official_srp_batcher import (
    reflected_entries,
    reflection_references,
    serialized_reflections,
    witness_rows,
)
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

def shader_srp_incompatibility_witnesses(shader_tree, parsed):
    """Return decisive official reflection witnesses; absence is not proof of compatibility."""
    references = reflection_references(parsed)
    reflected = reflected_entries(shader_tree, references)
    serialized = serialized_reflections(parsed)
    return witness_rows(reflected, serialized)

def object_identity(obj):
    source = obj.assets_file.name
    path_id = int(obj.path_id)
    return {
        "fileId": 0,
        "pathId": str(path_id),
        "source": source,
        "identity": f"{source}:{path_id}",
    }

def pptr_identity(owner, pointer):
    pointer = pointer or {}
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if file_id == 0:
        source = owner.assets_file.name
    else:
        external = owner.assets_file.externals[file_id - 1]
        match = re.search(r"(CAB-[0-9a-f]+)", external.path, re.IGNORECASE)
        source = match.group(1) if match else external.path.replace("\\", "/")
    return {
        "fileId": file_id,
        "pathId": str(path_id),
        "source": source,
        "identity": f"{source}:{path_id}",
    }

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

    lod_group_renderers = set()
    for o in objs:
        if o.type.name != "LODGroup" or src_bundle(o) not in card_bundle_names: continue
        for lod in tt(o).get("m_LODs", []) or []:
            for renderer in (lod or {}).get("renderers", []) or []:
                if isinstance(renderer, dict) and (renderer or {}).get("m_PathID"):
                    lod_group_renderers.add(pptr_identity(o, renderer)["identity"])
    sorting_group_count = sum(
        1 for o in objs
        if o.type.name == "SortingGroup" and src_bundle(o) in card_bundle_names
    )

    gos, trans, rends, mats, texs = {}, {}, {}, {}, {}
    mono_behaviours = {}
    shaders = {}  # official Shader identity -> serialized name/keyword space
    meshes = {}   # path_id -> mesh name
    mf_by_go = {} # go path_id -> official Mesh PPtr identity (from MeshFilter)
    mesh_filters = {} # official MeshFilter identity -> GameObject/Mesh binding
    for o in objs:
        t = o.type.name; d = tt(o); oid = object_identity(o)["identity"]
        if t == "GameObject":
            gos[oid] = {"name": d.get("m_Name","")}
        elif t == "MeshFilter":
            mesh_pointer = d.get("m_Mesh") or {}
            go_ref = pptr_identity(o, d.get("m_GameObject") or {})
            mesh_ref = pptr_identity(o, mesh_pointer)
            mf_by_go[go_ref["identity"]] = mesh_ref
            mesh_filters[oid] = {
                "identity": object_identity(o),
                "goIdentity": go_ref["identity"],
                "meshIdentity": mesh_ref["identity"],
            }
        elif t == "Mesh":
            meshes[oid] = d.get("m_Name","")
        elif t in ("Transform","RectTransform"):
            go_ref = pptr_identity(o, d.get("m_GameObject") or {})
            father_ref = pptr_identity(o, d.get("m_Father") or {})
            trans[oid] = {"go": go_ref["identity"],
                "pos": d.get("m_LocalPosition"), "rot": d.get("m_LocalRotation"),
                "scale": d.get("m_LocalScale"), "father": father_ref["identity"] if father_ref["pathId"] != "0" else None}
        elif t == "MeshRenderer":
            if src_bundle(o) not in card_bundle_names: continue   # skip sibling-prefab renderers
            go_ref = pptr_identity(o, d.get("m_GameObject") or {})
            rends[oid] = {"go": go_ref["identity"], "rendererType": t,
                "identity": object_identity(o),
                "enabled": d.get("m_Enabled"), "sortingOrder": d.get("m_SortingOrder"),
                "sortingLayer": d.get("m_SortingLayerID"),
                "sortingLayerValue": d.get("m_SortingLayer"),
                "rendererPriority": d.get("m_RendererPriority"),
                "staticBatchInfo": d.get("m_StaticBatchInfo"),
                "lightmapIndex": d.get("m_LightmapIndex"),
                "lightmapIndexDynamic": d.get("m_LightmapIndexDynamic"),
                "sortingFudge": d.get("m_SortingFudge") if "m_SortingFudge" in d else None,
                "materials": [pptr_identity(o, m)
                              for m in d.get("m_Materials",[]) if isinstance(m,dict)]}
        elif t == "MonoBehaviour":
            mono_behaviours[oid] = (o, d)
        elif t == "Material":
            for field in ("m_CustomRenderQueue", "m_EnableInstancingVariants", "m_ValidKeywords", "m_InvalidKeywords"):
                if field not in d:
                    raise RuntimeError(f"Material {oid} is missing official serialized field {field}")
            sp = d.get("m_SavedProperties", {}) or {}
            texenvs = {}
            for k, v in kvlist(sp.get("m_TexEnvs", [])).items():
                v = v or {}
                texenvs[k] = {"tex_ref": pptr_identity(o, v.get("m_Texture") or {}),
                              "scale": v.get("m_Scale"), "offset": v.get("m_Offset")}
            shader_pointer = d.get("m_Shader") or {}
            shader_ref = pptr_identity(o, shader_pointer)
            mats[oid] = {"name": d.get("m_Name",""),
                "identity": object_identity(o),
                "shader_ref": shader_ref,
                "renderQueue": d["m_CustomRenderQueue"],
                "enableInstancingVariants": bool(d["m_EnableInstancingVariants"]),
                "keywords": d["m_ValidKeywords"],
                "invalidKeywords": d["m_InvalidKeywords"],
                "floats": {k: v for k, v in kvlist(sp.get("m_Floats", [])).items()},
                "ints": {k: v for k, v in kvlist(sp.get("m_Ints", [])).items()},
                "colors": {k: v for k, v in kvlist(sp.get("m_Colors", [])).items()},
                "texenvs": texenvs}
        elif t in ("Texture2D", "Cubemap"):
            texs[oid] = {
                "name": d.get("m_Name",""),
                "w": d.get("m_Width"),
                "h": d.get("m_Height"),
                "type": t,
                "assetPath": (getattr(o, "container", None) or "").replace("\\", "/"),
                "identity": object_identity(o),
            }
        elif t == "Shader":
            parsed = d.get("m_ParsedForm") or {}
            if "m_KeywordNames" not in parsed or "m_KeywordFlags" not in parsed:
                raise RuntimeError(f"Shader {oid} is missing its official serialized keyword space")
            if len(parsed["m_KeywordNames"]) != len(parsed["m_KeywordFlags"]):
                raise RuntimeError(f"Shader {oid} keyword names/flags length mismatch")
            nm = parsed.get("m_Name") or d.get("m_Name","")
            srp_witnesses = shader_srp_incompatibility_witnesses(d, parsed)
            shaders[oid] = {
                "name": nm,
                "keywordNames": parsed["m_KeywordNames"],
                "keywordFlags": parsed["m_KeywordFlags"],
                "srpBatcherCompatible": 0 if srp_witnesses else None,
                "srpBatcherEvidence": "non-UnityPerDraw-unity_ObjectToWorld" if srp_witnesses else None,
                "srpBatcherWitnessCount": len(srp_witnesses),
            }

    kira_fields = {
        "_renderer", "_settings", "_rampRepeat", "_scrollScale",
        "_scrollOffset", "_vertScaleSpeed", "_scaleAnimationOffset",
    }
    kira_by_renderer = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not kira_fields.issubset(d):
            continue
        renderer_ref = pptr_identity(o, d["_renderer"] or {})
        settings_ref = pptr_identity(o, d["_settings"] or {})
        renderer_identity = renderer_ref["identity"]
        if renderer_ref["pathId"] == "0" or settings_ref["pathId"] == "0":
            raise RuntimeError(f"KiraPuyoObject {component_identity} has a null renderer/settings PPtr")
        if renderer_identity in kira_by_renderer:
            raise RuntimeError(f"renderer {renderer_identity} has multiple KiraPuyoObject components")
        kira_by_renderer[renderer_identity] = {
            "componentIdentity": component_identity,
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "settingsIdentity": settings_ref["identity"],
            "rampRepeat": d["_rampRepeat"],
            "scrollScale": d["_scrollScale"],
            "scrollOffset": d["_scrollOffset"],
            "vertScaleSpeed": d["_vertScaleSpeed"],
            "scaleAnimationOffset": d["_scaleAnimationOffset"],
        }

    kira_settings = {}
    for settings_identity in sorted({v["settingsIdentity"] for v in kira_by_renderer.values()}):
        row = mono_behaviours.get(settings_identity)
        if not row:
            raise RuntimeError(f"KiraPuyo settings object {settings_identity} was not resolved; include Common/CardNew/Common via --shared")
        o, d = row
        if not {"Curve", "Min", "Max"}.issubset(d):
            raise RuntimeError(f"KiraPuyo settings object {settings_identity} has an unexpected type tree")
        curve = d["Curve"] or {}
        keys = curve.get("m_Curve") or []
        required_key_fields = ("time", "value", "inSlope", "outSlope", "weightedMode", "inWeight", "outWeight")
        if not keys or any(not set(required_key_fields).issubset(key or {}) for key in keys):
            raise RuntimeError(f"KiraPuyo settings object {settings_identity} has an incomplete AnimationCurve")
        kira_settings[settings_identity] = {
            "name": d.get("m_Name", ""),
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "curve": {
                "keys": [{field: key[field] for field in required_key_fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            },
            "min": d["Min"],
            "max": d["Max"],
        }

    circular_fields = {
        "_movingKiraARenderer", "_movingKiraBRenderer", "_defaultCircularAnglePattern",
        "_defaultCircularAngleManual", "_tiltPower", "_tiltThreshold", "_tiltStateChangeDelay",
        "_rotateAccel", "_brakeDuration", "_primTypeASymmetryCount", "_primTypeBSymmetryCount",
        "_primTypeCSymmetryCount", "_prims", "_trailKiraARenderer", "_trailKiraBRenderer",
        "_trailKiraAMeshFilter", "_trailKiraBMeshFilter", "_meshDivideCount", "_moveAngleScale",
        "_centerIntensity", "_fadeOut", "_fadeOutEnd", "_expandLength", "_expandPower",
        "_useLengthLimit", "_limitLengthRatio", "_LimitAdjustCurvePower", "_LimitAdjustSpeed",
        "_useDistanceFadeOut", "_distanceFadeOutSpeed", "_distanceFadeOutCurvePower",
    }
    circular_primitive_fields = (
        "PrimType", "BaseScale", "BaseIntensity", "MinIntensity", "MaxIntensity",
        "FlickerSpeed", "FlickerScaling", "StartAngle", "UseMorphing",
        "UseMorphingNoise", "MorphingSpeed", "MorphingClearly", "MaxRotateSpeed",
        "ReverseRotation",
    )
    circular_scalar_map = {
        "defaultCircularAnglePattern": "_defaultCircularAnglePattern",
        "defaultCircularAngleManual": "_defaultCircularAngleManual",
        "tiltPower": "_tiltPower",
        "tiltThreshold": "_tiltThreshold",
        "tiltStateChangeDelay": "_tiltStateChangeDelay",
        "rotateAccel": "_rotateAccel",
        "brakeDuration": "_brakeDuration",
        "primTypeASymmetryCount": "_primTypeASymmetryCount",
        "primTypeBSymmetryCount": "_primTypeBSymmetryCount",
        "primTypeCSymmetryCount": "_primTypeCSymmetryCount",
        "meshDivideCount": "_meshDivideCount",
        "moveAngleScale": "_moveAngleScale",
        "centerIntensity": "_centerIntensity",
        "fadeOut": "_fadeOut",
        "fadeOutEnd": "_fadeOutEnd",
        "expandLength": "_expandLength",
        "expandPower": "_expandPower",
        "useLengthLimit": "_useLengthLimit",
        "limitLengthRatio": "_limitLengthRatio",
        "limitAdjustCurvePower": "_LimitAdjustCurvePower",
        "limitAdjustSpeed": "_LimitAdjustSpeed",
        "useDistanceFadeOut": "_useDistanceFadeOut",
        "distanceFadeOutSpeed": "_distanceFadeOutSpeed",
        "distanceFadeOutCurvePower": "_distanceFadeOutCurvePower",
        "isAnimationStopped": "<IsAnimationStopped>k__BackingField",
    }
    circular_by_renderer = {}
    circular_settings = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not circular_fields.issubset(d):
            continue
        renderer_bindings = {
            "movingA": pptr_identity(o, d["_movingKiraARenderer"] or {}),
            "movingB": pptr_identity(o, d["_movingKiraBRenderer"] or {}),
            "trailA": pptr_identity(o, d["_trailKiraARenderer"] or {}),
            "trailB": pptr_identity(o, d["_trailKiraBRenderer"] or {}),
        }
        mesh_filter_bindings = {
            "trailA": pptr_identity(o, d["_trailKiraAMeshFilter"] or {}),
            "trailB": pptr_identity(o, d["_trailKiraBMeshFilter"] or {}),
        }
        if any(ref["pathId"] == "0" for ref in (*renderer_bindings.values(), *mesh_filter_bindings.values())):
            raise RuntimeError(f"CircularKiraObject {component_identity} has a null Renderer/MeshFilter PPtr")
        for role, renderer_ref in renderer_bindings.items():
            renderer_identity = renderer_ref["identity"]
            if renderer_identity not in rends:
                raise RuntimeError(f"CircularKiraObject {component_identity} {role} renderer was not resolved")
            if renderer_identity in circular_by_renderer:
                raise RuntimeError(f"renderer {renderer_identity} has multiple CircularKiraObject bindings")
            circular_by_renderer[renderer_identity] = {
                "componentIdentity": component_identity,
                "role": role,
            }
        for role, mesh_filter_ref in mesh_filter_bindings.items():
            mesh_filter = mesh_filters.get(mesh_filter_ref["identity"])
            renderer = rends[renderer_bindings[role]["identity"]]
            if not mesh_filter:
                raise RuntimeError(f"CircularKiraObject {component_identity} {role} MeshFilter was not resolved")
            if mesh_filter["goIdentity"] != renderer["go"]:
                raise RuntimeError(f"CircularKiraObject {component_identity} {role} Renderer/MeshFilter GameObject mismatch")
        prims = d["_prims"] or []
        if not prims or any(not set(circular_primitive_fields).issubset(prim or {}) for prim in prims):
            raise RuntimeError(f"CircularKiraObject {component_identity} has an incomplete primitive array")
        circular_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": pptr_identity(o, d.get("m_GameObject") or {})["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "rendererBindings": {role: ref["identity"] for role, ref in renderer_bindings.items()},
            "meshFilterBindings": {role: ref["identity"] for role, ref in mesh_filter_bindings.items()},
            **{name: d[field] for name, field in circular_scalar_map.items()},
            "primitives": [
                {field[0].lower() + field[1:]: prim[field] for field in circular_primitive_fields}
                for prim in prims
            ],
        }

    def tex_binding(ref):
        if not ref or ref.get("pathId") == "0": return None
        key = ref["identity"]
        if key not in texs:
            return {"tex": f"pptr:{key}", "textureIdentity": ref}
        texture = texs[key]
        binding = {
            "tex": texture["name"],
            "textureIdentity": texture["identity"],
        }
        if texture["assetPath"]:
            binding["assetPath"] = texture["assetPath"]
        return binding
    def go_name(key): return gos.get(key, {}).get("name", f"?{key}")

    tr_by_go = {v["go"]: (k, v) for k, v in trans.items() if v.get("go")}
    def go_path(pid_go):
        names = []
        cur_go = pid_go
        guard = 0
        while cur_go and guard < 80:
            guard += 1
            names.append(go_name(cur_go))
            current = tr_by_go.get(cur_go)
            father = current[1].get("father") if current else None
            cur_go = trans.get(father, {}).get("go") if father else None
        if cur_go:
            raise RuntimeError(f"GameObject hierarchy exceeded guard while resolving {pid_go}")
        return "/".join(reversed(names))

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

    for config in circular_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CircularKiraObject GameObject {component_go_identity} was not resolved")
        config["componentGoPath"] = go_path(component_go_identity)

    # optional: shader render state by name (blend/stencil/ztest/zwrite/queue), if a card_shader_state.json is given
    sstate = {}
    if args.shader_state:
        try: sstate = json.load(open(args.shader_state, encoding="utf-8"))
        except Exception as e: print(f"(shader-state not merged: {e})", file=sys.stderr)

    layers = []
    for renderer_key, r in rends.items():
        w = world(r["go"])
        for material_slot, material_ref in enumerate(r["materials"]):
            m = mats.get(material_ref["identity"], {})
            shader_ref = m.get("shader_ref") or {}
            shader_key = shader_ref.get("identity")
            shader_info = shaders.get(shader_key) or {}
            sname = shader_info.get("name", f"pptr:{shader_key}")
            texenvs = {}
            for k, v in (m.get("texenvs") or {}).items():
                if v["tex_ref"].get("pathId") == "0":
                    continue
                binding = tex_binding(v["tex_ref"])
                texenvs[k] = {
                    **binding,
                    "scale": v["scale"],
                    "offset": v["offset"],
                }
            mesh_ref = mf_by_go.get(r["go"])
            mesh_key = mesh_ref.get("identity") if mesh_ref else None
            mesh_name = meshes.get(mesh_key) or (f"pptr:{mesh_key}" if mesh_key else None)
            renderer_properties = {}
            if renderer_key in kira_by_renderer:
                renderer_properties["kiraPuyo"] = kira_by_renderer[renderer_key]
            if renderer_key in circular_by_renderer:
                renderer_properties["circularKira"] = circular_by_renderer[renderer_key]
            layers.append({
                "go": go_name(r["go"]), "goPath": go_path(r["go"]), "renderer_enabled": r["enabled"],
                "rendererIdentity": r["identity"],
                "rendererType": r["rendererType"],
                "rendererPriority": r["rendererPriority"],
                "lodGroupMember": renderer_key in lod_group_renderers,
                "sortingGroupCount": sorting_group_count,
                "materialSlot": material_slot,
                "staticBatchInfo": r["staticBatchInfo"],
                "lightmapIndex": r["lightmapIndex"],
                "lightmapIndexDynamic": r["lightmapIndexDynamic"],
                "sortingLayer": r["sortingLayer"],
                "sortingLayerValue": r["sortingLayerValue"],
                "sortingOrder": r["sortingOrder"],
                "sortingFudge": r["sortingFudge"],
                "material": m.get("name"), "materialIdentity": material_ref,
                "shader": sname, "shaderIdentity": shader_ref,
                "shaderKeywordNames": shader_info.get("keywordNames"),
                "shaderKeywordFlags": shader_info.get("keywordFlags"),
                "srpBatcherCompatible": shader_info.get("srpBatcherCompatible"),
                "srpBatcherEvidence": shader_info.get("srpBatcherEvidence"),
                "srpBatcherWitnessCount": shader_info.get("srpBatcherWitnessCount"),
                "mesh": mesh_name, "meshIdentity": mesh_ref,
                "renderQueue": m.get("renderQueue"), "keywords": m.get("keywords"),
                "enableInstancingVariants": m.get("enableInstancingVariants"),
                "invalidKeywords": m.get("invalidKeywords"),
                "world": w,
                "rendererProperties": renderer_properties,
                "textures": texenvs,
                "floats": m.get("floats"), "ints": m.get("ints"), "colors": m.get("colors"),
                "shader_state": sstate.get(sname),
            })
    layers.sort(key=lambda L: (round((L["world"]["z"] or 0), 4), L["material"] or ""))

    out = os.path.abspath(args.out)
    json.dump({"card": os.path.basename(args.path.rstrip("/\\")), "layers": layers,
               "runtimeSettings": {"kiraPuyo": kira_settings, "circularKira": circular_settings}},
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
