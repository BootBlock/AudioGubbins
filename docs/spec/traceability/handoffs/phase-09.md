# Phase Handoff Capsule — Phase 09

## Capability Delivered

AudioGubbins imports and exports the common professional and game formats
through one extensible codec system. A file is recognised from its bytes,
never its name, and routed by the codec registry: uncompressed PCM, G.711 and
ADPCM are read in place, and every other compressed format (FLAC, MP3, Ogg
Vorbis, Opus, AAC and HE-AAC in MP4 or ADTS, ALAC, Matroska and WebM audio)
becomes an asset through a decoded rendition, a 32-bit float WAV the codec
worker decodes once and the storage worker writes, so a project's sound never
changes because a decoder changed (`ADR-0090`). Decoding is the codec module's
(Symphonia, with its AAC and Vorbis decoders patched for multichannel
streams, and the conformant Opus of `ropus`, in Rust behind a narrow ABI), and
the browser's codecs only add to it: HE-AAC where it decodes it, AAC-LC
export where its encoder is probed (`ADR-0091`). An export is planned from
typed settings, which a preset and the expert controls resolve to alike,
rendered by the canonical engine at maximum quality, converted, dithered from
a generator keyed by the settings and quantised, encoded in the codec worker,
staged in the storage, and only then delivered to a file, a folder or a
trusted folder under a collision policy that asks by default (`ADR-0092`).
Every local export gives the same bytes on every machine. One metadata map
with its loops, cues and channel layout is read from and written to every
format that holds it, and a file's loops and cues arrive as regions and
markers the person can undo (`ADR-0093`). The person imports one file, many
or a folder, sees each file's format, size, the storage it needs and its
progress, and why any file was refused; exports the asset in the editor, a
region, every region or the selection from the Export dialog, the File menu,
a region's row or Quick Edit; and finds every export in the History and the
Inspector, with its codec, version and whether its bytes are reproducible.

## Requirements Satisfied

The owned requirements are mapped to their implementation and their evidence
in `reviews/phase-09-evidence.md`, under "Requirement-to-evidence mapping",
with the consumed requirements beside them.

- `REQ-AUDIO-010`
- `REQ-AUDIO-050`
- `REQ-ARCH-054`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them. By package:

