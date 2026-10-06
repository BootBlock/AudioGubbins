# Phase 05 — Core Non-Destructive Editing — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the tree this package describes, the phase branch
after its one review pass and the fixes that answered it.

## Phase identifier and objective

- **Phase:** 05 — Core Non-Destructive Editing.
- **Objective:** the non-destructive edit model and the workflows over a
  project's assets and regions: typed commands, explicit selections,
  immutable source media and branchable history, with audio brought into the
  project by import and read by AudioGubbins' own readers at the rate it was
  recorded at (`ADR-0050`).
- **User-visible outcome:** the person imports a WAV or AIFF file into the
  open project, copied or linked as their setting says, or Quick Edits one in
  a project of its own. The asset keeps its rate, depth and channels. They
  make regions, trim, split, cut, copy, paste, delete, silence, fade, change
  the gain, invert, reverse, balance, swap, copy and remap channels, convert
  the layout, place markers, undo, redo and branch the history, hear either
  side of an A/B comparison, and inspect every operation in the Inspector,
  without the source changing, and find all of it again after a reload.

## Checklist

Every box in the packet's **In Scope** list:

- Quick Edit facade over the project model: `file.quick-edit` in
  `apps/web/src/commands/quick-edit-commands.ts` makes a project named after
  the file, imports it with the person's setting and opens it, and
  `apps/web/src/state/quick-edit-store.ts` holds the session (`ADR-0053`).
- Region and clip domain: `packages/domain/src/editing` (`ADR-0051`): the
  anchored `Region`, its boundaries, loop, tags and processing chain, and
  `region-split.ts`.
- Selection-first command targeting: `EditTarget` carries the range and
  channels the selection set resolves (`ADR-0042`), and a region target the
  basis its processing is anchored at; every edit is dispatched on it through
  `processTargetInvocation` in `packages/project-commands`
  (`target-invocations.ts`), and `apps/web/src/commands/edit-target.ts` and
  `region-target.ts` resolve it.
- Core edit operation graph: the asset's chain of `EditOperation` values,
  their anchors and the one fold into an edit plan (`operations.ts`,
  `anchors.ts`, `plan-building.ts` and their neighbours).
- Clipboard semantics: `packages/clipboard` (`ClipboardPayload`, paste
  planning), `apps/web/src/state/clipboard-store.ts`,
  `apps/web/src/commands/clipboard-commands.ts`, and
  `packages/storage/src/audio-paste.ts`, which adds a pasted payload's records
  only once their media is proved present.
- Trim, split, cut, copy, paste, delete, silence, fade, gain, invert and
  reverse: `apps/web/src/commands/edit-commands.ts`, `split-commands.ts` and
  `clipboard-commands.ts`, each a project command in
  `packages/project-commands/src/editing`.
- Per-channel editing and channel conversion: `channel-commands.ts`
  (balance, channel gains, swap, copy, to mono, to stereo, remap and layout
  conversion), and the matrices in
  `packages/domain/src/editing/channel-matrices.ts`.
- Inspector integration: `apps/web/src/shell/inspector` shows the asset's or
  region's audio shape, source, operations and region properties, and changes
  them through the same commands.
- Undo, redo and history: every edit is a project command with its inverse
  in Phase 02's history, and the History panel and its comparison show the
  result.
- Native-rate reading of uncompressed WAV and AIFF: `packages/codecs`
  (`ADR-0052`): `openAudio`, which recognises the format by content,
  `AudioFormatDescriptor` and `AudioReader`, read in chunks with a
  cancellation signal on the storage worker and the audio threads.
- Import from the interface: `file.import-audio` in
  `apps/web/src/commands/audio-import-commands.ts`, run in the storage worker
  by `packages/storage/src/audio-import.ts` through Phase 02's pipeline, with
  the audio shape in the source's provenance.
