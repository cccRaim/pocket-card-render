// Frida probe for Pokemon TCG Pocket 1.6.0 arm64. Run only on a rooted test device:
//   frida -U -f jp.pokemon.pokemontcgp -l build/capture-official-sort-runtime.js
// Emits PCR_SORT_CAPTURE JSON lines; it does not alter renderer state or call Unity APIs.
"use strict";

const SCHEMA = "pocket-card-render/official-sort-runtime-capture@1";
const PACKAGE = Object.freeze({
  name: "jp.pokemon.pokemontcgp",
  versionName: "1.6.0",
  versionCode: 293311,
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
});
const RVA = Object.freeze({
  materialBuildShaderKeywordState: 0x5aba6c,
  isSrpBatcherCompatible: 0x54c62c,
  prepareSortInputs: 0x54cc10,
  captureSortFields: 0x54d274,
  captureKeywordHash: 0x54d2f4,
  storeSortEntry: 0x54d408,
});
const WORDS = Object.freeze([
  [RVA.materialBuildShaderKeywordState, 0xd101c3ff],
  [RVA.isSrpBatcherCompatible, 0xa9bd5ffe],
  [RVA.prepareSortInputs, 0x6db63bef],
  [RVA.captureSortFields, 0x394302a9],
  [RVA.captureKeywordHash, 0x4a130009],
  [RVA.storeSortEntry, 0x29012511],
]);

const stacks = new Map();
const emitted = new Set();
let activeSessionId = null;

function u32(pointer) {
  return pointer.toUInt32() >>> 0;
}

function emit(row, dedupeKey = null) {
  const payload = { schema: SCHEMA, ...(activeSessionId ? { sessionId: activeSessionId } : {}), ...row };
  const key = dedupeKey || JSON.stringify(payload);
  if (emitted.has(key)) return;
  emitted.add(key);
  console.log(`PCR_SORT_CAPTURE ${JSON.stringify(payload)}`);
}

function safeName(object) {
  try {
    const chars = object.add(0x30).readPointer();
    return chars.isNull() ? null : chars.readUtf8String();
  } catch (_) {
    return null;
  }
}

function emitNamedObject(kind, object) {
  if (object.isNull()) return;
  const instanceId = object.add(0x08).readS32();
  const name = safeName(object);
  emit({ type: kind, instanceId, instanceIdLow8: instanceId & 0xff, name },
    `${kind}:${instanceId}:${name || ""}`);
}

function currentState() {
  const stack = stacks.get(Process.getCurrentThreadId());
  return stack?.[stack.length - 1] || null;
}

