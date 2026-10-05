# Phase 05 — Core Non-Destructive Editing

## Status

`PASS` — completed on 2026-10-05; see `reviews/phase-05-evidence.md`, `reviews/phase-05-review.md` and `traceability/handoffs/phase-05.md`.

## Objective

Implement the core non-destructive edit model and user workflows over project assets and regions, using typed commands, explicit selections, immutable source media, and branchable undo/history. Audio enters a project by import, read by AudioGubbins' own readers at the rate it was recorded at, so the regions, edit operations and markers made on it are kept in the project (`ADR-0050`).

## User-Visible Outcome

Users can import WAV and AIFF files into a project, copied or linked as they choose, where each keeps the rate, depth and channels it was recorded with. They can Quick Edit or use projects to create regions, trim/split/copy/paste/move/adjust channel content non-destructively, place markers, undo/redo/branch history, and inspect all resulting operations without modifying source media, and find all of it again after a reload.

## Hard Dependencies

- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation

## Owned Requirements

- `REQ-EDIT-008` — Editing Modes (`CURRENT`)
- `REQ-EDIT-014` — Regions (`CURRENT`)
- `REQ-EDIT-015` — Channel Editing (`CURRENT`)
- `REQ-AUDIO-220` — Native-Rate Reading of Uncompressed Audio (`CURRENT`)

### Requirements Consumed From Other Phases

Owned elsewhere; this phase delivers the part named, or keeps what it asks.

