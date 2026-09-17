# AudioGubbins Phase 02 Context Pack

> **Generated artefact. Do not edit.**
> This is the bounded context intended for a fresh implementation/review agent. Canonical source remains the modular specification.

# Global Agent Execution Contract

# Agent Execution Contract

> **Normative authority:** `requirements/execution.md`, especially `REQ-EXEC-136`, `REQ-EXEC-167` through `REQ-EXEC-184`, and `REQ-EXEC-201` through `REQ-EXEC-219`.
>
> This contract is loaded for every implementation and review context. It is intentionally concise; referenced requirement IDs contain the complete normative detail.

## Non-Negotiable Rules

1. Implement only from a **READY** Phase Packet. Do not infer a phase from the compiled specification.
2. Do not reduce, postpone, stub, fake, or reinterpret scope because it is difficult.
3. If a requirement is impossible, contradictory, or unsafe, use the deviation protocol in `REQ-EXEC-168`; do not silently change it.
4. UI code must not mutate authoritative project state outside the typed command/domain boundary.
5. Do not create god objects, catch-all managers, giant stores, universal event buses, hidden global state, or speculative generic frameworks.
6. Do not use YAGNI, DRY, KISS, SOLID, or named patterns as slogans. Apply them only when they preserve documented capability and cohesion.
7. A production `TODO`, `FIXME`, `HACK`, placeholder, dummy implementation, `Not implemented` branch, or silent fallback is a gate failure unless explicitly authorised by the current Phase Packet.
8. Do not weaken tests, update golden data without evidence, mock away the behaviour under test, or suppress failures.
9. Refactor touched architecture when necessary to preserve boundaries. Do not perform unrelated sweeping rewrites.
10. Significant architectural decisions require an ADR and adversarial review.
11. Work in isolated Git worktrees when agents run concurrently. Integrate using atomic commits and direct merge into `main`; do not assume a PR workflow.
12. The implementing agent cannot approve its own phase. Independent multi-lens and adversarial review is mandatory.
13. Reviewer findings are hypotheses until verified. Verified genuine findings must be remediated according to severity before PASS.
14. Every requirement claimed complete must have evidence and a verification mechanism.
15. Never rely on the full compiled specification being resident in context. Load the Phase Context Pack and retrieve extra requirements by ID as needed.

## Mandatory Context Load Order

1. This contract.
2. `architecture-invariants.md`.
3. Current `phases/phase-XX-*.md`.
4. Requirement blocks named in that Phase Packet.
5. Referenced ADRs.
6. Public contracts and handoff capsules from prerequisite phases.
7. Relevant implementation-ledger entry.

## Stop Conditions

The agent must stop the current implementation path and mark the phase `BLOCKED` when:

- a blocker/critical contradiction cannot be resolved from authoritative sources;
- an upstream public contract is missing or incompatible;
- data integrity would be put at risk;
- a mandatory requirement is technically impossible and no approved fallback exists;
- the Phase Packet itself fails specification linting.

Stopping a path is not permission to abandon the phase. Record the issue, evidence, and recommended resolution.

# Global Architecture Invariants

# Global Architecture Invariants

These invariants apply to every phase. Violations are gate failures unless an approved ADR/specification change explicitly supersedes the invariant.

## State and Domain

- `REQ-ARCH-004`: source media is immutable by default; editing is non-destructive and parametric.
- `REQ-EDIT-073`: meaningful project mutations go through the typed command/domain layer.
- `REQ-ARCH-153`: authoritative domain, persisted history, user preferences, workspace/view state, renderer state, audio runtime state, and background-job state have explicit owners and lifetimes.
- Domain truth has one authoritative home. UI, persistence, workers, and Godot integrations may adapt domain results but must not reimplement rules independently.

## Dependency Direction

- UI depends on application/domain contracts, never persistence internals.
- Domain packages do not import browser-specific adapters.
- Persistence schemas do not become the domain model.
- DSP/audio domains do not depend on React or visual renderer internals.
- Godot integration consumes stable interchange contracts and does not reach into unrelated web-editor internals.
- Cross-package access uses public typed APIs; importing private package internals is prohibited.
- Circular package dependencies are prohibited.

## Media and Processing

- `REQ-ARCH-157`: the core channel model is N-channel and layout-aware; stereo assumptions are local adaptations only.
- `REQ-ARCH-049` and `REQ-ARCH-081`: deterministic canonical processing is the target for final render paths.
- `REQ-ARCH-144`: processor latency is explicit and compensable.
- Heavy analysis, DSP, codecs, waveform generation, spectrogram generation, import/export, and batch work must not block the UI thread.
- Derived waveform/spectrogram/render data is disposable cache, never the sole authoritative project state.

## Local-First and Privacy

- Core editing and rendering remain local and offline-capable.
- No diagnostics, logs, project metadata, capability data, audio, or other user data is transmitted without explicit permission.
- No usage analytics.
- Future cloud/native-host/plugin capabilities remain optional and cannot become hidden core dependencies.

## Failure and Recovery

- Errors have explicit recoverability semantics; blanket catches and silent fallback are prohibited.
- Project mutations and persistence operations protect data integrity across crash, tab termination, quota failure, and partial I/O.
- External side effects are never falsely represented as undoable.

## Extensibility Without Speculation

- Preserve explicitly documented future multitrack, plugin, cloud, and native-host extension boundaries.
- Do not implement speculative user-facing future features before their owning phase.
- Extension points must be concrete and narrow, not universal frameworks.

## Cohesion

- Files approaching 300–400 logical lines and functions approaching 50–70 logical lines trigger cohesion review; thresholds are not automatic failures or code-golf targets.
- Large fan-in/fan-out, giant stores, deep inheritance, unrelated responsibilities, and repeated domain conditionals trigger architectural review.

# Current Phase Packet

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

# Referenced Requirement Blocks

## REQ-STOR-021 — Undo, Redo, Autosave, and Recovery

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 21 of the pre-hardening baseline

Undo/redo should be effectively unlimited subject to available storage and practical performance.

