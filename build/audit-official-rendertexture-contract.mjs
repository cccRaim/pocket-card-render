// Audit the APKM-backed conditional RenderTexture format/Y contract without GPU rendering.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "public", "render", "card-display-contract.json");
const EXPECTED_HASHES = {
  apkm_sha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  base_apk_sha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
  arm64_split_sha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  globalgamemanagers_sha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
  libunity_sha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  libil2cpp_sha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};

function runContractCheck() {
  const result = spawnSync(process.execPath, ["build/build-official-card-display-contract.mjs", "--check"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "card display contract check failed").trim());
  }
}

function hex(value) {
  return Number.parseInt(value, 16);
}

function fileOffsetForRva(loadSegments, rva, size = 1) {
  for (const segment of loadSegments) {
    const virtualAddress = hex(segment.virtualAddress);
    const relative = rva - virtualAddress;
    if (relative >= 0 && relative + size <= hex(segment.fileSize)) {
      return hex(segment.offset) + relative;
    }
  }
  throw new Error(`RVA 0x${rva.toString(16)} is not covered by a file-backed PT_LOAD segment`);
}

runContractCheck();
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
assert.equal(contract.schema_version, 5);
assert.deepEqual(
  Object.fromEntries(Object.entries(contract.quality_profiles)
    .map(([name, profile]) => [name, [profile.quality_enum, profile.quality_factor,
      profile.source_render_target_request.width, profile.source_render_target_request.height]])),
  {
    high: [0, 1, 1403, 1403],
    middle: [1, 0.800000011920929, 1122, 1122],
    low: [2, 0.699999988079071, 982, 982],
  },
);
assert.equal(contract.generated_by, "build/build-official-card-display-contract.mjs");
assert.deepEqual(contract.official_source.binary_hashes, EXPECTED_HASHES);
assert.equal(contract.official_source.unity_version, "2022.3.62f2_7670c08855a9");

const physical = contract.render_texture_physical_contract;
assert.equal(physical.status, "conditionally-proven");
assert.deepEqual(physical.applicability.graphics_api, { serialized_value: 21, name: "Vulkan" });
assert.deepEqual(physical.applicability.active_color_space, { serialized_value: 0, name: "Gamma" });
assert.equal(physical.applicability.depth_and_stencil_buffers_disabled, false);
assert.deepEqual(physical.request.color, { value: 0, name: "ARGB32" });
assert.equal(physical.request.depth_bits, 24);
assert.equal(physical.request.anti_aliasing, 1);

assert.deepEqual(physical.color.legacy_mapping, {
  status: "proven",
  render_texture_format: { value: 0, name: "ARGB32" },
  linear_or_gamma_graphics_format: { value: 8, name: "R8G8B8A8_UNorm" },
  srgb_graphics_format: { value: 4, name: "R8G8B8A8_SRGB" },
  selected_for_official_gamma_player: { value: 8, name: "R8G8B8A8_UNorm" },
});
assert.equal(physical.color.compatible_format_chain.status, "proven");
assert.equal(physical.color.compatible_format_chain.capability_entry_count, 152);
assert.equal(physical.color.compatible_format_chain.capability_table_device_offset, "0x160");
assert.deepEqual(physical.color.preferred_vulkan_format, {
  status: "conditionally-proven",
  condition: "the running Vulkan device reports GF8 supported for FormatUsage.Render",
  graphics_format: { value: 8, name: "R8G8B8A8_UNorm" },
  vk_format: { value: 37, name: "VK_FORMAT_R8G8B8A8_UNORM" },
});
assert.deepEqual(physical.color.srgb_vulkan_mapping, {
  graphics_format: 4,
  vk_format: 43,
  name: "VK_FORMAT_R8G8B8A8_SRGB",
});
assert.equal(physical.color.actual_vulkan_format.status, "device-state");

assert.deepEqual(physical.depth_stencil.selection_chain, {
  status: "proven",
  requested_bits: 24,
  default_format: { value: 2, name: "DepthStencil" },
  preferred_graphics_format: { value: 92, name: "D24_UNorm_S8_UInt" },
  get_compatible_format: { format_usage: { value: 4, name: "Render" }, preserve: true },
});
assert.deepEqual(
  physical.depth_stencil.known_vulkan_mappings.map((item) => [item.graphics_format, item.vk_format]),
  [[92, 129], [94, 130]],
);
assert.equal(physical.depth_stencil.preferred_vulkan_format.status, "conditionally-proven");
assert.equal(physical.depth_stencil.actual_graphics_format.status, "device-state");
assert.equal(physical.depth_stencil.actual_depth_stencil_aspects.status, "device-state");

assert.deepEqual(physical.y.unity_uv_origin, {
  status: "proven",
  graphics_uv_starts_at_top: true,
  native_flag_offset: "0xe0",
  native_initialized_value: 0,
});
assert.deepEqual(physical.y.homography_sampling, {
  status: "proven",
  extra_one_minus_y: false,
  managed_blit_or_flip_before_consumer: false,
  vulkan_clip_space_y_flip: true,
});
assert.equal(physical.y.final_blit_sampling.status, "proven");
assert.equal(physical.y.final_blit_sampling.render_target_uv_one_minus_y, true);
assert.equal(physical.y.final_blit_sampling.vulkan_clip_space_y_flip, true);
assert.equal(physical.y.actual_vk_viewport.status, "device-state");
assert.equal(physical.y.actual_vk_viewport.proc_global_slot_rva, "0x1290760");
assert.equal(physical.y.physical_row_origin.status, "device-state");

assert.equal(physical.pipeline_cache.status, "device-state");
assert.equal(physical.pipeline_cache.shipped_in_apks, false);
assert.equal(physical.pipeline_cache.runtime_path, "/vulkan_pso_cache.bin");
assert.deepEqual(
  physical.pipeline_cache.compatibility_header_fields,
  ["version", "vendorId", "deviceId", "pipelineCacheUUID"],
);

assert.equal(physical.static_evidence.elf_virtual_address_mapping, "PT_LOAD file-backed range");
const segments = physical.static_evidence.elf_load_segments;
assert.equal(fileOffsetForRva(segments, 0xA7C004, 4), 0xA78004);
assert.equal(fileOffsetForRva(segments, 0x11DE2C8, 16), 0x11D22C8);
assert.equal(
  physical.static_evidence.native_windows.vulkanCapabilityTableAndDepthDefault.sha256,
  "a5d93492be6dbbda0104f94f594b7e7eb93ecf629cabfd7c058396bf796ef49d",
);

assert.equal(contract.runtime_boundaries.physical_render_texture.physical_color_format.status, "conditionally-proven");
assert.equal(contract.runtime_boundaries.physical_render_texture.physical_depth_format.status, "device-state");
assert.equal(contract.runtime_boundaries.physical_render_texture.actual_vk_viewport.status, "device-state");

console.log("Official RenderTexture conditional contract audit OK");
console.log("Color: ARGB32 -> GF8 (Gamma), conditionally Vk37; compatible fallback remains device-state");
console.log("Depth: 24 -> DefaultFormat.DepthStencil -> GetCompatibleFormat(GF92, Render, preserve=true)");
console.log("Y: Unity top-origin; Homography no 1-v; FinalBlit 1-v; actual VkViewport remains device-state");
