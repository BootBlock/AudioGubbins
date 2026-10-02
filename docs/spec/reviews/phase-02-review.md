# Phase 02 — Project and Storage System — Review Record

The seven lenses `phases/phase-02-project-and-storage-system.md` requires,
run as independent read-only reviewers over `git diff 67d2b2d..e1f12fd`, the
phase as it stood when its implementation was complete, against the packet,
`contracts/review-gates.md`, the owned requirements and `ADR-0020` and
`ADR-0021`. No reviewer was told to preserve the implementation, and none
edited the tree. The Data Integrity lens ran a second pass over purging, and
the Code Quality lens a sweep of the format packages' exports.

Under the owner's decision of 2026-09-28 the phase has one review pass, whose
verified findings are all fixed or explicitly accepted, and no mutation
harness. Each fix still carries a test that was seen to fail against the code
it replaced. The owner ruled that F-14 and F-15, whose fixes redesign how
history is stored and where storage runs, are fixed in this phase rather than
left to Phase 14's performance hardening.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

Every finding was verified by its reviewer before it was reported, by a probe
test, a measurement or a reading of the code against the rule it breaks, and
again by the remediation, which reproduced it in a test before fixing it.
**Status** records that verification:

- `CONFIRMED` — reproduced, or established by reading the code against the
  requirement.
- `REJECTED` — investigated and shown not to hold. The reasoning is recorded.

The resume note numbered the medium findings M-01 to M-25 and the low ones
L-01 to L-16 while the work was under way. They are F-16 to F-40 and F-41 to
F-56 here, in the same order.

## Lenses run

| Lens | Findings | Blocking findings it raised |
| --- | --- | --- |
| Architecture | 7 | F-02 |
| Data Integrity / Recovery | 19 | F-01, F-03, F-04, F-05, F-11, F-12, F-13 |
| Security / Privacy | 5 | none |
| Testing / Regression | 9 | F-01 |
| Performance / Storage | 9 | F-14, F-15 |
| Code Quality / Maintainability | 3 | none |
| Adversarial Agent-Quality | 16 | F-05, F-06, F-07, F-08, F-09, F-10 |

Findings raised by more than one lens are merged under one identifier, with
the lenses listed together, at the higher of the severities they were given.
Ten were raised by two lenses and one, F-10, by three, so the sixty-eight
reported make a merged list of fifty-six findings: one `CRITICAL`, fourteen
`HIGH`, twenty-five `MEDIUM`, thirteen `LOW` and three `NOTE`s.

## Blocking findings

### F-01 — CRITICAL — A state file torn at its full length was trusted as whole and never written again

- **Lens:** Data Integrity / Recovery, and Testing / Regression at `HIGH`.
  **Status:** `CONFIRMED`, reproduced by both lenses' probe tests.
- The browser's tree sizes a file before it writes it, so a write cut short
  leaves a state file at its full length with zeros after the part written.
  `StateStore.put` skipped any existing file of the right size, so the torn
  state was trusted and named by every later checkpoint; once a compaction
  removed the history before it, the project failed to open with
  `storage.no-usable-head`. The in-memory tree tore a write only short, so no
  crash suite could see it.
- **Disposition:** fixed in `bfd29e5`. Keeping a state reads what the file
  holds and writes it again unless it holds the state's own bytes; a cursor
  state recovery had to rebuild is held among the states not yet written, so
  the next checkpoint writes it. The in-memory tree tears a whole-file write
  at its full length, and the crash suite runs over both kinds of tear,
  closing the project as found after each crash.
  `writes again a state torn at its full length, as a write sized before it lands leaves one`
  in `state-store.test.ts`, and
  `opens every crash, a write torn full-length, to the last acknowledged step or the one cut short, and goes on`
  and `writes whole again a cursor state it rebuilt, though the cursor moves on`
  in `project-session.recovery.test.ts`, hold it; the file system's own tree
  tears the same way (`can leave a write that fails after sizing its file torn at its full length`).
  **Accepted:** a snapshot's state that is present but damaged is found when
  it is used, not reported when the project opens.

### F-02 — HIGH — The session accepted policies the format's reader refuses

- **Lens:** Architecture. **Status:** `CONFIRMED`, reproduced.
- `ProjectSession.setBackupPolicy` and `setRetentionPolicy` journalled any
  policy, while the reader refuses, among others, an automatic backup nothing
  triggers and a rule that keeps no changes. Only the application's commands
  checked, so after a crash the records after such a policy were lost at
  replay, and after a clean close the checkpoint holding it could not be read.
- **Disposition:** fixed in `c066e1a`. Each policy has one checked
  constructor in `project-format`, which applies the reader's own rules, and
  the project model applies a policy only through it, so the session refuses
  the policy and keeps the one it had.
  `refuses a backup policy nothing triggers, which a reload would refuse, and keeps the policy it had`
  and `refuses a retention policy of a rule keeping no changes, which a reload would refuse`
  in `project-session.test.ts` hold it.

### F-03 — HIGH — A byte budget could prune every automatic backup, the new one among them

- **Lens:** Data Integrity / Recovery. **Status:** `CONFIRMED`, established
  by reading the planner, whose own test held the defect.
- Pruning kept the unprotected generations within every limit, so a budget
  smaller than one generation, or an age a project stayed idle past, removed
  every automatic generation right after the scheduler made one.
