// Headless screenshot of the renderer so we can SEE the output (software WebGL via SwiftShader).
// Usage: node build/shot.mjs "<url>" <out.png>   (dev server must be running, default :8011)
//   node build/shot.mjs "http://localhost:8011/?scene=scene.tr.json" shot_tr.png
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8011/";
const out = process.argv[3] || "shot.png";

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
// wait for the loading overlay to fade out (render ready), else fall back
await page.waitForFunction(() => {
  const l = document.getElementById("loading");
  return l && l.classList.contains("hidden");
}, { timeout: 45000 }).catch(() => console.log("(loading overlay never hid — capturing anyway)"));
// optional tilt: 4th arg "up"/"down"/"left"/"right" moves the pointer so the card 3D-tilts that way
const tilt = process.argv[4];
if (tilt) {
  const b = await page.$eval("#c", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const pos = { up: [cx, b.y + 4], down: [cx, b.y + b.h - 4], left: [b.x + 4, cy], right: [b.x + b.w - 4, cy] }[tilt] || [cx, cy];
  await page.mouse.move(pos[0], pos[1]);
  await page.waitForTimeout(800);   // let the slerp settle on the tilt
}
await page.waitForTimeout(1200);   // let a few frames settle
await page.screenshot({ path: out });
console.log("wrote", out);
if (errs.length) console.log("CONSOLE ERRORS:\n" + errs.slice(0, 30).join("\n"));
else console.log("no console errors");
await browser.close();
