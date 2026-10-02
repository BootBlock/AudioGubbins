> **Status:** Done. 2026-10-02: every work unit is built, and the one review
> pass of the seven lenses found fifty-six findings, one critical and fourteen
> high, every one fixed, accepted or tracked and written into
> `docs/spec/reviews/phase-02-review.md`, with what the browser check found.
> Phase 02 is closed at `PASS` in the ledger, and its handoff capsule is
> `docs/spec/traceability/handoffs/phase-02.md`. The progress and the list of
> what was left are those of the time they were written, brought to their end.

# Phase 02 — Project and Storage System

Resume note and design record. The packet is
`docs/spec/phases/phase-02-project-and-storage-system.md`; its context pack is
`docs/spec/generated/context/phase-02-context.md`.

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
- `projects/<id>/project.json`: header (name, created, deleted flag, and a
  purging mark written before a purge removes anything, so a purge a crash
  cut short is refused restoring and finished by a later purge, cleanup or an
  import of the same identity).
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
- `media/<content id>`: shared by every project. Roots are what can be
  restored: each checkpoint a head names, with the segments and states it
  names, every journal record, and each whole backup generation's checkpoint,
  segments and states; what no head or generation names, such as what a crash
  tore, retains nothing. Nothing is collected except by an explicit purge.
- The storage-wide lock: a window shares it while it writes what looks left
  over until it is whole (media not yet referred to, a project being made, a
  backup generation); whatever removes left-overs (a purge of media, cleanup
  of unfinished projects and incomplete generations, a scheduler's pruning of
  incomplete ones) takes it alone without waiting and checks again under it
  what the plan saw, so nothing being written is taken for a crash's.
- `backups/<project>/<generation>/`: a checkpoint copy and its states; media by
  content id. An external backup directory, where offered, gets a bundle.
- `cache/<category>/`: disposable, first to go under pressure; each sealed
  with its length and the identity of its bytes. A tree carries its caches
  with an index of their identities, each checked as it is brought in, and a
  cache of media brought in never replaces one the storage keeps.

### Content identity

