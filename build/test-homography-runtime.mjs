// No-render runtime proof for the official Float32 Homography producer.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  calcHomographyMatrix,
  calcInverseMatrix,
} from "../public/render/pipeline/official-homography.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const OFFICIAL_METHODS = {
  calcHomography: {
    name: "HomographyShapeCorrector.CalcHomographyMatrix",
    rvaStart: "0x43987ec",
    rvaEndExclusive: "0x439899c",
    byteSize: 432,
    sha256: "fc1463b7d34a6bd728470522b9c369dd9125dd9c1fe0f7e4885f4422482c55e0",
  },
  calcInverse: {
    name: "HomographyShapeCorrector.CalcInverseMatrix",
    rvaStart: "0x4398aac",
    rvaEndExclusive: "0x4398c90",
    byteSize: 484,
    sha256: "d88715856fd608cf6c9c1a756851288f592e6bd453cb6d3cb9213d9b6614daa0",
  },
};

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function extractOfficialEvidence() {
  const args = ["build/extract_official_homography_program.py"];
  if (process.env.PCR_SHADERS) args.push("--shaders", process.env.PCR_SHADERS);
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  const run = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "official Homography extractor failed").trim());
  }
  return JSON.parse(run.stdout.replace(/^\uFEFF/, ""));
}

function assertOfficialMethodEvidence(evidence) {
  for (const [key, expected] of Object.entries(OFFICIAL_METHODS)) {
    const method = evidence.apkm.methods[key];
    assert.ok(method, `${key} extractor evidence is missing`);
    assert.deepEqual({
      name: method.name,
      rvaStart: method.rvaStart,
      rvaEndExclusive: method.rvaEndExclusive,
      byteSize: method.byteSize,
      sha256: method.sha256,
    }, expected);
    const body = Buffer.from(method.rawHex, "hex");
    assert.equal(body.length, expected.byteSize);
    assert.equal(sha256(body), expected.sha256);
  }
}

function floatBits(value) {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function matrixBits(matrix) {
  return Array.from(matrix, floatBits);
}

// These helpers intentionally use generic double-precision math and a loop,
// independently of the unrolled Float32 runtime expressions.
function mapPoint(matrix, point) {
  const x = point[0];
  const y = point[1];
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / w,
  ];
}

function multiply3x3(left, right) {
  const result = Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        result[row * 3 + column] += left[row * 3 + index] * right[index * 3 + column];
      }
    }
  }
  return result;
}

function assertClose(actual, expected, tolerance, label) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance * scale,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function assertCornerMapping(homography, inverse, points, tolerance) {
  const unit = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let index = 0; index < 4; index += 1) {
    const mapped = mapPoint(homography, unit[index]);
    assertClose(mapped[0], points[index][0], tolerance, `P${index}.x forward`);
    assertClose(mapped[1], points[index][1], tolerance, `P${index}.y forward`);
    const restored = mapPoint(inverse, points[index]);
    assertClose(restored[0], unit[index][0], tolerance, `P${index}.x inverse`);
    assertClose(restored[1], unit[index][1], tolerance, `P${index}.y inverse`);
  }
}

function assertProjectiveInverse(homography, inverse, tolerance) {
  const product = multiply3x3(Array.from(homography), Array.from(inverse));
  const scale = product[8];
  assert.ok(Number.isFinite(scale) && scale !== 0, `inverse product scale is ${scale}`);
  for (let index = 0; index < 9; index += 1) {
    const expected = index === 0 || index === 4 || index === 8 ? 1 : 0;
    assertClose(product[index] / scale, expected, tolerance, `normalized H*Hinv[${index}]`);
  }
}

assertOfficialMethodEvidence(extractOfficialEvidence());

const identityPoints = [[0, 0], [1, 0], [0, 1], [1, 1]];
const identity = calcHomographyMatrix(identityPoints);
const identityInverse = calcInverseMatrix(identity);
assert.deepEqual(matrixBits(identity), [
  "3f800000", "00000000", "00000000",
  "00000000", "3f800000", "00000000",
  "80000000", "80000000", "3f800000",
]);
assert.deepEqual(matrixBits(identityInverse), [
  "3f800000", "80000000", "00000000",
  "80000000", "3f800000", "00000000",
  "00000000", "00000000", "3f800000",
]);
assertCornerMapping(identity, identityInverse, identityPoints, 0);
assertProjectiveInverse(identity, identityInverse, 0);

const convexPoints = [[0.12, 0.18], [0.86, 0.11], [0.19, 0.89], [0.91, 0.78]];
const convex = calcHomographyMatrix(...convexPoints);
const convexInverse = calcInverseMatrix(convex);
assert.deepEqual(matrixBits(convex), [
  "3f4b6daf", "3d9873b3", "3df5c28f",
  "bd810bd7", "3f3b1565", "3e3851ec",
  "3d822006", "3cbf68d3", "3f800000",
]);
assert.deepEqual(matrixBits(convexInverse), [
  "3ed6b746", "bd295a79", "bd2fa4c7",
  "3d30005a", "3ee892c0", "bdb20349",
  "bce28161", "bc02da29", "3eacfeff",
]);
assertCornerMapping(convex, convexInverse, convexPoints, 2e-6);
assertProjectiveInverse(convex, convexInverse, 2e-6);

const degeneratePoints = [[0, 0], [1, 0], [0, 0], [1, 0]];
const degenerate = calcHomographyMatrix(degeneratePoints);
assert.deepEqual(
  Array.from(degenerate, (value) => Number.isNaN(value)),
  [true, true, false, true, true, false, true, true, false],
);
assert.deepEqual([degenerate[2], degenerate[5], degenerate[8]], [0, 0, 1]);
const degenerateInverse = calcInverseMatrix(degenerate);
assert.ok(Array.from(degenerateInverse).every(Number.isNaN));

const singularInverse = calcInverseMatrix([1, 0, 0, 0, 0, 0, 0, 0, 1]);
assert.ok(Array.from(singularInverse).every((value) => value === 0));
assert.ok(matrixBits(singularInverse).every((bits) => bits === "00000000"));

const nearDegeneratePoints = [
  [0, 0],
  [1, 0],
  [0, 1],
  [0.5, Math.fround(0.5 + 2 ** -23)],
];
const nearDegenerate = calcHomographyMatrix(nearDegeneratePoints);
const nearDegenerateInverse = calcInverseMatrix(nearDegenerate);
assert.ok(Array.from(nearDegenerate).every(Number.isFinite));
assert.ok(Array.from(nearDegenerateInverse).every(Number.isFinite));
assert.deepEqual(matrixBits(nearDegenerate), [
  "4a800000", "00000000", "00000000",
  "00000000", "4a800002", "00000000",
  "4a7ffffc", "4a800000", "3f800000",
]);
assert.deepEqual(matrixBits(nearDegenerateInverse), [
  "60800004", "00000000", "00000000",
  "00000000", "60800002", "00000000",
  "eb800002", "eb800002", "6b800004",
]);
assertCornerMapping(nearDegenerate, nearDegenerateInverse, nearDegeneratePoints, 3e-6);
assertProjectiveInverse(nearDegenerate, nearDegenerateInverse, 3e-6);

console.log("Official Homography runtime OK");
console.log("methods: CalcHomographyMatrix 0x43987ec + CalcInverseMatrix 0x4398aac hashes pinned");
console.log("cases: identity, convex quadrilateral, degenerate, near-degenerate; no renderer or screenshots");
