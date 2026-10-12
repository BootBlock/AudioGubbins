# Phase 08 — Spectral Editing — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the phase branch at the commit the run names, after
the scope check's fixes. The in-depth review lenses are deferred to the review
after the whole specification is implemented, as `reviews/phase-08-review.md`
records.

## Phase identifier and objective

- **Phase:** 08 — Spectral Editing.
- **Objective:** interactive spectral analysis and non-destructive spectral
  editing and repair: the spectrogram as a pyramid of disposable tiles,
  analysed in a worker from the edited sound by the canonical STFT, which
  gains the Blackman–Harris window (`ADR-0080`); a spectral selection as a
  mask of rectangles, polygons and brush strokes, and a spectral edit as a
  range edit that adds a masked change to its input, so every sample no
  changed frame reaches is unchanged (`ADR-0081`); and a renderer that draws
  scalar fields through a colour ramp on every backend, with spectral tools
  that make a mask (`ADR-0082`).
- **User-visible outcome:** the person sees the spectrogram of what they
  hear, at any zoom, on WebGPU, WebGL2 or Canvas 2D, the old revision drawn
  dimmed until the edited sound's tiles replace it; chooses its window,
  length, overlap, display range and colours; selects an area with the
  spectral marquee, the lasso or the brush, by mouse, pen or touch, with a
  pen's pressure or a fixed strength they set and keep, adding to it or
  taking from it with a modifier or the view's combination mode, or builds it
  from the keyboard and hears it described in words; attenuates, removes,
  isolates or heals it, or cleans it up through a restoration or model
  processor, told first where the model cannot run; compares the result with
  the state before it and hears the original; finds each edit in the Spectral
  panel and the Inspector; and undoes, redoes and finds every spectral edit
  after a reload.

## Checklist

Every box in the packet's **In Scope** list:

- Spectrogram analysis and tile cache: `SpectrogramConfig`
  (`packages/spectral-analysis/src/spectrogram-config.ts`), the tile pyramid
  (`tile-geometry.ts`), quantised levels (`level-quantisation.ts`), tile
  building (`tile-analysis.ts`, `tile-wants.ts`), the worker and its protocol
  (`spectrogram-worker-core.ts`, `spectrogram-messages.ts`,
  `spectrogram-message-reading.ts`, `threads/spectrogram-worker.ts`), the
  host and its memory budget (`spectrogram-host.ts`, `spectrogram-job.ts`,
  `tile-memory.ts`, `spectrogram-ports.ts`), and the disposable cache under
  `CacheCategory.Spectrogram` in the checked tile format (`tile-codec.ts`;
  `apps/web/src/io/stored-spectrogram-cache.ts`), its writes dated, bounded
  and cancellable. The worker is started by
  `apps/web/src/editor/spectrogram-threads.ts`.
- The Blackman–Harris window in the canonical STFT of `crates/analysis`
  (`crates/analysis/src/stft.rs`, `crates/wasm-bindings/src/analysis.rs`) and
  its reference (`packages/audio-engine/src/dsp/reference/analysis/stft.ts`),
  `StftWindow` in the engine's port (`dsp/analysis-settings.ts`,
  `canonical-analysis.ts`), raising the DSP ABI from 6 to 7
  (`crates/wasm-bindings/src/lib.rs`). The DSP delivery moved into the engine
  (`packages/audio-engine/src/dsp/dsp-delivery.ts`), so one compiled module
  per page serves the engine and the spectrogram worker
  (`apps/web/src/audio/page-dsp.ts`, `dsp-compiling.ts`).
- Frequency and time coordinates: columns placed by the exact conversions of
  `ADR-0041` (`packages/editor-view/src/spectrogram-drawing.ts`), and the
  exact inverse of the lane's frequency mapping, `frequencyAt`
  (`packages/editor-view/src/frequency-axis.ts`); a bin's centre frequency
  stated once, `binFrequency` and `nearestBin`
  (`packages/domain/src/spectral/bin-frequency.ts`).
- Spectral selections: the domain's `SpectralMask` of rectangles, polygons and
  strokes, each adding or subtracting, with a feather
  (`packages/domain/src/spectral/spectral-mask.ts`), its weight
  (`mask-weight.ts`), clipping (`mask-clipping.ts`), validation
  (`mask-validation.ts`) and reading back from a thread (`mask-decoding.ts`);
  the selection set's spectral facet is that mask, joined by
  `withSpectralShape` and compared by value
  (`packages/timeline/src/selection-set.ts`, `selection-target.ts`).
- Marquee, lasso and brush, with pressure optional and a persisted fixed
  strength, and keyboard commands for spectral selection:
  `packages/editor-view/src/spectral-tools.ts`, `pointer-tools.ts`,
  `tool-values.ts`, `spectral-steps.ts`; the pressure preference
  (`packages/input/src/pressure-preference.ts`), kept with the preferences
  (`apps/web/src/state/preferences-store.ts`), set by `tools.*` commands
  (`apps/web/src/commands/pressure-commands.ts`) and controlled in Settings
  and the Spectral panel (`apps/web/src/shell/pressure-controls.tsx`); the
  spectral selection's commands, with replacing, adding and subtracting band
  forms, steps in time and in frequency, clearing and a description in words
  (`apps/web/src/commands/spectral-selection-commands.ts`,
  `spectral-words.ts`), and the tools' settings and combination mode
  (`spectral-tool-commands.ts`), with default shortcuts
  (`apps/web/src/state/default-shortcuts.ts`); and a lasso's polygon, a
  brush's stroke and a marquee's rectangle drawn from the keyboard with a
  cursor in a channel's spectrogram lane, made by the tools' own trail and
  shape code (`packages/editor-view/src/keyboard-drawing.ts`;
  `apps/web/src/commands/spectral-drawing-commands.ts`,
  `apps/web/src/editor/drawing-context.ts`), so the keyboard reaches every
  spectral selection a pointer makes.
- Attenuate, remove, isolate and heal, and repair through a cleanup or model
  chain, as the spectral edit: `SpectralEdit` and `SpectralEditOperation`
  (`packages/domain/src/spectral/spectral-edit.ts`), validated by
  `spectralEditProblem` and placed by `spectralPlacement`; made by the
  `spectral.*` commands (`apps/web/src/commands/spectral-edit-commands.ts`);
  `remove` is `attenuate` by 0.
- Selection-sensitive spectral processing: the spectral edit in the plan, as a
  stream with `spectral` processing (`packages/domain/src/editing/plan.ts`,
  `plan-building.ts`, `processed-streams.ts`, `range-stages.ts`); the
  engine's realisation, read in order through one window
  (`packages/audio-engine/src/pcm/spectral-content.ts`,
  `spectral/spectral-frames.ts`, `forward-window.ts`, `spectral-change.ts`,
  `heal-borders.ts`); and its persisted form
  (`packages/project-format/src/spectral-reading.ts`, `spectral-writing.ts`,
  `edit-reading.ts`, `edit-writing.ts`, `plan-reading.ts`,
  `plan-writing.ts`), described by `packages/project-commands`
  (`edit-descriptions.ts`) and the chain it names (`chain-naming.ts`,
  `rack-commands.ts`).
