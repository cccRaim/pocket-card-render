# Upgrading the Official Sample

Renderer implementation and official evidence are separate concerns. A Unity
or game update does not automatically invalidate the three.js architecture,
but it immediately invalidates the old APK, native RVA, ShaderProgram,
Material, serialized-asset, and runtime-capture evidence for the new version.

## Single Source Of Truth

- `build/official-samples/current.json` selects the active sample.
- `build/official-samples/<sample>.json` is an immutable version snapshot with
  game/Unity versions, binary hashes, asset counts, shader proof roots, and
  canonical scenes.
- `build/official-sample.mjs` is the shared Node loader and schema validator.
- Runtime source-set hashes include both the pointer and selected manifest, so
  switching versions automatically invalidates old captures.

Never overwrite an old manifest. Add a new `candidate` manifest, finish the
migration, change it to `baseline`, then update only `current.json`.

## Migration

1. Copy the current manifest to a candidate and fill in the new APK, Unity
   build, binary hashes, and initial inventories.
2. Run:

   ```bash
   npm run verify:official-sample-inputs -- \
     --manifest build/official-samples/<candidate>.json \
     --apkm <candidate.apkm>
   npm run audit:official-version-migration -- build/official-samples/<candidate>.json
   ```

   The first command verifies the APKM, splits, and nested native/Unity files
   byte-for-byte. The second report groups invalidation work into native package, Unity runtime,
   serialized assets, shader programs, runtime evidence, and documentation.
3. Re-extract APK/IL2CPP/metadata and relocate native producers. Old RVAs and
   signatures are locators only.
4. Rebuild the asset inventory, Material/program proof graph, and selector
   contract. Classify semantic executables as unchanged, changed, added, or
   removed.
5. Regenerate changed/added WebGL ports and run generator/verifier gates.
6. Rebuild canonical scenes and text/TMP/UGUI/RT contracts, then collect a new
   official guest runtime-evidence batch.
7. After `npm run audit:all` passes, promote the candidate and switch
   `current.json`, then run the full gate again.

Old exact claims remain valid only for their old sample. Shader names, matching
stage hashes, or visual similarity cannot preserve complete exact by
themselves. Screenshots remain terminal visual regression checks, not official
fidelity evidence.