`ContentId` is the SHA-256 of the byte length and the SHA-256 of each 1 MiB
chunk, so hashing streams, runs in the platform's native digest through an
injected port, and never holds a whole file. Every copy out of the store (a
bundle, an unpacked tree, a backup directory's copy) proves each object's
identity as it streams it, at the cost of one digest pass and no extra read,
and refuses the copy naming an object whose bytes were damaged in place.

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

### Left to do, in order

The review pass ran; its findings and their dispositions are recorded in
`docs/spec/reviews/phase-02-review.md`, where the medium findings M-01 to M-25
are F-16 to F-40 and the low ones L-01 to L-16 are F-41 to F-56. Critical and
high findings F-01 to F-13 are fixed. The owner ruled that F-14 and F-15 are
fixed in this phase, not moved to Phase 14.

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

3. Done in code (`0db234d`, `83a82e7`, `0c459fd` to `c4734d3`, `59f32dc`, and
   the page's import rule after it); one measurement is left. F-15: the
   storage core in a worker behind a typed port, with a host yield and an
   `AbortSignal` passed through the long paths. ADR-0022 records it.

   - What landed beyond the plan: the application holds only the client, the
     kept handles, the digest that names its caches and a logger. Its stores
     use the client's session and view directly, with no interface between,
     since the page has no other kind and its tests run the worker itself.
     Every long operation it starts takes a signal: replaced by a newer
     request (an opening, the list, a measurement, a plan, a backup listing,
     a look at linked files), given up when its project is let go, or when
     the project system is taken down; work given up is neither said nor
     logged. Files the person chose cross as themselves, with their handles.
     A rule in `dependency-rules.test.ts` holds the page to types, and a
     listed value each with its reason, from `storage`, `media-store` and
     `browser-storage`.
   - The host yield and the signal through the packages (`21134c4`, `4547282`,
     `74d0ee8`): one helper, `Turns` in `project-format`, takes a piece of
     work's turns through the injected `YieldToHost` port (moved there from
     `media-store`): a light step asks every 128, a heavy one (a mebibyte
     checksummed) every time, and the signal is checked at each. The worker
     passes the port its tree takes turns with, through the services. ZIP
     reading and writing require it (directory records, chunks); bundle export,
     import and conversion, backups and the raw export pass it; usage, cleanup
     planning and running, the media roots and the store's listing take the
     signal between projects, files and objects; checkpoint segment planning and
     compaction planning take a step per node; a read-only opening and the
     journal plan take the signal. Each has a test that fails on the old code.
   - Measured in Chromium at 16k changes: no long task on the page through
     16,000 renames, a checkpoint on hide or a reload; opening the History
     panel took one 80 ms task, since fixed (`9901b0f`). The figures are in
     the evidence.
   - Measured, not fixed: the `history` package's whole-graph passes are
     synchronous (16k nodes in Node: `applyCompaction` 25 ms,
     `historyFromRecord` 30 ms, `historyRecordOf` 12 ms, `retainedStates` and
     `planCompaction` 4 ms; 100k nodes: up to 220 ms). Turns there make the
     package's API asynchronous, a design decision of its own. A purge, a wipe
     and a soft delete are not given up part-way by design, since a half-removed
     project is worse than a finished removal.

   The page keeps no storage core. Before this it built every storage service
   and only the file reads and writes crossed to the worker, so parsing,
   canonical text, fingerprints, scans, backups and ZIP checksums ran on the
   page (16k changes: 331 ms to write and 483 ms to read one checkpoint).

   - A package `packages/storage-runtime` (DOM and worker; storage, history,
     project-format, project-commands, commands, media-store, browser-storage,
     capabilities, diagnostics, domain), shaped like `audio-runtime`: the
     browser host of project storage, its worker and its typed messages.
     - `protocol/`: the envelopes, read field by field as `tree-protocol.ts`
       reads its own: a call (id, operation, arguments), a cancel, an answer,
       a stream event, and the same three from the worker to the page for the
       page's own ports. Arguments and answers are typed per operation by one
       operation table both ends compile from, so no payload is described
       twice.
     - A call channel used in both directions: ids, one answer per call, a
       cancel posted when the caller's signal aborts, the worker's signal
       aborted by it, a broken channel failing every waiting call. It
       replaces `worker-channel.ts`.
     - `threads/storage-worker.ts`: the worker's composition root (tree,
       digest, ids, clock, leases, bus, stores, repository, keeper, host
       yield), serving the operation table. Its logs reach the page's
       diagnostic centre as stream events under their own category.
     - The page's client: one object per kind of thing the stores use
       (library, open project, transfers, backups, usage and cleanup, the
       storage root, the caches), each a typed facade over the channel.
   - The tree in the worker is the origin-private file system read directly
     through sync access handles: `TreeHandler`'s operations become a
     `StorageTree` over `SyncDirectory` (path locks and per-file queues kept).
     The tree's own messages (`tree-protocol.ts`, `serve-tree.ts`, the page's
     `origin-private-tree.ts`, `origin-private-tree.worker.ts`) are deleted.
   - An open project is a handle in the worker. The page's
     `RemoteProjectSession` and `RemoteReadOnlyProject` keep the surface the
     stores use (subscribe, getSnapshot, run, undo, redo, goTo, snapshots,
     branch names, comparison, policies, compaction, checkpoint, retry,
     transfer, close). The worker publishes snapshot updates: save status,
     access, the state when it changed, and a history delta computed by
     `history` (`historyDelta`, `applyHistoryDelta`: nodes added and removed,
     cursor, preferences, branch names, snapshots), so the page's mirror keeps
     persistent maps and identity per publish, and a change costs the page
     one node and one state, never the history.
   - Page ports cross as page-held handles the worker calls back: byte sinks
     (bundle, backup, raw export, the backups folder), byte sources (an
     imported file), directory readers and writers (the unpacked tree), and
     `locate` for consolidation, so permission prompts stay on the page.
     Bytes are transferred, copied at most once.
   - `ProjectRepository.list` becomes a call that answers the entries, read
     whole in the worker.
     `TreeFailure` crosses as a refusal with its kind, made again on the page.
   - The host yield (`scheduler.yield` in the worker) is passed through every
     long path, so a cancel or another call is heard mid-path, and every long
     path takes the signal: `bundle-writing.ts:87-89`, `zip-reading.ts:109-122`,
     `usage-measurement.ts:101,180`, `command-journal.ts:122`,
     `state-store.ts:111`, `cleanup-planning.ts:386,446` (M-23), and the app
     passes a signal to every long operation it starts.
   - Commits, each failing first: the history delta; the direct tree; the
     channel and envelopes; the worker and the client, area by area; the app
     moved onto the client with the old tree messages deleted, and a
     dependency rule that the page imports `@audiogubbins/storage` for types
     only; the yield and signal per path. The app's test world runs the real
     worker composition over an in-process pair that structured-clones every
     message, as the tree's own test pair did. Measure again: 16k changes, a
     checkpoint and an open, page time per publish.

