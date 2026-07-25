import hashlib
import json
import os
import sys
import traceback

import renderdoc as rd


CAPTURE_PATH = os.environ.get("PCR_RENDERDOC_CAPTURE", "")
OUTPUT_PATH = os.environ.get(
    "PCR_RENDERDOC_HOST_PRESENTATION_OUT",
    os.path.abspath("$cache/official-host-presentation.json"),
)


def sha256_file(filename):
    digest = hashlib.sha256()
    with open(filename, "rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def resource_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def flatten(actions):
    result = []
    for action in actions:
        result.append(action)
        result.extend(flatten(action.children))
    return result


def texture_record(texture, names):
    rid = resource_id(texture.resourceId)
    return {
        "resourceId": rid,
        "name": names.get(rid, ""),
        "width": texture.width,
        "height": texture.height,
        "depth": texture.depth,
        "arraySize": texture.arraysize,
        "mips": texture.mips,
        "samples": texture.msSamp,
        "cubemap": texture.cubemap,
        "format": texture.format.Name(),
        "creationFlags": int(texture.creationFlags),
    }


def shader_record(pipeline, stage):
    shader = pipeline.GetShader(stage)
    reflection = pipeline.GetShaderReflection(stage)
    if resource_id(shader) == 0 or reflection is None:
        return None
    raw = bytes(reflection.rawBytes)
    return {
        "resourceId": resource_id(shader),
        "entryPoint": pipeline.GetShaderEntryPoint(stage),
        "encoding": str(reflection.encoding),
        "byteLength": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def descriptor_record(access):
    descriptor = access.descriptor
    sampler = access.sampler
    return {
        "resourceId": resource_id(descriptor.resource),
        "firstMip": descriptor.firstMip,
        "numMips": descriptor.numMips,
        "firstSlice": descriptor.firstSlice,
        "numSlices": descriptor.numSlices,
        "textureType": str(descriptor.textureType),
        "sampler": {
            "addressU": str(sampler.addressU),
            "addressV": str(sampler.addressV),
            "addressW": str(sampler.addressW),
            "minify": str(sampler.filter.minify),
            "magnify": str(sampler.filter.magnify),
            "mip": str(sampler.filter.mip),
            "maxAnisotropy": sampler.maxAnisotropy,
            "minLOD": sampler.minLOD,
            "maxLOD": sampler.maxLOD,
            "mipBias": sampler.mipBias,
        },
    }


def pipeline_record(controller, action):
    controller.SetFrameEvent(action.eventId, False)
    pipeline = controller.GetPipelineState()
    viewport = pipeline.GetViewport(0)
    scissor = pipeline.GetScissor(0)
    pixel_resources = pipeline.GetReadOnlyResources(rd.ShaderStage.Pixel)
    return {
        "eventId": action.eventId,
        "name": action.GetName(controller.GetStructuredFile()),
        "indexCount": action.numIndices,
        "instanceCount": action.numInstances,
        "outputs": [resource_id(value) for value in action.outputs if resource_id(value)],
        "depthOutput": resource_id(action.depthOut),
        "viewport": [viewport.x, viewport.y, viewport.width, viewport.height],
        "scissor": [scissor.x, scissor.y, scissor.width, scissor.height],
        "scissorEnabled": scissor.enabled,
        "vertex": shader_record(pipeline, rd.ShaderStage.Vertex),
        "fragment": shader_record(pipeline, rd.ShaderStage.Pixel),
        "sampledResources": [descriptor_record(value) for value in pixel_resources],
    }


report = {
    "schema": "pocket-card-render/official-host-presentation@1",
    "capturePath": os.path.abspath(CAPTURE_PATH) if CAPTURE_PATH else "",
    "pixelDataIncluded": False,
}
capture = None
controller = None
exit_code = 0

try:
    if not CAPTURE_PATH or not os.path.isfile(CAPTURE_PATH):
        raise RuntimeError("RenderDoc capture path is absent or not a file")
    report["captureSha256"] = sha256_file(CAPTURE_PATH)
    report["captureBytes"] = os.path.getsize(CAPTURE_PATH)

    capture = rd.OpenCaptureFile()
    result = capture.OpenFile(CAPTURE_PATH, "", None)
    if result != rd.ResultCode.Succeeded:
        raise RuntimeError("RenderDoc could not open capture: " + str(result))
    result, controller = capture.OpenCapture(rd.ReplayOptions(), None)
    if result != rd.ResultCode.Succeeded or controller is None:
        raise RuntimeError("RenderDoc could not replay capture: " + str(result))

    properties = controller.GetAPIProperties()
    resources = controller.GetResources()
    names = {resource_id(value.resourceId): value.name for value in resources}
    textures = [texture_record(value, names) for value in controller.GetTextures()]
    texture_by_id = {value["resourceId"]: value for value in textures}
    actions = flatten(controller.GetRootActions())
    draws = [pipeline_record(controller, value) for value in actions if value.numIndices > 0]
    action_records = [{
        "eventId": value.eventId,
        "name": value.GetName(controller.GetStructuredFile()),
        "flags": int(value.flags),
        "copySource": resource_id(value.copySource),
        "copyDestination": resource_id(value.copyDestination),
        "outputs": [resource_id(item) for item in value.outputs if resource_id(item)],
    } for value in actions]

    upscales = []
    for draw in draws:
        output = texture_by_id.get(draw["outputs"][0]) if draw["outputs"] else None
        for sampled in draw["sampledResources"]:
            source = texture_by_id.get(sampled["resourceId"])
            if source and output and source["width"] > 0 and source["height"] > 0 \
                    and (source["width"] < output["width"] or source["height"] < output["height"]):
                upscales.append({
                    "eventId": draw["eventId"],
                    "sourceResourceId": source["resourceId"],
                    "sourceSize": [source["width"], source["height"]],
                    "destinationResourceId": output["resourceId"],
                    "destinationSize": [output["width"], output["height"]],
                    "sampler": sampled["sampler"],
                })

    backbuffers = [value for value in textures if "Backbuffer Color" in value["name"]]
    swaps = [value for value in action_records if value["name"].startswith("SwapBuffers")]
    report.update({
        "status": "complete",
        "classification": "emulator-host-compositor-only",
        "api": str(properties.pipelineType),
        "renderer": str(properties.localRenderer),
        "vendor": str(properties.vendor),
        "frameNumber": controller.GetFrameInfo().frameNumber,
        "actionCount": len(actions),
        "drawCount": len(draws),
        "swapCount": len(swaps),
        "textures": textures,
        "actions": action_records,
        "draws": draws,
        "presentation": {
            "upscales": upscales,
            "backbuffers": backbuffers,
            "containsGuestShaderDraws": False,
            "boundary": "BlueStacks guest surfaces sampled by the Windows host compositor",
        },
    })
    if str(properties.pipelineType) != "GraphicsAPI.OpenGL":
        raise RuntimeError("capture is not the expected BlueStacks host OpenGL compositor")
    if len(draws) != 2 or len(swaps) != 1 or not upscales or not backbuffers:
        raise RuntimeError("capture does not contain the expected host presentation chain")
except Exception as error:
    report.update({"status": "failed", "error": str(error), "traceback": traceback.format_exc()})
    exit_code = 1
finally:
    if controller is not None:
        controller.Shutdown()
    if capture is not None:
        capture.Shutdown()

parent = os.path.dirname(os.path.abspath(OUTPUT_PATH))
os.makedirs(parent, exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as output:
    json.dump(report, output, ensure_ascii=True, indent=2)
    output.write("\n")
print(json.dumps(report, ensure_ascii=True, indent=2))
sys.exit(exit_code)
