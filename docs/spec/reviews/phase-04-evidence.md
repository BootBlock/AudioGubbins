# Phase 04 — Waveform and Timeline Foundation — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the tree this package describes, the phase branch
after its one review pass and the fixes that answered it.

## Phase identifier and objective

- **Phase:** 04 — Waveform and Timeline Foundation.
- **Objective:** the sample-accurate editor foundation: a multi-resolution
  peak cache, a renderer with WebGPU, WebGL2 and Canvas 2D backends, the
  timeline's coordinates, an explicit selection model, snapping, several views
  of one asset, channel-aware lanes, one media clock for playback and picture,
  and reference picture.
- **User-visible outcome:** the person opens a deterministic test asset into
  one or more Editor panels, zooms from the whole asset down to individual
  samples, scrolls, selects time, channels and markers, snaps, adds and moves
  markers, plays the asset with a playhead the views follow, and opens a video
  in the Picture panel that follows the playhead within one frame while it
  plays and exactly while it is parked.

## Checklist

Every box in the packet's **In Scope** list:

- Multi-resolution peak generation and cache: `packages/waveform` (the
  pyramid, its builder, codec, columns and zero crossings, the worker and the
  host; `ADR-0043`), `apps/web/src/io/peak-cache-store.ts` (IndexedDB).
- GPU renderer abstraction with a WebGL2 fallback and an optional WebGPU path:
  `packages/renderer` (`ADR-0044`), the graphics platform in
  `packages/capabilities/src/graphics-platform.ts`.
- Timeline coordinate model: `packages/timeline` zoom, viewport, frame rate,
  timecode, time formats and ruler (`ADR-0041`).
- Sample-accurate zoom, scroll and playhead: the viewport's exact conversions,
  `apps/web/src/commands/editor-navigation-commands.ts` and
  `playhead-commands.ts`, the playhead from `PlaybackControl.playheadPosition`.
- Explicit time, channel, object and spectral selection: `packages/timeline`
  `selection-set.ts` and `selection-target.ts` (`ADR-0042`),
  `apps/web/src/state/selection-store.ts`, `selection-reconciling.ts`,
  `apps/web/src/commands/selection-commands.ts`. A spectral selection is a
  facet of the selection set, which keeps and resolves it, and the overlay
  draws one; no tool or command makes one until spectral editing (Phase 08).
- Snapping engine: `packages/timeline/src/snapping.ts`, candidates from
  `packages/editor-view/src/snap-candidates.ts` and zero crossings from the
  peak worker.
- Multiple views per asset: the Editor panel allows several, each with its
  own state in `apps/web/src/state/editor-view-store.ts`, and
  `editor.new-view` places the new one beside the focused one.
- Waveform and spectrogram presentation shell: the display modes of
  `packages/editor-view` (waveform, spectrogram, stacked, overlaid).
- Tool and input hit testing: `packages/editor-view/src/hit-testing.ts`,
  `pointer-tools.ts`, `apps/web/src/editor/tool-pointer.ts` and
  `pointer-input.ts`.
- Video reference transport, timecode and markers: `packages/video-reference`
  (`ADR-0046`), `apps/web/src/picture`, the Picture panel and its commands.
- N-channel waveform layout: `packages/editor-view/src/lane-layout.ts`, lanes
  named from the channel layout, shown and hidden per view.

