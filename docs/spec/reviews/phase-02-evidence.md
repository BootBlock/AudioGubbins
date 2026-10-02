# Phase 02 — Project and Storage System — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the tree this package describes, the phase branch
after its one review pass and the fixes that answered it, except where a
section says it is still to be recorded.

## Phase identifier and objective

- **Phase:** 02 — Project and Storage System.
- **Objective:** the authoritative project, its persistence, history,
  storage, backups, recovery, external-media identity and single-writer
  ownership, without depending on the later audio-editing interface.
- **User-visible outcome:** the person creates, opens, renames, forks,
  deletes, restores and purges projects kept in the browser; every change is
  saved as it is made and survives a reload or a crash; the History panel
  shows a branching history with named snapshots, comparison of any two states
  and compaction; backups are made by policy or by hand and restored as a new
  project or in place; a project goes out and comes back as a portable bundle
  or a Git-friendly unpacked folder; a second tab opens a project to read and
  asks for it; the Storage panel says what each part of storage takes and
  cleans it up safest first; stored data of another schema blocks every
  project until the person exports it or wipes it.

## Checklist

Every box in the packet's **In Scope** list:

- Versioned project schema: `packages/project-format` (the aggregate
  `ProjectState`, the project document read field by field, canonical JSON,
  `projectDocument` in `version.json`).
- OPFS/internal storage abstraction: the `StorageTree` port in
  `packages/project-format`, the in-memory reference tree in
  `packages/media-store/src/testing`, and `SyncStorageTree` over sync access
  handles in `packages/browser-storage`, run inside the storage worker
  (`ADR-0022`).
- External source references and integrity tracking:
  `packages/media-store` (`source-observation.ts`, `source-classification.ts`,
  `source-resolution.ts`), kept handles in
  `packages/browser-storage/src/kept-files.ts`, and the question about changed
  linked files in `apps/web/src/shell/source-change-prompt.tsx`.
- Content-addressed media store and deduplication:
  `packages/media-store/src/object-store.ts`, with `ContentId` in
  `packages/project-format/src/content-identity.ts`.
- Command journal and immutable snapshots: `packages/storage`
  (`command-journal.ts`, `state-store.ts`, the double head, checkpoints and
  history segments).
- Branching history and named snapshots: `packages/history`, the session's
  moves in `packages/storage/src/history-moves.ts`, and the History panel.
- Single-writer multi-tab ownership: `ProjectWriteLease` in
  `packages/storage/src/write-lease.ts`, Web Locks and a broadcast channel in
  `packages/browser-storage/src/web-lock-leases.ts`, the ownership banner and
  commands in `apps/web`.
- Autosave/recovery and backup generations: the session writer and
  recovery in `packages/storage`, `backup-generations.ts`,
  `backup-planning.ts`, `backup-scheduler.ts`, and the backup settings.
- Portable bundle and Git-friendly unpacked project format: the ZIP
  container, bundle manifest and unpacked tree in `packages/project-format`,
  their export and import in `packages/storage` (`project-transfer.ts`,
  `tree-import.ts`).
- Pre-1.0 incompatibility backup/wipe flow: `packages/storage/src/storage-root.ts`
  and `apps/web/src/shell/compatibility-screen.tsx`.
- Deleted-media retention and explicit purge: soft delete, restore and purge
  in `packages/storage/src/project-catalogue.ts`, media roots and collection in
  `media-roots.ts` and `packages/media-store/src/collection.ts`.
- Storage inspection/compaction: `usage-measurement.ts`, `cleanup-planning.ts`,
  `cleanup-running.ts`, `history-compaction.ts`, and the Storage panel.
- Project provenance: asset import provenance and export records in
  `packages/project-format`, provenance levels and their stripping, and what
  each project command declares of its arguments' provenance.

