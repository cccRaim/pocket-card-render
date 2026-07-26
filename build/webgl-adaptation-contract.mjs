import crypto from "node:crypto";

export const WEBGL_ADAPTATION_SCHEMA_V1 = "pocket-card-render/webgl-stage-adaptation@1";
export const WEBGL_ADAPTATION_SCHEMA_V2 = "pocket-card-render/webgl-stage-adaptation@2";
export const WEBGL_ADAPTATION_BACKEND = "Unity Vulkan SPIR-V to Three.js WebGL2";
export const LEGACY_CLAIM_SET_SHA256 = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

const HASH_RE = /^[0-9a-f]{64}$/;
const LEGACY_CLAIM_HASHES = new Set(`
015b8a235282233c2ca320b19d4ea8feef18a18afb3bfed6bf46fb6dd4475724
02788198373e2113a7909979682a8d9aa15c2c2d7e9b05fe8160f2fc0b486311
03b20fe07362098402e6b4a2a07579abc5b544ee058d71936eb7bd85a9f10760
085e6a4892a049fb14c6a71068316a986bc0712d535ea183ae5f898f9ff027c5
0cb64e4d4cc5f6d66060642327e89fec65f006ff23199ee1d7471c5dc0d49fb4
11599a917868a3d57fbdc89bd1ad82dae89413e819a0ff4c205dfa657b04aef9
2211065fb49f7601f994329a3c264275a1bb5e44c576ac9a0a6a2c82d0c811fe
23ef994aed42538cbe1c6e325a98b16ecd980e00defb23a8f3ae05b0b1a7b4ac
246a764f815fbba86a8dfeee18da9486d09c99329c6371680067caa6c767820e
317a499f169a06e95131b6c80aa8236043cdd22e4b6e6358aceb1cd4d497ab60
3cc10e16e2500ef10aa3bd4f42299ba1da02d793c573b76c14e929fd77034955
44a1e03cfc16e160b93d99200658da025cb4446f84fd21381c5d3251a69097cc
4609db60a7ab49ac20664d8f3047c1dcacc7954c8db04ca19745c2b513fc2092
4bdf44ea5bd838db8ddf4aa23a8122616b0476c8c63339a1170c05eb2537324a
4cb35a59fdd5d30db9e9817d1762687af3740e5564b763e2c7b13692a4976479
55074a38f0de0ab34646e3e2a72abd3313b4b23ac40861dff75b8df68d10a617
55c2710cacfda17c9dcd36cf621a049dbe94660f7e36e0484a7c42a56eff2388
5912d62796783aa334b3386fbf4d1b863b85e7305a1050f1635552a29573d5cc
596b2dd0ddd50b5ed80172795c4711a1be9388fc50139c92ca86e34466ffee1f
5ad7328d9ecf2c6aa38148a1bc720bcaad95dcdd44c938c4ade656666284873b
5bffddde6f24324a02d86e319fb3b2017066c27a931f790f031315cb045891b8
5eab10d6fee24249b55536caaf30160cd16e3ba31b3f55b5ceb61432c5361020
6033d5749981185365b0f9701cb07568115fabfa7e89674b553f91d253e121f0
62dd44f2870a7f60192d49681972f92144e5ec13b117b26127e5d1034cfc9b17
6456a4faf1847038692e4cce5f63df3a0f609691f5a5f2023d5ca7ac342996af
69bbc4669a31d84be510f60fb875643613927e590e062700a39b8ca82e28e806
6f80bfabd363dd79cba47ac9836d7908a22fdc792177bd7a98b0e6af6298f280
715d984d04251dc614e1981d98f2de34ab832ad1af6762c6b67246c04486214a
71d3971a9733b6ccf50f50be09b6391c0990dc9f372abbf93af34f6eb17e328f
730341828688662e3e6244c2fe33c67fb2b8900c57bd6c6565ea6f36be43a006
78328e7a9fd0febe92799a547987e8b5998317402010dd17bd0180b3542613d7
786c48ba5e29b1fbb681398ad034fbe7142242e89b0cb0f4688da545aab2456d
7876885c84f189cbaec7e9ccb9420628eafcca39914e09ca3143a708ff1af583
7c9987b90cfd4761a3ae09dfa28873d81ad7bee4c346075280751b26111aa267
7e7abc291d88f140dc0c1bd6d4165caf9e6587e5dafd40dc58502cb48422d53f
7f7a9015ca15545fa4ec184a82ba63c9faee92a599f2c5fb3c336823787b0975
827c7b3e3e64db1f7a2f28fb5bfac0f399f5ce344c6b4d37324b9d38210e32d3
836571016bc107ef2df0a21e433b3226f691f115231585fc5faebcfe44a8a3dc
8af69f50d1a5918e2cd0b59dc03898d186ef8e5abf1f2b68fc33645670f08c99
90ae1826f12daf21eb7bbd88042464ad954bd1a859a339d767b6b929535d20b6
9545a78dc7c624f3f57004dcb2c61a928a86466bda6fec04c91deababa7be8a9
9561cce1929980eea3cbbe465c2a2c0dc26b18607c3c09c2f8ac38c40f967afe
95c4248713776337cedfd5ce41c8cf65b1f1dd0f176aab40dd05fbcdaba3706b
981e7d3cc01fbf0db2016f68f5087e1d7c70f19e1c41f22c0d198f07aac0a145
9aae9bdf2ee70719cc538c8ef3f1f2f108a23b8896faa8dfe3265c7eba1b28a6
9b431a42180ab4e84755efe721bf02a20dfff50a172e8a9d6434a637df3857f5
9ff448f727e04a287cce444c6a690bf074e29cd2a88fff6d965f5a2272eb85de
a8d0b7ce69a633df0fe7186fbb2bb6a0291c299dd25073c3f9b42b6f6af81df5
abd61a2d9bf31a6f405de222736d16d4a1f9b15656adbdb95073fdae94396926
abe74f8d99c736bd96bd8a1f815bf4be3a1224f1354154cf690be7da4e9e5c7e
ae4a5c36b3e8dab2edae218bbd7fac6ade52afa2444e8b04b3ab16f6e0d491f1
b301a616aae3ca6037c68c3c6f06e7992f21af655ce2748771ceb6d3f6ac1236
b332e222488b7da4b8f01c2b29134fdf71cded9cf1041564a5b556d30d930e9c
bbbb590fad5e7dff851c2c92d04071d74aa0f210e1c4ffb0ddcfddf842f34e71
bcef2c5d3e42564fd22bd6e09bb72ada1dcc3977648551a03508c5a40f8c7a5a
c61442f2fe65f37fdd521fcb01624074d430341ad83aae617b1e82c6ab173dad
c930fa151b1db88e00f614ba15e2097f3d6b022c22ce5583bc7eb2759b1717bc
c9e1fcc36da8dbbd291319921fef0f158d3691efeff5477e9e7d43b1b26f33c2
ca267cf729b59a5c02e6e3b832ad5cca45a307e63aaeead3a854ca34ae1c8e6d
ceaec483526494b5206be55d970573a19cfafc767b4c8761de687eb96ba13450
dc5ac1ad501fd217002332c0c06b03d3d22818bb33d8b491b6e9780071392505
dffc70f21c2351dfede51c722e2db5c79708ccbc424bc6f8f16e85653ddce019
e36aa2e4e7f4158eab57bf57cd3f3cdf51f184402e6b9dfdd58336334b260c7e
e3da668595191e4ca4516dba48dddbb254d3e422833d7dbedaebf597ce39fbdb
e3e95f36175760c2b154cde0b6f6645fa65f6cadea8cacd48d558f5d00042cce
e53121f9848f0e33e776c163c160b6da147b8142834c9b26f77d829cd065638d
e5cbc31597b52a24c0c1a3e9a3148c38c85db2a0f6ba77b656f0f913b5a04c6a
e75809b234a312666764f6e5f79666c93552fb83668893c7aa7c69656155c4de
e923a4a9b4773765eac836ee6fd11fd95d2b45751caec238491598f40895495a
e9b8be4a053fa9006ed3447225e38293f6cecb933060fa0b8033494533d10328
ec5f74ebf494af30f16adac458438006e809ce78ad984d07a92b57b6c39ab632
f107de97e2dbfe4f305e2fc1b0557db76a9daf75adfa9b13d6f7c3cfcddd192c
f1f1ae948bc12b7daf844b7573f0a4703aa168793ff19ac17b22579360ebbb40
fdcb7cbf31ff3774b9f6c8706da9a14adc714aff71707da5713a24f2cc9e313b
`.trim().split(/\s+/));
const STAGES = ["vertex", "fragment"];
const OPERATION_SCHEMAS = {
  "vertex-input-binding": {
    stages: ["vertex"],
    fields: {
      contract: ["official-bind-channels-to-three-r165"],
      mappingSha256: "sha256",
    },
  },
  "engine-uniform-binding": {
    stages: STAGES,
    fields: {
      contract: ["unity-builtins-to-three-r165"],
      runtimeContractSha256: "sha256",
    },
  },
  "uniform-buffer-flattening": {
    stages: STAGES,
    fields: {
      source: ["serialized-common", "variant-local", "renderer-mpb", "mixed"],
      preservation: ["names-types-precision"],
      bindingContractSha256: "sha256",
    },
  },
  "renderer-property-block-binding": {
    stages: STAGES,
    fields: {
      contract: ["unity-material-property-block-to-three-uniforms"],
      producerContractSha256: "sha256",
    },
  },
  "texture-coordinate-basis-conversion": {
    stages: ["vertex"],
    fields: {
      contract: ["unity-texenv-to-three-gltf-uv"],
      textureCoordinateContractSha256: "sha256",
    },
  },
  "clip-space-y-conversion": {
    stages: ["vertex"],
    fields: {
      from: ["unity-vulkan"],
      to: ["webgl"],
      operation: ["remove-y-inversion"],
    },
  },
  "glsl-version-ownership": {
    stages: STAGES,
    fields: {
      owner: ["three-raw-shader-material"],
    },
  },
  "official-clock-binding": {
    stages: STAGES,
    fields: {
      contract: ["official-clock-to-unity-time"],
      clockContractSha256: "sha256",
    },
  },
  "dynamic-uniform-producer-binding": {
    stages: STAGES,
    fields: {
      contract: ["runtime-producer-to-three-uniforms"],
      producerContractSha256: "sha256",
    },
  },
  "object-basis-conversion": {
    stages: STAGES,
    fields: {
      contract: ["unity-to-three-basis"],
      basisContractSha256: "sha256",
    },
  },
  "view-depth-offset": {
    stages: ["vertex"],
    fields: {
      contract: ["linear-eye-depth-equivalent"],
    },
  },
  "material-default-binding": {
    stages: STAGES,
    fields: {
      contract: ["serialized-shader-property-default"],
    },
  },
  "bloom-attachment-route": {
    stages: ["fragment"],
    fields: {
      contract: ["official-emissive-mrt-to-attachment0"],
    },
  },
  "matrix-expression-fold": {
    stages: ["vertex"],
    fields: {
      contract: ["mvp-object-to-projection-model-view"],
    },
  },
};

