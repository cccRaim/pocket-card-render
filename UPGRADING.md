# Upgrading the Official Sample

Renderer implementation and official evidence are separate concerns. A Unity
or game update does not automatically invalidate the three.js architecture,
but it immediately invalidates the old APK, native RVA, ShaderProgram,
Material, serialized-asset, and runtime-capture evidence for the new version.

## Single Source Of Truth

- `build/official-samples/current.json` selects the active sample.
- `build/official-samples/candidate.json` selects the candidate under migration.
- `build/official-samples/<sample>.json` is an immutable version snapshot with
  game/Unity versions, binary hashes, asset counts, shader proof roots, and
  canonical scenes.
- `build/official-sample.mjs` is the shared Node loader and schema validator.
- Runtime source-set hashes include both the pointer and selected manifest, so
  switching versions automatically invalidates old captures.

Never overwrite an old manifest. Add a new `candidate` manifest, update only
`candidate.json` while migrating, finish the migration, change the manifest to
`baseline`, then update `current.json`.

## Migration

1. Copy the current manifest to a candidate, point `candidate.json` at it, and
   fill in the new APK/splits, Unity build, binary hashes, and initial
   inventories. Keep volatile downloads in `.output`; preserve versioned full
   inputs under `.output-full`.
2. Run:

   ```bash
   npm run verify:official-sample-inputs -- \
     --manifest build/official-samples/<candidate>.json \
     --splits <candidate-split-directory> \
     --metadata-plaintext <candidate-global-metadata.dat>
   npm run report:official-version-migration
   ```

   The first command verifies the split APKs and nested native/Unity files
   byte-for-byte. Use `--apkm <candidate.apkm>` instead when the immutable
   source is an APKM container. The second command reports invalidation work in the native
   package, Unity runtime, serialized assets, shader programs, runtime evidence,
   and documentation domains. It is a planning report and may pass while the
   migration is incomplete. `npm run audit:official-version-migration` is the
   strict fail-closed gate and must fail until every triggered domain is closed.
   The strict gate is shallow-first: it runs the inexpensive readiness preflight
   first and performs deep re-extraction only when every shallow obligation is
   already closed. An incomplete shallow report skips deep work and still exits
   nonzero.
3. Re-extract APK/IL2CPP/metadata and relocate native producers. Old RVAs and
   signatures are locators only.
4. Rebuild the asset inventory, Material/program proof graph, and selector
   contract. Classify semantic executables as unchanged, changed, added, or
   removed. Reproduce the static migration evidence with:

   ```bash
   npm run build:official-program-migration
   npm run audit:official-program-migration
   npm run analyze:official-program-migration
   ```

5. Regenerate changed/added WebGL ports and their data-derived witness
   subcorpus, then run the verifier gates:

   ```bash
   npm run build:candidate-changed-ports
   npm run audit:candidate-changed-ports
   npm run build:candidate-static-port-reuse
   npm run build:candidate-program-port-contract
   npm run audit:candidate-program-migration
   ```

   A changed-route subcorpus proves only its selector/Material witness scope.
   It is not the complete candidate canonical corpus or runtime evidence.
   Static reuse is data-driven: the current denominator is 68 formal manifests
   plus one engine-owned runtime boundary. The aggregate program-migration
   audit re-extracts all reusable routes from candidate official bytes and
   verifies the complete 78-formal-port contract.
   Use `npm run report:candidate-migration-readiness` for an executable
   per-domain progress report. It runs the candidate package/native and
   changed-port verifiers, checks the `.output-full` snapshot bindings, and
   reports `pass`, `partial`, or `blocked`. The report is migration readiness,
   not a shader-restoration or visual-fidelity percentage.
