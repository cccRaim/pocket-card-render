// No-screenshot WebGL2 draw-state runner. With no injected input it asks the
// official audit module to build one from the current scenes and shader data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function decodedEnvironmentInput() {
  const encoded = process.env.PCR_DRAW_STATE_INPUT_BASE64;
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export async function runDrawStateRuntime(input, options = {}) {
  const baseUrl = options.baseUrl
    || process.env.PCR_DRAW_STATE_RUNTIME_URL
    || "http://127.0.0.1:8011/";
  const testUrl = new URL("/test-draw-state-runtime.html", baseUrl).href;
  const appOrigin = new URL(testUrl).origin;
  const diagnostics = [];
  let browser;

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
    await page.addInitScript((drawStateInput) => {
      window.__PCR_DRAW_STATE_INPUT__ = drawStateInput;
    }, input);

    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (new URL(url).origin === appOrigin) {
        diagnostics.push(`request: ${url} (${request.failure()?.errorText || "failed"})`);
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      if (response.status() >= 400 && new URL(url).origin === appOrigin) {
        diagnostics.push(`http ${response.status()}: ${url}`);
      }
    });

    await page.goto(testUrl, { waitUntil: "load", timeout: 15000 });
    await page.waitForFunction(
      () => window.__drawStateRuntimeState?.done === true,
      null,
      { timeout: 20000 },
    );
    const state = await page.evaluate(() => window.__drawStateRuntimeState);
    if (state.error) {
      throw new Error(`${state.error.message}\n${state.error.stack || ""}`.trim());
    }
    if (diagnostics.length) throw new Error(diagnostics.join("\n"));
    return state.result;
  } finally {
    await browser?.close();
  }
}

function compactState(capture) {
  if (!capture) return "no draw captured";
  const blend = capture.blend;
  const depth = capture.depth;
  const cull = capture.cull;
  const stencil = capture.stencil;
  return [
    `blend=${blend.enabled ? `${blend.srcRGBName}/${blend.dstRGBName};a=${blend.srcAlphaName}/${blend.dstAlphaName}` : "off"}`,
    `depth=${depth.enabled ? `${depth.funcName};write=${depth.writeMask}` : `off;write=${depth.writeMask}`}`,
    `cull=${cull.enabled ? cull.modeName : "off"}`,
    `stencil=${stencil.enabled ? `${stencil.funcName};ref=${stencil.ref};read=${stencil.readMask & 0xff};write=${stencil.writeMask & 0xff};pass=${stencil.depthPassName}` : "off"}`,
    `drawBuffers=${capture.drawBufferNames.join("+")}`,
  ].join(" ");
}

export function printDrawStateRuntimeResult(result) {
  const mark = result.failures.length ? "FAILED" : "OK";
  console.log(`Official draw-state runtime audit ${mark}`);
  console.log(
    `Runtime: three r${result.runtime.threeRevision}, ${result.runtime.webglVersion}, ${result.runtime.renderer}`,
  );
  for (const name of ["opaque", "transparent", "cullOff", "stencil", "mrtSharedBlend"]) {
    const capture = result.cases[name]?.drawCaptures?.[0];
    const source = result.selected[name];
    console.log(
      `${name.padEnd(14)} ${source.scene}:${source.material} (${source.shader}) ${compactState(capture)}`,
    );
  }
  const mrt = result.cases.mrtSharedBlend?.pixels;
  if (mrt) {
    console.log(`MRT pixels:    RT0=${mrt.rt0Left.join(",")} RT1=${mrt.rt1Left.join(",")}`);
  }
  const passed = result.checks.filter((check) => check.ok).length;
  console.log(`Checks:        ${passed}/${result.checks.length} passed, no screenshots`);
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`BAD ${failure}`);
    if (result.failures.some((failure) => /stencil write mask|write-mask preserves/.test(failure))) {
      console.error(
        "DIAG three r165 WebGLState consumes Material.stencilWriteMask; compare that field with the context helper assignment.",
      );
    }
  }
}

async function main() {
  let input = decodedEnvironmentInput();
  if (!input) {
    const { buildOfficialDrawStateInput } = await import("./audit-official-draw-state.mjs");
    input = buildOfficialDrawStateInput();
  }
  const result = await runDrawStateRuntime(input);
  printDrawStateRuntimeResult(result);
  if (result.failures.length) process.exitCode = 1;
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(`BAD draw-state runtime runner: ${error.message}`);
    process.exitCode = 1;
  });
}
