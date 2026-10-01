> **Status:** In progress. 2026-10-01: review findings F-01 to F-14 fixed;
> F-15, the medium findings and the landing remain (see "Left to do").

# Phase 02 — Project and Storage System

Resume note and design record. The packet is
`docs/spec/phases/phase-02-project-and-storage-system.md`; its context pack is
`docs/spec/generated/context/phase-02-context.md`.

## Where the work is

|                  |                                                             |
| ---------------- | ----------------------------------------------------------- |
| Primary checkout | the repository's own directory, on `main`, for reading only |
| Worktree         | `../AudioGubbins-phase-02` — **do the work here**           |
| Branch           | `phase-02-project-storage`                                  |

## Coordination with Phase 03

Phase 03 runs at the same time in `../AudioGubbins-phase-03` (branch
`phase-03-audio-engine`). Agreed terms:

- Phase 02 takes ADR-0020 to ADR-0029; Phase 03 takes ADR-0030 upward.
- `packages/capabilities` belongs to Phase 03. Phase 02 adds its storage
  capability checks as new files and new entries only.
- Shared files: the ledger (own entry only), `tools/sync-workspace-graph.mjs`,
  `tests/architecture/public-contracts.txt`, root `package.json` scripts,
  `vitest.projects.json`, `pnpm-lock.yaml`, `.dependency-cruiser.cjs`. The
  second to merge merges `main` in and runs `verify:commit` first.
- Storage log categories are separate entries in `@audiogubbins/diagnostics`.

## Gates

Light gates (owner decision, 2026-09-28): whole Vitest, both tsc, lint
(`pnpm run verify:commit`), one review pass with every lens the packet names,
fix its findings, land. No mutation harness, no looped rounds. The packet's
commands `test:recovery`, `test:project-roundtrip` and `test:storage-quota`
are added as root scripts that run the named suites.

## Checklist for a new package

`tools/sync-workspace-graph.mjs` `PACKAGES`, then `pnpm graph:sync` and
`pnpm install`; `ALLOWED`, `FRAMEWORK_FREE_PACKAGES`, the leaf rules and
`TESTS_TAKE_THE_FIXTURES` in `tests/architecture/dependency-rules.test.ts`;
the layering comment and rules in `.dependency-cruiser.cjs`; the ESLint globs
(`eslint.config.js` lines 176 and 191); `OFFERED` in `package-exports.test.ts`
and `FOR_TESTS` in `module-exports.test.ts` for exports with no consumer yet;
`pnpm contracts:update`. Every declared dependency must be imported by a
production file. Files of 300 to 400 logical lines need a `REVIEWED_IN_BAND`
entry, and functions of 50 or more a `REVIEWED_FUNCTIONS` entry. Comments of
two or more lines are at most 80 columns and filled greedily. No
`navigator` member read outside `packages/capabilities/src/`. A new schema goes
in `version.json`, then `pnpm version:sync`.

## Design

### Packages (ADR-0020 records this)