- `@audiogubbins/codecs` (Phase 05's package, extended): `CodecDescriptor`,
  `CodecDirection`, `CodecCodes`, `CodecId`, `ContainerId`,
  `CODEC_REGISTRY`, `CodecCapability`, `codecCapability` and
  `CodecEnvironment`; `RecognisedFormat` and `importRoute`; the in-place
  G.711 and ADPCM readers; `SyncAudioBytes` and `AudioBytes`;
  `AudioFileWriter` (body bytes per block, then a head and a tail) with the
  WAV, RF64, BW64, AIFF and AIFF-C writers; the Ogg, FLAC, MP4 and MP3
  stream writers (`EncodedStreamWriter`); `MetadataMap` with
  `METADATA_READERS` and each format's writer; `PCM_INTEGER_DEPTHS` and
  `FLAC_DEPTHS`, the one statement of each depth run; `DecoderIdentity`;
  `AudioFormatDescriptor` extended with the compressed containers and codes.
- `@audiogubbins/import-export` (new, portable): `ExportSettings` and its
  encodings, `ExportPreset`, `BUILT_IN_PRESETS`, `resolvePreset`,
  `defaultExportSettings`, `validateExportSettings`, `encodingProblems`;
  `DitherSettings`, `Quantiser`; `safeFileName`; `CollisionPolicy`,
  `decideCollision`, `answerCollision`, `rememberCollisionAnswer`;
  `ImportJob` and `nextImportJob`; `ExportJob`, `ExportBatch` and
  `nextExportJob`, `nextExportBatch`; `planExport`; and the stream messages
  between the workers (`RenderedStreamMessage`, `DecodedStreamMessage`,
  `EncodedStreamMessage`, `StreamReceiverMessage`) with their readers.
- `@audiogubbins/codec-runtime` (new): the codec worker's protocol
  (`CodecRequest`, its replies and `readFromCodecWorker`), its thread entry,
  the typed codec module (`CodecModule`, `DecoderSession`), the encoder
  modules' loader (`EncoderModuleName`, `EncoderIdentity`),
  `openExportEncoder`, and the WebCodecs adapters.
- `@audiogubbins/capabilities`: `readCodecPlatform`, `probeCodecs` and the AAC
  encoder's bit-rate probe.
- `@audiogubbins/storage`, `@audiogubbins/storage-runtime` and
  `@audiogubbins/browser-storage`: renditions, import analysis and batch
  import, the staging and its cache category, delivery to a file, a folder
  or a trusted folder (`TrustedFolders`), session sounds, and the protocol
  `imports.connectCodecWorker`, `imports.run`, `exports.stage`,
  `exports.deliver`, `exports.discard`.
- `@audiogubbins/project-format`: the rendition and metadata in an asset's
  provenance, the source encoding per kind, `ProjectState.exportSettings`
  and `ExportRecord.file`, with the destination kinds `file` and
  `trusted-directory`.
- `crates/codec-bindings`: the codec module's C ABI, version 1, its one
  import `ag_codec_read`; `crates/handle-table` shared with the DSP module,
  whose ABI is unchanged.
- The MP3 and Vorbis encoder modules (`native/`): an interface of
  AudioGubbins' own at version 1.

## Persisted / Interchange Formats

- The project document, `projectDocument` version 9: a compressed source's
  rendition record and metadata in its provenance, the source encoding per
  kind, the project's last export settings, and an export record's file.
- The person's preferences, `userPreferences` version 3: their own export
  presets (`own:<name>`, at most 256).
- Trusted folders and the record of what was exported into each, kept beside
  their handles in the browser's handle database, not in the preferences.
- The cache category `staging`, given up after `temporary`: renditions being
  decoded, staged exports and the session's held sounds, kept whole while
  anyone shares the storage lock.
- Every file the export writes: WAV, RF64, BW64, AIFF, AIFF-C, FLAC, MP3, Ogg
  Vorbis, Opus in Ogg and AAC in M4A, with `ADR-0093`'s metadata and layouts.
- The codec module's ABI version 1 and the encoder modules' interface
  version 1; the DSP ABI is unchanged.
- Before 1.0 nothing migrates (`REQ-STOR-052`): a document or preferences of
  another version are refused with the reason, and the preferences start
  from their defaults.

## Invariants Downstream Agents Must Preserve

- A format is recognised from its bytes alone. A codec is one descriptor in
  the registry, never an arm of a switch; what a runtime can do with it is
  `codecCapability`'s answer over the probed environment, and an unavailable
  format is refused before anything is stored or rendered, naming what can be
  used, its own lossiness first.
- A compressed source is heard through its rendition, never decoded again for
  playback. Decoding never resamples, and every decoder gives its channels in
  speaker-mask order; a layout a file states is never inferred from a count.
- No sample passes through the page and no file is held whole: the codec
  worker reads a file a slice at a time and sends blocks of at most 65,536
  frames and 1 MiB under its receiver's credit; the render worker sends the
  codec worker its blocks under credit; only the storage worker writes
  renditions, staged exports and session sounds; a reference picture's sound
  takes the same path.
- Only `packages/capabilities` probes the browser's codecs and only
  `packages/codec-runtime` calls them (`tests/architecture/dependency-rules.test.ts`);
  no browser decoder serves a format a local decoder serves.
- An export renders through the canonical engine before it encodes, and
  every local export gives the same bytes for the same project and settings:
  the dither's key is the CRC-32 of the settings as canonical text, drawn by
  `lowbias32` over key, channel and draw, and the encoders take fixed blocks.
  Byte pins hold every local encoding; a browser-encoded export is recorded
  as not reproducible.
- A preset is a partial `ExportSettings` resolved over the same defaults the
  expert controls edit; a setting the encoder would change or refuse is
  refused in validation, and by the codec worker by the same rule, before
  rendering, never rounded.
- No export silently overwrites: the policy asks by default; a trusted folder
  overwrites only a file whose last record there matches its size and hash.
  A refused delivery keeps the staged file for a retry or another destination
  without a new render, and a partial export is never reported as delivered.
- Every import, export and collision answer is a command; an export is a
  history record and is never undone.
- The staging is given up, by pressure, cleanup or start, only with the
  storage lock held alone.

## ADRs

- `ADR-0090` — the codec registry and decoded renditions; amended 2026-10-10.
- `ADR-0091` — codec implementations and licences; amended 2026-10-10 three
  times (`ropus`, FLAC at every depth, Matroska trimming; the ABI and the
  application's own codecs; LAME, libvorbis and libogg built from vendored
  source, and Symphonia's Vorbis decoder patched) and 2026-10-12 (Symphonia's
  AAC decoder patched for configurations 3 to 7).
- `ADR-0092` — export jobs, settings and destinations; amended 2026-10-10
  twice (the constraint, settings, defaults, job, staging, naming and records;
  the encoders' bit-rate bands), 2026-10-12 (`keepRiffChunks` and the AAC
  bit-rate probe) and 2026-10-13 twice (every integer depth, a dither that
  follows the depth; the staging's held files and the storage lock).
- `ADR-0093` — metadata, loops and channel layouts in files; amended
  2026-10-10.
- `ADR-0050` — amended 2026-10-13: the reference picture's sound is decoded by
  the codec worker into the staging, retiring Phase 04's channel bound.
- `ADR-0022`, `ADR-0031`, `ADR-0052` and `ADR-0071` — amended by the
  readiness review, as each records.

## Verification Baselines

- `pnpm run test:codecs`, the Vitest projects of the three codec packages.
- `pnpm run test:roundtrip-audio`: every lossless format bit for bit at every
  depth, every lossy format within its stated error, metadata and loops
  through every real encoder with each format's dropped fields named, and the
  byte pins of every local encoding.
- `pnpm run test:codec-fixtures` and `pnpm run test:malformed-media`, with
  the AAC-LC fixtures FFmpeg's `aac` encoder made
  (`packages/codec-runtime/fixtures/aac-lc/`, their commands and SHA-256s in
  its README).
- `pnpm run test:opus-conformance`: the RFC 8251 vector set, fetched on
  demand and checked against its hash; all 24 pass.
- `cargo test --workspace`, with the codec module's FLAC, Opus, Matroska and
  malformed-stream tests.
- `pnpm run test:project-roundtrip` and `pnpm run test:architecture`.
- `pnpm run test:e2e:import-export` in Chromium: a FLAC file and a folder
  imported, a region exported with "Keep both", the History record found
  after a reload, and AAC exported and read back at the source's length where
  the browser encodes it.
- The final counts are in the evidence.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Godot-specific live export semantics, batch variation generation and cloud
  encoding (packet, Explicitly Out of Scope).
- Persistent export recipes as project objects: Phase 11 (`REQ-GODOT-119`),
  on this phase's `ExportSettings`.
- A local AAC encoder: none is lawful and mature for this project
  (`ADR-0091`); AAC export is the browser's where probed, and refused with
  alternatives elsewhere.
- HE-AAC decoding without a browser decoder: no local decoder exists
  (`ADR-0091`).
- A multitrack mixdown: no phase of this specification builds the multitrack
  architecture, so the export range "the project" is the asset in the editor.

## Accepted Non-Blocking Debt

- Chromium's AAC encoder on Windows takes only 96, 128, 160 and 192 kbit/s,
  for one, two and six channels at 44.1 and 48 kHz, and nothing for three,
  four, five or eight channels. The probe finds this, so such streams are
  refused before rendering, naming what the encoder takes, and the built-in
  "Distribution, AAC 256 kbit/s" preset is reported as not exportable there;
  other platforms answer their own way (`ADR-0092` amended 2026-10-12).
- The default dither stays off at depths above 16 bits, 20 bits among them:
  triangular dither is the default for an integer depth of 16 bits or fewer,
  as `ADR-0092` states; a person sets it at any depth, and it is kept.
- Ogg Vorbis is written in at most eight channels and MP3 in one or two; MP4
  holds only AAC-LC with a stated channel configuration (`ADR-0092`,
  `ADR-0093`).
- WebM and Matroska carry no metadata mapping (`ADR-0093`).
- A browser that keeps no storage cannot open a reference picture's sound,
  and says why (`ADR-0050` amended).
- `test:e2e:import-export` runs in Chromium only. Owed to Phase 14.
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-09-review.md`).
- The debt owed to this phase is closed: F-51 (Phase 02), F-192 and F-618
  (Phase 01), the reference picture's channel bound (Phase 04, retired by
  `ADR-0050` amended), and Phase 07's WAV writer's layouts (`ADR-0093`).

## Downstream Readiness

- Phase 10 — Game-Audio Tooling becomes eligible for `READY`: its hard
  dependencies, Phases 05, 06 and 09, have passed; its readiness review
  decides it.
- Phase 12 — PWA, Offline, and Installation Hardening becomes eligible for
  `READY`: its hard dependencies, Phases 01, 02 and 09, have passed; its
  readiness review decides it.
- Phase 11 still waits on Phase 10; Phase 13 on Phases 10 and 11; Phase 14 on
  Phases 10 to 13; Phase 15 on Phase 14.