Work units: WU-02.A to WU-02.E as the packet defines them, every box done.

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/project-format` | The authoritative project as values: `ProjectState`, `ContentId` and the chunked content digest, external source identity, source change policy, export provenance and its stripping, canonical JSON written within the reader's limits, the runtime-validated project document, the one pre-1.0 compatibility rule, the project-name rule, the ZIP container, the bundle manifest, the unpacked tree, history segments, and `Turns` over the injected `YieldToHost` port. |
| `packages/project-commands` | The project commands, each with its inverse, and what each declares of its arguments' provenance. The packet's `packages/commands/project` (`ADR-0020`). |
| `packages/history` | The branching history as values: nodes, cursor, paths, branch names, snapshots, comparison and the difference of two states, affected entities, retention, compaction planning, and the history delta the page's copy is kept by. |
| `packages/media-store` | The content-addressed object store over a tree port, import by copy or by link, the progressive fingerprint, the classification and resolution of an external source, and reachability with deterministic collection. |
| `packages/storage` | The storage root and its compatibility and wipe, `ProjectRepository`, `CommandJournal`, `SnapshotStore`, checkpoints, segments and the double head, the project session, `ProjectWriteLease`, recovery, backups, usage, cleanup and purge, caches, forks, and bundle and unpacked export and import. |
| `packages/browser-storage` | The ports in the browser: the origin-private file system through sync access handles, Web Locks and broadcast channels for the lease, kept file handles in IndexedDB, the pickers, sinks and file sources. |
| `packages/storage-runtime` | The storage worker's composition root, the typed port between it and the page (one operation table both ends compile from), and the page's client, a typed facade for each kind of thing the stores use (`ADR-0022`). |
| `packages/capabilities` | The storage platform: the origin-private file system, Web Locks, broadcast channels, IndexedDB for kept handles and the pickers, read as capabilities and passed in. |
| `packages/design-system` | A row window that draws only the rows of a long list in sight, used by the History list. |
| `packages/workspace`, `packages/diagnostics` | A deleted workspace held for restoring (Phase 01's debt), and the storage worker's records relayed into the page's diagnostics under their own category. |
| `apps/web` | The project, library, transfer, backup, usage and source-change stores over the storage client, the project, history, storage, backup, ownership and linked-file commands, the Projects dialogue, the History and Storage panels, the compatibility screen, the ownership banner, the save and backup status, and the editor's peaks kept in the storage's waveform caches. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| Project schema + runtime validator | `ProjectState`, with `readProjectDocument`, `writeProjectDocument` and `parseProjectDocument`, in `@audiogubbins/project-format`. |
| ProjectRepository | `ProjectRepository` in `@audiogubbins/storage`. |
| MediaObjectStore | `MediaObjectStore` in `@audiogubbins/media-store`. |
| ExternalSourceIdentity | `ExternalSourceIdentity` in `@audiogubbins/project-format`. |
| CommandJournal | `CommandJournal` in `@audiogubbins/storage`. |
| SnapshotStore | `SnapshotStore` in `@audiogubbins/storage`. |
| ProjectWriteLease | `ProjectWriteLease` in `@audiogubbins/storage`, implemented over Web Locks in `@audiogubbins/browser-storage`. |
| PortableBundle manifest | `BundleManifest` in `@audiogubbins/project-format`, of the schema `portableBundle`. |
| BackupPolicy | `BackupPolicy`, with its one checked constructor, in `@audiogubbins/project-format`. |

The storage worker's messages are a discriminated union read field by field
in `packages/storage-runtime/src/protocol`, typed per operation by one
operation table. A dependency rule in `tests/architecture/dependency-rules.test.ts`
holds the page to types from `@audiogubbins/storage`, `@audiogubbins/media-store`
and `@audiogubbins/browser-storage`, and to the values it lists, each with its
reason.

## ADRs created and changed

- `ADR-0020` — project storage is six packages over ports, with a protocol
  that needs no atomic rename: every file but the two heads written once and
  checksummed, history nodes in segments of their own, lease fencing by epoch.
- `ADR-0021` — the editor's markers and regions move into the project when
  audio is imported at its own rate, not when the project system arrives:
  a marker is stored at its asset's own frames, and nothing on the branch
  reads a file's rate. Phase 09 owns the import and the move; Phase 05's
  readiness review settles whether native-rate reading comes forward.
  `ADR-0047` records the amendment.
- `ADR-0022` — the storage core runs in a worker behind a typed port, and the
  page holds only the client. The owner ruled that this is fixed in Phase 02
  rather than Phase 14.
- `ADR-0043` is fulfilled as it says: its peak cache was the application's
  own IndexedDB store until Phase 02's cache store arrived, and the peaks are
  now the storage's waveform caches (`ddae073`), counted in the Storage panel
  and given up first under pressure.

## Tests

| Area | Where |
| --- | --- |
| Format, canonical JSON, limits, names | `packages/project-format/src/project-json.test.ts`, `document-reading.test.ts`, `canonical-json.test.ts`, `compatibility.test.ts`, `packages/project-commands/src/project-name-commands.test.ts` |
| ZIP, bundle and unpacked tree | `zip-reading.test.ts`, `zip-writing.test.ts`, `zip64.test.ts`, `zip-interop.test.ts`, `bundle-manifest.test.ts`, `project-tree.test.ts`, `project-tree.roundtrip.test.ts`, `project-tree.provenance.test.ts` |
| Project commands and provenance | `packages/project-commands/src/*.test.ts`, `provenance-stripping.test.ts`, `history-stripping.test.ts` |
| History, comparison, delta | `packages/history/src/*.test.ts` |
| Media store and linked files | `packages/media-store/src/*.test.ts` |
| Journal, states, segments, recovery | `packages/storage/src/command-journal.test.ts`, `state-store.test.ts`, `history-segments.test.ts`, `segment-ledger.test.ts`, `session-writer.test.ts`, `*.recovery.test.ts` |
| Sessions and round trips | `project-session.test.ts`, `project-session.roundtrip.test.ts`, `project-transfer.roundtrip.test.ts`, `project-fork.roundtrip.test.ts`, `testing/model-summary.test.ts` |
| Quota | `project-session.quota.test.ts`, `bundle-import.quota.test.ts`, `storage-cleanup.quota.test.ts`, `packages/browser-storage/src/sync-storage-tree.test.ts` |
| Leases and ownership | `packages/storage/src/write-lease.test.ts`, `packages/browser-storage/src/web-lock-leases.test.ts`, `apps/web/src/commands/ownership-commands.test.ts`, `apps/web/src/shell/project-banner.test.tsx` |
| Backups, cleanup, usage, caches | `backup-*.test.ts`, `cleanup-running.test.ts`, `expired-history.test.ts`, `usage-measurement.test.ts`, `media-roots.test.ts`, `media-purge.test.ts`, `cache-store.test.ts`, `tree-import.test.ts` |
| Storage worker and client | `packages/storage-runtime/src/**/*.test.ts`, `packages/storage/src/project-turns.test.ts`, `storage-scans.test.ts` |
| Application stores, commands and panels | `apps/web/src/state/*.test.ts`, `apps/web/src/commands/*.test.ts`, `apps/web/src/shell/**/*.test.tsx` |
| Layering, exports and the page's imports | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/projects.spec.ts` (the `chromium-projects` and `firefox-projects` projects) |

