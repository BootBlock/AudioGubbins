# Phase Handoff Capsule — Phase 08

## Capability Delivered

AudioGubbins edits audio in time and frequency. The spectrogram of the edited
sound is a pyramid of tiles a dedicated worker analyses by the canonical STFT
of `crates/analysis`, now with the Blackman–Harris window as well as the Hann,
nearest the view's centre first, cancelled when no view shows them; tiles are
quantised to half-decibel bytes, kept within a memory budget and in the
disposable cache under `CacheCategory.Spectrogram`, keyed by the edited
sound's revision, the old revision drawn dimmed until the new one replaces it
(`ADR-0080`). The renderer draws a scalar field through a colour ramp on
WebGPU, WebGL2 and Canvas 2D, holding a texture only for a field it draws and
recovering after a loss (`ADR-0082`). A spectral selection is the domain's
mask of rectangles, polygons and brush strokes, adding or subtracting, with a
feather, made by the spectral marquee, the lasso and the brush, by mouse, pen,
touch or the keyboard, with a pen's pressure or a fixed strength the person
keeps; a view's combination mode lets a finger or a pen build a compound
mask. A spectral edit attenuates, isolates or heals the area, or runs a
cleanup or model chain within it, as a range edit that adds a masked change
to its input, so every sample no changed frame reaches is unchanged, the
reference and WebAssembly DSP giving the same bits (`ADR-0081`). Each edit is
one undoable command, listed by the Spectral panel and described by the
Inspector, compared with the state before it, bypassed to hear the original,
and found again after a reload.

## Requirements Satisfied

The owned requirement is mapped to its implementation and its evidence in
`reviews/phase-08-evidence.md`, under "Requirement-to-evidence mapping", with
the consumed requirements beside it.

- `REQ-AUDIO-016`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them; these differ in name:

- The packet's SpectralSelection is the selection set's spectral facet,
  `SelectionSet.spectral`, a `SpectralMask`, in `@audiogubbins/timeline`,
  joined by `withSpectralShape` with a `SpectralCombination`; it replaces
  `SpectralArea` and `withSpectralArea`.
- The packet's spectral edit is `SpectralEdit`, a `RangeEdit` of kind
  `spectral` carried by a `process` operation or a region's processing; the
  plan carries it as a stream's `spectral` processing, `PlannedSpectralEdit`.
- The packet's field batch is `FieldBatch` with `ScalarField` and
  `ColourRamp`, a `RenderBatch`, in `@audiogubbins/renderer`.
- The packet's spectrogram worker protocol and host are
  `ToSpectrogramWorker`, `SpectrogramEvent`, `SpectrogramWorkerPort`,
  `SpectrogramHost` and `SpectrogramHandle`, with the thread entry
  `./threads/*`, in `@audiogubbins/spectral-analysis`.
- The packet's STFT window is `StftWindow` and `StftSettings.window` in
  `@audiogubbins/audio-engine`.

And by package:

- `@audiogubbins/spectral-analysis` (new): `SpectrogramConfig`,
  `DEFAULT_SPECTROGRAM_CONFIG`, `spectrogramConfig`; `SpectralTileKey`,
  `tileKeyText`, `SpectralTile`, `ShownTile`; the geometry
  (`SpectrogramGeometry`, `LevelGeometry`, `levelFor`, `tileSpan`,
  `tilesOver`); the quantised level (`LEVEL_FLOOR_DECIBELS`,
  `LEVEL_STEP_DECIBELS`, `levelDecibels`); the host, the worker port and
  protocol, `SpectralTileCache` and `TileWriting`; and in `./testing`,
  `LocalSpectrogramWorker`, `MemoryTileCache` and `memorySubject`.
- `@audiogubbins/domain`: `SpectralMask`, `SpectralShape`, `MaskEffect`,
  `SpectralFeather`, `NO_FEATHER`, `StrokePoint`, `BrushRadius`,
  `MaskWeights`, `maskSupport`, `maskOutline`, `masksEqual`, `clippedMask`,
  `maskProblem`, `spectralMaskOf`; `SpectralEdit`, `SpectralEditOperation`,
  `SpectralOperationKind`, `spectralEditProblem`, `spectralPlacement`,
  `HEAL_BORDER_FRAMES`, the resolution bounds and `DEFAULT_SPECTRAL_RESOLUTION`;
  the plan's `spectral` processing; `editChain`, `withEditChain`,
  `streamChain`, `takesChannelScope`; `binFrequency`, `nearestBin`.
