import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-publish.mjs";

const ASSET_BASE_URL =
  "https://prod-game-assets-app-41283.akamaized.net/Default";
const MAIN_KEY_ADDRESS_HASH = "14c71e317605be72";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) {
      throw new Error(`Unexpected argument: ${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    args[name.slice(2)] = value;
    index += 1;
  }
  for (const required of ["catalog", "decrypted-root", "output-root", "filter"]) {
    if (!args[required]) {
      throw new Error(`--${required} is required`);
    }
  }
  return args;
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return results;
}

async function downloadBlob(entry, outputRoot) {
  const hash = entry.blobHash.toLowerCase();
  const directory = path.join(outputRoot, "blob", hash.slice(0, 2));
  const destination = path.join(directory, `${hash}.aladin`);
  await mkdir(directory, { recursive: true });

  if ((await fileSize(destination)) !== entry.blobSize) {
    const url = `${ASSET_BASE_URL}/blob/${hash.slice(0, 2)}/${hash}.aladin`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed ${response.status} ${url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== entry.blobSize) {
      throw new Error(
        `Blob size mismatch for ${hash}: expected ${entry.blobSize}, got ${bytes.length}`,
      );
    }
    await atomicWriteFile(destination, bytes);
  }

  const bytes = await readFile(destination);
  if (bytes.length !== entry.blobSize) {
    throw new Error(
      `Persisted blob size mismatch for ${hash}: expected ${entry.blobSize}, got ${bytes.length}`,
    );
  }
  return {
    blobHash: hash,
    blobSize: entry.blobSize,
    sha256: sha256(bytes),
    relativePath: path
      .relative(outputRoot, destination)
      .split(path.sep)
      .join("/"),
  };
}

async function preserveIndex(indexPath, outputRoot) {
  if (!indexPath) {
    return null;
  }
  const name = path.basename(indexPath, ".aladin");
  if (!/^[0-9a-f]{16}$/i.test(name)) {
    throw new Error(`Index filename is not a 16-hex hash: ${indexPath}`);
  }
  const directory = path.join(outputRoot, "index", name.slice(0, 2));
  const destination = path.join(directory, `${name.toLowerCase()}.aladin`);
  await mkdir(directory, { recursive: true });
  if ((await fileSize(destination)) === null) {
    try {
      await link(indexPath, destination);
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error.code)) {
        throw error;
      }
      await copyFile(indexPath, destination);
    }
  }
  const bytes = await readFile(destination);
  return {
    hash: name.toLowerCase(),
    bytes: bytes.length,
    sha256: sha256(bytes),
    relativePath: path
      .relative(outputRoot, destination)
      .split(path.sep)
      .join("/"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogBytes = await readFile(args.catalog);
  const catalog = JSON.parse(catalogBytes);
  if (!Array.isArray(catalog)) {
    throw new Error("Catalog must be a JSON array");
  }

  const filter = new RegExp(args.filter);
  const candidates = catalog.filter((entry) => filter.test(entry.path));
  let referenceCatalogBytes = null;
  let referenceByPath = null;
  if (args["reference-catalog"]) {
    referenceCatalogBytes = await readFile(args["reference-catalog"]);
    const referenceCatalog = JSON.parse(referenceCatalogBytes);
    if (!Array.isArray(referenceCatalog)) {
      throw new Error("Reference catalog must be a JSON array");
    }
    referenceByPath = new Map(
      referenceCatalog.map((entry) => [entry.path, entry]),
    );
  }
  const inspected = await mapConcurrent(candidates, 64, async (entry) => {
    const reference = referenceByPath?.get(entry.path);
    const referenceChanged =
      referenceByPath !== null &&
      reference !== undefined &&
      (reference.blobHash !== entry.blobHash ||
        reference.blobSize !== entry.blobSize ||
        reference.contentHash !== entry.contentHash ||
        reference.contentSize !== entry.contentSize ||
        reference.cryptKeyIdHash !== entry.cryptKeyIdHash ||
        reference.isCrypted !== entry.isCrypted);
    if (referenceByPath !== null && !referenceChanged) {
      return null;
    }
    const sourcePath = path.join(
      args["decrypted-root"],
      ...entry.path.split("/"),
    );
    const actualSize = await fileSize(sourcePath);
    if (referenceChanged || actualSize !== entry.contentSize) {
      return { ...entry, actualSize, referenceChanged };
    }
    return null;
  });
  const corrupt = inspected.filter(Boolean);
  if (corrupt.length === 0) {
    throw new Error("No repair obligations matched the requested inputs");
  }

  const mainKey = catalog.find(
    (entry) => entry.addressHash.toLowerCase() === MAIN_KEY_ADDRESS_HASH,
  );
  if (!mainKey) {
    throw new Error("Official main-key entry is absent from the catalog");
  }

  await mkdir(args["output-root"], { recursive: true });
  const blobEntries = [...corrupt, mainKey].filter(
    (entry, index, entries) =>
      entries.findIndex((other) => other.blobHash === entry.blobHash) === index,
  );
  const blobs = [];
  for (const [index, entry] of blobEntries.entries()) {
    blobs.push(await downloadBlob(entry, args["output-root"]));
    console.log(
      `Fetched ${index + 1}/${blobEntries.length}: ${entry.blobHash} (${entry.blobSize} bytes)`,
    );
  }

  const index = await preserveIndex(args.index, args["output-root"]);
  const manifest = {
    schemaVersion: 1,
    source: {
      catalogSha256: sha256(catalogBytes),
      referenceCatalogSha256: referenceCatalogBytes
        ? sha256(referenceCatalogBytes)
        : null,
      index,
    },
    selection: {
      filter: args.filter,
      candidateCount: candidates.length,
      repairCount: corrupt.length,
    },
    assets: corrupt.map((entry) => ({
      path: entry.path,
      addressHash: entry.addressHash,
      contentHash: entry.contentHash,
      contentSize: entry.contentSize,
      actualSize: entry.actualSize,
      referenceChanged: entry.referenceChanged ?? false,
      blobHash: entry.blobHash,
      blobSize: entry.blobSize,
      cryptKeyIdHash: entry.cryptKeyIdHash,
      isCrypted: entry.isCrypted,
    })),
    blobs,
  };
  const manifestPath = path.join(args["output-root"], "repair-manifest.json");
  await atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Repair manifest: ${manifestPath}`);
  console.log(`Repair assets: ${corrupt.length}; blobs: ${blobs.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
