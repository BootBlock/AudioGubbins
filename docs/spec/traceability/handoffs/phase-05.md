# Phase Handoff Capsule — Phase 05

## Capability Delivered

AudioGubbins edits a project's audio non-destructively. A person imports a WAV
or AIFF file into the open project, copied or linked as their setting says,
or Quick Edits one in a project made for it; AudioGubbins' own readers read it
at the rate it was recorded at, recognised by its contents, in chunks off the
UI thread, and the asset records the file's audio shape in its provenance. An
asset keeps its source unchanged and carries an ordered chain of edit
operations; markers, regions and a region's own processing are anchored to its
content and carried through every later edit. Trim, split, cut, copy, paste,
delete, silence, fades, gain, inversion, reversal, per-channel edits and layout
conversion act on the selection, or on the documented whole target, through
project commands that undo, redo and branch with the project's history. One
edit plan describes what an edited sound is, and playback, the render worker,
the peak worker and the clipboard all read it. The Asset Browser and the
Inspector show and change the result, and either side of an A/B comparison
can be heard without changing it.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-05-evidence.md`, under "Requirement-to-evidence mapping". Parts
of `REQ-EDIT-008` and `REQ-EDIT-014` come with later phases, as recorded below.

- `REQ-EDIT-008`
- `REQ-EDIT-014`
- `REQ-EDIT-015`
- `REQ-AUDIO-220`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them.

- `@audiogubbins/domain`: the edit model of `ADR-0051`: `EditOperation`,
  `ChannelEditOperation`, `EditTarget` (an asset or a region, with the range
  and channels the selection resolves, and a region's basis), the anchored
  `Region`, `RegionBoundary` and `Marker`, the region split, channel matrices,
  validation and the edit plan; cancellation, moved from the engine; CRC-32.
  The timeline's former `Region` and `Marker` are restated as `PlacedRegion`
  and `PlacedMarker` (`ADR-0015` amended).
- `@audiogubbins/codecs` (new): `AudioBytes`, `AudioFormatDescriptor`,
  `AudioReader` and `openAudio`, which recognises the format by content; and
  `./testing`, which writes fixtures for every form (`ADR-0052`). Phase 09
  extends this package and adds no second read contract.
- `@audiogubbins/clipboard` (new): `ClipboardPayload`, `{ origin, plan,
  records }`, and paste planning (`ADR-0053`).
- `@audiogubbins/project-commands`: the editing commands for edits, markers,
  regions and region processing, and `processTargetInvocation`, through which
  every edit is dispatched on its `EditTarget`.
- `@audiogubbins/project-format`: the persisted edit chain, plans, markers,
  regions and the audio shape in provenance.
- `@audiogubbins/storage` and `@audiogubbins/storage-runtime`: audio import and
  paste in the storage worker, a stored object's file for the audio threads,
  and a cancelled call that settles by what the worker did.
- `@audiogubbins/audio-engine` and `@audiogubbins/audio-runtime`: the edited
  source kind, an edit plan with a file for each asset it reads.
- `@audiogubbins/text`: `counted` (`ADR-0018` amended).
- `apps/web`: `QuickEditSession` is held by the shell in
  `apps/web/src/state/quick-edit-store.ts`, in `ProjectStores.quickEdit`, not
  published by a package, since no package reads it.

## Persisted / Interchange Formats

- The project document, schema `projectDocument` version 2, and project
  storage, `projectStorage` version 6: each asset's edit chain, the plans its
  insertions carry, markers, regions with their loops, tags and processing,
  and the source's audio shape in its provenance. Before 1.0 nothing
  migrates, and an earlier version is refused with the reason
  (`REQ-STOR-052`).
- The clipboard is held by the page for its session and never persisted or
  sent anywhere.
- The session holder of Phase 04's markers and regions,
  `apps/web/src/state/session-content.ts`, is removed: they are project state.

## Invariants Downstream Agents Must Preserve

- A source's bytes never change. An edit adds an operation to the asset's
  chain; copied media is a sealed, written-once object, and a linked file is
  only read.
- The edit plan is the only description of an edited sound. Playback, the
  render worker, the peak worker and the clipboard read it, and nothing else
  decides what an edit sounds like (`ADR-0051`).
- Everything placed on an asset is anchored at a basis and carried through
  the operations after it; a region's processing is folded in at its basis,
  so its stages stay on the content they were made on.
- The clipboard commands (`CLIPBOARD_COMMANDS` in
  `apps/web/src/commands/clipboard-commands.ts`) run from a key press only
  where the keyboard focus is in an editor panel; anywhere else the press is
  the browser's, so a person copies and pastes page text as the platform does.
  A rebound clipboard command keeps the rule, which goes by the command, not
  the key.
- An edit command acts on the selection the selection set resolves, or on the
  documented whole target, through its `EditTarget`; an operation that changes
  time acts on every channel, and a narrower scope is refused with the reason.
- Every edit is a project command with its inverse, and undoes with the
  project's history. The Inspector and every tool run the same commands.
- Every asset keeps its native rate. Nothing is resampled on import, and a
  paste converts its rate only when the person asks for it, whole, never in
  pieces.
- `packages/codecs` depends on the domain alone, takes its bytes through an
  injected port, recognises a format by content, never by name, and is the
  one read contract. A file is never held whole to be imported, played or
  drawn, and every read takes a cancellation signal.
- A file is refused before anything is stored; a cancelled call settles by
  what the worker did, so a change made is never reported as not made.
- A layout conversion keeps the new layout's roles, and every per-channel
  operation keeps the roles it found; only the mono role is spread.

## ADRs

- `ADR-0051` — an asset's edits are a chain over its source, and everything
  placed on it is anchored to content.
- `ADR-0052` — the read contract is `packages/codecs`, the storage worker
  imports, and each audio thread reads the media itself.
- `ADR-0053` — the clipboard holds a payload of plan segments, and Quick Edit
  is a project the shell makes.
- `ADR-0015` and `ADR-0018` — amended, as above.

## Verification Baselines

- The codec fixtures, written by `@audiogubbins/codecs/testing` for every
  encoding, depth, byte order and form `REQ-AUDIO-220` names and compared
  sample for sample: `pnpm run test:codec-fixtures`, with the malformed-media
  suite, `pnpm run test:malformed-media`.
- The edit plan against each edit applied to the samples in order, over
  random chains and random regions: `pnpm run test:editing-property`.
- `pnpm run test:project-roundtrip`, and `pnpm run test:e2e:core-editing` in
  Chromium, which imports, marks, edits and reloads.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Export, and with it Quick Edit's export and the per-region and batch export
  of `REQ-EDIT-014`: Phase 09 (packet, Out of Scope; `ADR-0050`, `ADR-0053`).
- Compressed formats, their decoders, metadata and batch import: Phase 09,
  which extends `packages/codecs` (`ADR-0050`).
- A named chain of processors shared between regions: the effect rack's
  presets and chains, Phase 06's (packet, Out of Scope: the full DSP effect
  rack). Processing made on the asset already reaches every region over it.

## Accepted Non-Blocking Debt

- F-07's remnants (LOW), owed to Phase 06: `audio-graph` and `audio-engine`
  keep their own count, since `ADR-0030` keeps them free of the text package,
  which needs a maintainer's decision; a time of day to the second is written
  three ways (`packages/storage-runtime/src/host/browser-host.ts`,
  `apps/web/src/app.tsx`, `apps/web/src/shell/diagnostics-panel.tsx`);
  `packages/storage/src/usage-measurement.ts` still lists projects by hand;
  and names are quoted two ways, curly in
  `packages/project-commands/src/project-command.ts` and straight in
  `apps/web/src/wording.ts`.
- Tests that pass alone time out under load at Vitest's five-second default:
  the ESLint and Prettier exclusion test, the random command walk in
  `project-commands.test.ts`, the comment-width test, the keyboard-wiring test
  and the golden render (the clipboard's split test was one until F-29's
  fix). Owed to Phase 14's performance hardening, or to the next phase whose
  gate meets one.
- The browser test removes Chromium's File System Access pickers, which
  Playwright cannot answer, so the pickers' path in Chromium is driven by no
  browser test. Owed to Phase 14's compatibility hardening.
- The thread tests under jsdom send edited audio with the `Blob` of
  `node:buffer`, since jsdom's does not survive Node's structured clone.
- Safari and WebKit were not run, as in Phase 04. Owed to Phase 14.
- `editor.select-all` (Ctrl or Command+A) and `editor.clear-selection` are
  still taken on the whole page, so selecting all of the page's text by key is
  not possible outside a text field. A test pins it ("runs the same chords as
  the editor's outside a field"); scoping them to the editor as the clipboard
  keys are is a design decision left to the maintainer.
- Phase 02's debt owed to this phase is closed: F-46 (`94278a6`), F-55 apart
  from F-07's remnants above (`17c3db5`, `9a8329b`, `ee72a73`, `a485b4d`),
  F-56 (`e6a812b`, `e7c2d05`, `15b7cf3`), F-42 (`2b2035a`) and F-53's reserved
  key (`1af3117`); the source's audio shape (`REQ-STOR-166`) and the A/B
  audition (`REQ-STOR-195`) are delivered.

## Downstream Readiness

- Phase 06 — Effect Rack and Core DSP: its hard dependencies, Phases 03 and
  05, have both reached `PASS`, so it is eligible for `READY`. Its readiness
  review decides it, with F-07's remnants and the shared processing chains of
  `REQ-EDIT-014` before it.
- Phases 07, 08 and 09 still wait on Phase 06, and Phase 10 on Phases 06
  and 09.
