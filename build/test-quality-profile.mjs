import assert from "node:assert/strict";
import {
  selectCardQualityProfile,
  selectDynamicUIRenderScale,
} from "../public/render/quality-profile.js";

const profiles = {
  high: { quality_name: "High", source_render_target_request: { width: 1403, height: 1403 } },
  middle: { quality_name: "Middle", source_render_target_request: { width: 1122, height: 1122 } },
  low: { quality_name: "Low", source_render_target_request: { width: 982, height: 982 } },
};

const native = selectCardQualityProfile("auto", profiles, 1903, 4096);
assert.deepEqual(native.source_render_target_request, { width: 1903, height: 1903 });
assert.equal(selectDynamicUIRenderScale("auto", native, profiles), 1903 / 1122);

const smallDisplay = selectCardQualityProfile("auto", profiles, 800, 4096);
assert.deepEqual(smallDisplay.source_render_target_request, { width: 1122, height: 1122 });

const capped = selectCardQualityProfile("auto", profiles, 8192, 4096);
assert.deepEqual(capped.source_render_target_request, { width: 4096, height: 4096 });

assert.equal(selectCardQualityProfile("middle", profiles, 1903, 4096), profiles.middle);
assert.equal(selectDynamicUIRenderScale("middle", profiles.middle, profiles), 1);

console.log("Card quality profile selection OK");