- **Disposition:** fixed in `f3b4271`. The newest generation is kept whatever
  the limits and still counts towards them.
  `keeps the newest generation where it alone is past every limit` in
  `backup-planning.test.ts` holds it, and the seeded pruning test, whose
  expectation allowed the defect, now requires the newest kept.

### F-04 — HIGH — A media purge raced another tab's checkpoint

- **Lens:** Data Integrity / Recovery. **Status:** `CONFIRMED`, established
  by reading the scan against the checkpoint's order of writes.
- A purge listed a project's states, then its checkpoints, then its journal.
  Another window's checkpoint landing between them folded journal records
  into files listed too early, then pruned the records before the scan read
  them, so media only those records named was counted as retained by nothing.
  A file listed and gone meanwhile also counted as retaining nothing.
- **Disposition:** fixed in `d887bcf` and `2e9ca23`. A project's files are
  gathered again whenever its newest head moved during a pass, and only a pass
  the head stayed still through counts; a file listed and gone is reported,
  and so is a project whose head keeps moving, so the purge refuses rather
  than guesses. The roots are what can be restored: each checkpoint a valid
  head names, with its segments and states, every journal record, and each
  whole backup generation. `keeps media another window checkpoints while the roots are gathered`
  and `reports a project whose checkpoints never stop while the roots are gathered`
  in `media-roots.test.ts` hold it.

### F-05 — HIGH — An edit outside a linked file's sampled ranges was taken as unchanged

- **Lens:** Adversarial Agent-Quality, and Data Integrity / Recovery.
  **Status:** `CONFIRMED`, reproduced by a probe test.
- A linked file was recorded by its length, sampled ranges and time, and a
  file of the same length and samples was unchanged whatever its time;
  `completeIdentity` had no caller in production. A gain change in the middle
  of a take kept every signal, so the project went on using, and
  consolidation copied in, bytes it had never linked.
- **Disposition:** fixed in `8db9708`. Linking takes the file's full content
  identity, progressively and yielding to the host. Samples count as a match
  only where the file keeps its time; otherwise the full identity decides, so
  a file only touched is still proved unchanged. Checking and consolidating
  examine the file the same way.
  `tells an edit between the sampled ranges from the file linked, once it was saved since`
  in `source-observation.test.ts`,
  `takes sampled signals alone for no proof once the file was modified since`
  in `source-classification.test.ts` and
  `passes over a file edited between the ranges its link sampled, and saved since`
  in `consolidation.test.ts` hold it.

### F-06 — HIGH — Relinking accepted any file

- **Lens:** Adversarial Agent-Quality, and Data Integrity / Recovery at
  `MEDIUM`. **Status:** `CONFIRMED`, established by reading the store.
- The file chosen for a linked file that changed or went missing was linked
  without being looked at, so a wrong take or another project's file stood in
  silently; the prompt's sentence for an identical relink was unreachable.
- **Disposition:** fixed in `0709a2b`. The chosen file is examined against the
  recorded identity; one of the same content is linked at once, and any other
  is offered with how it differs, linked only when the person asks.
  `asks before linking a chosen file that is not the one the project used` in
  `source-change-store.test.ts` and
  `says how a file chosen to link differs, and links it only when asked to anyway`
  in `source-change-prompt.test.tsx` hold it.

### F-07 — HIGH — Nothing could give leave to read a linked file, and Freeze froze one that only wanted it

- **Lens:** Adversarial Agent-Quality, and Data Integrity / Recovery at
  `MEDIUM`. **Status:** `CONFIRMED`, established by reading the code:
  `requestKeptFileAccess` had no caller.
- A kept handle the browser needs the person's leave to read was reported
  missing, so a Freeze policy froze it at once; consolidation never asked
  either.
- **Disposition:** fixed in `ccb8d45`. The media store tells an absence that
  wants leave from one refused, and no policy applies to either. The prompt
  offers Give access, whose command asks from the person's gesture and looks
  at the file again; consolidation asks for leave for each file before
  copying, and says why each file it could not copy was passed over.
  `that needs leave to be read is put to the person, and not frozen by its policy`
  in `source-change-store.test.ts`,
  `applies nothing to a file it could not look at for want of leave, whatever the policy`
  in `source-resolution.test.ts` and
  `asks leave to read each linked file the browser needs it for, and says what it could not copy`
  in `project-transfer-commands.test.ts` hold it.

### F-08 — HIGH — Cleanup never cleaned the project open in its own tab

- **Lens:** Adversarial Agent-Quality. **Status:** `CONFIRMED`, reproduced by
  a probe test.
- A cleanup asked for each project's lease without stealing it, so the project
  open in the tab running it was always found held by that tab and passed over
  as open in another; refused and unapplied outcomes were never shown.
- **Disposition:** fixed in `9c16f77`. A cleanup runs the open project's steps
  under the lease its session holds, and compacts through that session; one
  set of sentences, shared by the command and the Storage panel, says what was
  freed, then each project left and each refusal with its reason.
  `compacts the history of the project open in this tab, rather than calling it busy`
  in `storage-commands.test.ts`,
  `removes the expired backups of the project this window writes, under its own lease`
  in `storage-cleanup.quota.test.ts` and
  `says each project left and each refusal, with its reason, after what it freed`
  in `cleanup-words.test.ts` hold it.

### F-09 — HIGH — A backup made by hand could never be removed

- **Lens:** Adversarial Agent-Quality. **Status:** `CONFIRMED`, established
  by reading the planner and the cleanup.