function attach(module) {
  for (const [rva, word] of WORDS) {
    const actual = module.base.add(rva).readU32();
    if (actual !== word) {
      throw new Error(`libunity instruction mismatch at RVA 0x${rva.toString(16)}: 0x${actual.toString(16)}`);
    }
  }
  const startedAtUnixMs = Date.now();
  const processId = Process.id;
  const sessionId = `${PACKAGE.versionCode}:${processId}:${startedAtUnixMs}:${module.base}`;
  activeSessionId = sessionId;
  emit({
    type: "manifest",
    sessionId,
    startedAtUnixMs,
    processId,
    package: PACKAGE,
    moduleBase: module.base.toString(),
    instructionChecks: WORDS.length,
  });

  Interceptor.attach(module.base.add(RVA.materialBuildShaderKeywordState), {
    onEnter(args) { emitNamedObject("material", args[0]); },
  });
  Interceptor.attach(module.base.add(RVA.isSrpBatcherCompatible), {
    onEnter(args) { emitNamedObject("shader", args[1]); },
  });
  Interceptor.attach(module.base.add(RVA.prepareSortInputs), {
    onEnter(args) {
      const threadId = Process.getCurrentThreadId();
      const stack = stacks.get(threadId) || [];
      stack.push({ queueBase: args[0].readPointer(), pending: null });
      stacks.set(threadId, stack);
    },
    onLeave() {
      const threadId = Process.getCurrentThreadId();
      const stack = stacks.get(threadId);
      if (!stack) return;
      stack.pop();
      if (!stack.length) stacks.delete(threadId);
    },
  });
  Interceptor.attach(module.base.add(RVA.captureSortFields), {
    onEnter() {
      const state = currentState();
      if (!state) return;
      const material = this.context.x8;
      const shader = this.context.x24;
      emitNamedObject("material", material);
      emitNamedObject("shader", shader);
      state.pending = {
        materialName: safeName(material),
        shaderName: safeName(shader),
        materialSortByte17c: u32(this.context.x20) & 0xff,
        shaderObjectInstanceId: this.context.x19.toInt32(),
      };
    },
  });
  Interceptor.attach(module.base.add(RVA.captureKeywordHash), {
    onEnter() {
      const pending = currentState()?.pending;
      if (!pending) return;
      pending.localKeywordHash = u32(this.context.x0);
      pending.baseLow16 = u32(this.context.x29) & 0xffff;
    },
  });
  Interceptor.attach(module.base.add(RVA.storeSortEntry), {
    onEnter() {
      const state = currentState();
      const pending = state?.pending;
      if (!pending || pending.localKeywordHash == null) return;
      const visibleNodeIndex = u32(this.context.x9);
      const node = state.queueBase.add(visibleNodeIndex * 0x198);
      if ((node.add(0xe8).readU32() & 0x3f) !== 1) return;
      const stateKey = u32(this.context.x17);
      const packedMaterialSlotAndSrp = u32(this.context.x29) & 0xffff;
      const materialSlot = packedMaterialSlotAndSrp >>> 1;
      const staticBatchFirstSubMesh = node.add(0xb8).readU16();
      const staticBatchSubMeshCount = node.add(0xba).readU16();
      const packedLightmapIndices = node.add(0xe4).readU32();
      const meshSmallMeshId = node.add(0x100).readU32();
      const entry28 = u32(this.context.x23);
      const expectedEntry28 = (((meshSmallMeshId & 0xffff) << 16)
        | ((staticBatchFirstSubMesh + materialSlot) & 0xffff)) >>> 0;
      const expected = (pending.baseLow16
        | (pending.materialSortByte17c << 16)
        | (((pending.localKeywordHash ^ pending.shaderObjectInstanceId) & 0xff) << 24)) >>> 0;
      if (stateKey !== expected) throw new Error("captured entry+0x08 does not match the official hashed formula");
      if (entry28 !== expectedEntry28) throw new Error("captured entry+0x28 does not match the official Mesh/material-slot formula");
      emit({
        type: "draw",
        threadId: Process.getCurrentThreadId(),
        materialName: pending.materialName,
        shaderName: pending.shaderName,
        materialSortByte17c: pending.materialSortByte17c,
        shaderObjectInstanceId: pending.shaderObjectInstanceId,
        shaderObjectInstanceIdLow8: pending.shaderObjectInstanceId & 0xff,
        localKeywordHash: pending.localKeywordHash,
        localKeywordHashLow8: pending.localKeywordHash & 0xff,
        baseLow16: pending.baseLow16,
        stateKey,
        packedMaterialSlotAndSrp,
        materialSlot,
        srpBatcherCompatible: packedMaterialSlotAndSrp & 1,
        staticBatchFirstSubMesh,
        staticBatchSubMeshCount,
        packedLightmapIndices,
        entry28,
        visibleNodeIndex,
        meshSmallMeshId,
        // The native loop stores the current ordinal at 0x54d3f8, then increments w19 at
        // 0x54d3fc before reaching this hook point.
        drawCandidateOrdinal: (u32(this.context.x19) - 1) >>> 0,
      });
      state.pending = null;
    },
  });
}

const timer = setInterval(() => {
  const module = Process.findModuleByName("libunity.so");
  if (!module) return;
  clearInterval(timer);
  attach(module);
}, 50);
