# Phase 02 — Project and Storage System

## Status

`NOT_READY` — blocked by Phase(s) 01 reaching `PASS`.

## Objective

Implement the authoritative project, persistence, history, storage, backup, recovery, external-media identity, and single-writer ownership subsystems without depending on later audio-editing UI.

## User-Visible Outcome

Users can create/open/save/backup/fork portable and unpacked AudioGubbins projects safely, with crash-resistant command history, snapshots, deduplicated media, external links, ownership locking, schema policy, and explicit cleanup.

## Hard Dependencies

- Phase 01 — Application Foundation

## Owned Requirements

- `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery (`CURRENT`)
- `REQ-STOR-025` — Storage Model (`CURRENT`)
- `REQ-STOR-026` — Project Format (`CURRENT`)
- `REQ-STOR-027` — Cache Model (`CURRENT`)
- `REQ-STOR-052` — Project Schema Compatibility Policy (`CURRENT`)
- `REQ-STOR-053` — External Source Change Policy (`CURRENT`)
- `REQ-STOR-055` — Undo/Redo Retention Policy (`CURRENT`)
- `REQ-STOR-098` — Concurrent Project Access and Single-Writer Ownership (`CURRENT`)
- `REQ-STOR-099` — Content-Addressed Media Storage and Deduplication (`CURRENT`)
- `REQ-STOR-101` — Command Journal and Immutable Snapshot Persistence (`CURRENT`)
- `REQ-STOR-102` — Deleted Media Retention and Explicit Purge (`CURRENT`)
- `REQ-STOR-103` — Git-Friendly Unpacked Project Format (`CURRENT`)
- `REQ-STOR-104` — External Source Identity and Integrity Tracking (`CURRENT`)
- `REQ-STOR-105` — Automatic Backup Generations (`CURRENT`)
- `REQ-STOR-106` — Storage Cleanup Priority (`CURRENT`)
- `REQ-STOR-166` — Asset Provenance and Traceability (`CURRENT`)
- `REQ-STOR-193` — Branching Project History (`CURRENT`)
- `REQ-STOR-194` — Named Project Snapshots (`CURRENT`)
- `REQ-STOR-195` — Whole-Project A/B State Comparison (`CURRENT`)
- `REQ-STOR-196` — History Workspace Panel (`CURRENT`)
- `REQ-STOR-197` — Export Provenance in Project History (`CURRENT`)
- `REQ-STOR-198` — External Side Effects and Undo Semantics (`CURRENT`)
- `REQ-STOR-199` — Project Forks from Historical State (`CURRENT`)
- `REQ-STOR-200` — History Storage Inspection and Compaction (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-PROD-038` — Cloud Extensibility (`DEFERRED`)
- `REQ-STOR-100` — Project Encryption Scope (`EXCLUDED`)

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

- [ ] Versioned project schema
- [ ] OPFS/internal storage abstraction
- [ ] External source references and integrity tracking
- [ ] Content-addressed media store/deduplication
- [ ] Command journal and immutable snapshots
- [ ] Branching history and named snapshots
- [ ] Single-writer multi-tab ownership
- [ ] Autosave/recovery and backup generations
- [ ] Portable bundle and Git-friendly unpacked project format
- [ ] Pre-1.0 incompatibility backup/wipe flow
- [ ] Deleted-media retention and explicit purge
- [ ] Storage inspection/compaction
- [ ] Project provenance

## Explicitly Out of Scope

- Audio decoding/rendering
- Waveform editor
- Cloud sync
- Encryption
- Live collaboration

## Owned Modules / Packages

- `packages/project-format`
- `packages/storage`
- `packages/history`
- `packages/media-store`
- `packages/domain/project`
- `packages/commands/project`

## Cross-Package Dependency Rules

- Storage depends on domain/project-format contracts, not UI.
- Project domain does not depend on OPFS/File System Access API directly.
- History may reference command/domain IDs but not renderer/UI internals.

## Required Public Contracts

- Project schema + runtime validator
- ProjectRepository
- MediaObjectStore
- ExternalSourceIdentity
- CommandJournal
- SnapshotStore
- ProjectWriteLease
- PortableBundle manifest
- BackupPolicy

## Data / Schema Changes

- Introduces authoritative project schema, command-journal records, snapshots, media-object metadata, external-source identity, portable bundle manifest, unpacked project representation, backup metadata and write-lease state.
- Before 1.0, breaking schema changes use the explicit backup/reset policy rather than migration shims.

## Browser / Platform Considerations

- OPFS and external filesystem capabilities require adapters/capability checks.
- Storage quota/persistence semantics differ by browser; no fixed quota assumption.
- Project core must work without direct folder APIs.

## Architectural Invariants

- Caches are never authoritative.
- Deleting an asset does not destroy bytes still reachable from history/snapshots/backups.
- One project has at most one writer per storage context.
- External file changes never silently invalidate edits under the default policy.
- Pre-1.0 breaking schemas do not accumulate migration shims.

## Internal Work Units

### WU-02.A — Project model and schema

- [ ] Define stable IDs and runtime-validated project schema
- [ ] Implement pre-1.0 compatibility/reset flow
- [ ] Separate project data from workspace/user preferences

### WU-02.B — Storage and media

- [ ] Implement OPFS/internal adapters and external-reference adapters
- [ ] Implement content-addressed media store and reachability accounting
- [ ] Implement progressive fingerprints and source-change policies

### WU-02.C — Journal, snapshots and branches

- [ ] Persist typed command journal transactionally
- [ ] Implement immutable snapshots, branching history, named snapshots and project forks
- [ ] Implement history inspection and compaction

### WU-02.D — Safety and portability

- [ ] Implement single-writer lease/ownership transfer
- [ ] Implement autosave, crash recovery and backup generations
- [ ] Implement portable bundle and deterministic unpacked Git-friendly project formats

### WU-02.E — Cleanup and provenance

- [ ] Implement soft deletion, retained-media explanation and explicit purge
- [ ] Implement storage usage breakdown and cleanup priority
- [ ] Persist asset/export provenance without coupling to UI

## Failure and Recovery Behaviour

- Quota exhaustion must never corrupt the last valid project state.
- Interrupted writes must recover to a validated prior/new transaction boundary.
- Stale write leases must be detectable and recoverable.
- Broken external links must preserve project metadata and offer relink/adopt/freeze choices.

## Required Verification Commands / Suites

- `pnpm test --filter project-format --filter storage --filter history`
- `pnpm test:recovery`
- `pnpm test:project-roundtrip`
- `pnpm test:storage-quota`
- `pnpm test:architecture`

## Acceptance Criteria

- [ ] Randomised/property project round-trips preserve authoritative state.
- [ ] Crash injection at every persistence transaction boundary never yields a silently corrupt project.
- [ ] Two-tab tests enforce single-writer ownership and safe transfer.
- [ ] Identical media imported into multiple projects deduplicates without breaking self-contained export.
- [ ] Named snapshots, branches, A/B states and forks survive reload.
- [ ] Deleted media remains recoverable until explicit purge/compaction makes it unreachable.
- [ ] Pre-1.0 incompatible schema flow permits backup then explicit wipe; no migration shim is added.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No project state stored only in React/browser UI state.
- No path/filename-only external identity.
- No immediate byte deletion merely because an asset is removed from current state.
- No encryption subsystem.

## Required Review Lenses

- Architecture
- Data Integrity / Recovery
- Security / Privacy
- Testing / Regression
- Performance / Storage
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

Create `traceability/handoffs/phase-02.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
