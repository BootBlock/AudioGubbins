# Phase 09 — Import, Export, and Codec System — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the phase branch at the commit the run names, after
the scope checks' fixes. The in-depth review lenses are deferred to the review
after the whole specification is implemented, as `reviews/phase-09-review.md`
records.

## Phase identifier and objective

- **Phase:** 09 — Import, Export, and Codec System.
- **Objective:** the extensible import, export and codec subsystem and a
  deterministic export pipeline: codecs registered and probed, a compressed
  file made an asset through a decoded rendition the codec worker makes once
  (`ADR-0090`); a local codec for every format where one is lawful and mature,
  in Rust where it can be, the browser's codecs only adding to them
  (`ADR-0091`); an export rendered canonically, encoded, staged and only then
  delivered under a collision policy (`ADR-0092`); and one metadata map, with
  its loops and the channel layout, read from and written to every format
  (`ADR-0093`).
- **User-visible outcome:** the person imports one file, many, or a folder,
  and sees each file's format, size, the storage it needs and its progress,
  and why any file was refused; a file's loops and cue points arrive as
  regions and markers they can undo; they export the asset in the editor, a
  region, every region or the selection, from the Export dialog, the File
  menu, a region's row or Quick Edit, with a preset or every setting, into a
  file, a folder or a trusted folder, and are asked before anything is
  overwritten unless they chose otherwise; and they find each export in the
  History and the Inspector, with its codec, version and whether its bytes
  are reproducible.

## Checklist

Every box in the packet's **In Scope** list:

- Codec registry and abstraction: `CodecDescriptor`, `CodecDirection` and
  `CodecCodes` (`packages/codecs/src/codec-descriptor.ts`), the registry
  (`codec-registry.ts`), `CodecCapability` and `codecCapability` over the
  probed `CodecEnvironment` (`codec-capability.ts`,
  `codec-in-environment.ts`), recognition and `importRoute`
  (`recognised-format.ts`, `import-route.ts`); the probes of WebAssembly,
  WebCodecs and the AAC encoder's bit rates
  (`packages/capabilities/src/codec-platform.ts`, `aac-bit-rate-probe.ts`).
- Import and export of the compressed formats: G.711 and IMA and Microsoft
  ADPCM read in place (`packages/codecs/src/g711.ts`, `ima-adpcm.ts`,
  `ms-adpcm.ts`, `adpcm-blocks.ts`); FLAC, MP3, Ogg Vorbis, Opus, AAC and
  HE-AAC, ALAC, Matroska and WebM decoded to a rendition
  (`packages/storage/src/decoded-import.ts`) by the codec module
  (`crates/codecs`, `crates/codec-bindings`: Symphonia with its AAC and
  Vorbis decoders patched under `third_party/`, and `ropus`) or, for HE-AAC,
  the browser's decoder fed by the module's demultiplexer
  (`packages/codec-runtime/src/decoding/`); export of WAV, AIFF, AIFF-C,
  FLAC (`flacenc` and the module's own encoder), MP3 and Ogg Vorbis (LAME
  3.100, libvorbis 1.3.7 and libogg 1.3.6 vendored under `third_party/`,
  built by `tools/build-encoder-modules.mjs` through `native/`), Opus in Ogg,
  and AAC in M4A by the browser's encoder where probed
  (`packages/codec-runtime/src/encoding/`, `openExportEncoder`), with the
  Ogg, FLAC, MP4 and MP3 framing in `packages/codecs`.
- WAV writing at every integer depth from 8 to 32 bits, float 32 and 64,
  G.711 and ADPCM, plain, extensible, RF64 and BW64, on Phase 07's writer
  (`packages/codecs/src/wav-file-writer.ts`, `wave-format-writing.ts`,
  `adpcm-encoding.ts`, `sample-quantisation.ts`); AIFF and AIFF-C at every
  integer depth, float, `alaw`, `ulaw`, `ima4` and `sowt`
  (`aiff-file-writer.ts`); FLAC at every depth from 4 to 32; each run stated
  once (`PCM_INTEGER_DEPTHS`, `FLAC_DEPTHS`).
- Multichannel layouts: speaker masks with 7.1 and 7.1.4, ambisonic layouts
  in `iXML`, `CHAN`, and each codec's channel order
  (`packages/codecs/src/layout-statement.ts`, `wave-layout-writing.ts`,
  `wave-layout-reading.ts`, `ixml-layout.ts`, `channel-layouts.ts`,
  `aiff-container.ts`; `crates/codecs/src/vorbis_order.rs`;
  `packages/codec-runtime/src/decoding/stream-layout.ts`).
- Metadata and loop metadata: `MetadataMap` (`metadata-map.ts`), read by
  `METADATA_READERS` and written by each format's writer (`riff-metadata*`,
  `aiff-metadata*`, `vorbis-comment.ts`, `loop-tags.ts`, `id3v2-*`,
  `ilst-metadata.ts`, `flac-metadata-*`, `flac-riff-blocks.ts`), one text
  rule and one set of limits (`metadata-text.ts`, `metadata-limits.ts`); a
  file's loops and cues placed as regions and markers
  (`packages/storage/src/import-placements.ts`).
- Import analysis, progress, cancellation and batch import: the codec worker
  (`packages/codec-runtime/src/worker/`, `threads/codec-worker.ts`),
  `SyncAudioBytes` (`packages/codecs/src/sync-audio-bytes.ts`,
  `packages/codec-runtime/src/files/`), the storage needed stated before
  storing (`ImportRoomNeeded`), staged progress and `ImportJob` over many
  files and folders (`packages/import-export/src/import-job.ts`;
  `packages/storage/src/import-batch.ts`, `import-analysis.ts`); the page's
  batches and list (`apps/web/src/state/import-batches.ts`,
  `apps/web/src/shell/import/`, `apps/web/src/commands/audio-import-commands.ts`).
- Export quality and expert controls: `ExportSettings`, `ExportPreset`,
  `BUILT_IN_PRESETS`, `resolvePreset`, the defaults and validation
  (`packages/import-export/src/export-settings.ts`, `export-presets.ts`,
  `default-settings.ts`, `settings-validation.ts`); the Export dialog with
  "Every setting" disclosed on request (`apps/web/src/shell/export/`,
  `apps/web/src/state/export-dialog-store.ts`); its openings from the File
  menu, a region's row, Quick Edit and a chord
  (`apps/web/src/commands/export-dialog-commands.ts`); the person's own
  presets in their preferences (`apps/web/src/state/preferences-store.ts`,
  `apps/web/src/shell/settings/export-presets.tsx`). The range "the
  project" is the asset in the editor, since no phase builds a multitrack
  mixdown.
- Collision policy: `CollisionPolicy`, `decideCollision`,
  `rememberCollisionAnswer` (`packages/import-export/src/collision-policy.ts`,
  `export-batch.ts`); trusted folders and their silent overwrite of an
  unchanged earlier export (`packages/browser-storage/src/trusted-folders.ts`,
  `packages/storage/src/export-collision.ts`, `export-delivery.ts`); the
  collision prompt (`apps/web/src/shell/export/collision-prompt.tsx`).
- Deterministic codecs: the dither key and generator
  (`packages/import-export/src/dither-key.ts`, `dither-noise.ts`,
  `quantiser.ts`), fixed encoder blocks and stream serials, and byte pins of
  every local encoding; a browser-encoded export recorded as not
  reproducible.
- Streaming and chunked I/O: the render worker's channel sink
  (`packages/audio-runtime/src/render/`), the stream messages
  (`packages/import-export/src/stream-messages.ts`), the storage worker's
  credited ports (`packages/storage-runtime/src/host/credited-stream-port.ts`),
  staging (`packages/storage/src/export-staging.ts`, `staging-paths.ts`) and
  delivery through `createWritable`
  (`packages/browser-storage/src/delivery-destinations.ts`).
