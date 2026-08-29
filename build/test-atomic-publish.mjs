#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import {
  atomicCopyFileSync,
  atomicLinkFileSync,
  atomicWriteFile,
  atomicWriteFileSync,
  createStagingDirectorySync,
  publishDirectorySync,
  readOrCreateFile,
  replaceFile,
  replaceFileSync,
  withFileLock,
} from "./atomic-publish.mjs";

function withTemporaryDirectory(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-atomic-publish-"));
  return Promise.resolve(callback(root)).finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function protectedAcl(filename) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Acl -LiteralPath $env:PCR_ATOMIC_TEST_PATH).AreAccessRulesProtected",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PCR_ATOMIC_TEST_PATH: filename },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim().toLowerCase() === "true";
}

test("atomicWriteFile replaces content and leaves no staging path", () => withTemporaryDirectory(
  async (root) => {
    const destination = path.join(root, "evidence.json");
    fs.writeFileSync(destination, "old");
    await atomicWriteFile(destination, "new");
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root), ["evidence.json"]);
  },
));

test("atomicWriteFileSync replaces content and leaves no staging path", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "evidence.json");
    fs.writeFileSync(destination, "old");
    atomicWriteFileSync(destination, "new");
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root), ["evidence.json"]);
  })
));

test("atomicCopyFileSync validates the staged copy before replacement", () => (
  withTemporaryDirectory((root) => {
    const source = path.join(root, "source.bin");
    const destination = path.join(root, "evidence.bin");
    fs.writeFileSync(source, "new");
    fs.writeFileSync(destination, "old");
    atomicCopyFileSync(source, destination, {
      validate(staging) {
        assert.equal(fs.readFileSync(staging, "utf8"), "new");
      },
    });
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root).sort(), ["evidence.bin", "source.bin"]);
  })
));

test("atomicLinkFileSync publishes a complete hard link or validated copy", () => (
  withTemporaryDirectory((root) => {
    const source = path.join(root, "source.bin");
    const destination = path.join(root, "evidence.bin");
    fs.writeFileSync(source, "new");
    fs.writeFileSync(destination, "old");
    atomicLinkFileSync(source, destination, {
      validate(staging) {
        assert.equal(fs.readFileSync(staging, "utf8"), "new");
      },
    });
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root).sort(), ["evidence.bin", "source.bin"]);
  })
));

test("replaceFile requires a valid sibling before touching the destination", () => withTemporaryDirectory(
  async (root) => {
    const destination = path.join(root, "evidence.json");
    fs.writeFileSync(destination, "old");
    await assert.rejects(
      replaceFile(path.join(root, "missing.json"), destination),
      /ENOENT/,
    );
    assert.equal(fs.readFileSync(destination, "utf8"), "old");
  },
));

test("replaceFileSync retries transient Windows-style rename failures", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "evidence.json");
    const staging = path.join(root, "staging.json");
    fs.writeFileSync(destination, "old");
    fs.writeFileSync(staging, "new");
    const originalRename = fs.renameSync;
    let failures = 2;
    fs.renameSync = (source, target) => {
      if (source === staging && target === destination && failures > 0) {
        failures -= 1;
        const error = new Error("synthetic scanner lock");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(source, target);
    };
    try {
      replaceFileSync(staging, destination);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(failures, 0);
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root), ["evidence.json"]);
  })
));

test("atomicWriteFile waits through a slow transient scanner lock", () => (
  withTemporaryDirectory(async (root) => {
    const destination = path.join(root, "evidence.json");
    fs.writeFileSync(destination, "old");
    const promises = fs.promises;
    const originalRename = promises.rename;
    const unlockAt = Date.now() + 1_000;
    promises.rename = async (source, target) => {
      if (target === destination && Date.now() < unlockAt) {
        const error = new Error("synthetic slow scanner lock");
        error.code = "EACCES";
        throw error;
      }
      return originalRename(source, target);
    };
    try {
      await atomicWriteFile(destination, "new");
    } finally {
      promises.rename = originalRename;
    }
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root), ["evidence.json"]);
  })
));

