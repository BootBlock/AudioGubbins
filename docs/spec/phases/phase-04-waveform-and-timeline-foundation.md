# Phase 04 — Waveform and Timeline Foundation

## Status

`READY` — Phases 01 and 03, its hard dependencies, have reached `PASS`; see `traceability/handoffs/phase-01.md` and `traceability/handoffs/phase-03.md`.

## Objective

Implement the high-performance sample-accurate timeline/editor rendering foundation: multi-resolution waveform cache, scalable renderer, explicit selection/snapping model, multi-view state, channel-aware display, shared media clock, and sound-to-picture reference support.

## User-Visible Outcome

Users can open deterministic test assets into one or more editor views, zoom from whole-file to individual samples, navigate/select/snap accurately with mouse/touch/pen, and keep waveform/video-reference presentation synchronised.

## Hard Dependencies

- Phase 01 — Application Foundation
- Phase 03 — Audio Engine Foundation

## Owned Requirements

- `REQ-EDIT-012` — Timeline and Editing Requirements (`CURRENT`)
- `REQ-EDIT-013` — Snapping (`CURRENT`)
- `REQ-ARCH-037` — Waveform Rendering Direction (`CURRENT`)
- `REQ-EDIT-061` — Multiple Views of the Same Asset (`CURRENT`)
- `REQ-EDIT-062` — Waveform and Spectral Presentation Modes (`CURRENT`)
- `REQ-EDIT-063` — Explicit Selection Model (`CURRENT`)
- `REQ-EDIT-064` — Selection Persistence (`CURRENT`)
- `REQ-EDIT-065` — Hybrid Tool System (`CURRENT`)
- `REQ-AUDIO-082` — GPU Acceleration Strategy (`CURRENT`)
- `REQ-AUDIO-152` — High-Performance Editor Rendering Layer (`CURRENT`)
- `REQ-AUDIO-156` — Video Reference and Sound-to-Picture Workflows (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-PROD-160` — Musical Timeline and Tempo Features — Deferred Possibility (`DEFERRED`)

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

- [ ] Multi-resolution peak generation/cache
- [ ] GPU renderer abstraction with WebGL2 fallback and WebGPU optional path
- [ ] Timeline coordinate model
- [ ] Sample-accurate zoom/scroll/playhead
- [ ] Explicit time/channel/object/spectral-selection data model (spectral rendering later)
- [ ] Snapping engine
- [ ] Multiple views per asset
- [ ] Waveform/spectrogram presentation shell
- [ ] Tool/input hit-testing
- [ ] Video reference transport/timecode/markers
- [ ] N-channel waveform layout

## Explicitly Out of Scope

- Actual spectral repair
- Core audio mutation/edit operations
- Full codecs beyond fixtures
- Multitrack

## Owned Modules / Packages

- `packages/renderer`
- `packages/timeline`
- `packages/waveform`
- `packages/editor-view`
- `packages/video-reference`
- `apps/web editor surface`

## Cross-Package Dependency Rules

- Renderer consumes view/domain projections but cannot own authoritative edits.
- Waveform cache depends on media identity/revision, not UI component lifetime.
- Video reference binds to media clock without entering audio edit domain.

## Required Public Contracts

- TimelineCoordinate/SamplePosition
- ViewportState
- SelectionSet
- SnapTarget/SnapResult
- WaveformPeakPyramid
- EditorViewState
- RendererBackend
- ReferenceMediaClockBinding

## Data / Schema Changes

- Introduces disposable waveform-peak/spectrogram-shell cache formats and persisted per-view presentation state where appropriate.
- Selection/timeline domain types that affect commands are versioned public contracts.

## Browser / Platform Considerations

- WebGL2 baseline, optional WebGPU, reduced renderer fallback.
- Touch/stylus Pointer Events and high-DPI handling are capability-sensitive.
- Video decode/frame access varies by browser and is reference-only.

## Architectural Invariants

- Authoritative project state never lives only in graphics scene objects.
- Renderer is reconstructible after context/device loss.
- Sample coordinates are integer-safe and not derived from lossy pixel floats.
- Selection types remain explicit; command target precedence is deterministic.
- Video remains reference media, not an editable video domain.

## Internal Work Units

### WU-04.A — Timeline coordinates and selection

- [ ] Implement sample/time coordinate conversion and huge-timeline precision
- [ ] Implement explicit selection types and precedence
- [ ] Implement snapping targets and zero-crossing integration hook

### WU-04.B — Waveform analysis/cache

- [ ] Generate progressive multi-resolution peaks off UI thread
- [ ] Persist disposable peak caches keyed to source identity/revision
- [ ] Support N-channel peak data

### WU-04.C — Renderer

- [ ] Implement renderer backend abstraction
- [ ] Implement WebGL2 production path, capability-tested WebGPU path and reduced fallback
- [ ] Implement hit testing, overlays, DPI scaling and device/context-loss recovery

### WU-04.D — Multi-view/editor tools

- [ ] Implement independent per-view zoom/scroll/display/tool state
- [ ] Implement pan/zoom/select/razor navigation shell for mouse/touch/pen
- [ ] Preserve selections through non-destructive navigation

### WU-04.E — Video reference

- [ ] Implement reference video panel/transport binding
- [ ] Implement frame/timecode display and picture-aligned markers
- [ ] Handle unsupported decode capabilities explicitly

## Failure and Recovery Behaviour

- Renderer/device loss must reconstruct view from state.
- Missing/stale waveform cache must regenerate without affecting project validity.
- Huge zoom/scroll ranges must not accumulate sample-position drift.
- Unsupported video formats must not break audio projects.

## Required Verification Commands / Suites

- `pnpm test --filter timeline --filter waveform --filter renderer`
- `pnpm test:e2e:timeline`
- `pnpm test:renderer-loss`
- `pnpm test:touch-pen`
- `pnpm test:video-reference`

## Acceptance Criteria

- [ ] Users can zoom to and select individual samples without coordinate drift.
- [ ] Large test assets scroll/zoom without rebuilding peaks from raw PCM per frame.
- [ ] Multiple views of one asset retain independent presentation state while reflecting shared domain changes.
- [ ] Zero-crossing/sample/marker/region/playhead snapping produces deterministic results.
- [ ] Renderer recovers from forced context/device loss.
- [ ] Reference video stays within defined synchronisation tolerance during play/scrub.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No DOM element per sample/peak.
- No waveform generation on main UI thread.
- No selection state hidden only inside canvas objects.
- No implicit stereo assumptions in waveform lanes.

## Required Review Lenses

- Architecture
- Performance / Scalability
- UX / Accessibility / Input
- Testing / Regression
- Audio Correctness
- Browser Compatibility
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-04.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