Avoid arbitrary small undo limits.

Project history should be persisted where practical.

The application shall support:

- Continuous autosave
- Crash recovery
- Tab/process termination recovery
- Restoration of recent working state
- Transaction-safe project updates where practical

---

## REQ-STOR-025 — Storage Model

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 25 of the pre-hardening baseline

The application should use a hybrid storage model.

Working project data should primarily use browser-managed persistent storage such as OPFS where available.

The system should support:

- Internal project storage
- External file references
- Imported copies
- Portable project bundles
- User-configurable source handling
- Capability-based directory access

The user should be able to choose whether imported source assets are:

- Copied into managed project storage
- Referenced externally

The application should clearly explain trade-offs.

---

## REQ-STOR-026 — Project Format

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 26 of the pre-hardening baseline

The application must use an application-owned, documented, versioned project format.

The project format should be:

- Structured
- Portable
- Extensible
- Versioned
- Migration-capable
- Documented
- Suitable for external tooling in the future

The format may use:

- JSON or similar structured metadata
- Binary asset data
- Media files
- Optional caches

Portable project bundles should support moving projects between devices or browsers.

---

## REQ-STOR-027 — Cache Model

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 27 of the pre-hardening baseline

Derived artefacts should be disposable.

Examples:

- Waveform peaks
- Spectrogram tiles
- Preview renders
- Proxy audio
- Temporary renders
- Intermediate processing results

Loss or corruption of cache data must not invalidate the authoritative project.

Caches should be regenerable.

---

## REQ-STOR-052 — Project Schema Compatibility Policy

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 52 of the pre-hardening baseline

#### Pre-1.0.0

Before version 1.0.0, the project and storage schemas are explicitly allowed to break.

The application must not accumulate backwards-compatibility shims or migration code during this period.

When a breaking schema change is detected, the application shall present a blocking compatibility screen that clearly explains that the current stored data is incompatible with the new schema.

The user must be able to choose, where technically possible, to:

- Back up/export current data before proceeding
- Cancel and remain on the current state
- Proceed and wipe incompatible local application data

After wipe, the application shall initialise storage using the current schema.

#### Version 1.0.0 and Later

From 1.0.0 onward, backwards-compatible project/schema migration becomes a supported product responsibility.

Migration infrastructure should then include:

- Versioned schemas
- Explicit migration steps
- Validation
- Recovery/failure handling
- Migration tests
- Preservation of user project data wherever technically possible

---

## REQ-STOR-053 — External Source Change Policy

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 53 of the pre-hardening baseline

When a project references an external source file and that source changes outside the application, the default behaviour shall be to detect the mismatch and ask the user how to proceed.

The application should support configurable policies, including:

- Prompt on change
- Adopt the new external version
- Preserve/freeze the prior known version where possible
- Re-link to another file

Silent adoption must not be the default because external changes can invalidate non-destructive edit assumptions.

---

## REQ-STOR-055 — Undo/Redo Retention Policy

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 55 of the pre-hardening baseline

Undo/redo history should be effectively unlimited subject to available storage and application stability.

Retention must be user-configurable.

Supported policies should include:

- Unlimited until manually compacted/pruned
- User-defined storage budget
- Automatic compaction rules
- Protected recovery snapshots

The default should favour strong reversibility while clearly surfacing storage impact.

---

## REQ-STOR-098 — Concurrent Project Access and Single-Writer Ownership

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 98 of the pre-hardening baseline

AudioGubbins shall use a single-writer ownership model for any one project within a browser/profile storage context.

At most one application instance may hold authoritative write ownership for a project at a time.

Other tabs or windows attempting to open the same project should be able to:

- Open the project read-only where safe
- See which instance currently owns write access where identifiable
- Request ownership transfer
- Take ownership after an explicit user decision where the existing owner is unavailable or stale
- Refresh into the latest authoritative state after ownership changes

Write ownership must use robust coordination primitives available to the platform and must fail safely when coordination is unavailable.

The application must not attempt implicit same-project collaborative editing between browser tabs as part of the initial architecture.

Future collaborative or multi-writer editing, if ever implemented, shall be treated as a distinct feature with an explicit conflict/merge model rather than being layered accidentally onto the local persistence mechanism.

---

## REQ-STOR-099 — Content-Addressed Media Storage and Deduplication

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 99 of the pre-hardening baseline

AudioGubbins should support internal content-addressed media storage so that byte-identical imported source media can be shared across multiple local projects without unnecessary duplication.

The deduplication system should:

- Identify identical media by cryptographic content identity rather than filename
- Preserve logical project ownership/reference metadata independently of physical storage
- Maintain reference counts or equivalent reachability information
- Never remove media that is still reachable from an active project, retained history, backup, recovery state, or protected snapshot
- Support deterministic garbage collection
- Remain transparent to ordinary project editing workflows

Deduplication is an internal storage optimisation and must not prevent projects from being exported as fully self-contained portable bundles.

Users should be able to request project consolidation/materialisation when they want all linked/shared media copied into a self-contained project representation.

---

## REQ-STOR-101 — Command Journal and Immutable Snapshot Persistence

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 101 of the pre-hardening baseline

Project persistence shall use a command-journal plus periodic immutable-snapshot architecture rather than rewriting one monolithic project state on every change.

The persistence model should support:

- Ordered durable command/event records
- Transaction boundaries
- Periodic immutable snapshots of authoritative state
- Fast startup from the latest valid snapshot plus subsequent journal replay
- Validation of journal records before application
- Recovery from partially written or invalid tail records
- Effectively unlimited undo/redo subject to configured retention policy and available storage
- Future deterministic macro/replay functionality
- Auditability for diagnostics without requiring telemetry
- Safe compaction into newer snapshots

The implementation must distinguish clearly between:

- Authoritative project state
- Undo/redo history
- Recovery journal
- User backups
- Disposable caches

A failure in one layer must not unnecessarily invalidate the others.

---

## REQ-STOR-102 — Deleted Media Retention and Explicit Purge

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 102 of the pre-hardening baseline

