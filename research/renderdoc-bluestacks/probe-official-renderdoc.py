import json
import os
import sys

import renderdoc as rd


DEVICE_SERIAL = os.environ.get("PCR_RENDERDOC_DEVICE", "127.0.0.1:5555")
OUTPUT_PATH = os.environ.get(
    "PCR_RENDERDOC_PROBE_OUT",
    os.path.abspath(".renderdoc-probe.json"),
)


def emit(report):
    payload = json.dumps(report, ensure_ascii=True, indent=2) + "\n"
    with open(OUTPUT_PATH, "w", encoding="utf-8") as output:
        output.write(payload)
    print(payload, end="")


def result_name(result):
    code = getattr(result, "code", result)
    return str(code)


protocols = list(rd.GetSupportedDeviceProtocols())
report = {
    "schema": "pocket-card-render/renderdoc-android-probe@1",
    "protocols": protocols,
    "deviceSerial": DEVICE_SERIAL,
}
report["status"] = "protocols-enumerated"
emit(report)

if "adb" not in protocols:
    report["status"] = "unsupported"
    emit(report)
    sys.exit(2)

protocol = rd.GetDeviceProtocolController("adb")
report["status"] = "enumerating-devices"
emit(report)
devices = list(protocol.GetDevices())
report["devices"] = devices
report["status"] = "devices-enumerated"
emit(report)

if DEVICE_SERIAL not in devices:
    report["status"] = "device-not-found"
    emit(report)
    sys.exit(3)

url = f"{protocol.GetProtocolName()}://{DEVICE_SERIAL}"
report["url"] = url
report["friendlyName"] = protocol.GetFriendlyName(DEVICE_SERIAL)
report["supported"] = protocol.IsSupported(url)
report["supportsMultiplePrograms"] = protocol.SupportsMultiplePrograms(url)

report["status"] = "connecting"
emit(report)
result, remote = rd.CreateRemoteServerConnection(url)
report["connectionResult"] = result_name(result)

if getattr(result, "code", result) != rd.ResultCode.Succeeded:
    report["status"] = "connection-failed"
    emit(report)
    sys.exit(4)

try:
    report["status"] = "connected"
    emit(report)
    report["status"] = "querying-remote-drivers"
    emit(report)
    report["remoteDrivers"] = [str(driver) for driver in remote.RemoteSupportedReplays()]
    report["status"] = "complete"
    emit(report)
finally:
    remote.ShutdownConnection()

sys.exit(0)
