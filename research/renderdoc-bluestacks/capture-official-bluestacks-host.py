import json
import os
import sys
import time
import traceback

import renderdoc as rd


PLAYER_PATH = os.environ.get(
    "PCR_BLUESTACKS_PLAYER",
    r"C:\Program Files\BlueStacks_nxt\HD-Player.exe",
)
INSTANCE = os.environ.get("PCR_BLUESTACKS_INSTANCE", "Pie64")
STATUS_PATH = os.environ.get(
    "PCR_RENDERDOC_STATUS_OUT",
    os.path.abspath(".renderdoc-host-capture-status.json"),
)
TRIGGER_PATH = os.environ.get(
    "PCR_RENDERDOC_TRIGGER",
    os.path.abspath(".renderdoc-host-capture-trigger"),
)
CAPTURE_TEMPLATE = os.environ.get(
    "PCR_RENDERDOC_CAPTURE_OUT",
    os.path.abspath("official-vulkan-capture-host/official-game.rdc"),
)
TRIGGER_TIMEOUT_SECONDS = int(os.environ.get("PCR_RENDERDOC_TRIGGER_TIMEOUT", "900"))
CAPTURE_TIMEOUT_SECONDS = int(os.environ.get("PCR_RENDERDOC_CAPTURE_TIMEOUT", "120"))


report = {
    "schema": "pocket-card-render/renderdoc-bluestacks-host-capture@1",
    "playerPath": PLAYER_PATH,
    "instance": INSTANCE,
    "triggerPath": TRIGGER_PATH,
    "captureTemplate": CAPTURE_TEMPLATE,
}


def emit(status, **values):
    report.update(values)
    report["status"] = status
    report["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload = json.dumps(report, ensure_ascii=True, indent=2) + "\n"
    parent = os.path.dirname(STATUS_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(STATUS_PATH, "w", encoding="utf-8") as output:
        output.write(payload)
    print(payload, end="")


target = None
exit_code = 0

try:
    if not os.path.isfile(PLAYER_PATH):
        raise RuntimeError("BlueStacks player executable does not exist: " + PLAYER_PATH)

    capture_parent = os.path.dirname(CAPTURE_TEMPLATE)
    if capture_parent:
        os.makedirs(capture_parent, exist_ok=True)

    if os.path.exists(TRIGGER_PATH):
        os.remove(TRIGGER_PATH)

    options = rd.CaptureOptions()
    options.hookIntoChildren = True

    emit("launching-bluestacks-host")
    launch = rd.ExecuteAndInject(
        PLAYER_PATH,
        os.path.dirname(PLAYER_PATH),
        "--instance " + INSTANCE,
        [],
        CAPTURE_TEMPLATE,
        options,
        False,
    )
    report["launchResult"] = str(launch.result)
    report["targetIdent"] = launch.ident
    if launch.result != rd.ResultCode.Succeeded:
        raise RuntimeError("RenderDoc host launch/injection failed: " + str(launch.result))

    emit("waiting-for-trigger")
    deadline = time.time() + TRIGGER_TIMEOUT_SECONDS
    while not os.path.exists(TRIGGER_PATH):
        if time.time() >= deadline:
            raise RuntimeError("Timed out waiting for host capture trigger")
        time.sleep(0.25)

    emit("connecting-target-control")
    target = rd.CreateTargetControl("localhost", launch.ident, "capture-official-bluestacks-host.py", True)
    if target is None:
        raise RuntimeError("Could not connect to BlueStacks host target control")

    report["targetPid"] = target.GetPID()
    emit("triggering-capture")
    target.TriggerCapture(1)

    message = None
    deadline = time.time() + CAPTURE_TIMEOUT_SECONDS
    while time.time() < deadline:
        message = target.ReceiveMessage(None)
        if message.type == rd.TargetControlMessageType.NewCapture:
            break
        if message.type == rd.TargetControlMessageType.Disconnected:
            raise RuntimeError("BlueStacks host disconnected before producing a capture")

    if message is None or message.type != rd.TargetControlMessageType.NewCapture:
        raise RuntimeError("Timed out waiting for BlueStacks host capture notification")

    report["capturePath"] = message.newCapture.path
    report["captureBytes"] = os.path.getsize(message.newCapture.path)
    report["frameNumber"] = message.newCapture.frameNumber
    report["captureApi"] = str(message.newCapture.api)
    emit("complete")
except Exception as error:
    emit("failed", error=str(error), traceback=traceback.format_exc())
    exit_code = 1
finally:
    if target is not None:
        target.Shutdown()

sys.exit(exit_code)