- Pruning and cleanup passed over every generation made by hand, whatever its
  protection, and letting it go only cleared the flag.
- **Disposition:** fixed in `5a2701f`. Protection alone decides what pruning
  and cleanup keep, and a backup can be deleted from its row after a
  confirmation that it cannot be brought back.
  `prunes a generation made by hand once the person lets it go` in
  `backup-planning.test.ts`,
  `deletes a backup the person chose, though it is kept` in
  `project-transfer-commands.test.ts` and
  `deletes a backup only from its confirmation, and says a let-go one is kept no longer`
  in `project-settings.test.tsx` hold it.

### F-10 — HIGH — Exporting into a folder overwrote another project's tree unread

- **Lens:** Adversarial Agent-Quality, Security / Privacy at `MEDIUM` with a
  probe test, and Data Integrity / Recovery at `MEDIUM`. **Status:**
  `CONFIRMED`, reproduced.
- An export or an unpacking into a folder wrote its tree over whatever tree the
  folder held and removed that tree's other files, without reading whose it
  was; a write that failed after changing the folder was recorded as failed,
  though `REQ-STOR-198` has a status for an export written in part.
- **Disposition:** fixed in `a328b14`. A folder is claimed before anything is
  written: an empty one or the same project's at once, another project's or
  an unreadable tree only on the person's confirmation. An export that failed
  after changing the folder is recorded as partial.
  `refuses a folder holding another project, and changes nothing in it unasked`
  and `replaces the other project only where the person confirmed it, keeping files beside it`
  in `project-transfer.test.ts`, and
  `records a folder written in part as a partial export, with what went wrong`
  in `project-transfer-commands.test.ts` hold it.

### F-11 — HIGH — Exporting the open project silently left out unsaved changes

- **Lens:** Data Integrity / Recovery. **Status:** `CONFIRMED`, established by
  reading the export against the write queue.
- An export read the project from storage, so a change still queued, or
  refused by a full storage, was left out while the export reported success.
- **Disposition:** fixed in `38e903d`. An export of the open project waits for
  its session to have written every change, and refuses while any is not
  saved. `refuses while a change is not saved, rather than leave it out, and carries it once saved`
  in `project-transfer.test.ts` holds it.

### F-12 — HIGH — Every copy out dropped the recovery report

- **Lens:** Data Integrity / Recovery. **Status:** `CONFIRMED`, established by
  reading `project-copy.ts`.
- An export, a backup or a fork is rebuilt from its head, checkpoint and
  journal, and what recovery left out was dropped, so a journal break, such as
  a live writer pruning records the read had yet to reach, gave an older copy
  with nothing said.
- **Disposition:** fixed in `e08164f`. A read that left records out while the
  head moved reads again from the newer head; one where the head stayed is
  refused as damaged, and the person is told to open the project.
  `is refused, rather than copied older, where its journal is damaged, until it is opened`
  and `reads again from the newer head where a writer pruned what the read had yet to reach`
  in `project-session.recovery.test.ts` hold it.

### F-13 — HIGH — The storage root checked only its own schema

- **Lens:** Data Integrity / Recovery, and Adversarial Agent-Quality at
  `MEDIUM`. **Status:** `CONFIRMED`, established by reading the root.
- The kept states hold project documents of the `projectDocument` schema,
  which the root did not record, so a build that raised that schema alone
  would fail every project one by one with no compatibility screen.
- **Disposition:** fixed in `3a68c88`. The root records the `projectDocument`
  version and the product version that wrote it, and storage of another
  version of either schema meets the compatibility screen. `projectStorage`
  went from 1 to 2.
  `reports storage whose project documents are of another schema, though its own records are current`
  in `storage-root.test.ts` holds it. A bundle carries its own schema in its
  manifest and is refused on import where it differs.

### F-14 — HIGH — Each checkpoint rewrote the whole history, and one past the reader's limit made the project unopenable

- **Lens:** Performance / Storage. **Status:** `CONFIRMED`, measured: about
  440 bytes a change rewritten every 256 changes, quadratic in total.
- Past the record reader's 2^28 characters a checkpoint was still written,
  the head moved to it and older checkpoints removed, so the project never
  opened again; the format allows ten million nodes.
- **Disposition:** fixed in `3c41371`, `0ef0633`, `62472ff` and `74d0ee8`.
  No storage or export file is written that its reader would refuse: canonical
  text is written within the reader's limits, and a checkpoint storage cannot
  hold is passed over, the journal keeping every change. History nodes are
  written once, in immutable segments a checkpoint names, so a checkpoint
  writes what changed since the last; redo preferences a reader derives are
  not stored; segment planning takes a host turn per node. `projectStorage`
  went from 2 to 3. `refuse one code unit past the length a reader accepts, as that reader does`
  in `canonical-json.test.ts`,
  `is passed over: the project stays saved, and nothing it would replace is removed`
  in `session-writer.test.ts`,
  `stores no preference for a line of changes, and redoes along it once read back`
  in `history-conversion.test.ts`, and
  `writes only the nodes added since the last checkpoint once the newest segment is full`
  and `keeps at most two segments for each segment length of history, however often it checkpoints`
  in `segment-ledger.test.ts` hold it. The evidence states the bound.
  **Accepted:** the paths past 2^28 characters have no direct test, a history
  that large being too costly to build; the writers' refusal is tested at
  small limits.

### F-15 — HIGH — Heavy storage work ran on the page's thread

