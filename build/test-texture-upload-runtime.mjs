import { chromium } from "playwright";

const BASE_URL = process.env.PCR_TEXTURE_UPLOAD_RUNTIME_URL || "http://127.0.0.1:8011/";
const TEST_URL = new URL("/test-texture-upload-runtime.html", BASE_URL).href;
const diagnostics = [];

let browser;
let result;
let failure;
try {
  browser = await chromium.launch({
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 16, height: 16 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  await page.goto(TEST_URL, { waitUntil: "load", timeout: 15000 });
  await page.waitForFunction(
    () => window.__textureUploadRuntimeState?.done === true,
    null,
    { timeout: 15000 },
  );
  const state = await page.evaluate(() => window.__textureUploadRuntimeState);
  if (state.error) throw new Error(`${state.error.message}\n${state.error.stack || ""}`.trim());
  result = state.result;
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
}

if (failure || diagnostics.length) {
  if (failure) console.error(`BAD texture upload runtime sentinel: ${failure.message}`);
  for (const diagnostic of diagnostics) console.error(`BAD ${diagnostic}`);
  process.exitCode = 1;
} else {
  console.log("Texture upload browser runtime OK");
  console.log(`Runtime: three r${result.threeRevision}, ${result.gpuRenderer}, WebGL2 RGBA8`);
  console.log(`Hidden RGB at alpha=0: ${result.hiddenRgb.join(",")} preserved`);
  console.log(`Pixels: ${result.pixels.join(",")}`);
  console.log("Checks: PNG decode, unpremultiplied upload, raw sample, Y orientation, readPixels");
  console.log(`Screenshots: ${result.screenshots}`);
}
