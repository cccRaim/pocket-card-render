import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readOfficialTextureSampler({ scenes = [], decryptedRoot } = {}) {
  const python = process.env.PYTHON || "python";
  const args = ["build/extract_official_texture_sampler.py"];
  if (decryptedRoot) args.push("--decrypted-root", decryptedRoot);
  for (const scene of scenes) args.push("--scene", scene);

  const result = spawnSync(python, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown extraction failure").trim();
    throw new Error(`official texture sampler extraction failed: ${detail}`);
  }
  return JSON.parse(result.stdout);
}