## Commands used for verification

```
pnpm run lint                        # pnpm run version:check, pnpm run graph:check, eslint ., prettier --check .
pnpm run typecheck:full              # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json
pnpm run test                        # vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.cache/audiogubbins/vitest-report.json
pnpm run record:check                # node tools/check-record-titles.mjs
pnpm run test:dependencies           # depcruise --config .dependency-cruiser.cjs apps packages tests tools
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:recovery               # vitest run --project media-store --project storage recovery
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:storage-quota          # vitest run --project storage quota
pnpm run test:architecture           # pnpm run test:dependencies, vitest run --project architecture
pnpm run test:e2e                    # playwright test, every project
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet also names `pnpm test --filter project-format --filter storage --filter history`,
which pnpm reads as workspace filters: it runs each package's own `test`
script, and each runs its Vitest project from the root. The packet's
`test:recovery`, `test:project-roundtrip` and `test:storage-quota` are root
scripts that select the suites named for them; every test they select is also
in the whole run.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Pass over the closing tree: lint and formatting clean, both type-checks clean, 5,773 tests passed in 389 files, 0 failed, every one of 1,948 cited titles resolved, no dependency violations in 1,321 modules. |
| `pnpm run record:check` | Pass over every review record, this phase's included. |
| `pnpm run spec:verify` | Pass. |
| `pnpm run test:e2e` | Not run whole. The browser check below drove the built application by hand and by script in Chromium, and the hand-over test of `tests/e2e/projects.spec.ts` passed twenty times of twenty there (`223b0e0`). |

## Browser measurements

Measured in Chromium against the built application, a project of 16,000
changes made through the Projects dialogue, with the page's long tasks (50 ms
or more) observed throughout:

| What was done | Page long tasks |
| --- | --- |
| 16,000 renames through the Projects dialogue, about 25 ms each, 420 s in all | 0 |
| A checkpoint as the page is hidden, over a 10 s window | 0 |
| A reload until the project is open again, 1,028 ms | 0 |
| Opening the History panel at 16,000 points | One of 80 ms before `9901b0f`; see below |

- Opening the History panel made a row for every point before `9901b0f`, which
  builds only the rows the list reads and carries the rows' order from one
  history to the next. Since that commit, opening the panel at 16,000 points
  takes about 12 ms in jsdom, and building the order once at opening about
  12 ms; it has not been measured in a browser again.
- The History list at 16,000 points keeps 20 to 30 row elements in the page,
  and scrolling it took a median of 16.7 ms a frame, 18.7 ms at the 95th
  percentile.
- The console showed no error.

Against these, before the storage core moved into the worker, the page
itself took 331 ms to write and 483 ms to read one checkpoint of a 16,000-change
project.

Measured before the browser, in Node and in process, through the worker's
real composition over a port that structured-clones every message:

- One change costs the page its node and its path: the page's update for one
  change took a median of 0.020 ms at 16,000 changes.
- An opening at 16,000 changes held the page for about 160 ms in one task
  when the whole history came in one answer. Sent in slices of at most 1,000
  entries of each map (`c6f3741`), its longest page task fell to about 15 ms
  across 17 messages, the total unchanged.
- Before the storage core moved into the worker, the page wrote one
  checkpoint of a 16,000-change project in 331 ms and read it in 483 ms, on
  the page's own thread (the measurement `ADR-0022` was taken on).
- The `history` package's whole-graph passes run synchronously in the
  worker: at 16,000 nodes `applyCompaction` 25 ms, `historyFromRecord` 30 ms
  and `historyRecordOf` 12 ms (`retainedStates` and `planCompaction` 4 ms); at
  100,000 nodes 192 ms, 219 ms and 141 ms. Accepted: they are off the UI
  thread, and giving them turns would make the package's interface
  asynchronous, a design decision of its own.

## Browser and device results

The built application was driven in Chromium over every surface the phase
changed:

- Projects made and changed survive a reload.
- A second tab opens a project to read, asks for it first, and takes it over
  only once its request went unanswered; the tab that lost it names the taker.
- A name of invisible code points alone is refused.
- Backups: the size budget set and kept, the delete confirmation, letting a
  backup go, and the notice of a scheduled backup not made.
- The History panel: rows with what each change affected, the filter to one
  entity, snapshot notes, and a comparison of two chosen sides.
- The Storage panel's parts of storage and its cleanup plan, each step listing
  what it takes.
- The provenance levels, and a whole history exported at the lowest level and
  brought back in as a copy.
- The compatibility screen on stored data of another version.
- The Editor panel's sentence that markers are kept once audio is imported.
- Relinking a changed file to another, and replacing a folder holding another
  project.

It could not reach the cleanup's sentences for left-over items, which need a
crash or another window mid-write; the component tests in
`apps/web/src/cleanup-words.test.ts` and the Storage panel's hold them.

`tests/e2e/projects.spec.ts` drives the built application in Chromium and in
Firefox: `keeps a project it made, and a change made to it, across a reload`,
`opens a project another tab is changing to read, names that tab, and hands it over and back`,
`exports a project as a bundle and brings the bundle back in`,
`blocks every project on stored data of another version until the person decides`
and `fits each point of the History panel to its width, cutting the description short and not the time or marks`.

## Known limitations

- Importing audio from the interface needs a file's audio shape (its rate,
  channels and length), which a codec reads: Phase 09's, whose packet names
  importing audio into the open project. Phase 02 ships the import pipeline,
  the copy or link choice with its explanation, and the commands, tested
  through a probe port. Nothing in this phase's interface runs the pipeline,
  so the copy-or-link setting is read only by the pipeline until Phase 09, and
  the question about changed linked files is the one place the interface sets
  an asset's policy. `REQ-STOR-166`'s source rate, bit depth, channel layout
  and duration arrive with the same reading.
- Auditioning A and B needs the project's audio played by the audio engine
  (Phase 03's), and a project holds no audio from the interface until import
  arrives. Phase 02 ships the comparison of any two states, switching, the
  difference entity by entity and promotion.
- Markers and regions stay the session's until audio is imported at its own
  rate (`ADR-0021`).
- A snapshot's state that is present but damaged is found when it is used,
  not when the project opens: opening reads the cursor's state, rebuilds it
  where its file does not hold what its name promises and reports it, and a
  snapshot is read and checked when it is gone to or compared.
- A purge, a wipe and a soft delete are not given up part-way, by design: a
  project half removed is worse than a removal finished. Each runs under its
  lock, and a purge cut short by a crash is marked and finished later.
- Paths past the record reader's 2^28 characters have no direct test: a
  history that large is too costly to build in a test. The writers refuse one
  code unit past the limit a reader accepts, and those tests hold the bound
  at small limits.
- Bounded limits recorded in the design: the paired project header can be
  reverted by a late writer's cached name; two openers could race to one epoch
  number when one steals mid-open, which the holder token makes narrow; a tab
  closed is not announced to watchers.
- The History list draws rows of one height, two lines cut short where they
  are long; the chosen point says all of it.
- A history segment's bytes are split between the line and the other
  branches by the length of the text of the nodes it holds of each, which
  leaves its header with the line's share.
- A request for a project counts as unanswered after 30 seconds, or at once
  where the window holding it hears no request; a request declined offers no
  take over, and asking again is offered.
- Known flaky tests under load, each passing alone: in
  `tests/architecture/dependency-rules.test.ts`,
  `keeps ESLint and Prettier out of every directory the cruise excludes`; in
  `packages/test-fixtures/src/processor-cost.test.ts`,
  `reads four times the work as about four times the cost, and the same work as the same`;
  in `packages/storage/src/project-transfer.roundtrip.test.ts`,
  `seed 11: a bundle brings the whole project into another storage`;
  timeouts in `apps/web/src/keyboard-wiring.test.tsx` under load; and a Vitest
  worker that crashes as it starts on the test machine (exit 3221225477), which
  a rerun clears.

## Decisions recorded

- **Light gates** (the owner's decision of 2026-09-28): one review pass with
  every lens the packet names, its verified findings fixed or accepted, no
  mutation harness and no looped rounds. Each fix still carries a test seen to
  fail against the code it replaced.
- **F-14 and F-15 are fixed in Phase 02, not Phase 14** (the owner's ruling):
  incremental checkpoints, and the storage core in a worker (`ADR-0022`).
- Bundle import keeps the project's identity where it is free, and imports a
  copy otherwise.
- The bound on set-aside text drops the oldest unreadable shell text with a
  notice (the owner's decision on Phase 01's F-1022); it touches no project
  data. A deleted workspace is restorable for the session (Phase 01's F-123).
- A whole history is exported at every provenance level with its undo kept
  (the owner's decision; `docs/todo/done/whole-history-provenance.md`).

### F-14's bound

A checkpoint holds no history node: nodes are written once, in immutable
segments a checkpoint names. A checkpoint grows only with branch points whose
redo preference is not the newest child, fingerprints learned after a node's
segment was written, snapshots, exports and segment references, at most two
per MiB of history, and writes at most 1 MiB of history beyond what changed.
Planning scans the history in memory once per checkpoint, taking a host turn
per node. An export of a whole history in one document is still bounded by the
record limit, and is refused, never written, past it.

## Dependencies added, and their review

None outside the workspace. Every new package dependency is `workspace:*`.

## Migration and schema impact

New schemas in `version.json`: `projectDocument` 1, `projectStorage` and
`portableBundle`. Nothing has been persisted by a shipped build, so no change
carries a migration: stored data of an older version meets the compatibility
screen (`REQ-STOR-052`).

| Schema | Version | Change |
| --- | --- | --- |
| `projectStorage` | 1 | The storage format as first built (`ef31d5d`). |
| `projectStorage` | 2 | The storage root records every stored schema, `projectDocument` among them (`3a68c88`, F-13). |
| `projectStorage` | 3 | History nodes move into segments of their own (`62472ff`, F-14). |
| `projectStorage` | 4 | The project header gains the purging mark (`6741876`). |
| `projectStorage` | 5 | A cache's seal holds the identity of its bytes (`c77bcde`). |
| `portableBundle` | 2 | A tree lists its caches with their identities (`c77bcde`). |

The editor's peaks moved from the application's own IndexedDB database into
the storage's waveform caches; the old database is no longer opened.

## Screenshots and recordings

None kept in the tree. The browser suite and the drive recorded above are the
evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-STOR-021` Undo, redo, autosave and recovery | Every change journalled as it is made, checkpoints by cadence and on hide, undo, redo and moves to any node at the cost of the path, recovery to the last acknowledged change or the one cut short, and the save status. | `project-session.test.ts`, `project-session.recovery.test.ts`, `session-writer.test.ts`, `navigation.test.ts`, `save-status.test.tsx`, `projects.spec.ts`. |
| `REQ-STOR-025` Storage model | The origin-private file system behind a tree port, the internal store, linked files, imported copies, bundles, the copy or link choice with its explanation, and directory access as a capability. | `sync-storage-tree.test.ts`, `project-catalogue.test.ts`, `media-import.test.ts`, `storage-platform.test.ts`, `project-settings.test.tsx`. |
| `REQ-STOR-026` Project format | A documented, versioned project document in canonical JSON, read field by field, and a portable bundle. | `project-json.test.ts`, `document-reading.test.ts`, `canonical-json.test.ts`, `project-transfer.roundtrip.test.ts`. |
| `REQ-STOR-027` Cache model | Caches by category, sealed with their length and identity, never authoritative, given up first and made again. | `cache-store.test.ts`, `stored-peak-cache.test.ts`, `tree-import.test.ts`. |
| `REQ-STOR-052` Schema compatibility | One pre-1.0 rule; the storage root records every stored schema; the blocking screen offers a raw export, cancel and a confirmed wipe; no migration. | `compatibility.test.ts`, `storage-root.test.ts`, `compatibility-screen.test.tsx`, `projects.spec.ts`. |
| `REQ-STOR-053` Source change policy | Prompt by default, adopt, freeze where a copy is kept, relink only to the same file or when asked, set per asset by an undoable command. | `source-resolution.test.ts`, `source-change-store.test.ts`, `source-change-prompt.test.tsx`, `packages/project-commands/src/source-commands.test.ts`. |
| `REQ-STOR-055` Retention policy | Unlimited by default; a budget or rules set with a confirmation of what they let go, run after each checkpoint; snapshots and the history they stand on never let go. | `retention.test.ts`, `compaction.test.ts`, `history-compaction.test.ts`, `expired-history.test.ts`. |
| `REQ-STOR-098` Single-writer ownership | A lease over Web Locks fenced by epoch, a second tab opened to read naming the writer, a request answered or declined, take over only once a request went unanswered, and read-only where writers cannot be coordinated. | `write-lease.test.ts`, `web-lock-leases.test.ts`, `ownership-commands.test.ts`, `project-banner.test.tsx`, `projects.spec.ts`. |
| `REQ-STOR-099` Content-addressed media | `ContentId` over 1 MiB chunks, streamed, stored once across projects, and proved as it is copied out. | `object-store.test.ts`, `content-identity.test.ts`, `content-hashing.test.ts`, `project-transfer.roundtrip.test.ts`, `project-export.media.test.ts`. |
| `REQ-STOR-101` Journal and immutable snapshots | Numbered journal records fenced by epoch, immutable checksummed states and segments, two heads, and recovery that stops at the first damaged record and keeps the rest aside. | `command-journal.test.ts`, `state-store.test.ts`, `history-segments.test.ts`, `segment-ledger.test.ts`, `project-session.recovery.test.ts`. |
| `REQ-STOR-102` Deleted media and purge | Soft delete and restore; media kept while any head, segment, journal record or whole backup names it; a purge planned, confirmed, marked first and run under the storage-wide lock. | `project-catalogue.test.ts`, `project-catalogue.recovery.test.ts`, `media-roots.test.ts`, `media-purge.test.ts`, `collection.test.ts`, `content-references.test.ts`, `deleted-projects.test.tsx`. |
| `REQ-STOR-103` Unpacked format | One file per entity, the header first, canonical text, media by reference, a folder claimed before it is written. | `project-tree.test.ts`, `project-tree.roundtrip.test.ts`, `project-transfer.test.ts`. |
| `REQ-STOR-104` Source identity | A kept handle, size, time, sampled ranges and the full content identity taken progressively; samples count only where the time is kept. | `source-observation.test.ts`, `source-classification.test.ts`, `source-sampling.test.ts`, `kept-files.test.ts`. |
| `REQ-STOR-105` Backup generations | By changes or time, retention by count, age and size with the newest kept, protected and hand-made generations, an external folder, restore as new or in place, and a failed scheduled backup said. | `backup-generations.test.ts`, `backup-planning.test.ts`, `backup-restoring.test.ts`, `backups-client.test.ts`, `backup-status.test.tsx`. |
| `REQ-STOR-106` Cleanup priority | Caches first, then unfinished projects, expired backups and history, set-aside records and media, each step listing what it takes, and nothing past the caches without confirmation. | `storage-cleanup.quota.test.ts`, `cleanup-running.test.ts`, `usage-client.test.ts`, `storage-panel.test.tsx`. |
| `REQ-STOR-166` Asset provenance | An asset's import provenance (its file, identity, time and origin project), export records, provenance levels, and the arguments each command declares. The source's audio shape arrives with Phase 09's reading. | `asset-record-json.test.ts`, `media-import.test.ts`, `project-commands.provenance.test.ts`, `provenance-stripping.test.ts`. |
| `REQ-STOR-193` Branching history | Every branch kept, redo along the preferred line, branch names, and the page's copy kept by a history delta. | `history.test.ts`, `lines.test.ts`, `project-session.test.ts`, `history-delta.test.ts`. |
| `REQ-STOR-194` Named snapshots | Snapshots with names and notes that hold their state whole and survive reload. | `snapshots.test.ts`, `project-session.test.ts`, `history-panel.test.tsx`. |
| `REQ-STOR-195` A/B comparison | Any two points or snapshots compared, switched, kept across reload, said entity by entity, and either promoted. Audition is a known limitation. | `comparison.test.ts`, `state-diff.test.ts`, `difference-names.test.ts`, `history-commands.test.ts`, `project-session.test.ts`. |
| `REQ-STOR-196` History panel | Every point in plain words with what it affected, search and a filter to one entity, the actions at a point by command, and a row window. | `history-panel.test.tsx`, `history-list.test.tsx`, `history-rows.test.ts`. |
| `REQ-STOR-197` Export provenance | An export record per export, with its status, partial included, kept in the history and with the snapshot it was made from. | `export-record-json.test.ts`, `project-session.test.ts`, `project-transfer-commands.test.ts`. |
| `REQ-STOR-198` External side effects | An export is recorded, never undone. | `project-session.test.ts` (`never offers to undo an export (REQ-STOR-198)`). |
| `REQ-STOR-199` Forks | A fork from any node or snapshot, the source untouched. | `project-fork.roundtrip.test.ts`, `project-copies.recovery.test.ts`. |
| `REQ-STOR-200` Inspection and compaction | Usage by category, history split between the line and other branches, retained media by what keeps it, and compaction confirmed by its plan. | `usage-measurement.test.ts`, `history-compaction.test.ts`, `storage-panel.test.tsx`. |
| `REQ-PROD-038` Cloud extensibility (deferred) | Nothing of a cloud is built; storage is reached through its tree port and the worker's client, which another backend could implement. | `storage-tree.test.ts`. |
| `REQ-STOR-100` Project encryption (excluded) | No encryption subsystem. | None. |