Removing an asset or media object from the current project state shall not immediately make the underlying source bytes unrecoverable if they are still referenced by undo history, recovery snapshots, backup generations, or other retained project state.

Deleted media should remain recoverable until it becomes unreachable under the active retention policy.

AudioGubbins shall provide an explicit purge/cleanup workflow allowing the user to reclaim storage intentionally.

The purge workflow should:

- Show the amount of reclaimable storage
- Explain which history, recovery, or backup capabilities would be affected
- Distinguish safe cache deletion from irreversible source/history deletion
- Allow selective or comprehensive cleanup
- Require explicit confirmation before irreversible purge
- Never delete media still required by reachable authoritative state

Automatic storage-pressure cleanup may aggressively remove disposable caches first, but must not silently purge recoverable source media or protected history.

---

## REQ-STOR-103 — Git-Friendly Unpacked Project Format

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 103 of the pre-hardening baseline

In addition to a normal portable project bundle, AudioGubbins shall support an optional unpacked project representation designed for developer workflows and source control.

The unpacked format should prioritise:

- Stable directory structure
- Deterministic serialisation
- Human-readable structured metadata
- Stable identifiers
- Minimal meaningless diff churn
- Clear separation between metadata and binary media
- Relative paths where practical
- Tool-independent inspectability
- Compatibility with Git-based workflows

Binary audio remains binary and may optionally be managed by Git LFS or another user-selected repository strategy; AudioGubbins must not require a specific source-control provider.

The unpacked format and the portable bundle must represent the same logical project model and should be convertible in both directions without semantic loss, excluding disposable caches unless explicitly requested.

---

## REQ-STOR-104 — External Source Identity and Integrity Tracking

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 104 of the pre-hardening baseline

Externally linked source media shall not be identified solely by filename or path.

AudioGubbins should track a combination of available identity signals, including where practical:

- Persistent filesystem handle or equivalent capability token
- File size
- Modification timestamp
- Media/container metadata
- Fast fingerprints
- Cryptographic content hashes

For very large media, full cryptographic hashing may be performed progressively in the background when immediate full hashing would harm responsiveness.

The project should retain enough identity information to distinguish:

- The same unchanged file
- A modified version of the same external file
- A moved/relinked copy with identical content
- A different file occupying the previous path

External-change detection must integrate with the configurable external-source change policy defined elsewhere in this specification.

---

## REQ-STOR-105 — Automatic Backup Generations

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 105 of the pre-hardening baseline

AudioGubbins shall support automatic project backup generations distinct from ordinary undo/redo history and crash-recovery journalling.

Backup policy should be user-configurable and may include:

- Time-based checkpoints
- Save/activity-based checkpoints
- Retention by count
- Retention by age
- Retention by storage budget
- Protected/manual checkpoints that are never automatically pruned

Where filesystem capabilities permit, the user may select an external backup directory for automatic backup generations.

Where direct directory access is unavailable, backups may remain in managed application storage and be exportable on demand.

Backup generations should favour authoritative project data and required media references/content rather than disposable caches.

The application should make the distinction between autosave, crash recovery, undo history, snapshots, and backups understandable to users without requiring them to understand the underlying persistence architecture.

---

## REQ-STOR-106 — Storage Cleanup Priority

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 106 of the pre-hardening baseline

When storage pressure occurs, AudioGubbins should reclaim data in a safety-first order.

The default cleanup priority should be approximately:

1. Regenerable temporary data
2. Old disposable render/analysis caches
3. Rebuildable waveform/spectrogram caches
4. Unprotected redundant intermediates
5. User-approved expired backup/history data according to retention policy
6. Explicitly purged deleted media

Authoritative project state and live source media must never be silently sacrificed to free storage.

Before any cleanup that reduces recoverability, AudioGubbins must explain the consequence and require the user or an explicitly configured policy to authorise it.

---

## REQ-STOR-166 — Asset Provenance and Traceability

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 166 of the pre-hardening baseline

AudioGubbins should retain structured provenance for assets and generated outputs so that developers and sound designers can determine how a game-ready audio file was produced.

Provenance may include:

- Original filename
- Original source reference/handle where appropriate
- Import date/time
- Source fingerprint/hash
- Source size and format
- Source sample rate, bit depth, channel layout, and duration
- Originating AudioGubbins project and project identifier
- Asset/region identifiers
- Processing graph and processor-version references
- Relevant render/export recipe identifier
- Export date/time
- Destination information
- Generated Godot resource identifiers
- Variation-set/event membership
- Application version used for render
- Determinism/render-quality mode
- ML model version where applicable

Provenance must be represented as structured project metadata rather than inferred from filenames.

Users must be able to strip or minimise provenance and embedded metadata during export where privacy, distribution, or file-size requirements make that desirable.

Provenance metadata must not require network services and must remain compatible with local-first operation.

For deterministic or Git-friendly project modes, provenance serialisation should use stable ordering and avoid meaningless timestamp churn where the timestamp itself is not semantically required.

---

## REQ-STOR-193 — Branching Project History

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 193 of the pre-hardening baseline

AudioGubbins shall use a branching history model rather than a traditional destructive linear redo stack.

If the user performs edits `A → B → C`, moves back to `A`, and then creates `D`, the historical `B → C` path must not be silently discarded merely because a new branch now exists.

The history model shall support:

- Branch-preserving command history.
- Navigation between historical branches.
- Stable identifiers for history nodes.
- Branch creation without duplicating immutable source media.
- Branch-aware retained-media/reference accounting.
- Safe restoration of historical project state.
- Integration with named snapshots.
- Integration with project forks.
- Clear distinction between current active history and retained alternative branches.

Branching history must remain an implementation detail of project-state evolution rather than leaking ad hoc branching logic into UI components.

---

## REQ-STOR-194 — Named Project Snapshots

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 194 of the pre-hardening baseline

Users shall be able to create explicit named project snapshots independently of ordinary undo/redo operations.

Snapshots may include:

- User-defined name.
- Optional notes/description.
- Creation timestamp.
- Author/application identity where relevant.
- Current active history node.
- Project-state fingerprint.
- Relevant export/provenance references.

