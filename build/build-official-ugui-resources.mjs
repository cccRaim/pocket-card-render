import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "render", "card-ui-resource-contract.json");
const PYTHON = process.env.PYTHON || "python";

export function extractOfficialUGUIResources() {
  const args = ["build/extract_official_ugui_resources.py"];
  if (process.env.PCR_DECRYPTED_ROOT) args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "official UGUI resource extraction failed").trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

export function buildOfficialUGUIResourceContract(extracted) {
  assert.equal(extracted.schema, "pocket-card-render/official-ugui-resources@1");
  const sprites = new Map(extracted.sprites.map((row) => [row.identity, row]));
  const textures = new Map(extracted.textures.map((row) => [row.identity, row]));
  const images = {};
  for (const image of extracted.images) {
    let sprite = null;
    if (image.spritePointer) {
      const sourceSprite = sprites.get(image.spritePointer.identity);
      assert(sourceSprite, `${image.imageIdentity}: Sprite object is unresolved`);
      const texture = textures.get(sourceSprite.texturePointer.identity);
      assert(texture, `${sourceSprite.identity}: Texture2D object is unresolved`);
      assert.match(texture.sourceBundle, /\.png_bundles$/);
      const relativePng = texture.sourceBundle.replace(/_bundles$/, "");
      sprite = {
        identity: sourceSprite.identity,
        name: sourceSprite.name,
        objectSha256: sourceSprite.rawSha256,
        rect: sourceSprite.rect,
        border: sourceSprite.border,
        pixelsToUnits: sourceSprite.pixelsToUnits,
        pivot: sourceSprite.pivot,
        texture: {
          identity: texture.identity,
          name: texture.name,
          objectSha256: texture.rawSha256,
          sourceBundle: texture.sourceBundle,
          sourceBundleSha256: texture.sourceBundleSha256,
          width: texture.width,
          height: texture.height,
          textureFormat: texture.textureFormat,
          mipCount: texture.mipCount,
          colorSpace: texture.colorSpace,
          sampler: texture.sampler,
          stream: texture.stream,
          payloadByteSize: texture.payloadByteSize,
          payloadSha256: texture.payloadSha256,
          url: `/game/Assets/Lettuce/_Data/${relativePng}`,
        },
      };
    }
    images[image.imageRawSha256] = {
      prefabKind: image.prefabKind,
      imageIdentity: image.imageIdentity,
      gameObjectName: image.gameObjectName,
      sprite,
      materialIdentity: image.materialPointer?.identity || null,
    };
  }
  assert.equal(Object.keys(images).length, extracted.summary.images);
  return {
    schema: "pocket-card-render/card-ui-resource-contract@1",
    schemaVersion: 1,
    unityVersion: extracted.unityVersion,
    source: {
      evidenceSha256: extracted.evidenceSha256,
      digests: extracted.digests,
      prefabs: extracted.prefabs,
    },
    summary: extracted.summary,
    material: extracted.materials[0],
    shader: extracted.shaders[0],
    images,
  };
}

export function serializeOfficialUGUIResourceContract(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

function main() {
  const contract = buildOfficialUGUIResourceContract(extractOfficialUGUIResources());
  const serialized = serializeOfficialUGUIResourceContract(contract);
  const check = process.argv.includes("--check") || process.env.PCR_UGUI_RESOURCE_CHECK === "1";
  if (check) {
    assert.equal(fs.readFileSync(OUTPUT, "utf8"), serialized, "card-ui-resource-contract.json is stale");
    console.log(`Official UGUI resource contract OK: ${contract.summary.images} Images`);
    return;
  }
  fs.writeFileSync(OUTPUT, serialized);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${contract.summary.images} Images)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