6. Rebuild canonical scenes and text/TMP/UGUI/RT contracts. Capture the complete
   candidate local WebGL and TMP batch only after every generator has stopped,
   then audit the independently versioned official guest denominator:

   Candidate material recipes must resolve `m_CustomRenderQueue == -1` from the
   same-version serialized Shader/SubShader `Queue` tag. Unknown or
   subshader-dependent queues fail closed; never restore an arbitrary
   sort-last sentinel. The canonical-scene gate verifies the effective queue
   and its Material/Shader provenance before publication.

   ```bash
   npm run audit:full-runtime-evidence:require
   npm run audit:tmp-runtime-evidence:require
   npm run audit:runtime-display-fidelity
   npm run audit:candidate-official-guest-runtime-batch
   npm run probe:candidate-guest-vulkan
   npm run convert:candidate-guest-vulkan -- \
     --trace <card-frame.gfxr> \
     --output <artifact-root>/<cardId>/capture
   npm run audit:candidate-guest-platform-blocker
   ```

   The probe is read-only: it does not launch the target, install packages,
   change Android settings, or create capture data. It only reports ADB/root,
   package ABI/native-bridge, and Vulkan-layer prerequisites. A BlueStacks host
   compositor capture is not official guest evidence. A guest capture requires
   observed capture-layer initialization and a real trace from the target
   process; probe readiness alone contributes no fidelity evidence. Root access
   alone does not authorize an external Vulkan layer on a production `user`
   build: the target must be debuggable, explicitly enable
   `com.android.graphics.injectLayers.enable`, or run on an authorized rooted
   `userdebug`/`eng` build.

   The hash-matched 1.7.0 candidate has now been tested on BlueStacks Pie64.
   That specific ARM-translation path is a tested-platform dead end: the
   production `user` build cannot inject the layer into the non-debuggable
   target, and the clean candidate launch crashes in `libhoudini.so` before a
   stable captureable card frame. GFXReconstruct was not mapped or initialized,
   and no `.gfxr` was produced. Verify the hash-bound, tested-platform-only
   report with `npm run audit:candidate-guest-platform-blocker`. It closes
   neither official guest runtime nor native display and contributes zero
   fidelity. Continue guest capture only on a real ARM64 device or an authorized
   ARM64 `userdebug`/`eng` environment.
7. Convert each device `.gfxr` on the desktop with hash-bound
   `gfxrecon-convert` and `gfxrecon-extract`. The bridge preserves the raw
   trace, official JSONL, extracted SPIR-V, and a conversion manifest before it
   emits the strict `events.jsonl` consumed by the importer. Related but
   unsupported Vulkan commands fail closed. Every other Vulkan call outside
   the event schema is classified by the versioned
   `gfxreconstruct-state-boundary-contract`, including exact occurrence counts
   for memory mapping, buffer/image payload, descriptor/layout, command,
   synchronization, presentation, query, and fallback families. The nine-card
   validator independently recomputes that denominator from the raw official
   JSONL, so a conversion manifest cannot hide an observed unmodeled call even
   if all artifact hashes are regenerated. This proves event transcription
   only: framebuffer pixels and mapped/device-local buffer contents are
   explicitly not reconstructed yet, so the conversion cannot satisfy display
   or uniform-value obligations by itself. Formal conversion must match the
   platform, version, byte length, and SHA-256 identities pinned in
   `build/gfxreconstruct-toolchain.json`. The nine-card batch revalidates the
   raw trace, official JSONL, conversion manifest, strict events, and every
   SPIR-V. A card is complete only when program dispatch, pipeline state,
   descriptor bindings, uniform values, attachment descriptors, attachment
   layouts, vertex bindings, and draw submission are all exact.
   Program dispatch must join every inventory execution to the candidate port
   contract by `selectorId + candidateWitnessId + subshader + pass`; matching
   SPIR-V alone is insufficient. The import artifact binds the contract SHA
   and preserves its semantic executable and stage/parameter/pass/common
   identity fields on each expected and assigned draw. The batch also verifies
   all 78 candidate port manifests by file SHA, composite route, executable
   identity, and pass-state identity, then binds their sorted inventory as
   `programPortManifestSetSha256`; any manifest-set change invalidates prior
   captures and imports.
   Pipeline comparison resolves Material properties before Shader defaults and
   serialized pass literals, then compares draw-effective Vulkan state.
   Missing `vkCmdSet*` state, advanced blend operations, separate blend,
   nonzero depth bias, unknown enums, or unexplained `pNext` structures fail
   closed. Unity blend factors are mapped by semantics, not integer value;
   Unity ABGR ColorWriteMask bits are remapped to Vulkan RGBA and every MRT
   attachment is checked. Matching all currently comparable fields is still
   partial evidence: `pipelineState` remains runtime-required until Unity's
   Vulkan backend lowering and render-pass compatibility are independently
   closed.
   Even before a `.gfxr` exists, the batch compiles the nine cards into 232
   expected draws: 214 formal pipeline expectations and 18 engine-runtime
   boundary draws. Any unresolved expectation fails before capture. This
   static denominator contributes no fidelity.
   Report the static Unity 6 draw-sort subset separately: `distanceKey` and
   four call-free sorting/light-probe getters now pass strict normalization
   that preserves field offsets and direct calls. The complex
   `sortInputBuilder`, live comparator inputs, job output, and guest input
   state still require runtime evidence.