- **Lens:** Performance / Storage. **Status:** `CONFIRMED`, measured: at
  16,000 changes, 331 ms to write and 483 ms to read one checkpoint on the
  page.
- Only file reads and writes crossed to the worker; parsing, canonical text,
  fingerprints, usage and roots scans, backups and ZIP checksums ran on the
  page, and the host yield was built and never passed.
- **Disposition:** fixed in `0db234d`, `83a82e7`, `0c459fd`, `a0f02ff`,
  `9aed721`, `fd8a707`, `2b9c7c2`, `f24df58`, `c6f3741`, `c4734d3`, `59f32dc`,
  `90358a3`, `21134c4`, `4547282` and `74d0ee8`, as `ADR-0022` records. The
  storage core runs in one worker over the origin-private file system
  directly, and the page holds a client and a copy of each open project kept
  by a history delta; every long path takes the signal and the host's turns.
  `sends one change as its node and the path it changed, and keeps the rest of the copy`
  in `history-delta.test.ts`,
  `sends a long history over several messages, and opens with all of it`
  in `remote-opening.test.ts`,
  `asks the host for a turn as it reads the records of a large directory` in
  `zip-reading.test.ts`, and
  `takes types from the packages that keep projects, and only the values listed with their reason`
  in `dependency-rules.test.ts`, which refused 29 values run over the page as
  it was, hold it. **Accepted:** the `history` package's whole-graph passes run
  synchronously in the worker, off the page, at the times the evidence
  records; the browser measurement is recorded in the evidence.

## Non-blocking findings

| Id | Severity | Lens | Finding |
| --- | --- | --- | --- |
| F-16 | MEDIUM | Architecture | The project-name rule lived in several places with different codes, and a name of invisible code points alone was accepted. |
| F-17 | MEDIUM | Architecture, Code Quality | The page matched storage failure codes as text, and an import read and validated a bundle twice to bring it in as a copy. |
| F-18 | MEDIUM | Security | The export's provenance labels said other than what each level kept, and a whole history was always exported with full provenance, its choice hidden. |
| F-19 | MEDIUM | Testing, Security at `LOW` | A bundle import replaced media caches other projects share, an unpacked tree's caches came in unchecked, and nothing tested a copy's re-keying or which media caches are accepted. |
| F-20 | MEDIUM | Data Integrity | Cleanup acted on what had changed since it planned, and on what was still being written: a backup generation, a project being made, records set aside since. |
| F-21 | MEDIUM | Data Integrity | Expired history and backups were planned from the newest checkpoint's policy, not the one the journal held. |
| F-22 | MEDIUM | Testing | A purge cut short by a crash left a deleted project that Restore made unopenable. |
| F-23 | MEDIUM | Testing | A comparison chosen by a snapshot was never checked across a reload. |
| F-24 | MEDIUM | Testing | Crash injection was missing for purge, opening, fork, restore in place, compaction and consolidation, and single-point for cleanup, wipe and cache replacement. |
| F-25 | MEDIUM | Testing, Data Integrity | The round-trip oracle left out a node's time and affected entities, a snapshot's notes, kind, author and time, and most export fields. |
| F-26 | MEDIUM | Adversarial | A retention policy never ran on its own, and the recovery kind of snapshot was never made. |
| F-27 | MEDIUM | Adversarial | The backup byte budget could not be set and was dropped on save, a failed scheduled backup was only logged, and partial generations piled up. |
| F-28 | MEDIUM | Adversarial | A/B compared only the current state with a chosen point, showed counts only, and was not worked out again after a reload. |
| F-29 | MEDIUM | Adversarial, Performance | The History panel showed no affected entities and no notes, and drew every row, unmemoised, scrolling at every render. |
| F-30 | MEDIUM | Adversarial | Usage put branch history under save points, and the cleanup plan said one fixed sentence rather than what each step takes. |
| F-31 | MEDIUM | Adversarial | A linked asset's source policy could not be set, and the setting for bringing files in was read by nothing. |
| F-32 | MEDIUM | Adversarial | Take over was offered against a live owner before any request had gone unanswered. |
| F-33 | MEDIUM | Data Integrity | Adopting or relinking dropped the asset's protected copy, so Freeze became unavailable. |
| F-34 | MEDIUM | Data Integrity | An export never proved managed media's bytes, so media damaged in place gave a bundle that could not be brought back. |
| F-35 | MEDIUM | Performance | Hiding the page wrote a full checkpoint even when nothing had changed. |
| F-36 | MEDIUM | Performance | Whole-history export, backup and import held every kept state and every text file in memory. |
| F-37 | MEDIUM | Performance | A bundle import hashed each piece of media three times, and copied a duplicate whole. |
| F-38 | MEDIUM | Performance | No signal reached a long storage operation from the page, and several package paths dropped one. |
| F-39 | MEDIUM | Performance | One step of undo walked the path to the root three times: 31.8 ms at 16,000 changes deep. |
| F-40 | MEDIUM | Code Quality | Half-wired exports: a second promotion beside the history's own, a protected copy never passed, an unused row query, and exports used only by tests. |
| F-41 | LOW | Testing | A commit on the branch did not build alone: it deleted the peak cache store the next commit stopped importing. |
| F-42 | LOW | Testing | The wiring that keeps the stored peak cache to a ready storage root was untested at the project system. |
| F-43 | LOW | Testing | The packet's `test:recovery` and `test:storage-quota` filters miss tests of their subject kept in other files. |
| F-44 | LOW | Security | The resume note recorded working directories and task files, which a public repository should not hold. |
| F-45 | LOW | Architecture | Two classifiers of browser storage errors disagree on Firefox's quota error. |
| F-46 | LOW | Architecture | The session changes its writer's collections of kept and unwritten states directly. |
| F-47 | LOW | Architecture | The project services were handed whole to six stores. |
| F-48 | LOW | Adversarial | A cleanup with every step left out plans everything again. |
| F-49 | LOW | Data Integrity | A damaged storage root beside valid projects offers only the raw export and the wipe. |
| F-50 | LOW | Data Integrity | A backup generation passes over a kept state that fails to load, saying nothing. |
| F-51 | LOW | Data Integrity | A bundle import stores caches among its media, and one cache it cannot store fails the import. |
| F-52 | LOW | Performance | Usage stats files several times, a purge gathers its roots into one array under the exclusive lock, backups decode every state again, and the backup check walks every node each minute. |
| F-53 | NOTE | Security | Records are read whole before their size limit applies, and the kept-handle token rule accepts the backups folder's reserved key. |
| F-54 | NOTE | Data Integrity, Adversarial | The media store's own recovery of incomplete objects has no caller and is not safe across tabs; the roots skip malformed project directories; the ZIP interoperability tests skip without Python; the download fallback holds a bundle as blob parts. |
| F-55 | LOW | Code Quality | Duplications: the date formatter, backup naming, the recovery parts, `counted`, the absent-store stand-in, the working flag, the hex digest, CRC-32, directory walks, project listing, chunked reads, Web Locks request skeletons, and a voided promise left unhandled. |
| F-56 | NOTE | Architecture | The notable-recovery check and the recovery sentences list the same fields apart, new-project defaults live in two places, and the comparison-close rule lives in storage. |