- `@audiogubbins/audio-engine`: `StftWindow`; `DspDelivery`, `deliveredDsp`,
  `ScopeDsp`, moved from `@audiogubbins/audio-runtime`;
  `CachePurpose.Spectrogram`; the spectral golden fixtures in its testing
  entry.
- `@audiogubbins/timeline`: `SpectralCombination`, `withSpectralMask`,
  `withSpectralShape`; a spectral `SelectionTarget` carries a mask.
- `@audiogubbins/renderer`: `FieldBatch`, `ScalarField`, `ColourRamp`;
  `browserBackends` takes the off-screen canvas Canvas 2D composes on.
- `@audiogubbins/editor-view`: the spectral tools (`ToolId`'s spectral
  marquee, lasso and brush, `ToolInput.strength`, `SpectralToolContext`,
  `SpectralToolSettings`, `withDrawnShape`, `isSpectralTool`), the steps
  (`maskSteppedInTime`, `maskSteppedInFrequency`), the spectrogram's view
  state (`SpectrogramDisplay`, `DisplayRange`, `SpectrogramColours`,
  `shownSpectrogram`, `KnownSpectrogram`), and the spectral edit outlines.
- `@audiogubbins/input`: `PressurePreference`, `pressurePreferenceOf`,
  `fixedStrengthOf`, `FIXED_STRENGTH_RANGE`.
- `@audiogubbins/workspace`: `PanelKinds.Spectral`, in front in the Spectral
  Repair preset.

## Persisted / Interchange Formats

- The project document, `projectDocument` version 8: the spectral edit and
  its mask in an asset's chain, a region's processing and a paste's plan.
- The person's preferences, `userPreferences` version 2: whether pen pressure
  is used, and the fixed strength.
- Editor views, `editorViews` version 2: each view's spectrogram settings and
  display range, and its spectral tools' settings and combination mode.
- The DSP ABI, version 7: the STFT's creation takes its window.
- Spectrogram tiles: a checked format of their own, with their key and a
  CRC-32, in the disposable cache under `CacheCategory.Spectrogram`; one
  revision of a source kept; refused and analysed again when they fail.
- Before 1.0 nothing migrates (`REQ-STOR-052`): a document, tree, preferences
  or views of another version are refused with the reason.

## Invariants Downstream Agents Must Preserve

- The page never computes a spectrum. Tiles are built in the spectrogram
  worker from the edited sound, by the canonical STFT, and only the tiles a
  view asks for; every request can be cancelled. There is no second STFT for
  the spectrogram.
- Spectrogram tiles and field textures are caches, never authoritative; a
  missing, stale or corrupt tile is analysed again, and a refused cache write
  is reported and the tile kept in memory.
- A spectral edit changes no sample that no changed frame reaches, and it is
  realised by the canonical DSP with no platform transcendental function, the
  same bits on the reference and WebAssembly paths. Decibels are converted by
  the engine's `decibelsToGain` and `gainToDecibels` only.
- The mask's weight has one home, the domain's `MaskWeights`; the engine, the
  editor view and the commands read it there. A bin's centre frequency is
  `binFrequency`'s alone.
- A command places a spectral edit over its mask's support, widened by half a
  frame, and a heal by its border frames too, within the audio, so a heal's
  borders are measured from the sound and never from silence.
- The domain's `streamChain` is the one account of the chain a stream runs,
  and `editChain` of which edits name a chain; a spectral `process` edit's
  chain enters and leaves the project with the edit and cannot be removed
  while it names it.
- A selection's frequency comes from the pointer's height through the exact
  inverse of the lane's frequency mapping, so a shape, its overlay and the
  tiles beneath it share one mapping at every zoom and after every reset.
- Pressure is optional: with it turned off, and for touch, a stroke has the
  fixed strength, the same on every pointer.
- No backend holds a texture for a field it does not draw beyond its budget's
  cache; a lost device or context loses only those caches.
- Every view changes spectral selections only through selection commands and
  spectral edits only through project commands; every spectral selection
  command has a keyboard form.

## ADRs

- `ADR-0080` — the spectrogram as a pyramid of disposable tiles, analysed in
  a worker from the edited sound.
- `ADR-0081` — spectral masks and spectral edits; amended 2026-10-10 twice
  (gains as linear factors and a stroke softened by its own hardness; a
  command's range is the mask's support, a heal's range takes in its borders,
  and a `process` chain runs within the spectral stream).
- `ADR-0082` — the field batch, the spectrogram layer and the spectral tools;
  its tools clause rewritten on 2026-10-10 (a tool's input carries the
  pointer's height; the view's combination mode; the keyboard's band
  commands)<<INTEGRATOR: and the keyboard lasso and brush follow-up>>.
