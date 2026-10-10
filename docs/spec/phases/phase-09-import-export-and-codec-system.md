# Phase 09 — Import, Export, and Codec System

## Status

`READY` — its hard dependencies, Phases 02, 03, 05 and 06, are `PASS`, and its readiness review on 2026-10-10 settled its open placements in `ADR-0090`, `ADR-0091`, `ADR-0092` and `ADR-0093`.

## Objective

Implement the extensible import/export/codec subsystem and deterministic export pipeline for common professional/game formats, broad WAV variants, metadata, multichannel layouts, presets/expert controls, and collision-safe destinations. Codecs are registered and probed, and a compressed file becomes an asset through a decoded rendition made once in a codec worker (`ADR-0090`); every format has a local codec where one is lawful and mature, in Rust where it can be, and the browser's codec only adds to it (`ADR-0091`); an export renders canonically, encodes, stages and only then delivers under a collision policy (`ADR-0092`); one metadata map, with its loops and the channel layout, is read from and written to every format (`ADR-0093`).

## User-Visible Outcome

Users can import common audio formats, render projects/regions through the canonical engine, and export high-quality game/professional files using presets or detailed expert settings. They import one file, many, or a folder, and see each file's format, size and progress, and why any file was refused; the loops and cue points of a file arrive as loops and markers they can undo; they export the project, a region, every region or the selection from the Export dialog, Quick Edit or the region list, with a preset or every setting, into a file, a folder or a trusted folder, and are asked before anything is overwritten unless they chose otherwise.

## Hard Dependencies

- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP

## Owned Requirements

- `REQ-AUDIO-010` — Format Support (`CURRENT`)
- `REQ-AUDIO-050` — Presets and Advanced Codec Controls (`CURRENT`)
- `REQ-ARCH-054` — Export Collision Policy (`CURRENT`)

Reading uncompressed WAV and AIFF at the native rate was split from `REQ-AUDIO-010` as `REQ-AUDIO-220` and is Phase 05's (`ADR-0050`); this phase's codecs extend the read contract Phase 05 introduces in `packages/codecs`.

### Requirements Consumed From Other Phases

Owned elsewhere; this phase delivers the part named, or keeps what it asks.

- `REQ-ARCH-004` — Core Architectural Principles (Phase 01): a source file is never changed by import or export; a decoded rendition is derived media.
- `REQ-ARCH-011` — Audio Precision (Phase 03): export precision is chosen apart from the working precision.
- `REQ-ARCH-049` and `REQ-ARCH-081` — Deterministic Rendering and Canonical Deterministic Processing (Phase 03): a local export gives the same bytes on every machine; a browser-encoded export is marked as not reproducible.
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate (Phase 03): decoding never resamples.
- `REQ-ARCH-141` — DSP Implementation Languages (Phase 03): the codec module in Rust behind a narrow ABI.
- `REQ-ARCH-153` — State Ownership and Workflow State (Phase 01): import and export jobs are explicit state machines.
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio (Phase 03): layouts are read, kept, converted and written, never inferred from a count where a file states one.
- `REQ-AUDIO-143` — Render Quality Policy (Phase 06): export defaults to the highest-quality path for its format.
- `REQ-AUDIO-145` — Processor Versioning and Reproducibility (Phase 06): the export record names the codec and its version.
- `REQ-AUDIO-220` — Native-Rate Reading of Uncompressed Audio (Phase 05): its contract, extended.
- `REQ-EDIT-008` — Editing Modes (Phase 05): Quick Edit's export.
- `REQ-EDIT-014` — Regions (Phase 05): per-region and batch export, loop settings and metadata.
- `REQ-EDIT-015` — Channel Editing (Phase 05): no export contract assumes stereo.
- `REQ-EDIT-072` — Contextual Inspector (Phase 01): the Inspector describes an asset's source and an export job.
- `REQ-EDIT-073` — Unified Typed Command Architecture (Phase 01): every import, export and collision answer is a command.
- `REQ-STOR-025`, `REQ-STOR-099` and `REQ-STOR-104` — storage model, content-addressed media and external source identity (Phase 02): copy or link, renditions in the store, the source's identity.
- `REQ-STOR-052` — Project Schema Compatibility Policy (Phase 02): the raised versions are refused, never migrated, before 1.0.
- `REQ-STOR-106` — Storage Cleanup Priority (Phase 02): export staging is a cache category.
- `REQ-STOR-166` — Asset Provenance (Phase 02): the source's codec, metadata and decoder in provenance; metadata stripped or minimised on export.
- `REQ-STOR-197` and `REQ-STOR-198` — Export Provenance and External Side Effects (Phase 02): exports are history records, never undone.
- `REQ-GAME-121` — Seamless Loop Analysis (Phase 10): loop metadata is written so loops survive export.
- `REQ-GODOT-046` and `REQ-GODOT-133` — the download fallback and ordinary Godot-importable files (Phase 11).
- `REQ-REPO-033` and `REQ-REPO-142` — Source Control and Licensing, Open-Source Licence (Phase 01): every codec's licence and patent position reviewed and noticed.
- `REQ-UX-005` — User Experience Goals (Phase 01): every import and export action has a keyboard form.

