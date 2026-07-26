export function assertNoUnicodeReplacement(value, label = "contract") {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const index = serialized.indexOf("\uFFFD");
  if (index !== -1) {
    throw new Error(`${label} contains U+FFFD at UTF-16 offset ${index}`);
  }
}