- GPU-accelerated display with fallbacks: `FieldBatch`, `ScalarField` and
  `ColourRamp` (`packages/renderer/src/render-frame.ts`), drawn by WebGPU
  (`webgpu-fields.ts`, `webgpu-device.ts`), WebGL2 (`webgl2-fields.ts`,
  `webgl2-context.ts`) and Canvas 2D (`canvas-fields.ts`), with one rule for
  the pixels a field paints (`field-pixels.ts`) and a texture cache within a
  memory budget (`field-textures.ts`).
- Integration with cleanup and ML processors: the `process` operation, whose
  chain runs inside the spectral stream's frames, entering and leaving the
  project with the edit; the domain's `streamChain` is the one account of a
  stream's chain (`packages/domain/src/editing/operations.ts`), read by the
  model gate (`apps/web/src/assets/model-gate.ts`), the plan readers and the
  running changes; a model that cannot run is refused before applying unless
  asked knowingly, and said after applying
  (`apps/web/src/shell/spectral/spectral-operations.tsx`,
  `apps/web/src/shell/inspector/edit-words.ts`).
- Spectral cache invalidation: tiles keyed by the edited sound's revision
  (`SpectralTileKey`; `apps/web/src/editor/edited-revision.ts`), one revision
  of a source kept in the cache, and the old revision drawn dimmed until
  replaced (`ShownTile.stale`, `spectrogram-drawing.ts`).
- Preview and A/B: a spectral edit compared with the state before it, the
  latest or one named (`apps/web/src/commands/spectral-comparison-commands.ts`),
  and the original heard with spectral edits bypassed with the chains
  (`bypassedAssetPlan` in `packages/domain/src/editing/plan-building.ts`,
  read by `apps/web/src/assets/project-assets.ts` and
  `rack-hearing-commands.ts`).
- Spectral views: the spectrogram layer
  (`packages/editor-view/src/spectrogram-drawing.ts`,
  `apps/web/src/editor/view-spectrogram.ts`), the mask's overlay
  (`mask-drawing.ts`, `overlay-drawing.ts`), spectral edit outlines
  (`apps/web/src/editor/spectral-edit-outlines.ts`), the Spectral panel
  (`apps/web/src/shell/spectral/`), the Inspector's spectral edit
  (`apps/web/src/shell/inspector/inspector-panel.tsx`, `edit-words.ts`), the
  display settings (`apps/web/src/commands/spectrogram-commands.ts`,
  `spectrogram-section.tsx`), the alert that says why a spectrogram is not
  drawn (`apps/web/src/shell/spectrogram-note.tsx`), the spectrogram worker's
  DSP in the Capabilities panel (`spectrogram-dsp-reading.tsx`), and the
  Spectral Repair preset (`packages/workspace/src/presets.ts`); each invokes
  only commands.

Work units: WU-08.A to WU-08.D as the packet defines them.

## Inherited debt

| Debt | Fix |
| --- | --- |
| The spectrogram lane is a shell (Phase 04 handoff) | `ce1c270d`: `packages/spectral-analysis`; `fdaa0f5c`: the lane drawn from the worker's tiles in every editor view. |
| Spectral painting and spectral selection editing, reading `crates/analysis` and the ML processors (Phase 06 handoff) | `8b48c2fc`: the STFT's window; `6ada82e7`: the marquee, lasso and brush; `9445b57c`, `0dab56be`: the spectral edit realised and made by commands, through a cleanup or model chain. |
| Persisting the gesture settings and a control for fixed strength (`ADR-0017`, Phase 01) | `303077f9`: kept with the preferences (`userPreferences` 2); `51dea6db`: the commands; `156742a4`: the control in Settings; `1c151123`: in the Spectral panel. |
| The selection set's reconciliation clipped no lasso point, and its equality compared a spectral shape by reference (Phase 04, found by the readiness review) | `1714422f`: the facet is the domain's mask, clipped shape by shape by `clippedMask` and compared by `masksEqual`. |
| The packet's verification named `cargo test -p analysis` and scripts that did not exist (found by the readiness review) | `d957834e` corrected the names; `fecde8c8` added `pnpm test:spectral-golden`; `dd6c2409` adds `pnpm test:e2e:spectral`. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/spectral-analysis` | New and portable. `SpectrogramConfig`, `SpectralTileKey`, the tile pyramid's geometry, quantised levels, tile building, the tile codec, the worker's protocol, core and thread entry, and the host with its memory budget and cache port. |
| `crates/analysis`, `crates/wasm-bindings` | The Blackman–Harris window in the canonical STFT, its code across the boundary, and the ABI raised to 7. |
| `packages/audio-engine` | `StftWindow` in the canonical analysis and its reference; the DSP delivery, moved from the audio runtime; the spectral edit's realisation (`spectral-content.ts`, `spectral/`); the spectral golden fixtures; `CachePurpose.Spectrogram`. |
| `packages/audio-runtime` | Reads the DSP delivery from the engine; its messages and tests follow the move. |
| `packages/domain` | `SpectralMask`, its shapes, weight, clipping, validation and decoding; `SpectralEdit`, `SpectralEditOperation`, `spectralPlacement`, `HEAL_BORDER_FRAMES`; the plan's `spectral` processing; `editChain`, `streamChain`, `takesChannelScope`; `binFrequency`, `nearestBin`. |
| `packages/project-format` | The spectral edit and its mask in an asset's chain, a region's processing and a paste's plan; `projectDocument` 8; the random spectral states. |
| `packages/project-commands` | The spectral edit's description, the chain it names in the rack commands, the channel scope kept by a target's invocation, and the command walk's punch. |
| `packages/timeline` | The spectral facet as the domain's mask; `withSpectralMask`, `withSpectralShape`, `SpectralCombination`. |
| `packages/renderer` | The field batch on WebGPU, WebGL2 and Canvas 2D, the shared pixel rule and the texture budget. |
| `packages/editor-view` | The spectrogram layer, the mask's overlay, spectral edit outlines, the frequency axis and its inverse, the spectral tools and steps, the spectrogram's display settings and the tools' settings in the view state. |
| `packages/input` | The pressure preference: whether pen pressure is used, and the fixed strength. |
| `packages/workspace` | The Spectral panel kind, in front in the Spectral Repair preset. |
| `packages/storage` | Only its pack-pins test, which now holds a chain inside a spectral edit. |
| `packages/commands` | `Command.takesItsKeyOnlyWhenAvailable`, so a drawing key passes through to the page while its command cannot run. |
| `packages/version` | `projectDocument` 8, `userPreferences` 2, `editorViews` 2. |
| `apps/web` | The spectral workspace: the page's DSP, the spectrogram worker's start and reports, the stored tile cache, the spectral selection, tool, edit, comparison, spectrogram and pressure commands, the Spectral panel, the Inspector's spectral edit, the pen and touch settings, the spectrogram's alert, the editor views' spectrogram and tool settings (`editorViews` 2) and the default shortcuts. |
| `tests/` | The architecture rules for the new package and the domain entry's recorded review; the renderer's field harness and its browser tests (`tests/e2e/renderer-harness/`, `renderer-field.ts`); the earlier suites' settled failures; the spectral editing browser suite (`tests/e2e/spectral.spec.ts`, project `chromium-spectral`). |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| SpectralTileKey | `SpectralTileKey` in `@audiogubbins/spectral-analysis`: identity, revision, channel, config, level and index; `tileKeyText` names it. |
| SpectralSelection | The selection set's spectral facet, `SelectionSet.spectral`, a `SpectralMask`, in `@audiogubbins/timeline`, joined by `withSpectralShape` with a `SpectralCombination`, and a `SelectionTarget` of kind `spectral` carrying the mask and its channels. It replaces `SpectralArea` and `withSpectralArea`. |
| SpectralMask | `SpectralMask`, `SpectralShape` (rectangle, polygon, stroke), `MaskEffect`, `SpectralFeather`, `StrokePoint`, `BrushRadius`, `MaskWeights`, `maskSupport`, `maskOutline`, `masksEqual`, `clippedMask`, `maskProblem`, `spectralMaskOf` in `@audiogubbins/domain`. |
| SpectralEditOperation and the spectral edit | `SpectralEditOperation` (`attenuate`, `isolate`, `heal`, `process`) and `SpectralEdit`, a `RangeEdit` of kind `spectral`, with `spectralEditProblem`, `spectralPlacement`, `SpectralPlacement` and the plan's `PlannedSpectralEdit`, in `@audiogubbins/domain`. |
| SpectrogramConfig | `SpectrogramConfig`, `DEFAULT_SPECTROGRAM_CONFIG` and `spectrogramConfig` in `@audiogubbins/spectral-analysis`. |
| The field batch | `FieldBatch`, `ScalarField` and `ColourRamp` in `@audiogubbins/renderer`, a `RenderBatch`; `browserBackends` takes the off-screen canvas Canvas 2D composes on. |
| The spectrogram worker's protocol and host | `ToSpectrogramWorker`, `SpectrogramEvent`, `SpectrogramWorkerPort`, `SpectrogramHost`, `SpectrogramHandle`, `SpectrogramSubject`, `SpectrogramView` and `SpectralTileCache` in `@audiogubbins/spectral-analysis`, its thread entry `./threads/*`, and the local worker and memory cache in `./testing`. |
| The STFT's window | `StftWindow` (`hann`, `blackman-harris`) and `StftSettings.window` in `@audiogubbins/audio-engine`; the window's code in `crates/analysis`. |