8. Require `npm run audit:official-version-migration` and
   `npm run audit:all` to pass. Then promote the candidate, switch
   `current.json`, and run the full gate again.

Old exact claims remain valid only for their old sample. Shader names, matching
stage hashes, or visual similarity cannot preserve complete exact by
themselves. Screenshots remain terminal visual regression checks, not official
fidelity evidence.

## 1.6.0 To 1.7.0 Migration Facts

Candidate `ptcgp-1.7.0-unity-6000.0.69f1-candidate` changes Unity
`2022.3.62f2` to `6000.0.69f1`; the game
ARM64 player identifies itself as `6000.0.69f1_5f8607f5118b`.

- Canonical Face bundles increase from 3,191 to 3,546, unique Materials from
  8,460 to 9,395, and Material-slot usages from 58,057 to 64,738.
- The static program inventory changes from 80 routes to 79. Nine routes
  changed, none were added, and one old route was removed.
- Six changed routes are engine-uniform-layout changes. Three contain shader
  logic changes. One otherwise reusable route is rejected because its
  serialized Shader property default changed.
- Of 69 fully validated reusable routes, 68 are formal WebGL ports and one is
  the engine-owned `Side&Back` runtime-variant boundary. Together with the 10
  changed/default-sensitive ports, the candidate denominator is 78 formal
  ports plus one runtime boundary.
- The native shader-variant scoring and tie-break rule were re-proved from the
  Unity 6 game `libunity.so`; old RVAs were not reused as facts.
- The matching Unity Android Build Support release player and symbols are now
  independently hash-bound to changeset `5f8607f5118b`.
- Candidate RenderTexture evidence is split by producer family. The detail-card
  `_cardSize` and `_useMipMap` bytes are joined through the candidate
  serialized-UI corpus, while the custom `BloomPass.Execute` remains a
  command-buffer path rather than moving wholesale to RenderGraph. Its five
  `GetTemporaryRT` sites, five releases, ARGB32 base descriptor, and Bilinear
  filter are candidate-IL2CPP-bound. The matching release player's 29-by-2
  RenderTextureFormat-to-GraphicsFormat table, read-write overload, native
  helper, icall wrapper, and `RenderTextureDesc`/`RenderTexture` constructors
  are now byte/shape-bound to the candidate `libunity.so`. The managed
  constructor chain proves that the current `ARGB32 + Default + Gamma`
  request selects `R8G8B8A8_UNorm`, with constructor defaults of MSAA 1,
  volume depth 1, and memoryless None. The device result from
  `SystemInfo.GetCompatibleFormat(Render)`, legacy depth conversion, live
  descriptors, physical Y orientation, Unity allocation, and guest
  attachments remain runtime-required. Requested format and constructor
  defaults must not be described as a proved physical GPU resource.
