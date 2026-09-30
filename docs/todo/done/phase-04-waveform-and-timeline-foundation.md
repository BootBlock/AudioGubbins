> **Status:** Done. 2026-09-30: every slice is built, and the one review pass
> of the seven lenses found thirty-seven findings, eight of them high, every
> one fixed or accepted with tracking and written into
> `docs/spec/reviews/phase-04-review.md`. Phase 04 is closed at `PASS` in the
> ledger, and its handoff capsule is
> `docs/spec/traceability/handoffs/phase-04.md`. The progress table and the
> list of what was left are those of the time they were written.

# Phase 04 — Waveform and Timeline Foundation

Resume note. It says where the work is and what is left. The packet is
`docs/spec/phases/phase-04-waveform-and-timeline-foundation.md`, and the
decisions that shape the work are `ADR-0040` to `ADR-0047`.

## Where the work is

|        |                                                                   |
| ------ | ----------------------------------------------------------------- |
| Branch | `phase-04-waveform-timeline`                                      |
| Shared | Phase 02 takes `ADR-0020` to `ADR-0029`, Phase 04 from `ADR-0040` |

Phase 02 is not yet on `main`. Its branch also changes
`packages/capabilities`, `tools/sync-workspace-graph.mjs`,
`tests/architecture/public-contracts.txt`, the ledger and the root scripts;
whichever lands second merges `main` in and runs `verify:commit` first.

## Gates

Light gates (owner decision, 2026-09-28): whole Vitest, both tsc, lint
(`pnpm run verify:commit`), one review pass with every lens the packet names,
fix its findings, land. The packet's commands are root scripts:
`test:e2e:timeline`, `test:renderer-loss`, `test:touch-pen` and
`test:video-reference`.

## Slices

1. Decisions: `ADR-0040` topology, `ADR-0041` coordinates, `ADR-0042`
   selection set, `ADR-0043` peak pyramid, `ADR-0044` renderer backends,
   `ADR-0045` signal recipes, `ADR-0046` video binding, `ADR-0047` session
   markers.
2. `packages/timeline`: zoom, viewport, formats, ruler, selection set,
   snapping (WU-04.A). The domain's selection is removed.
3. Signal recipes in `packages/audio-engine` and `packages/audio-runtime`.
4. `packages/waveform`: pyramid, builder, codec, query, zero crossings,
   worker, host (WU-04.B).
5. `packages/renderer` and the graphics platform in `packages/capabilities`
   (WU-04.C).
6. `packages/editor-view`: view state, layout, tools, hit testing, frame
   composition (WU-04.D).
7. `packages/video-reference` and the picture panel (WU-04.E).
8. The application: test assets, editor panel, stores, commands, shortcuts,
   peak cache, playback of an asset, picture panel.
9. Browser suites, evidence, one review pass, its fixes, the ledger, the
   handoff and the landing.

## Progress

Committed on the branch, each with `verify:commit` green:

| Commit    | What                                                                  |
| --------- | --------------------------------------------------------------------- |
| `6199fdc` | decisions `ADR-0040` to `ADR-0047`                                    |
| `a56cb46` | `packages/timeline`; the domain's unused selection removed            |
| `8b84bee` | signal recipes; the tone description and tone source removed          |
| `ff6efe4` | the engine's `PcmDescription`, shared by runtime and peak worker      |
| `fee2007` | `packages/waveform`: pyramid, builder, codec, worker, host            |
| `44c469d` | `packages/renderer`: frame value, WebGPU, WebGL2, Canvas 2D, recovery |
| `7222331` | `packages/video-reference`: clock binding and sync policy             |
| `d3a6c08` | `packages/editor-view`: state, lanes, tools, hit testing, frames      |

## Left to do

### 8. The application (`apps/web`, the packet's "editor surface")

Wire each package in and prune its entry in
`tests/architecture/package-exports.test.ts` (`OFFERED`) as its exports gain
production consumers.