### Rejected

No finding was rejected.

## What the reviewers found sound

- The package directions and the nine public contracts; the interface acts
  through commands.
- The ZIP and bundle readers' handling of hostile input; lease fencing and the
  Web Locks messages; the persistence protocol's order of writes; the
  journal's setting aside of a torn tail; the write queue under a full quota;
  the pre-1.0 wipe flow.
- The channel layout's format, the stored peak cache and the cache store's
  tests; hashing streamed in 1 MiB chunks; no unbounded `Promise.all`; handles
  to the origin-private file system closed; no personal data committed.

## Disposition

Every verified finding is fixed, accepted or tracked. Each fix carries a
test that failed against the code it replaced, unless the entry says why none
can. Commits are on `phase-02-project-storage`.

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `bfd29e5`, as above, with a damaged snapshot state found on use accepted. |
| F-02 | **Fixed** in `c066e1a`, as above. |
| F-03 | **Fixed** in `f3b4271`, as above. |
| F-04 | **Fixed** in `d887bcf` and `2e9ca23`, as above. |
| F-05 | **Fixed** in `8db9708`, as above. |
| F-06 | **Fixed** in `0709a2b`, as above. |
| F-07 | **Fixed** in `ccb8d45`, as above. |
| F-08 | **Fixed** in `9c16f77`, as above. |
| F-09 | **Fixed** in `5a2701f`, as above. |
| F-10 | **Fixed** in `a328b14`, as above. |
| F-11 | **Fixed** in `38e903d`, as above. |
| F-12 | **Fixed** in `e08164f`, as above. |
| F-13 | **Fixed** in `3a68c88`, as above. |
| F-14 | **Fixed** in `3c41371`, `0ef0633`, `62472ff` and `74d0ee8`, as above, with the untested paths past 2^28 characters accepted. |
| F-15 | **Fixed** in the commits listed above, as `ADR-0022` records, with the synchronous whole-graph passes in the worker accepted. |
| F-16 | **Fixed** in `6df63ff`. One rule in `project-format`, built on the text package's, held by the commands, making and forking, every reader an import passes through, and the page, with one code for a blank name and one for a long one. `refuses a blank name, one of code points nobody sees among them` in `project-name-commands.test.ts`. |
| F-17 | **Fixed** in `d060de8`. The storage takes itself or a copy as one choice and reads the bundle once, and says whether a refusal was for want of room by a predicate the page takes as a listed value. `comes in as a copy where the storage holds it, reading the bundle once` in `tree-import.test.ts` and `says a save refused for want of room is full, and no other refusal` in `project-session.quota.test.ts`. |
| F-18 | **Fixed** in `f3e0c04`, `6a5a903`, `5b8523b`, `066e096` and `1814752`, with `8e0c07b`. The levels are named by what they leave out and say what each keeps; the owner chose to export a whole history at every level with its undo kept, each file's name, handle and path replaced by one stand-in throughout and a snapshot's author left out below full. `shows what each level keeps of where the audio came from for the state alone` in `projects-dialog.test.tsx`, `stands one placeholder for each file, in the state and in every change` and `refuses a stripped tree where a snapshot keeps the name of the person who made it` in `history-stripping.test.ts`, and `keeps a whole history at less of where its audio came from, its undo working` in `project-transfer-commands.test.ts`. |
| F-19 | **Fixed** in `1f581cc` and `c77bcde`. A cache's seal holds the identity of its bytes, a tree lists its caches with their identities, a cache brought in is refused where its bytes are not the ones listed, and a cache of media is kept only where the storage keeps none. `projectStorage` went from 4 to 5 and `portableBundle` from 1 to 2. `never replaces a cache of media the storage holds already`, `keeps a cache of the project under the identity of the copy, beside the original one`, `refuses a cache of media the project does not carry, and keeps nothing` and `refuses a cache of an unpacked tree whose bytes are not the ones the tree lists` in `tree-import.test.ts`. |
| F-20 | **Fixed** in `a0b4dec`. Every writer of a project or a backup generation shares the storage-wide lock until it is whole; what removes left-overs takes it alone and looks again; the plan records what it saw, and running removes only that. `passes over a project being made, which is whole once made`, `passes over a backup generation being written, which is whole once written` and `removes the records set aside it planned, and keeps those set aside since` in `cleanup-running.test.ts`. |
| F-21 | **Fixed** in `a5456cb`. Each project is read as recovery reads it, journal included, and planned under the policy it holds now. `plans under the policy the project holds now, its journal included` in `expired-history.test.ts` and `plans expired backups under the policy the project holds now, its journal included` in `storage-cleanup.quota.test.ts`. |
| F-22 | **Fixed** in `6741876`. A purge marks the header first; restoring a marked project is refused, and purging again, cleanup or an import of the same identity finishes it. `projectStorage` went from 3 to 4. `leaves it gone, whole and restorable, or refused restoring and purged again` in `project-catalogue.recovery.test.ts` and `offers no restoring, only finishing the purge the person confirmed` in `deleted-projects.test.tsx`. |
| F-23 | **Fixed** in `98f0aa8`. The random sessions compare a snapshot with another snapshot or a node and delete the snapshot a side was chosen by, and the crash script compares, checkpoints, switches and deletes at every tree operation, in `project-session.roundtrip.test.ts` and `project-session.recovery.test.ts`. They found no defect; with a comparison left open on a deleted snapshot, the crash sweep fails. |
| F-24 | **Fixed** in `93a7f44` and `1abe098`. One shared sweep crashes an operation at every tree operation it makes, in each torn-write form asked for, and every storage operation runs through it. `opens, after every crash, to the history before or after it, and goes on` in `project-opening.recovery.test.ts`, `leaves the source as it was and the fork whole or not listed, at every operation` in `project-copies.recovery.test.ts`, `loses nothing kept, and the cleanup run again finishes it, at every operation` in `storage-cleanup.recovery.test.ts` and `leaves the old schema to wipe again, or only the new root, wherever a wipe is cut short` in `storage-root.test.ts`. |
| F-25 | **Fixed** in `24fb824`. The summary is built from the format's canonical writer of each part over every member of the model, so a member the format keeps is compared once written. `tells a project apart from one with %s changed` in `model-summary.test.ts` changes each part in turn. |
| F-26 | **Fixed** in `cc9ea53`. After each checkpoint the session applies what the policy lets go, keeping the cursor, its redo line, every snapshot with its history and a comparison's sides; a restore in place keeps a recovery snapshot first. `goes on letting go what it lets go at each checkpoint, which a reload keeps` and `never lets a snapshot go, nor the history it stands on` in `history-compaction.test.ts`. |
| F-27 | **Fixed** in `185598f`. The settings take the size in megabytes and keep it; a scheduled backup not made is said in the status bar until one is made, and aloud once; a failed attempt's leavings are removed as it fails. `says a scheduled backup was not made, aloud once, until one is` in `backup-status.test.tsx`, `shows the size a policy keeps backups within, in megabytes` in `project-settings.test.tsx` and `leaves nothing of a generation storage could not hold, however often it is tried` in `backup-generations.test.ts`. |
| F-28 | **Fixed** in `86590d6`. Any point or snapshot can be side A and another compared with it; what differs is said entity by entity, and worked out again after a reload. `compares a point or a snapshot chosen first with another, side A first` and `works out again what differs between the sides kept, once the project opens again` in `history-commands.test.ts`, and `says each entity by name, which side alone holds it, and what of it differs` in `difference-words.test.ts`. **Accepted with tracking:** auditioning A and B needs the project's audio in the audio engine, which arrives with import (Phase 09). |
| F-29 | **Fixed** in `b73d8c5`. Each row says what its change affected and a snapshot's notes, the chosen point lists them with a filter to one entity, snapshots take notes, and the list draws only the rows in sight through the design system's row window, memoised, scrolling only when the choice moves. `brings the chosen point into view once each time the choice moves, and not as it draws again` in `history-list.test.tsx` and `keeps a snapshot with the notes typed` in `history-panel.test.tsx`. **Accepted:** rows are of one height, two lines cut short where long; the chosen point says all of it. |
| F-30 | **Fixed** in `13053b8`. Segments are split between the line and the other branches, retained audio by what keeps it, and each cleanup step lists what it takes. `tells apart the media a snapshot, the line and another branch alone keep, and the history of other branches` in `usage-measurement.test.ts` and `says what each step of a cleanup takes, item by item` in `storage-panel.test.tsx`. **Accepted:** a segment's bytes are split by the text of the nodes it holds of each, leaving its header with the line's share. |
| F-31 | **Fixed** in `69cbf7a`. The question about changed linked files sets each asset's policy by an undoable command, and the import pipeline takes a link's policy and the copy or link choice from the media store's one definition, which the setting holds. `is set for one asset by command, as a change undo reverses` in `source-commands.test.ts`, `chooses what the asset does the next time its file changes, offering only what it can do` in `source-change-prompt.test.tsx` and `records the policy the person chose for what happens when the file changes` in `media-import.test.ts`. **Accepted with tracking:** nothing in this phase's interface runs the import pipeline, so the setting is read by the pipeline alone until Phase 09 imports audio from the interface. |
| F-32 | **Fixed** in `46a1b15`. A tab asks first, and taking over is offered only once a request went unanswered by a tab gone, stopped or too slow to answer. `is not offered to take over while the window changing it may yet answer, or after it kept it` in `ownership-commands.test.ts` and `offers to take the project over once a request went unanswered, and only once the cost is read` in `project-banner.test.tsx`. **Accepted:** a request counts as unanswered after 30 seconds, or at once where the window holding the project hears no request. |
| F-33 | **Fixed** in `270672b`. The commands refuse to relink or adopt without a copy of the new file where the asset keeps one, and the worker stores that copy and holds it from purges until the change is saved. `keeps a protected copy of the version it takes or the file it is linked to, so it can still be frozen` in `source-change-store.test.ts` and `refuses a file with no protected copy for an asset that keeps one, which freezing needs` in `source-commands.test.ts`. |
| F-34 | **Fixed** in `eed3e7d`. Every copy out proves each object as it streams it and refuses the copy naming the object. `refuses the bundle, naming the object, and abandons what was written`, `refuses the unpacked tree, naming the object, and keeps no file of it` and `refuses the copy in the backup directory, naming the object` in `project-export.media.test.ts`. |
| F-35 | **Fixed** in `36f4299`. A checkpoint writes nothing where the last one confirmed is of the same record. `writes nothing, as when a page is hidden twice, and writes again after a change` in `session-writer.test.ts`. |
| F-36 | **Fixed** in `c22a531`. Kept states are read only when asked for and each text file made only as its writer reaches it, so at most two states are held at once. `as it is written to a folder` and `as it is written as a bundle` in `tree-streaming.test.ts`. |
| F-37 | **Fixed** in `dd92f7d`. Media is hashed once as it is taken in, and a duplicate is proved where it lies without reading the bundle's bytes. `reads, hashes and writes them once where the store lacks them` in `named-store.test.ts` and `reads and hashes each piece once, and none the storage holds already` in `tree-import.test.ts`. |
| F-38 | **Fixed** in `59f32dc` (the page) and `21134c4`, `4547282` and `74d0ee8` (the packages). `gives up the work it started in the storage worker` in `project-stores.test.ts`, `stops gathering the media the journal retains at the read its signal aborts in` and `removes no further project once its signal aborts` in `storage-scans.test.ts`. |
| F-39 | **Fixed** in `a9495ee`. The common ancestor is found by climbing from both nodes, so a path costs its own length. `reads as many nodes ten thousand changes deep as ten changes deep` in `navigation.test.ts` and `looks for a kept state no further up than the move is long, however deep the history` in `history-moves.test.ts`. |
| F-40 | **Fixed** in `8d3efc1`, `270672b`, `b73d8c5` and `13053b8`. The session promotes through the history's promotion, which refuses another history's comparison; the protected copy is passed (F-33); the row query's affected entities are used (F-29); the retained-content split is used by usage (F-30); the branches beside the line, the document's pretty form and the bare header reader are removed. The invocation that adds an asset stays offered, being a command the phase ships. `package-exports.test.ts` and `module-exports.test.ts` hold the lists; a removal has no test of its own. |
| F-41 | **Fixed** before the branch lands: the two commits were made one, so `ddae073` builds alone and its tree is the reviewed tree. No test can fail on the history of a branch. |
| F-42 | **Tracked.** The peak cache's own tests drive its readiness, and the project system's predicate is untested. Owner: Phase 09, which first opens the project's own assets in the editor and caches their peaks. |
| F-43 | **Tracked.** The filters select by file name, so a test of recovery or of quota kept in another file runs only in the whole suite, which runs every one. Owner: Phase 14, whose recovery and storage-pressure stress extend these suites. |
| F-44 | **Fixed** in the commit that records this review. The resume note keeps its design and decisions without the working directories, the coordination terms and the task files, and moves to `docs/todo/done/`. No test can fail on a sentence. |
| F-45 | **Tracked.** `apps/web/src/state/storage-failure.ts` knows Firefox's quota name and `packages/browser-storage/src/platform-failures.ts` does not. Owner: Phase 12, whose storage persistence and quota status take one classifier. |
| F-46 | **Tracked.** The session still adds unwritten states to its writer's map in two places. Owner: Phase 05, the next to change the project session. |
| F-47 | **Fixed** in `fd6f354`. Since `ADR-0022` the services are the client, the kept handles, the digest and a logger; the open project's store now takes the projects and ownership clients and a logger, and the backups store the backups client and a logger, as every other project store takes its part. `opens and closes a project through the projects and ownership clients alone` in `open-project-store.test.ts` and `makes and lists a backup through the backups client alone` in `backup-store.test.ts`. |
| F-48 | **Fixed** in `1e87e79`. The command tells an absent list of choices, every step, from an empty one, no step, and the plan says that planning again with every step left out cleans up nothing. `plans nothing where every step was left out, rather than every step again` in `storage-commands.test.ts` and `says that leaving every step out plans nothing, and plans again with none chosen` in `storage-panel.test.tsx`. |
| F-49 | **Tracked.** A root that cannot be read blocks every project with the raw export and the wipe. Owner: Phase 12, whose update flow and stale-data recovery decide what may be trusted beside a damaged root. |
| F-50 | **Fixed** in `9c10071`. Each state the history keeps must be read whole, or the generation fails as a refused write does, naming the state and the snapshot keeping it, and the scheduler removes what the attempt left. `makes no generation while a state the project keeps is %s, and says which` in `backup-generations.test.ts`, for a damaged state and a missing one. The status bar gives that reason (`784813d`). |
| F-51 | **Fixed in part, tracked for the rest.** Since `c77bcde` a cache whose bytes are not the ones listed is refused by design; a cache the storage cannot hold still fails the import, leaving no project. Owner: Phase 09, whose import analysis decides what a disposable part may cost an import. |
| F-52 | **Tracked.** Each is unchanged; the backup check still walks every node at each tick. Owner: Phase 14's performance baselines and large-project tests. |
| F-53 | **Tracked.** Owners: Phase 14's memory and storage pressure for reading within the limit, and Phase 09, which brings linked files in from the interface, for the reserved key. |
| F-54 | **Tracked.** Each is unchanged. Owners: Phase 14's recovery stress for the media store's own recovery and the malformed directories, its browser and system matrix for the Python-less run, and Phase 12's fallbacks for the download. |
| F-55 | **Fixed in part, tracked for the rest.** The voided promise is gone with the backup store's move to the storage client (`59f32dc`). A backup is named by one rule, the backups folder's, whether exported or copied, and the cache store, the stored peak cache and the random tokens write hex through the format's `hexOf` and `DIGEST_HEX` (`8b755e5`). The domain's identifier generator still writes hex itself, since the domain depends on no package. The date formatter, `counted`, the copy of the project listing in the media roots and CRC-32 in the waveform codec stand. Owner: Phase 05, the next to change these modules. |
| F-56 | **Tracked.** Owner: Phase 05, the next to change the project stores and the session. |