Beside them: `DspDelivery`, `deliveredDsp` and `ScopeDsp` moved from
`@audiogubbins/audio-runtime` to `@audiogubbins/audio-engine`; the spectral
tools, `ToolInput.strength`, the spectrogram layer's view state and the
outlines in `@audiogubbins/editor-view`; `PressurePreference` in
`@audiogubbins/input`; `PanelKinds.Spectral` in `@audiogubbins/workspace`;
the raised `SCHEMA_VERSIONS` in `@audiogubbins/version`; the keyboard's
drawing (`KeyboardDrawing`, `DrawingContext`, `drawingShape`) and
`tracesPath` in `@audiogubbins/editor-view`; and
`Command.takesItsKeyOnlyWhenAvailable` in `@audiogubbins/commands`.

## ADRs created and changed

`ADR-0080`, `ADR-0081` and `ADR-0082` were written by the phase's readiness
review, in `d957834e`, the phase branch's first commit; this phase implements
them. They amend `ADR-0017`, `ADR-0031`, `ADR-0032`, `ADR-0040`, `ADR-0042`,
`ADR-0044`, `ADR-0051` and `ADR-0060`, each of which carries an **Amended by**
line. The build amended these records:

- `ADR-0081` — 2026-10-10, in the build (`d4251292`), by a dated line: a gain
  of `attenuate` and `isolate` is a linear factor from 0 to just below 1, so
  `remove` is a command, not an operation; a stroke is softened by its own
  hardness, and the feather softens rectangles and polygons only and is none
  or both components above 0.
- `ADR-0081` — 2026-10-10, in the scope check (`ed56934d`), by a dated line:
  a command's range is the mask's support; a heal's range is widened by four
  border frames each side at the hop of the fewest spectral overlap, and a
  frame reaching outside the stream borders nothing; a `process` edit's chain
  runs within the spectral stream.
- `ADR-0082` — 2026-10-10, in the scope check (`80343f2c`), its spectral
  tools clause rewritten in place: a tool's input carries the pointer's
  height, from which `frequencyAt` derives the frequency; the view's
  combination mode joins a shape drawn with no modifier; and the keyboard's
  band commands, with default shortcuts, build every mask of rectangles.
- `ADR-0082` — 2026-10-10, in the scope check (`e85a5b72`), by a dated line
  recording that amendment and adding that the keyboard draws a lasso's
  polygon, a brush's stroke and a marquee's rectangle with a cursor in the
  lane, so it reaches every spectral selection a pointer makes.

`ADR-0080` stands as written. The dependency cruise
(`.dependency-cruiser.cjs`, the rule `spectral-analysis-owns-nothing-else`)
and `tests/architecture/dependency-rules.test.ts` hold the package rules these
records state.

## Decisions taken beyond the ADRs

The build plan (`docs/todo/phase-08-spectral-editing.md`) settles what the
ADRs left to the implementation:

1. Gains are linear factors: as a level edit's gain is, `attenuate` and
   `isolate` keep a factor from 0 to just below 1, converted from the
   person's decibels by the engine's canonical conversion where they are
   typed; `attenuate` at 0 is removal (`ADR-0081` amended).
2. Strokes soften by their own hardness; the mask's feather softens
   rectangles and polygons only, and is none or both components above
   nothing (`ADR-0081` amended).
3. A spectral edit's `process` chain runs inside the spectral stream, through
   the frames' own window, rather than as a plan stream of its own, so the
   stream's segments are read once. A parameter changed while it plays is
   heard once the plan is read again.
4. `editChain` is the one account of which edits name a chain, and
   `streamChain` of the chain a stream runs; the rack commands treat a
   spectral `process` edit's chain as a rack edit's.
5. Spectral edits are bypassed with the chains in `bypassedAssetPlan`, for
   A/B.
6. The timeline's facet is the domain's `SpectralMask`; `withSpectralShape`
   joins a tool's shape by replacing, adding (Shift) or subtracting (Alt), and
   otherwise as the view's combination mode says.