test("replaceFile rejects a staging file outside the destination directory", () => (
  withTemporaryDirectory(async (root) => {
    const sourceDirectory = path.join(root, "source");
    const destinationDirectory = path.join(root, "destination");
    fs.mkdirSync(sourceDirectory);
    fs.mkdirSync(destinationDirectory);
    const staging = path.join(sourceDirectory, "staging.json");
    const destination = path.join(destinationDirectory, "evidence.json");
    fs.writeFileSync(staging, "new");
    fs.writeFileSync(destination, "old");
    await assert.rejects(
      replaceFile(staging, destination),
      /must be siblings/,
    );
    assert.equal(fs.readFileSync(staging, "utf8"), "new");
    assert.equal(fs.readFileSync(destination, "utf8"), "old");
  })
));

test("readOrCreateFile resolves concurrent creators to one durable value", () => (
  withTemporaryDirectory(async (root) => {
    const destination = path.join(root, "provenance.key");
    let sequence = 0;
    const validate = (value) => assert.equal(value.length, 32);
    const values = await Promise.all(Array.from({ length: 32 }, () => (
      readOrCreateFile(
        destination,
        () => Buffer.alloc(32, sequence += 1),
        { mode: 0o600, validate },
      )
    )));
    const stored = fs.readFileSync(destination);
    for (const value of values) assert.deepEqual(value, stored);
  })
));

test("readOrCreateFile rejects invalid existing content without replacing it", () => (
  withTemporaryDirectory(async (root) => {
    const destination = path.join(root, "provenance.key");
    fs.writeFileSync(destination, "invalid");
    await assert.rejects(
      readOrCreateFile(destination, Buffer.alloc(32), {
        validate: (value) => assert.equal(value.length, 32),
      }),
    );
    assert.equal(fs.readFileSync(destination, "utf8"), "invalid");
  })
));

test("publishDirectorySync swaps a complete tree and removes the previous tree", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "deployment");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "old.txt"), "old");
    const staging = createStagingDirectorySync(destination);
    fs.writeFileSync(path.join(staging, "new.txt"), "new");

    publishDirectorySync(staging, destination);

    assert.equal(fs.readFileSync(path.join(destination, "new.txt"), "utf8"), "new");
    assert.equal(fs.existsSync(path.join(destination, "old.txt")), false);
    assert.deepEqual(fs.readdirSync(root), ["deployment"]);
  })
));

test("publishDirectorySync restores the previous tree when installation fails", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "deployment");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "old.txt"), "old");
    const staging = createStagingDirectorySync(destination);
    fs.writeFileSync(path.join(staging, "new.txt"), "new");
    const originalRename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (source === staging && target === destination) {
        const error = new Error("synthetic locked staging directory");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(source, target);
    };
    try {
      assert.throws(
        () => publishDirectorySync(staging, destination),
        /directory install failed/,
      );
    } finally {
      fs.renameSync = originalRename;
    }

    assert.equal(fs.readFileSync(path.join(destination, "old.txt"), "utf8"), "old");
    assert.equal(fs.readFileSync(path.join(staging, "new.txt"), "utf8"), "new");
    assert.deepEqual(
      fs.readdirSync(root).sort(),
      [path.basename(staging), "deployment"].sort(),
    );
  })
));

test("publishDirectorySync recovers a previous tree left by a crashed publisher", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "deployment");
    const previous = path.join(root, ".deployment.previous-123-crashed");
    fs.mkdirSync(previous);
    fs.writeFileSync(path.join(previous, "old.txt"), "old");
    const staging = createStagingDirectorySync(destination);
    fs.writeFileSync(path.join(staging, "new.txt"), "new");

    publishDirectorySync(staging, destination);

    assert.equal(fs.readFileSync(path.join(destination, "new.txt"), "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root), ["deployment"]);
  })
));

