# Phase 05 — Core Non-Destructive Editing

## Status

`NOT_READY` — blocked by Phase(s) 02, 03, 04 reaching `PASS`.

## Objective

Implement the core non-destructive edit model and user workflows over project assets and regions, using typed commands, explicit selections, immutable source media, and branchable undo/history.

## User-Visible Outcome

Users can Quick Edit or use projects to create regions, trim/split/copy/paste/move/adjust channel content non-destructively, undo/redo/branch history, and inspect all resulting operations without modifying source media.

## Hard Dependencies

- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation

## Owned Requirements

- `REQ-EDIT-008` — Editing Modes (`CURRENT`)
- `REQ-EDIT-014` — Regions (`CURRENT`)
- `REQ-EDIT-015` — Channel Editing (`CURRENT`)

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

## Explicitly Out of Scope

- Full DSP effect rack
- Spectral editing
- Recording
- Batch automation

## Owned Modules / Packages

- `packages/domain/editing`
- `packages/commands/editing`
- `packages/clipboard`
- `apps/web editor commands/inspector adapters`

## Cross-Package Dependency Rules

- Editing commands depend on project/history/audio contracts, not storage implementations.
- UI/Inspector only invokes public commands; no alternate edit path.

## Required Public Contracts

- EditOperation
- Region
- RegionBoundary
- EditTarget
- ClipboardPayload
- ChannelEditOperation
- QuickEditSession

## Data / Schema Changes

- Introduces persisted edit-operation, region, clipboard/interchange and channel-edit operation representations.
- Persisting a region or an edit needs an asset of the project the editor opens, which needs audio imported at its native rate, Phase 09's (`ADR-0021`). The readiness review settles, by a change record, whether native-rate reading is brought forward into this phase or its region editing stays the session's until Phase 09.

## Browser / Platform Considerations

- Editing semantics must be identical across mouse/keyboard/touch/pen; gesture/UI differences cannot change domain outcomes.

## Architectural Invariants

- Original source bytes are unchanged.
- If a valid selection exists, commands apply to that selection; otherwise to the documented whole target.
- Edit graph/history is authoritative, not rendered intermediates.
- Every edit is transactionally undoable unless explicitly external side effect.

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

## Failure and Recovery Behaviour

- Invalid selections/region boundaries fail atomically with actionable errors.
- Clipboard data from missing/relinked media must not corrupt destination project.
- Edits referencing changed external media must invoke the source-change policy.

## Required Verification Commands / Suites

- `pnpm test --filter editing --filter commands`
- `pnpm test:editing-property`
- `pnpm test:e2e:core-editing`
- `pnpm test:project-roundtrip`

## Acceptance Criteria

- [ ] All core edits survive save/reload and full undo/redo/branch traversal.
- [ ] Source-content hashes are unchanged after non-destructive editing.
- [ ] Selection-first targeting is covered by direct tests for every edit command.
- [ ] Per-channel edits preserve channel-role metadata.
- [ ] Quick Edit and Project Mode produce the same underlying project/edit structures.

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

## Required Review Lenses

- Architecture
- Audio Correctness
- Data Integrity / Recovery
- UX / Accessibility
- Testing / Regression
- Code Quality / Maintainability
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-05.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