7. The DSP delivery belongs to the engine, so `packages/spectral-analysis`
   takes it without depending on `audio-runtime`; one compiled module per page
   serves the engine and the spectrogram worker.
8. Brush radius, hardness, softness and the combination mode are each editor
   view's, as its tool is, in `EditorViewState.spectralTools`; the
   spectrogram's settings and display range are the view's too. Both are in
   `editorViews` 2.
9. The domain's entry is past the cohesion threshold by review: every name has
   a consumer, and its record beside the rule
   (`REVIEWED_PAST_THRESHOLD` in `tests/architecture/dependency-rules.test.ts`)
   is held to a size.
10. The spectrogram cache's writes are stamped by the job's opening, read from
    an injected clock, and a source's waiting writes are bounded at 32.
11. The schema versions below.

## Tests

Test declarations added per package, counted from the diff of every
`*.test.ts`, `*.test.tsx` and `*.spec.ts` file from `1c357d0e` (an `it.each`
counts once; a declaration renamed or generalised counts as one removed and
one added):

| Package | New test files | Changed test files | Declarations added | Removed |
| --- | --- | --- | --- | --- |
| `apps/web` | 14 | 23 | 125 | 0 |
| `packages/editor-view` | 7 | 2 | 92 | 1 |
| `packages/spectral-analysis` | 6 | 0 | 54 | 0 |
| `packages/renderer` | 4 | 3 | 39 | 0 |
| `packages/domain` | 4 | 2 | 30 | 0 |
| `packages/audio-engine` | 3 | 7 | 22 | 1 |
| `packages/input` | 1 | 0 | 9 | 0 |
| `packages/project-format` | 1 | 3 | 6 | 0 |
| `packages/timeline` | 0 | 1 | 4 | 1 |
| `packages/storage` | 1 | 1 | 3 | 1 |
| `packages/project-commands` | 0 | 2 | 2 | 0 |
| `packages/effect-rack` | 1 | 0 | 1 | 0 |
| `packages/workspace` | 0 | 1 | 1 | 0 |
| `packages/audio-runtime` | 0 | 14 | 0 | 0 |
| `tests/architecture`, `tests/browser-suite-servers.test.ts` | 0 | 6 | 3 | 1 |
| `tests/e2e` | 1 | 6 | 16 | 0 |
| **Total** | **43** | **71** | **407** | **5** |

The five removed declarations are renamed, generalised or rewritten, none
dropped: the golden STFT test became one per window, the pack-pins test one
per place a chain runs, the timeline's facet clearing and the frame
composer's axis test lost what moved elsewhere, and the cohesion rule's band
review keeps its title beside a test of its own for a file past the
threshold (`898298c8`). `crates/analysis` adds three Rust tests
(`reads_window_codes`, `weights_by_the_four_term_blackman_harris_window`,
`keeps_a_sine_within_four_bins_through_blackman_harris`) and pins
`GOLDEN_STFT_BLACKMAN_HARRIS`.

