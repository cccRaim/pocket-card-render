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
import os, sys, json, glob, argparse, re, hashlib
import UnityPy
from extract_official_srp_batcher import (
    reflected_entries,
    reflection_references,
    serialized_reflections,
    witness_rows,
)
DEFAULT_UNITY_VERSION = "2022.3.62f2"
UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get(
    "PCR_UNITY_VERSION",
    DEFAULT_UNITY_VERSION,
)
CAB_RE = re.compile(rb"CAB-[0-9a-fA-F]{32}")
QUEUE_BASES = {
    "Background": 1000,
    "Geometry": 2000,
    "AlphaTest": 2450,
    "Transparent": 3000,
    "Overlay": 4000,
}

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()

def canonical_digest(value):
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256_bytes(encoded)

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

def resolve_shader_queue_tag(tag):
    if tag is None:
        return QUEUE_BASES["Geometry"], "shaderlab-default-geometry"
    match = re.fullmatch(r"([A-Za-z]+)([+-]\d+)?", str(tag))
    if not match or match.group(1) not in QUEUE_BASES:
        raise RuntimeError(f"unresolved serialized Shader Queue tag {tag!r}")
    return (
        QUEUE_BASES[match.group(1)] + int(match.group(2) or 0),
        "serialized-shader-queue-tag",
    )

def shader_queue_evidence(shader_identity, parsed):
    subshaders = parsed.get("m_SubShaders") or []
    if not subshaders:
        raise RuntimeError(f"Shader {shader_identity} has no serialized SubShader")
    rows = []
    for index, subshader in enumerate(subshaders):
        tags = kvlist((subshader.get("m_Tags") or {}).get("tags") or [])
        queue_tag = next(
            (value for key, value in tags.items() if str(key).lower() == "queue"),
            None,
        )
        effective_queue, source = resolve_shader_queue_tag(queue_tag)
        rows.append({
            "subshader": index,
            "queueTag": queue_tag,
            "effectiveRenderQueue": effective_queue,
            "source": source,
        })
    effective_queues = {row["effectiveRenderQueue"] for row in rows}
    if len(effective_queues) != 1:
        raise RuntimeError(
            f"Shader {shader_identity} has subshader-dependent render queues: {rows}"
        )
    return {
        "effectiveRenderQueue": next(iter(effective_queues)),
        "source": "serialized-shader-subshader-tags",
        "subshaders": rows,
    }

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

def saved_properties_evidence(owner, saved):
    ints = [[k, v] for k, v in kvlist(saved.get("m_Ints", [])).items()]
    floats = [[k, v] for k, v in kvlist(saved.get("m_Floats", [])).items()]
    colors = [[k, v] for k, v in kvlist(saved.get("m_Colors", [])).items()]
    textures = []
    for name, value in kvlist(saved.get("m_TexEnvs", [])).items():
        value = value or {}
        pointer = value.get("m_Texture") or {}
        identity = pptr_identity(owner, pointer)
        textures.append({
            "name": name,
            "texture": identity["identity"]
                if identity["pathId"] != "0" else None,
            "scale": value.get("m_Scale"),
            "offset": value.get("m_Offset"),
        })
    record = {
        "ints": ints,
        "floats": floats,
        "colors": colors,
        "textures": textures,
    }
    return {
        "digest": canonical_digest(record),
        "textureBindings": len(textures),
        "nonNullTextures": sum(row["texture"] is not None for row in textures),
        "textureIdentitiesSha256": canonical_digest(
            [[row["name"], row["texture"]] for row in textures]
        ),
    }

def nearest_decrypted_root(path):
    current = os.path.abspath(path)
    while True:
        if os.path.basename(current).lower() == "decrypted":
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent

def bundle_owner_cab(path):
    """Read the uncompressed UnityFS owner CAB name from the bundle header."""
    try:
        with open(path, "rb") as fh:
            header = fh.read(512)
    except OSError:
        return None
    match = CAB_RE.search(header)
    return match.group(0).decode("ascii") if match else None

def locate_cab_bundles(roots, targets):
    remaining = set(targets)
    located = {}
    for root in roots:
        if not remaining:
            break
        candidates = [root] if os.path.isfile(root) else glob.iglob(
            os.path.join(root, "**", "*_bundles"), recursive=True
        )
        for path in candidates:
            cab = bundle_owner_cab(path)
            if cab not in remaining:
                continue
            normalized = os.path.abspath(path)
            previous = located.get(cab)
            if previous and os.path.normcase(previous) != os.path.normcase(normalized):
                raise RuntimeError(
                    f"official CAB {cab} has multiple owning bundles: "
                    f"{previous} and {normalized}"
                )
            located[cab] = normalized
            remaining.remove(cab)
            if not remaining:
                break
    if remaining:
        raise RuntimeError(
            "could not locate official dependency bundle(s): "
            + ", ".join(sorted(remaining))
        )
    return located

