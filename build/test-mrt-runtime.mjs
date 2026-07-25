// One-shot, no-screenshot WebGL2 MRT sentinel. It expects the local static
// server at :8011 and closes Chromium as soon as the 8x8 checks complete.
import { chromium } from "playwright";

const BASE_URL = process.env.PCR_MRT_RUNTIME_URL || "http://127.0.0.1:8011/";
const TEST_URL = new URL("/test-mrt-runtime.html", BASE_URL).href;
const APP_ORIGIN = new URL(TEST_URL).origin;
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
  const page = await browser.newPage({
    viewport: { width: 64, height: 64 },
    deviceScaleFactor: 1,
  });

  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (new URL(url).origin === APP_ORIGIN) {
      diagnostics.push(`request: ${url} (${request.failure()?.errorText || "failed"})`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && new URL(url).origin === APP_ORIGIN) {
      diagnostics.push(`http ${response.status()}: ${url}`);
    }
  });

  await page.goto(TEST_URL, { waitUntil: "load", timeout: 15000 });
  await page.waitForFunction(
    () => window.__mrtRuntimeState?.done === true,
    null,
    { timeout: 15000 },
  );
  const state = await page.evaluate(() => window.__mrtRuntimeState);
  if (state.error) throw new Error(`${state.error.message}\n${state.error.stack || ""}`.trim());
  result = state.result;
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
}

if (failure || diagnostics.length) {
  if (failure) console.error(`BAD official MRT runtime sentinel: ${failure.message}`);
  for (const diagnostic of diagnostics) console.error(`BAD ${diagnostic}`);
  process.exitCode = 1;
} else {
  const capabilities = result.target.capabilities;
  const sentinel = result.sentinel;
  console.log("Official MRT runtime sentinel OK");
  console.log(
    `Capabilities: WebGL2, MAX_DRAW_BUFFERS=${capabilities.maxDrawBuffers}, `
    + `MAX_COLOR_ATTACHMENTS=${capabilities.maxColorAttachments}`,
  );
  console.log("Target:       three r165, count=2, RGBA8/UnsignedByte, Point, depth24-stencil8, samples=0");
  console.log(
    `Sentinel:     FRAMEBUFFER_COMPLETE, RT0 alpha=${sentinel.rt0.join(",")}, `
    + `RT1 shared alpha=${sentinel.rt1.join(",")}`,
  );
  console.log(
    `Three draw:   one draw, RT0 alpha=${result.target.draw.rt0.join(",")}, `
    + `RT1 shared alpha=${result.target.draw.rt1.join(",")}`,
  );
  console.log(`Lifecycle:    resize complete, dispose events=${result.target.disposeEvents}`);
}