The packet's acceptance criteria:

- Randomised round trips preserve authoritative state:
  `project-session.roundtrip.test.ts`, `project-transfer.roundtrip.test.ts`,
  `project-tree.roundtrip.test.ts`, with whole projects compared by
  `testing/model-summary.ts`.
- Crash injection at every persistence transaction boundary: one shared
  sweep crashes every storage operation at every tree operation, in the
  torn-write forms each asks for, a write torn at its full length among them
  (`*.recovery.test.ts`).
- Two-tab ownership: `write-lease.test.ts` and `web-lock-leases.test.ts` run
  one scenario over the in-memory coordinator and over Web Locks, and
  `projects.spec.ts` drives two tabs.
- Identical media deduplicates without breaking a self-contained export:
  `keeps media once however many projects bring it in, and refuses a second original`
  and `carries every piece of media a project shares with another`.
- Snapshots, branches, A/B states and forks survive reload: the random
  sessions compare snapshots, branches and comparisons across reload and
  crash (`98f0aa8`), and `project-fork.roundtrip.test.ts`.
- Deleted media stays recoverable until an explicit purge or compaction:
  `deletes softly, keeping everything, restores, and purges only on confirmation`,
  `media-roots.test.ts` and `content-references.test.ts`.
- Pre-1.0 incompatible schema permits backup then wipe, with no shim:
  `wipes only on the confirmation of what was found, then initialises the current schema`
  and `exports every file raw into a ZIP that opens back to the same bytes`.