- `packages/project-format` (framework-free; domain, version, text): the
  authoritative project aggregate `ProjectState` (the domain `Project`, each
  asset's media source and its import provenance), `ContentId`, the external
  source identity record, source change policy, export provenance records and
  their stripping, canonical JSON, the runtime-validated project document, the
  pre-1.0 compatibility rule (one home), the chunked content digest, the ZIP
  container (store method, ZIP64) over byte ports, the portable bundle manifest
  and the unpacked Git-friendly tree.
- `packages/project-commands` (framework-free; domain, commands,
  project-format): the project commands. The packet's
  `packages/commands/project` is realised as its own package, because a
  package nested in `packages/commands` defeats the per-package cruise rules.
  Every identifier and time a command uses is in its arguments, so replay is
  deterministic.
- `packages/history` (framework-free; domain, commands, project-format): the
  branching history graph, cursor, path planning between nodes, branch names,
  named snapshots, A/B comparison and the structural diff of two states,
  affected entities per node, retention policy and compaction planning.
- `packages/media-store` (framework-free; project-format): the
  content-addressed media object store over a backend port, import by copy or
  reference, the progressive fingerprint, the classification of an external
  source (unchanged, modified, replaced, relinked identical, missing), and
  reachability with deterministic collection.
- `packages/storage` (framework-free; project-format, history, media-store,
  diagnostics, version): the backend port and an in-memory backend, the storage
  root and its compatibility and wipe, `ProjectRepository`, `CommandJournal`,
  `SnapshotStore`, the checkpoint and double head protocol, the project session
  (open, run, undo, redo, go to a node), `ProjectWriteLease` contract, autosave
  and recovery, `BackupPolicy` and generations, usage by category, cleanup
  priority and purge, forks, bundle and unpacked export and import.
- `packages/browser-storage` (DOM): the origin-private file system through a
  dedicated worker with sync access handles (Safari 16.4 has no
  `createWritable`), Web Locks with `steal` and BroadcastChannel for the lease
  and ownership transfer, IndexedDB for kept file handles, and the file and
  directory pickers. The platform objects are read in new files of
  `packages/capabilities` and passed in.
- `apps/web`: project store (ADR-0011 style), shell commands for the project
  menu, History panel, Storage panel with the purge flow, the blocking
  compatibility screen, the ownership banner and transfer dialogue, the source
  change prompt, backup and retention settings, bundle import and export.

### Persistence protocol

No rename or atomic replace is assumed. Every file but the heads is written
once and carries a checksum; a torn file fails its check and is ignored.

- `storage.json` at the root: format and schema version. Absent: initialise.
  Other version: the blocking compatibility screen (export raw data as a ZIP,
  cancel, or wipe after confirmation).
- `projects/<id>/project.json`: header (name, created, deleted flag).
- `projects/<id>/head-0.json`, `head-1.json`: generation, checkpoint, lease
  epoch and journal position, checksummed. The valid head with the highest
  generation wins; the other is written next.
- `projects/<id>/segments/<epoch>-<id>.json`: history nodes, each written
  once in one segment.
- `projects/<id>/checkpoints/<id>.json`: the segments, cursor, named
  snapshots, branch names, export log, retention settings.
- `projects/<id>/states/<fingerprint>.json`: canonical `ProjectState`,
  content-addressed and immutable.
- `projects/<id>/journal/e<epoch>/<seq>.json`: history events (apply with
  forward and inverse invocations, move, name branch, snapshot, delete
  snapshot, export record). Replay stops at the first missing or invalid
  record; the tail is kept aside and reported, never deleted unseen.
- Lease fencing: a new owner raises the epoch in `lease.json` and seals the old
  epoch at its last sequence; later records of an older epoch are ignored.
- `media/<content id>`: shared by every project. Roots are every project's
  retained states, snapshots, checkpoints and backups. Nothing is collected
  except by an explicit purge.
- `backups/<project>/<generation>/`: a checkpoint copy and its states; media by
  content id. An external backup directory, where offered, gets a bundle.
- `cache/<category>/`: disposable, first to go under pressure.

### Content identity

`ContentId` is the SHA-256 of the byte length and the SHA-256 of each 1 MiB
chunk, so hashing streams, runs in the platform's native digest through an
injected port, and never holds a whole file.

### Cross-phase limits to record in the evidence

- Importing audio from the interface needs the audio shape of a file, which a
  codec or engine phase reads; Phase 02 ships the import pipeline, the copy or
  link choice and its explanation, and the commands, tested through a probe
  port.
- A/B audition needs the audio engine (Phase 03); Phase 02 ships the
  comparison state, switching, the diff and promotion.

## Phase 01 debt owned here

From `traceability/handoffs/phase-01.md`: an inverse for deleting a workspace
(F-123); export and discard of every text set aside as unreadable, and a bound
on each list set aside with a notice when an old text is dropped (F-206, F-305,
F-401, F-496, F-973, F-993, F-1021, F-1022, F-1038); a cause and a remedy in
the storage-failure notice (F-209).

## Work order

1. ADR-0020 and the package skeletons with their architecture entries.
2. project-format, then project-commands, history, media-store.
3. storage, then browser-storage and the capability files.
4. apps/web surfaces, then the Phase 01 debt.
5. Browser checks (two tabs, reload), evidence, one review pass, fixes,
   ledger, handoff, land.

## Progress

Committed on the branch, in order: the package layout and format core, the
Phase 01 debt, the project commands, the media store, the history with the
format's history and ZIP forms, the record-contract tidy, the browser
adapters and capability files, the storage core, the packet's root test
scripts, the Web Locks lease, storage safety and portability, and the gap
fixes (`8d6599a`: lease port `unavailable`, `watchOwnership`,
`requestTransfer` with a signal, per-epoch heads, storage-wide lock for
purge, history compaction, backup restore, fork fingerprint, bundle carries
the backup policy and an open comparison).

Task files beside the tree: `../AudioGubbins-phase-02-brief.md` (rules for
every agent), `-storage-brief.md`, `-safety-brief.md` (done), and
`-interface-brief.md` (the interface and wiring).

### Left to do, in order

The review pass ran; its findings and their triage are kept outside the
repository. Critical and high findings F-01 to F-13 are fixed. The owner ruled
that F-14 and F-15 are fixed in this phase, not moved to Phase 14.

1. Done (`3c41371`). F-14, part one: never write a file its reader cannot
   read back.
   - `project-format` writes canonical text within stated `JsonLimits`
     (`canonicalJsonWithin`, `prettyCanonicalJsonWithin`), refusing with the
     reader's own codes (`json.too-long`, `json.too-deep`) and stopping early
     rather than building a text past the bound.
   - `CheckedRecords.write` and `StateStore.put` return a `DomainResult` and
     refuse, as `storage.record-too-large`, what their readers would refuse.
     Every caller passes the refusal on.
   - A checkpoint storage cannot hold is not written: the session keeps
     journalling, removes nothing, logs it, and tries again at the next
     cadence. A snapshot state it cannot hold stays unwritten and is logged.
     A journal record it cannot hold pauses the queue, not saved, with the
     cause.
   - The export writers (the bundle's project documents and manifest, the
     unpacked tree's text files) refuse an export holding a file its importer
     would refuse.
2. Done (`0ef0633`, `62472ff`). F-14, part two: incremental checkpoints.
   History nodes are written once, in
   immutable segment records of their own; a checkpoint names its segments and
   holds only what changes (cursor, branch names, snapshots, the states nodes
   name, kept states, exports, policies, comparison). A checkpoint writes only
   the segment of nodes added since the last; compaction writes a new segment
   for what it keeps and the removal step drops segments no head names. The
   reader, the writer, compaction, copies, bundle and tree export and import,
   backups and the crash suites all follow.

   Plan, in commits:

   - Step a: Preferences redo follows anyway are not stored. `historyRecordOf`
     leaves out each preference that names the child a reader takes as the
     newest (latest `at`, then identifier), and `historyFromRecord` fills
     every node with children but no preference with that child. Behaviour is
     unchanged (`continuationOf` falls back to the newest child), and a
     linear history stores no preference at all, so a checkpoint no longer
     grows by one entry for every change.
   - Step b: `project-format` exports the whole-graph check of an assembled history
     record (the tree and reference checks `readHistoryRecord` runs), so a
     history read from parts is checked by the same code.
   - Step c: Segments, in one format change (`projectStorage` 2 to 3):
     - Record kind `history-segment` at
       `projects/<p>/segments/<epoch>-<segment id>.json`, holding the project
       id and node records as written. Fresh ids, never content addressed.
     - The checkpoint's `history` holds `project`, `cursor`, the ordered
       segment references `{epoch, id}`, `fingerprints` (node and state, for
       each node whose segment copy lacks the fingerprint it now has),
       `preferred`, `branchNames` and `snapshots`. No node is in it.
     - A `CheckpointFiles` over a checkpoint path and a segments directory
       reads a checkpoint whole (segments read in order, a node in two
       segments, a missing or damaged segment or a fingerprint for an absent
       or differently fingerprinted node refused as an invalid checkpoint)
       and writes one. `ProjectFiles` and `BackupGenerations` each use one,
       so a backup generation holds its own segments and stays whole after
       the project goes.
     - A `SegmentLedger` records what each named segment holds. Planning a
       checkpoint scans the history (as `retainedStates` already does): a
       segment is kept while every node in it is present with the parent it
       was written with; the survivors of any other segment and every node in
       no segment are written in new segments, cut at 1 MiB of text; the
       newest segment is merged into the new one where both fit in 1 MiB, so
       segments stay at most two per MiB of history. Compaction needs no
       segment knowledge.
     - Opening returns the ledger with the checkpoint; the session writer
       keeps it, and updates it only once a head is confirmed.
     - `removeReplaced` removes segments of its epoch or earlier that the
       confirmed checkpoint does not name, under the same fencing argument as
       checkpoints. The module comment says so.
     - `writeProject` (creation, restore, tree import, fork) writes segments
       through the same writer with an empty ledger.
     - Media roots search the segments of projects and backups.
     - Tests, failing first: the second checkpoint writes only the nodes
       added since the first; a missing segment, a duplicated node and a
       stray fingerprint are refused; compaction rewrites only touched
       segments and the removal step drops the rest; a later epoch's segments
       survive a late writer's removal; a backup restores after its project's
       segments are gone; media named only in a segment survive a purge;
       many small checkpoints keep the segment count bounded.
   - Step d: The bound to state in the evidence: a checkpoint grows with branch
     points whose preference is not the newest child, with fingerprints
     learned after a node's segment was written, snapshots, exports and
     segment references (at most two per MiB of history). An export of a
     whole history in one document is still bounded by the record limit and
     is refused, never written, past it (part one).

3. F-15: the storage core in a worker behind a typed port, with a host yield
   and an `AbortSignal` passed through the long paths.
4. Fix or accept, with a reason, every medium finding; track the low ones.
5. Evidence, review record, ledger entry, handoff; this note to
   `docs/todo/done/`; merge `main`; `verify:commit`; land.
6. Drive the built app in a real browser for the changed surfaces, and record
   what a user would see.

### Decisions to carry into the evidence

- Cross-phase limits: importing audio from the interface needs a file's
  audio shape (a codec or engine phase); A/B audition needs the audio engine
  (Phase 03). Phase 02 ships the pipeline, the commands, the comparison and
  promotion.
- The Phase 01 debt's bound on set-aside text drops the oldest unreadable
  shell text with a notice (owner decision F-1022); it touches no project
  data.
- A deleted workspace is restorable for the session only (F-123).
- Bundle import keeps the project id where it is free, else imports a copy.
- Remaining bounded limits: the paired project header can be reverted by a
  late writer's cached name; two openers could race to one epoch number when
  one steals mid-open (holder token makes it narrow); a closed tab is not
  announced to watchers.
- `projectStorage` went from 1 to 2 when the storage root came to record its
  layout (F-13), and from 2 to 3 when history moved into segments (F-14).
  Nothing has been persisted by a shipped build, so neither carries a
  migration: stored data of an older version meets the compatibility screen.
- F-14's bound: a checkpoint grows with branch points whose preference is not
  the newest child, fingerprints learned after a node's segment was written,
  snapshots, exports and segment references (at most two per MiB of history);
  a checkpoint writes at most 1 MiB of history beyond what changed. Planning
  scans the history in memory once per checkpoint, as `retainedStates` already
  did. An export of a whole history in one document is still bounded by the
  record limit, and is refused, never written, past it. The paths past
  2^28 characters have no direct test (too costly to build).
