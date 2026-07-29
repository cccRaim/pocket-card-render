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
6. Rebuild canonical scenes and text/TMP/UGUI/RT contracts, then collect a new
   official guest runtime-evidence batch.
7. Require `npm run audit:official-version-migration` and
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

This means the renderer architecture and most shader adaptations survive the
upgrade. It does not mean the migration is complete: the matching Unity Android
release player/symbols, complete candidate canonical corpus, Unity 6
TMP/UGUI/RT/default audits, and all guest runtime/display evidence still need
new proofs.