4. Fix or accept, with a reason, every medium finding; track the low ones.
   Every medium finding is fixed; the limits accepted with them are listed
   after the fixes.
   - M-23 (no signal and no host yield through the long paths): fixed, the app
     in `59f32dc` and the packages in `21134c4`, `4547282` and `74d0ee8`.
   - M-02 (import decided by matching failure codes, read twice): fixed in
     `d060de8`. M-04 (media caches replaced, tree caches unchecked): fixed in
     `c77bcde`. M-22 (media hashed three times on import): fixed in
     `dd92f7d`. M-21 (whole histories held in memory): fixed in `c22a531`.
   - M-03 (provenance labels): the labels and words say what each level keeps,
     with a test per level (`f3e0c04`). The owner chose to export a whole
     history at every level with its undo kept (`6a5a903`, `5b8523b`,
     `066e096`; a snapshot's author is left out below full in `1814752`; the
     note is `docs/todo/done/whole-history-provenance.md`). Media a change
     names inside a nested value is found for exports and purges (`8e0c07b`).
   - The torn-segment bound on media purges is removed (`2e9ca23`).
   - M-05 (cleanup acting on what is still being written): every writer of a
     project or a backup generation shares the storage-wide lock until it is
     whole, and what removes left-overs takes it alone and looks again
     (`a0b4dec`). M-06 (expired history planned from the newest checkpoint's
     policy): planned from the journal (`a5456cb`).
   - M-07 (a purge cut short restored as a broken project): the header is
     marked purging first, and restore refuses it (`6741876`). M-09 (crash
     injection missing): one shared crash harness, and every storage operation
     swept (`93a7f44`, `1abe098`). M-10 (round-trip oracle blind to most of a
     project): it compares whole projects (`24fb824`). M-08 (comparison of a
     snapshot untested across a reload): the random sessions and the crash
     script compare snapshots (`98f0aa8`).
   - M-19 (export never proving managed media): media is proved as it is
     copied out (`eed3e7d`). M-20 (a checkpoint at every hide): none is written
     where nothing changed (`36f4299`). M-24 (one undo walking the history
     three times): a path costs its own length (`a9495ee`).
   - M-25 (half-wired exports): promotion goes through the history's own
     (`8d3efc1`); the exports with no use were removed there, and
     `contentRetention` is used by usage (M-15). M-18 (relinking dropped the
     protected copy): kept, through the worker (`270672b`). M-13 (A/B only
     against the cursor, counts only): any two states, said entity by entity,
     worked out again after a reload (`86590d6`). M-11 (retention never ran on
     its own; no recovery snapshot): it runs after each checkpoint, and a
     restore in place keeps a recovery snapshot (`cc9ea53`).
   - M-01 (the project-name rule in several places): one rule in
     `project-format`, built on the text package's, held by the commands, the
     catalogue, forks, the readers every import passes through, and the page
     (`6df63ff`).
   - M-12 (backup budget unreachable, scheduled failures only logged, partial
     generations piling up): the size is set in the settings and kept; a
     scheduled backup not made is said in the status bar beside the save
     status, and aloud once, until one is made; a failed attempt's leavings
     are removed as it fails (`185598f`).
   - M-14 (History panel): each row says what its change affected and a
     snapshot's notes, the chosen point lists them with a filter to one
     entity's changes, and snapshots take notes; the list draws only the rows
     in sight through the design system's row window, rows are memoised, and
     the chosen row is scrolled to only when the choice moves (`b73d8c5`).
   - M-15 (usage categories, the cleanup plan's one sentence): segments are
     split between the line and the other branches, retained audio is split
     by what keeps it through `contentRetention`, and each cleanup step lists
     what it takes (`13053b8`).
   - M-16 (per-asset source policy, the copy or link setting read by
     nothing): the question about changed linked files sets each asset's
     policy through a command; the import pipeline takes a link's policy and
     its copy or link choice from the media store's one definition the
     setting holds (`69cbf7a`).
   - M-17 (take over offered against a live owner): asking comes first, and
     taking over is offered only once a request went unanswered, by a window
     gone, stopped or too slow to answer, while that window holds the project
     (`46a1b15`).
   - Accepted limits:
     - The import of audio from the interface arrives with the codec phase
       (Phase 09, "Importing audio into the open project"), so nothing in this
       phase runs the import pipeline: the copy or link setting is read, and a
       policy is given to a new asset, by that import job. Until then the
       question about changed linked files is the one place an asset's policy
       is set in the interface.
     - The History list draws rows of one height, two lines cut short where
       they are long; the chosen point says all of it.
     - A history segment's bytes are split by the length of the text of the
       nodes it holds on and off the line, which leaves its header with the
       line's share.
     - A request counts as unanswered after 30 seconds, or at once where the
       window holding the project hears no request; a request the other
       window declined offers no take over, and asking again is offered.
   - The low findings, by the review record's numbers: F-41 (a commit that
     did not build alone) made one with the next before landing; F-44 (this
     note's working directories and task files) removed on closing; F-47
     fixed in `fd6f354`, F-48 in `1e87e79` and F-50 in `9c10071`; F-55 fixed
     in part in `59f32dc` and `8b755e5`, the domain's identifier generator
     still writing hex itself since the domain depends on no package; F-51
     fixed in part by `c77bcde`; the rest tracked to Phases 05, 09, 12 and 14
     in the review record.
5. Done. Evidence, review record, ledger entry and handoff, written into
   `docs/spec/`; this note moved to `docs/todo/done/`.
6. Done. The built application was driven in Chromium over every changed
   surface. What it found is fixed: the History panel built every row at
   opening (`9901b0f`) and cut a point's time rather than its description
   (`74494b9`); a backup not made was given the save status's words
   (`784813d`); the offer to link a chosen file was shown twice (`65b3675`);
   every backup's keep button had one name (`2b99c6d`); a tab losing a project
   could not name the taker when the notice came after the steal (`223b0e0`);
   and two browser tests were brought up to date (`636894c`).

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
  layout (F-13), from 2 to 3 when history moved into segments (F-14), and
  from 3 to 4 when the header gained the purging mark, and from 4 to 5 when
  a cache's seal came to hold the identity of its bytes. `portableBundle` went
  from 1 to 2 when a tree came to list its caches with their identities.
  Nothing has been persisted by a shipped build, so none carries a
  migration: stored data of an older version meets the compatibility screen.
- F-14's bound: a checkpoint grows with branch points whose preference is not
  the newest child, fingerprints learned after a node's segment was written,
  snapshots, exports and segment references (at most two per MiB of history);
  a checkpoint writes at most 1 MiB of history beyond what changed. Planning
  scans the history in memory once per checkpoint, as `retainedStates` already
  did. An export of a whole history in one document is still bounded by the
  record limit, and is refused, never written, past it. The paths past
  2^28 characters have no direct test (too costly to build).