Example snapshot names include:

- `Before aggressive denoise`
- `Approved game export`
- `Loop candidate B`
- `Client version 2`

Snapshots are immutable restore points unless the user explicitly deletes them.

---

## REQ-STOR-195 — Whole-Project A/B State Comparison

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 195 of the pre-hardening baseline

AudioGubbins shall support comparison and auditioning of complete historical project states, not only processor-level A/B comparison.

The user should be able to select two compatible snapshots/history states and:

- Switch rapidly between them.
- Audition the resulting audio.
- Compare processor chains and parameters.
- Compare region/marker/loop state.
- Inspect meaningful differences where practical.
- Promote either state to become the current working state without destroying the other.

Comparison state must not mutate either source snapshot merely by auditioning it.

---

## REQ-STOR-196 — History Workspace Panel

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 196 of the pre-hardening baseline

A dedicated professional History panel shall expose the persistent project-history model.

The panel should support, where appropriate:

- Command timeline/tree visualisation.
- Historical branches.
- Named snapshots.
- Current-state indication.
- Search/filtering.
- Affected asset/region indication.
- Restore/navigation actions.
- Snapshot creation.
- Branch naming where useful.
- Project-fork creation from a historical point.
- Storage impact inspection.
- History compaction/purge tools.

The panel must remain usable without requiring users to understand implementation-level command-journal internals.

---

## REQ-STOR-197 — Export Provenance in Project History

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 197 of the pre-hardening baseline

Export operations shall be recorded as provenance/history events but shall not be treated as ordinary reversible audio-edit mutations.

Export provenance should record, where applicable:

- Source project-state fingerprint/history node.
- Export recipe identifier/version.
- Render-engine/processor versions.
- Output format/settings.
- Target path or logical destination.
- Output fingerprint/hash where practical.
- Godot target/project linkage.
- Timestamp.
- Result status.

This shall allow a user to answer questions such as:

> Which project state and settings produced this game asset?

Normal Undo must not misleadingly imply that it can reliably remove or reverse arbitrary external filesystem side effects.

---

## REQ-STOR-198 — External Side Effects and Undo Semantics

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 198 of the pre-hardening baseline

Internal project edits that lead to an external operation remain fully subject to the normal non-destructive history model.

External side effects, such as writing or overwriting files in a Godot project, must use explicit transactional/recovery behaviour where technically possible.

Rules:

- Never claim an external operation is undoable when it is not reliably reversible.
- Preserve pre-write data or recovery metadata where practical and proportionate.
- Clearly distinguish internal undo from external recovery/revert operations.
- Batch external writes should use explicit transaction boundaries where possible.
- Partial external failures must be surfaced and reconciled rather than hidden.
- Provenance must retain enough information to diagnose what was written and from which project state.

---

## REQ-STOR-199 — Project Forks from Historical State

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 199 of the pre-hardening baseline

Users shall be able to create a new project/fork from a historical state or named snapshot.

Local project forks should share immutable/content-addressed source media where possible rather than duplicating large audio assets unnecessarily.

A fork must receive its own independent:

- Project identity.
- Command journal.
- Active history branch.
- Project metadata.
- Export recipes unless deliberately linked/copied by policy.
- Future modifications.

Forking must never mutate the source project.

Portable/exported projects must remain capable of becoming self-contained regardless of local deduplication.

---

## REQ-STOR-200 — History Storage Inspection and Compaction

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `CURRENT`
- **Legacy source:** section 200 of the pre-hardening baseline

History storage must be inspectable and selectively manageable.

AudioGubbins shall distinguish storage consumed by categories such as:

- Command journal.
- Named snapshots.
- Alternative branches.
- Retained deleted media.
- Immutable source media.
- Render caches.
- Waveform/spectrogram caches.
- Recovery checkpoints.
- Automatic backups.

Users shall be able to compact or purge eligible categories deliberately rather than being offered only a blunt `Clear History` operation.

Before destructive history/media compaction, AudioGubbins must explain the recovery capability that will be lost.

---

## REQ-PROD-038 — Cloud Extensibility

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `DEFERRED`
- **Legacy source:** section 38 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

Cloud storage is not part of the initial implementation.

Future support may include user-supplied integrations such as:

- Google Drive
- OneDrive
- Dropbox
- S3-compatible storage
- Other providers

The architecture should expose provider-neutral storage abstractions.

Cloud support must remain optional.

---

## REQ-STOR-100 — Project Encryption Scope

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `EXCLUDED`
- **Legacy source:** section 100 of the pre-hardening baseline

> **Execution rule:** This is an explicit exclusion. Do not implement the excluded capability unless a future approved specification change supersedes this requirement.

Application-level project encryption is not an implementation requirement.

AudioGubbins shall rely on the security guarantees provided by the operating system, browser profile, storage implementation, and user environment for normal local project data.

The architecture does not need to carry encryption-specific complexity, password recovery flows, encrypted-preview handling, or encrypted cache management in the initial or planned product scope.

A future encryption feature may be designed later if a concrete requirement emerges, but no current architecture should be distorted merely to anticipate it.

---

## REQ-EXEC-136 — AudioGubbins Agent Implementation Guardrails

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 136 of the pre-hardening baseline

This specification is intended to be implemented by an advanced coding agent. The agent must therefore follow explicit architectural guardrails rather than relying on generic coding slogans or default AI-generated project structure.

These guardrails are requirements, not optional style advice.

#### 136.1 Principles Are Heuristics, Not Excuses

The implementation agent must not apply slogans such as YAGNI, DRY, KISS, SOLID, or design-pattern names mechanically.

In particular:

