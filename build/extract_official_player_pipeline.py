#!/usr/bin/env python3
"""Extract renderer-wide Unity settings directly from the official Android APKM.

The APKM and nested base.apk are read in memory. No derived game asset is accepted
as authority: every reported value comes from globalgamemanagers in the package,
and hashes keep the evidence tied to the exact input bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - depends on the research environment
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc

try:
    from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
except ImportError as exc:  # pragma: no cover - depends on the research environment
    raise SystemExit("capstone is required: python -m pip install capstone") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
GGM_PATH = "assets/bin/Data/globalgamemanagers"
IL2CPP_PATH = "lib/arm64-v8a/libil2cpp.so"

# Method locator from the package-matched IL2CPP metadata. It only locates the
# official bytes; all reported constructor arguments are decoded from libil2cpp.so.
CREATE_RT_RVA = 0x4396050
CREATE_RT_FILE_OFFSET = 0x4392050
CREATE_RT_MAX_SIZE = 0x100


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_objects(globalgamemanagers: bytes) -> dict[str, dict]:
    result: dict[str, dict] = {}
    environment = UnityPy.load(globalgamemanagers)
    for obj in environment.objects:
        if obj.type.name in {"PlayerSettings", "GraphicsSettings", "QualitySettings"}:
            result[obj.type.name] = obj.read_typetree()
    missing = {"PlayerSettings", "GraphicsSettings", "QualitySettings"} - result.keys()
    if missing:
        raise RuntimeError(f"globalgamemanagers is missing: {', '.join(sorted(missing))}")
    return result


def decode_create_render_texture(libil2cpp: bytes) -> dict:
    code = libil2cpp[CREATE_RT_FILE_OFFSET : CREATE_RT_FILE_OFFSET + CREATE_RT_MAX_SIZE]
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    instructions = []
    for instruction in decoder.disasm(code, CREATE_RT_RVA):
        instructions.append(instruction)
        if instruction.mnemonic == "ret":
            break
    if not instructions or instructions[-1].mnemonic != "ret":
        raise RuntimeError("Asset3DRenderer.CreateRenderTexture did not decode to ret")

    rendered = [f"{item.mnemonic} {item.op_str}".strip() for item in instructions]
    required = {
        "mov w1, w23",
        "mov w2, w22",
        "mov w3, #0x18",
        "mov w4, wzr",
        "bl #0x650de04",
        "bl #0x650c2dc",
        "bl #0x650c63c",
        "bl #0x650cacc",
    }
    missing = sorted(required - set(rendered))
    if missing:
        raise RuntimeError(f"CreateRenderTexture binary signature changed: {', '.join(missing)}")

    body_size = instructions[-1].address + instructions[-1].size - CREATE_RT_RVA
    body = code[:body_size]
    anti_aliasing_setter = "bl #0x650c73c" in rendered
    return {
        "method": "Lettuce.Infrastructure.Asset3D.Core.Asset3DRenderer.CreateRenderTexture",
        "architecture": "arm64-v8a",
        "rva": f"0x{CREATE_RT_RVA:x}",
        "fileOffset": f"0x{CREATE_RT_FILE_OFFSET:x}",
        "bodySize": body_size,
        "bodySha256": sha256(body),
        "constructor": "RenderTexture(int width, int height, int depth, RenderTextureFormat format)",
        "depthBits": 24,
        "renderTextureFormatValue": 0,
        "renderTextureFormat": "ARGB32",
        "antiAliasingSetterCalled": anti_aliasing_setter,
        "antiAliasing": None if anti_aliasing_setter else 1,
        "useMipMapFromArgument": True,
        "autoGenerateMipsFromArgument": True,
        "createCalled": True,
    }


def extract(apkm_path: Path) -> dict:
    apkm_bytes = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm_bytes)) as outer:
        base_apk = outer.read("base.apk")
        arm64_split = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        globalgamemanagers = apk.read(GGM_PATH)
    with zipfile.ZipFile(io.BytesIO(arm64_split)) as apk:
        libil2cpp = apk.read(IL2CPP_PATH)

    objects = load_objects(globalgamemanagers)
    player = objects["PlayerSettings"]
    graphics = objects["GraphicsSettings"]
    quality = objects["QualitySettings"]
    quality_index = quality["m_CurrentQuality"]
    profiles = quality["m_QualitySettings"]
    selected = profiles[quality_index]
    tiers = [graphics[f"m_TierSettings_Tier{i}"] for i in (1, 2, 3)]

    color_space_value = player["m_ActiveColorSpace"]
    color_space_names = {0: "Gamma", 1: "Linear"}
    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm_bytes),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_split),
            "globalgamemanagersPath": GGM_PATH,
            "globalgamemanagersSha256": sha256(globalgamemanagers),
            "libil2cppPath": IL2CPP_PATH,
            "libil2cppSha256": sha256(libil2cpp),
        },
        "playerSettings": {
            "activeColorSpaceValue": color_space_value,
            "activeColorSpace": color_space_names.get(color_space_value, f"Unknown({color_space_value})"),
            "preserveFramebufferAlpha": player["preserveFramebufferAlpha"],
            "allowHDRDisplaySupport": player["allowHDRDisplaySupport"],
            "useHDRDisplay": player["useHDRDisplay"],
            "hdrBitDepth": player["hdrBitDepth"],
            "colorGamuts": player["m_ColorGamuts"],
        },
        "graphicsSettings": {
            "lightsUseLinearIntensity": graphics["m_LightsUseLinearIntensity"],
            "tiers": [
                {
                    "tier": index + 1,
                    "renderingPath": tier["renderingPath"],
                    "hdrMode": tier["hdrMode"],
                    "useHDR": tier["useHDR"],
                }
                for index, tier in enumerate(tiers)
            ],
        },
        "qualitySettings": {
            "currentQuality": quality_index,
            "selectedName": selected["name"],
            "selectedAntiAliasing": selected["antiAliasing"],
            "selectedVSyncCount": selected["vSyncCount"],
            "profiles": [
                {
                    "index": index,
                    "name": profile["name"],
                    "antiAliasing": profile["antiAliasing"],
                    "vSyncCount": profile["vSyncCount"],
                }
                for index, profile in enumerate(profiles)
            ],
        },
        "asset3DRenderer": {
            "createRenderTexture": decode_create_render_texture(libil2cpp),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
        help="Path to the official Android APKM (default: PCR_APKM or upstream local package)",
    )
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    json.dump(extract(args.apkm), sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