### Accepted as known limits

- Importing audio from the interface needs a file's audio shape, which a codec
  reads: Phase 09's. Phase 02 ships the pipeline, the copy or link choice and
  the commands, tested through a probe port.
- Auditioning A and B needs the project's audio in the audio engine; Phase 02
  ships the comparison, switching, the difference and promotion.
- Markers and regions move into the project with native-rate import
  (`ADR-0021`).
- A purge, a wipe and a soft delete are not given up part-way, by design.
- The bounded limits the evidence lists: a header reverted by a late writer's
  cached name, two openers racing to one epoch when one steals mid-open, and a
  closed tab not announced to watchers.

### Found during remediation

- An opening to write abandoned after it took the lease threw past the
  release and left the project held until the window closed. The release now
  runs however the opening ends (`9aed721`), held by
  `lets the lease go when an opening to write is abandoned once it holds it`.
- An opening at 16,000 changes held the page for about 160 ms in one task.
  The history now comes in slices of at most 1,000 entries of each map
  (`c6f3741`).
- Applying a history delta that changes nothing gave a new history, which the
  page read as a change; it now gives back the earlier one (`59f32dc`).
- The cleanup crash sweep found that a project whose making a crash cut short
  held every purge of media back, its torn file counted among the roots. What
  a crash left of a making or a purge now retains nothing (`1abe098`), and
  the roots became what can be restored, which removed the bound a torn
  segment had set (`2e9ca23`).