Work units: WU-04.A to WU-04.E as the packet defines them, every box done.

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/timeline` | The time axis as values: zoom, the viewport and its exact conversions, frame rates and timecode, time formats, the ruler, the selection set and its target precedence, and snapping. Depends on the domain alone. |
| `packages/waveform` | The peak pyramid per channel, built in a worker from a PCM description in chunks nearest the view first, encoded for a cache keyed to the source's identity and revision, sample windows below 256 frames per device pixel, and zero crossings. |
| `packages/renderer` | The render frame as a value, the WebGPU, WebGL2 and Canvas 2D backends, the choice between them with its report, and recovery from a lost context or device. |
| `packages/editor-view` | An editor view's state, its lanes, its tools as intents, hit testing, snap candidates and the composition of a render frame from state. |
| `packages/video-reference` | The binding of reference picture to the media clock, and when a playing picture must be corrected. |
| `packages/audio-engine`, `packages/audio-runtime` | The signal recipe and its source (`ADR-0045`), and the PCM description that the feeder, the render worker and the peak worker share. |
| `packages/capabilities` | The graphics platform, and the frame callback, full screen and IndexedDB as capabilities with their features. |
| `packages/workspace` | The Picture panel kind, a panel placed beside another in a split of the main area, and the dock's memory of each panel's scroll and of the keyboard across a rebuild. |
| `apps/web` | The test assets, the session content, the selection, cue and editor-view stores, the editor, picture, selection, marker and playhead commands with their shortcuts, the Editor and Picture panels, the peak cache, and playback of an asset at its own rate. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| TimelineCoordinate / SamplePosition | A position is a sample boundary, the domain's `SampleCount` (`ADR-0041`), with `BoundaryRange` and the conversions `boundaryAt`, `sampleAt`, `pixelOf` and `nearestBoundary` in `@audiogubbins/timeline`. |
| ViewportState | `ViewportState` in `@audiogubbins/timeline`. |
| SelectionSet | `SelectionSet`, with `resolveTarget`, `describeTarget` and `targetOutside`, in `@audiogubbins/timeline` (`ADR-0042`). |
| SnapTarget / SnapResult | `SnapTarget` and `SnapResult` in `@audiogubbins/timeline`. |
| WaveformPeakPyramid | `WaveformPeakPyramid` in `@audiogubbins/waveform` (`ADR-0043`). |
| EditorViewState | `EditorViewState` in `@audiogubbins/editor-view`. |
| RendererBackend | `RendererBackend` in `@audiogubbins/renderer` (`ADR-0044`). |
| ReferenceMediaClockBinding | `ReferenceMediaClockBinding` in `@audiogubbins/video-reference` (`ADR-0046`). |

The peak worker's protocol is a discriminated union with a runtime reader in
`packages/waveform/src/peak-message-reading.ts`. The runtime's source
description replaces its tone kind with a signal kind carrying a recipe.

## ADRs created and changed

- `ADR-0040` — the phase's TypeScript is five packages with one direction
  between them.
- `ADR-0041` — a position is a sample boundary, and zoom is whole samples per
  pixel or whole pixels per sample, so every conversion is exact.
- `ADR-0042` — the selection set, its facets and the precedence that makes a
  command's target.
- `ADR-0043` — the peak pyramid, its worker and its disposable cache.
- `ADR-0044` — the render frame as a value, the backends and recovery.
- `ADR-0045` — signal recipes; the engine's tone source is removed.
- `ADR-0046` — reference picture bound to the media clock.
- `ADR-0047` — the session's markers and regions per asset.

## Tests

| Area | Where |
| --- | --- |
| Coordinates, zoom, drift at huge positions | `packages/timeline/src/zoom.test.ts`, `viewport.test.ts` |
| Formats, timecode, ruler | `timecode.test.ts`, `ruler.test.ts` |
| Selection set and precedence | `selection.test.ts`, `apps/web/src/commands/editor-commands.test.ts` |
| Snapping | `snapping.test.ts`, `packages/editor-view/src/pointer-tools.test.ts` |
| Peaks, codec, worker protocol, host | `packages/waveform/src/peaks.test.ts`, `peak-messages.test.ts`, `peak-host.test.ts`, `apps/web/src/io/peak-cache-store.test.ts` |
| Renderer and recovery | `packages/renderer/src/renderer.test.ts`, `canvas-painting.test.ts`, `webgl2-backend.test.ts`, `webgpu-backend.test.ts` |
| Legible editor text in every theme | `apps/web/src/editor/theme-palette.test.ts`, `packages/design-system/src/tokens/theme.test.ts` |
| Pause at the frame heard, Stop to where the play began | `apps/web/src/audio/playback-control.test.ts`, `packages/audio-engine/src/transport/transport.test.ts`, `packages/audio-runtime/src/playback/playback-session.test.ts` |
| Tool pointer, shown peaks | `apps/web/src/editor/tool-pointer.test.ts`, `shown-peaks.test.ts`, `view-scene.test.ts` |
| View state, lanes, frames, tools, hit testing | `packages/editor-view/src/view.test.ts`, `frame-composer.test.ts`, `pointer-tools.test.ts` |
| Reference picture | `packages/video-reference/src/video-reference.test.ts`, `apps/web/src/picture/reference-picture.test.ts` |
| Signal recipes and test assets | `packages/audio-engine/src/pcm/signal-source.test.ts`, `pcm-description.test.ts`, `apps/web/src/assets/test-assets.test.ts` |
| Editor stores and commands | `apps/web/src/state/editor-view-store.test.ts`, `apps/web/src/commands/editor-commands.test.ts`, `shell-commands.test.ts`, `apps/web/src/editor/editor-parts.test.ts` |
| Dock memory and placement | `packages/workspace/src/adapter/dock-memory.test.ts`, `dockview-adapter.test.tsx`, `panel.test.ts` |
| Layering, exports and command routes | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/timeline.spec.ts`, `renderer-loss.spec.ts`, `renderer-webgpu.spec.ts`, `renderer-reduced.spec.ts`, `touch-pen.spec.ts`, `video-reference.spec.ts`, `input.spec.ts`, `transport.spec.ts` |