Phase 01's debt owned here is closed: an inverse for deleting a workspace
(F-123), export and discard of text set aside as unreadable with a bound on
each list and a notice of what was dropped (F-206, F-305, F-401, F-496, F-973,
F-993, F-1021, F-1022, F-1038), and a cause and remedy in the storage-failure
notice (F-209); `workspace-commands.test.ts`, `unread-text-commands.test.ts`
and `state-storage.test.ts` hold them.

## Commits

Oldest first, on `phase-02-project-storage`, branched from `2d9f195`; the
merge `22cfac7` brought in Phases 03 and 04 from `main` (`67d2b2d`).

- `ef31d5d` Lay out the Phase 02 packages and build the project format core
- `f563730` Settle the storage debt Phase 01 left to Phase 02
- `861b56b` Add the project commands, each with its inverse
- `3fdc022` Add the content-addressed media store
- `2b4cd8f` Add the branching history and the format's history and ZIP forms
- `05e054d` Give each project record one reader and writer, shared by every user
- `f1a6a7e` Add the browser implementations of the storage ports
- `ab517a9` Add the storage core: root, catalogue, journal, snapshots and sessions
- `1b9bcfd` Add the recovery, round-trip and quota suites the Phase 02 packet names
- `e44f88d` Hold a project's write lease with Web Locks and a broadcast channel
- `2537698` Add backups, usage, cleanup, caches, forks and portable projects
- `8d6599a` Close the storage gaps in leases, fencing, purge, compaction and restore
- `1ab7844` Bring the Phase 02 resume note up to date
- `f98d326` Wire projects into the shell: panels, dialogues and the browser storage
- `c0c5fc4` Record what the Phase 02 interface left to do
- `0a699a8` Close the interface gaps and hold the Phase 02 packages to the rules
- `adc8bbe` Say in the Phase 02 resume note that only review and landing remain
- `c68e6d4` Keep a channel layout's labels and ambisonic convention in a project
- `3b66851` Compare large byte arrays as bytes in the storage tests
- `732df4d` Move the editor markers' removal boundary to native-rate import
- `1f581cc` Keep the caches of audio the storage does not store, and refuse foreign ones
- `ddae073` Keep waveform peaks in the storage's caches, not a database of their own
- `bfd29e5` Judge a kept state whole by its bytes, not its size
- `c066e1a` Refuse a history or backup policy the project's reader would refuse
- `f3b4271` Keep the newest backup generation whatever the retention limits
- `5a2701f` Let a backup made by hand go once it is let go, and delete one on request
- `d887bcf` Gather a project's media roots again when its head moves during a purge
- `de59cdd` Give the type check of every public contract time to run
- `8db9708` Tell a linked file edited between its samples from the file linked
- `0709a2b` Link a file chosen for a changed one only when it is the same, or asked
- `ccb8d45` Ask for leave to read a linked file, and never resolve one that wants it
- `9c16f77` Clean the project open in the tab that runs the cleanup, and say what was left
- `a328b14` Claim a folder before exporting into it, and record a part-written export
- `38e903d` Export the open project only once storage holds every change
- `e08164f` Never copy a project out older than storage holds it, unsaid
- `3a68c88` Record every stored schema at the storage root
- `ece2403` Plan the rest of the storage review fixes in the resume note
- `3c41371` Never write a file its reader cannot read back
- `f557e3f` Mark the first half of the checkpoint size fix done in the resume note
- `a4e567c` Plan incremental checkpoints in the resume note
- `c3e43f2` Format the plan steps in the resume note as a list
- `0ef0633` Store only the redo preferences a reader cannot derive
- `62472ff` Write each history node once, in segments of its own
- `3d416a9` Mark incremental checkpoints done in the resume note
- `0db234d` Send a history's changes rather than the history
- `83a82e7` Run the storage tree against the file system
- `0c459fd` Add the storage runtime's typed port
- `a0f02ff` Serve storage from a worker to a typed client
- `9aed721` Let the lease go when an opening is abandoned
- `fd8a707` Open projects in the storage worker
- `2b9c7c2` Take projects out and in through the worker
- `f24df58` Export raw storage and examine files in worker
- `c6f3741` Send an opening's history in slices
- `c4734d3` Make and restore backups in the storage worker
- `59f32dc` Move the application onto the storage worker
- `90358a3` Hold the page to types from the storage packages
- `21134c4` Give the host turns through ZIP work in memory
- `4547282` Stop the storage scans where their signal aborts
- `74d0ee8` Take turns through work over a whole history
- `8529aee` Record the host yield through the packages
- `24fb824` Compare whole projects in the round-trip oracle
- `93a7f44` Sweep crashes through one shared harness
- `6741876` Mark a purge first so a torn one is never restored
- `1abe098` Crash every storage operation that lacked it
- `a5456cb` Plan expired history and backups from the journal
- `a0b4dec` Keep cleanup off what is still being written
- `eed3e7d` Prove media as it is copied out of the store
- `d060de8` Decide a bundle's identity in one read
- `c77bcde` Check every cache a project brings in
- `dd92f7d` Hash each body a bundle brings in once
- `2e9ca23` Gather media roots only from what can be restored
- `c22a531` Stream a whole history one kept state at a time
- `f3e0c04` Say exactly what each provenance level keeps
- `6a5a903` Declare the provenance each command's arguments hold
- `8e0c07b` Find media named inside a change's nested value
- `5b8523b` Export a whole history at every provenance level
- `066e096` Offer every provenance level for a whole history
- `36f4299` Write no checkpoint when nothing changed
- `a9495ee` Make one step of undo cost one step
- `98f0aa8` Compare snapshots in the round-trip and crash tests
- `8d3efc1` Promote through the history's promotion
- `270672b` Keep the protected copy when a file is relinked
- `86590d6` Compare any two states and say what differs
- `1814752` Leave a snapshot's author out below full
- `cc9ea53` Let a retention policy run on its own
- `6df63ff` Hold every project and asset name to one rule
- `185598f` Say when a scheduled backup is not made
- `b73d8c5` Say what each change affected in the history
- `13053b8` Count each part of the history where it belongs
- `69cbf7a` Let each linked asset say what its changes do
- `46a1b15` Ask for a project before taking it over
- `1586780` Record the medium findings fixed in the resume note
- `1e87e79` Plan nothing when every cleanup step is left out
- `9c10071` Refuse a backup missing a state the project keeps
- `fd6f354` Give two project stores only what they use
- `8b755e5` Name backups and write digests in hex one way
- `784813d` Word each reason a backup failed for the backup
- `9901b0f` List a long history for the rows the panel shows
- `65b3675` Show the offer to link a chosen file once
- `2b99c6d` Name each backup's keep button for its backup
- `74494b9` Cut a history point's description, not its time
- `636894c` Bring two project browser tests up to date
- `223b0e0` Name the taker of a lease whose notice came late

The commit that records this package, the review and the handoff follows, and
the integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-02-review.md` records the seven lenses, their fifty-six
findings, and the disposition of each with its commit. The `CRITICAL` finding,
all fourteen `HIGH` findings and all twenty-five `MEDIUM` findings are fixed.
Of the thirteen `LOW` findings and three `NOTE`s, five are fixed, two fixed
in part, and the rest tracked with the phase that owns each. The record also
gives what the browser check found and the commits that fixed it. What the
phase leaves to later phases is listed in the handoff capsule.
