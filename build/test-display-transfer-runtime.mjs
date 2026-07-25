// Numerically audit the browser canvas-to-compositor input contract. No screenshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "public", "test-display-transfer-runtime.html");

if (process.env.PCR_DISPLAY_TRANSFER_STATIC_VERIFIED !== "1") {
  const staticAudit = spawnSync(process.execPath, ["build/audit-official-display-transfer.mjs"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (staticAudit.status !== 0) {
    throw new Error((staticAudit.stderr || staticAudit.stdout || "static display-transfer audit failed").trim());
  }
}

const server = http.createServer((request, response) => {
  if (new URL(request.url, "http://localhost").pathname !== "/test-display-transfer-runtime.html") {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(fs.readFileSync(FIXTURE));
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const url = `http://127.0.0.1:${address.port}/test-display-transfer-runtime.html`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
      "--force-color-profile=srgb",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 64, height: 64 }, colorScheme: "light" });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.stack || error.message));

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__displayTransferResult?.state !== undefined);
  const result = await page.evaluate(() => window.__displayTransferResult);

  assert.equal(result.state, "done", result.message);
  assert.deepEqual(result.checks, {
    drawingBufferRGBA8: true,
    linearAttachmentEncoding: true,
    srgbCanvasColorSpace: true,
    gammaDomainReadbackIdentity: true,
    opaqueAlpha: true,
    noGLError: true,
  });
  assert.deepEqual(result.readPixels, result.expected);
  assert.deepEqual(result.framebuffer, {
    drawingBufferFormat: 32856,
    redBits: 8,
    greenBits: 8,
    blueBits: 8,
    alphaBits: 8,
    componentType: 35863,
    colorEncoding: 9729,
    objectType: 33304,
  });
  assert.equal(result.drawingBufferColorSpace, "srgb");
  assert.equal(result.contract.compositorInput.status, "proven");
  assert.equal(result.contract.compositorInput.storage, "RGBA8_UNORM");
  assert.equal(result.contract.compositorInput.attachmentEncoding, "GL_LINEAR");
  assert.equal(result.contract.compositorInput.alpha, "opaque");
  assert.equal(result.contract.deviceOutput.status, "not-observable");
  assert.equal(result.contract.deviceState.androidVkSurfaceFormats, "must be queried on the target Android device");
  assert.match(result.runtimeMetadata.gpuRenderer, /SwiftShader/i);
  assert.equal(result.screenshots, 0);
  assert.deepEqual(consoleErrors, []);

  console.log("Display-transfer runtime audit OK");
  console.log(JSON.stringify({
    checks: result.checks,
    framebuffer: result.framebuffer,
    drawingBufferColorSpace: result.drawingBufferColorSpace,
    contract: result.contract,
    runtimeMetadata: result.runtimeMetadata,
    screenshots: result.screenshots,
  }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