- **YAGNI must not be used to reject future capabilities explicitly required by this specification.** Documented future multitrack, plugin, Godot runtime, cloud, automation, and other extension requirements are real architectural constraints even when their user-facing feature is scheduled later.
- **DRY must not force unrelated concepts into shared abstractions merely because their current code looks similar.** Prefer duplication over incorrect coupling when two concepts do not yet share a stable domain abstraction.
- **KISS must not be interpreted as "choose the least capable architecture".** Simplicity means clear boundaries and comprehensible design, not sacrificing robustness or future requirements.
- **SOLID must not be reduced to excessive interfaces, one-method classes, or dependency-injection ceremony.** Apply the underlying design intent where it improves cohesion and substitutability.
- A named design pattern is not evidence that a design is good. Patterns must solve an actual documented problem.

#### 136.2 No God Objects or Monolithic Modules

The implementation must not centralise unrelated responsibility into objects such as:

- `AppManager`.
- `AudioManager`.
- `ProjectManager`.
- `StateManager`.
- `GodService`-style orchestration classes.
- Giant stores that own unrelated domains.
- Mega-components containing workspace, audio, persistence, transport, and editing behaviour together.

Names such as `Manager`, `Service`, `Controller`, `Engine`, or `System` are permitted only when the implementation has a narrow, explicit, cohesive ownership boundary.

Modules should be organised around stable domain responsibilities and dependency direction.

#### 136.3 Cohesive Module Boundaries

Each module/package must have:

- A clearly stated responsibility.
- Explicit public contracts.
- Explicit dependencies.
- A reason for ownership of its state.
- Tests at the appropriate boundary.

Likely bounded areas include, subject to architecture refinement:

- Project domain.
- Asset/media domain.
- Timeline/edit domain.
- Command system.
- Undo/history.
- Persistence.
- Codec/import/export.
- DSP graph.
- Realtime playback.
- Recording.
- Analysis/waveform/spectral rendering.
- Workspace/UI shell.
- Godot interchange.
- Runtime event authoring.
- Capability detection.

Cross-domain access must occur through typed contracts rather than arbitrary imports into internal implementation details.

#### 136.4 Dependency Direction

Dependency direction must be deliberate and testable.

UI components must not become the authoritative owner of project/audio state.

UI code must not bypass the command/domain layer to mutate project data directly for convenience.

Persistence formats must not leak throughout the domain model.

Browser-specific API adapters must be isolated behind capabilities/contracts so that platform APIs do not become implicit global dependencies.

DSP domain logic should not depend on visual components.

Godot integration should consume stable interchange/domain contracts rather than reaching into unrelated editor internals.

#### 136.5 Avoid Premature Generic Abstractions

The agent must not create vague frameworks such as generic `BaseManager`, `AbstractThingFactory`, universal event buses, universal repositories, generic graph engines, or catch-all plugin systems before concrete domain requirements justify them.

Prefer:

1. A concrete cohesive implementation.
2. A second concrete use case when required.
3. Extraction of the stable shared concept only when the domain relationship is understood.

This rule does not prohibit intentionally designed extension points that are explicitly required by this specification.

#### 136.6 Avoid Hidden Coupling

Do not use implicit global mutable state as a shortcut.

Avoid hidden communication through:

- Global singleton bags.
- Unstructured event emitters.
- Stringly typed message names.
- Mutable module globals.
- DOM events as a substitute for domain contracts.
- Storage side effects as inter-module messaging.

Where event-driven communication is appropriate, events must be typed, scoped, documented, and owned by a clear subsystem.

#### 136.7 File and Function Size Review Thresholds

Source size thresholds are review triggers, not code-golf targets.

As a default:

- A production source file approaching roughly 300–400 logical lines should trigger a cohesion review.
- A function approaching roughly 50–70 logical lines should trigger a decomposition review.
- A class/object with a large number of unrelated methods or dependencies should trigger an ownership review even if its line count is small.

Exceeding a threshold is acceptable when cohesion genuinely warrants it and the reviewer records the justification.

Splitting one coherent concept into meaningless tiny files merely to satisfy a number is prohibited.

#### 136.8 Explicit Complexity Budgets

Each implementation phase must identify likely complexity hotspots.

Reviewers must actively inspect:

- Modules with unusually high dependency fan-in/fan-out.
- Deep inheritance trees.
- Large state stores.
- Highly connected event graphs.
- Repeated conditionals encoding the same domain rule.
- Functions with high branching complexity.
- Classes/modules that keep gaining unrelated responsibilities across phases.

Complexity must be reduced structurally rather than hidden behind comments or helper functions.

#### 136.9 No Phase Leakage

An implementation agent must not partially implement later phases opportunistically unless required to establish a stable current-phase contract.

If future capability requires an extension point now, implement the minimal robust contract needed now and document the deferred implementation.

Do not add half-working future features, dead UI, speculative configuration, or placeholder production APIs that will be mistaken for supported behaviour.

#### 136.10 No Permanent Temporary Hacks

Temporary compromises are allowed only when all of the following are true:

- They are necessary to unblock the current phase.
- They do not compromise data integrity or security.
- They are clearly marked in code and the phase record.
- They have an explicit removal task.
- The removal task is scheduled before the phase gate can pass unless the reviewer explicitly accepts the debt as non-blocking.

Comments such as `TODO later`, `temporary`, `quick fix`, or `hack` without a tracked remediation item are not acceptable.

#### 136.11 Domain Rules Must Have One Authoritative Home

Business/domain rules must not be independently reimplemented in UI, storage, worker, and Godot-integration layers.

Examples include:

- Selection precedence.
- Export collision policy.
- Event variation selection.
- Loop rules.
- Project-version compatibility rules.
- Command validation.

Presentation layers may adapt the result, but authoritative rules must have a single clear owner with direct tests.

This is the appropriate use of DRY: avoid duplicated **domain truth**, not superficial duplicated syntax.

#### 136.12 Typed Contracts and Runtime Validation

TypeScript compile-time typing is necessary but not sufficient at trust boundaries.

Use explicit schemas/runtime validation for:

- Project files.
- Portable bundles.
- Godot interchange manifests.
- Worker messages.
- Plugin/interchange data.
- Imported external metadata.
- Future network/cloud boundaries.

Internal contracts should avoid `any`, unbounded dictionaries, and stringly typed state when a domain type can express the invariant.

#### 136.13 Architecture Tests

Architecture constraints should be executable where practical.