- Export records in the history: `ExportRecord.file` with settings, name,
  size, SHA-256, codec, version and reproducibility
  (`packages/project-format/src/export-record-json.ts`,
  `exported-file-json.ts`), named by the History panel
  (`apps/web/src/shell/history/history-words.ts`) and described by the
  Inspector (`apps/web/src/shell/inspector/`).

Work units: WU-09.A to WU-09.D as the packet defines them.

## Inherited debt

| Debt | Fix |
| --- | --- |
| F-51 (Phase 02): a bundle whose disposable caches the storage cannot hold failed whole | `eb5555ee`: the import analysis weighs what a disposable part may cost; such caches are skipped and rebuilt, and the import says which (`packages/storage/src/import-claim.ts`). |
| F-192 and F-618 (Phase 01): the diagnostics path rules | `62ebed2f`: a path ends before a date or "and/or"; percent-encoded runs are decoded and redacted, layer by layer; `data :` is read as `data:` (`packages/diagnostics/src/path-finding.ts`, `slashed-prose.ts`, `percent-decoding.ts`). |
| The reference picture's sound extracted assuming at most eight channels (Phase 04) | `1ccc4e67` read its real channel count through the codec module first; `578b8fdb` and `e8c28ee2` then retired the bound: the sound is analysed and decoded by the codec worker into the storage's staging at its own rate and channels, and no channel count is assumed (`ADR-0050` amended). |
| Phase 07's WAV writer refused 7.1, 7.1.4 and ambisonic layouts | `74d7428b`: the writer states every domain layout (`ADR-0093`). |
| The packet named verification scripts that did not exist | `2f694400` adds `pnpm test:opus-conformance`; `b2f95a97` adds `pnpm test:codecs`; `0168a883` adds `pnpm test:roundtrip-audio`; `6e72ec86` adds `pnpm test:e2e:import-export`. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/codecs` | Extended from Phase 05's read contract: the registry, capability and recognition, the in-place G.711 and ADPCM readers, `SyncAudioBytes`, the streaming write contract and the WAV, RF64, BW64, AIFF and AIFF-C writers at every depth, the Ogg, FLAC, MP4 and MP3 stream writers, `MetadataMap` with each format's reader and writer, layouts. |
| `packages/import-export` | New and portable. Settings, presets, defaults and validation, dither and quantisation, layout conversion, file names, collisions, the import and export jobs and batch, the export plan, and the workers' stream messages. |
| `packages/codec-runtime` | New. The codec worker and its protocol, the typed codec module, the encoder modules' loader, every export encoder, the WebCodecs adapters, the AAC-LC fixtures. |
| `crates/codecs`, `crates/codec-bindings`, `crates/handle-table` | New. The codec module (Symphonia, `flacenc` and its own FLAC encoder, `ropus`, Matroska trimming, MP4 gapless reading) and its C ABI; the handle table shared with the DSP module. |
| `third_party/` | LAME 3.100, libvorbis 1.3.7 and libogg 1.3.6 vendored unmodified; Symphonia's AAC and Vorbis decoders vendored with their fixes. |
| `native/` | The MP3 and Vorbis encoder modules' interfaces. |
| `packages/capabilities` | The codec probes and the AAC encoder's bit-rate probe. |
| `packages/storage`, `packages/storage-runtime`, `packages/browser-storage` | Renditions, import analysis and batch import, session sounds, staging, start-up cleaning and eviction under the storage lock, delivery, folder and trusted-folder destinations, the credited stream ports and the protocol. |
| `packages/project-format`, `packages/project-commands`, `packages/history` | The rendition, metadata and source encoding in provenance, the export settings and records, `project.set-export-settings`, `projectDocument` 9, the state diff of export settings. |
| `packages/audio-runtime` | The render worker's channel sink, which sends rendered blocks to the codec worker under credit. |
| `packages/diagnostics` | The path rules (F-192, F-618). |
| `packages/version` | `projectDocument` 9, `userPreferences` 3. |
| `apps/web` | The page's codec services and bundled modules, the import and export commands, the import list, the Export dialog, the collision prompt, the export's run and progress, trusted folders, presets in Settings, the History and Inspector words, the reference picture's sound through the storage, and the default shortcuts. |
| `tools/`, `tests/` | The encoder modules' build; the architecture rules for the new packages and the browser's codecs; the import and export browser suite (`tests/e2e/import-export.spec.ts`, project `chromium-import-export`). |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| CodecDescriptor | `CodecDescriptor` in `@audiogubbins/codecs`: id, name, lossiness, `codes`, and a `read` and a `write` `CodecDirection` (implementation, containers, reproducibility, licence, rates, channels, bit-rate bands); `CODEC_REGISTRY`. |
| CodecCapability | `CodecCapability` and `codecCapability(codec, use, environment)` in `@audiogubbins/codecs`, available or unavailable with the reason and the alternatives. |
| ImportJob | `ImportJob`, `ImportEntry`, `ImportStage`, `ImportRoomNeeded`, `importJob`, `nextImportJob`, `cancelImport` in `@audiogubbins/import-export`. |
| ExportJob | `ExportJob`, `ExportJobState`, `ExportJobEvent`, `nextExportJob`, with `ExportBatch` and `nextExportBatch`, in `@audiogubbins/import-export`. |
| AudioFormatDescriptor | Phase 05's `AudioFormatDescriptor` in `@audiogubbins/codecs`, its container and encoding extended with the compressed containers and codes. |
| MetadataMap | `MetadataMap`, its loops, cues, markers, broadcast description and art, and `METADATA_READERS`, in `@audiogubbins/codecs`. |
| ExportSettings and ExportPreset | `ExportSettings`, its per-format encodings, `ExportPreset`, `BUILT_IN_PRESETS`, `resolvePreset`, `defaultExportSettings`, `validateExportSettings` in `@audiogubbins/import-export`. |
| CollisionPolicy | `CollisionPolicy`, `CollisionDecision`, `decideCollision`, `answerCollision`, `rememberCollisionAnswer` in `@audiogubbins/import-export`. |
| SyncAudioBytes | `SyncAudioBytes` in `@audiogubbins/codecs`, served by `@audiogubbins/codec-runtime`'s file reads. |
| The codec module's ABI | `crates/codec-bindings`, version 1 (`ag_codec_abi_version`), its one import `ag_codec_read`; typed by `CodecModule` and `DecoderSession` in `@audiogubbins/codec-runtime`. |

Beside them: `AudioFileWriter` and `EncodedStreamWriter`, `PCM_INTEGER_DEPTHS`
and `FLAC_DEPTHS`, `DecoderIdentity` and `CodecEnvironment` in
`@audiogubbins/codecs`; the codec worker's protocol and `openExportEncoder` in
`@audiogubbins/codec-runtime`; `readCodecPlatform`, `probeCodecs` and the AAC
probe in `@audiogubbins/capabilities`; the stream messages and their readers
in `@audiogubbins/import-export`; the storage's import, export and session
sound operations; the project format's rendition, metadata, export settings
and export record; and the raised `SCHEMA_VERSIONS` in
`@audiogubbins/version`.

## ADRs created and changed

`ADR-0090`, `ADR-0091`, `ADR-0092` and `ADR-0093` were written by the phase's
readiness review, in `14303aeb`, the phase branch's first commit, which also
amended `ADR-0022`, `ADR-0031`, `ADR-0052` and `ADR-0071`; this phase
implements them. The build amended these records, each by a dated line:

- `ADR-0090` — 2026-10-10 (`c9ff6a0a`): the registry's codes, capability,
  the rendition and its record, the codec worker and import analysis.
- `ADR-0091` — 2026-10-10 (`4491ef8e`, `c9ff6a0a`, `4912f74f`): `ropus` for
  Opus, FLAC at every depth, Matroska trimming; the ABI and the application's
  own codecs; LAME, libvorbis and libogg built from vendored source, and
  Symphonia's Vorbis decoder patched. 2026-10-12 (`9b82b68d`): Symphonia's
  AAC decoder patched for configurations 3 to 7.
- `ADR-0092` — 2026-10-10 (`c9ff6a0a`, `4912f74f`): the package constraint,
  settings, defaults, job, staging, naming, records and destinations; the
  encoders' bit-rate bands. 2026-10-12 (`9b82b68d`): `keepRiffChunks` and the
  AAC bit-rate probe. 2026-10-13 (`4b024aea`): every integer depth and a
  dither that follows the depth; the staging's held files under the storage
  lock.
- `ADR-0093` — 2026-10-10 (`c9ff6a0a`): reading, the mappings, loops and art
  on import, and layouts.
- `ADR-0050` — 2026-10-13 (`4b024aea`): the reference picture's sound is
  decoded by the codec worker into the staging, retiring Phase 04's bound.

The dependency cruise (`.dependency-cruiser.cjs`: `codecs-owns-nothing-else`,
`import-export-owns-nothing-else`, `codec-runtime-owns-nothing-else`) and
`tests/architecture/dependency-rules.test.ts` hold the package rules these
records state.

## Decisions taken beyond the ADRs

The build plan (`docs/todo/done/phase-09-import-export-and-codecs.md`, "Decisions
taken in the build", decisions 1 to 15) records what the ADRs left to the
implementation; the amendments above carry each into its record. Beyond
them:

1. The codecs' own G.711 and ADPCM need no WebAssembly, so they serve in every
   browser; the codec module and the encoder modules serve wherever
   WebAssembly runs, until their load fails, which makes their formats
   unavailable with the redacted reason.
2. The codec module and both encoder modules reach the page as bundled
   modules built by the Vite plugin, never fetched.
3. An export renders through the playback render host at maximum quality,
   from the edited description; the room for the whole batch is checked
   before rendering.
4. The Inspector describes an export only when asked, by `export.inspect` or
   `export.inspect-record`, and gives way when an editor is brought into use
   or recording claims it.
5. Importing audio files defaults to Ctrl+K, Ctrl+I and exporting to Ctrl+K,
   Ctrl+E (Command on Apple).
6. The schema versions below.

## Tests

Test declarations added per package, counted from the diff of every
`*.test.ts`, `*.test.tsx` and `*.spec.ts` file from `main` (an `it.each`
counts once; a declaration renamed or generalised counts as one removed and
one added):

| Package | New test files | Changed test files | Declarations added | Removed |
| --- | --- | --- | --- | --- |
| `packages/codecs` | 27 | 2 | 238 | 2 |
| `apps/web` | 22 | 19 | 161 | 12 |
| `packages/import-export` | 13 | 0 | 123 | 0 |
| `packages/codec-runtime` | 19 | 0 | 100 | 0 |
| `packages/storage` | 7 | 4 | 47 | 0 |
| `packages/capabilities` | 2 | 0 | 17 | 0 |
| `packages/project-format` | 2 | 5 | 15 | 0 |
| `packages/diagnostics` | 1 | 1 | 14 | 0 |
| `packages/storage-runtime` | 4 | 2 | 14 | 0 |
| `packages/browser-storage` | 2 | 1 | 7 | 0 |
| `packages/audio-runtime` | 1 | 4 | 6 | 0 |
| `packages/project-commands` | 1 | 2 | 5 | 0 |
| `packages/domain`, `packages/history`, `packages/media-store` | 0 | 3 | 3 | 0 |
| `tests/architecture` | 0 | 6 | 6 | 0 |
| `tests/encoder-module-build.test.ts`, `tests/third-party-notices.test.ts`, `tests/evidence-commands.test.ts` | 2 | 2 | 12 | 0 |
| `tests/e2e` | 1 | 2 | 3 | 0 |
| **Total** | **104** | **53** | **771** | **14** |

Of the fourteen removed, four are renamed or generalised (two in the
malformed-media suite, the picture's sound tests in
`apps/web/src/commands/editor-commands.test.ts` rewritten for the storage
path), and ten went with the code they tested: the page's whole-file read and
memory weighing of a picture's sound, retired with Phase 04's bound
(`apps/web/src/picture/sound-bound.test.ts`, deleted, and
`reference-picture.test.ts`). `crates/codecs` and `crates/codec-bindings` add
the Rust tests `cargo test --workspace` runs (203 across the workspace).

| Area | Where |
| --- | --- |
| Registry, capability and recognition | `packages/codecs/src/codec-registry.test.ts`, `codec-in-environment.test.ts`, `import-route.test.ts`, `recognised-format.test.ts`; `packages/capabilities/src/codec-platform.test.ts`, `aac-bit-rate-probe.test.ts` |
| In-place codecs and fixtures | `packages/codecs/src/g711.test.ts`, `codec-fixtures.test.ts`, `compressed-codec-fixtures.test.ts`, `flac-fixtures.test.ts`, `mp3-fixtures.test.ts`, `mp4-fixtures.test.ts`, `ogg-fixtures.test.ts`, `ogg-flac-fixtures.test.ts`, `vorbis-comment-fixtures.test.ts` |
| Writers and layouts | `packages/codecs/src/wav-writer.test.ts`, `wav-matrix.test.ts`, `aiff-writer.test.ts`, `layout-statement.test.ts`, `sample-quantisation.test.ts`, `ogg-vorbis-writer.test.ts` |
| Metadata | `packages/codecs/src/riff-metadata.test.ts`, `aiff-metadata.test.ts`, `metadata-text.test.ts`, `metadata-map-reading.test.ts` |
| Malformed media | `packages/codecs/src/malformed-media.test.ts`, `compressed-container-malformed-media.test.ts`, `in-place-codec-malformed-media.test.ts`, `metadata-malformed-media.test.ts`; `crates/codecs/tests/malformed.rs`, `crafted_streams.rs` |
| The codec module | `crates/codecs/tests/*.rs`; `packages/codec-runtime/src/codec-module.test.ts`, `decoder-session.test.ts`, `opus-encoder.test.ts`, `decoding/*.test.ts`; `tests/opus-conformance/` |
| The codec worker | `packages/codec-runtime/src/worker/codec-worker-analyse.test.ts`, `codec-worker-decode.test.ts`, `codec-worker-protocol.test.ts`, `codec-worker-long-files.test.ts`; `files/file-bytes.test.ts` |
| Export encoders and round trips | `packages/codec-runtime/src/encoding/export-roundtrip-lossless.test.ts`, `export-roundtrip-lossy.test.ts`, `export-roundtrip-aac.test.ts`, `export-roundtrip-metadata.test.ts`, `open-export-encoder.test.ts`, `encoder-modules.test.ts`; `tests/encoder-module-build.test.ts` |
| Settings, presets, dither, names, collisions, jobs | `packages/import-export/src/*.test.ts` |
| Storage | `packages/storage/src/decoded-import.test.ts`, `audio-import.test.ts`, `import-batch.test.ts`, `export-delivery.test.ts`, `session-sounds.test.ts`, `cache-eviction.test.ts`, `start-up-cleaning.test.ts`, `long-files.test.ts`, `storage-cleanup.quota.test.ts`, `bundle-import.quota.test.ts`; `packages/storage-runtime/src/client/*.test.ts`, `host/credited-stream-port.test.ts`, `host/storage-host.staging.test.ts`; `packages/browser-storage/src/*.test.ts` |
| Persisted form | `packages/project-format/src/decoded-rendition-json.test.ts`, `export-record-json.test.ts`, `export-settings-json.test.ts`, `project-json.test.ts`, `history-stripping.test.ts`; `packages/project-commands/src/export-settings-commands.test.ts`, `source-commands.test.ts` |
| The render channel | `packages/audio-runtime/src/render/channel-sink.test.ts`, `render-worker-core.test.ts`, `render-host.test.ts` |
| Diagnostics | `packages/diagnostics/src/redaction.test.ts`, `percent-decoding.test.ts` |
| Application | `apps/web/src/commands/audio-import-commands.test.ts`, `export-commands.test.ts`, `export-dialog-commands.test.ts`, `quick-edit-commands.test.ts`, `editor-commands.test.ts`, `shell-commands.test.ts`; `apps/web/src/export/*.test.ts`; `apps/web/src/codecs/*.test.ts`; `apps/web/src/shell/export/*.test.tsx`, `import/import-list.test.tsx`, `inspector/*.test.*`, `history/history-words.test.ts`, `command-palette.test.tsx`, `menus.test.ts`, `asset-browser.test.tsx`, `project-banner.test.tsx`; `apps/web/src/state/*.test.ts` |
| Layering, exports and scopes | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/import-export.spec.ts` |

## Commands used for verification

```
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:codecs                 # vitest run --project codecs --project import-export --project codec-runtime
cargo test --workspace
pnpm run test:codec-fixtures         # vitest run --project codecs fixture
pnpm run test:roundtrip-audio        # vitest run --project codec-runtime export-roundtrip
pnpm run test:malformed-media        # vitest run --project codecs malformed
pnpm run test:opus-conformance       # vitest run --project opus-conformance
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:architecture           # pnpm run test:dependencies, vitest run --project architecture
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run test:e2e:import-export      # playwright test --project=chromium-import-export
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit`, at `5d4f274d` | Passed, exit 0: lint (the version, graph and notices checks, ESLint and Prettier), both type checks, 838 test files and 12,723 tests, the record check (every one of 2,134 cited titles a test's title), and no dependency violations (2,900 modules, 17,367 dependencies). |
| `pnpm run verify:commit`, at `ec6945cf` | Failed in the test step alone, under the whole suite's load: 12,720 of 12,723 tests passed, and three timing tests outside this phase timed out (`processor-cost`, `project-session.quota`, `history-segments`); each passed when run again alone. |
| `pnpm run test:codecs`, at `35f924f9` | 62 files, 997 tests passed. |
| `cargo test --workspace`, at `35f924f9` | 203 tests passed in 14 test binaries. |
| `pnpm run test:codec-fixtures` | 8 files, 241 tests passed. |
| `pnpm run test:roundtrip-audio` | 4 files, 41 tests passed. |
| `pnpm run test:malformed-media` | 4 files, 134 tests passed. |
| `pnpm run test:opus-conformance` | 1 file, 24 tests passed: the RFC 8251 vector set, fetched on demand and checked against its hash. |
| `pnpm run test:project-roundtrip` | 9 files, 325 tests passed. |
| `pnpm run test:architecture` | No dependency violations (2,900 modules, 17,367 dependencies); 10 files, 349 tests passed. |
| `pnpm run build`, at `ec6945cf` | Exit 0; the build check passed (43 files). |
| `pnpm run spec:verify` | PASS, all four checks, on the closing commit. |

## Browser and device results

Each browser test ran through Playwright against a production build the
preview server serves.

- `pnpm run test:e2e:import-export`, at `35f924f9`: 2 passed (25.0 s). The
  first test imports a FLAC file, then a folder whose text file is refused
  with its reason, exports a region from its row into a folder that already
  holds a file of its name, answers "Keep both", reloads, and finds the
  export in the History with its encoder and "the same bytes on every
  machine". The second asks the browser's encoder directly which stereo
  AAC-LC bit rates it takes, requires the Format list to name AAC as it
  answered, and, in bundled Chromium, which encodes it, exports AAC, reads it
  back through the codec module and the page, and finds the source's frames
  at the source's length. At `ec6945cf` the first test failed (B-17 in the
  review record): it chose the bit depth from a list the typed field had
  replaced; `35f924f9` fixes the test.
- No import or export test runs in Firefox or WebKit (Known limitations).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Supported lossless formats round-trip within expected bit/sample semantics. | `export-roundtrip-lossless.test.ts` ("give back integer samples bit for bit, as the quantiser made them", "gives back floating-point samples bit for bit", "writes a 32-bit integer export exactly, every sample the integer its dither chose", "give back every depth bit for bit, in FLAC’s own channel order"); `wav-writer.test.ts` and `aiff-writer.test.ts`, every integer depth ("writes 20 bits left-justified in whole bytes, stating its valid bits, and reads back exactly"); `crates/codecs/tests/flac_every_depth.rs`, `flac_round_trip.rs`. `pnpm run test:roundtrip-audio`. |
| WAV matrix covers required bit depths, float/integer, sample rates, mono/stereo/N-channel and loop metadata. | `wav-matrix.test.ts` ("reads back at every rate and channel count as the format says it must", for each sample format, 8 kHz to 384 kHz in 1 to 24 channels); `wav-writer.test.ts` (every depth from 8 to 32 bits, "states 7.1.4 so the reader gives it back", "states third-order ACN N3D so the reader gives it back"); `riff-metadata.test.ts` ("reads back every field and loop it wrote, dropping nothing"); `export-roundtrip-metadata.test.ts` ("WAV holds what it can, and reports exactly what it dropped"). |
| Import/export does not require loading entire long files into duplicated memory. | `codec-worker-long-files.test.ts` ("analyses an RF64 file past four gibibytes from its head and the chunk after its data, reading none of the data", "decodes a long 5.1 FLAC file in blocks within the caps, reading it about once, never past credit", "encodes a render past four gibibytes to RF64 a block at a time, the credit of both channels bounding what is between them"); `long-files.test.ts` ("writes a 5.1 rendition a block at a time and stores it in reads and writes of at most a block", "stages an export past four gibibytes a body at a time, reads it back once for its hash and once to deliver it, a chunk at a time"); `credited-stream-port.test.ts` ("holds what has crossed and is not yet read to its window of credit, however slowly it reads"); `file-bytes.test.ts` ("reads a chosen file a slice at a time, short only at its end"). |
| Preset and expert settings resolve to the same typed export settings model. | `export-presets.test.ts` ("equal the expert settings once the same edits are made to either"); `export-dialog-store.test.ts` ("resolves Master, WAV 24-bit and the same values set in the expert controls to the same record"). |
| Collision policies are deterministic and safe by default. | `collision-policy.test.ts` ("asks by default, and never overwrites without being told to", "renames to the first free copy number, in order, the same for the same listing", "overwrites, without asking, a file it exported there and that is unchanged since"); `export-batch.test.ts` ("remembers an answer only when the person applies it to the rest"); `export-delivery.test.ts` ("overwrites silently in a trusted folder a file it exported there unchanged, and asks about one changed since"); the browser's "Keep both". |
| Every local export gives the same bytes for the same project and settings on every machine. | "gives the same bytes for the same blocks and settings, however they are blocked" in `export-roundtrip-lossless.test.ts` and `export-roundtrip-lossy.test.ts`, which pin the SHA-256 of every local encoding: WAV at 24, 20 and 12 bits and in Microsoft ADPCM, AIFF at 16 and 20, AIFF-C float and `ima4`, FLAC at 12, 13, 16, 20, 24 and 32 bits, three MP3, two Ogg Vorbis and Opus; G.711 is held to the ITU's encoder for every 16-bit sample (`g711.test.ts`) and WAV IMA ADPCM to the reference encoder's bytes (`wav-matrix.test.ts`); `quantiser.test.ts` ("gives the same bits whatever blocks the audio arrives in"; "is the settings', whatever order their keys were written in, and changes with the seed"); `codec-registry.test.ts` ("marks only a browser’s codec as giving different bytes on different machines"). |
| A format no implementation serves in a browser is refused before anything is stored or rendered, naming the formats that can be used. | `export-control.test.ts` ("refuses a codec this browser cannot write with before anything renders, naming what serves instead"); `codec-registry.test.ts` ("refuses every format of a codec module that failed to load, and only those"); `codec-worker-analyse.test.ts`; `session-sounds.test.ts` ("refuses a file the codecs here cannot decode with the reason an import gives, decoding nothing"); the browser's AAC test. |

Failure and recovery behaviour:

| Behaviour | Evidence |
| --- | --- |
| Malformed media fails without corrupting project state. | `malformed-media.test.ts` ("answers every one of four hundred mutations with a result and never throws"), the compressed, in-place and metadata malformed suites, `crates/codecs/tests/malformed.rs`; `audio-import-commands.test.ts` ("refuses a file that is not audio it can read, naming it, and leaves the project as it was"). |
| A partial export is not reported as successful. | `export-job.test.ts` ("refuses a render finishing short", "refuses a delivery finished short"); `export-delivery.test.ts`. |
| Permission loss or collision keeps the project and offers retry or a new destination. | `export-delivery.test.ts` ("refuses a destination it may not write, or one that refuses the file, keeping the export staged"); `export-control.test.ts` ("keeps a file whose delivery lost its leave to write, and retries it with no new render", "delivers a held file to another destination with no new render"). |
| A decode that fails part way, or a cancelled import, keeps nothing. | `decoded-import.test.ts` ("keeps nothing of a decode that fails part way", "keeps nothing when cancelled while it decodes, and tells the codec worker", "keeps nothing of a stream that stops before its end"); `audio-import-commands.test.ts` ("keeps nothing of an import the person cancels"). |
| A staged export survives a refused delivery; staging is removed after delivery and at start. | `export-job.test.ts` ("returns to staged with the reason when a delivery is refused, and delivers again without rendering"); `export-delivery.test.ts` ("writes head, body and tail into a folder, records the export, and gives the staging up"); `storage-host.staging.test.ts` ("removes everything staged, and nothing else, where no window holds the storage lock"); `start-up-cleaning.test.ts`; `cache-eviction.test.ts`. |
| A codec module or encoder that fails to load makes its formats unavailable with the reason, and leaves the rest working. | `codec-thread.test.ts` ("make the formats of a module they could not compile or load unavailable, with the reason, and keep the rest"); `codec-worker-analyse.test.ts` ("says why the module failed, redacted, where the page could not load it"); `codec-registry.test.ts`. |

## Known limitations

- Godot-specific live export, batch variation generation and cloud encoding
  are out of scope (packet); persistent export recipes are Phase 11's.
- There is no local AAC encoder and no local HE-AAC decoder (`ADR-0091`).
  Chromium's AAC encoder on Windows takes only 96, 128, 160 and 192 kbit/s,
  for one, two and six channels at 44.1 and 48 kHz, and nothing for three,
  four, five or eight channels; the probe finds this, so such a stream is
  refused before rendering, naming what the encoder takes, and the built-in
  AAC 256 kbit/s preset is reported as not exportable there.
- No phase builds a multitrack mixdown, so the export range "the project" is
  the asset in the editor.
- The default dither is triangular for an integer depth of 16 bits or fewer
  and none above, 20 bits among them (`ADR-0092`); a person sets it at any
  depth.
- Ogg Vorbis is written in at most eight channels, MP3 in one or two, and MP4
  holds only AAC-LC with a stated channel configuration; WebM and Matroska
  carry no metadata mapping (`ADR-0092`, `ADR-0093`).
- A browser that keeps no storage cannot open a reference picture's sound,
  and says why (`ADR-0050` amended).
- The import and export browser suite runs in Chromium only.
- Tests that fail now and then under the whole suite's load and pass when run
  again: `processor-cost`, `project-session.quota` and `history-segments`, at
  their time limits.
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-09-review.md`).

## Dependencies added, and their review

- Rust, pinned exactly and noticed in `THIRD-PARTY-NOTICES.md`: Symphonia
  0.6.1 (MPL-2.0, used unmodified but for its AAC and Vorbis decoders,
  vendored under `third_party/` with their fixes and marked modified),
  `flacenc` 0.5.1 (Apache-2.0) and `ropus` 0.12.18 (BSD-3-Clause), chosen by
  `ADR-0091`; MPL-2.0 is allowed by `ADR-0091`.
- C, vendored unmodified from their release archives, each archive's SHA-256
  in its folder's README, and built here: LAME 3.100 (LGPL-2.0, its folder the
  corresponding source, the module a separate replaceable file), libvorbis
  1.3.7 and libogg 1.3.6 (BSD-3-Clause).
- Build tool: Zig 0.17.0, fetched once by version and SHA-256 into
  `target/toolchains`, shipping nothing but the runtime libraries the
  notices quote.
- No npm dependency from outside the repository: `pnpm-lock.yaml` gains only
  workspace links; the earlier prebuilt `wasm-media-encoders` was dropped
  (`440e032a`).

## Migration and schema impact

`version.json` raises `projectDocument` to version 9 (a compressed source's
rendition and metadata in its provenance, the source encoding per kind, the
project's last export settings and an export record's file) and
`userPreferences` to version 3 (the person's own export presets). Trusted
folders and their records are kept in the browser's handle database, not in
the preferences. The storage gains the cache category `staging`, given up
after `temporary`, and `projectStorage` is unchanged. The codec module's ABI
and the encoder modules' interface start at version 1; the DSP ABI is
unchanged. Before 1.0 nothing migrates (`REQ-STOR-052`): a document or
preferences of another version are refused with the reason, and the
preferences start from their defaults (B-10 in the review record).

## Screenshots and recordings

None kept in the tree. The import and export flows are checked through the
page by `tests/e2e/import-export.spec.ts`, whose run is recorded above.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-AUDIO-010` Format Support | Recognition from bytes and the registry; WAV, AIFF, FLAC, MP3, Ogg Vorbis, Opus and AAC/M4A import, with the compressed encodings WAV and AIFF-C carry; export of every one of them, AAC by the browser where probed; WAV at every integer depth, float, G.711 and ADPCM, plain, extensible, RF64 and BW64; multichannel layouts, channel conversion, metadata and loop metadata; capability detection with local fallbacks. | `codec-registry.test.ts`, `import-route.test.ts`, the fixture and malformed suites, `wav-matrix.test.ts`, `wav-writer.test.ts`, `aiff-writer.test.ts`, the four `export-roundtrip-*.test.ts`, `aac-lc-fixtures.test.ts`, `codec-worker-decode.test.ts`, `decoded-import.test.ts`, `import-export.spec.ts`; `cargo test --workspace`; `pnpm run test:opus-conformance`. |
| `REQ-AUDIO-050` Presets and Advanced Codec Controls | Presets resolved over the full typed settings; the Export dialog's progressive disclosure of every setting; the person's own presets; validation before rendering. | `export-presets.test.ts`, `settings-validation.test.ts`, `export-dialog-store.test.ts`, `export-dialog.test.tsx`, `export-presets.test.tsx`, `preferences-store.test.ts`. |
| `REQ-ARCH-054` Export Collision Policy | Ask by default, overwrite, skip or rename, apply to all, trusted folders overwriting only an unchanged earlier export, decided by the destination's listing at delivery. | `collision-policy.test.ts`, `export-batch.test.ts`, `export-delivery.test.ts`, `collision-prompt.test.tsx`, `trusted-folders.test.ts`, `import-export.spec.ts`. |

The requirements this phase consumes are met as the packet names them:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-ARCH-004` | A source file is never changed; a rendition is derived media. | `decoded-import.test.ts`, `source-commands.test.ts`. |
| `REQ-ARCH-011` | Export precision is set apart from the working precision. | `settings-validation.test.ts`, `export-plan.test.ts`. |
| `REQ-ARCH-049`, `REQ-ARCH-081` | Local exports are the same bytes everywhere; a browser-encoded export is marked not reproducible. | The byte pins, `quantiser.test.ts`, `codec-registry.test.ts`, `history-words.test.ts`. |
| `REQ-ARCH-085` | Decoding never resamples. | `codec-worker-decode.test.ts`, `decoded-import.test.ts`, `reference-picture.test.ts`. |
| `REQ-ARCH-141` | The codec module is Rust behind a narrow ABI. | `crates/codec-bindings`, `codec-module.test.ts`, `tests/architecture/wasm-module-features.test.ts`. |
| `REQ-ARCH-153` | Import and export jobs are explicit state machines. | `import-job.test.ts`, `export-job.test.ts`, `export-batch.test.ts`. |
| `REQ-ARCH-157` | Layouts are read, kept, converted and written. | `wav-writer.test.ts`, `layout-statement.test.ts`, `aac-lc-fixtures.test.ts`, `vorbis-multichannel.test.ts`, `export-plan.test.ts`. |
| `REQ-AUDIO-143` | Export defaults to the highest-quality path. | `export-presets.test.ts`, `export-control.test.ts`. |
| `REQ-AUDIO-145` | The export record names the codec and its version. | `export-record-json.test.ts`, `history-words.test.ts`, `encoder-identity.test.ts`, `decoder-identity.test.ts`. |
| `REQ-AUDIO-220` | Phase 05's read contract, extended, not duplicated. | `import-route.test.ts`, `codec-fixtures.test.ts`. |
| `REQ-EDIT-008`, `REQ-EDIT-014`, `REQ-EDIT-015` | Quick Edit's, per-region and batch export, loops written, no stereo assumed. | `project-banner.test.tsx`, `asset-browser.test.tsx`, `export-dialog-commands.test.ts`, `export-roundtrip-metadata.test.ts`. |
| `REQ-EDIT-072` | The Inspector describes an asset's source and an export. | `source-words.test.ts`, `export-description.test.tsx`, `export-facts.test.ts`, `inspector-panel.test.tsx`. |
| `REQ-EDIT-073` | Every import, export and collision answer is a command. | `export-commands.test.ts`, `audio-import-commands.test.ts`, `collision-prompt.test.tsx`. |
| `REQ-STOR-025`, `REQ-STOR-099`, `REQ-STOR-104` | Copy or link, renditions in the content store, the source's identity. | `decoded-import.test.ts`, `audio-import.test.ts`, `source-commands.test.ts`. |
| `REQ-STOR-052` | The raised versions are refused, never migrated. | `project-json.test.ts`, `preferences-store.test.ts`. |
| `REQ-STOR-106` | Staging is a cache category, given up only when nothing uses it. | `storage-cleanup.quota.test.ts`, `cache-eviction.test.ts`, `start-up-cleaning.test.ts`. |
| `REQ-STOR-166` | The source's codec, metadata and decoder in provenance; metadata stripped or minimised on export. | `decoded-rendition-json.test.ts`, `history-stripping.test.ts`, `export-metadata.test.ts`. |
| `REQ-STOR-197`, `REQ-STOR-198` | Exports are history records, never undone. | `export-record-json.test.ts`, `export-delivery.test.ts`, `history-words.test.ts`, `import-export.spec.ts`. |
| `REQ-GAME-121` | Loop metadata survives export. | `export-roundtrip-metadata.test.ts`, `riff-metadata.test.ts`. |
| `REQ-GODOT-046`, `REQ-GODOT-133` | The download fallback and ordinary files. | `delivery-destinations.test.ts`, `export-control.test.ts`. |
| `REQ-REPO-033`, `REQ-REPO-142` | Every codec's licence reviewed and noticed. | `tests/third-party-notices.test.ts`, `encoder-modules.test.ts`. |
| `REQ-UX-005` | Every import and export action has a keyboard form. | `command-palette.test.tsx`, `menus.test.ts`, `export-dialog.test.tsx`, `collision-prompt.test.tsx`. |

## Commits

Oldest first, on `phase-09-codecs`, from `main` at `1c357d0e`; a merge lists
its slice's commits beneath it, and `7bf61115` merges Phase 08 from `main`:

- `14303aeb` Make Phase 09 READY, with its readiness decisions
- `4399b932` Add the Phase 09 codec contracts and its resume note
- `5892a2d6` Add the one integer quantisation rule the writers and the dither share
- `74d7428b` Merge slice s1: the codec registry, in-place G.711 and ADPCM, WAV and AIFF writers, metadata and layouts
  - `8e3f6e07` Read G.711 and ADPCM in place, and route every import by the codec registry
  - `1b2e87d8` Read and write WAV and AIFF metadata through the one metadata map
  - `05102513` Write WAV, AIFF and AIFF-C through the streaming write contract, with every layout
  - `ca796690` Wrap the codec comments at the width the tree writes comments at
- `59d7361f` Record slice s1's build decisions in the Phase 09 resume note
- `2f694400` Merge slice s2: the Rust codec module, its ABI and the codec runtime's typed module
  - `ae2a82f9` Add the codec module's crate: Symphonia decoding, conformant Opus, FLAC frames
  - `d069bb60` Hold the codec tests to what they guard: half SBR, a mono layout, a signed gain
  - `5f21019d` Hold the session's length check to a stream that ends cleanly short
  - `a4f0a290` Share the handle table between the two WebAssembly boundaries
  - `1a3a4a33` Add the codec module's C ABI, audiogubbins-codec-bindings
  - `8f5dd25b` Add @audiogubbins/codec-runtime, the codec module's typed host, and build the module
  - `0ff62234` Notice the crates of both WebAssembly modules, and allow MPL-2.0 as ADR-0091 decided
  - `6d1f9514` Add pnpm test:opus-conformance: the RFC 6716 and RFC 8251 vectors against the module
  - `7239bb94` Wrap the new comments at the width comments are written at
- `4491ef8e` Record the codec module's facts in ADR-0091 and the resume note
- `62ebed2f` Merge slice s5: the diagnostics path rules owed from Phase 01 (F-192, F-618)
  - `87eec3f3` End a path before a date or "and/or" that follows it
  - `9253e60b` Read percent-encoded text and a spaced data: as the rules read plain text
  - `d3b2f073` Hold the slashed-word path rule to a cost in proportion to the line
  - `b1ee2195` Say in the path rule that a slashed word between two paths goes with them
  - `d8e570a1` Split the slashed words and the encoding layers along their seams
- `d59b7689` Merge slice s4: the import-export package, its settings, presets, dither, names, collisions and jobs
  - `f97a22ea` Name the layouts each fixed named matrix converts between
  - `d1c52dae` Add the portable import and export package
  - `0af941f2` Count only the batch frames still to give a file
- `04e52c65` Record slices s4 and s5's build decisions in the resume note
- `ac41d6fb` Add the channel messages between the codec worker and the storage worker
- `b0817d60` List as offered only the codec contracts no package uses yet
- `4ff8c2e9` Merge slice s3: Ogg, FLAC, MP4 and MP3 framing and their metadata, one copy of each shared rule
  - `cdcffe15` Add Ogg framing, Opus-in-Ogg and Vorbis comments to the codecs
  - `b79f23a6` Add the FLAC stream writer and the FLAC metadata reader
  - `d3807b55` Add the M4A writer for AAC and the MP4 ilst metadata reader
  - `004b8a70` Add the MP3 stream writer, ID3v2.4 tags and the ID3 metadata reader
  - `14d3047f` Offer the compressed framers and metadata readers, split at their seams
  - `9db63e8c` Write the compressed codecs' comments at the width the tree keeps
  - `c720bde6` Give the codecs one text rule, one set of metadata limits and one sampler chunk code
  - `af6bbad8` Name the UTF-8 sequence a lead byte begins
  - `82254991` Reach the Ogg, FLAC, MP4 and ID3 metadata readers through METADATA_READERS
- `8414f2b9` Record slice s3's build decisions in the resume note
- `7dbcb736` Merge slice s2b: FLAC frames of every depth, and Matroska audio trimmed to its stated length
  - `5ff6ac18` Read EBML sizes of eight bytes without overflowing a shift
  - `9cbbe5a2` Encode FLAC frames of every depth, 32 bits among them
  - `7bab2a40` Trim Matroska and WebM audio to the length the file states
  - `77d0a4da` Hold Opus's CodecDelay apart from its pre-skip in a test
  - `43125127` Record the FLAC frame settings' widened depth
- `9c9912a0` Record slice s2b's build decisions in the resume note
- `79548705` Format the dependency rules as the merged slices left them
- `214dbe2d` Wrap the codecs' and import-export's file comments at the width the tree keeps
- `091b2ba4` Merge slice s6a: the codec worker, its protocol, decoding and the codec probes
  - `2904c687` Probe the browser's codecs and WebAssembly in capabilities
  - `657eedf5` Read the metadata of Ogg FLAC streams
  - `c70e554f` Read the workers' stream messages field by field
  - `61dbd9e0` Read an ADTS stream's AudioSpecificConfig from its first header
  - `74a3a729` Add the codec worker: analysis, decoding to the storage worker, and encoding
  - `edb8e9c4` Test HE-AAC through a stand-in browser decoder, and the worker's decode stream end to end
  - `6709531a` Test the codec worker's analysis, file reads, decoder names and protocol
  - `b2f95a97` Register the codec worker's dependencies, scope and exports, and add test:codecs
  - `fba20721` Hold every comment to the width comments are written at
- `9bb9e6f4` Record slice s6a's build decisions in the resume note
- `217a807a` Merge slice s6b: every export encoder behind the codec worker, and the render channel
  - `8d502865` Let a writer take 64-bit planes, so a dithered 32-bit integer is exact
  - `6a00e29d` Read an Opus identification header back into its settings
  - `49e0d142` Refuse a layout the format cannot state before an export renders
  - `9a0e64eb` Let the codec runtime depend on import-export and wasm-media-encoders
  - `777bb976` Encode every export format behind one factory the codec worker calls
  - `a12bf406` Send a render sink's blocks straight to another worker over a port
  - `790959e9` Feed an export's encoder the blocks a rendered-block channel brings
  - `0168a883` Run the export round trips and hashes with pnpm test:roundtrip-audio
  - `41b4d799` Name the libraries in the prebuilt encoders and where their source is
  - `0549a4f9` Hold the new exports to the architecture rules
  - `8102455c` Format the dependency rule the codec runtime's edges changed
  - `2a7c2326` Read a prebuilt library's fields as a record the checker can type
  - `a50c9bbc` Round-trip 32-bit FLAC exports now the module encodes them
  - `4d03b46a` Wrap the encoders' and the channel's comments at the width the tree keeps
- `4d211239` Record slice s6b's build decisions and open items in the resume note
- `eb5555ee` Merge slice s7: renditions, import analysis, batch import, export staging and delivery, trusted folders and F-51
  - `21694890` Record compressed sources, file metadata and export settings in a project
  - `4e046a6f` Import compressed files as decoded renditions, and many files as one job
  - `4868d506` Stage exports and deliver them under the collision policy
  - `48df83f6` Serve exports to the page, with folder destinations and trusted folders
  - `4f78417c` Keep the new modules within the cohesion limits and the export record
  - `3279f942` Wrap the slice's comments at the width the tree writes them at
  - `82a3609f` Keep the rendition's record in the project state, out of a type cycle
- `dd63c1d8` Record slice s7's decisions and what is left of Phase 09 in the resume note
- `7f0718d1` Merge slice spec: Phase 09's build decisions recorded in ADR-0090 to ADR-0093 and the packet
  - `c9ff6a0a` Record Phase 09's build decisions in ADR-0090 to ADR-0093 and the packet
- `d6869161` Merge slice s8c: the application's codec and export contracts, ahead of their implementations
  - `79e3d644` Let the application depend on the codecs, the codec runtime and import-export
  - `156a4646` Fix the page's codec and export contracts ahead of their implementations
  - `bb14b3b2` Wrap the export types' module comment to the full width
  - `47177421` Declare the file import command by the identity and label kept once
- `4f1e87ec` Merge slice s6c: LAME and libvorbis built from vendored source with their full API
  - `fd9f5776` Build LAME and libvorbis to WebAssembly from vendored source
  - `440e032a` Give the vendored encoder libraries their notices, and drop the prebuilt package
  - `b32b0a95` Frame Vorbis packets in the application's Ogg writer, and state encoder bit rates
  - `ac3b7866` Refuse before rendering the bit rates the MP3 and Vorbis encoders would not keep
  - `e773b86c` Drive the MP3 and Vorbis encoder modules built from source
  - `1128bf2f` Download the pinned Zig through the tools' one way to the network
  - `eaf67605` Hold the encoder work to the comment width and the export rules
- `1ccc4e67` Merge slice s8a: the page's codec services, the bundled codec and encoder modules, and the reference picture's real channel count
  - `f2a2068c` Name the encoder of each export, and fail absent modules at once
  - `fa88f6a6` Start the codec worker on the page, and weigh a picture's sound by its channels
  - `6ce5d40e` Hold the codec worker to the page's security policy in the browser suite
  - `8b5745ea` Say when the codec worker first tells the page what it can do
  - `6719862a` Wrap the codec comments to the written width, and wait for the stream's end
- `713b159f` Merge slice s8b: batch import of files and folders, each file's format, and the Inspector's source
  - `efcb382c` Report each importing file's recognised format from the storage's analysis
  - `7c212025` Describe a decoded asset's source and its file's metadata in the Inspector
  - `9823493e` Let the person choose several audio files, or a folder of them
  - `39386cd1` Import audio as batches, with each file's progress listed
  - `3db30ccd` Count the File menu's entry for importing a folder of audio
  - `f57472a9` Hand the import the page's codecs from the command that starts it
  - `b9f8c6fe` Leave no import listed as running once the storage fails it
  - `db008ba5` Type the import test's spy on the storage's batch import
  - `96a1ab17` Wrap the import's module comments to the written width
- `d59a8a85` Merge slice s8x: the export pipeline, destinations, the collision prompt and trusted folders
  - `e8427ca0` Name an export's encoder when it is delivered, not when it is staged
  - `0354e077` Run an export from the canonical render to a delivered file
  - `f00f819e` Give the export its commands, its surfaces and its place on the page
  - `c9f0c5a5` Make the page's export where its parts exist
  - `76938c15` Take the export's contracts off the lists of exports offered ahead of use
  - `81524d05` Hold the export's commands and surfaces to what each does
  - `f43613bc` Hold the export's planning, sizing, metadata, history words and render to their rules
  - `c06875f6` Take of a file only the span and rate its metadata is placed by
  - `9b4d4688` Hold a cancelled export and a download to giving up what they staged
  - `57a6d35f` Read the export's ports as functions, and ask whether it is busy after its last await
  - `852bc17d` Run the export's commands twice where their work is awaited
  - `538dd0e9` Fail the file a delivery or download stops on, rather than the export
  - `a88e74a4` Record the public contracts the export changes
  - `01c63d32` Keep the export in a part of its own, below the stores, split by what each piece decides
  - `dd3568fe` Decide a folder delivery's taken name in a module of its own
  - `a0775a72` Record the cohesion reviews and page values the export brings
  - `c3b3de8d` Format the cohesion reviews as the formatter writes them
  - `3c414903` Wrap the export's comments to the written width
- `f47dcc11` Merge slice s8x's fix: the {project} token takes the project's name, and the encoder-module rename reaches the page
  - `1a7899bb` Name an export by its project, as {project} says
- `74c321c4` Merge slice s6c's follow-on: Symphonia's Vorbis decoder patched at its source, and ADR-0091 and ADR-0092 amended for the source-built encoders
  - `63b5e420` Fix Symphonia's multichannel Vorbis decoding at its source
  - `4912f74f` Amend ADR-0091 and ADR-0092 for the encoders built from source
- `def6b2b1` Name the source-built encoder modules where the spec still said prebuilt
- `a11e45b7` Merge slice s8d: the Export dialog with presets and every setting, its entry points, and the person's own presets in userPreferences 2
  - `f2086961` Keep the person's own export presets in their preferences
  - `4125126e` Hold the Export dialog's settings as one record, planned on every change
  - `89e72e6a` Open the Export dialog over an asset, a region, every region or the selection, and start it
  - `6bd27b4d` Show every export setting in the Export dialog, and say what the export will do
  - `98804c2b` Offer export from the File menu, each region's row, Quick Edit and a chord, and keep presets in Settings
  - `53911506` Name the Export dialog's groups apart from the controls in them
  - `c794749d` Format the preferences record's test as the repository does
  - `a2a4f748` Keep the export modules within the cohesion limits and the application's direction
  - `206020ba` Keep the export batch's job machine listed among the import-export exports nothing takes yet
  - `11f9b529` Wrap the MP3 rates' comment to the written width, and import its types as types
  - `bc135bff` Keep one review of the project stores' composition, the one the merge brought
  - `493b3c0f` Name the codecs that serve instead in a sentence of their own
- `19c43426` Watch only files for the bundled codec modules, and the patched crate
- `1efc731f` Record the source-built encoders and the application in the Phase 09 note
- `7b251e98` Record where Phase 09 paused and what is left
- `d23a18e1` Merge branch 'p09-s8e' into phase-09-codecs
  - `2936067a` Share one encoder-module build between callers that ask at once
  - `85b91e97` Fit a view opened on another asset to the width its surface has
  - `f69b4bcb` End a codec job's streams with the fault it meets
  - `364176de` Fail an AAC export with the reason the browser's encoder closes for
  - `6e72ec86` Drive import and export through the codec system in Chromium
  - `9661733e` Keep the encoder build's type comments within the comment width
- `0b4313a3` Merge branch 'p09-s6e' into phase-09-codecs
  - `5d15fd13` Decode real AAC-LC through the codec module and hold it to its source
  - `29afd854` Decode multichannel AAC-LC, each channel to its speaker
  - `f6637f7d` Hold the AAC decoder to the elements a channel configuration places
  - `0cc1a11f` Fill the AAC decoder's comments to the written width
- `29ab149b` Merge p09-s8f: the Inspector describes an export job
  - `ba1335ac` State the storage each importing file needs before it is stored
  - `1e04ae06` Let a FLAC export keep its loops, cues and tuning as WAV chunks
  - `e538130b` Round-trip export metadata and loops through every format that holds them
  - `e1fd34fc` Work in progress: groundwork for the Inspector describing an export job
  - `fb326925` Let the Inspector list any subject's facts, not only a source's
  - `3b63c09c` Share the words for an export's stage, settings and destination
  - `58d71fb7` Describe an export in the Inspector
  - `f87cffe5` Leave the export's description to its availability alone
  - `a3cb1948` Test the Inspector's export, and the claims and states it reads
  - `0a997333` Name an export's encoder once, not twice
  - `3fd03b69` Drop a format check the type already makes
  - `899d24e1` Wrap the import and round-trip comments at the written width
  - `e80685cc` Keep the Inspector's own subjects and the inspection commands apart
  - `87de30ce` Compare export subjects through an optional chain
- `1b48d775` Merge p09-s6f: probe the bit rates the browser's AAC encoder takes
  - `4a4f57de` Probe the bit rates the browser's AAC encoder takes
  - `d6559fe2` Test that the worker and the dialog follow the probe
  - `75c5049f` Fill the new comments to the written width
- `c6d67caf` Give the browser test's FLAC files the setting FLAC now has
- `9b82b68d` Amend ADR-0091 and ADR-0092 for the AAC decoder, probe and FLAC chunks
- `7bf61115` Merge main: Phase 08's spectral editing
- `f0d07fd5` Accept Phase 08's crate-scoped Rust test in its evidence
- `bfb35b65` Refuse preferences of another version rather than migrate them
- `5ee025a2` Name each WAV sample format in its test's title
- `397fad21` Record the merged slices and the gaps left in the Phase 09 note
- `6170ded0` Merge branch 'p09-s9d' into phase-09-codecs
  - `e0eea3b0` Write and offer every integer depth, not four
  - `3dd942c5` Hold the hashes of ADPCM, 32-bit FLAC and new depths
  - `fcecac9c` Rewrap the comments of the integer depth change
- `b1711fc2` Merge branch 'p09-s9f' into phase-09-codecs
  - `48adf195` Clean the storage at start under one hold of the lock
  - `5b56c3dd` Give importing a default chord beside exporting
  - `24725635` Hold the AAC browser test to the encoder's own answer
  - `83f45d37` Measure long files through the codec worker
  - `4cf38986` Give credit back as the storage reads, not as it receives
  - `9ebdf1ac` Measure long files through the storage
  - `ef094bf5` Count the import chord among the prefix defaults waiting
  - `c3b98121` Wrap the long-file tests' comments to the line width
- `44b6c067` Merge branch 'p09-s9d' into phase-09-codecs
  - `ad079dc2` Let a dither the person never set follow the depth
- `578b8fdb` Merge p09-s9e: the picture's sound decoded into storage
  - `a72760a0` Decode a reference picture's sound through the codecs
  - `dcf909af` Hold the browser's codecs to their two packages
  - `218123b8` Say why a codec module failed to load
  - `0b7eea53` Wrap the new comments at the comment width
  - `486b9142` Hold a session's sound in the storage's staging
  - `a55971f2` Open a picture's sound from storage, not the page
- `e8c28ee2` Merge branch 'p09-s9e' into phase-09-codecs
  - `b3c00dca` Keep staged files in use from storage pressure
- `4b024aea` Amend the spec for every depth, held staging and the picture's sound
- `ec6945cf` Record the gap slices and the close left in the Phase 09 note
- `35f924f9` Type the bit depth in the import and export browser test

The commit that records this package, the review record and the handoff
follows, and the integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-09-review.md` records the owner's decision that defers every
lens to the review after the whole specification is implemented, and the two
scope checks separate read-only agents ran in their place against the packet.
Their thirteen findings, one `HIGH`, five `MEDIUM`, five `LOW` and two `NOTE`,
and the seventeen the build, the fix round and the closing run found, two
`HIGH`, nine `MEDIUM` and six `LOW`, are fixed; the review record names each
fix's commit and the tests that hold it.
