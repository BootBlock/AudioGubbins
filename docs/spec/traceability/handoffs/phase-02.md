# Phase Handoff Capsule — Phase 02

## Capability Delivered

AudioGubbins keeps projects in the browser. A project is an authoritative,
versioned, runtime-validated document; every change to it is a command with
its inverse, journalled as it is made and checkpointed into immutable,
checksummed files with no rename assumed, so a reload, a crash or a full
storage leaves the last valid project and recovers to a transaction boundary.
Its history branches, keeps named snapshots, compares any two states, forks
and compacts on confirmation. Media is stored once by content across projects
and proved as it is copied out; linked files are tracked by a handle, size,
time, sampled ranges and a full content identity, with a policy per asset for
when they change. One tab writes a project at a time under a fenced lease, and
another reads it, asks for it and takes it over only once a request went
unanswered. Backups are made by policy or by hand and restored as a new project
or in place; a project goes out and comes back as a portable bundle or a
Git-friendly unpacked folder; deleted media stays until an explicit purge; the
Storage panel measures and cleans up safest first; and stored data of another
schema blocks every project until the person exports or wipes it. The storage
core runs in one worker behind a typed port, and the page holds only its
client.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-02-evidence.md`, under "Requirement-to-evidence mapping".
`REQ-PROD-038` is deferred and `REQ-STOR-100` excluded by the specification;
the parts of `REQ-STOR-166` and `REQ-STOR-195` that need a file's audio are
recorded below.

- `REQ-STOR-021`
- `REQ-STOR-025`
- `REQ-STOR-026`
- `REQ-STOR-027`
- `REQ-STOR-052`
- `REQ-STOR-053`
- `REQ-STOR-055`
- `REQ-STOR-098`
- `REQ-STOR-099`
- `REQ-STOR-101`
- `REQ-STOR-102`
- `REQ-STOR-103`
- `REQ-STOR-104`
- `REQ-STOR-105`
- `REQ-STOR-106`
- `REQ-STOR-166`
- `REQ-STOR-193`
- `REQ-STOR-194`
- `REQ-STOR-195`
- `REQ-STOR-196`
- `REQ-STOR-197`
- `REQ-STOR-198`
- `REQ-STOR-199`
- `REQ-STOR-200`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them.

- `@audiogubbins/project-format`: `ProjectState` and the project document's
  reader and writer, `ContentId` and the chunked digest,
  `ExternalSourceIdentity`, source change policy, `BackupPolicy` and the
  retention policy with their checked constructors, export records and
  provenance levels, canonical JSON within `JsonLimits`, the project-name
  rule, the compatibility rule, the ZIP container, `BundleManifest`, the
  unpacked tree, history segments, the `StorageTree` port, and `Turns` over
  `YieldToHost`.
- `@audiogubbins/project-commands`: the project commands with their inverses,
  and what each declares of its arguments' provenance.
- `@audiogubbins/history`: the branching history, paths, snapshots, branch
  names, comparison and the difference of two states, affected entities,
  retention and compaction planning, and `historyDelta` with
  `applyHistoryDelta`.
- `@audiogubbins/media-store`: `MediaObjectStore`, import by copy or link,
  source observation, classification and resolution, and collection.
- `@audiogubbins/storage`: the storage root, `ProjectRepository`,
  `CommandJournal`, `SnapshotStore`, the project session, `ProjectWriteLease`,
  backups, usage, cleanup and purge, the cache store, forks, and bundle and
  unpacked export and import.
- `@audiogubbins/browser-storage`: `SyncStorageTree` over the origin-private
  file system, the Web Locks lease coordinator, kept file handles, the
  pickers, sinks and file sources.
- `@audiogubbins/storage-runtime`: the storage worker, its operation table and
  envelopes, and `StorageClient` with a facade for each kind of thing the
  application's stores use (`ADR-0022`).
- `@audiogubbins/capabilities`: the storage platform's capabilities.
- `@audiogubbins/design-system`: a row window for long lists.
- `@audiogubbins/diagnostics`: a relay sink that admits another thread's
  records by the page's verbosity.

## Persisted / Interchange Formats

- `projectDocument` version 1: the project document, canonical JSON, read
  field by field.
- `projectStorage` version 5: the storage root, project headers with the
  purging mark, the two heads, checkpoints, history segments, content-addressed
  states, journal records by lease epoch, the lease record, the media store,
  backup generations, and caches sealed with their length and the identity of
  their bytes. Versions 1 to 4 were never shipped and carry no migration.
- `portableBundle` version 2: a ZIP of the unpacked tree with its manifest,
  the tree listing its caches with their identities.
- The unpacked tree: one file per entity, the header first, canonical text,
  media by reference.
- Before 1.0 stored data of another version of any of these meets the
  compatibility screen; nothing migrates it (`REQ-STOR-052`).

## Invariants Downstream Agents Must Preserve

- Nothing above `packages/browser-storage` and the application reaches a
  browser storage API; the format, commands, history, media store and storage
  take their I/O through ports (`ADR-0020`).
- The page holds no storage core. It reaches storage only through
  `StorageClient`, and a dependency rule holds it to types from the storage
  packages and the values it lists with their reasons. A new operation the
  application needs is added to the operation table, the worker's host and
  the client (`ADR-0022`).
- Every file but the two heads is written once, under a name nothing else
  takes, with a checksum; no rename or atomic replace is assumed. A file's
  wholeness is judged by its bytes, never its size.
- Nothing is written that its reader would refuse: a writer refuses at the
  reader's own limits, and a checkpoint storage cannot hold is passed over
  with the journal keeping every change.
- A checkpoint holds no history node; nodes are written once, in segments a
  checkpoint names, and a confirmed checkpoint removes only what its epoch or
  an earlier one wrote.
- Every mutation of a project is a command with its inverse, journalled before
  it is acknowledged. An export is recorded, never undone.
- A policy reaches a project only through its checked constructor.
- Media is retained while any valid head, named segment, journal record or
  whole backup generation names it, and is removed only by a confirmed purge
  under the storage-wide lock, which every writer of something not yet whole
  shares. A purge marks its project first.
- Every copy out proves each object's identity as it streams it, and carries
  what recovery found, refusing rather than copying an older project.
- A linked file is never resolved without being looked at: samples count as a
  match only where the file keeps its time, a file that wants leave is put to
  the person, and no policy silently adopts a change by default.
- One window writes a project; a lease is fenced by its epoch, and taking over
  is offered only once a request went unanswered.
- Caches are never authoritative: a lost or damaged cache is made again, and
  a cache of shared media is never replaced by one brought in.
- Every long storage path takes an `AbortSignal` and the host's turns, except
  a purge, a wipe and a soft delete, which finish once begun.
- A persisted format change raises its schema in `version.json`; before 1.0 it
  carries no migration.

## ADRs

- `ADR-0020` — project storage is six packages over ports, with a protocol
  that needs no atomic rename.
- `ADR-0021` — the editor's markers and regions move into the project with
  native-rate import (Phase 09), amending `ADR-0047`.
- `ADR-0022` — the storage core runs in a worker behind a typed port.

## Verification Baselines

- Seeded random sessions of the real commands round-trip through storage, a
  bundle, an unpacked tree and a fork, compared whole by
  `packages/storage/src/testing/model-summary.ts`, which is built from the
  format's own writers.
- One crash sweep crashes every storage operation at every tree operation, in
  the torn-write forms each asks for, a write torn at its full length among
  them, and requires the next start to open to what was there or what the
  operation made.
- One lease scenario runs over the in-memory coordinator and over Web Locks.
- `tests/e2e/projects.spec.ts` in Chromium and Firefox: a reload, two tabs, a
  bundle out and in, and the compatibility screen.
- At 16,000 changes in process: one change's page update a median of
  0.020 ms, and an opening's longest page task about 15 ms across 17 slices.
  In Chromium at 16,000 changes: no long task on the page through renames, a
  checkpoint on hide or a reload; the History list keeps 20 to 30 rows in the
  page and scrolls at a median of 16.7 ms a frame. The figures are in the
  evidence.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Importing audio from the interface needs a file's audio shape, which a
  codec reads: Phase 09's packet names importing audio into the open project
  at its native rate. Until then nothing in the interface runs the import
  pipeline, the copy or link setting is read by the pipeline alone, and a
  source's rate, bit depth, channel layout and duration (`REQ-STOR-166`) are
  not recorded.
- The editor's markers and regions stay the session's until that import, and
  move into the project with it (`ADR-0021`, Phase 09). Phase 05's readiness
  review settles whether native-rate reading comes forward into Phase 05.
- Auditioning A and B (`REQ-STOR-195`) needs the project's audio in the audio
  engine, which arrives with that import.
- Cloud storage is deferred (`REQ-PROD-038`) and encryption excluded
  (`REQ-STOR-100`).

## Accepted Non-Blocking Debt

- F-01: a snapshot's state present but damaged is found when used, not when
  the project opens. Owner: Phase 14's recovery stress.
- F-14: the paths past the reader's 2^28 characters have no direct test.
  Owner: Phase 14's large-project tests.
- F-15: the `history` package's whole-graph passes run synchronously in the
  worker (192 to 219 ms at 100,000 nodes). Owner: Phase 14's performance
  baselines.
- F-29, F-30, F-32: the History list's one-height rows, a segment's bytes split
  by its nodes' text, and a request unanswered after 30 seconds. Owner: Phase
  14's accessibility and performance hardening.
- Bounded limits: a header reverted by a late writer's cached name, two
  openers racing to one epoch when one steals mid-open, and a closed tab not
  announced to watchers. Owner: Phase 14's recovery stress.
- Low findings tracked in `reviews/phase-02-review.md`: F-42 and F-51's rest
  (Phase 09), F-45 and F-49 (Phase 12), F-43, F-52 and F-54 (Phase 14), F-53
  (Phases 14 and 09), and F-46, F-55's rest and F-56 (Phase 05).
- Phase 01's debt owed to this phase is closed: the inverse for deleting a
  workspace (F-123), export, discard and a bound with a notice for text set
  aside (F-206, F-305, F-401, F-496, F-973, F-993, F-1021, F-1022, F-1038),
  and a cause and remedy in the storage-failure notice (F-209).

## Downstream Readiness

- Phase 05 — Core Non-Destructive Editing: its hard dependencies, Phases 02,
  03 and 04, have all reached `PASS`, so it is eligible for `READY`. Its
  readiness review settles `ADR-0021`'s question.
- Phases 07, 09, 11 and 12 still wait on Phases 05, 06, 09 or 10.