## Commands used for verification

```
pnpm run lint                        # pnpm run version:check, pnpm run graph:check, pnpm run notices:check, eslint ., prettier --check .
pnpm run typecheck:full              # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json
pnpm run test                        # vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.cache/audiogubbins/vitest-report.json
pnpm run record:check                # node tools/check-record-titles.mjs
pnpm run test:dependencies           # depcruise --config .dependency-cruiser.cjs apps packages tests tools
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:e2e:timeline           # playwright test --project=chromium-timeline
pnpm run test:renderer-loss          # playwright test --project=chromium-renderer --project=chromium-renderer-webgpu --project=chromium-renderer-reduced
pnpm run test:touch-pen              # playwright test --project=chromium-touch-pen
pnpm run test:video-reference        # playwright test --project=chromium-video-reference
pnpm run test:e2e                    # playwright test
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet also names `pnpm test --filter timeline --filter waveform --filter renderer`,
which pnpm reads as workspace filters: it runs each package's own `test`
script, and each runs its Vitest project from the root.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Pass, over the tree of the final remediation commit: lint and formatting clean, both type-checks clean, 3984 tests passed in 222 files, 0 failed, every cited title resolved, no dependency violations in 757 modules. |
| `pnpm test --filter timeline --filter waveform --filter renderer` | Pass: `timeline` 59 tests in 6 files, `waveform` 34 in 3, `renderer` 29 in 4. |
| `pnpm run test:e2e:timeline`, `test:renderer-loss`, `test:touch-pen`, `test:video-reference` | Pass, within the whole Playwright run below. |
| `pnpm run test:e2e` (every project) | Pass: 948 passed, 29 skipped by their projects' own conditions (WebKit's 13 among them), 0 failed. |
| `pnpm run build` | Pass, with the build-output check. Vite warns that the main chunk is over 500 kB. |
| `pnpm run spec:verify` | Pass. |

The first whole Playwright run over the merged remediation failed twice. The
Transport panel's test found Stop returning to 0:00.092 after a pause and a
resume, a defect of F-23's first fix, which `eaa90f0` corrects (see the review
record). The video reference test read a playing picture two frames from the
audio once, with four workers loading the machine; it passed eight times of
eight on its own, and in the final whole run.

## Browser and device results

The built application was driven in Chromium through Playwright, from a
preview server of the production build, at 1,600 by 900 CSS pixels:

- The Tone bursts asset opened in an Editor panel with both channels named,
  the ruler in minutes and seconds, and the scope "The whole asset, every
  channel". A marker added at the playhead showed in the marker lane and in
  the list below.
- Zoom in went from 533 samples a pixel to 32 pixels a sample, where each
  sample is drawn as a point on its line and the ruler reads in
  microseconds.
- The light theme drew the ruler, the lane names and the marker's name
  legibly over the display.
- A WebM made in the page opened in the Picture panel at timecode
  00:00:00:00, with its frame, its start, the frame rate, the nudges, the
  alignment, a marker at the frame, full screen and "Open its sound as an
  asset" offered.
- The console showed no page error. Its warnings were Chromium's "No
  available adapters." from the WebGPU probe of a headless browser, and
  WebGL's note that reading the canvas back for a screenshot stalls the
  GPU.
- `tests/e2e/transport.spec.ts` passed, and the application's test signal
  still renders to `0xe576a76257ddb259`.

## Known limitations

- Safari and WebKit were not run for the editor: Playwright's WebKit on this
  machine has no `AudioContext`, and the browser matrix is Phase 14's.
- The razor tool places the playhead where it would split. Splitting is an
  edit, Phase 05's (`REQ-EDIT-014`).
- Regions are made only by the test asset that defines them, and markers and
  regions are held for the session: Phase 05 edits regions and Phase 02's
  project persists both (`ADR-0047`). The interface says the session is not
  saved.
- The spectrogram lane is the presentation shell: its axis, its labels and the
  spectral selection. Spectral analysis draws it in Phase 08, and the spectral
  tools come with it.
- The video's own sound is decoded only when the person asks for it, by the
  browser at 48 kHz where it can decode it at all, and plays as its own asset.
  Its memory bound assumes at most eight channels.
- The browser suite checks that playing picture stays within a frame of the
  audio, not how many seeks it took to stay there.
- Undo of the marker commands is recorded with their inverses. The Edit
  menu's undo is Phase 02's, with the project's history.

## Dependencies added, and their review

None outside the workspace. Every new package dependency is `workspace:*`.

## Migration and schema impact

The application's editor views are stored under the new schema `editorViews`
version 1, key `audiogubbins.editor-views`, each field read back on its own so
a damaged field falls back alone. The peak cache in IndexedDB is disposable:
its entries name their format version, source identity and revision, and one
that does not match is built again. Nothing in a project changes.

## Screenshots and recordings

None kept in the tree. The browser suites and the drive above are the
evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-EDIT-012` Timeline and editing | Sample-accurate viewport, playhead commands moving by one sample and one pixel, time, millisecond, sample and timecode formats (musical time is `REQ-PROD-160`, deferred), selections, markers, named regions, the loop region, zoom, scroll and a lane per channel. | `viewport.test.ts`, `zoom.test.ts`, `timecode.test.ts`, `editor-commands.test.ts`, `timeline.spec.ts` (zoom to one sample and select it). |
| `REQ-EDIT-013` Snapping | Zero crossings, markers, region and loop boundaries, the playhead, selection edges, grid divisions and picture frames, each a kind that can be switched off. Snapping to samples needs no kind: every position is a sample boundary (`ADR-0041`). | `snapping.test.ts`, `pointer-tools.test.ts`, `timeline.spec.ts`. |
| `REQ-ARCH-037` Waveform rendering direction | The peak pyramid built progressively in a worker, drawn by columns from its levels, kept in IndexedDB and built again when missing or stale. | `peaks.test.ts`, `peak-host.test.ts`, `peak-messages.test.ts`, `peak-cache-store.test.ts`. |
| `REQ-EDIT-061` Multiple views | Each Editor panel has its own zoom, scroll, display mode, tool, channel visibility, overlays and settings; the asset's content and selection are shared. | `editor-view-store.test.ts`, `editor-commands.test.ts`, `timeline.spec.ts` (two views keep their own zoom and share a marker). |
| `REQ-EDIT-062` Presentation modes | Waveform, spectrogram, stacked and overlaid modes, as layers of one frame composer. | `frame-composer.test.ts`, `view.test.ts`. |
| `REQ-EDIT-063` Explicit selection | The selection set's facets, the precedence that resolves a command's target or refuses it with the reason, the scope shown by the Editor panel, and a warning when the target reaches outside the view. | `selection.test.ts`, `editor-commands.test.ts`, `timeline.spec.ts`. |
| `REQ-EDIT-064` Selection persistence | Selections kept through tool changes, zoom, scroll and view switches, and reconciled when content changes. | `selection.test.ts`, `editor-commands.test.ts`. |
| `REQ-EDIT-065` Hybrid tools | Selection, time selection, razor, hand, zoom and marker tools; a held space bar for the hand, modifiers, long press and gestures; every tool acts through the commands. The spectral marquee, lasso and brush come with spectral editing (Phase 08) and the region tool with regions (Phase 05); the selection set already holds their targets. | `pointer-tools.test.ts`, `editor-commands.test.ts`, `touch-pen.spec.ts`. |
| `REQ-AUDIO-082` GPU acceleration | WebGPU taken where a device passes a validation draw, with WebGL2 and Canvas 2D behind it; nothing in editing needs it. | `renderer.test.ts`, `renderer-webgpu.spec.ts`, `renderer-reduced.spec.ts`. |
| `REQ-AUDIO-152` Editor rendering layer | The render frame as a value drawn by any backend, high-DPI backing stores, hit testing from state, recovery from a lost context or device, and the renderer's report in the Capabilities panel and the log. | `renderer.test.ts`, `canvas-painting.test.ts`, `renderer-loss.spec.ts`. |
| `REQ-AUDIO-156` Video reference | The Picture panel bound to the media clock, frame and timecode readouts, frame-rate interpretation, offset nudges and alignment, a marker at a frame, frame snapping, a filmstrip, full screen, an explicit notice for an undecodable file, and the video's sound as an asset. | `video-reference.test.ts`, `reference-picture.test.ts`, `video-reference.spec.ts`. |
| `REQ-PROD-160` Musical timeline (deferred) | Nothing musical is built; time formats and snap kinds are unions a musical kind can join. | `time-format.ts`, `snapping.ts`. |

