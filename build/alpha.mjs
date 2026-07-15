// Per-texture stored-pixel classifier (node port of build/detect_alpha.py). This is diagnostic metadata,
// never render-state authority: official material/pass state and fragment output control blending.
//
//   opaque   : <2% of pixels have alpha < 250 (effectively no transparency)
//   straight : ≥2% of pixels have max(rgb) > alpha+40 (impossible for premultiplied)
//   premult  : premultiplied candidate; has transparency but never rgb > alpha+40
//
// Reads the PNG's TRUE stored RGB (a browser <canvas> zeroes transparent pixels' RGB, so it can't classify).
// Results are memoised to apks/output/tex_alpha_modes.json keyed by texture name (content is static), so only
// the first build of a never-seen texture pays the decode cost.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PNG } from "pngjs";

export function classifyAlpha(absPath) {
  const png = PNG.sync.read(readFileSync(absPath));   // pngjs normalises to 8-bit RGBA
  const d = png.data, n = png.width * png.height;
  let nonOpaque = 0, straightPx = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4, al = d[o + 3];
    if (al < 250) nonOpaque++;
    if (Math.max(d[o], d[o + 1], d[o + 2]) > al + 40) straightPx++;
  }
  if (nonOpaque / n < 0.02) return "opaque";
  return straightPx / n > 0.02 ? "straight" : "premult";
}

// A persistent name->mode cache. resolve(name) -> absolute PNG path (null if unknown).
export function makeAlphaCache(cacheFile) {
  let cache = {};
  try { if (existsSync(cacheFile)) cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch {}
  let dirty = false;
  return {
    modeFor(name, absPath) {
      if (name in cache) return cache[name];
      let mode = "premult";                       // detect_alpha.py's fallback on read failure
      if (absPath) { try { mode = classifyAlpha(absPath); } catch {} }
      cache[name] = mode; dirty = true;
      return mode;
    },
    flush() { if (dirty) { try { writeFileSync(cacheFile, JSON.stringify(cache, null, 0)); dirty = false; } catch {} } },
  };
}