The project should include automated tests/lint rules capable of detecting violations such as:

- Forbidden dependency directions.
- UI packages importing persistence internals.
- Runtime Godot code depending on editor-only APIs.
- Domain packages importing browser-specific adapters directly.
- Circular dependencies.
- Cross-package use of non-public internals.

Architecture tests are part of CI and phase review.

#### 136.14 Comments and Documentation

Comments should explain intent, invariants, non-obvious trade-offs, and reasons.

Do not generate commentary that merely restates code.

Public/domain contracts should be documented well enough for another agent or developer to use them without reading implementation internals.

Important architectural decisions should be captured as ADRs or equivalent decision records, especially where multiple valid designs were considered.

#### 136.15 Error Handling Must Be Designed

The agent must not use blanket `try/catch` blocks, silent fallbacks, or logging-and-continuing as substitutes for defined failure behaviour.

Each boundary should define:

- Recoverable errors.
- Fatal errors.
- User-actionable errors.
- Retryable errors.
- Data-integrity failures.
- Capability degradation.

Errors should preserve causal information and be presented to users at the correct abstraction level.

#### 136.16 Performance Must Not Destroy Architecture

Optimisation may introduce specialised paths, caches, worker pipelines, WASM, pooled resources, and GPU acceleration.

These optimisations must remain behind stable contracts so that performance code does not become the domain model.

Measure before and after optimisation.

Do not micro-optimise ordinary code while leaving architectural bottlenecks such as main-thread DSP, full-buffer copies, or excessive cross-thread serialisation unresolved.

#### 136.17 Reviewer Enforcement

Every phase's Architecture and Code Quality reviewers must explicitly answer:

- Did this phase introduce or enlarge a god object?
- Did any module gain unrelated responsibilities?
- Did the implementation introduce speculative abstractions without a concrete requirement?
- Did DRY/YAGNI/KISS/SOLID reasoning cause loss of required capability or incorrect coupling?
- Are dependency directions still valid?
- Is domain logic duplicated across layers?
- Are files/functions exceeding review thresholds still cohesive?
- Did UI code bypass typed command/domain APIs?
- Did temporary debt escape the phase without explicit acceptance?
- Can the next phase extend this work without invasive rewrites?

A blocking finding in these areas prevents the phase gate from passing.

---

## REQ-EXEC-167 — Agent Execution Contract

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 167 of the pre-hardening baseline

The implementation agent is expected to have full access to the AudioGubbins repository filesystem and the associated GitHub repository and to perform the implementation work directly from this specification.

This specification is the controlling implementation contract. The agent must not silently reinterpret, weaken, omit, postpone, stub, fake, or re-scope requirements because they are difficult, time-consuming, unfamiliar, or inconvenient.

The agent shall:

- Implement one gated phase at a time.
- Treat each phase TODO, invariant, required test, acceptance criterion, and review requirement as contractual.
- Preserve the architectural principles and dependency direction defined by this specification.
- Make reasonable autonomous implementation decisions where the specification intentionally leaves mechanism open.
- Record significant architectural decisions as ADRs.
- Prefer robust, explicit, maintainable architecture over expedient shortcuts.
- Refactor touched code when implementation reveals a poor abstraction rather than knowingly extending architectural debt.
- Keep unrelated sweeping rewrites outside the active phase unless they are necessary to satisfy a requirement or remove a blocking architectural defect.
- Leave the repository in a buildable, testable, reviewable state at meaningful checkpoints.

The agent must never use implementation speed or convenience as sufficient justification for reducing capability, correctness, test coverage, architectural quality, accessibility, determinism, portability, or maintainability.

---

## REQ-EXEC-170 — Independent Multi-Lens and Adversarial Review

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 170 of the pre-hardening baseline

The implementation agent may not approve its own phase.

Every phase must be reviewed through independent reviewer passes using fresh review instructions/context where practical. Reviews may be performed by separate subagents or by separate isolated reviewer invocations, but they must be operationally independent from the implementation pass.

The review system shall combine:

- Required specialist lenses defined elsewhere in this specification.
- Cross-cutting architecture review.
- Adversarial review intended to find hidden defects rather than validate the implementer's narrative.
- Requirement-compliance review against the actual phase contract.
- Regression review of previously completed phase invariants where affected.

Adversarial reviewers should actively attempt to discover:

- Missing requirements disguised as complete work.
- Incorrect assumptions about browser/platform behaviour.
- Race conditions and lifecycle bugs.
- Data-loss or recovery failures.
- Hidden coupling.
- God objects and overgrown services/managers.
- Incorrect ownership boundaries.
- UI logic bypassing the command/domain layer.
- Unbounded memory/storage behaviour.
- Audio-thread violations.
- Main-thread blocking.
- Non-deterministic final-render paths.
- Incorrect DSP edge cases.
- State corruption under failure/reload.
- Accessibility regressions.
- Mobile/touch regressions.
- Security/privacy leakage.
- Dependency or licence risks.
- Test suites that appear comprehensive but do not exercise real behaviour.
- Phase leakage or unscheduled future-work placeholders.

Reviewers must inspect implementation evidence rather than relying on the implementer's summary or checked TODO boxes.

---

## REQ-EXEC-171 — Review Finding Verification and Remediation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 171 of the pre-hardening baseline

Reviewer findings are allegations until verified.

Before altering production code in response to a finding, the implementation workflow should verify the finding using the most appropriate evidence, including where relevant:

- Reproduction
- Targeted test
- Static analysis
- Type analysis
- Instrumentation
- Audio reference comparison
- Browser/platform reproduction
- Performance profiling
- Source/documentation verification
- Architectural dependency inspection

A reviewer finding that cannot be reproduced or substantiated must not be blindly implemented as a fix merely because a reviewer emitted it.

Verified genuine findings must be corrected unless this specification explicitly permits acceptance as tracked non-blocking debt.

Corrections must receive focused re-review, including:

- Confirmation that the original issue is resolved.
- Confirmation that the fix did not create a regression.
- Re-execution of affected tests and architecture checks.
- Re-review by the relevant specialist lens when severity warrants it.

