import assert from "node:assert/strict";
import { auditRuntimeDisplayFidelity } from "./audit-runtime-display-fidelity.mjs";

const report = auditRuntimeDisplayFidelity();
const byId = new Map(report.requirements.map((item) => [item.id, item]));

assert.equal(report.schema, "pocket-card-render/runtime-display-fidelity-audit@1");
assert.equal(report.screenshotPolicy.includes("No screenshots"), true);
for (const id of [
  "local-runtime-inventory",
  "css-dpr-drawing-buffer",
  "display-rt-density",
  "source-rt-contract",
  "dynamic-ui-density",
  "official-default-quality-active",
  "emulator-host-presentation",
]) {
  assert.equal(byId.get(id)?.status, "exact", `${id} must remain source-current and exact`);
}
assert.equal(byId.get("guest-vulkan-card-frame")?.exactUnits, 0);
assert.equal(byId.get("native-device-display")?.exactUnits, 0);
assert.equal(report.exactUnits, 25);
assert.equal(report.totalUnits, 27);

console.log("Runtime display fidelity regression: pass (25/27 exact, screenshot-free)");