- The public contracts' type check outgrew its default five seconds under the
  whole suite and is given a minute; what it checks is unchanged (`de59cdd`).
  Tests that build a history of over a thousand changes are given longer for
  the same reason (`c4734d3`).

### Found in the browser check

The built application was driven in Chromium against every changed surface
before the phase landed. What it found is fixed:

- Opening the History panel at 16,000 points made a row for every point,
  ordered the whole tree and searched the rows for the chosen one, though the
  list draws only the rows in sight: one long task of 80 ms. The order of the
  rows is now carried from one history to the next, and a row is made only
  when the list reads it (`9901b0f`), held by
  `opens on a long history reading only the points it shows` and
  `carries the order of a long history through a change, an undo and a redo for what they touch`.
- At the panel's default width a long description pushed a point's time and
  its marks past the row's edge. The description is now cut short instead
  (`74494b9`), held by the browser test
  `fits each point of the History panel to its width, cutting the description short and not the time or marks`.
- A backup refused for want of room was given the save status's sentence,
  that the change is kept and written once room is made, which is untrue of a
  backup, and a copy the backups folder refused was explained as storage out
  of reach. Each reason is now worded for a backup and for the folder
  (`784813d`), held by
  `says why a backup asked for now was not made in words of the backup` and
  `says why a backup was not copied to the folder in words of the folder, not of a save`.
- The offer to link a chosen file that differs was shown twice, in the
  question and as a notice; it is now said without being shown again
  (`65b3675`).
- Every backup's keep and let-go button had the same accessible name; each is
  now named for its backup's time (`2b99c6d`).
- A tab losing a project could report the loss before it heard the taker's
  notice, since the browser delivers the steal and the notice in no set
  order, and called the taker another tab. It now asks who holds the project
  before reporting (`223b0e0`), held by
  `names the window that took the project where its notice comes after the steal`;
  the browser hand-over test passed twenty times of twenty in Chromium.
- Two browser tests were behind the code: the compatibility screen's now
  names the storage format found, and taking over is offered only after an
  unanswered request (`636894c`).

## Re-review

The owner's decision of 2026-09-28 replaces looped review rounds with one
pass whose findings are fixed. No lens was re-run. Each fix was verified by
the test that failed before it and by the gate over the tree it landed in.