- `ADR-0017`, `ADR-0031`, `ADR-0032`, `ADR-0040`, `ADR-0042`, `ADR-0044`,
  `ADR-0051` and `ADR-0060` — amended by the three, as each records.

## Verification Baselines

- `pnpm run test:spectral-golden`: pinned STFT magnitudes through each window,
  every spectral operation over every golden mask and settings, a `process`
  chain, and tiles at level 0 and a coarse level, each the same bits on the
  reference and WebAssembly paths; the five heals at 8,192 samples and draft
  quality were pinned again in `36f4b842`.
- `cargo test -p audiogubbins-analysis`, with `GOLDEN_STFT_BLACKMAN_HARRIS`.
- `pnpm run test:project-roundtrip`, whose random states hold spectral edits
  of every operation and shape, and `spectral-edit.roundtrip.test.ts`;
  `pnpm run test:editing-property`, with `spectral-edit-property.test.ts`.
- `pnpm run test:renderer-loss`: the field batch read back by pixel on
  WebGPU, WebGL2 and Canvas 2D, after each loss and a GPU process crash, and
  within its texture budget; the spectrogram drawn with WebGL 2 and Canvas 2D.
- `pnpm run test:e2e:spectral` in Chromium on the reduced renderer: an area
  selected by marquee and by keyboard, attenuated and healed, compared,
  undone, redone and found after a reload, the spectrogram darker over the
  attenuated area; the lasso and the fixed-strength brush drawing the same
  mask from the same stroke. <<INTEGRATOR: its result and commit>>
- `pnpm run test:touch-pen` and `pnpm run test:architecture`.
- The final counts: `verify:commit` on <<INTEGRATOR: the integrated commit>>,
  <<INTEGRATOR: test files and tests>>; every browser test the evidence lists
  <<INTEGRATOR: passed, or the exceptions>>.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- General image and video editing (packet, Explicitly Out of Scope).
- Cloud spectral processing (packet, Explicitly Out of Scope).
- GPU compute of spectra: the GPU draws, and spectra are computed in a worker
  by the canonical DSP, which `REQ-ARCH-049` holds to one answer.
- Comping and multitrack spectral views: no phase of this specification
  builds the multitrack architecture.

## Accepted Non-Blocking Debt

- A live parameter change does not reach a chain run inside a spectral edit's
  frames until the plan is read again (`ADR-0081`, F-12 in
  `reviews/phase-08-review.md`).
- <<INTEGRATOR: the keyboard's reach once p08-fixui lands, or remove this
  item>>
- The spectral browser suite runs in Chromium only, on the reduced renderer;
  Firefox and WebKit are not run for spectral editing. Owed to Phase 14.
- The domain's published entry is past the cohesion threshold by a recorded
  review (`REVIEWED_PAST_THRESHOLD`), since every name it exports has a
  consumer.
- Failures outside this phase, owed to Phase 14's hardening: WebKit's
  "reports no error when reloaded while it is still starting" (the storage
  worker sometimes refused by Cross-Origin-Embedder-Policy during the
  reload); Firefox's "keeps a panel the user widened at its width across a
  reload" (240 pixels returned); the ml-golden projects, which need a pack
  cache this machine does not have.
- Tests that fail now and then under the whole suite's load and pass when run
  again: the storage quota test, `chromium-effect-rack`'s hearing length,
  `chromium-scaled` diagnostics with `ERR_NO_BUFFER_SPACE`, and the splitter
  tests Phase 07 recorded. Each is in the evidence. Owed to Phase 14.
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-08-review.md`).
- The debt owed to this phase is closed: the spectrogram lane's analysis
  (Phase 04, `ce1c270d`, `fdaa0f5c`); spectral painting and selection
  editing through `crates/analysis` and the ML processors (Phase 06,
  `8b48c2fc`, `6ada82e7`, `9445b57c`, `0dab56be`); the persisted gesture
  settings and a fixed-strength control (Phase 01, `303077f9`, `51dea6db`,
  `156742a4`); the selection set's lasso clipping and equality by value
  (Phase 04, `1714422f`).

## Downstream Readiness

- No phase becomes newly eligible for `READY`. Phase 14 — Performance,
  Compatibility, and Accessibility Hardening still waits on Phases 09 to 13.
- Phase 09 — Import, Export, and Codec System remains eligible, every hard
  dependency having passed with Phase 06; its readiness review decides it.
- Phase 10 still waits on Phase 09; Phase 11 on Phases 09 and 10; Phase 12 on
  Phase 09; Phase 13 on Phases 09, 10 and 11; Phase 15 on Phase 14.