1. `packages/capabilities`: a graphics-platform reader handing the renderer
   `navigator.gpu` (as `unknown`; the renderer's `isGpu` checks it) and the
   pixel ratio with a watch on its changes; probes and a feature requirement
   for the frame callback (`requestVideoFrameCallback`) and full screen.
2. Deterministic test assets as signal recipes in a production module: a
   short stereo set of tone bursts, a 5.1 channel identification, a
   first-order ambisonic set, a three-hour stereo session for scale, and a
   loop test that carries markers and a looped region (ADR-0047).
3. Session content per asset (ADR-0047): markers and regions held in memory,
   marker add, move and remove as commands with inverses; the interface says
   the session is not saved until Phase 02's project holds it.
4. A selection store per asset and the selection commands the tools' intents
   and the keyboard run: set a time range with a channel scope, select a
   marker, clear, select all, and extend by one sample. Reconcile on content
   change (`reconciled`). Show the active scope with `describeTarget` and a
   warning with `targetOutside` (REQ-EDIT-063, REQ-EDIT-064).
5. An editor-view store keyed by the editor panel's id, persisted under a new
   schema `editorViews` 1 in `version.json` (`pnpm version:sync`), read field
   by field; the Editor panel (`allowsMultiple`) opens a test asset.
6. The peak host: the worker from
   `@audiogubbins/waveform/threads/peak-worker.ts?worker&url` (declare it in
   `apps/web/src/audio/bundled-modules.d.ts`), a `PeakCacheStore` over
   IndexedDB in `apps/web/src/io/`, and peak events logged to diagnostics.
7. The editor panel: two stacked canvases (geometry and overlay) as the
   renderer's surface, a new geometry canvas on each `freshCanvas`, the
   renderer from `browserBackends(gpu)`, the frame loop recomposing on
   change and while playing, pointer events read through
   `sampleFromPointerEvent` into `press`, `move` and `release`, a held space
   bar, a long press opening `ContextActions` (Phase 01 debt F-188), a
   scrollbar, a toolbar (tools, display mode, zoom, snapping, time format,
   channels), the selection scope readout, and the renderer report shown in
   the Capabilities panel and logged.
8. Commands and default shortcuts: zoom in, out, to fit and to selection;
   each tool; move the playhead by one sample and one pixel; scroll; the
   display modes; snapping; channel visibility; the marker commands.
9. Playback of the focused asset: `PlaybackControl` plays the asset's recipe
   rather than the test tone alone, seeks where the playhead is set, and the
   views draw `audiblePosition` and follow it. The Transport panel writes
   positions with the timeline's `formatPosition`, replacing `positionText`.
10. The picture panel: a file input, an `HTMLVideoElement` following the
    binding with `pictureCorrection` each display frame (frame callback where
    offered), timecode and frame readouts, the frame-rate interpretation,
    offset nudges and "align this frame with the playhead", full screen, an
    explicit notice for an undecodable file, a marker at the current frame,
    filmstrip thumbnails in the picture strip, and the video's own sound
    decoded as an asset where the browser can.

### 9. Browser suites, review and landing

1. Root scripts and Playwright projects: `test:e2e:timeline` (zoom to single
   samples and select one, snapping, two views of one asset keeping their own
   zoom while sharing a marker added in one), `test:renderer-loss`
   (`WEBGL_lose_context`; WebGPU `getConfiguration().device.destroy()`; a
   project launched with `--disable-webgl` for the reduced renderer),
   `test:touch-pen` (pinch zoom, two-finger pan, pen selection, long press),
   `test:video-reference` (a WebM made in the page with `MediaRecorder`, sync
   within one frame while playing, exact while parked, an undecodable file).
   Run `tests/e2e/transport.spec.ts` once: the render fingerprint
   `0xe576a76257ddb259` must be unchanged by the signal recipe.
2. Check `pnpm test --filter timeline --filter waveform --filter renderer`
   runs those suites, as the packet writes it.
3. The evidence package `docs/spec/reviews/phase-04-evidence.md`, one review
   pass with the packet's seven lenses, fixes, `phase-04-review.md`, the
   ledger (`PASS`, commits, evidence), the handoff capsule
   `docs/spec/traceability/handoffs/phase-04.md` (carrying Phase 01's
   Phase 04 debt: F-304, F-560, F-188, F-281, F-218, F-275, F-283), the
   spec rebuild and checksums, this note moved to `docs/todo/done/`.
4. Merge `main` in (Phase 02 may have landed: its `CacheStore` has a
   waveform category, and ADR-0047's markers move into its project), run
   `verify:commit`, merge to `main`, push, and remove the worktree.

## Notes for what follows

- Comments are held to an 80-column fill by `tests/comment-width.test.ts`.
- The peak worker uses the reference DSP. The page never builds peaks, which
  `peak-messages.test.ts` holds by the host's import graph.
- A spectrogram lane is the packet's presentation shell: its axis, the
  spectral selection and a note that spectral analysis draws it (Phase 08).
- The razor tool resolves a split position; splitting is Phase 05's.