When reviewers disagree, the workflow must reconcile the disagreement using evidence, specification requirements, and architectural principles rather than majority voting.

---

## REQ-EXEC-172 — Review Severity and Gate Semantics

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 172 of the pre-hardening baseline

All review findings shall use the following common severity taxonomy:

- **BLOCKER** — implementation cannot safely or meaningfully proceed or the phase cannot be considered implemented.
- **CRITICAL** — severe correctness, data-loss, security/privacy, architectural, audio-integrity, or release-quality defect.
- **HIGH** — substantial product, correctness, performance, compatibility, accessibility, maintainability, or architecture defect.
- **MEDIUM** — meaningful defect or debt that should normally be resolved within the phase unless explicitly justified and tracked.
- **LOW** — minor defect, maintainability improvement, polish issue, or low-risk edge case.
- **NOTE** — observation, future consideration, or non-actionable context.

Gate rules:

- BLOCKER, CRITICAL, and HIGH findings always fail the phase gate until resolved and verified.
- MEDIUM findings must be resolved or explicitly accepted with written rationale, ownership, and tracking.
- LOW findings may be deferred when justified and tracked.
- NOTE findings do not block the phase.

Severity must be based on impact and likelihood, not on how difficult the fix is.

The implementation agent may not downgrade severity merely to pass a gate.

---

## REQ-EXEC-173 — No Autonomous Scope Reduction

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 173 of the pre-hardening baseline

The implementation agent must never remove, downgrade, postpone, stub, fake, simplify away, or relabel required work as future scope because implementation is difficult or the phase is large.

If the work is too large to execute safely in one coding pass, the agent may subdivide the phase internally into ordered implementation slices, provided that:

- The externally defined phase boundary remains unchanged.
- Intermediate slices do not masquerade as a completed phase.
- The phase gate remains closed until every required slice is complete.
- Intermediate architectural decisions still satisfy the final phase contract.

Phrases such as the following are not acceptable substitutes for implementation unless the specification explicitly schedules the work later:

- "Future improvement"
- "Out of scope for now"
- "Can be added later"
- "MVP implementation"
- "Simplified implementation"
- "Temporary implementation"
- "Placeholder"
- "Good enough for this phase"

The specification, not the implementation agent, defines scope.

---

## REQ-EXEC-174 — TODO and Acceptance-Criteria Integrity

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 174 of the pre-hardening baseline

Phase TODOs are contractual implementation statements.

A TODO may be marked complete only when its stated behaviour exists and all associated tests, invariants, and acceptance criteria are satisfied.

Examples of invalid completion claims include:

- Marking a feature complete because interfaces/types exist but behaviour does not.
- Marking persistence complete because data can be written but recovery/failure cases are absent.
- Marking a DSP processor complete because nominal input works but edge cases/reference validation are missing.
- Marking accessibility complete because controls have ARIA attributes without keyboard/focus testing.
- Marking mobile support complete because a desktop layout technically renders on a phone.
- Marking Godot integration complete because files export but the specified editor/runtime contracts are absent.

Reviewers must independently spot-check TODO completion against actual code, tests, generated artefacts, and runtime behaviour.

TODO checkboxes must never be treated as proof.

---

## REQ-EXEC-180 — Test Integrity and Anti-Cheating Rules

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 180 of the pre-hardening baseline

Tests are evidence of behaviour, not obstacles to be weakened until a build turns green.

The implementation agent must not:

- Remove or weaken assertions merely to pass a test.
- Update golden/reference audio output without documented technical justification and reviewer verification.
- Replace integration/E2E coverage with easier unit mocks when the requirement is integration behaviour.
- Mock the subsystem whose integration behaviour is the subject of the test.
- Assert only implementation details while failing to verify user/domain outcomes.
- Swallow exceptions or convert hard failures into warnings to make tests pass.
- Disable flaky tests without root-cause analysis and tracking.
- Add arbitrary retries to hide races.
- Mark tests skipped/todo as a substitute for required coverage.
- Alter test fixtures so that they no longer represent the required scenario.

Audio/DSP tests should use objective reference signals, tolerances, invariants, and golden/reference renders where appropriate.

Critical persistence and recovery tests should exercise process/tab interruption, partial writes, stale caches, storage pressure, and incompatible schema behaviour rather than only happy paths.

Architecture tests should verify dependency direction and prohibited imports where practical.

---

## REQ-EXEC-181 — Placeholder, Stub, and Temporary-Code Gate Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 181 of the pre-hardening baseline

Unless this specification explicitly schedules an implementation for a later phase, the following are gate failures when present in phase-owned production paths:

- `TODO`
- `FIXME`
- `HACK`
- Placeholder UI representing required behaviour
- Dummy or fabricated production data
- Empty implementations
- Unimplemented branches
- `throw new Error("Not implemented")` or equivalent
- Silent no-op fallbacks
- Temporary mock implementations
- Fake persistence
- Fake processing
- Hard-coded responses standing in for required systems
- Compatibility shims introduced contrary to the pre-1.0 schema policy
- Disabled required behaviour hidden behind an undocumented flag

A future-phase extension point is acceptable only when the current phase's required behaviour is complete and the extension point is an explicit architectural seam rather than a stub.

All temporary code must have an explicit specification-approved purpose and removal boundary.

---

## REQ-EXEC-183 — Phase Evidence Package

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 183 of the pre-hardening baseline

At the end of every implementation phase, the agent must produce a concise but complete evidence package for reviewers.

The package should include:

- Phase identifier and objective
- Completed TODO checklist
- Files/packages materially changed
- New or changed public/internal contracts
- ADRs created/updated
- Tests added/changed
- Commands used for verification
- Build/type/lint/test results
- Browser/device compatibility results required by the phase
- Performance measurements required by the phase
- Audio/DSP reference results required by the phase
- Storage/recovery results required by the phase
- Accessibility results required by the phase
- Known non-blocking limitations explicitly permitted by the specification
- Dependency additions/removals and their review
- Migration/schema impact
- Screenshots or recordings where visual/touch behaviour is part of acceptance evidence
- Reviewer findings and remediation status

