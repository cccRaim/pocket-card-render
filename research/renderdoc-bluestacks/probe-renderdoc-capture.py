import json
import os
import sys
import traceback

import renderdoc as rd


CAPTURE_PATH = os.environ.get(
    "PCR_RENDERDOC_CAPTURE",
    r"D:\Tools\captures\eevee_bag_host_frame4348.rdc",
)
OUTPUT_PATH = os.environ.get(
    "PCR_RENDERDOC_PROBE_OUT",
    os.path.abspath(".renderdoc-capture-probe.json"),
)


def names(value):
    return sorted(name for name in dir(value) if not name.startswith("__"))


def serial(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [serial(item) for item in value]
    if hasattr(value, "__len__") and hasattr(value, "__getitem__"):
        try:
            return [serial(value[index]) for index in range(len(value))]
        except (TypeError, ValueError, RuntimeError):
            pass
    try:
        return int(value)
    except (TypeError, ValueError):
        return str(value)


def action_record(action, depth, structured_file):
    fields = [
        "eventId", "actionId", "drawIndex", "flags", "numIndices",
        "numInstances", "indexOffset", "baseVertex", "vertexOffset",
        "instanceOffset", "dispatchDimension", "dispatchThreadsDimension",
        "outputs", "depthOut", "copySource", "copyDestination",
    ]
    return {
        "depth": depth,
        "name": action.GetName(structured_file),
        **{field: serial(getattr(action, field)) for field in fields},
        "eventCount": len(action.events),
        "childCount": len(action.children),
    }


def flatten_actions(actions, structured_file, depth=0):
    flattened = []
    for action in actions:
        flattened.append(action_record(action, depth, structured_file))
        flattened.extend(flatten_actions(action.children, structured_file, depth + 1))
    return flattened


def data_fields(value):
    return {
        name: serial(getattr(value, name))
        for name in names(value)
        if not callable(getattr(value, name))
    }


def format_record(value):
    return {
        "name": value.Name(),
        **data_fields(value),
    }


def texture_record(texture):
    result = data_fields(texture)
    result["format"] = format_record(texture.format)
    return result


def descriptor_access_record(value):
    result = data_fields(value)
    result["descriptorFields"] = names(value.descriptor)
    result["descriptor"] = data_fields(value.descriptor)
    result["samplerFields"] = names(value.sampler)
    result["sampler"] = data_fields(value.sampler)
    return result


def pipeline_record(controller, event_id):
    controller.SetFrameEvent(event_id, False)
    pipeline = controller.GetPipelineState()
    stages = []
    for stage in (rd.ShaderStage.Vertex, rd.ShaderStage.Pixel):
        shader = pipeline.GetShader(stage)
        reflection = pipeline.GetShaderReflection(stage)
        readonly = pipeline.GetReadOnlyResources(stage)
        samplers = pipeline.GetSamplers(stage)
        stages.append({
            "stage": str(stage),
            "shader": serial(shader),
            "entryPoint": pipeline.GetShaderEntryPoint(stage),
            "reflectionFields": names(reflection) if reflection is not None else [],
            "reflection": data_fields(reflection) if reflection is not None else None,
            "readOnlyResourceFields": names(readonly[0]) if readonly else [],
            "readOnlyResources": [descriptor_access_record(value) for value in readonly],
            "samplerFields": names(samplers[0]) if samplers else [],
            "samplers": [data_fields(value) for value in samplers],
            "constantBlocks": serial(pipeline.GetConstantBlocks(stage)),
        })
    return {
        "pipelineObject": serial(pipeline.GetGraphicsPipelineObject()),
        "topology": serial(pipeline.GetPrimitiveTopology()),
        "outputTargets": serial(pipeline.GetOutputTargets()),
        "depthTarget": serial(pipeline.GetDepthTarget()),
        "viewport": data_fields(pipeline.GetViewport(0)),
        "scissor": data_fields(pipeline.GetScissor(0)),
        "colorBlends": serial(pipeline.GetColorBlends()),
        "stages": stages,
    }


report = {
    "schema": "pocket-card-render/renderdoc-capture-probe@1",
    "capturePath": os.path.abspath(CAPTURE_PATH),
}

capture = None
controller = None
exit_code = 0

try:
    capture = rd.OpenCaptureFile()
    result = capture.OpenFile(CAPTURE_PATH, "", None)
    report["openFileResult"] = str(result)
    if result != rd.ResultCode.Succeeded:
        raise RuntimeError("RenderDoc could not open capture: " + str(result))

    support = capture.LocalReplaySupport()
    report["localReplaySupport"] = str(support)
    result, controller = capture.OpenCapture(rd.ReplayOptions(), None)
    report["openCaptureResult"] = str(result)
    if result != rd.ResultCode.Succeeded or controller is None:
        raise RuntimeError("RenderDoc could not replay capture: " + str(result))

    properties = controller.GetAPIProperties()
    roots = controller.GetRootActions()
    structured_file = controller.GetStructuredFile()
    actions = flatten_actions(roots, structured_file)
    textures = controller.GetTextures()
    resources = controller.GetResources()
    frame_info = controller.GetFrameInfo()
    leaf_actions = []
    for action in actions:
        if action["childCount"] == 0:
            leaf_actions.append({
                **action,
                **pipeline_record(controller, action["eventId"]),
            })
    report.update({
        "status": "complete",
        "apiProperties": {
            name: str(getattr(properties, name))
            for name in names(properties)
            if not callable(getattr(properties, name))
        },
        "rootActionCount": len(roots),
        "actionCount": len(actions),
        "actions": actions,
        "leafActions": leaf_actions,
        "controllerMethods": names(controller),
        "actionFields": names(roots[0]) if roots else [],
        "pipelineStateMethods": names(controller.GetPipelineState()),
        "resourceCount": len(controller.GetResources()),
        "bufferCount": len(controller.GetBuffers()),
        "textureCount": len(controller.GetTextures()),
        "frameInfoFields": names(frame_info),
        "frameInfo": {
            name: serial(getattr(frame_info, name))
            for name in names(frame_info)
            if not callable(getattr(frame_info, name))
        },
        "textureFields": names(textures[0]) if textures else [],
        "textures": [texture_record(texture) for texture in textures],
        "resourceFields": names(resources[0]) if resources else [],
        "resources": [
            {
                name: serial(getattr(resource, name))
                for name in names(resource)
                if not callable(getattr(resource, name))
            }
            for resource in resources
        ],
    })
except Exception as error:
    report.update({
        "status": "failed",
        "error": str(error),
        "traceback": traceback.format_exc(),
    })
    exit_code = 1
finally:
    if controller is not None:
        controller.Shutdown()
    if capture is not None:
        capture.Shutdown()

parent = os.path.dirname(OUTPUT_PATH)
if parent:
    os.makedirs(parent, exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as output:
    json.dump(report, output, ensure_ascii=True, indent=2)
    output.write("\n")
print(json.dumps(report, ensure_ascii=True, indent=2))
sys.exit(exit_code)