test("committed directory publication is not failed by delayed backup cleanup", () => (
  withTemporaryDirectory((root) => {
    const destination = path.join(root, "deployment");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "old.txt"), "old");
    const staging = createStagingDirectorySync(destination);
    fs.writeFileSync(path.join(staging, "new.txt"), "new");
    const originalRm = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith(".deployment.previous-")) {
        const error = new Error("synthetic backup scanner lock");
        error.code = "EPERM";
        throw error;
      }
      return originalRm(target, options);
    };
    try {
      publishDirectorySync(staging, destination);
    } finally {
      fs.rmSync = originalRm;
    }
    assert.equal(fs.readFileSync(path.join(destination, "new.txt"), "utf8"), "new");
    assert.equal(
      fs.readdirSync(root).filter((name) => name.startsWith(".deployment.previous-")).length,
      1,
    );

    const next = createStagingDirectorySync(destination);
    fs.writeFileSync(path.join(next, "newer.txt"), "newer");
    publishDirectorySync(next, destination);
    assert.equal(fs.readFileSync(path.join(destination, "newer.txt"), "utf8"), "newer");
    assert.deepEqual(fs.readdirSync(root), ["deployment"]);
  })
));

test("withFileLock serializes read-modify-write across Node processes", () => (
  withTemporaryDirectory(async (root) => {
    const destination = path.join(root, "counter.json");
    fs.writeFileSync(destination, "{\"value\":0}\n");
    const helper = new URL("./atomic-publish.mjs", import.meta.url).href;
    const worker = [
      "import fs from 'node:fs';",
      "const { atomicWriteFile, withFileLock } = await import(process.env.PCR_HELPER_URL);",
      "await withFileLock(process.env.PCR_DESTINATION, async () => {",
      "  const value = JSON.parse(fs.readFileSync(process.env.PCR_DESTINATION, 'utf8'));",
      "  await new Promise((resolve) => setTimeout(resolve, 25));",
      "  await atomicWriteFile(",
      "    process.env.PCR_DESTINATION,",
      "    `${JSON.stringify({ value: value.value + 1 })}\\n`,",
      "  );",
      "});",
    ].join("\n");
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", worker],
        {
          windowsHide: true,
          env: {
            ...process.env,
            PCR_DESTINATION: destination,
            PCR_HELPER_URL: helper,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `worker exited ${code}`));
      });
    });
    await Promise.all(Array.from({ length: 8 }, run));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(destination, "utf8")),
      { value: 8 },
    );
    assert.deepEqual(fs.readdirSync(root), ["counter.json"]);
  })
));

test("directory replacement does not propagate a protected ACL", {
  skip: process.platform !== "win32",
}, () => withTemporaryDirectory((root) => {
  const destination = path.join(root, "deployment");
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, "old.txt"), "old");
  const acl = spawnSync(
    "icacls",
    [destination, "/inheritance:d"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(acl.status, 0, acl.stderr || acl.stdout);
  assert.equal(protectedAcl(destination), true);
  const staging = createStagingDirectorySync(destination);
  fs.writeFileSync(path.join(staging, "new.txt"), "new");

  publishDirectorySync(staging, destination);

  assert.equal(fs.readFileSync(path.join(destination, "new.txt"), "utf8"), "new");
  assert.equal(protectedAcl(destination), false);
}));

test("replacement does not propagate a protected ACL from the previous file", {
  skip: process.platform !== "win32",
}, () => withTemporaryDirectory(async (root) => {
  const destination = path.join(root, "evidence.json");
  fs.writeFileSync(destination, "old");
  const acl = spawnSync(
    "icacls",
    [destination, "/inheritance:d"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(acl.status, 0, acl.stderr || acl.stdout);
  assert.equal(protectedAcl(destination), true);

  await atomicWriteFile(destination, "new");

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.equal(protectedAcl(destination), false);
}));

test("sync replacement does not propagate a protected ACL from the previous file", {
  skip: process.platform !== "win32",
}, () => withTemporaryDirectory((root) => {
  const destination = path.join(root, "evidence.json");
  fs.writeFileSync(destination, "old");
  const acl = spawnSync(
    "icacls",
    [destination, "/inheritance:d"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(acl.status, 0, acl.stderr || acl.stdout);
  assert.equal(protectedAcl(destination), true);

  atomicWriteFileSync(destination, "new");

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.equal(protectedAcl(destination), false);
}));

test("replacement resets a read-only target to the staged file metadata", {
  skip: process.platform !== "win32",
}, () => withTemporaryDirectory((root) => {
  const destination = path.join(root, "evidence.json");
  fs.writeFileSync(destination, "old");
  fs.chmodSync(destination, 0o444);

  atomicWriteFileSync(destination, "new", { mode: 0o600 });

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.notEqual(fs.statSync(destination).mode & 0o200, 0);
}));