| Area | Where |
| --- | --- |
| The STFT's window | `crates/analysis/src/stft.rs`; `packages/audio-engine/src/dsp/canonical-analysis*.test.ts`, `canonical-fft.golden.test.ts`, `canonical-stft.spectral-golden.test.ts`, `wasm/dsp-exports.test.ts` |
| The mask and the spectral edit | `packages/domain/src/spectral/spectral-mask.test.ts`, `mask-weight.test.ts`, `bin-frequency.test.ts`; `editing/spectral-edit-property.test.ts`, `plan-decoding.test.ts`; `project/project.test.ts` |
| The engine's realisation | `packages/audio-engine/src/pcm/spectral-content.test.ts`, `running-changes.test.ts`; `spectral/spectral-edit.spectral-golden.test.ts`; `packages/effect-rack/src/spectral-process.spectral-golden.test.ts` |
| Tiles, the worker and the host | `packages/spectral-analysis/src/spectral-geometry.test.ts`, `tile-analysis.test.ts`, `tile-codec.test.ts`, `spectrogram-messages.test.ts`, `spectrogram-host.test.ts`, `spectral-tile.spectral-golden.test.ts` |
| Persisted form and branching history | `packages/project-format/src/spectral-edit.roundtrip.test.ts`, `edit-json.test.ts`, `project-json.test.ts`, `project-tree.test.ts`; `packages/storage/src/spectral-history.roundtrip.test.ts` |
| Project commands | `packages/project-commands/src/editing/target-invocations.test.ts`, `processing/rack-commands.test.ts`, `project-commands.test.ts` (the random command walk); `packages/storage/src/pack-pins.test.ts` |
| The selection facet | `packages/timeline/src/selection.test.ts` |
| The field batch | `packages/renderer/src/field-pixels.test.ts`, `field-textures.test.ts`, `canvas-fields.test.ts`, `canvas2d-backend.test.ts`, `webgl2-backend.test.ts`, `webgpu-backend.test.ts`, `renderer.test.ts` |
| The editor view | `packages/editor-view/src/frequency-axis.test.ts`, `spectral-tools.test.ts`, `spectral-steps.test.ts`, `spectrogram-drawing.test.ts`, `mask-drawing.test.ts`, `overlay-drawing.test.ts`, `frame-composer.test.ts`, `pointer-tools.test.ts`, `keyboard-drawing.test.ts` |
| Pressure | `packages/input/src/pressure-preference.test.ts`; `apps/web/src/commands/pressure-commands.test.ts`, `state/preferences-store.test.ts`, `shell/settings/pen-and-touch.test.tsx` |
| The preset | `packages/workspace/src/presets.test.ts` |
| Application commands | `apps/web/src/commands/spectral-edit-commands.test.ts`, `spectral-selection-commands.test.ts`, `spectral-tool-commands.test.ts`, `spectral-drawing-commands.test.ts`, `edit-commands.test.ts`, `shell-commands.test.ts`, `editor-commands.test.ts` |
| Application views and state | `apps/web/src/editor/view-spectrogram.test.ts`, `spectral-edit-outlines.test.ts`, `spectrogram-reports.test.ts`, `tool-pointer.test.ts`, `view-scene.test.ts`; `apps/web/src/io/stored-spectrogram-cache.test.ts`; `apps/web/src/shell/spectral/spectral-panel.test.tsx`, `inspector/edit-words.test.ts`, `inspector/inspector-panel.test.tsx`, `spectrogram-note.test.tsx`, `editor-panel.test.tsx`, `editor-toolbar.test.tsx`, `menus.test.ts`, `panels.test.tsx`, `rack/rack-panel.test.tsx`; `apps/web/src/input/use-shortcuts.test.ts`; `apps/web/src/state/editor-view-store.test.ts` |
| Layering, exports and scopes | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/renderer-loss.spec.ts`, `renderer-reduced.spec.ts`, `renderer-webgpu.spec.ts` (the field batch and the spectrogram); `touch-pen.spec.ts`, `timeline.spec.ts`, `projects.spec.ts` (settled); `spectral.spec.ts` (spectral editing) |

## Commands used for verification

```
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
cargo test -p audiogubbins-analysis
pnpm run test:spectral-golden        # vitest run spectral-golden
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:editing-property       # vitest run --project domain --project project-commands edit-property project-commands.test
pnpm run test:architecture           # pnpm run test:dependencies, then vitest run --project architecture
pnpm run test:renderer-loss          # playwright test --project=chromium-renderer --project=chromium-renderer-webgpu --project=chromium-renderer-reduced
pnpm run test:touch-pen              # playwright test --project=chromium-touch-pen
pnpm run test:e2e:spectral           # playwright test --project=chromium-spectral
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet's package filter,
`pnpm --filter @audiogubbins/spectral-analysis --filter @audiogubbins/domain --filter @audiogubbins/audio-engine --filter @audiogubbins/renderer --filter @audiogubbins/editor-view --filter @audiogubbins/timeline test`,
is not a script of the manifest, so it stands outside the list.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit`, at `898298c8` | Passed, exit 0: lint (the version, graph and notices checks, ESLint and Prettier), both type checks, 737 test files and 11,650 tests, the record check (every one of 2,024 cited titles a test's title), and no dependency violations (2,470 modules, 14,690 dependencies). |
| `pnpm run verify:commit`, at `b64ec9e9` | Failed in the record check alone: all 11,649 tests passed, but finding F-530 cited the cohesion rule's band review by a title the phase had changed (B-12 in the review record). `898298c8` restores the title. |
| The packet's package filter, at `898298c8` | Passed: domain 40 files, 470 tests; timeline 6, 62; renderer 8, 68; audio-engine 55, 833; spectral-analysis 6, 86; editor-view 10, 139. |
| `cargo test -p audiogubbins-analysis` | 41 tests passed. |
| `pnpm run test:spectral-golden` | 4 files, 87 tests passed. |
| `pnpm run test:project-roundtrip` | 9 files, 323 tests passed. |
| `pnpm run test:editing-property` | 5 files, 20 tests passed. |
| `pnpm run test:architecture` | No dependency violations; 10 files, 321 tests passed. |
| `pnpm run build` | Exit 0; the build check passed. |
| `pnpm run spec:verify` | PASS, all four checks, on the closing commit. |

## Browser and device results

Each browser test ran through Playwright against a production build the
preview server serves.

- `pnpm run test:e2e:spectral`, at `898298c8`: 4 passed (29.9 s), in Chromium with WebGL switched off, so the
  spectrogram it reads by pixel is drawn by Canvas 2D, the reduced renderer.
  The first test imports a sound holding a steady tone and a burst into a
  project in the Spectral Repair workspace, selects the burst with the
  spectral marquee and an area of the tone from the keyboard, each read back
  from its description in words, attenuates the first and heals the second,
  lists both in the Spectral panel and the Inspector, compares the heal with
  before it and switches its sides, undoes and redoes both, and finds them
  and their history after a reload. The second requires the drawn
  spectrogram darker over the attenuated area once the edited sound's tiles
  replace the stale ones, and nowhere else; the third draws the same lasso
  shape from the same drag; the fourth draws the same brush mask at the
  fixed strength from pen strokes at different pressures, which differ while
  pressure is allowed.
- `pnpm run test:renderer-loss`, at `898298c8`: 17 passed (25.8 s). The field batch is drawn through its ramp by every backend the
  browser offers and read back by pixel, uploaded and drawn again after a
  WebGL2 context or WebGPU device is lost, drawn by Canvas 2D when the
  context never comes back and after a GPU process crash, and holds no
  texture for a tile it does not draw beyond its budget; the spectrogram the
  worker makes is drawn with WebGL 2 and with Canvas 2D.
- `pnpm run test:touch-pen`, at `898298c8`: 6 passed (18.3 s), failing four
  of six before `010b0ff0` (B-02).
- `chromium-timeline`, `chromium-projects`, `firefox-projects` and the
  too-narrow notice's test, at `71c74157`, the merge of their fixes, and not
  run again at `898298c8`: `chromium-timeline` 5 of 5, three runs;
  `chromium-projects` and `firefox-projects` 10 of 10; the notice's test
  passed on the tablet, smoke, Firefox, WebKit, `chromium-scaled` and
  `firefox-text-110` projects. Each failed before `f20ba65b`, `d0e384cc` and
  `63fd2834` (B-03 to B-05).
- No spectral editing test runs in Firefox or WebKit (Known limitations).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Spectral edits round-trip through project persistence and branch history. | `spectral-edit.roundtrip.test.ts` ("every spectral edit survives being written and read, bit for bit", in an asset's chain, a paste's plan and a region's processing, alone and in a document; "a project document holding spectral edits reads back as the state it was written from"); `edit-json.test.ts` and `project-json.test.ts`, whose random states now hold spectral edits; `spectral-history.roundtrip.test.ts` ("keeps each branch’s spectral edits exactly, moving, undoing and redoing across the point", "keeps them so once the project is closed and opened again"). In the application, undo and redo of each edit (`spectral-edit-commands.test.ts`) and, in the browser, both edits undone, redone and found with their history after a reload (`spectral.spec.ts`). `pnpm run test:project-roundtrip`. |
| Time-frequency selection remains aligned across zoom levels and renderer resets. | `spectral-tools.test.ts` ("is drawn back where it was drawn, at every zoom and on either scale"); `frequency-axis.test.ts` (the exact inverse, "gives the same frequency for the same height every time it is asked"); `mask-drawing.test.ts` ("stays on what it selects at every zoom", "is the same after the composer and the renderer are made again"); `overlay-drawing.test.ts` ("draws the outline where the mask lies at each zoom"); `spectrogram-drawing.test.ts` ("draws the selection over its tiles on the same frequency axis and timeline", "is composed again the same by a new composer, as after a renderer is reset"); the field batch drawn again as it was after each loss (`pnpm run test:renderer-loss`). |
| Reference spectral operations produce stable golden outputs. | `canonical-stft.spectral-golden.test.ts` (pinned STFT magnitudes through each window, length and overlap), `spectral-edit.spectral-golden.test.ts` (every operation over every golden mask and settings), `spectral-process.spectral-golden.test.ts` (a `process` chain), `spectral-tile.spectral-golden.test.ts` (tiles at level 0 and a coarse level); `pnpm run test:spectral-golden`. |
| Large spectrograms stream/tile without whole-file GPU allocation. | `spectral-geometry.test.ts` ("starts every column on a whole frame, far into a long sound"), `tile-analysis.test.ts` ("reads a long sound’s coarsest tile from its windows alone"), `spectrogram-host.test.ts` ("keeps every tile a view shows past its memory budget, and lets the least recently shown go", "cancels the tiles no view shows any longer"), `field-textures.test.ts` and the WebGL2 and WebGPU backends' "keeps fields within its budget" and "makes no texture for a field it does not draw"; in the browser, "holds no WebGL 2 texture" and "holds no WebGPU texture for a tile it does not draw, beyond its budget", and "is composed tile after tile on one canvas, holding nothing per tile". |
| Fixed-strength stylus/mouse editing remains deterministic regardless of pressure hardware. | `spectral-tools.test.ts` ("strokes at the fixed strength, the same on every pointer, where the person turns pressure off", "strokes a finger’s path at the fixed strength, since a touch has no pressure to read"); `tool-pointer.test.ts` ("strokes at the fixed strength, whatever the pen presses, where the person turns pressure off"); `pressure-preference.test.ts`; `pen-and-touch.test.tsx`; the browser's "draws the same brush stroke at a fixed strength, whatever the pen's pressure". |
| Every sample a spectral edit's changed frames do not reach is its input, bit for bit. | `spectral-content.test.ts` ("leaves every sample no changed frame reaches as its input, bit for bit"); every spectral golden's "and its input where no changed frame reaches"; `spectral-edit.spectral-golden.test.ts` ("leave a span of whole frames unchanged within the subtracting mask"); `spectral-edit-property.test.ts` (random chains render to the bits of each edit applied in turn). |
| The reference and the WebAssembly DSP give the same bits for every spectral operation and every tile. | "gives the same pinned bits on either DSP" in `spectral-edit.spectral-golden.test.ts` and `spectral-process.spectral-golden.test.ts`; "are the same bits from both DSPs" in `spectral-tile.spectral-golden.test.ts`; "gives the same pinned magnitudes on either DSP" in `canonical-stft.spectral-golden.test.ts`; `spectrogram-host.test.ts` ("says which DSP the worker runs, and makes the same tiles on the WebAssembly module"). |

## Known limitations

- General image and video editing, cloud spectral processing, GPU compute of
  spectra, and comping and multitrack spectral views are out of scope
  (packet, Explicitly Out of Scope): the GPU draws, and spectra are computed
  in a worker by the canonical DSP.
- A live parameter change does not reach a chain run inside a spectral edit's
  frames until the plan is read again (`ADR-0081`, F-12).
- A spectral edit's range is kept with the project and read at every quality,
  so a heal's range is widened for its borders at the fewest overlap any
  quality analyses with; a heal at the audio's own ends takes no border from
  a frame reaching past them, so it is interpolated from the border within
  the sound, or left as it is where it has none (`spectral-edit.ts`,
  `heal-borders.ts`).
- The spectrogram cache keeps one revision of a source. A source's waiting
  writes are bounded at 32 and the oldest is let go, so a tile it held is
  analysed again when next shown; a refused write is reported and the tile
  kept in memory.
- After a reload in which the last panel used was not an editor, no editor
  is in use, so the Spectral panel, the Transport, the Inspector and the
  Effects rack say no editor shows audio until an editor is used once. The
  editor views' store deliberately does not keep the focused view, and
  "note the editor in use without writing, since the person changed
  nothing" (`apps/web/src/state/editor-view-store.test.ts`) asserts it. The
  behaviour predates this phase and is tracked by the owner's decision.
- The spectral browser suite runs in Chromium only, on the reduced renderer;
  the field batch's WebGPU and WebGL2 suites run in Chromium. Firefox and
  WebKit are not run for spectral editing.
- The domain's published entry is past the cohesion threshold, 417 logical
  lines against 400, by a recorded review (`REVIEWED_PAST_THRESHOLD`).
- Failures outside this phase, not fixed: WebKit's "reports no error when
  reloaded while it is still starting", whose storage worker is sometimes
  refused by Cross-Origin-Embedder-Policy during the reload (3 of 8 runs
  without and 5 of 8 with the tablet stylesheet change); Firefox's "keeps a
  panel the user widened at its width across a reload", which returns 240
  pixels; and the ml-golden projects, which need `pnpm packs:build` and
  `AUDIOGUBBINS_PACK_CACHE`, for which this machine has no pack cache.
- Tests that fail now and then under the whole suite's load and pass when run
  again: the storage quota test at its 5 s limit, `chromium-effect-rack`'s
  hearing length once, `chromium-scaled` diagnostics with
  `ERR_NO_BUFFER_SPACE` once, and the splitter tests Phase 07 recorded.
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-08-review.md`).