- `REQ-AUDIO-010` — Format Support (Phase 09): `REQ-AUDIO-220` was split from it, and Phase 09's codecs extend the read contract this phase introduces.
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate (Phase 03): every imported asset keeps its native rate.
- `REQ-EDIT-012` — Timeline and Editing Requirements (Phase 04): markers and regions become project state.
- `REQ-EDIT-061` — Multiple Views of the Same Asset (Phase 04): a change to the project reaches every view of the asset.
- `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery (Phase 02): markers, regions and edit operations undo with the project's history.
- `REQ-STOR-025` — Storage Model (Phase 02): import from the interface by copy or link, as the person's setting says.
- `REQ-STOR-052` — Project Schema Compatibility Policy (Phase 02): the project's schema version is raised for the new persisted content, with no migration before 1.0.
- `REQ-STOR-104` — External Source Identity and Integrity Tracking (Phase 02): a linked source is tracked by its identity, with its change policy.
- `REQ-STOR-166` — Asset Provenance and Traceability (Phase 02): the source's rate, bit depth, channel layout and duration, which Phase 02 deferred to the import.
- `REQ-STOR-195` — Whole-Project A/B State Comparison (Phase 02): auditioning the two states, which Phase 02 deferred until a project holds audio.

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

- [ ] Quick Edit facade over project model
- [ ] Region/clip domain
- [ ] Selection-first command targeting
- [ ] Core edit operation graph
- [ ] Clipboard semantics
- [ ] Trim/split/cut/copy/paste/delete/silence/fades/gain primitives
- [ ] Per-channel editing and channel conversion commands
- [ ] Inspector integration
- [ ] Undo/redo/history integration
- [ ] Native-rate reading of uncompressed WAV and AIFF (`REQ-AUDIO-220`): the read contract in `packages/codecs`, recognition by content, `AudioFormatDescriptor`, and chunked, cancellable reading off the UI thread (`ADR-0050`)
- [ ] Importing audio into the open project from the interface through Phase 02's import pipeline, copied or linked by the person's setting, with the source's audio shape in its provenance
- [ ] Opening the project's assets in the editor, played by the feeder, rendered by the render worker and drawn from the peak worker at their native rate
- [ ] Markers and regions as project state, changed by project commands with the same inverses, and the session's in-memory holder (`apps/web/src/state/session-content.ts`) removed (`ADR-0047`, `ADR-0021`, `ADR-0050`)
- [ ] Auditioning the two states of an A/B comparison (`REQ-STOR-195`)

## Explicitly Out of Scope

- Full DSP effect rack
- Spectral editing
- Recording
- Batch automation
- Export and every audio writer, the compressed formats and their decoders, a file's metadata and loop metadata, and batch import (Phase 09, `ADR-0050`)

## Owned Modules / Packages

- `packages/domain/editing`
- `packages/commands/editing`
- `packages/clipboard`
- `apps/web editor commands/inspector adapters`
- `packages/codecs` (the read contract and the uncompressed PCM readers; Phase 09 extends it, `ADR-0050`)
- `apps/web import flow and project asset adapters`

## Cross-Package Dependency Rules

- Editing commands depend on project/history/audio contracts, not storage implementations.
- UI/Inspector only invokes public commands; no alternate edit path.
- `packages/codecs` takes its bytes through an injected port and depends on the domain alone; the import flow reaches storage only through `StorageClient` (`ADR-0022`).

## Required Public Contracts

- EditOperation
- Region
- RegionBoundary
- EditTarget
- ClipboardPayload
- ChannelEditOperation
- QuickEditSession
- AudioFormatDescriptor
- AudioReader (format recognition by content and native-rate frame reading)

## Data / Schema Changes

- Introduces persisted edit-operation, region, clipboard/interchange and channel-edit operation representations.
- Introduces persisted markers, and records each imported asset's audio shape (rate, bit depth, sample encoding, channel layout, duration) in its provenance.
- Raises the project's schema version for this content; before 1.0 nothing migrates (`REQ-STOR-052`).
- Settled by this phase's readiness review (`ADR-0050`, amending `ADR-0021`): native-rate reading of uncompressed audio is brought forward from Phase 09, so regions, edit operations and markers are persisted on the project's own assets from this phase on.

## Browser / Platform Considerations

- Editing semantics must be identical across mouse/keyboard/touch/pen; gesture/UI differences cannot change domain outcomes.
- The browser's audio decoder resamples and reports no rate, so it never reads an imported file (`REQ-AUDIO-220`).

## Architectural Invariants

- Original source bytes are unchanged.
- If a valid selection exists, commands apply to that selection; otherwise to the documented whole target.
- Edit graph/history is authoritative, not rendered intermediates.
- Every edit is transactionally undoable unless explicitly external side effect.
- Every asset keeps its native rate; nothing is resampled on import.
- A file is never held whole in memory to be imported, played or drawn.
- Markers and regions exist only in the project; audio that is not a project asset carries none, and the marker and region tools say why on it.

## Internal Work Units

### WU-05.A — Region/edit domain

- [ ] Implement region identity/boundaries/metadata
- [ ] Implement immutable parametric edit-operation representation

### WU-05.B — Editing commands

- [ ] Implement trim/split/delete/copy/cut/paste/silence/fade/gain/invert/reverse primitives as appropriate to this phase
- [ ] Implement explicit selection target resolution

### WU-05.C — Channel operations

- [ ] Implement per-channel selection/edits
- [ ] Implement swap/copy/downmix/upmix/remap commands using layout-aware contracts

### WU-05.D — UX integration

- [ ] Implement Quick Edit flow over normal project internals
- [ ] Connect Inspector/direct manipulation to identical command paths
- [ ] Expose branchable undo/redo/history results

### WU-05.E — Native-rate import

- [ ] Implement the read contract and the WAV (plain, `WAVE_FORMAT_EXTENSIBLE`, RF64, BW64) and AIFF/AIFF-C readers for every encoding `REQ-AUDIO-220` names
- [ ] Run the import pipeline from the interface with the copy-or-link setting, recording the audio shape in provenance
- [ ] Open project assets in the editor, the audio engine and the peak worker
- [ ] Move markers and regions into the project, and remove the session holder and the sentence that says markers are not kept
- [ ] Audition the two states of an A/B comparison through the audio engine

## Failure and Recovery Behaviour

- Invalid selections/region boundaries fail atomically with actionable errors.
- Clipboard data from missing/relinked media must not corrupt destination project.
- Edits referencing changed external media must invoke the source-change policy.
- An unsupported, malformed or hostile file is refused before anything is stored, naming its format and the formats that can be read, and leaves the project unchanged.
- A file whose audio data ends before its declared length is read to its last whole frame, and the shortfall reported.
- A cancelled import keeps nothing.

## Required Verification Commands / Suites

- `pnpm test --filter editing --filter commands`
- `pnpm test:editing-property`
- `pnpm test:e2e:core-editing`
- `pnpm test:project-roundtrip`
- `pnpm test --filter codecs`
- `pnpm test:codec-fixtures`
- `pnpm test:malformed-media`

## Acceptance Criteria

- [ ] All core edits survive save/reload and full undo/redo/branch traversal.
- [ ] Source-content hashes are unchanged after non-destructive editing.
- [ ] Selection-first targeting is covered by direct tests for every edit command.
- [ ] Per-channel edits preserve channel-role metadata.
- [ ] Quick Edit and Project Mode produce the same underlying project/edit structures.
- [ ] Every WAV and AIFF encoding, depth, byte order and form `REQ-AUDIO-220` names reads to the expected samples at its native rate, from fixtures, without resampling.
- [ ] Malformed, truncated and unsupported files fail, or are read, as `REQ-AUDIO-220` says, without changing the project.
- [ ] An imported asset's markers, regions and edit operations survive save/reload and undo/redo/branch traversal, and the session holder no longer exists.
- [ ] An imported asset records its rate, bit depth, channel layout and duration in its provenance, and its source bytes are unchanged, copied or linked.
- [ ] The two states of an A/B comparison can be auditioned without changing either.
- [ ] A browser test imports a file, marks and edits it, reloads, and finds the same project.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No destructive in-place source rewrite.
- No separate Quick Edit domain model.
- No UI-only edit logic.
- No hidden rendered PCM treated as source of truth.
- No browser decoder reading an imported file, and no resampling on import.
- No extension-only format detection.
- No second read contract beside the one in `packages/codecs`.

## Required Review Lenses

- Architecture
- Audio Correctness
- Data Integrity / Recovery
- UX / Accessibility
- Testing / Regression
- Code Quality / Maintainability
- Codec / Interchange Correctness
- Security / Malformed Input
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Inherited Debt

Assigned to this phase by the Phase 02 review (`reviews/phase-02-review.md`) and its handoff, or passed to it by `ADR-0050`:

- F-46: the project session adds unwritten states to its writer's collections directly.
- F-55, the rest: the date formatter, `counted`, the copy of the project listing in the media roots, and CRC-32 in the waveform codec, each written twice.
- F-56: the notable-recovery check and the recovery sentences list the same fields apart, new-project defaults live in two places, and the comparison-close rule lives in storage.
- F-42 (from Phase 09, by `ADR-0050`): the wiring that keeps the stored peak cache to a ready storage root is untested at the project system.
- F-53, the reserved key (from Phase 09, by `ADR-0050`): the kept-handle token rule accepts the backups folder's reserved key, which a linked file brought in from the interface must not take.
- The source's audio shape (`REQ-STOR-166`) and the A/B audition (`REQ-STOR-195`) that Phase 02 deferred to the import, listed under In Scope.

Phase 09 keeps F-51 (a bundle import's caches) and Phase 04's bound on the channels of a reference picture's sound, which the browser still decodes.

## Handoff Capsule

Create `traceability/handoffs/phase-05.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
