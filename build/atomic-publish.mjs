import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const RETRYABLE_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800, 1600];
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_TIMEOUT_MS = 30_000;
const INVALID_LOCK_STALE_MS = 30_000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const activeLocks = new Set();

function existsSync(filename) {
  try {
    fs.lstatSync(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function exists(filename) {
  try {
    await fs.promises.lstat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function siblingPath(destination, purpose) {
  const parent = path.dirname(destination);
  const base = path.basename(destination);
  return path.join(parent, `.${base}.${purpose}-${process.pid}-${randomUUID()}`);
}

function lockPath(destination) {
  const parent = path.dirname(destination);
  const base = path.basename(destination);
  return path.join(parent, `.${base}.publish-lock`);
}

function assertSibling(source, destination) {
  if (path.resolve(path.dirname(source)) !== path.resolve(path.dirname(destination))) {
    throw new Error("staging and destination must be siblings on the same filesystem");
  }
}

function renameSyncWithRetry(source, destination) {
  let lastError;
  for (const delay of [0, ...RENAME_RETRY_DELAYS_MS]) {
    if (delay) Atomics.wait(sleepBuffer, 0, 0, delay);
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RENAME_ERRORS.has(error?.code)) throw error;
    }
  }
  throw lastError;
}

function removeFileSyncWithRetry(filename) {
  let lastError;
  for (const delay of [0, ...RENAME_RETRY_DELAYS_MS]) {
    if (delay) Atomics.wait(sleepBuffer, 0, 0, delay);
    try {
      fs.rmSync(filename, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RENAME_ERRORS.has(error?.code)) throw error;
    }
  }
  throw lastError;
}

async function removeFileWithRetry(filename) {
  let lastError;
  for (const delay of [0, ...RENAME_RETRY_DELAYS_MS]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fs.promises.rm(filename, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RENAME_ERRORS.has(error?.code)) throw error;
    }
  }
  throw lastError;
}

async function renameWithRetry(source, destination) {
  let lastError;
  for (const delay of [0, ...RENAME_RETRY_DELAYS_MS]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_RENAME_ERRORS.has(error?.code)) throw error;
    }
  }
  throw lastError;
}

function publishError(operation, destination, primary, rollback) {
  const errors = [primary];
  if (rollback) errors.push(rollback);
  return new AggregateError(
    errors,
    `${operation} failed for ${destination}; the previous destination was ${
      rollback ? "not restored" : "restored or left unchanged"
    }`,
  );
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function lockOwner(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    return null;
  }
}

function acquirePublishLockSync(destination) {
  const filename = lockPath(destination);
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    let descriptor;
    try {
      descriptor = fs.openSync(filename, "wx");
      fs.writeFileSync(descriptor, `${JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      })}\n`);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      activeLocks.add(filename);
      return () => {
        activeLocks.delete(filename);
        const owner = lockOwner(filename);
        if (owner?.token !== token) return;
        try {
          removeFileSyncWithRetry(filename);
        } catch {
          // A released lock from this process is recognized as stale next time.
        }
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {}
      }
      if (error?.code !== "EEXIST") throw error;
    }

    const owner = lockOwner(filename);
    const invalidAge = (() => {
      try {
        return Date.now() - fs.statSync(filename).mtimeMs;
      } catch {
        return 0;
      }
    })();
    const stale = owner
      ? (owner.pid === process.pid && !activeLocks.has(filename))
        || !processIsAlive(owner.pid)
      : invalidAge >= INVALID_LOCK_STALE_MS;
    if (stale) {
      try {
        removeFileSyncWithRetry(filename);
        continue;
      } catch {}
    }
    if (Date.now() - started >= LOCK_TIMEOUT_MS) {
      const error = new Error(`timed out waiting for publish lock: ${destination}`);
      error.code = "EBUSY";
      throw error;
    }
    Atomics.wait(sleepBuffer, 0, 0, LOCK_RETRY_DELAY_MS);
  }
}

