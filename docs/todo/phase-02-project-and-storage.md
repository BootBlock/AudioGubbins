> **Status:** In progress. 2026-09-29: every storage package is built and
> committed on the branch; the interface, the shared-file entries, the browser
> run, the review, the evidence and the landing remain (see Progress).

# Phase 02 — Project and Storage System

Resume note and design record. The packet is
`docs/spec/phases/phase-02-project-and-storage-system.md`; its context pack is
`docs/spec/generated/context/phase-02-context.md`.

## Where the work is

|                  |                                                              |
| ---------------- | ------------------------------------------------------------ |
| Primary checkout | the repository's own directory, on `main`, for reading only |
| Worktree         | `../AudioGubbins-phase-02` — **do the work here**            |
| Branch           | `phase-02-project-storage`                                   |

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
- `projects/<id>/checkpoints/<id>.json`: history graph, cursor, named
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

1. Done: the interface and wiring (`f98d326`). Its report left these to
   fix, each a gap against a requirement:
   - External backup directory not offered in the interface (REQ-STOR-105:
     where the platform permits, the user may choose one).
   - Exporting a bundle records no export record (decide against
     REQ-STOR-197/198 whether a bundle export is an export event; record the
     decision either way).
   - No default Undo and Redo shortcuts, only menu entries (check the
     shortcut defaults in `apps/web/src/state/default-shortcuts.ts`).
   - The Assets panel still says it arrives with the project and storage
     system; reword it to say audio import arrives with the codec phase, and
     update the smoke test's expected text.
   - Main chunk is 1287 kB (365 kB gzipped); consider splitting the storage
     and project surfaces into a lazily loaded chunk.
   - WebKit on Windows refuses Playwright's origin-private storage before any
     application code runs; the spec runs in Chromium and Firefox.
   - `tests/e2e/accessibility.spec.ts` "keeps a long refusal clear… focus at
     the foot, 320 by 256" fails since the Phase 01 debt commit's notice
     wording (`f563730`); fix the wording or the layout, not the test.
2. Shared files, from the interface report:
   - `tests/architecture/browser-suite.test.ts`: add `projects.spec.ts` to
     `SPECS` and `SPECS_OF_EACH_PROJECT`; `playwright.config.ts`: give it a
     project in Chromium and Firefox.
   - `dependency-rules.test.ts` reviewed functions: `app.tsx: AudioGubbins`
     200 → 221, `application.ts: createApplication` 86 → 98.
   - `module-exports.test.ts` `FOR_TESTS`:
     `packages/browser-storage/src/serve-tree.ts: serveTree`.
   - `package-exports.test.ts` `OFFERED`: remove `SchemaName` from version
     and the 48 domain names the app now uses; add reasons for storage
     (`BackupPruning`, `CommandJournal`, `DEFAULT_CADENCE`, `SnapshotStore`,
     `packUnpacked`, `planBackupPruning`, `retainedMedia`, `unpackBundle`),
     project-format (`FormatHeader`, `PROJECT_DOCUMENT_FORMAT`, `asBoolean`,
     `asContentId`, `entitiesOf`, `isStateFingerprint`, `listOf`,
     `numberConverter`, `prettyCanonicalJson`, `readCompatibleHeader`,
     `readExternalIdentity`, `readFormatHeader`, `serialiseProjectDocument`,
     `stripAssetProvenance`, `stripExportRecords`), project-commands
     (`addAssetInvocation`), media-store (`CompletionServices`,
     `ImportChoice`, `ImportRequest`, `ImportServices`, `ImportedMedia`,
     `completeIdentity`, `importMedia` — audio import is a later phase),
     history (`AlternativeBranch`, `ContentRetention`, `alternativeBranches`,
     `contentRetention`, `diffStates`, `promotion`), browser-storage
     (`WritableDirectory`, `filesInDirectory`, `openFileSinkIn`,
     `requestKeptFileAccess`). Prefer wiring a real consumer over a reason
     where a requirement wants the feature (for example the external backup
     directory uses `openFileSinkIn`).
   - `pnpm contracts:update`.
3. `pnpm run verify:commit` green; `pnpm build`; drive the built app in a
   real browser (create, change, reload; two tabs with transfer and take
   over, checking the loss names the taker; bundle export and import; the
   compatibility screen); `tests/e2e/projects.spec.ts`.
4. `pnpm run spec:verify` after any edit under `docs/spec/`, and
   `sha256sum -c CHECKSUMS.sha256` from `docs/spec` (ADR-0020 is new; update
   the checksums as the pack's tools require).
5. One review pass with the packet's lenses (Architecture, Data Integrity /
   Recovery, Security / Privacy, Testing / Regression, Performance / Storage,
   Code Quality / Maintainability, Adversarial Agent-Quality) as parallel
   sub-agents over the committed branch; verify each finding; fix; commit.
6. Evidence `docs/spec/reviews/phase-02-evidence.md` and review record
   `docs/spec/reviews/phase-02-review.md` (see Phase 01's for form), ledger
   entry for phase 2 only, handoff `traceability/handoffs/phase-02.md`, this
   note to `docs/todo/done/`, merge `main` in (Phase 03 may have landed),
   `verify:commit`, merge to `main`, push, remove the worktree.

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
- No schema version bump: nothing has been persisted by a shipped build.