- Project assets in the editor: `apps/web/src/assets/project-assets.ts` and
  `apps/web/src/state/project-media-store.ts`; the feeder, the render worker
  and the peak worker each read the asset's files through the edited source
  in `packages/audio-engine/src/pcm/edited-source.ts`.
- Markers and regions as project state: the project's maps hold them, the
  project commands change them with the same inverses, and
  `apps/web/src/state/session-content.ts` is deleted (`ADR-0047`, `ADR-0051`).
- Auditioning both states of an A/B comparison: `history.audition` and the
  side commands in `apps/web/src/commands/audition-commands.ts` and
  `comparison-commands.ts`.

Work units: WU-05.A to WU-05.E as the packet defines them, every box done.

## Inherited debt

The packet assigns five findings of Phase 02's review, and one each passed by
`ADR-0050`, to this phase. Each was fixed before the editing work began,
merged in `0ced326`:

| Finding | Fix |
| --- | --- |
| Phase 02's F-46 | `94278a6`: only the session writer changes the states its collections hold. |
| Phase 02's F-55 | `17c3db5` (the date formatter and the count), `9a8329b` (the media roots list projects as cleanup does), `ee72a73` (one CRC-32, now in `packages/domain/src/integrity`). The review's F-07 found the count still written in places, and what remains is accepted below. |
| Phase 02's F-56 | `e6a812b` (the recovery report's findings in one place), `e7c2d05` (a project's history begun in one place), `15b7cf3` (the comparison-close rule kept with the comparison). |
| F-42 (from Phase 09) | `2b2035a`: the wiring that keeps the stored peak cache to a ready storage root is tested at the project system. |
| F-53, the reserved key (from Phase 09) | `1af3117`: a linked file's kept-handle token may not name a folder, the backups folder's key among them. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/domain` | The edit model (`src/editing`): operations, anchors, regions, markers, the region split, channel matrices, validation and the edit plan with its stages; cancellation, moved here from the engine (`19681a3`); the one CRC-32. |
| `packages/codecs` | New. The read contract: the byte port, recognition by content, the WAV, RF64, BW64, AIFF and AIFF-C readers, sample conversion and refusals; `./testing` writes fixtures for every form. |
| `packages/clipboard` | New. `ClipboardPayload` and paste planning: layout mapping, rate conversion on request, and splitting a long payload into consecutive insertions. |
| `packages/project-commands` | The editing commands: apply and withdraw an edit, markers, regions and their processing, the target invocations. |
| `packages/project-format` | The persisted edit chain, plans, markers, regions and the audio shape in provenance, `projectDocument` version 2. |
| `packages/storage`, `packages/storage-runtime` | Audio import and paste in the storage worker; the media area that answers a stored object's file; a cancelled call settled by what the worker did. |
| `packages/media-store`, `packages/browser-storage` | A stored object's file for the audio threads; a linked file's token refused where it names a folder. |
| `packages/audio-engine`, `packages/audio-runtime` | The edited source: an edit plan with a file for each asset it reads, opened by each audio thread. |
| `packages/editor-view`, `packages/timeline`, `packages/waveform` | Placed markers and regions, the region tool, region edges and region selection; peaks of edited audio. |
| `packages/history`, `packages/text` | The comparison's side as typed state; `counted`, the one count of a noun. |
| `apps/web` | Import, Quick Edit, the edit, channel, clipboard, region and audition commands, the Asset Browser, the Inspector, project assets in the editor, the clipboard and Quick Edit stores. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| EditOperation | `EditOperation` in `@audiogubbins/domain` (`ADR-0051`): delete, trim, insert, reverse, process and convert-layout. |
| Region | `Region` in `@audiogubbins/domain`, anchored to its asset's content; the editor draws `PlacedRegion`. |
| RegionBoundary | `RegionBoundary` in `@audiogubbins/domain`, `start` or `end`, taken by `region.move-start` and `region.move-end` (Move the region's start or end to the playhead), which a drag of a region's edge in the strip also runs. |
| EditTarget | `EditTarget` in `@audiogubbins/domain`: an asset or a region, with the range and channels the selection resolves, and for a region the basis its processing is anchored at. Every edit is dispatched on it through `processTargetInvocation` in `@audiogubbins/project-commands`. |
| ClipboardPayload | `ClipboardPayload` in `@audiogubbins/clipboard`, `{ origin, plan, records }` (`ADR-0053`). |
| ChannelEditOperation | `ChannelEditOperation` in `@audiogubbins/domain`: a processing operation whose edit is a channel edit, or a layout conversion, which types what the channel commands make. |
| QuickEditSession | Held by the shell, not exported by a package: `QuickEditSession` in `apps/web/src/state/quick-edit-store.ts`, in `ProjectStores.quickEdit`. It names the project and the asset a Quick Edit made (`ADR-0053`); no package reads it, so no package publishes it. |
| AudioFormatDescriptor | `AudioFormatDescriptor` in `@audiogubbins/codecs` (`ADR-0052`). |
| AudioReader | `AudioReader` and `openAudio` in `@audiogubbins/codecs`. Recognition by content is `recogniseAudio`, private to the package and run by `openAudio` before any reader is made. |

## ADRs created and changed

- `ADR-0051` — an asset's edits are a chain over its source, and everything
  placed on it is anchored to content.
- `ADR-0052` — the read contract is `packages/codecs`, the storage worker
  imports, and each audio thread reads the media itself.
- `ADR-0053` — the clipboard holds a payload of plan segments, and Quick Edit
  is a project the shell makes.
- `ADR-0015` — amended by `ADR-0051`: the project-timeline `Region` and
  `Marker` are restated as values of one asset.
- `ADR-0018` — amended for inherited F-55: `packages/text` offers `counted`,
  and `packages/project-commands` depends on it.

## Tests

| Area | Where |
| --- | --- |
| Operations, anchors, placement, validation | `packages/domain/src/editing/anchors.test.ts`, `placement.test.ts`, `validation.test.ts` |
| The plan against each edit applied in order | `edit-property.test.ts` (random chains, withdrawal, region processing at its basis) |
| Stages, matrices, region split | `stage-arithmetic.test.ts`, `channel-matrices.test.ts`, `region-split.test.ts` |
| Project commands and their inverses | `packages/project-commands/src/editing/editing-commands.test.ts`, `target-invocations.test.ts`, `project-commands.test.ts` |
| Clipboard | `packages/clipboard/src/clipboard.test.ts`, `packages/storage/src/audio-paste.test.ts` |
| Readers, fixtures and malformed media | `packages/codecs/src/codec-fixtures.test.ts`, `malformed-media.test.ts`, `packages/test-fixtures/src/wav-files.test.ts` |
| Persisted format | `packages/project-format/src/edit-json.test.ts`, `project-json.test.ts`, `project-tree.provenance.test.ts` |
| Import in the storage worker | `packages/storage/src/audio-import.test.ts`, `packages/storage-runtime/src/client/media-client.test.ts`, `protocol/port-channel.test.ts` |
| Edited audio on the audio threads | `packages/audio-engine/src/pcm/edited-source.test.ts`, `packages/audio-runtime/src/protocol/feeder-messages.test.ts`, `packages/waveform/src/peak-messages.test.ts` |
| Editor commands, selection first | `apps/web/src/commands/edit-commands.test.ts`, `region-boundary-commands.test.ts`, `marker-commands.test.ts`, `editor-commands.test.ts` |
| Import, Quick Edit, audition | `audio-import-commands.test.ts`, `quick-edit-commands.test.ts`, `audition-commands.test.ts` |
| Project assets and media | `apps/web/src/assets/project-assets.test.ts`, `apps/web/src/state/project-media-store.test.ts`, `project-system.test.ts` |
| Asset Browser, Inspector, toolbar | `apps/web/src/shell/asset-browser.test.tsx`, `inspector/inspector-panel.test.tsx`, `editor-toolbar.test.tsx`, `history/history-panel.test.tsx` |
| Tools and hit testing on regions | `packages/editor-view/src/pointer-tools.test.ts`, `frame-composer.test.ts`, `apps/web/src/editor/tool-pointer.test.ts` |
| Layering, exports and command routes | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/core-editing.spec.ts` |

## Commands used for verification

```
pnpm run lint                        # pnpm run version:check, pnpm run graph:check, pnpm run notices:check, eslint ., prettier --check .
pnpm run typecheck:full              # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json
pnpm run test                        # vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.cache/audiogubbins/vitest-report.json
pnpm run record:check                # node tools/check-record-titles.mjs
pnpm run test:dependencies           # depcruise --config .dependency-cruiser.cjs apps packages tests tools
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:editing-property       # vitest run --project domain --project project-commands edit-property project-commands.test
pnpm run test:codec-fixtures         # vitest run --project codecs fixture
pnpm run test:malformed-media        # vitest run --project codecs malformed
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:e2e:core-editing       # playwright test --project=chromium-core-editing
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet also names `pnpm test --filter editing --filter commands` and
`pnpm test --filter codecs`, which pnpm reads as workspace filters: each runs
the selected packages' own `test` script, which runs its Vitest project from
the root. No package is named `editing`, so the first selects
`@audiogubbins/commands` alone; the editing code's own packages are run by
name below, and by the whole suite.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Pass over `1d8e5f6`: lint, both type checks, 6,393 tests in 420 files with none failing, 1,985 cited titles, and no dependency violation among 1,456 modules. |
| `pnpm run spec:verify` | Pass: lint, the generated specification and phase contexts current, and the hardening assertions satisfied. |
| `pnpm test --filter codecs` | Pass: 238 tests in 2 files. |
| `pnpm test --filter editing --filter commands` | Pass: `commands` 314 tests in 8 files. |
| `pnpm --filter @audiogubbins/domain --filter @audiogubbins/project-commands --filter @audiogubbins/clipboard test` | Pass: `domain` 244 tests in 18 files, `project-commands` 86 in 7, `clipboard` 14 in 1. |
| `pnpm run test:editing-property` | Pass: 7 tests in 2 files. |
| `pnpm run test:codec-fixtures` | Pass: 160 tests in 1 file. |
| `pnpm run test:malformed-media` | Pass: 78 tests in 1 file. |
| `pnpm run test:project-roundtrip` | Pass: 274 tests in 7 files. |
| `pnpm run test:e2e:core-editing` | Pass: 1 test, project `chromium-core-editing`, over `1d8e5f6`. |

The filtered figures were read over the tree of the last remediation merge,
`da9b67e`, each run on its own.

## Browser and device results

The browser test passed over `1d8e5f6`, the last code commit, against the
production build the preview server serves, in Chromium through Playwright
1.63.0. It passed earlier over `1dc945f`, before the review, and over
`7aced0b`, where the record's pictures were taken.

Playwright cannot answer the File System Access pickers Chromium offers, so
the test removes them with `addInitScript` and chooses the file through the
file input the application falls back to, the path Firefox takes. No automated test
drives Chromium's own picker: `storage-platform.test.ts` covers only whether
the browser offers it, so choosing a file through it is unproven by a test and
recorded as a limitation.

`tests/e2e/core-editing.spec.ts`,
`imports a file, marks and edits it, and finds the same project after a reload`,
runs the built application in Chromium: it makes a project, imports a WAV
through File, Import audio, adds a marker at the playhead, reverses, reads the
rate and the operation in the Inspector, reloads, and requires the marker's
name and position and the edit's range to be what the page showed before the
reload (`7a04570`).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| All core edits survive save/reload and full undo/redo/branch traversal. | `edit-json.test.ts` reads back every operation, plan, marker and region; `editing-commands.test.ts` undoes every command by its inverses to the state it began from; the random command walk in `project-commands.test.ts`; `test:project-roundtrip`; the browser test's reload. |
| Source-content hashes are unchanged after non-destructive editing. | Copied media is stored under its content identity in a sealed, written-once object (Phase 02's object store), and an edit adds an operation to the asset alone: `editing-commands.test.ts` requires the asset's source record, its content identity among it, to be equal before and after a deletion. A linked file is never written; `audio-paste.test.ts` and Phase 02's source-change policy refuse a changed one. |
| Selection-first targeting is covered by direct tests for every edit command. | `edit-commands.test.ts` runs each processing and each time-changing command on a selected range, on selected channels and with nothing selected, and the clipboard and channel-layout commands with and without a selection (F-31). |
| Per-channel edits preserve channel-role metadata. | `channel-matrices.test.ts` (roles kept, a lone placed channel kept in its place, F-13), `edit-commands.test.ts` (to mono, to stereo, remap). |
| Quick Edit and Project Mode produce the same structures. | `makes the same project, asset and edits as Project Mode does` in `quick-edit-commands.test.ts`. |
| Every WAV and AIFF encoding, depth, byte order and form reads to the expected samples at its native rate, without resampling. | `codec-fixtures.test.ts`: fixtures written by `@audiogubbins/codecs/testing` for every form `REQ-AUDIO-220` names, compared sample for sample, and the extremes of each integer depth (`935934a`). |
| Malformed, truncated and unsupported files fail, or are read, as `REQ-AUDIO-220` says, without changing the project. | `malformed-media.test.ts`; `audio-import.test.ts` (refused before anything is stored, a short file read to its last whole frame with the shortfall, a cancel keeps nothing); `audio-import-commands.test.ts`. |
| An imported asset's markers, regions and edits survive save/reload and history traversal, and the session holder is gone. | `edit-json.test.ts`, `editing-commands.test.ts`, the browser test; `apps/web/src/state/session-content.ts` is deleted. |
| An imported asset records its rate, depth, layout and duration in its provenance, and its source bytes are unchanged, copied or linked. | `audio-import.test.ts` (copy and link), `project-tree.provenance.test.ts`. |
| The two states of an A/B comparison can be auditioned without changing either. | `plays the audio in view as the side heard has it, changing neither state` in `audition-commands.test.ts`. |
| A browser test imports a file, marks and edits it, reloads, and finds the same project. | `tests/e2e/core-editing.spec.ts`, above. |

## Known limitations

- The browser test removes Chromium's File System Access pickers with
  `addInitScript`, because Playwright cannot answer them, so it exercises the
  file input element, the path Firefox takes. No browser test drives
  Chromium's pickers.
- The thread tests that send edited audio run under jsdom, whose `Blob` does
  not survive Node's structured clone, so the feeder's message test and the
  storage runtime's client tests send it with the `Blob` of `node:buffer`, as
  a browser's crosses.
- Some tests pass alone and time out under load at Vitest's five-second
  default: the ESLint and Prettier exclusion test, the clipboard's split test
  before F-29's fix, the random command walk in `project-commands.test.ts`,
  the comment-width test, the keyboard-wiring test and the golden render.
  None is weakened; the debt is recorded in the handoff.
- Export, and so Quick Edit's export and per-region and batch export of
  `REQ-EDIT-014`, is Phase 09's (`ADR-0050`, `ADR-0053`).
- Processing shared between regions is made on the asset, where it reaches
  every region over it; a named chain of processors that several regions
  share is the effect rack's presets and chains, Phase 06's.
- Safari and WebKit were not run, as in Phase 04; the browser matrix is
  Phase 14's.

## Dependencies added, and their review

None outside the workspace. The new packages, `@audiogubbins/codecs` and
`@audiogubbins/clipboard`, are `workspace:*`.

## Migration and schema impact

The project document's schema is raised to `projectDocument` version 2, and
project storage to `projectStorage` version 6, for the edit chain, markers,
regions and the audio shape in provenance. Before 1.0 nothing migrates
(`REQ-STOR-052`): a project of an earlier version is refused with the reason.
An insertion's persisted form is unchanged by F-04's retyping.

## Screenshots and recordings

None kept in the tree. The browser test and the run recorded above are the
evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-EDIT-008` Editing modes | Project Mode is the project system of Phase 02 with this phase's editing. Quick Edit opens a file, edits it and previews it without a project dialogue, over the same project model and the same commands (`ADR-0053`). Export is Phase 09's. | `quick-edit-commands.test.ts`, among it `makes the same project, asset and edits as Project Mode does`; `audition-commands.test.ts` and `edited-source.test.ts` for preview. |
| `REQ-EDIT-014` Regions | Many regions over one asset, each with its own name, anchored boundaries, processing chain, loop with crossfade and tags; made from a selection, split with their processing on each part, moved by an end, selected by tap or keyboard. Processing on the asset is shared by every region over it. Per-region and batch export are Phase 09's; a named chain shared between regions is Phase 06's. | `region-split.test.ts`, `placement.test.ts`, `edit-property.test.ts`, `editing-commands.test.ts`, `edit-commands.test.ts`, `region-boundary-commands.test.ts`, `pointer-tools.test.ts`. |
| `REQ-EDIT-015` Channel editing | A lane per channel, per-channel selection and edits, to mono, to stereo, swap, copy one channel to another, balance, channel gains, remap and layout conversion by an explicit matrix over any layout, roles kept. | `channel-matrices.test.ts`, `stage-arithmetic.test.ts`, `edit-commands.test.ts`, `validation.test.ts`. |
| `REQ-AUDIO-220` Native-rate reading | `packages/codecs` reads WAV (plain, extensible, RF64, BW64) and AIFF/AIFF-C at the file's rate, recognised by content, converted by one stated rule, in chunks with a cancellation signal, off the UI thread; refusal before storing, the shortfall reported, the shape in provenance, the source unchanged. | `codec-fixtures.test.ts`, `malformed-media.test.ts`, `audio-import.test.ts`, `edited-source.test.ts`, `core-editing.spec.ts`. |

The requirements this phase consumes from other phases are met as the packet
names them: `REQ-ARCH-085` (no resampling on import, `codec-fixtures.test.ts`;
a paste converts its rate only when asked, F-05), `REQ-EDIT-012` and
`REQ-EDIT-061` (markers and regions as project state, shared by every view),
`REQ-STOR-021` (every edit undone by the project's history), `REQ-STOR-025`
and `REQ-STOR-104` (copy or link, the change policy, `audio-import.test.ts`,
`audio-paste.test.ts`), `REQ-STOR-052` (the schema raised, no migration),
`REQ-STOR-166` (the audio shape in provenance), `REQ-STOR-195` (the audition)
and `REQ-AUDIO-010` (the read contract Phase 09 extends).

## Commits

Oldest first, on `phase-05-editing`, from `250362f`:

- `3204766` Record the edit model, read contract and clipboard decisions
- `94278a6` Let the session writer alone change its states
- `17c3db5` Write times and counts through one wording
- `9a8329b` List the media roots' projects as cleanup does
- `ee72a73` Check peak caches by the one CRC-32
- `e6a812b` Read a recovery report's findings in one place
- `e7c2d05` Begin a project's history in one place
- `15b7cf3` Keep the comparison-close rule with the comparison
- `1af3117` Refuse a linked file's token that names a folder
- `2b2035a` Test the peak cache's ready root at the system
- `36a7efd` Add the read contract for uncompressed audio
- `4968933` Model edits as a chain with anchored placements
- `db2cd4d` Persist edits, regions, markers and audio shape
- `a87cb7c` Add the editing project commands
- `306e213` Play an edited sound from its files
- `4c3bbaa` Correct how the engine reads files in ADR-0052
- `c16d014` Make the tree typecheck over the edit model
- `3b40ba0` Import audio in the storage worker
- `665f334` Copy and paste audio through the clipboard package
- `54c027f` Open the project's assets and regions in the editor
- `5e5bfc6` Edit project audio from the editor, selection first
- `be9ad2b` Import audio into the open project from the interface
- `4a88790` Show the project's audio in the Asset Browser
- `ac59e1c` Show and change what the editor acts on in the Inspector
- `82fe82d` Quick Edit a file in a project of its own
- `de9b83b` Hear both states of an A/B comparison
- `982638d` Send edited audio with its file through the thread tests
- `1dc945f` Prove core editing in a real browser, with its scripts
- `329df1f` Offer from each package only what another uses
- `5f3d302` Resolve every edit through its EditTarget
- `77447f1` Move one end of a region, by drag or command
- `685ab48` Format the audio import commands
- `8a6609a` Wrap three module comments at the comment width
- `3acce62` Break the operations-plan cycle; let test support use fixtures
- `12d5453` Keep a lone placed channel in its place
- `2844af8` Fold a region's processing in at its basis
- `b35dc9c` Split a region with its processing on each part
- `9fece59` Offer every tool on the editor toolbar
- `6e350ca` Settle a cancelled call with what the worker did
- `4f2dab0` Keep command buttons focusable and focused
- `82c644d` Say the side heard once, and play it as offered
- `28f470a` Plan only the project assets a change touched
- `c11aa9a` Split the loop field out of the loop controls
- `5b8dd99` Play the comparison side asked for last
- `0f7b4f0` Leave no project behind a failed Quick Edit
- `76e8049` Make the import guard tests unable to miss
- `afbb0ef` Open an edited source's file for its own life
- `7a4f1a7` Name channels as the editor does in commands
- `a485b4d` Say every count through one rule in the text package
- `f73ded7` Copy untouched channels through a matrix exactly
- `90368d1` Convert a pasted payload whole, never in pieces
- `3eabd20` Make ClipboardPayload the clipboard's own type
- `9fe5542` Add a paste that converts the sample rate
- `935934a` Correct the stated full scale of deep integers
- `7a04570` Hold the reloaded project to what was shown
- `2d97240` Select regions by tap and from the keyboard
- `da1a0c1` Check a loop's crossfade by the domain's own rules
- `19681a3` Keep one cancellation mechanism, in the domain
- `c0abea2` Wrap the project entry comments to width
- `0f085ce` Keep an Inspector comment within the comment width
- `ef4320a` Ask for an open project's files a few at a time
- `6bb4350` Re-flow two comments to the comment width
- `d400c3c` Offer no import while one runs
- `c703ef5` Convert a layout under channel-naming processing
- `c6f3dd8` Name an edit's channels by the layout it was made on
- `9d2f396` Describe an asset's audio as its edits leave it
- `24c8ed6` Open one project entry in a module of its own
- `7aced0b` Put cut, copy and paste on the keys that type them
- `8d47417` Leave clipboard keys to the page off the editor

The merge commits between them join the inherited debt's branch (`0ced326`)
and the remediation's seven branches (`2c25848`, `02f15ff`, `c4019e7`,
`b105880`, `da9b67e`, `faf8cde`, `1d8e5f6`). The commit that records this package, the
review and the handoff follows, and the integration commit is the merge into
`main`.

## Reviewer findings and remediation

`reviews/phase-05-review.md` records the nine lenses, run by five reviewers, their
thirty-four findings, and the disposition of each with its commit. Both `HIGH`
findings and all nineteen `MEDIUM` findings are fixed, as are nine of the
twelve `LOW` findings and the `NOTE`. F-07 is fixed with its remnants accepted
with tracking, F-21 is fixed in part with the rest rejected, and F-12 is
rejected, each with its reasoning. What the phase leaves to later phases is
accepted with tracking in the handoff capsule.
