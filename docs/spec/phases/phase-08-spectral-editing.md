# Phase 08 — Spectral Editing

## Status

`READY` — every hard dependency has passed, and the readiness review of 2026-10-10 settled the open placements (`ADR-0080`, `ADR-0081`, `ADR-0082`).

## Objective

Implement interactive spectral analysis and non-destructive spectral editing/repair using scalable spectrogram tiling, explicit time-frequency selections, deterministic operations, and integration with local restoration/ML capabilities. The spectrogram is a pyramid of disposable tiles analysed in a worker from the edited sound (`ADR-0080`); a spectral selection is a mask, and a spectral edit is a range edit that adds a masked change to its input, so every sample it does not reach is unchanged (`ADR-0081`); the renderer draws scalar fields through a colour ramp on every backend, and the spectral tools make a mask (`ADR-0082`).

## User-Visible Outcome

Users can inspect and edit frequency/time regions with marquee/lasso/brush-style tools, attenuation/removal/heal/repair operations, preview/A-B, and recoverable parametric history. They see the spectrogram of what they hear, at any zoom, on any renderer; select an area with the spectral marquee, the lasso or the brush, with a pen's pressure or a fixed strength, or from the keyboard; attenuate, remove, isolate or heal it, or clean it up with a restoration or model processor; compare the result with before it; and find every spectral edit, undoable, after a reload.

## Hard Dependencies

- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP

## Owned Requirements

- `REQ-AUDIO-016` — Spectral Editing (`CURRENT`)

### Requirements Consumed From Other Phases

Owned elsewhere; this phase delivers the part named, or keeps what it asks.

