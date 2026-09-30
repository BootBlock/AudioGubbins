# Phase Handoff Capsule — Phase 04

## Capability Delivered

AudioGubbins has a sample-accurate editor foundation. A person opens a
deterministic test asset into one or more Editor panels, each with its own
zoom, scroll, display mode, tool and channels, and zooms from the whole asset
down to individual samples. The views share the asset's selection, markers and
playhead. Peaks are built progressively in a worker into a multi-resolution
pyramid, kept in a disposable IndexedDB cache, and drawn by a renderer that
takes WebGPU where a device passes a validation draw, with WebGL2 and Canvas 2D
behind it, and recovers from a lost context or device by drawing the next
frame. A selection set models time, channel, object and spectral selection
apart, with a precedence that names a command's target or refuses it with the
reason. Snapping, the hybrid tools with pointer, pen, touch and keyboard input,
and a Picture panel that follows the media clock within one frame while
playing and exactly while parked complete it.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-04-evidence.md`, under "Requirement-to-evidence mapping".
`REQ-PROD-160` is deferred by the specification, and parts of `REQ-EDIT-065`
and `REQ-EDIT-062` come with later phases, as recorded below.

- `REQ-EDIT-012`
- `REQ-EDIT-013`
- `REQ-ARCH-037`
- `REQ-EDIT-061`
- `REQ-EDIT-062`
- `REQ-EDIT-063`
- `REQ-EDIT-064`
- `REQ-EDIT-065`
- `REQ-AUDIO-082`
- `REQ-AUDIO-152`
- `REQ-AUDIO-156`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them.

- `@audiogubbins/timeline`: zoom, `ViewportState` and its exact conversions,
  frame rates, timecode, time formats, the ruler, `SelectionSet` with
  `resolveTarget`, `describeTarget` and `targetOutside`, and snapping with
  `SnapTarget` and `SnapResult`. A position is the domain's `SampleCount`, a
  sample boundary (`ADR-0041`).
- `@audiogubbins/waveform`: `WaveformPeakPyramid`, its builder, codec, column
  query, detail buckets and zero crossings, the peak worker's protocol and
  thread entry, and the host that shares one pyramid per source.
- `@audiogubbins/renderer`: the render frame as a value, `RendererBackend`,
  the WebGPU, WebGL2 and Canvas 2D backends made with an injected schedule,
  the renderer with its report, and a surface that tells it of an overlay's
  loss and restoration.
- `@audiogubbins/editor-view`: `EditorViewState`, lane layout, tools as
  intents, hit testing, snap candidates, `FrameComposer`, and `./testing` for
  other packages' tests.
- `@audiogubbins/video-reference`: `ReferenceMediaClockBinding`, frame
  arithmetic, calibration, timecode and `pictureCorrection`.
- `@audiogubbins/audio-engine` and `@audiogubbins/audio-runtime`: the signal
  recipe and its source replace the tone description (`ADR-0045`), and one
  `PcmDescription` is shared by the feeder, the render worker and the peak
  worker.
- `@audiogubbins/capabilities`: the graphics platform, and the frame callback,
  full screen and IndexedDB as capabilities.
- `@audiogubbins/commands`: a command may be marked as changing only the
  appearance, which lets it run while a modal dialogue is open.
- `@audiogubbins/design-system`: `ContextActions` takes an opener that opens it
  at a point, and contrast measurement (`contrastRatio`).
- `@audiogubbins/domain`: its unused single-kind selection is removed; the
  selection set replaces it (`ADR-0040`).

## Persisted / Interchange Formats

- The application's editor views, schema `editorViews` version 1 under
  `audiogubbins.editor-views`, each field read back on its own so a damaged
  field falls back alone.
- The peak cache in IndexedDB is disposable: each entry names its format
  version, its source's identity and its revision, and an entry that does not
  match is built again. A write resolves only when its transaction commits.
- Markers and regions are held for the session only (`ADR-0047`). Nothing in a
  project changes.

## Invariants Downstream Agents Must Preserve

- The five packages keep the directions of `ADR-0040`: the timeline depends on
  the domain alone, and the editor view imports no UI framework. Only
  `packages/capabilities` reads browser globals. The renderer reads none, and
  an ESLint rule holds it to that.
- A position is a sample boundary, and zoom is whole samples per pixel or whole
  pixels per sample, so every conversion is exact at any position
  (`ADR-0041`).
- A command's target comes from the selection set's precedence, never from a
  single facet read directly, and a command that cannot resolve one refuses
  with the reason (`ADR-0042`).
- The page never builds peaks. The worker builds them, and the host keeps a
  pyramid while any view shows its asset (`peak-messages.test.ts`,
  `shown-peaks.test.ts`). Every request to the worker can be cancelled.
- The renderer holds no authoritative state: each frame is composed whole from
  the stores, so a lost device is recovered by the next frame. A frame is
  composed again only when a value it is drawn from has changed.
- A draw a backend cannot make is reported, and the next backend takes over.
  Recovery is counted only once the latest frame is drawn again.
- Text the editor draws meets 4.5:1 against what is drawn under it, in both
  themes, both contrasts, every accent and every brightness
  (`theme-palette.test.ts`).
- Mutations of authoritative state go through commands. Every tool acts
  through them, and the keyboard reaches every tool's action.
- A text field keeps its editing keys, and a modal dialogue keeps the
  keyboard, except for a command marked as changing only the appearance.
- The Picture panel's video element never enters the audio edit domain. Its
  sound is decoded only when the person asks, within the page's memory.

## ADRs

- `ADR-0040` — the editor foundation is five packages, with the selection
  model moved into the timeline.
- `ADR-0041` — a position is a sample boundary, and every conversion is exact.
- `ADR-0042` — the selection set, its facets and the precedence that makes a
  command's target.
- `ADR-0043` — the peak pyramid, its worker and its disposable cache.
- `ADR-0044` — the render frame as a value, the backends and recovery.
- `ADR-0045` — signal recipes replace the engine's tone source.
- `ADR-0046` — reference picture bound to the media clock.
- `ADR-0047` — the session's markers and regions per asset.

## Verification Baselines

- The application's test signal still renders to `0xe576a76257ddb259`
  (`tests/e2e/transport.spec.ts`), so the signal recipe changed no sample.
- The test assets are signal recipes, deterministic to the sample
  (`test-assets.test.ts`), among them a three-hour stereo session that the
  timeline suite zooms and scrolls on a wide display.
- `pnpm run test:e2e:timeline`, `test:renderer-loss`, `test:touch-pen` and
  `test:video-reference` in Chromium. The renderer suites read the drawn
  pixels after a loss and after recovery.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- The razor tool places the playhead where it would split. Splitting is an
  edit, Phase 05's (`REQ-EDIT-014`).
- Regions come only from the test asset that defines them, and markers and
  regions are held for the session. Phase 05 edits regions and Phase 02's
  project persists both (`ADR-0047`).
- The spectrogram lane is the presentation shell: its axis, its scale and band
  commands, and the spectral selection the selection set keeps and the overlay
  draws. Spectral analysis, the spectral tools and the region tool come with
  Phases 08 and 05.
- Musical time is `REQ-PROD-160`, deferred. Time formats and snap kinds are
  unions a musical kind can join.

## Accepted Non-Blocking Debt

- Safari and WebKit were not run for the editor. Playwright's WebKit on the
  test machine has no `AudioContext`. Owed to Phase 14's compatibility
  hardening.
- The picture's sound extraction bounds its memory by assuming at most eight
  channels. Owed to Phase 09, whose codecs read a file's real channel count.
- The browser suite checks that playing picture stays within a frame of the
  audio, not how many seeks that took. Owed to Phase 14's performance
  hardening.
- Phase 01's debt owed to this phase is closed: the dock keeps each group's
  scroll across a rebuild (F-304, F-560); the editor surface mounts the long
  press context action, with its test in `touch-pen.spec.ts` (F-188, F-281);
  pointer input calls `sampleFromPointerEvent` (F-218); a split of the main
  area survives a remount (F-275); and focus follows a panel an arrangement
  command moved (F-283).

## Downstream Readiness

- No phase becomes `READY`. Phase 05 still waits on Phase 02, and Phase 08 on
  Phases 05 and 06.
