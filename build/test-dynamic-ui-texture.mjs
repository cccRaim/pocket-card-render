import assert from "node:assert/strict";
import { encodeOfficialHoloDynamicPixels } from "../public/render/dynamic-ui-texture.js";

const source = new Uint8Array([
  240, 120, 60, 255,
  240, 120, 60, 128,
  240, 120, 60, 0,
]);
const encoded = encodeOfficialHoloDynamicPixels(source);

assert.deepEqual([...encoded], [
  240, 120, 60, 0,
  120, 60, 30, 127,
  0, 0, 0, 255,
]);
assert.equal(encoded[3], 0, "opaque glyph RGB must survive the inverted-alpha encoding");
assert.notEqual(encoded[0], 0, "opaque glyph center must not be erased by a Canvas alpha round-trip");

console.log("Official DynamicUI holo RGBA8 encoding OK");
