import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function safeFile(requestPath) {
  const file = path.resolve(PUBLIC, `.${requestPath}`);
  const relative = path.relative(PUBLIC, file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : file;
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const file = safeFile(pathname);
      const info = file ? await stat(file).catch(() => null) : null;
      if (!info?.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(await readFile(file));
    } catch (error) {
      response.writeHead(500).end(error.message || String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/test-shader-precision-runtime.html`,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertFiniteVector(values, label) {
  assert.equal(values.length, 4, `${label}: expected vec4`);
  for (const value of values) assert.ok(Number.isFinite(value), `${label}: non-finite value ${value}`);
}

function assertPrecisionFormats(formats) {
  for (const stage of ["vertex", "fragment"]) {
    const medium = formats[stage].mediumFloat;
    const high = formats[stage].highFloat;
    assert.ok(medium && high, `${stage}: float precision format unavailable`);
    assert.ok(medium.precision > 0, `${stage}: mediump reports no mantissa precision`);
    assert.ok(high.precision >= medium.precision,
      `${stage}: highp precision ${high.precision} is below mediump ${medium.precision}`);
    assert.ok(high.rangeMax >= medium.rangeMax,
      `${stage}: highp range ${high.rangeMax} is below mediump ${medium.rangeMax}`);
  }
}

let browser;
let server;
try {
  const started = await startServer();
  server = started.server;
  const diagnostics = [];
  browser = await chromium.launch({
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 8, height: 8 }, deviceScaleFactor: 1 });
  const origin = new URL(started.url).origin;
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === origin) {
      diagnostics.push(`request: ${request.url()} (${request.failure()?.errorText || "failed"})`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === origin) {
      diagnostics.push(`http ${response.status()}: ${response.url()}`);
    }
  });

  await page.goto(started.url, { waitUntil: "load", timeout: 15000 });
  await page.waitForFunction(
    () => window.__shaderPrecisionRuntimeState?.done === true,
    null,
    { timeout: 20000 },
  );
  const state = await page.evaluate(() => window.__shaderPrecisionRuntimeState);
  if (state.error) throw new Error(`${state.error.message}\n${state.error.stack || ""}`.trim());
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  const result = state.result;
  assert.equal(result.screenshots, 0, "runtime probe must not take screenshots");
  assert.equal(result.runtime.floatColorBuffer, true, "float color-buffer readback unavailable");
  assert.equal(result.runtime.swiftShader, true,
    `expected SwiftShader, got ${result.runtime.vendor} / ${result.runtime.renderer} / ${result.runtime.unmaskedRenderer}`);
  assertPrecisionFormats(result.precisionFormats);
  assert.equal(result.probes.length, 2, "numeric probe set drifted");
  for (const probe of result.probes) {
    for (const stage of ["vertex", "fragment"]) {
      assertFiniteVector(probe[stage].mediump, `${probe.name} ${stage} mediump`);
      assertFiniteVector(probe[stage].highp, `${probe.name} ${stage} highp`);
      assertFiniteVector(probe[stage].absDiff, `${probe.name} ${stage} absDiff`);
      assert.equal(probe[stage].exactMatch, true,
        `${probe.name} ${stage}: SwiftShader did not exhibit FP32-like mediump promotion`);
      assert.equal(probe[stage].maxAbsDiff, 0,
        `${probe.name} ${stage}: unexpected mediump/highp delta`);
    }
  }
  const mantissa = result.probes.find((probe) => probe.name === "mantissa-and-range");
  assert.deepEqual(mantissa.vertex.highp, [2 ** -11, 2 ** -12, 1, 2048 ** 2]);
  assert.deepEqual(mantissa.fragment.highp, [2 ** -11, 2 ** -12, 1, 2048 ** 2]);
  assert.equal(result.classification.swiftShaderFp32LikePromotionObserved, true);
  assert.equal(result.classification.backendConditional, true);
  assert.equal(result.classification.officialTargetGpuInference, false);

  console.log("shader precision WebGL2 runtime probe: OK");
  console.log(`  backend: ${result.runtime.unmaskedRenderer || result.runtime.renderer}`);
  console.log(`  precision formats: ${JSON.stringify(result.precisionFormats)}`);
  console.log(`  numeric probes: ${JSON.stringify(result.probes)}`);
  console.log("  classification: SwiftShader mediump matched highp for these probes (backend-conditional FP32-like promotion)");
  console.log("  official Android target-GPU inference: false");
  console.log("  screenshots: 0");
} catch (error) {
  console.error(`BAD shader precision WebGL2 runtime probe: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await closeServer(server);
}