function fail(message) {
  throw new Error(`webgl adaptation contract: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const GLSL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BASIS_FIELDS = new Set(["objectMatrices", "worldVectors", "viewForwards"]);
const TEXTURE_COORDINATE_FIELDS = new Set(["transforms", "tangentViewY"]);

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(`${label} has unknown field ${field}`);
  }
}

export function compileBasisConversionContract(raw) {
  if (!isRecord(raw)) fail("basis conversion contract must be an object");
  rejectUnknownFields(raw, BASIS_FIELDS, "basis conversion contract");
  const objectMatrices = raw.objectMatrices ?? [];
  const worldVectors = raw.worldVectors ?? [];
  const viewForwards = raw.viewForwards ?? [];
  if (![objectMatrices, worldVectors, viewForwards].every(Array.isArray)
      || objectMatrices.length + worldVectors.length + viewForwards.length === 0) {
    fail("basis conversion contract must contain at least one conversion");
  }

  const matrixNames = new Set();
  const normalizedMatrices = objectMatrices.map((row, index) => {
    if (!isRecord(row)) fail(`objectMatrices[${index}] must be an object`);
    rejectUnknownFields(row, new Set(["matrixName", "columns"]), `objectMatrices[${index}]`);
    if (!GLSL_IDENTIFIER.test(row.matrixName ?? "") || matrixNames.has(row.matrixName)) {
      fail(`objectMatrices[${index}].matrixName must be a unique GLSL identifier`);
    }
    matrixNames.add(row.matrixName);
    if (!Array.isArray(row.columns) || row.columns.length === 0) {
      fail(`objectMatrices[${index}].columns must be a non-empty array`);
    }
    const columns = new Set();
    const normalizedColumns = row.columns.map((columnRow, columnIndex) => {
      if (!isRecord(columnRow)) fail(`objectMatrices[${index}].columns[${columnIndex}] must be an object`);
      rejectUnknownFields(
        columnRow,
        new Set(["column", "expectedOccurrences"]),
        `objectMatrices[${index}].columns[${columnIndex}]`,
      );
      if (!Number.isInteger(columnRow.column) || columnRow.column < 0 || columnRow.column > 2
          || columns.has(columnRow.column)) {
        fail(`objectMatrices[${index}].columns[${columnIndex}].column must be unique and in 0..2`);
      }
      if (!Number.isInteger(columnRow.expectedOccurrences) || columnRow.expectedOccurrences < 1) {
        fail(`objectMatrices[${index}].columns[${columnIndex}].expectedOccurrences must be positive`);
      }
      columns.add(columnRow.column);
      return {
        column: columnRow.column,
        expectedOccurrences: columnRow.expectedOccurrences,
      };
    }).sort((left, right) => left.column - right.column);
    return { matrixName: row.matrixName, columns: normalizedColumns };
  }).sort((left, right) => left.matrixName.localeCompare(right.matrixName));

  const vectorNames = new Set();
  const vectorAliases = new Set();
  const normalizedVectors = worldVectors.map((row, index) => {
    if (!isRecord(row)) fail(`worldVectors[${index}] must be an object`);
    rejectUnknownFields(row, new Set(["source", "alias", "expectedOccurrences"]), `worldVectors[${index}]`);
    if (!GLSL_IDENTIFIER.test(row.source ?? "") || !GLSL_IDENTIFIER.test(row.alias ?? "")
        || vectorNames.has(row.source) || vectorAliases.has(row.alias)
        || !Number.isInteger(row.expectedOccurrences) || row.expectedOccurrences < 1) {
      fail(`worldVectors[${index}] is invalid or duplicated`);
    }
    vectorNames.add(row.source);
    vectorAliases.add(row.alias);
    return {
      source: row.source,
      alias: row.alias,
      expectedOccurrences: row.expectedOccurrences,
    };
  }).sort((left, right) => left.source.localeCompare(right.source));

  const forwardTargets = new Set();
  const normalizedForwards = viewForwards.map((row, index) => {
    if (!isRecord(row)) fail(`viewForwards[${index}] must be an object`);
    rejectUnknownFields(row, new Set(["matrixName", "targetName"]), `viewForwards[${index}]`);
    if (!GLSL_IDENTIFIER.test(row.matrixName ?? "") || !GLSL_IDENTIFIER.test(row.targetName ?? "")
        || forwardTargets.has(row.targetName)) {
      fail(`viewForwards[${index}] is invalid or duplicated`);
    }
    forwardTargets.add(row.targetName);
    return { matrixName: row.matrixName, targetName: row.targetName };
  }).sort((left, right) => left.targetName.localeCompare(right.targetName));

  return {
    ...(Object.hasOwn(raw, "objectMatrices") ? { objectMatrices: normalizedMatrices } : {}),
    ...(Object.hasOwn(raw, "worldVectors") ? { worldVectors: normalizedVectors } : {}),
    ...(Object.hasOwn(raw, "viewForwards") ? { viewForwards: normalizedForwards } : {}),
  };
}

export function compileTextureCoordinateContract(raw) {
  if (!isRecord(raw)) fail("texture-coordinate contract must be an object");
  rejectUnknownFields(raw, TEXTURE_COORDINATE_FIELDS, "texture-coordinate contract");
  if (!Array.isArray(raw.transforms) || raw.transforms.length === 0) {
    fail("texture-coordinate contract.transforms must be a non-empty array");
  }
  const uniforms = new Set();
  const outputs = new Set();
  const transforms = raw.transforms.map((row, index) => {
    if (!isRecord(row)) fail(`texture-coordinate transforms[${index}] must be an object`);
    rejectUnknownFields(
      row,
      new Set(["uniform", "slot", "input", "output", "conversion"]),
      `texture-coordinate transforms[${index}]`,
    );
    for (const field of ["uniform", "slot", "input", "output"]) {
      if (!GLSL_IDENTIFIER.test(row[field] ?? "")) {
        fail(`texture-coordinate transforms[${index}].${field} must be a GLSL identifier`);
      }
    }
    if (row.conversion !== "unity-texenv-to-three-gltf-v"
        || uniforms.has(row.uniform) || outputs.has(row.output)) {
      fail(`texture-coordinate transforms[${index}] is duplicated or has an unsupported conversion`);
    }
    uniforms.add(row.uniform);
    outputs.add(row.output);
    return {
      uniform: row.uniform,
      slot: row.slot,
      input: row.input,
      output: row.output,
      conversion: row.conversion,
    };
  }).sort((left, right) => left.uniform.localeCompare(right.uniform));

  let tangentViewY;
  if (Object.hasOwn(raw, "tangentViewY")) {
    const row = raw.tangentViewY;
    if (!isRecord(row)) fail("texture-coordinate tangentViewY must be an object");
    rejectUnknownFields(
      row,
      new Set(["output", "bitangent", "viewVector", "conversion"]),
      "texture-coordinate tangentViewY",
    );
    for (const field of ["output", "bitangent", "viewVector"]) {
      if (!GLSL_IDENTIFIER.test(row[field] ?? "")) {
        fail(`texture-coordinate tangentViewY.${field} must be a GLSL identifier`);
      }
    }
    if (row.conversion !== "negate-unity-to-three-gltf-v") {
      fail("texture-coordinate tangentViewY.conversion is unsupported");
    }
    tangentViewY = {
      output: row.output,
      bitangent: row.bitangent,
      viewVector: row.viewVector,
      conversion: row.conversion,
    };
  }
  return { transforms, ...(tangentViewY ? { tangentViewY } : {}) };
}

function stripGlslComments(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      if (end < 0) break;
      output += "\n";
      index = end + 1;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) fail("GLSL source has an unterminated block comment");
      output += source.slice(index, end + 2).replace(/[^\r\n]/g, " ");
      index = end + 2;
    } else {
      output += source[index];
      index += 1;
    }
  }
  return output;
}

function glslMainScope(source) {
  const stripped = stripGlslComments(source);
  if (/^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/m.test(stripped)) {
    fail("basis source validation rejects conditional preprocessor branches");
  }
  const matches = [...stripped.matchAll(/\bvoid\s+main\s*\(\s*\)\s*\{/g)];
  if (matches.length !== 1) fail("GLSL source must contain exactly one main function");
  const open = matches[0].index + matches[0][0].lastIndexOf("{");
  let depth = 0;
  let close = -1;
  for (let index = open; index < stripped.length; index += 1) {
    if (stripped[index] === "{") depth += 1;
    else if (stripped[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
      if (depth < 0) fail("GLSL source has unbalanced braces");
    }
  }
  if (close < 0) fail("GLSL main function has no matching closing brace");
  return {
    source: stripped,
    header: stripped.slice(0, open),
    body: stripped.slice(open + 1, close),
    footer: stripped.slice(close + 1),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateBasisConversionSourceText(source, rawContract) {
  if (typeof source !== "string" || source.length === 0) fail("basis GLSL source must be non-empty");
  const contract = compileBasisConversionContract(rawContract);
  const scope = glslMainScope(source);
  const helpers = {
    0: {
      name: "pcrUnityObjectToWorldAxisX",
      body: "return vec3(-threeModelMatrix[0].x, -threeModelMatrix[0].y, threeModelMatrix[0].z);",
    },
    1: {
      name: "pcrUnityObjectToWorldAxisY",
      body: "return vec3(threeModelMatrix[1].x, threeModelMatrix[1].y, -threeModelMatrix[1].z);",
    },
    2: {
      name: "pcrUnityObjectToWorldAxisZ",
      body: "return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);",
    },
  };
  const allowedHelperCalls = new Set();
  for (const row of contract.objectMatrices ?? []) {
    for (const columnRow of row.columns) {
      const helper = helpers[columnRow.column];
      const declaration = new RegExp(
        `highp\\s+vec3\\s+${helper.name}\\(highp\\s+mat4\\s+threeModelMatrix\\)\\s*\\{\\s*${escapeRegExp(helper.body)}\\s*\\}`,
        "g",
      );
      if ((scope.header.match(declaration) || []).length !== 1) {
        fail(`${helper.name} must have one exact definition before main`);
      }
      const call = `${helper.name}(${row.matrixName})`;
      allowedHelperCalls.add(call);
      const calls = scope.body.match(new RegExp(`\\b${escapeRegExp(call)}`, "g")) || [];
      if (calls.length !== columnRow.expectedOccurrences) {
        fail(`${call} occurrence count changed`);
      }
      if (new RegExp(`\\b${escapeRegExp(row.matrixName)}\\s*\\[\\s*${columnRow.column}\\s*\\]\\.xyz\\b`).test(scope.body)) {
        fail(`${row.matrixName}[${columnRow.column}].xyz remains after basis adaptation`);
      }
    }
  }
  for (const match of scope.body.matchAll(/\bpcrUnityObjectToWorldAxis[XYZ]\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/g)) {
    const normalized = match[0].replace(/\s+/g, "");
    if (![...allowedHelperCalls].some((call) => call.replace(/\s+/g, "") === normalized)) {
      fail(`undeclared object-to-world basis helper call ${match[0]}`);
    }
  }
  const outOfMainCalls = `${scope.header}\n${scope.footer}`
    .match(/\bpcrUnityObjectToWorldAxis[XYZ]\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/g) || [];
  if (outOfMainCalls.length > 0) {
    fail(`object-to-world basis helper call outside main: ${outOfMainCalls[0]}`);
  }
  for (const row of contract.worldVectors ?? []) {
    const declaration = new RegExp(
      `highp\\s+vec3\\s+${escapeRegExp(row.alias)}\\s*=\\s*vec3\\(${escapeRegExp(row.source)}\\.xy,\\s*-${escapeRegExp(row.source)}\\.z\\)\\s*;`,
    );
    if (!declaration.test(scope.body)) fail(`${row.alias} basis declaration is missing`);
    const aliasCount = (scope.body.match(new RegExp(`\\b${escapeRegExp(row.alias)}\\b`, "g")) || []).length;
    const sourceCount = (scope.body.match(new RegExp(`\\b${escapeRegExp(row.source)}\\b`, "g")) || []).length;
    if (aliasCount !== row.expectedOccurrences + 1 || sourceCount !== 2) {
      fail(`${row.source} world-vector basis replacement is incomplete`);
    }
  }
  for (const row of contract.viewForwards ?? []) {
    for (const [component, column, sign] of [["x", 0, "-"], ["y", 1, "-"], ["z", 2, ""]]) {
      const assignment = new RegExp(
        `^\\s*${escapeRegExp(row.targetName)}\\.${component}\\s*=\\s*${sign}${escapeRegExp(row.matrixName)}\\[${column}\\]\\.z\\s*;\\s*$`,
        "m",
      );
      if (!assignment.test(scope.body)) fail(`${row.targetName}.${component} view-forward assignment is missing`);
    }
  }
  return contract;
}

export function validateTextureCoordinateSourceText(source, rawContract) {
  if (typeof source !== "string" || source.length === 0) {
    fail("texture-coordinate GLSL source must be non-empty");
  }
  const contract = compileTextureCoordinateContract(rawContract);
  const scope = glslMainScope(source);
  for (const row of contract.transforms) {
    const declaration = new RegExp(
      `\\buniform\\s+(?:highp\\s+)?vec4\\s+${escapeRegExp(row.uniform)}\\s*;`,
      "g",
    );
    if ((scope.header.match(declaration) || []).length !== 1) {
      fail(`${row.uniform} must have one vec4 uniform declaration before main`);
    }
    const assignment = new RegExp(
      `^\\s*${escapeRegExp(row.output)}\\s*=\\s*\\(${escapeRegExp(row.input)}\\s*\\*\\s*${escapeRegExp(row.uniform)}\\.xy\\)\\s*\\+\\s*${escapeRegExp(row.uniform)}\\.zw\\s*;\\s*$`,
      "m",
    );
    if (!assignment.test(scope.body)) {
      fail(`${row.output} texture-coordinate transform is missing`);
    }
    const outputAssignments = scope.body.match(
      new RegExp(`\\b${escapeRegExp(row.output)}\\s*=`, "g"),
    ) || [];
    if (outputAssignments.length !== 1) {
      fail(`${row.output} must have exactly one assignment`);
    }
  }
  if (contract.tangentViewY) {
    const row = contract.tangentViewY;
    const assignment = new RegExp(
      `\\b${escapeRegExp(row.output)}\\s*=\\s*vec3\\(\\s*dot\\([^,]+,\\s*${escapeRegExp(row.viewVector)}\\)\\s*,\\s*-dot\\(${escapeRegExp(row.bitangent)}\\s*,\\s*${escapeRegExp(row.viewVector)}\\)\\s*,\\s*dot\\([^,]+,\\s*${escapeRegExp(row.viewVector)}\\)\\s*\\)\\s*;`,
      "s",
    );
    if (!assignment.test(scope.body)) {
      fail(`${row.output} tangent-view V-axis conversion is missing`);
    }
  }
  return contract;
}

function operation(kind, fields = {}) {
  return { kind, ...fields };
}

function legacyClaimOperations(stage, claim) {
  const claimSha256 = crypto.createHash("sha256").update(`${stage}\0${claim}`).digest("hex");
  if (!LEGACY_CLAIM_HASHES.has(claimSha256)) {
    fail(`legacy ${stage} claim is outside the pinned compatibility corpus: ${JSON.stringify(claim)}`);
  }
  if (claim === "remove Unity Vulkan clip-space Y inversion for WebGL clip space") {
    return [operation("clip-space-y-conversion", {
      from: "unity-vulkan",
      to: "webgl",
      operation: "remove-y-inversion",
    })];
  }
  if (claim.includes("version directive") || claim.includes("#version directive")) {
    return [operation("glsl-version-ownership", { owner: "three-raw-shader-material" })];
  }
  if (claim.includes("uBloomOnly backend route")) {
    return [operation("bloom-attachment-route", {
      contract: "official-emissive-mrt-to-attachment0",
    })];
  }
  if (claim.includes("M_unity = C * M_three * A")) {
    return [operation("object-basis-conversion", { contract: "unity-to-three-basis" })];
  }
  if (claim.includes("_DepthOffset in view space")) {
    return [operation("view-depth-offset", { contract: "linear-eye-depth-equivalent" })];
  }
  if (claim.includes("canonical default _MainTex_ST")) {
    return [operation("material-default-binding", {
      contract: "serialized-shader-property-default",
    })];
  }
  if (claim.includes("Unity _Time") || claim.includes("officialClock")) {
    return [operation("official-clock-binding", { contract: "official-clock-to-unity-time" })];
  }
  if (claim.includes("algebraically compose MatrixVP")) {
    return [operation("matrix-expression-fold", {
      contract: "mvp-object-to-projection-model-view",
    })];
  }

  const attributeClaim = claim.includes("Three.js attributes")
    || claim.includes("Three.js r165 attributes")
    || claim.includes("matching Three.js attributes")
    || (claim.startsWith("map official") && claim.endsWith("attributes"))
    || /^(position|normal|tangent|UV0|UV1|uv) (vec4|location)/.test(claim);
  if (attributeClaim) {
    return [operation("vertex-input-binding", {
      contract: "official-bind-channels-to-three-r165",
    })];
  }

  const bufferClaim = claim.includes("UBO")
    || claim.includes("common-buffer")
    || claim.includes("MPB values")
    || claim.includes("PGlobals")
    || claim.includes("material fields from PGlobals");
  const engineClaim = claim.includes("unity_ObjectToWorld")
    || claim.includes("unity_WorldToObject")
    || claim.includes("unity_Matrix")
    || claim.includes("glstate_matrix_projection")
    || claim.includes("object/world/view-projection matrices")
    || claim.includes("ObjectToWorld/WorldToObject/MatrixVP")
    || claim.includes("serialized VGlobals UBO members with Three.js model/view/projection uniforms");
  const operations = [];
  if (engineClaim) {
    operations.push(operation("engine-uniform-binding", {
      contract: "unity-builtins-to-three-r165",
    }));
  }
  if (bufferClaim && !claim.includes("serialized VGlobals UBO members with Three.js model/view/projection uniforms")) {
    const source = claim.includes("variant-local")
      ? "variant-local"
      : claim.includes("MPB values")
        ? "renderer-mpb"
        : "serialized-common";
    operations.push(operation("uniform-buffer-flattening", {
      source,
      preservation: "names-types-precision",
    }));
  }
  if (operations.length) return operations;

  fail(`unrecognized legacy ${stage} claim ${JSON.stringify(claim)}`);
}

function normalizeOperation(raw, stage, index) {
  if (!isRecord(raw)) fail(`${stage}.operations[${index}] must be an object`);
  const kind = raw.kind;
  if (typeof kind !== "string" || !Object.hasOwn(OPERATION_SCHEMAS, kind)) {
    fail(`${stage}.operations[${index}] has unknown kind ${JSON.stringify(kind)}`);
  }
  const schema = OPERATION_SCHEMAS[kind];
  if (!schema.stages.includes(stage)) fail(`${kind} is not valid in the ${stage} stage`);
  const allowedKeys = new Set(["kind", ...Object.keys(schema.fields)]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) fail(`${stage}.operations[${index}] has unsupported field ${key}`);
  }
  const normalized = { kind };
  for (const [field, allowed] of Object.entries(schema.fields)) {
    const value = raw[field];
    if (allowed === "sha256") {
      if (!HASH_RE.test(value ?? "")) fail(`${stage}.operations[${index}].${field} must be a lowercase SHA-256`);
    } else if (!allowed.includes(value)) {
      fail(`${stage}.operations[${index}].${field} must be one of ${allowed.join(", ")}`);
    }
    normalized[field] = value;
  }
  return normalized;
}

function normalizeOperations(raw, stage) {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${stage}.operations must be a non-empty array`);
  const normalized = raw.map((entry, index) => normalizeOperation(entry, stage, index));
  const keys = normalized.map(canonicalJson);
  if (new Set(keys).size !== keys.length) fail(`${stage}.operations contains duplicate operations`);
  return normalized.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function compileLegacyStage(stageContract, stage) {
  const claims = stageContract?.substitutions;
  if (!Array.isArray(claims) || claims.length === 0) {
    fail(`${stage}.substitutions must be a non-empty array for schema v1`);
  }
  if (claims.some((claim) => typeof claim !== "string" || claim.length === 0)) {
    fail(`${stage}.substitutions must contain non-empty strings`);
  }
  if (new Set(claims).size !== claims.length) fail(`${stage}.substitutions contains duplicate claims`);
  const operations = claims.flatMap((claim) => legacyClaimOperations(stage, claim));
  const unique = new Map(operations.map((entry) => [canonicalJson(entry), entry]));
  return [...unique.values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function validateStageHashes(stageContract, stage, sourceHashes) {
  if (!isRecord(stageContract)) fail(`${stage} stage is missing`);
  for (const field of ["officialSpirvSha256", "spirvCrossGlslSha256", "outputSha256"]) {
    if (!HASH_RE.test(stageContract[field] ?? "")) fail(`${stage}.${field} must be a lowercase SHA-256`);
  }
  if (sourceHashes?.[stage] && sourceHashes[stage] !== stageContract.outputSha256) {
    fail(`${stage}.outputSha256 does not match the emitted GLSL source`);
  }
}

export function compileWebglAdaptationContract(adaptation, { sourceHashes } = {}) {
  if (!isRecord(adaptation)) fail("adaptation must be an object");
  if (![WEBGL_ADAPTATION_SCHEMA_V1, WEBGL_ADAPTATION_SCHEMA_V2].includes(adaptation.schema)) {
    fail(`unsupported schema ${JSON.stringify(adaptation.schema)}`);
  }
  if (adaptation.backend !== WEBGL_ADAPTATION_BACKEND) {
    fail(`unsupported backend ${JSON.stringify(adaptation.backend)}`);
  }
  if (!HASH_RE.test(adaptation.interfaceSha256 ?? "")) fail("interfaceSha256 must be a lowercase SHA-256");

  const operations = {};
  for (const stage of STAGES) {
    const stageContract = adaptation[stage];
    validateStageHashes(stageContract, stage, sourceHashes);
    operations[stage] = adaptation.schema === WEBGL_ADAPTATION_SCHEMA_V2
      ? normalizeOperations(stageContract.operations, stage)
      : compileLegacyStage(stageContract, stage);
  }
  const clipOperations = operations.vertex.filter((entry) => entry.kind === "clip-space-y-conversion");
  if (clipOperations.length !== 1) fail("vertex stage must declare exactly one clip-space Y conversion");
  if (adaptation.schema === WEBGL_ADAPTATION_SCHEMA_V2) {
    for (const stage of STAGES) {
      const versionOwners = operations[stage].filter((entry) => entry.kind === "glsl-version-ownership");
      if (versionOwners.length !== 1) {
        fail(`${stage} stage must declare exactly one GLSL version owner`);
      }
    }
  }

  const graph = {
    schema: WEBGL_ADAPTATION_SCHEMA_V2,
    backend: WEBGL_ADAPTATION_BACKEND,
    vertex: operations.vertex,
    fragment: operations.fragment,
  };
  const operationGraphSha256 = canonicalJsonSha256(graph);
  if (adaptation.operationGraphSha256 !== undefined
      && adaptation.operationGraphSha256 !== operationGraphSha256) {
    fail("operationGraphSha256 does not match normalized operations");
  }
  return {
    sourceSchema: adaptation.schema,
    graph,
    operationGraphSha256,
    legacyClaimCount: adaptation.schema === WEBGL_ADAPTATION_SCHEMA_V1
      ? STAGES.reduce((sum, stage) => sum + adaptation[stage].substitutions.length, 0)
      : 0,
  };
}

export function buildWebglAdaptationV2({
  vertex,
  fragment,
  interfaceSha256,
  officialVertexInputs,
  runtimeContract,
  officialProgramBindings,
}) {
  if (!isRecord(officialVertexInputs)) fail("officialVertexInputs must be an object");
  if (!isRecord(runtimeContract?.engine_uniforms)) {
    fail("runtimeContract.engine_uniforms must be an object");
  }
  if (!isRecord(officialProgramBindings)) fail("officialProgramBindings must be an object");

  const evidence = {
    "vertex-input-binding": {
      field: "mappingSha256",
      value: canonicalJsonSha256(officialVertexInputs),
    },
    "engine-uniform-binding": {
      field: "runtimeContractSha256",
      value: canonicalJsonSha256(runtimeContract.engine_uniforms),
    },
    "uniform-buffer-flattening": {
      field: "bindingContractSha256",
      value: canonicalJsonSha256(officialProgramBindings),
    },
    ...(runtimeContract.renderer_uniforms
      ? {
        "renderer-property-block-binding": {
          field: "producerContractSha256",
          value: canonicalJsonSha256(runtimeContract.renderer_uniforms),
        },
      }
      : {}),
    ...(runtimeContract.texture_coordinates?.vertex
      ? {
        "texture-coordinate-basis-conversion": {
          field: "textureCoordinateContractSha256",
          value: canonicalJsonSha256(
            compileTextureCoordinateContract(runtimeContract.texture_coordinates.vertex),
          ),
        },
      }
      : {}),
  };
  const buildStage = (rawStage, stage) => {
    if (!isRecord(rawStage)) fail(`${stage} stage builder input must be an object`);
    if (!Array.isArray(rawStage.operations)) fail(`${stage}.operations must be an array`);
    const operations = rawStage.operations.map((raw, index) => {
      if (!isRecord(raw)) fail(`${stage}.operations[${index}] must be an object`);
      if (raw.kind === "object-basis-conversion") {
        const rawBasisContract = runtimeContract.backend_basis_conversions?.[stage];
        if (!isRecord(rawBasisContract)) {
          fail(`${stage}.operations[${index}] requires runtimeContract.backend_basis_conversions.${stage}`);
        }
        const basisContract = compileBasisConversionContract(rawBasisContract);
        const basisContractSha256 = canonicalJsonSha256(basisContract);
        if (Object.hasOwn(raw, "basisContractSha256")
            && raw.basisContractSha256 !== basisContractSha256) {
          fail(`${stage}.operations[${index}].basisContractSha256 does not match generated contract evidence`);
        }
        return { ...raw, basisContractSha256 };
      }
      if (raw.kind === "uniform-buffer-flattening") {
        const common = officialProgramBindings.common_constant_buffers;
        const variant = officialProgramBindings.variant_constant_buffers;
        if (!Array.isArray(common) || !Array.isArray(variant)) {
          fail("officialProgramBindings must expose common_constant_buffers and variant_constant_buffers");
        }
        const available = raw.source === "serialized-common"
          ? common.length > 0
          : raw.source === "variant-local"
            ? variant.length > 0
            : raw.source === "mixed"
              ? common.length > 0 && variant.length > 0
              : true;
        if (!available) {
          fail(`${stage}.operations[${index}] declares unavailable ${raw.source} buffer source`);
        }
      }
      if (raw.kind === "official-clock-binding") {
        if (!isRecord(runtimeContract.dynamic_uniforms)) {
          fail(`${stage}.operations[${index}] requires runtimeContract.dynamic_uniforms`);
        }
        const clockContractSha256 = canonicalJsonSha256(runtimeContract.dynamic_uniforms);
        if (Object.hasOwn(raw, "clockContractSha256")
            && raw.clockContractSha256 !== clockContractSha256) {
          fail(`${stage}.operations[${index}].clockContractSha256 does not match generated contract evidence`);
        }
        return { ...raw, clockContractSha256 };
      }
      if (raw.kind === "dynamic-uniform-producer-binding") {
        if (!isRecord(runtimeContract.dynamic_uniforms)) {
          fail(`${stage}.operations[${index}] requires runtimeContract.dynamic_uniforms`);
        }
        const producerContractSha256 = canonicalJsonSha256(runtimeContract.dynamic_uniforms);
        if (Object.hasOwn(raw, "producerContractSha256")
            && raw.producerContractSha256 !== producerContractSha256) {
          fail(`${stage}.operations[${index}].producerContractSha256 does not match generated contract evidence`);
        }
        return { ...raw, producerContractSha256 };
      }
      if (raw.kind === "renderer-property-block-binding"
          && !isRecord(runtimeContract.renderer_uniforms)) {
        fail(`${stage}.operations[${index}] requires runtimeContract.renderer_uniforms`);
      }
      if (raw.kind === "texture-coordinate-basis-conversion"
          && !isRecord(runtimeContract.texture_coordinates?.[stage])) {
        fail(`${stage}.operations[${index}] requires runtimeContract.texture_coordinates.${stage}`);
      }
      const binding = evidence[raw.kind];
      if (!binding) return { ...raw };
      if (Object.hasOwn(raw, binding.field) && raw[binding.field] !== binding.value) {
        fail(`${stage}.operations[${index}].${binding.field} does not match generated contract evidence`);
      }
      return { ...raw, [binding.field]: binding.value };
    });
    return { ...rawStage, operations };
  };
  const adaptation = {
    schema: WEBGL_ADAPTATION_SCHEMA_V2,
    backend: WEBGL_ADAPTATION_BACKEND,
    vertex: buildStage(vertex, "vertex"),
    fragment: buildStage(fragment, "fragment"),
    interfaceSha256,
  };
  adaptation.operationGraphSha256 = compileWebglAdaptationContract(adaptation, {
    sourceHashes: {
      vertex: adaptation.vertex.outputSha256,
      fragment: adaptation.fragment.outputSha256,
    },
  }).operationGraphSha256;
  return adaptation;
}

export function legacyClaimSetSha256(manifests) {
  const claims = [];
  for (const manifest of manifests) {
    const adaptation = manifest?.webgl_adaptation;
    if (adaptation?.schema !== WEBGL_ADAPTATION_SCHEMA_V1) continue;
    for (const stage of STAGES) {
      for (const claim of adaptation[stage]?.substitutions ?? []) claims.push(`${stage}\0${claim}`);
    }
  }
  return crypto.createHash("sha256")
    .update(JSON.stringify([...new Set(claims)].sort()))
    .digest("hex");
}
