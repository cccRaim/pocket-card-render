import json
import os
import subprocess
import sys
import threading
import time
import traceback

import renderdoc as rd


DEVICE_SERIAL = os.environ.get("PCR_RENDERDOC_DEVICE", "127.0.0.1:5555")
PACKAGE_ACTIVITY = os.environ.get(
    "PCR_RENDERDOC_PACKAGE_ACTIVITY",
    "jp.pokemon.pokemontcgp/com.unity3d.player.UnityPlayerActivity",
)
STATUS_PATH = os.environ.get(
    "PCR_RENDERDOC_STATUS_OUT",
    os.path.abspath(".renderdoc-capture-status.json"),
)
TRIGGER_PATH = os.environ.get(
    "PCR_RENDERDOC_TRIGGER",
    os.path.abspath(".renderdoc-capture-trigger"),
)
CAPTURE_PATH = os.environ.get(
    "PCR_RENDERDOC_CAPTURE_OUT",
    os.path.abspath("official-vulkan-capture-renderdoc/official-game.rdc"),
)
TRIGGER_TIMEOUT_SECONDS = int(os.environ.get("PCR_RENDERDOC_TRIGGER_TIMEOUT", "600"))
CAPTURE_TIMEOUT_SECONDS = int(os.environ.get("PCR_RENDERDOC_CAPTURE_TIMEOUT", "120"))
ADB_PATH = os.environ.get("PCR_RENDERDOC_ADB")


report = {
    "schema": "pocket-card-render/renderdoc-android-capture@1",
    "deviceSerial": DEVICE_SERIAL,
    "packageActivity": PACKAGE_ACTIVITY,
    "triggerPath": TRIGGER_PATH,
    "capturePath": CAPTURE_PATH,
    "forceGuestAbi": os.environ.get("PCR_RENDERDOC_FORCE_GUEST_ABI") == "1",
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


def code_of(result):
    return getattr(result, "code", result)


remote = None
target = None
ping_thread = None
stop_ping = threading.Event()
egl_hook_disabled = False
exit_code = 0


def ping_remote():
    while not stop_ping.wait(1.0):
        if not remote.Ping():
            report["remotePingLost"] = True
            return


def set_android_property(name, value):
    if not ADB_PATH:
        raise RuntimeError("PCR_RENDERDOC_ADB is required for Android capture properties")
    command = [ADB_PATH, "-s", DEVICE_SERIAL, "shell", "setprop", name, value]
    output = subprocess.check_output(command, stderr=subprocess.STDOUT)
    return output.decode("utf-8", "replace").strip()


try:
    emit("enumerating-device")
    protocols = list(rd.GetSupportedDeviceProtocols())
    if "adb" not in protocols:
        raise RuntimeError("RenderDoc build does not expose the adb device protocol")

    protocol = rd.GetDeviceProtocolController("adb")
    devices = list(protocol.GetDevices())
    report["devices"] = devices
    if DEVICE_SERIAL not in devices:
        raise RuntimeError("Requested Android device was not enumerated: " + DEVICE_SERIAL)

    url = protocol.GetProtocolName() + "://" + DEVICE_SERIAL
    report["url"] = url
    report["friendlyName"] = protocol.GetFriendlyName(DEVICE_SERIAL)
    if not protocol.IsSupported(url):
        raise RuntimeError("RenderDoc does not support this Android device: " + url)

    emit("connecting-remote-server")
    connection, remote = rd.CreateRemoteServerConnection(url)
    if code_of(connection) == rd.ResultCode.NetworkIOFailed:
        emit("starting-remote-server")
        started = protocol.StartRemoteServer(url)
        report["startRemoteServerResult"] = str(code_of(started))
        if code_of(started) != rd.ResultCode.Succeeded:
            raise RuntimeError("Could not start RenderDoc Android server: " + str(code_of(started)))
        connection, remote = rd.CreateRemoteServerConnection(url)

    report["connectionResult"] = str(code_of(connection))
    if code_of(connection) != rd.ResultCode.Succeeded:
        raise RuntimeError("Could not connect to RenderDoc Android server: " + str(code_of(connection)))

    emit("configuring-vulkan-only-hook")
    set_android_property("debug.rdoc.RENDERDOC_HOOK_EGL", "0")
    egl_hook_disabled = True
    report["renderdocHookEgl"] = "0"

    emit("launching-game")
    options = rd.CaptureOptions()
    launch = remote.ExecuteAndInject(PACKAGE_ACTIVITY, "", "", [], options)
    report["launchResult"] = str(launch.result)
    report["targetIdent"] = launch.ident
    if launch.result != rd.ResultCode.Succeeded:
        raise RuntimeError("RenderDoc launch/injection failed: " + str(launch.result))

    ping_thread = threading.Thread(target=ping_remote, name="renderdoc-remote-ping")
    ping_thread.daemon = True
    ping_thread.start()

    if os.path.exists(TRIGGER_PATH):
        os.remove(TRIGGER_PATH)

    emit("waiting-for-trigger")
    deadline = time.time() + TRIGGER_TIMEOUT_SECONDS
    while not os.path.exists(TRIGGER_PATH):
        if report.get("remotePingLost"):
            raise RuntimeError("RenderDoc remote server connection was lost while waiting")
        if time.time() >= deadline:
            raise RuntimeError("Timed out waiting for capture trigger")
        time.sleep(0.25)

    emit("connecting-target-control")
    target = rd.CreateTargetControl(url, launch.ident, "capture-official-renderdoc.py", True)
    if target is None:
        raise RuntimeError("Could not connect to RenderDoc target control")

    emit("triggering-capture")
    target.TriggerCapture(1)

    message = None
    deadline = time.time() + CAPTURE_TIMEOUT_SECONDS
    while time.time() < deadline:
        message = target.ReceiveMessage(None)
        if message.type == rd.TargetControlMessageType.NewCapture:
            break
        if message.type == rd.TargetControlMessageType.Disconnected:
            raise RuntimeError("Target disconnected before a capture was produced")

    if message is None or message.type != rd.TargetControlMessageType.NewCapture:
        raise RuntimeError("Timed out waiting for RenderDoc capture notification")

    remote_path = message.newCapture.path
    report["remoteCapturePath"] = remote_path
    report["frameNumber"] = message.newCapture.frameNumber
    report["captureApi"] = str(message.newCapture.api)

    target.Shutdown()
    target = None
    stop_ping.set()
    ping_thread.join()
    ping_thread = None

    parent = os.path.dirname(CAPTURE_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    emit("copying-capture")
    remote.CopyCaptureFromRemote(remote_path, CAPTURE_PATH, None)

    report["captureBytes"] = os.path.getsize(CAPTURE_PATH)
    emit("complete")
except Exception as error:
    emit("failed", error=str(error), traceback=traceback.format_exc())
    exit_code = 1
finally:
    if target is not None:
        target.Shutdown()
    stop_ping.set()
    if ping_thread is not None:
        ping_thread.join()
    if remote is not None:
        remote.ShutdownConnection()
    if egl_hook_disabled:
        try:
            set_android_property("debug.rdoc.RENDERDOC_HOOK_EGL", "")
        except Exception:
            pass

sys.exit(exit_code)
