import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readOfficialPlayerPipeline() {
  const python = process.env.PYTHON || "python";
  const result = spawnSync(python, ["build/extract_official_player_pipeline.py"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown extraction failure").trim();
    throw new Error(`official player pipeline extraction failed: ${detail}`);
  }
  return JSON.parse(result.stdout);
}