- The Unity 6 scene MRT RenderGraph route is now partial-exact rather than an
  undecoded architecture marker. Four candidate ARM64 methods and their
  metadata layouts prove an `R8G8B8A8_UNorm`, depthless emissive target whose
  dimensions are twice the `GetBufferSize` result, plus opaque and transparent
  raster passes that bind active color at attachment 0 and emissive at
  attachment 1 with `AccessFlags.Write`. Inherited live `TextureDesc` fields,
  `BloomVolume` state, Unity allocation/aliasing, and guest Vulkan attachment,
  layout, and submission evidence remain runtime-required.
- UnityPy reports 848 consumed bytes for the candidate's 852-byte
  `PlayerSettings` object. This is not treated as a missing field: both the
  game `libunity.so` and the matching Unity release player/symbols prove that
  `PlayerSettings::Transfer<GenerateTypeTreeTransfer>` and
  `PlayerSettings::Transfer<SafeBinaryRead>` return immediately after
  `androidVulkanAllowFilterList`. The four zero suffix bytes are retained and
  hashed as bytes outside the official Transfer boundary. Five relevant
  PlayerSettings fields are separately bound by object offset, raw bytes, and
  both game transfer xrefs. This exception is exact and sample-specific; a
  changed suffix, terminal member, member offset, return path, player body, or
  build ID fails closed.
- The three card-design UGUI producers are now relocated and hash-bound from
  the candidate ARM64 `libil2cpp.so`: `FontGroupConditions.GetFontGroup`,
  `CardDynamicUIView.Apply`, and `CardDynamicUIViewExtensions.Apply`.
  Il2CppDumper supplies addresses only; method bodies, field loads, branches,
  string comparisons, and `SetActive` dispatch are rechecked against the
  manifest-matched bytes. Their static control flow is exact, while live
  `CardData`, enumerable contents/order, GameObject names, and activation
  outcomes remain runtime-required.
- The Unity 6 TextCore SDFAA FontEngine producer is independently re-proved
  from the game `libunity.so` and matching release player/symbols. All nine
  native functions are exact: eight match a unique normalized full function
  body, while `RenderGlyphToTextureJob` is bound through the game's
  linker-inserted literal-load thunk and rejoin window. This closes the native
  producer identity only. Guest glyph request order, dynamic-atlas pixels and
  metrics, generated TMP mesh/descriptor state, and submitted draw bindings
  remain runtime-required.
- The candidate canonical corpus now contains nine scenes: the four baseline
  regressions plus the five-card exact set cover for changed/default-sensitive
  routes. The current TMP evidence is 9/9. Full-runtime schema v6 also rejects
  opaque-black MRT/display frames using RGB occupancy and energy, instead of
  treating nonzero alpha as visible output. The source-current local batch is
  9/9 valid and display evidence is 54/57; the remaining three units are the
  external emulator-host, guest Vulkan card-frame, and native-device display
  boundaries.
- The release player, symbols, release-support identity, and canonical corpus
  are resolved. The original APKM container remains unresolved because the
  immutable package input was delivered as raw split APKs; the split and nested
  native identities are resolved. The remaining execution boundary is an
  eligible guest/native ARM64 capture device.

This means the renderer architecture and most shader adaptations survive the
upgrade. It does not mean the migration is complete: Unity 6 guest
TMP output/UGUI/physical-RT/default submission, the nine-card official guest Vulkan
batch, Vulkan-to-WebGL backend semantic equivalence, and native-device display
transfer still need new proofs. Local runtime evidence must not be relabeled as
official guest evidence. The official guest batch remains 0/9; the BlueStacks
blocker does not satisfy any card in that denominator and contributes no
fidelity. No official shader or visual-fidelity percentage is available.