def required_dependency_cabs(env, card_bundle_names):
    """Return unresolved direct dependencies required by current-card draws."""
    objects = list(env.objects)
    loaded_cabs = {str(obj.assets_file.name) for obj in objects}
    object_by_identity = {
        f"{obj.assets_file.name}:{int(obj.path_id)}": obj
        for obj in objects
    }
    selected_materials = set()
    pointers = []

    def source_bundle(obj):
        parent = getattr(getattr(obj, "assets_file", None), "parent", None)
        return getattr(parent, "name", None)

    for obj in objects:
        if source_bundle(obj) not in card_bundle_names:
            continue
        tree = tt(obj)
        if obj.type.name == "MeshRenderer":
            for pointer in tree.get("m_Materials", []) or []:
                if not isinstance(pointer, dict):
                    continue
                identity = pptr_identity(obj, pointer)
                if identity["pathId"] != "0":
                    selected_materials.add(identity["identity"])
                    pointers.append(identity)
        elif obj.type.name == "MeshFilter":
            pointer = tree.get("m_Mesh") or {}
            if isinstance(pointer, dict):
                identity = pptr_identity(obj, pointer)
                if identity["pathId"] != "0":
                    pointers.append(identity)

    for identity in selected_materials:
        material_obj = object_by_identity.get(identity)
        if material_obj is None:
            continue
        tree = tt(material_obj)
        shader = pptr_identity(material_obj, tree.get("m_Shader") or {})
        if shader["pathId"] != "0":
            pointers.append(shader)
        saved = tree.get("m_SavedProperties") or {}
        for value in kvlist(saved.get("m_TexEnvs", [])).values():
            texture = pptr_identity(material_obj, (value or {}).get("m_Texture") or {})
            if texture["pathId"] != "0":
                pointers.append(texture)

    return {
        pointer["source"]
        for pointer in pointers
        if pointer["source"].startswith("CAB-")
        and pointer["source"] not in loaded_cabs
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="the card's decrypted Face/<illId>/L dir (its prefab bundle root)")
    ap.add_argument("--shared", action="append", default=[], help="extra shared bundle dir(s) so PPtrs resolve (Common/CardNew/Common, Common/Shader)")
    ap.add_argument("--dependency-root", action="append", default=[],
                    help="bundle root(s) used to locate unresolved direct PPtrs by owner CAB")
    ap.add_argument(
        "--unity-version",
        default=os.environ.get("PCR_UNITY_VERSION", DEFAULT_UNITY_VERSION),
        help="Unity serialized version used when a bundle omits its version string",
    )
    ap.add_argument("--out", default="card_render_full.json", help="output recipe path")
    ap.add_argument("--shader-state", default=None, help="optional card_shader_state.json to merge per-shader render state")
    args = ap.parse_args()
    UnityPy.config.FALLBACK_UNITY_VERSION = args.unity_version

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
    dependency_roots = [os.path.abspath(root) for root in args.dependency_root]
    inferred_root = nearest_decrypted_root(args.path)
    if inferred_root and inferred_root not in dependency_roots:
        dependency_roots.append(inferred_root)
    env = None
    located_dependencies = {}
    for _ in range(8):
        env = UnityPy.load(*files)
        missing_cabs = required_dependency_cabs(env, card_bundle_names)
        if not missing_cabs:
            break
        if not dependency_roots:
            raise RuntimeError(
                "unresolved official dependencies require --dependency-root: "
                + ", ".join(sorted(missing_cabs))
            )
        new_locations = locate_cab_bundles(dependency_roots, missing_cabs)
        for cab, dependency_path in new_locations.items():
            previous = located_dependencies.get(cab)
            if previous and previous != dependency_path:
                raise RuntimeError(f"official CAB {cab} dependency location changed")
            located_dependencies[cab] = dependency_path
            if dependency_path not in files:
                files.append(dependency_path)
    else:
        raise RuntimeError("official dependency closure exceeded 8 passes")
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
            raw = bytes(o.get_raw_data())
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
                "rawByteSize": len(raw),
                "rawSha256": sha256_bytes(raw),
                "savedProperties": saved_properties_evidence(o, sp),
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
            queue_evidence = shader_queue_evidence(oid, parsed)
            search_tags = sorted({
                value
                for subshader in (parsed.get("m_SubShaders") or [])
                for key, value in ((subshader.get("m_Tags") or {}).get("tags") or [])
                if key == "SearchTag"
            })
            shaders[oid] = {
                "name": nm,
                "keywordNames": parsed["m_KeywordNames"],
                "keywordFlags": parsed["m_KeywordFlags"],
                "searchTags": search_tags,
                "renderQueue": queue_evidence,
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

    future_fields = {
        "_animationTexFrameCount", "_animationFrameCount", "_animSwitchSpeed",
        "_animFrameOffset", "_skipAnimThreshold", "_accellRatio",
        "<IsAnimationStopped>k__BackingField",
    }
    future_settings = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not future_fields.issubset(d):
            continue
        component_go = pptr_identity(o, d.get("m_GameObject") or {})
        if component_go["pathId"] == "0":
            raise RuntimeError(f"CardFutureObject {component_identity} has a null GameObject PPtr")
        future_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": component_go["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "rendererBindings": [],
            "animationTexFrameCount": d["_animationTexFrameCount"],
            "animationFrameCount": d["_animationFrameCount"],
            "animSwitchSpeed": d["_animSwitchSpeed"],
            "animFrameOffset": d["_animFrameOffset"],
            "skipAnimThreshold": d["_skipAnimThreshold"],
            "accellRatio": d["_accellRatio"],
            "isAnimationStopped": d["<IsAnimationStopped>k__BackingField"],
        }

    ancient_fields = {
        "_animCurveSettings", "_animCurveScale", "_animStartDelayRangeA",
        "_animStartDelayRangeB", "_changeRangeStart", "_changeRangeEnd",
        "_zuzuGoalAnimThreshold", "_goalThreshold", "_scrolls", "_scrollLength",
        "_shapeChangeSpeed", "_dot2Multiply", "_accellRatio", "_diffOffset",
        "_shakeAIntensity", "_shakeAFrequency", "_shakeBIntensity",
        "_shakeBFrequency", "_shakeSpeed", "_noiseScale", "_sandParticleSystems",
        "_sand2ParticleSystems", "_frictionScale", "_maxFriction",
        "_startSandBaseEmissionRate", "_middleSandBaseEmissionRate",
        "_endSandBaseEmissionRate",
    }
    ancient_scalar_map = {
        "animCurveScale": "_animCurveScale",
        "animStartDelayRangeA": "_animStartDelayRangeA",
        "animStartDelayRangeB": "_animStartDelayRangeB",
        "changeRangeStart": "_changeRangeStart",
        "changeRangeEnd": "_changeRangeEnd",
        "zuzuGoalAnimThreshold": "_zuzuGoalAnimThreshold",
        "goalThreshold": "_goalThreshold",
        "scrollLength": "_scrollLength",
        "shapeChangeSpeed": "_shapeChangeSpeed",
        "dot2Multiply": "_dot2Multiply",
        "accellRatio": "_accellRatio",
        "diffOffset": "_diffOffset",
        "shakeSpeed": "_shakeSpeed",
        "noiseScale": "_noiseScale",
        "frictionScale": "_frictionScale",
        "maxFriction": "_maxFriction",
        "startSandBaseEmissionRate": "_startSandBaseEmissionRate",
        "middleSandBaseEmissionRate": "_middleSandBaseEmissionRate",
        "endSandBaseEmissionRate": "_endSandBaseEmissionRate",
    }
    ancient_vector_map = {
        "shakeAIntensity": "_shakeAIntensity",
        "shakeAFrequency": "_shakeAFrequency",
        "shakeBIntensity": "_shakeBIntensity",
        "shakeBFrequency": "_shakeBFrequency",
    }
    ancient_settings = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not ancient_fields.issubset(d):
            continue
        component_go = pptr_identity(o, d.get("m_GameObject") or {})
        curve_settings = pptr_identity(o, d["_animCurveSettings"] or {})
        if component_go["pathId"] == "0" or curve_settings["pathId"] == "0":
            raise RuntimeError(f"CardAncientObject {component_identity} has a null GameObject/settings PPtr")
        scrolls = d["_scrolls"] or []
        if len(scrolls) < 6 or any(not isinstance(value, (int, float)) for value in scrolls):
            raise RuntimeError(f"CardAncientObject {component_identity} has an incomplete scroll table")
        ancient_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": component_go["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "curveSettingsIdentity": curve_settings["identity"],
            "rendererBindings": [],
            "scrolls": scrolls,
            "sandParticleSystemBindings": [
                pptr_identity(o, pointer or {})["identity"]
                for pointer in (d["_sandParticleSystems"] or [])
            ],
            "sand2ParticleSystemBindings": [
                pptr_identity(o, pointer or {})["identity"]
                for pointer in (d["_sand2ParticleSystems"] or [])
            ],
            "isAnimationStopped": 0,
            **{name: d[field] for name, field in ancient_scalar_map.items()},
            **{
                name: {"x": d[field]["x"], "y": d[field]["y"]}
                for name, field in ancient_vector_map.items()
            },
        }

    curve_fields = ("time", "value", "inSlope", "outSlope", "weightedMode", "inWeight", "outWeight")
    ancient_curve_names = ("ZuzuA", "ZuzuB", "ZuzuC", "Zzzzz", "ZuzuGoal", "ShakeIntensity")
    ancient_curve_settings = {}
    for settings_identity in sorted({v["curveSettingsIdentity"] for v in ancient_settings.values()}):
        row = mono_behaviours.get(settings_identity)
        if not row:
            raise RuntimeError(
                f"AncientBGAnimationSettings {settings_identity} was not resolved; "
                "include Common/CardNew/Common via --shared"
            )
        o, d = row
        if not set(ancient_curve_names).issubset(d):
            raise RuntimeError(f"AncientBGAnimationSettings {settings_identity} has an unexpected type tree")
        curves = {}
        for curve_name in ancient_curve_names:
            curve = d[curve_name] or {}
            keys = curve.get("m_Curve") or []
            if any(not set(curve_fields).issubset(key or {}) for key in keys):
                raise RuntimeError(
                    f"AncientBGAnimationSettings {settings_identity}.{curve_name} is incomplete"
                )
            curves[curve_name] = {
                "keys": [{field: key[field] for field in curve_fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            }
        ancient_curve_settings[settings_identity] = {
            "identity": settings_identity,
            "name": d.get("m_Name", ""),
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "curves": curves,
        }

    marble_fields = {
        "_renderer", "_tiltPower", "_useMarbleDelay", "_delayTime2",
        "_pointAccel", "_shearAccel", "_dorodoroDistance", "_resistancePower",
        "_minDorodoroCoef", "_maxPointSpeed", "_minPointSpeed",
        "_goalThreshold", "_pointMoveByTilt", "_pointForceChangeByTilt",
        "_points", "_defaultNoiseRemapSettings",
    }
    marble_scalar_map = {
        "tiltPower": "_tiltPower",
        "delayTime2": "_delayTime2",
        "pointAccel": "_pointAccel",
        "shearAccel": "_shearAccel",
        "dorodoroDistance": "_dorodoroDistance",
        "resistancePower": "_resistancePower",
        "minDorodoroCoef": "_minDorodoroCoef",
        "maxPointSpeed": "_maxPointSpeed",
        "minPointSpeed": "_minPointSpeed",
        "goalThreshold": "_goalThreshold",
        "pointMoveByTilt": "_pointMoveByTilt",
        "pointForceChangeByTilt": "_pointForceChangeByTilt",
    }
    marble_settings = {}
    marble_by_renderer = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not marble_fields.issubset(d):
            continue
        component_go = pptr_identity(o, d.get("m_GameObject") or {})
        renderer = pptr_identity(o, d["_renderer"] or {})
        if component_go["pathId"] == "0" or renderer["pathId"] == "0":
            raise RuntimeError(
                f"CardMarbleLayer {component_identity} has a null GameObject/renderer PPtr"
            )
        raw_points = d["_points"] or []
        required_point_fields = {
            "DefaultPosition", "TiltMovePosition", "RotationWithTilt",
            "DefaultForce", "TiltForce",
        }
        if not raw_points or len(raw_points) > 4 or any(
            not required_point_fields.issubset(point or {}) for point in raw_points
        ):
            raise RuntimeError(f"CardMarbleLayer {component_identity} has invalid points")
        remap = d["_defaultNoiseRemapSettings"] or {}
        required_remap_fields = {
            "CurveLabel", "Resolution", "DefaultRemapCurve",
            "TiltRemapCurve", "RemapRemapCurve",
        }
        if not required_remap_fields.issubset(remap):
            raise RuntimeError(
                f"CardMarbleLayer {component_identity} has incomplete remap settings"
            )
        remap_curves = {}
        for output_name, field_name in (
            ("defaultRemapCurve", "DefaultRemapCurve"),
            ("tiltRemapCurve", "TiltRemapCurve"),
            ("remapRemapCurve", "RemapRemapCurve"),
        ):
            curve = remap[field_name] or {}
            keys = curve.get("m_Curve") or []
            if len(keys) < 2 or any(
                not set(curve_fields).issubset(key or {}) for key in keys
            ):
                raise RuntimeError(
                    f"CardMarbleLayer {component_identity}.{field_name} is incomplete"
                )
            remap_curves[output_name] = {
                "keys": [{field: key[field] for field in curve_fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            }
        if renderer["identity"] in marble_by_renderer:
            raise RuntimeError(
                f"CardMarbleLayer renderer {renderer['identity']} has multiple components"
            )
        marble_by_renderer[renderer["identity"]] = component_identity
        marble_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": component_go["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "rendererBindings": [],
            "useMarbleDelay": d["_useMarbleDelay"],
            "points": [
                {
                    "defaultPosition": point["DefaultPosition"],
                    "tiltMovePosition": point["TiltMovePosition"],
                    "rotationWithTilt": point["RotationWithTilt"],
                    "defaultForce": point["DefaultForce"],
                    "tiltForce": point["TiltForce"],
                }
                for point in raw_points
            ],
            "defaultNoiseRemapSettings": {
                "curveLabel": remap["CurveLabel"],
                "resolution": remap["Resolution"],
                **remap_curves,
            },
            **{name: d[field] for name, field in marble_scalar_map.items()},
        }

    msr_fields = {
        "_settings", "_animStartDegree", "_animTimeScale", "_animDuration",
        "_endAnimDuration", "_stopAnimTiming", "_timeOffset",
        "_intensityNoiseSpeed", "_reflectFlipBookMaxSpeed",
        "_reflectStartBane", "_reflectStartNensei", "_reflectEndBane",
        "_reflectEndNensei", "_checkRotatingTime", "_rotatingEndThreshold",
        "_rotatingStartThreshold", "_disappearBane", "_disappearNensei",
        "_appearBane", "_appearNensei", "_isAnimationStopped",
    }
    msr_scalar_map = {
        "animStartDegree": "_animStartDegree",
        "animTimeScale": "_animTimeScale",
        "animDuration": "_animDuration",
        "endAnimDuration": "_endAnimDuration",
        "stopAnimTiming": "_stopAnimTiming",
        "timeOffset": "_timeOffset",
        "intensityNoiseSpeed": "_intensityNoiseSpeed",
        "reflectFlipBookMaxSpeed": "_reflectFlipBookMaxSpeed",
        "reflectStartBane": "_reflectStartBane",
        "reflectStartNensei": "_reflectStartNensei",
        "reflectEndBane": "_reflectEndBane",
        "reflectEndNensei": "_reflectEndNensei",
        "checkRotatingTime": "_checkRotatingTime",
        "rotatingEndThreshold": "_rotatingEndThreshold",
        "rotatingStartThreshold": "_rotatingStartThreshold",
        "disappearBane": "_disappearBane",
        "disappearNensei": "_disappearNensei",
        "appearBane": "_appearBane",
        "appearNensei": "_appearNensei",
    }
    msr_settings = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not msr_fields.issubset(d):
            continue
        component_go = pptr_identity(o, d.get("m_GameObject") or {})
        animation_settings = pptr_identity(o, d["_settings"] or {})
        if component_go["pathId"] == "0" or animation_settings["pathId"] == "0":
            raise RuntimeError(
                f"CardMSRObject {component_identity} has a null GameObject/settings PPtr"
            )
        msr_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": component_go["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "animationSettingsIdentity": animation_settings["identity"],
            "rendererBindings": {
                "aura": [],
                "parallax": [],
                "shadowbox": [],
            },
            "isAnimationStopped": d["_isAnimationStopped"],
            **{name: d[field] for name, field in msr_scalar_map.items()},
        }

    msr_curve_names = (
        "OutlineReflectCenterX",
        "OutlineReflectColorIntensity",
        "ColorIntensityNoiseStrength",
        "OutlineReflectFlipBookAnim",
        "OutlineReflectStartSpeed",
        "OutlineReflectEndSpeed",
        "AuraTransparency",
        "ParallaxTransparency",
        "ParallaxTranslate",
        "ParallaxAppearTransparency",
        "ParallaxAppearTranslate",
        "ParallaxDisappearTransparency",
        "ParallaxDisappearTranslate",
    )
    msr_required_curves = set(msr_curve_names[:9])
    msr_animation_settings = {}
    for settings_identity in sorted({
        config["animationSettingsIdentity"] for config in msr_settings.values()
    }):
        row = mono_behaviours.get(settings_identity)
        if not row:
            raise RuntimeError(
                f"MSRAnimationSettings {settings_identity} was not resolved; "
                "include Common/CardNew/Common via --shared"
            )
        o, d = row
        if not set(msr_curve_names).issubset(d):
            raise RuntimeError(
                f"MSRAnimationSettings {settings_identity} has an unexpected type tree"
            )
        curves = {}
        for curve_name in msr_curve_names:
            curve = d[curve_name] or {}
            keys = curve.get("m_Curve") or []
            if (curve_name in msr_required_curves and len(keys) < 2) or any(
                not set(curve_fields).issubset(key or {}) for key in keys
            ):
                raise RuntimeError(
                    f"MSRAnimationSettings {settings_identity}.{curve_name} is incomplete"
                )
            curves[curve_name] = {
                "keys": [{field: key[field] for field in curve_fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            }
        msr_animation_settings[settings_identity] = {
            "identity": settings_identity,
            "name": d.get("m_Name", ""),
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "curves": curves,
        }

    mrr_fields = {
        "_settings", "_animStartDegree", "_animTimeScale", "_animDuration",
        "_flashRadialStartOffset", "_useSpeedAdjust", "_recordingTime",
        "_minTiltSpeed", "_maxTiltSpeed", "_minAnimSpeed", "_maxAnimSpeed",
    }
    mrr_scalar_map = {
        "animStartDegree": "_animStartDegree",
        "animTimeScale": "_animTimeScale",
        "animDuration": "_animDuration",
        "flashRadialStartOffset": "_flashRadialStartOffset",
        "recordingTime": "_recordingTime",
        "minTiltSpeed": "_minTiltSpeed",
        "maxTiltSpeed": "_maxTiltSpeed",
        "minAnimSpeed": "_minAnimSpeed",
        "maxAnimSpeed": "_maxAnimSpeed",
    }
    mrr_settings = {}
    for component_identity, (o, d) in mono_behaviours.items():
        if src_bundle(o) not in card_bundle_names or not mrr_fields.issubset(d):
            continue
        component_go = pptr_identity(o, d.get("m_GameObject") or {})
        animation_settings = pptr_identity(o, d["_settings"] or {})
        if component_go["pathId"] == "0" or animation_settings["pathId"] == "0":
            raise RuntimeError(
                f"CardMRRObject {component_identity} has a null GameObject/settings PPtr"
            )
        mrr_settings[component_identity] = {
            "componentIdentity": component_identity,
            "componentGoIdentity": component_go["identity"],
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "animationSettingsIdentity": animation_settings["identity"],
            "rendererBindings": {
                "main": [],
                "effect": [],
                "flash": [],
            },
            "useSpeedAdjust": d["_useSpeedAdjust"],
            **{name: d[field] for name, field in mrr_scalar_map.items()},
        }

    mrr_curve_names = (
        "ChangeColorCurve",
        "LightColorIntensityCurve",
        "LightEmitIntensityCurve",
        "LightPower",
        "Layer2UVXTranslateByTiltingLeft",
        "Layer2UVXTranslateByTiltingRight",
        "Layer2ColorPower",
        "Layer2EmissiveIntensity",
        "EffSwitchColor",
        "EffAdditiveIntensity",
        "EffColor3Blend",
        "EffEmissiveIntensity",
        "FlashIntensity",
        "FlashRadialScaling",
        "FlashRadialAnim",
    )
    mrr_animation_settings = {}
    for settings_identity in sorted({
        config["animationSettingsIdentity"] for config in mrr_settings.values()
    }):
        row = mono_behaviours.get(settings_identity)
        if not row:
            raise RuntimeError(
                f"MRRAnimationSettings {settings_identity} was not resolved; "
                "include Common/CardNew/Common via --shared"
            )
        o, d = row
        if not set(mrr_curve_names).issubset(d):
            raise RuntimeError(
                f"MRRAnimationSettings {settings_identity} has an unexpected type tree"
            )
        curves = {}
        for curve_name in mrr_curve_names:
            curve = d[curve_name] or {}
            keys = curve.get("m_Curve") or []
            if len(keys) < 2 or any(
                not set(curve_fields).issubset(key or {}) for key in keys
            ):
                raise RuntimeError(
                    f"MRRAnimationSettings {settings_identity}.{curve_name} is incomplete"
                )
            curves[curve_name] = {
                "keys": [{field: key[field] for field in curve_fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            }
        mrr_animation_settings[settings_identity] = {
            "identity": settings_identity,
            "name": d.get("m_Name", ""),
            "scriptIdentity": pptr_identity(o, d.get("m_Script") or {})["identity"],
            "curves": curves,
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
    for config in future_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CardFutureObject GameObject {component_go_identity} was not resolved")
        config["componentGoPath"] = go_path(component_go_identity)
    for config in ancient_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CardAncientObject GameObject {component_go_identity} was not resolved")
        config["componentGoPath"] = go_path(component_go_identity)
    for config in marble_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CardMarbleLayer GameObject {component_go_identity} was not resolved")
        config["componentGoPath"] = go_path(component_go_identity)
    for config in msr_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CardMSRObject GameObject {component_go_identity} was not resolved")
        config["componentGoPath"] = go_path(component_go_identity)
    for config in mrr_settings.values():
        component_go_identity = config["componentGoIdentity"]
        if component_go_identity not in gos:
            raise RuntimeError(f"CardMRRObject GameObject {component_go_identity} was not resolved")
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
            shader_queue = shader_info.get("renderQueue")
            if not shader_queue:
                raise RuntimeError(
                    f"Material {material_ref['identity']} has no serialized Shader queue evidence"
                )
            custom_render_queue = m.get("renderQueue")
            if not isinstance(custom_render_queue, int) or custom_render_queue < -1:
                raise RuntimeError(
                    f"Material {material_ref['identity']} has invalid m_CustomRenderQueue "
                    f"{custom_render_queue!r}"
                )
            effective_render_queue = (
                custom_render_queue
                if custom_render_queue >= 0
                else shader_queue["effectiveRenderQueue"]
            )
            effective_render_queue_source = (
                "serialized-material-custom-render-queue"
                if custom_render_queue >= 0
                else shader_queue["source"]
            )
            search_tags = shader_info.get("searchTags") or []
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
            if sname.rsplit("/", 1)[-1] == "Card_Parallax_Future":
                renderer_path = go_path(r["go"])
                candidates = [
                    config for config in future_settings.values()
                    if renderer_path == config["componentGoPath"]
                    or renderer_path.startswith(config["componentGoPath"] + "/")
                ]
                if len(candidates) != 1:
                    raise RuntimeError(
                        f"Card_Parallax_Future renderer {renderer_key} resolved to "
                        f"{len(candidates)} CardFutureObject components"
                    )
                config = candidates[0]
                if renderer_key not in config["rendererBindings"]:
                    config["rendererBindings"].append(renderer_key)
                renderer_properties["cardFuture"] = {
                    "componentIdentity": config["componentIdentity"],
                    "rendererIdentity": renderer_key,
                }
            if sname.rsplit("/", 1)[-1] == "Card_Parallax_Strata":
                renderer_path = go_path(r["go"])
                candidates = [
                    config for config in ancient_settings.values()
                    if renderer_path == config["componentGoPath"]
                    or renderer_path.startswith(config["componentGoPath"] + "/")
                ]
                if len(candidates) != 1:
                    raise RuntimeError(
                        f"Card_Parallax_Strata renderer {renderer_key} resolved to "
                        f"{len(candidates)} CardAncientObject components"
                    )
                config = candidates[0]
                if renderer_key not in config["rendererBindings"]:
                    config["rendererBindings"].append(renderer_key)
                renderer_properties["cardAncient"] = {
                    "componentIdentity": config["componentIdentity"],
                    "rendererIdentity": renderer_key,
                }
            if sname.rsplit("/", 1)[-1] == "Card_Parallax_Marble":
                component_identity = marble_by_renderer.get(renderer_key)
                config = marble_settings.get(component_identity)
                if not config:
                    raise RuntimeError(
                        f"Card_Parallax_Marble renderer {renderer_key} has no "
                        "CardMarbleLayer component"
                    )
                if renderer_key not in config["rendererBindings"]:
                    config["rendererBindings"].append(renderer_key)
                renderer_properties["cardMarble"] = {
                    "componentIdentity": config["componentIdentity"],
                    "rendererIdentity": renderer_key,
                }
            msr_roles = {
                "Card-Aura": "aura",
                "Card_Parallax_Transparent_Translate": "parallax",
                "ShadowBox_MSR": "shadowbox",
            }
            matching_msr_roles = sorted({
                msr_roles[tag] for tag in search_tags if tag in msr_roles
            })
            if len(matching_msr_roles) > 1:
                raise RuntimeError(
                    f"renderer {renderer_key} material {m.get('name')} matches multiple "
                    f"CardMSRObject SearchTags: {matching_msr_roles}"
                )
            if matching_msr_roles:
                renderer_path = go_path(r["go"])
                candidates = [
                    config for config in msr_settings.values()
                    if renderer_path == config["componentGoPath"]
                    or renderer_path.startswith(config["componentGoPath"] + "/")
                ]
                if len(candidates) != 1:
                    raise RuntimeError(
                        f"CardMSRObject renderer {renderer_key} resolved to "
                        f"{len(candidates)} components"
                    )
                role = matching_msr_roles[0]
                config = candidates[0]
                if renderer_key not in config["rendererBindings"][role]:
                    config["rendererBindings"][role].append(renderer_key)
                renderer_properties["cardMSR"] = {
                    "componentIdentity": config["componentIdentity"],
                    "rendererIdentity": renderer_key,
                    "role": role,
                    "searchTag": next(
                        tag for tag in search_tags if msr_roles.get(tag) == role
                    ),
                }
            mrr_roles = {
                "MRR-ChangeColor-Lighting": "main",
                "Frame-Holo-2Layer": "main",
                "Card-Effect-Emit": "effect",
                "MRR-Parallax-Flash": "flash",
            }
            matching_mrr_roles = sorted({
                mrr_roles[tag] for tag in search_tags if tag in mrr_roles
            })
            if len(matching_mrr_roles) > 1:
                raise RuntimeError(
                    f"renderer {renderer_key} material {m.get('name')} matches multiple "
                    f"CardMRRObject SearchTags: {matching_mrr_roles}"
                )
            if matching_mrr_roles:
                renderer_path = go_path(r["go"])
                candidates = [
                    config for config in mrr_settings.values()
                    if renderer_path == config["componentGoPath"]
                    or renderer_path.startswith(config["componentGoPath"] + "/")
                ]
                if len(candidates) != 1:
                    raise RuntimeError(
                        f"CardMRRObject renderer {renderer_key} resolved to "
                        f"{len(candidates)} components"
                    )
                role = matching_mrr_roles[0]
                config = candidates[0]
                if renderer_key not in config["rendererBindings"][role]:
                    config["rendererBindings"][role].append(renderer_key)
                renderer_properties["cardMRR"] = {
                    "componentIdentity": config["componentIdentity"],
                    "rendererIdentity": renderer_key,
                    "role": role,
                    "searchTag": next(
                        tag for tag in search_tags if mrr_roles.get(tag) == role
                    ),
                }
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
                "shaderSearchTags": search_tags,
                "shaderRenderQueue": shader_queue,
                "srpBatcherCompatible": shader_info.get("srpBatcherCompatible"),
                "srpBatcherEvidence": shader_info.get("srpBatcherEvidence"),
                "srpBatcherWitnessCount": shader_info.get("srpBatcherWitnessCount"),
                "mesh": mesh_name, "meshIdentity": mesh_ref,
                "renderQueue": custom_render_queue,
                "effectiveRenderQueue": effective_render_queue,
                "effectiveRenderQueueSource": effective_render_queue_source,
                "keywords": m.get("keywords"),
                "enableInstancingVariants": m.get("enableInstancingVariants"),
                "invalidKeywords": m.get("invalidKeywords"),
                "world": w,
                "rendererProperties": renderer_properties,
                "materialSerialized": {
                    "rawByteSize": m.get("rawByteSize"),
                    "rawSha256": m.get("rawSha256"),
                    "savedProperties": m.get("savedProperties"),
                },
                "textures": texenvs,
                "floats": m.get("floats"), "ints": m.get("ints"), "colors": m.get("colors"),
                "shader_state": sstate.get(sname),
            })
    layers.sort(key=lambda L: (round((L["world"]["z"] or 0), 4), L["material"] or ""))

    out = os.path.abspath(args.out)
    for config in future_settings.values():
        if not config["rendererBindings"]:
            raise RuntimeError(
                f"CardFutureObject {config['componentIdentity']} has no Card_Parallax_Future renderer"
            )
        config["rendererBindings"].sort()
    for config in ancient_settings.values():
        if not config["rendererBindings"]:
            raise RuntimeError(
                f"CardAncientObject {config['componentIdentity']} has no Card_Parallax_Strata renderer"
            )
        config["rendererBindings"].sort()
    for config in marble_settings.values():
        if not config["rendererBindings"]:
            raise RuntimeError(
                f"CardMarbleLayer {config['componentIdentity']} has no "
                "Card_Parallax_Marble renderer"
            )
        config["rendererBindings"].sort()
    for config in msr_settings.values():
        for role, renderer_bindings in config["rendererBindings"].items():
            if not renderer_bindings:
                raise RuntimeError(
                    f"CardMSRObject {config['componentIdentity']} has no {role} "
                    "SearchTag renderer"
                )
            renderer_bindings.sort()
    for config in mrr_settings.values():
        for role, renderer_bindings in config["rendererBindings"].items():
            if not renderer_bindings:
                raise RuntimeError(
                    f"CardMRRObject {config['componentIdentity']} has no {role} "
                    "SearchTag renderer"
                )
            renderer_bindings.sort()

    json.dump({"schema": "pocket-card-render/material-recipe@2",
               "schemaVersion": 2,
               "card": os.path.basename(args.path.rstrip("/\\")), "layers": layers,
               "runtimeSettings": {
                   "kiraPuyo": kira_settings,
                   "circularKira": circular_settings,
                   "cardFuture": future_settings,
                   "cardAncient": ancient_settings,
                   "ancientBGAnimation": ancient_curve_settings,
                   "cardMarble": marble_settings,
                   "cardMSR": msr_settings,
                   "msrAnimation": msr_animation_settings,
                   "cardMRR": mrr_settings,
                   "mrrAnimation": mrr_animation_settings,
               }},
              open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False, default=str)
    print(f"materials:{len(mats)} renderers:{len(rends)} shaders_resolved:{len(shaders)} -> {len(layers)} layers")
    if located_dependencies:
        print("resolved direct dependencies:")
        for cab, dependency_path in sorted(located_dependencies.items()):
            print(f"  {cab} -> {dependency_path}")
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
