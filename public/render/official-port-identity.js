export const OFFICIAL_PORT_IDENTITY_FIELDS = Object.freeze([
  "selectorId",
  "candidateWitnessId",
  "subshader",
  "pass",
]);

function isPortIdentity(value) {
  return value
    && typeof value.selectorId === "string"
    && value.selectorId.length > 0
    && typeof value.candidateWitnessId === "string"
    && value.candidateWitnessId.length > 0
    && Number.isInteger(value.subshader)
    && value.subshader >= 0
    && Number.isInteger(value.pass)
    && value.pass >= 0;
}

export function officialPortIdentityKey(value) {
  if (!isPortIdentity(value)) return null;
  return JSON.stringify(OFFICIAL_PORT_IDENTITY_FIELDS.map((field) => value[field]));
}

export function sameOfficialPortIdentity(left, right) {
  const leftKey = officialPortIdentityKey(left);
  return leftKey !== null && leftKey === officialPortIdentityKey(right);
}

export function orderOfficialPasses(values, selectorOf = (value) => value) {
  if (!Array.isArray(values)) throw new TypeError("official pass collection must be an array");
  if (values.length <= 1) return [...values];

  const rows = values.map((value, index) => {
    const selector = selectorOf(value);
    const key = officialPortIdentityKey(selector);
    if (!key) throw new Error(`official pass ${index} has an incomplete composite identity`);
    return { value, selector, key };
  });
  const first = rows[0].selector;
  const keywords = JSON.stringify([...(first.keywords || [])].sort());
  for (const { selector } of rows) {
    if (selector.selectionMode !== "ordered-multipass-structure"
        || selector.selectorId !== first.selectorId
        || selector.shaderIdentity !== first.shaderIdentity
        || selector.subshader !== first.subshader
        || JSON.stringify([...(selector.keywords || [])].sort()) !== keywords) {
      throw new Error("official multipass collection does not describe one ordered selector route");
    }
  }
  if (new Set(rows.map((row) => row.key)).size !== rows.length) {
    throw new Error("official multipass collection contains a duplicate composite identity");
  }

  rows.sort((left, right) => left.selector.pass - right.selector.pass);
  rows.forEach(({ selector }, index) => {
    if (selector.pass !== index) {
      throw new Error(`official multipass sequence is not contiguous at pass ${index}`);
    }
  });
  return rows.map((row) => row.value);
}