## Commits

Oldest first, on `phase-04-waveform-timeline`, from `0445d2e`:

- `6199fdc` Record the decisions the editor foundation is built on
- `a56cb46` Add the timeline: exact viewport coordinates, formats, ruler, selection set and snapping
- `8b84bee` Describe generated audio as a signal recipe, which replaces the tone
- `ff6efe4` Give audio one cross-thread description, in the engine
- `fee2007` Add the waveform package: peaks made off the page, shared and kept
- `44c469d` Add the renderer: frames as values, three backends and loss recovery
- `7222331` Add video reference: picture bound exactly to the shared media clock
- `d3a6c08` Add the editor view: state, lanes, tools, hit testing and frames
- `13c6933` Record what Phase 04 has done and what is left, for whoever resumes it
- `bce05a8` Open the test assets in editor views, with their selection, markers, playback and picture
- `7fae1cb` Drive the editor in a real browser, and fix what that found
- `6c2f7d9` Keep the editor's keys and writes out of the rest of the shell's way
- `bb7b735` Keep each panel's scroll, and the keyboard, when the dock is built again
- `23e5d56` Keep the names in the marker strip and the spectrogram lane apart
- `94b51bf` Keep the strip drawing's doc comment on the function it describes
- `5a7c727` Resolve what a command acts on by the selection set's precedence
- `774bc5f` Hand the renderer its timers and read no browser global in it
- `81d0951` Report a draw a backend cannot make, and step down from it
- `37db059` Keep a text field's editing keys, and no shortcut behind a modal dialogue
- `57089ea` Paint the overlay again when the browser gives its context back
- `8960fa4` Read a zoomed view from windows sized to it, and let a still view rest
- `ceead88` Hold a zoom about a point to keep the audio under that point
- `79a24ea` Check what the editor's renderer draws, before a loss and after recovery
- `35037d7` Keep a pen's press from resting fingers, and decide a long press once
- `387f20e` Judge the reference picture by the frame it shows, not the start of it
- `d2a292a` Pause where the listener stopped hearing
- `288b3ba` Keep waveform peaks only once IndexedDB has committed them
- `8ba5535` Let each view choose its spectrogram's frequency scale and band
- `31146df` Publish from the editor's packages only what another package uses
- `9c4b277` Say a video whose picture the browser cannot decode, rather than show black
- `341d126` Follow a parked picture from the playhead, and say why a picture action waits
- `727fc09` Select time and move markers from the keyboard
- `d30e1ac` Extract a picture's sound only when asked, and only within the page's memory
- `7f0f80d` Write the editor's labels in colours taken from the display they are on
- `9c7c078` Put back comments that were rewrapped without being changed
- `81403de` Give the reference picture its own part of the editor's composition
- `22f22ee` Let the appearance shortcuts run in a modal dialogue
- `7ffaa2a` Name each channel button by its channel alone
- `a7ac7da` Say what the editor's keys changed, and where its waveform has got to
- `fcc9aea` Give the keyboard back to the control it was on when the dock is rebuilt
- `9ff1b5a` Offer from video reference only what another package takes
- `eaa90f0` Keep Stop's return point when a pause moves back to the frame heard

The merge commits between them join the remediation's branches. The commit
that records this package, the review and the handoff follows, and the
integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-04-review.md` records the seven lenses, their thirty-seven
findings, and the disposition of each with its commit. All eight `HIGH`
findings and all seventeen `MEDIUM` findings are fixed, as are the eleven
`LOW` findings and the `NOTE`. What the phase leaves to later phases is
accepted with tracking in the handoff capsule: Safari and WebKit (Phase 14),
the picture sound's eight-channel memory bound (Phase 09) and the count of
seeks a playing picture takes (Phase 14).
