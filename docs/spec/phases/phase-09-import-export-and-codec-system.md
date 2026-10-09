# Phase 09 — Import, Export, and Codec System

## Status

`NOT_READY` — blocked by Phase(s) 02, 03, 05, 06 reaching `PASS`.

## Objective

Implement the extensible import/export/codec subsystem and deterministic export pipeline for common professional/game formats, broad WAV variants, metadata, multichannel layouts, presets/expert controls, and collision-safe destinations.

## User-Visible Outcome

Users can import common audio formats, render projects/regions through the canonical engine, and export high-quality game/professional files using presets or detailed expert settings.

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

- [ ] Codec registry/abstraction
- [ ] FLAC/MP3/Ogg Vorbis/Opus/AAC-M4A import, the compressed encodings WAV and AIFF-C can carry, and WAV/AIFF/FLAC/MP3/Ogg Vorbis/Opus/AAC-M4A export, where legally/technically viable (uncompressed WAV and AIFF reading is Phase 05's, `ADR-0050`)
- [ ] WAV integer/float bit depths and sample rates for writing
- [ ] Multichannel metadata/layout preservation
- [ ] Metadata/loop metadata
- [ ] Import analysis/progress/cancellation for the formats this phase adds, and batch import
- [ ] Export quality/expert controls
- [ ] Collision policy
- [ ] Deterministic/application-owned codecs where required
- [ ] Streaming/chunked I/O

## Explicitly Out of Scope

- Godot-specific live export semantics
- Batch variation generation
- Cloud encoding
- Importing uncompressed WAV and AIFF at the native rate, opening the project's assets in the editor, and moving the markers and regions into the project, which are Phase 05's (`ADR-0050`, amending `ADR-0021`)

## Owned Modules / Packages

- `packages/codecs` (created by Phase 05 with the read contract and the uncompressed PCM readers; Phase 07 adds the recorded-media WAV writer, 32-bit float PCM and RF64, `ADR-0071`; this phase adds its registry, decoders and every other writer, building its WAV writing on Phase 07's, `ADR-0050` amended)
- `packages/import-export`
- `packages/export-recipes core`
- `crates/codec-* as selected`
- `packages/storage destination adapters`

## Cross-Package Dependency Rules

- Codec modules consume audio-stream contracts and storage destinations through public interfaces.
- Game/Godot-specific policy layers may depend on generic export contracts, not the reverse.

## Required Public Contracts

- CodecDescriptor
- CodecCapability
- ImportJob
- ExportJob
- AudioFormatDescriptor (introduced by Phase 05, `ADR-0050`; extended here)
- MetadataMap
- ExportSettings
- CollisionPolicy

## Data / Schema Changes

- Introduces codec descriptors/capability metadata, import/export job state, typed export settings, metadata/loop metadata mappings and collision-policy records.

## Browser / Platform Considerations

- Native codec availability differs by browser; local fallback implementations are required where selected support demands them.
- External destination filesystem access is capability/permission-sensitive.

## Architectural Invariants

- Codec availability is capability-detected.
- Lossy/native browser codecs are not assumed universally.
- Final render uses canonical processing before encoding.
- Unsupported formats fail explicitly with alternatives.
- Exports never silently overwrite unless user policy explicitly allows it.

## Internal Work Units

### WU-09.A — Codec contracts and WAV

- [ ] Implement the registry and capability descriptors over Phase 05's read contract, and the streaming write interface
- [ ] Implement comprehensive WAV writing on Phase 07's recorded-media writer (`ADR-0071`), the compressed encodings WAV can carry, and WAV metadata and loop metadata on read and write

### WU-09.B — Common codecs

- [ ] Integrate legal/open-source codec implementations and browser acceleration where compatible
- [ ] Implement capability/licence documentation and deterministic-path rules

### WU-09.C — Import/export jobs

- [ ] Implement progress/cancellation/worker execution
- [ ] Implement resample/bit-depth/dither/channel conversion hooks and maximum-quality default

### WU-09.D — Presets/expert settings and destinations

- [ ] Implement preset layer over full settings
- [ ] Implement collision policies, trusted overwrite options and metadata controls

## Failure and Recovery Behaviour

- Malformed/untrusted media must be validated and fail without corrupting project state.
- Partial export must not be reported as successful.
- Destination permission loss/collision must preserve source/project and offer retry/new destination.

## Required Verification Commands / Suites

- `pnpm test --filter codecs --filter import-export`
- `cargo test --workspace`
- `pnpm test:codec-fixtures`
- `pnpm test:roundtrip-audio`
- `pnpm test:malformed-media`

## Acceptance Criteria

- [ ] Supported lossless formats round-trip within expected bit/sample semantics.
- [ ] WAV matrix covers required bit depths, float/integer, sample rates, mono/stereo/N-channel and loop metadata.
- [ ] Import/export does not require loading entire long files into duplicated memory.
- [ ] Preset and expert settings resolve to the same typed export settings model.
- [ ] Collision policies are deterministic and safe by default.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No extension-only format detection.
- No silent lossy transcoding.
- No browser codec as the sole path for a format where cross-browser support is required and a local fallback is viable.

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

## Handoff Capsule

Create `traceability/handoffs/phase-09.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