async function acquirePublishLock(destination) {
  const filename = lockPath(destination);
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    let handle;
    try {
      handle = await fs.promises.open(filename, "wx");
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      })}\n`);
      await handle.sync();
      await handle.close();
      handle = undefined;
      activeLocks.add(filename);
      return async () => {
        activeLocks.delete(filename);
        const owner = lockOwner(filename);
        if (owner?.token !== token) return;
        await removeFileWithRetry(filename).catch(() => {});
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
    }

    const owner = lockOwner(filename);
    const invalidAge = await fs.promises.stat(filename)
      .then((stat) => Date.now() - stat.mtimeMs)
      .catch(() => 0);
    const stale = owner
      ? (owner.pid === process.pid && !activeLocks.has(filename))
        || !processIsAlive(owner.pid)
      : invalidAge >= INVALID_LOCK_STALE_MS;
    if (stale) {
      try {
        await removeFileWithRetry(filename);
        continue;
      } catch {}
    }
    if (Date.now() - started >= LOCK_TIMEOUT_MS) {
      const error = new Error(`timed out waiting for publish lock: ${destination}`);
      error.code = "EBUSY";
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  }
}

export async function withFileLock(destination, callback) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const release = await acquirePublishLock(destination);
  try {
    return await callback();
  } finally {
    await release();
  }
}

function siblingArtifacts(destination, purpose) {
  const parent = path.dirname(destination);
  const prefix = `.${path.basename(destination)}.${purpose}-`;
  return fs.readdirSync(parent)
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(parent, name));
}

function removeDirectoryBestEffort(directory) {
  try {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: RENAME_RETRY_DELAYS_MS.length,
      retryDelay: RENAME_RETRY_DELAYS_MS[0],
    });
  } catch {
    // The committed destination remains authoritative. A later publish retries cleanup.
  }
}

function recoverDirectoryPublishSync(destination) {
  const backups = siblingArtifacts(destination, "previous");
  if (existsSync(destination)) {
    for (const backup of backups) removeDirectoryBestEffort(backup);
    return;
  }
  if (backups.length === 0) return;
  if (backups.length !== 1) {
    throw new Error(
      `cannot recover ${destination}: found ${backups.length} previous directories`,
    );
  }
  renameSyncWithRetry(backups[0], destination);
}

export function createStagingDirectorySync(destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = siblingPath(destination, "staging");
  fs.mkdirSync(staging);
  return staging;
}

export function publishDirectorySync(staging, destination) {
  const stagingStat = fs.statSync(staging);
  if (!stagingStat.isDirectory()) throw new Error(`staging path is not a directory: ${staging}`);
  assertSibling(staging, destination);
  const release = acquirePublishLockSync(destination);
  try {
    recoverDirectoryPublishSync(destination);
    if (!existsSync(destination)) {
      renameSyncWithRetry(staging, destination);
      return;
    }

    const backup = siblingPath(destination, "previous");
    try {
      renameSyncWithRetry(destination, backup);
    } catch (backupError) {
      throw publishError("directory backup", destination, backupError);
    }
    try {
      renameSyncWithRetry(staging, destination);
    } catch (installError) {
      let rollbackError;
      try {
        renameSyncWithRetry(backup, destination);
      } catch (error) {
        rollbackError = error;
      }
      throw publishError("directory install", destination, installError, rollbackError);
    }
    removeDirectoryBestEffort(backup);
  } finally {
    release();
  }
}

export function replaceFileSync(staging, destination) {
  const stagingStat = fs.statSync(staging);
  if (!stagingStat.isFile()) throw new Error(`staging path is not a file: ${staging}`);
  assertSibling(staging, destination);
  let previousMode;
  if (process.platform === "win32" && existsSync(destination)) {
    previousMode = fs.statSync(destination).mode;
    if ((previousMode & 0o200) === 0) fs.chmodSync(destination, previousMode | 0o200);
  }
  try {
    renameSyncWithRetry(staging, destination);
  } catch (error) {
    if (previousMode !== undefined && existsSync(destination)) {
      try {
        fs.chmodSync(destination, previousMode);
      } catch {}
    }
    throw error;
  }
}

export async function replaceFile(staging, destination) {
  const stagingStat = await fs.promises.stat(staging);
  if (!stagingStat.isFile()) throw new Error(`staging path is not a file: ${staging}`);
  assertSibling(staging, destination);
  let previousMode;
  if (process.platform === "win32" && await exists(destination)) {
    previousMode = (await fs.promises.stat(destination)).mode;
    if ((previousMode & 0o200) === 0) {
      await fs.promises.chmod(destination, previousMode | 0o200);
    }
  }
  try {
    await renameWithRetry(staging, destination);
  } catch (error) {
    if (previousMode !== undefined && await exists(destination)) {
      await fs.promises.chmod(destination, previousMode).catch(() => {});
    }
    throw error;
  }
}

export function atomicWriteFileSync(destination, data, options) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = siblingPath(destination, "staging");
  let descriptor;
  try {
    descriptor = fs.openSync(staging, "wx", options?.mode);
    fs.writeFileSync(descriptor, data, options);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    replaceFileSync(staging, destination);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    try {
      removeFileSyncWithRetry(staging);
    } catch {}
    throw error;
  }
}

export function atomicCopyFileSync(source, destination, options = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = siblingPath(destination, "staging");
  try {
    fs.copyFileSync(source, staging, options.copyMode);
    if (options.validate) options.validate(staging);
    const descriptor = fs.openSync(staging, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    replaceFileSync(staging, destination);
  } catch (error) {
    try {
      removeFileSyncWithRetry(staging);
    } catch {}
    throw error;
  }
}

export function atomicLinkFileSync(source, destination, options = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = siblingPath(destination, "staging");
  try {
    try {
      fs.linkSync(source, staging);
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error?.code)) throw error;
      fs.copyFileSync(source, staging, options.copyMode);
      const descriptor = fs.openSync(staging, "r+");
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    if (options.validate) options.validate(staging);
    replaceFileSync(staging, destination);
  } catch (error) {
    try {
      removeFileSyncWithRetry(staging);
    } catch {}
    throw error;
  }
}

export async function atomicWriteFile(destination, data, options) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const staging = siblingPath(destination, "staging");
  let handle;
  try {
    handle = await fs.promises.open(staging, "wx", options?.mode);
    await handle.writeFile(data, options);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await replaceFile(staging, destination);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(staging, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readOrCreateFile(destination, createData, options = {}) {
  const validate = options.validate || (() => {});
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await fs.promises.readFile(destination);
    validate(existing);
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const created = typeof createData === "function" ? createData() : createData;
  validate(created);
  const staging = siblingPath(destination, "staging");
  let handle;
  try {
    handle = await fs.promises.open(staging, "wx", options.mode);
    await handle.writeFile(created);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await fs.promises.link(staging, destination);
      return created;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const winner = await fs.promises.readFile(destination);
    validate(winner);
    return winner;
  } catch (error) {
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    await removeFileWithRetry(staging).catch(() => {});
  }
}