## Dependencies added, and their review

None from outside the repository; `pnpm-lock.yaml` gains only workspace links.
`packages/spectral-analysis` is a new workspace package depending on
`@audiogubbins/domain` and `@audiogubbins/audio-engine`, and on
`@audiogubbins/effect-rack`, `@audiogubbins/processors` and
`@audiogubbins/ml-runtime` for its thread entry and test support only, as
`packages/waveform` does (`ADR-0040` amended); `packages/editor-view` and
`apps/web` gain `@audiogubbins/spectral-analysis`.

## Migration and schema impact

`version.json` raises `projectDocument` to version 8 (the spectral edit and
its mask in an asset's chain, a region's processing and a paste's plan),
`userPreferences` to version 2 (whether pen pressure is used, and the fixed
strength) and `editorViews` to version 2 (the spectrogram's settings and
display range, and the spectral tools' settings). The DSP ABI rises from 6 to
7 (the STFT's window). Before 1.0 nothing migrates (`REQ-STOR-052`): a
document, project tree, preferences or editor views of another version are
refused with the reason, and the preferences and views start from their
defaults. The spectrogram tiles are a disposable cache in a checked format of
their own, refused and analysed again at another format version; nothing
persisted in a project depends on them.

## Screenshots and recordings

None kept in the tree. The spectrogram is checked from the page's pixels by
the browser tests above (`renderer-loss.spec.ts`, `renderer-reduced.spec.ts`,
`spectral.spec.ts`), which read the colour drawn over a tone, a burst and an
attenuated area; those tests and the runs recorded above are the evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-AUDIO-016` Spectral Editing | A spectrogram of the edited sound as disposable tiles analysed in a worker by the canonical STFT, drawn on every renderer; a spectral selection as a mask made by the marquee, the lasso and the brush, by any pointer and from the keyboard, with optional pressure and a fixed strength; attenuate, remove, isolate, heal and a cleanup or model chain as non-destructive spectral edits, undoable and recovered; comparison with the state before and the original heard. | `spectral-content.test.ts`, the four `*.spectral-golden.test.ts`, `spectral-edit-property.test.ts`, `spectral-edit.roundtrip.test.ts`, `spectrogram-host.test.ts`, `tile-analysis.test.ts`, `spectral-tools.test.ts`, `spectrogram-drawing.test.ts`, `mask-drawing.test.ts`, `spectral-edit-commands.test.ts`, `spectral-selection-commands.test.ts`, `spectral-panel.test.tsx`, `renderer-loss.spec.ts`, `renderer-reduced.spec.ts`, `spectral.spec.ts`. |

The requirements this phase consumes are met as the packet names them:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-ARCH-004` | A spectral edit is parametric and bypassable; tiles are disposable caches, analysed again when missing or failing their checksum. | `spectral-edit-property.test.ts` ("leaves every spectral edit’s range as it was when its processing is bypassed"), `spectrogram-host.test.ts`, `tile-codec.test.ts`, `stored-spectrogram-cache.test.ts`. |
| `REQ-ARCH-037` | The page never computes a spectrum: tiles are built in the worker, and the package's page-side code loads no processor. | `spectrogram-host.test.ts`, `view-spectrogram.test.ts`, `tests/architecture/dependency-rules.test.ts` and the dependency cruise. |
| `REQ-ARCH-049`, `REQ-ARCH-081` | One answer on every machine: the canonical STFT and DSP on both paths, decibels converted canonically. | The spectral goldens, `edit-commands.test.ts` and `spectral-edit-commands.test.ts` (the +12 dB and −96 dB cases). |
| `REQ-ARCH-153` | The spectral selection is the selection set's; the tools' and spectrogram's settings are the view's; tiles are the host's cache. | `selection.test.ts`, `editor-view-store.test.ts`, `spectrogram-host.test.ts`. |
| `REQ-ARCH-157` | Spectral edits and spectrograms work per channel, narrowed by the channel scope. | `spectral-content.test.ts` ("acts only on the channels it names"), `target-invocations.test.ts`, `spectrogram-host.test.ts` ("makes every channel wanted at a place in one pass"), `overlay-drawing.test.ts`, the four-channel golden layout. |
| `REQ-AUDIO-152` | The spectrogram and the mask drawn by WebGPU, WebGL2 and Canvas 2D, recovered after a loss. | `webgpu-backend.test.ts`, `webgl2-backend.test.ts`, `canvas-fields.test.ts`, `canvas2d-backend.test.ts`, `field-pixels.test.ts`, `renderer-loss.spec.ts`, `renderer-reduced.spec.ts`, `renderer-webgpu.spec.ts`. |
| `REQ-AUDIO-017`, `REQ-AUDIO-018` | A chain of cleanup or model processors applied to a time-frequency area. | `spectral-process.spectral-golden.test.ts`, `spectral-content.test.ts` ("takes the masked part of a chain’s output in place of its input"), `spectral-edit-commands.test.ts` ("runs a restoration processor in a chain of its own"). |
| `REQ-EDIT-062` | The spectrogram, stacked and overlay presentations show analysed audio. | `spectrogram-drawing.test.ts`, `spectral-tools.test.ts` ("draws over the spectrogram an overlay lane shows"), `overlay-drawing.test.ts`. |
| `REQ-EDIT-063`, `REQ-EDIT-064` | The spectral facet is a mask, kept across tools, zoom and views, and drawn visibly, quieter while inactive. | `selection.test.ts`, `mask-drawing.test.ts`, `overlay-drawing.test.ts`, `spectral-selection-commands.test.ts`. |
| `REQ-EDIT-065` | The spectral marquee, lasso and brush, by pointer or keyboard, through the selection commands. | `spectral-tools.test.ts`, `tool-pointer.test.ts`, `keyboard-drawing.test.ts`, `spectral-drawing-commands.test.ts`, `spectral-selection-commands.test.ts`. |
| `REQ-EDIT-072` | The Inspector describes a spectral edit by its area, shapes, frames and channels, and a clean-up by its chain. | `inspector-panel.test.tsx`, `edit-words.test.ts`. |
| `REQ-EDIT-073` | Every spectral edit is one project command with its inverse; its chain enters and leaves with it. | `spectral-edit-commands.test.ts`, `rack-commands.test.ts`, `target-invocations.test.ts`. |
| `REQ-STOR-021` | Spectral edits are undone, redone and recovered, across branches of history and a reopen. | `spectral-edit-commands.test.ts`, `spectral-edit.roundtrip.test.ts`, `spectral-history.roundtrip.test.ts`, `spectral.spec.ts`. |
| `REQ-STOR-052` | The raised versions are refused, never migrated. | `project-json.test.ts`, `project-tree.test.ts`, `preferences-store.test.ts`, `editor-view-store.test.ts`. |
| `REQ-STOR-106` | Spectrogram tiles are the cache category cleaned before intermediates. | `stored-spectrogram-cache.test.ts` ("is counted and given up with the spectrogram caches, and made again after"). |
| `REQ-STOR-195` | A spectral edit, the latest or one named, compared with the state before it. | `spectral-edit-commands.test.ts`, `spectral-panel.test.tsx`, `spectral.spec.ts`. |
| `REQ-UX-005` | Every spectral tool's action has a keyboard form with a default key, and the selection has a description in words; why a spectrogram is not drawn is an alert. | `shell-commands.test.ts`, `spectral-selection-commands.test.ts` ("describes the area in words, for a person who cannot see it"), `menus.test.ts`, `spectrogram-note.test.tsx`, `editor-panel.test.tsx`, `keyboard-drawing.test.ts`, `spectral-drawing-commands.test.ts`. |
| `REQ-UX-058` | The Spectral Repair preset gains the Spectral panel, in front of the Inspector. | `presets.test.ts`. |
| `REQ-UX-068` | Pressure is optional; a fixed strength is always available and persisted. | `pressure-preference.test.ts`, `pressure-commands.test.ts`, `preferences-store.test.ts`, `pen-and-touch.test.tsx`, `tool-pointer.test.ts`, `spectral-tools.test.ts`. |
| `REQ-PROD-009` | Spectrograms of sessions lasting hours, never analysed or held whole. | `tile-analysis.test.ts`, `spectral-geometry.test.ts`, `spectrogram-host.test.ts`, `field-textures.test.ts`. |

## Commits

Oldest first, on `phase-08-spectral`, from `1c357d0e`; a merge lists its
slice's commits beneath it:

- `d957834e` Make Phase 08 READY, with its readiness decisions
- `1714422f` Add spectral masks and the spectral edit to the edit model
- `9445b57c` Realise a spectral edit in the engine, read in order through one
  window
- `16f6ad69` Plan the Phase 08 build: decisions, what is done and what is
  left
- `f73fc31e` Merge the Blackman-Harris STFT window
  - `c22898af` Tell a type query of a PascalCase name from a browser probe
  - `8b48c2fc` Give the canonical STFT the Blackman-Harris window
- `20e79c04` Merge the renderer's field batch
  - `c8ecbcc6` Draw a field batch on every renderer backend
- `bc5d602a` Settle the failures the spectral merge left
- `d4251292` Amend ADR-0081 for the gain and the stroke's softness
- `b5bebd32` Record the settled merge failures in the resume note
- `fecde8c8` Merge the spectral golden suite
  - `b63bdeaa` Share the fingerprint of doubles between the DSP goldens
  - `ac41c59d` Pin every spectral edit's output on both DSP paths
  - `885d90b0` Pin the STFT magnitudes a spectrogram is built from
- `ff29864e` Merge the spectral edits' persistence round trips
  - `97f8b110` Raise the project document to version 8 for spectral edits
  - `551636ae` Let the command walk make the punch it removes
  - `b8511737` Cover spectral edits in the project format's round trips
  - `d4c5eea9` Record the project document version 8 in the public contracts
  - `01871692` Keep the random mask generator private to its module
- `0ed8d22b` Merge the field batch's browser coverage
  - `6ad2262b` Compose a field on a new canvas once its context is lost
  - `c84eb359` Read a field batch back by pixel on every renderer backend
- `28e98664` Merge the spectral tools and the pressure preference
  - `303077f9` Persist the pen pressure choice with the preferences
  - `51dea6db` Add commands that set the pen pressure choice
  - `e1f32d3e` Give the lane's frequency mapping its exact inverse
  - `b32299cc` Test the spectral selection's outline over a lane
  - `6ada82e7` Add the spectral marquee, lasso and brush, and draw the mask
- `1112b45c` Regenerate the public contracts after the merges
- `bbd02c40` Merge the touch suite's scroll into view
  - `010b0ff0` Scroll the editor surface into view before touching it in the
    e2e suite
- `78e37117` Merge the spectral-analysis package
  - `f0ee8816` Move the DSP delivery and its choice into the engine
  - `ce1c270d` Add the spectral-analysis package: the spectrogram's tiles
  - `c546a80f` Hold the spectral-analysis package to the architecture rules
  - `08b37582` Make wants that come together in one pass, and pin the golden
    tiles
- `71c74157` Merge the browser suites' settled failures
  - `f20ba65b` Place the timeline suite's markers on a sound in a project
  - `d0e384cc` Expect typographic quotation marks around names in the
    projects suite
  - `63fd2834` Keep the too-narrow notice's padding within a short workspace
- `23e590d2` Merge the spectral workspace: commands, panel and settings
  - `6c35f53d` Keep the spectral tools' settings in the view and reach the
    selection by keyboard
  - `ff63ace7` Keep a spectral edit's channel scope on the edit a target
    makes
  - `0dab56be` Add the spectral edit commands and compare one with before it
  - `89bf22ba` Give the Spectral Repair preset the Spectral panel
  - `f1b2840e` Describe a spectral edit whole in the Inspector
  - `1c151123` Add the Spectral panel
  - `156742a4` Put the pressure choice in Settings
- `2b4f71e8` Merge the spectrogram layer, worker and cache
  - `fdaa0f5c` Draw the spectrogram from the worker's tiles in every editor
    view
  - `5141a660` Add commands that change how a view's spectrogram is analysed
    and drawn
  - `df6939fb` Show and change the spectrogram's settings in the Spectral
    panel
  - `4a448af5` Check from the page's pixels that the spectrogram draws on
    WebGL 2 and Canvas 2D
  - `d1e71d61` Narrow the test asset the view spectrogram tests open
- `a5479df5` Settle the spectral exports and the domain entry's size
- `c77f70ee` Bring the resume note up to the merged slices
- `d3c6edf4` Merge the heal's borders, the bin frequency and ADR-0081's
  amendments
  - `7291c6aa` Rewrap the cohesion threshold's comment
  - `36f4b842` Measure a heal's borders from the sound, never from silence
  - `152841a4` State a bin's centre frequency once, in the domain
  - `ed56934d` Amend ADR-0081 for the command's range, the heal and process
    chains
  - `ae0d1178` Record the public contracts of the heal and bin changes
- `3422d446` Merge the spectrogram worker's transfer, the dated cache writes
  and the worker's DSP readout
  - `f1c506dd` Transfer a held sound's arrays to the spectrogram worker
  - `a68c21ed` Rewrap the cohesion threshold comment
  - `f432ae78` Date and bound spectrogram cache writes, and let them be
    cancelled
  - `ab8fe95e` Show the spectrogram worker's DSP in the Capabilities panel
  - `ec05dd18` Await the held put in the spectrogram cache test
- `c411a3cb` Merge one account of a stream's chain, the canonical decibels
  and the clean-up's warning
  - `e09da15d` Give the domain one account of the chain a stream runs
  - `78037432` Rewrap the cohesion threshold comment
  - `f4fd50cd` Convert decibels through the engine's canonical conversion
  - `515a5ad2` Say an unrunnable clean-up model before applying it
  - `9016c2d0` Test that a spectral edit's chain outlives a rack sharing it
  - `a9f22e65` Test comparing a named spectral edit with before it
  - `0dfe0a94` Test that the original heard bypasses a spectral edit
  - `3efcbabe` Rewrap the spectral clean-up comments
- `8f722b18` Merge the keyboard and touch spectral selection and the
  spectrogram's alert
  - `e92fd151` Rewrap the cohesion rule's comment to the comment width
  - `c57565bd` Let keyboard and touch build a compound spectral selection
  - `30745dd0` Move the editor's held space bar into a module of its own
  - `fdf15953` Say why a spectrogram is not drawn as an alert beside the
    canvas
  - `80343f2c` Amend ADR-0082 for the tool input and the combination mode
- `0a626174` Merge the spectral edits' branching history tests
  - `54f2312b` Test spectral edits through branching history and a reopen
- `b42bbbd5` Give the view spectrogram test's second host its clock
- `de09bd5a` Merge the keyboard drawing of spectral shapes
  - `391f071a` Leave Enter, Space and Escape to the control that has the
    keyboard
  - `b39d6370` Give the shown spectrogram test's host a clock
  - `021dd204` Draw spectral shapes from the keyboard
  - `e85a5b72` Record ADR-0082's amendment of the spectral tools
- `59374062` Merge the drawing keys that pass through when idle
  - `16f7358b` Leave Enter and Escape to the page while no shape is being
    drawn
- `dd6c2409` Merge the spectral browser suite; its merge of the phase
  branch, `10407f3a`, took the phase's heal fix, `36f4b842`, over the
  slice's own, `5d6e5ea8`, which it supersedes
  - `86ef7d41` Say when a comparison asked for is open already
  - `fac05d79` Add the spectral editing browser suite
  - `5d6e5ea8` Measure a heal's borders within the audio it heals
    (superseded)
  - `d0ccc736` Take every move of a lasso or a brush stroke
- `b64ec9e9` Keep how a command is voiced beside how it is announced
- `898298c8` Keep the band's size review under the title its record cites

The commit that records this package, the review record and the handoff
follows, and the integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-08-review.md` records the owner's decision that defers every
lens to the review after the whole specification is implemented, and the
scope check a separate read-only agent ran in their place against the packet.
Its thirteen findings, one `HIGH`, five `MEDIUM`, four `LOW` and three
`NOTE`, and the thirteen the build and the integration found, four `MEDIUM` and nine
`LOW`, are fixed;
the review record names each fix's commit and the tests that hold it.