## Referenced Global Execution Requirements

- `REQ-EXEC-136`
- `REQ-EXEC-167`
- `REQ-EXEC-170`
- `REQ-EXEC-171`
- `REQ-EXEC-172`
- `REQ-EXEC-173`
- `REQ-EXEC-174`
- `REQ-EXEC-180`
- `REQ-EXEC-181`
- `REQ-EXEC-183`
- `REQ-EXEC-184`
- `REQ-EXEC-204`
- `REQ-EXEC-215`
- `REQ-EXEC-216`

## In Scope

- [ ] Codec registry/abstraction: `CodecDescriptor`, `CodecCapability`, the registry and its probes (`ADR-0090`)
- [ ] FLAC/MP3/Ogg Vorbis/Opus/AAC-M4A import, the compressed encodings WAV and AIFF-C can carry, and WAV/AIFF/FLAC/MP3/Ogg Vorbis/Opus/AAC-M4A export, where legally/technically viable (uncompressed WAV and AIFF reading is Phase 05's, `ADR-0050`): G.711 and ADPCM read in place, every other compressed format as a decoded rendition, the codec module, the MP3 and Vorbis encoder modules built from vendored source (`ADR-0091` amended), and AAC export by the browser's encoder where probed (`ADR-0090`, `ADR-0091`)
- [ ] WAV integer/float bit depths and sample rates for writing: integer 8 to 32 bits, float 32 and 64, G.711 and ADPCM, plain, extensible and RF64, built on Phase 07's writer; AIFF and AIFF-C writing
- [ ] Multichannel metadata/layout preservation: speaker masks including 7.1 and 7.1.4, ambisonic layouts, `CHAN`, and each codec's channel order (`ADR-0093`)
- [ ] Metadata/loop metadata: `MetadataMap` and its mapping for every format, in both directions, and the import of loops and cue points as regions and markers (`ADR-0093`)
- [ ] Import analysis/progress/cancellation for the formats this phase adds, and batch import: the codec worker, `SyncAudioBytes`, the storage needed stated before storing, staged progress, `ImportJob` over many files and folders
- [ ] Export quality/expert controls: `ExportSettings`, presets, the Export dialog with progressive disclosure, Quick Edit's, the region list's and the File menu's export (`ADR-0092`)
- [ ] Collision policy: `CollisionPolicy`, apply to all, trusted folders and their silent overwrite of unchanged earlier exports (`ADR-0092`)
- [ ] Deterministic/application-owned codecs where required: every local export reproducible and held by hashes; dither seeded by the job
- [ ] Streaming/chunked I/O: rendered and decoded blocks over message channels between workers, staging, and delivery through `createWritable`
- [ ] Export records in the project's history, with codec, version and reproducibility (`REQ-STOR-197`)

## Explicitly Out of Scope

- Godot-specific live export semantics
- Batch variation generation
- Cloud encoding
- Importing uncompressed WAV and AIFF at the native rate, opening the project's assets in the editor, and moving the markers and regions into the project, which are Phase 05's (`ADR-0050`, amending `ADR-0021`)
- Persistent export recipes as project objects: Phase 11 (`REQ-GODOT-119`), built on this phase's `ExportSettings`
- A local AAC encoder: none is lawful and mature for this project (`ADR-0091`); AAC export is served by the browser's encoder where one is probed, and refused with alternatives elsewhere
- HE-AAC decoding without a browser decoder: no local decoder exists (`ADR-0091`)

## Owned Modules / Packages

- `packages/codecs` (created by Phase 05 with the read contract and the uncompressed PCM readers; Phase 07 adds the recorded-media WAV writer, 32-bit float PCM and RF64, `ADR-0071`; this phase adds its registry, decoders and every other writer, building its WAV writing on Phase 07's, `ADR-0050` amended): the registry, capabilities, in-place compressed readers, `SyncAudioBytes`, the WAV, AIFF and AIFF-C writers, the Ogg, FLAC, MP4 and MP3 framing, and `MetadataMap` with its readers and writers
- `packages/import-export` (new, portable): `ExportSettings`, `ExportPreset`, `ImportJob`, `ExportJob`, `CollisionPolicy`, dither and quantisation, file naming (`ADR-0092`); the export-recipe core, with no separate package
- `packages/codec-runtime` (new): the codec worker, the codec module's loader, the encoder modules' loader (`ADR-0091` amended) and the WebCodecs adapters
- `crates/codecs` and `crates/codec-bindings` (new): the codec module (`ADR-0091`)
- `packages/storage`, `packages/storage-runtime` and `packages/browser-storage` destination adapters: renditions, export staging, delivery and folder destinations
- `packages/project-format`: compressed provenance, metadata and the export record's fields; `packages/capabilities`: the codec probes
- `apps/web`: the import and export commands, the Export dialog, the collision prompt, batch import, trusted folders, and the codec worker's start

## Cross-Package Dependency Rules

- Codec modules consume audio-stream contracts and storage destinations through public interfaces.
- Game/Godot-specific policy layers may depend on generic export contracts, not the reverse.
- `packages/codecs` depends on the domain alone, and stays portable.
- `packages/import-export` depends on the domain, the codecs and the engine's contracts, and reads no browser global; `packages/project-format` depends on it and on the codecs for the provenance and export settings it keeps, so `packages/import-export` never depends on the project format (`ADR-0092` amended).
- `packages/codec-runtime` depends on the codecs and the import-export contracts; only `packages/capabilities` probes the browser's codecs, and only `packages/codec-runtime` calls them.
- Only the storage worker writes renditions and staged exports; no sample passes through the page.

## Required Public Contracts

- CodecDescriptor (`packages/codecs`, `ADR-0090`)
- CodecCapability (`packages/codecs`, `ADR-0090`)
- ImportJob (`packages/import-export`, `ADR-0090`)
- ExportJob (`packages/import-export`, `ADR-0092`)
- AudioFormatDescriptor (introduced by Phase 05, `ADR-0050`; extended here with the compressed containers and codes)
- MetadataMap (`packages/codecs`, `ADR-0093`)
- ExportSettings and ExportPreset (`packages/import-export`, `ADR-0092`)
- CollisionPolicy (`packages/import-export`, `ADR-0092`)
- SyncAudioBytes (`packages/codecs`, `ADR-0090`)
- The codec module's ABI (`crates/codec-bindings`, `ADR-0091`)

## Data / Schema Changes

- Introduces codec descriptors/capability metadata, import/export job state, typed export settings, metadata/loop metadata mappings and collision-policy records.
- The asset's provenance gains the compressed source's container and codec, its metadata, and the decoder and its version; the project gains its last export settings; both raise `projectDocument`. The person's preferences gain export presets, raising `userPreferences`; trusted folders and the records of what was exported into each are kept beside their handles in the browser's handle database (`ADR-0092` amended). Before 1.0 nothing migrates (`REQ-STOR-052`).
- The storage gains the export staging area, the cache category `staging`, given up after `temporary` (`ADR-0092` amended).
- Settled by this phase's readiness review (`ADR-0090` to `ADR-0093`): how a compressed file becomes an asset, which codec serves each format, how an export is staged and delivered, and how metadata and layouts are mapped.

## Browser / Platform Considerations

- Native codec availability differs by browser; local fallback implementations are required where selected support demands them.
- External destination filesystem access is capability/permission-sensitive.
- Assumed nowhere (`REQ-EXEC-216`): WebAssembly, WebCodecs or any codec it serves; a save dialog or a folder picker; write permission that lasts; a file that fits in memory; a sample rate or a channel layout; storage quota for a rendition or a staged export; a destination that is free or may be overwritten. Each is probed or given, and its absence has stated behaviour.

## Architectural Invariants

- Codec availability is capability-detected.
- Lossy/native browser codecs are not assumed universally.
- Final render uses canonical processing before encoding.
- Unsupported formats fail explicitly with alternatives.
- Exports never silently overwrite unless user policy explicitly allows it.
- A format is recognised from its bytes, never its name.
- A project's sound never changes because a decoder changed: compressed sources are heard through their rendition.
- No sample passes through the page, and no file is held whole in memory.

## Internal Work Units

### WU-09.A — Codec contracts and WAV

- [ ] Implement the registry and capability descriptors over Phase 05's read contract, and the streaming write interface
- [ ] Implement comprehensive WAV writing on Phase 07's recorded-media writer (`ADR-0071`), the compressed encodings WAV can carry, and WAV metadata and loop metadata on read and write; AIFF and AIFF-C likewise; every domain layout (`ADR-0093`)

### WU-09.B — Common codecs

- [ ] Integrate legal/open-source codec implementations and browser acceleration where compatible: the codec module (Symphonia, `flacenc`, the conformant Opus), the MP3 and Vorbis encoder modules built from vendored source (`ADR-0091` amended), the Ogg, FLAC, MP4 and MP3 framing, and the WebCodecs adapters
- [ ] Implement capability/licence documentation and deterministic-path rules: the probes, the third-party notices, the reproducibility of every local export

### WU-09.C — Import/export jobs

- [ ] Implement progress/cancellation/worker execution: the codec worker, renditions, import analysis, batch import, and the export job through render, encode, stage and deliver
- [ ] Implement resample/bit-depth/dither/channel conversion hooks and maximum-quality default

### WU-09.D — Presets/expert settings and destinations

- [ ] Implement preset layer over full settings
- [ ] Implement collision policies, trusted overwrite options and metadata controls, the Export dialog, the collision prompt and the import views

## Failure and Recovery Behaviour

- Malformed/untrusted media must be validated and fail without corrupting project state.
- Partial export must not be reported as successful.
- Destination permission loss/collision must preserve source/project and offer retry/new destination.
- A decode that fails part way keeps nothing; a cancelled import keeps nothing.
- A staged export survives a refused delivery, so a retry or another destination needs no new render; staging is removed after delivery and at start.
- A codec module or encoder that fails to load makes its formats unavailable with the reason, and leaves every other format working.

## Required Verification Commands / Suites

- `pnpm test:codecs`, which this phase adds: the Vitest projects of `packages/codecs`, `packages/import-export` and `packages/codec-runtime`
- `cargo test --workspace`
- `pnpm test:codec-fixtures`
- `pnpm test:roundtrip-audio`, which this phase adds: every lossless format bit for bit, every lossy format within a stated error, metadata and loops through every format that holds them
- `pnpm test:malformed-media`
- `pnpm test:opus-conformance`, which this phase adds: the RFC 8251 vector set, RFC 6716's bitstreams with the outputs of both decoders, fetched on demand with its hash (`ADR-0091` amended)
- `pnpm test:project-roundtrip` and `pnpm test:architecture`
- `pnpm test:e2e:import-export`, which this phase adds: a Chromium project that imports a compressed file and a folder, exports a region to a folder with a collision, and reloads

## Acceptance Criteria

- [ ] Supported lossless formats round-trip within expected bit/sample semantics.
- [ ] WAV matrix covers required bit depths, float/integer, sample rates, mono/stereo/N-channel and loop metadata.
- [ ] Import/export does not require loading entire long files into duplicated memory.
- [ ] Preset and expert settings resolve to the same typed export settings model.
- [ ] Collision policies are deterministic and safe by default.
- [ ] Every local export gives the same bytes for the same project and settings on every machine.
- [ ] A format no implementation serves in a browser is refused before anything is stored or rendered, naming the formats that can be used.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No extension-only format detection.
- No silent lossy transcoding.
- No browser codec as the sole path for a format where cross-browser support is required and a local fallback is viable.
- No second read contract beside `packages/codecs`', and no switch over formats where a descriptor belongs.
- No decoding on the page or in the storage worker, and no browser decoder for a format a local decoder serves.

## Required Review Lenses

- Codec / Interchange Correctness
- Audio / DSP Correctness
- Security / Malformed Input
- Performance / Scalability
- Testing / Regression
- Architecture
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Inherited Debt

Assigned to this phase by earlier handoffs and by this phase's readiness review:

- F-51 (Phase 02): a bundle import whose disposable caches the storage cannot hold fails whole; the import analysis decides what a disposable part may cost, so such caches are skipped and rebuilt, and the import says so.
- F-192 and F-618 (Phase 01): the diagnostics path rules stop before a date or "and/or", read percent-encoded runs undecoded, and miss a `data:` written with a space after its scheme; imports bring paths into the log in volume, so they are corrected here.
- The reference picture's sound is extracted assuming at most eight channels (Phase 04): its audio track's real channel count is read by the codec module's demultiplexer before extraction.
- Phase 07's WAV writer refuses 7.1, 7.1.4 and ambisonic layouts, left with no owner: resolved by `ADR-0093`.
- The packet's verification named `pnpm test --filter codecs --filter import-export` and `pnpm test:roundtrip-audio`, which did not exist (found by this review): corrected above.

## Handoff Capsule

Create `traceability/handoffs/phase-09.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
