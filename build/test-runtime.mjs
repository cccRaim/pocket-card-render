// Low-overhead browser smoke test for the four reference scenes.
// It renders deterministic frames and collects runtime failures without screenshots.
import { chromium } from "playwright";

const BASE_URL = process.env.PCR_RUNTIME_URL || "http://127.0.0.1:8011/";
const APP_ORIGIN = new URL(BASE_URL).origin;
const SCENES = [
  ["scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json", 28, 0],
  ["scene.cTR_20_000230_00_LEAF_SR.json", 21, 0],
  ["scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json", 21, 2],
  ["scene.cPK_20_008900_02_HOUOUex_UR.json", 20, 2],
];

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 450, height: 600 }, deviceScaleFactor: 1 });
let current = null;
const records = new Map(SCENES.map(([scene]) => [scene, { errors: [], built: null, mrt: null }]));

page.on("console", (message) => {
  if (!current) return;
  const text = message.text();
  const built = /^built (\d+) meshes\b/.exec(text);
  if (built) records.get(current).built = Number(built[1]);
  // External font/CDN failures are covered by requestfailed when they belong to
  // the app origin. Chromium's generic resource message contains no URL.
  if (message.type() === "error" && !/^Failed to load resource:/.test(text)) {
    records.get(current).errors.push(`console: ${text}`);
  }
});
page.on("pageerror", (error) => {
  if (current) records.get(current).errors.push(`pageerror: ${error.message}`);
});
page.on("requestfailed", (request) => {
  if (current && new URL(request.url()).origin === APP_ORIGIN) {
    records.get(current).errors.push(`request: ${request.url()} (${request.failure()?.errorText || "failed"})`);
  }
});
page.on("response", (response) => {
  if (current && response.status() >= 400 && new URL(response.url()).origin === APP_ORIGIN) {
    records.get(current).errors.push(`http ${response.status()}: ${response.url()}`);
  }
});

try {
  for (const [scene, expectedBuilt, expectedFlares] of SCENES) {
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
    const runtime = await page.evaluate(() => ({
      mrt: window.__mrtDiagnostics || null,
      display: window.__displayDiagnostics || null,
      bloom: window.__post?.diagnostics?.() || null,
      displayPass: window.__displayPost?.diagnostics?.() || null,
      flareLayers: (window.__layerLabels || []).filter((label) => label.includes("Card_UR_LensFlare")).length,
      duplicateCullOffLayers: (() => {
        let count = 0;
        window.__tilt?.traverse((object) => {
          const material = object.isMesh ? object.material : null;
          if (material?.transparent && material.side === 2 && !material.forceSinglePass) count += 1;
        });
        return count;
      })(),
      queuePartitionErrors: (() => {
        const errors = [];
        window.__tilt?.traverse((object) => {
          if (!object.isMesh || !object.userData.label) return;
          const match = /\bq(\d+)\b/.exec(object.userData.label);
          if (!match) return;
          const queue = Number(match[1]);
          const expectedTransparent = queue >= 2501 && queue <= 5000;
          if (queue <= 5000 && object.material.transparent !== expectedTransparent) {
            errors.push(`${object.userData.label}: transparent=${object.material.transparent}`);
          }
        });
        return errors;
      })(),
      webglError: document.getElementById("c")?.getContext("webgl2")?.getError() ?? -1,
    }));
    record.mrt = runtime.mrt;
    if (record.built !== expectedBuilt) {
      record.errors.push(`mesh count: expected ${expectedBuilt}, got ${record.built ?? "no build log"}`);
    }
    if (record.mrt?.attachments !== 2 || !(record.mrt?.cardPasses > 0)) {
      record.errors.push(`MRT diagnostics: ${JSON.stringify(record.mrt)}`);
    }
    if (runtime.display?.mode !== "PrerenderHomographyCard"
      || runtime.display?.clampParallax !== true
      || runtime.display?.sourceSize?.join("x") !== "1122x1122"
      || runtime.display?.sourceCameraAspect !== 1
      || runtime.display?.vertexInput !== "uv"
      || runtime.display?.finiteMatrices !== true
      || runtime.display?.viewportPoints?.length !== 4
      || !(runtime.display?.sourcePixelProbe?.distinctRgb > 1)
      || !(runtime.display?.sourcePixelProbe?.maxRgb > 0)
      || !(runtime.display?.pixelProbe?.distinctRgb > 1)
      || !(runtime.display?.pixelProbe?.maxRgb > 0)) {
      record.errors.push(`display diagnostics: ${JSON.stringify(runtime.display)}`);
    }
    const points = runtime.display?.viewportPoints;
    if (!(runtime.display?.sourceCameraPosition?.[2] > 0)
      || runtime.display?.displayQuaternion?.some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-6)
      || !(points?.[0]?.[0] < points?.[1]?.[0])
      || !(points?.[0]?.[1] < points?.[2]?.[1])) {
      record.errors.push(`display coordinate basis: ${JSON.stringify(runtime.display)}`);
    }
    if (runtime.webglError !== 0) record.errors.push(`WebGL error: ${runtime.webglError}`);
    if (runtime.bloom?.webglErrors?.length) {
      record.errors.push(`Bloom WebGL errors: ${JSON.stringify(runtime.bloom.webglErrors)}`);
    }
    if (runtime.displayPass?.webglErrors?.length) {
      record.errors.push(`Display WebGL errors: ${JSON.stringify(runtime.displayPass.webglErrors)}`);
    }
    if (runtime.flareLayers !== expectedFlares) {
      record.errors.push(`LensFlare layers: expected ${expectedFlares}, got ${runtime.flareLayers}`);
    }
    if (runtime.duplicateCullOffLayers !== 0) {
      record.errors.push(`Cull Off layers scheduled as duplicate transparent draws: ${runtime.duplicateCullOffLayers}`);
    }
    if (runtime.queuePartitionErrors.length) {
      record.errors.push(`render queue partition: ${runtime.queuePartitionErrors.join("; ")}`);
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
