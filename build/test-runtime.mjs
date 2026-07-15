// Low-overhead browser smoke test for the four reference scenes.
// It renders deterministic frames and collects runtime failures without screenshots.
import { chromium } from "playwright";

const BASE_URL = process.env.PCR_RUNTIME_URL || "http://127.0.0.1:8011/";
const SCENES = [
  ["scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json", 26],
  ["scene.cTR_20_000230_00_LEAF_SR.json", 19],
  ["scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json", 17],
  ["scene.cPK_20_008900_02_HOUOUex_UR.json", 16],
];

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 450, height: 600 }, deviceScaleFactor: 1 });
let current = null;
const records = new Map(SCENES.map(([scene]) => [scene, { errors: [], built: null }]));

page.on("console", (message) => {
  if (!current) return;
  const text = message.text();
  const built = /^built (\d+) meshes\b/.exec(text);
  if (built) records.get(current).built = Number(built[1]);
  if (message.type() === "error") records.get(current).errors.push(`console: ${text}`);
});
page.on("pageerror", (error) => {
  if (current) records.get(current).errors.push(`pageerror: ${error.message}`);
});
page.on("requestfailed", (request) => {
  if (current) records.get(current).errors.push(`request: ${request.url()} (${request.failure()?.errorText || "failed"})`);
});
page.on("response", (response) => {
  if (current && response.status() >= 400) {
    records.get(current).errors.push(`http ${response.status()}: ${response.url()}`);
  }
});

try {
  for (const [scene, expectedBuilt] of SCENES) {
    current = scene;
    const url = new URL(BASE_URL);
    url.searchParams.set("scene", scene);
    url.searchParams.set("lc", "zh_TW");
    url.searchParams.set("nohud", "");
    url.searchParams.set("shot", "1");
    url.searchParams.set("fps", "1");

    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => document.getElementById("loading")?.classList.contains("hidden"), null, {
      timeout: 45000,
    });
    await page.evaluate(async () => window.__renderShotFrames?.(2, 1000));

    const record = records.get(scene);
    if (record.built !== expectedBuilt) {
      record.errors.push(`mesh count: expected ${expectedBuilt}, got ${record.built ?? "no build log"}`);
    }
    console.log(`${record.errors.length ? "FAIL" : "OK  "} ${scene} (${record.built ?? "?"} meshes)`);
  }
} finally {
  await browser.close();
}

const failures = [...records.entries()].flatMap(([scene, record]) => record.errors.map((error) => `${scene}: ${error}`));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("OK   runtime smoke test: 4 scenes, no screenshots");
}
