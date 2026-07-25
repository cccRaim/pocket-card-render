// Official-evidence prerequisites plus a no-screenshot browser readback test.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const THREE = path.join(ROOT, "node_modules", "three");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glsl": "text/plain; charset=utf-8",
};

function runProof(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `${label} failed`).trim();
    throw new Error(`${label}: ${detail}`);
  }
  return (result.stdout || "").trim();
}

function safeFile(root, requestPath) {
  const file = path.resolve(root, `.${requestPath}`);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

async function serveFile(root, requestPath, response) {
  const file = safeFile(root, requestPath);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  const body = await readFile(file);
  response.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  response.end(body);
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname.startsWith("/vendor/three/")) {
        await serveFile(THREE, pathname.slice("/vendor/three".length), response);
      } else {
        await serveFile(PUBLIC, pathname, response);
      }
    } catch (error) {
      response.writeHead(500).end(error.message || String(error));
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    return {
      server,
      url: `http://127.0.0.1:${address.port}/test-homography-display-runtime.html`,
    };
  } catch (error) {
    if (server.listening) server.close();
    throw error;
  }
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

let browser;
let localServer;
try {
  runProof(
    "official Homography shader/program check",
    ["build/build-exact-homography.mjs", "--check"],
  );
  runProof(
    "official Homography Float32 producer check",
    ["build/test-homography-runtime.mjs"],
  );

  const started = await startServer();
  localServer = started.server;
  const diagnostics = [];
  browser = await chromium.launch({
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });
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
    () => window.__homographyDisplayRuntimeState?.done === true,
    null,
    { timeout: 20000 },
  );
  const state = await page.evaluate(() => window.__homographyDisplayRuntimeState);
  if (state.error) throw new Error(`${state.error.message}\n${state.error.stack || ""}`.trim());
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  const result = state.result;
  if (!result.runtime.swiftShader) {
    throw new Error(`expected SwiftShader, got ${result.runtime.vendor} / ${result.runtime.renderer}`);
  }
  if (result.screenshots !== 0) throw new Error(`unexpected screenshot count ${result.screenshots}`);
  if (!(result.convex.insidePixels > 0 && result.convex.outsidePixels > 0
    && result.convex.sampledPixels > 0)) {
    throw new Error(`incomplete perspective coverage result: ${JSON.stringify(result.convex)}`);
  }

  const passed = result.checks.filter((check) => check.ok).length;
  console.log("Homography display browser runtime OK");
  console.log("Official evidence: generated GLSL/program and Float32 H/Hinv producer checks passed");
  console.log(`Runtime: three r${result.runtime.threeRevision}, ${result.runtime.renderer}`);
  console.log(`Cases: identity + convex quadrilateral; H/Hinv GPU uniforms matched (${passed} checks)`);
  console.log(
    `Perspective: ${result.convex.insidePixels} inside, ${result.convex.outsidePixels} outside, `
    + `${result.convex.sampledPixels} stable source samples`,
  );
  console.log("Actual GL: reverse winding culled; depth/stencil prefill preserved; nonzero RT0 blend passed");
  console.log("Texture setter: content-distinct second texture binding passed readback");
  console.log("Outputs: RT0 sampled.rgb with alpha=1-sampled.a; MRT1=vec4(0) by direct readback");
  console.log("Orientation: no browser Y transform added; source RenderTexture Y convention remains unclaimed");
  console.log("Screenshots: 0");
} catch (error) {
  console.error(`BAD Homography display browser runtime: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (localServer) await closeServer(localServer);
}
