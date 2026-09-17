# Project, Storage, History, and Recovery Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-025` — Storage Model — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-026` — Project Format — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-027` — Cache Model — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-052` — Project Schema Compatibility Policy — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-053` — External Source Change Policy — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-055` — Undo/Redo Retention Policy — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-098` — Concurrent Project Access and Single-Writer Ownership — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-099` — Content-Addressed Media Storage and Deduplication — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-100` — Project Encryption Scope — owner Phase 02 — scope `EXCLUDED`
- `REQ-STOR-101` — Command Journal and Immutable Snapshot Persistence — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-102` — Deleted Media Retention and Explicit Purge — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-103` — Git-Friendly Unpacked Project Format — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-104` — External Source Identity and Integrity Tracking — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-105` — Automatic Backup Generations — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-106` — Storage Cleanup Priority — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-166` — Asset Provenance and Traceability — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-193` — Branching Project History — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-194` — Named Project Snapshots — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-195` — Whole-Project A/B State Comparison — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-196` — History Workspace Panel — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-197` — Export Provenance in Project History — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-198` — External Side Effects and Undo Semantics — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-199` — Project Forks from Historical State — owner Phase 02 — scope `CURRENT`
- `REQ-STOR-200` — History Storage Inspection and Compaction — owner Phase 02 — scope `CURRENT`

---

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