The evidence package is not a substitute for reviewers inspecting the implementation. It is an index to the evidence they must verify.

---

## REQ-EXEC-184 — Architecture Enforcement Tests

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 184 of the pre-hardening baseline

AudioGubbins shall use executable architecture constraints where practical rather than relying solely on prose discipline.

Architecture tests/static rules should verify, where appropriate:

- Package dependency direction
- Prohibited cross-layer imports
- Domain code independence from React/UI implementation details
- UI inability to mutate authoritative domain state except through approved contracts/commands
- Separation of persistence from presentation
- Separation of DSP/audio-thread code from UI code
- No direct third-party implementation leakage across designated abstraction boundaries
- No circular dependencies
- Godot integration boundaries
- Browser capability access through approved capability adapters
- Diagnostic/telemetry restrictions

These tests should evolve with the architecture and be reviewed whenever package boundaries change.

An agent must not bypass an architecture test by weakening or deleting the rule unless the architectural change is deliberate, documented in an ADR, and approved by the architecture review lens.

---

## REQ-EXEC-204 — Phase Context Loading Protocol

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 204 of the pre-hardening baseline

Implementation agents must not be expected to repeatedly consume the entire full specification for every coding task.

For a phase, the agent shall load a bounded **Phase Context Pack** consisting of:

1. Global Agent Execution Contract.
2. Global architectural invariants.
3. Current Phase Packet.
4. Normative requirements explicitly referenced by that packet.
5. Public contracts/interfaces from prerequisite phases that the phase depends upon.
6. Previous phase handoff/evidence summary where directly relevant.
7. Current Architecture Decision Records referenced by the phase.
8. Current implementation ledger entries relevant to owned packages.

The agent may consult additional specification sections when necessary, but implementation must not rely on remembering unrelated sections from a previous context window.

Phase packets must reference requirements explicitly rather than saying things such as `follow the audio requirements above`.

---

## REQ-EXEC-215 — Requirements-to-Tests Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 215 of the pre-hardening baseline

Every normative behaviour that can be mechanically verified should have at least one identified verification mechanism before its implementation phase passes.

Verification mechanisms may include:

- Unit tests.
- Property-based tests.
- Integration tests.
- Browser/E2E tests.
- Audio golden/reference tests.
- Deterministic render hashes.
- GUT/Godot tests.
- Architecture tests.
- Accessibility automation plus manual checks.
- Performance/latency measurements.
- Static analysis.
- Manual evidence for behaviours that cannot be meaningfully automated.

A requirement must not be considered satisfied solely because code that appears related to it exists.

---

## REQ-EXEC-216 — No Hidden Implementation Assumptions

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 216 of the pre-hardening baseline

Phase packets shall explicitly state assumptions that materially affect correctness.

Agents must not silently assume:

- Browser APIs are universally available.
- A file fits in memory.
- Audio is stereo.
- Sample rates match.
- A Godot project is writable.
- A user is online.
- A PWA is installed.
- SharedArrayBuffer/WebGPU is available.
- Touch input implies no keyboard/mouse.
- Export destinations can be overwritten.
- External files remain unchanged.
- Storage quota is sufficient.
- A processor is zero-latency.

Capability-sensitive assumptions require explicit fallback/error behaviour.

---

# Relevant Accepted ADRs

<!-- adr/ADR-0002-project-persistence.md -->

# ADR-0002 — Local-First Project Persistence

- **Status:** Accepted
- **Decision:** Use an application-owned versioned project model with browser-managed persistent storage (OPFS where available), content-addressed media storage, external-source adapters, a command journal, immutable snapshots, portable bundles, and deterministic unpacked/Git-friendly projects.
- **Drivers:** local-first operation, recoverability, unlimited/branching history, large media, project portability, developer workflows.
- **Constraints:** caches are disposable; one project has one writer per storage context; external changes are detected; encryption is out of scope.
- **Related requirements:** `REQ-STOR-025`, `REQ-STOR-026`, `REQ-STOR-098` through `REQ-STOR-106`, `REQ-STOR-193` through `REQ-STOR-200`.

<!-- adr/ADR-0006-history-model.md -->

# ADR-0006 — Branching History and Snapshots

- **Status:** Accepted
- **Decision:** Persist project changes as a typed command journal with periodic immutable snapshots, branching history, named snapshots, full-project A/B comparison, and forks from historical state.
- **Drivers:** effectively unlimited undo/redo, crash recovery, experimentation, provenance, deterministic command replay where appropriate.
- **Constraints:** external side effects are recorded as provenance but never falsely represented as undoable; retained media remains reachable until explicit purge/compaction.
- **Related requirements:** `REQ-STOR-101`, `REQ-STOR-193` through `REQ-STOR-200`.

# Current Ledger Entry

```json
{
  "phase": 2,
  "name": "Project and Storage System",
  "status": "NOT_READY",
  "hard_dependencies": [
    1
  ],
  "phase_file": "phases/phase-02-project-and-storage-system.md",
  "requirements": [
    "REQ-STOR-021",
    "REQ-STOR-025",
    "REQ-STOR-026",
    "REQ-STOR-027",
    "REQ-PROD-038",
    "REQ-STOR-052",
    "REQ-STOR-053",
    "REQ-STOR-055",
    "REQ-STOR-098",
    "REQ-STOR-099",
    "REQ-STOR-100",
    "REQ-STOR-101",
    "REQ-STOR-102",
    "REQ-STOR-103",
    "REQ-STOR-104",
    "REQ-STOR-105",
    "REQ-STOR-106",
    "REQ-STOR-166",
    "REQ-STOR-193",
    "REQ-STOR-194",
    "REQ-STOR-195",
    "REQ-STOR-196",
    "REQ-STOR-197",
    "REQ-STOR-198",
    "REQ-STOR-199",
    "REQ-STOR-200"
  ],
  "open_verified_findings": [],
  "commits": [],
  "evidence": [],
  "handoff": null
}
```
