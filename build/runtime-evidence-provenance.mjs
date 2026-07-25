import crypto from "node:crypto";

export const FULL_RUNTIME_PROVENANCE_PROTOCOL = "full-runtime-session-v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function inventoryRoot(sourceHashes, accept = () => true) {
  const entries = Object.entries(sourceHashes || {})
    .filter(([file, hash]) => accept(file) && /^[0-9a-f]{64}$/.test(hash))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, sha256]) => ({ file, sha256 }));
  return sha256Text(canonical(entries));
}

export function sourceSetRoot(sourceHashes) {
  return inventoryRoot(sourceHashes);
}

export function manifestSetRoot(sourceHashes) {
  return inventoryRoot(sourceHashes, (file) => /^public\/shaders\/.*\.json$/.test(file));
}

export function runtimeArtifactSigningPayload(artifact) {
  const clone = structuredClone(artifact);
  if (clone.attestation && typeof clone.attestation === "object") {
    delete clone.attestation.hmacSha256;
  }
  return canonical(clone);
}

export function signRuntimeArtifact(artifact, key) {
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key);
  return crypto.createHmac("sha256", keyBuffer)
    .update(runtimeArtifactSigningPayload(artifact))
    .digest("hex");
}

export function verifyRuntimeArtifact(artifact, key) {
  const actual = artifact?.attestation?.hmacSha256;
  if (!/^[0-9a-f]{64}$/.test(actual || "")) return false;
  const expected = signRuntimeArtifact(artifact, key);
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