- `REQ-ARCH-004` — Core Architectural Principles (Phase 01): a spectral edit is parametric, and spectrogram tiles are disposable caches.
- `REQ-ARCH-037` — Waveform Rendering Direction (Phase 04): the page never computes a spectrum.
- `REQ-ARCH-049` and `REQ-ARCH-081` — Deterministic Rendering and Canonical Deterministic Processing (Phase 03): a spectral edit's final render is one answer on every machine.
- `REQ-ARCH-153` — State Ownership and Workflow State (Phase 01): the spectral selection is the selection set's; display settings are the view's; tiles are the host's cache.
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio (Phase 03): spectral edits and spectrograms work per channel, on any layout, narrowed by the channel scope.
- `REQ-AUDIO-152` — High-Performance Editor Rendering Layer (Phase 04): the spectrogram and the mask are drawn by WebGPU, WebGL2 and Canvas 2D, and recovered after a loss.
- `REQ-AUDIO-017` and `REQ-AUDIO-018` — Effect Rack and DSP Scope (Phase 06): a chain of cleanup or model processors applied to a time-frequency area.
- `REQ-EDIT-062` — Waveform and Spectral Presentation Modes (Phase 04): the spectrogram, stacked and overlay presentations show analysed audio.
- `REQ-EDIT-063` and `REQ-EDIT-064` — Explicit Selection Model and Selection Persistence (Phase 04): the spectral facet is a mask, kept across tools, zoom and views.
- `REQ-EDIT-065` — Hybrid Tool System (Phase 04): the spectral marquee, the spectral lasso and the brush.
- `REQ-EDIT-072` — Contextual Inspector (Phase 01): the Inspector describes a spectral edit.
- `REQ-EDIT-073` — Unified Typed Command Architecture (Phase 01): every spectral edit is a project command with its inverse.
- `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery (Phase 02): spectral edits are undone, redone and recovered.
- `REQ-STOR-052` — Project Schema Compatibility Policy (Phase 02): the raised schema versions are refused, never migrated, before 1.0.
- `REQ-STOR-106` — Storage Cleanup Priority (Phase 02): spectrogram tiles are the cache category cleaned before intermediates.
- `REQ-STOR-195` — Whole-Project A/B State Comparison (Phase 02): a spectral edit is compared with the state before it.
- `REQ-UX-005` — User Experience Goals (Phase 01): every spectral tool's action has a keyboard form, and the selection has a non-visual description.
- `REQ-UX-058` — Workspace Presets (Phase 01): the Spectral Repair preset gains the Spectral panel.
- `REQ-UX-068` — Stylus and Pressure Input (Phase 01): pressure is optional; a fixed strength is always available and persisted.
- `REQ-PROD-009` — Audio Duration and Scale (Phase 03): spectrograms of sessions lasting hours, never analysed or held whole.

## Referenced Global Execution Requirements

- `REQ-EXEC-136`
- `REQ-EXEC-167`
- `REQ-EXEC-170`
- `REQ-EXEC-171`
- `REQ-EXEC-172`
- `REQ-EXEC-173`
- `REQ-EXEC-174`
- `REQ-EXEC-180`
- `REQ-EXEC-181`
- `REQ-EXEC-183`
- `REQ-EXEC-184`
- `REQ-EXEC-204`
- `REQ-EXEC-215`
- `REQ-EXEC-216`

## In Scope

- [ ] Spectrogram analysis/tile cache: `SpectrogramConfig`, the tile pyramid, quantised tiles, the worker, the host and the disposable cache (`ADR-0080`)
- [ ] The Blackman–Harris window in the canonical STFT of `crates/analysis` and its reference, raising the DSP ABI (`ADR-0080`)
- [ ] Frequency/time coordinate system: the exact column placement of `ADR-0041` and the inverse of the lane's frequency mapping (`ADR-0082`)
- [ ] Spectral selections: the mask of rectangles, polygons and strokes, adding or subtracting, with a feather, as the selection's spectral facet (`ADR-0081`)
- [ ] Marquee/lasso/brush tools, with pressure optional and a persisted fixed strength, and keyboard commands for spectral selection (`ADR-0082`)
- [ ] Attenuate/remove/isolate/heal operations, and repair through a cleanup or model chain, as the spectral edit (`ADR-0081`)
- [ ] Selection-sensitive spectral processing: the spectral edit in the plan, the engine's realisation and its persisted form
- [ ] GPU-accelerated display with fallbacks: the field batch on WebGPU, WebGL2 and Canvas 2D, within a texture budget (`ADR-0082`)
- [ ] Integration with cleanup/ML processors: the `process` operation, with model unavailability stated before and after applying
- [ ] Spectral cache invalidation: tiles keyed by the edited sound's revision, the old revision drawn as stale until replaced
- [ ] Preview and A/B: the spectral edit compared with the state before it, and heard processed or as the original
- [ ] Spectral views: the spectrogram layer, the mask's overlay, spectral edit outlines, the Spectral panel, the Inspector's spectral edit, the display settings and the Spectral Repair preset; every view invokes only commands

## Explicitly Out of Scope

- General image/video editing
- Cloud spectral processing
- GPU compute of spectra: the GPU draws; spectra are computed in a worker by the canonical DSP, which `REQ-ARCH-049` holds to one answer (`ADR-0080`)
- Comping and multitrack spectral views (no phase of this specification builds the multitrack architecture)

## Owned Modules / Packages

- `packages/spectral-analysis` (new and portable: `SpectrogramConfig`, `SpectralTileKey`, tile geometry, tile building and its codec, the worker's protocol and thread entry, and the host, `ADR-0080`)
- `crates/analysis` and `crates/wasm-bindings` (Phase 03's; this phase adds the STFT's window and raises the ABI)
- `packages/audio-engine` (Phase 03's; this phase adds the STFT's window to its canonical port and reference, and the spectral realisation of the plan, `ADR-0081`)
- `packages/domain` (`SpectralMask`, its shapes and weight, `SpectralEdit`, `SpectralEditOperation`, and the plan's spectral processing, `ADR-0081`)
- `packages/project-format` (the spectral edit's persisted form) and `packages/project-commands` (its description and the chain it names)
- `packages/timeline` (the spectral facet as a mask)
- `packages/renderer` spectral layers: the field batch on every backend (`ADR-0082`)
- `packages/editor-view` (the spectrogram layer, the mask's overlay, the spectral tools and the inverse frequency mapping)
- `packages/input` (persisted gesture settings) and `packages/workspace` (the Spectral Repair preset's panel)
- `apps/web spectral workspace`: the spectrogram worker's start, the tile cache, the spectral commands, the Spectral panel, the Inspector's spectral edit, the display and pressure settings

## Cross-Package Dependency Rules

- Spectral domain uses audio/analysis contracts and command/history layers.
- Renderer tiles/caches are not authoritative spectral edit state.
- `packages/spectral-analysis` depends on the domain and the engine; its thread entry and test support alone load `packages/effect-rack`, `packages/processors` and `packages/ml-runtime`, as `packages/waveform`'s do (`ADR-0040` amended).
- `packages/editor-view` depends on `packages/spectral-analysis` for tiles and their geometry; neither imports a UI framework, and only `packages/capabilities` reads a browser global.
- The mask's weight has one home, the domain; the engine, the editor view and the commands read it there (`ADR-0081`).
- The interface changes spectral selections only through selection commands, and spectral edits only through project commands.

## Required Public Contracts

- SpectralTileKey (`packages/spectral-analysis`, `ADR-0080`)
- SpectralSelection: the selection set's spectral facet, a `SpectralMask` (`packages/timeline`, `packages/domain`, `ADR-0081`)
- SpectralMask (`packages/domain`, `ADR-0081`)
- SpectralEditOperation and the spectral edit (`packages/domain`, `ADR-0081`)
- SpectrogramConfig (`packages/spectral-analysis`, `ADR-0080`)
- The field batch (`packages/renderer`, `ADR-0082`)
- The spectrogram worker's protocol and host (`packages/spectral-analysis`, `ADR-0080`)
- The STFT's window (`packages/audio-engine`, `crates/analysis`, `ADR-0080`)

## Data / Schema Changes

- Introduces persisted spectral-edit operations/masks where authoritative, plus disposable spectrogram-tile cache formats.
- The project document gains the spectral edit and its mask, raising `projectDocument`; the person's preferences gain the gesture settings, raising `userPreferences`; editor views gain the spectrogram's settings and display range, raising `editorViews`; the DSP ABI rises. Before 1.0 nothing migrates (`REQ-STOR-052`).
- Settled by this phase's readiness review (`ADR-0080`, `ADR-0081`, `ADR-0082`): where spectra are analysed and kept, what a spectral selection and a spectral edit are and how the plan realises one, and how a spectrogram and a mask are drawn.

## Browser / Platform Considerations

- GPU compute/render acceleration optional; CPU/worker/WASM fallback required where viable.
- Touch/pen pressure is optional; fixed-strength deterministic tools always exist.
- Assumed nowhere (`REQ-EXEC-216`): a GPU, WebGPU or WebGL2; a WebAssembly module; a pen or pressure; a cache or quota for tiles; a sample rate; a channel layout. Each is probed or given, and its absence has stated behaviour.

## Architectural Invariants

- Spectrogram tiles/masks derived for preview are caches unless explicitly part of an edit operation.
- Spectral edits are non-destructive and survive reload/history.
- Frequency/time selection maps to sample coordinates deterministically.
- GPU acceleration never changes authoritative spectral edit semantics.
- A spectral edit changes no sample that no changed frame reaches (`ADR-0081`).
- The page never computes a spectrum; the worker builds only tiles a view asks for.
- No backend holds a texture for a tile it does not draw, beyond its budget's cache.

## Internal Work Units

### WU-08.A — Spectral analysis/cache

- [ ] Implement FFT/STFT configuration and multi-resolution tile generation off UI thread: the Blackman–Harris window in Rust and the reference, `SpectrogramConfig`, tile geometry and quantisation, the worker and its protocol
- [ ] Persist/regenerate disposable tiles: the codec, the host, the cache under `CacheCategory.Spectrogram`, and revision invalidation with stale drawing

### WU-08.B — Spectral interaction

- [ ] Implement coordinate transforms, selections and tools: the inverse frequency mapping, the mask facet, the marquee, lasso and brush, and the keyboard's spectral selection commands
- [ ] Integrate pressure-optional brush strength and fixed deterministic mode, with the persisted preference and its controls

### WU-08.C — Repair operations

- [ ] Implement attenuation/remove/heal/repair as parametric operations: the spectral edit, its validation, its fold, its realisation, its persisted form and its description
- [ ] Integrate processor/ML backends with preview/final quality: the `process` operation through a chain, at the preview and render qualities

### WU-08.D — Verification/UX

- [ ] Add A/B comparison, overlays and explicit selection-target feedback: the field batch, the spectrogram layer, the mask's overlay, the edit outlines, the Spectral panel, the Inspector and the preset
- [ ] Validate large-file and fallback renderer behaviour

## Failure and Recovery Behaviour

- Stale/missing spectral tiles regenerate safely.
- Unsupported GPU/FFT capability falls back without losing core spectral functionality.
- ML/model unavailability is explicit.
- A tile whose cached form fails its key or checksum is analysed again; a refused cache write is reported and the tile is kept in memory.
- A worker that fails is reported, and the lanes it served say why they are not drawn.
- A spectral edit whose mask, resolution or reduction is invalid, or whose chain is missing, is refused with the reason, and nothing changes.

## Required Verification Commands / Suites

- `pnpm --filter @audiogubbins/spectral-analysis --filter @audiogubbins/domain --filter @audiogubbins/audio-engine --filter @audiogubbins/renderer --filter @audiogubbins/editor-view --filter @audiogubbins/timeline test`
- `cargo test -p audiogubbins-analysis`
- `pnpm test:spectral-golden`, which this phase adds: golden outputs of every spectral operation and of tiles, from the reference and the WebAssembly DSP
- `pnpm test:project-roundtrip`
- `pnpm test:editing-property`
- `pnpm test:architecture`
- `pnpm test:renderer-loss` and `pnpm test:touch-pen`
- `pnpm test:e2e:spectral`, which this phase adds: a Chromium project that selects an area, attenuates and heals it, compares, undoes, reloads, and draws the spectrogram on the reduced renderer

## Acceptance Criteria

- [ ] Spectral edits round-trip through project persistence and branch history.
- [ ] Time-frequency selection remains aligned across zoom levels and renderer resets.
- [ ] Reference spectral operations produce stable golden outputs.
- [ ] Large spectrograms stream/tile without whole-file GPU allocation.
- [ ] Fixed-strength stylus/mouse editing remains deterministic regardless of pressure hardware.
- [ ] Every sample a spectral edit's changed frames do not reach is its input, bit for bit.
- [ ] The reference and the WebAssembly DSP give the same bits for every spectral operation and every tile.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No destructive baking as the only representation of spectral repair.
- No main-thread full-file STFT.
- No GPU-only implementation without fallback.
- No second mask model beside the domain's, and no second STFT for the spectrogram beside `crates/analysis`'s.
- No platform transcendental function in a spectral edit's realisation.

## Required Review Lenses

- Audio / DSP Correctness
- Performance / Scalability
- Architecture
- UX / Accessibility / Input
- Testing / Golden Regression
- Browser Compatibility
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Inherited Debt

Assigned to this phase by earlier handoffs and by this phase's readiness review:

- The spectrogram lane is a shell: its analysis and the spectral tools are this phase's (Phase 04 handoff), listed under In Scope.
- Spectral painting and spectral selection editing, reading `crates/analysis` and the ML processors (Phase 06 handoff), listed under In Scope.
- Persisting the gesture settings and a control for fixed strength, left by `ADR-0017` to the first pressure-sensitive tool (Phase 01), listed under In Scope.
- The selection set's reconciliation clips no lasso point, and its equality compares a spectral shape by reference (Phase 04, found by this review): the mask facet corrects both (`ADR-0081`).
- The packet's verification named `cargo test -p analysis`, which matches no package, and scripts that did not exist (found by this review): corrected above.

## Handoff Capsule

Create `traceability/handoffs/phase-08.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
