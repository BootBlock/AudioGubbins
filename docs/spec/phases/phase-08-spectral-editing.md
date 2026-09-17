# Phase 08 — Spectral Editing

## Status

`NOT_READY` — blocked by Phase(s) 03, 04, 05, 06 reaching `PASS`.

## Objective

Implement interactive spectral analysis and non-destructive spectral editing/repair using scalable spectrogram tiling, explicit time-frequency selections, deterministic operations, and integration with local restoration/ML capabilities.

## User-Visible Outcome

Users can inspect and edit frequency/time regions with marquee/lasso/brush-style tools, attenuation/removal/heal/repair operations, preview/A-B, and recoverable parametric history.

## Hard Dependencies

- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP

## Owned Requirements

- `REQ-AUDIO-016` — Spectral Editing (`CURRENT`)

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

- [ ] Spectrogram analysis/tile cache
- [ ] Frequency/time coordinate system
- [ ] Spectral selections
- [ ] Marquee/lasso/brush tools
- [ ] Attenuate/remove/heal/repair operations
- [ ] Selection-sensitive spectral processing
- [ ] GPU-accelerated display with fallbacks
- [ ] Integration with cleanup/ML processors
- [ ] Spectral cache invalidation

## Explicitly Out of Scope

- General image/video editing
- Cloud spectral processing

## Owned Modules / Packages

- `packages/spectral-analysis`
- `packages/spectral-editing`
- `packages/renderer spectral layers`
- `crates/analysis`

## Cross-Package Dependency Rules

- Spectral domain uses audio/analysis contracts and command/history layers.
- Renderer tiles/caches are not authoritative spectral edit state.

## Required Public Contracts

- SpectralTileKey
- SpectralSelection
- SpectralMask
- SpectralEditOperation
- SpectrogramConfig

## Data / Schema Changes

- Introduces persisted spectral-edit operations/masks where authoritative, plus disposable spectrogram-tile cache formats.

## Browser / Platform Considerations

- GPU compute/render acceleration optional; CPU/worker/WASM fallback required where viable.
- Touch/pen pressure is optional; fixed-strength deterministic tools always exist.

## Architectural Invariants

- Spectrogram tiles/masks derived for preview are caches unless explicitly part of an edit operation.
- Spectral edits are non-destructive and survive reload/history.
- Frequency/time selection maps to sample coordinates deterministically.
- GPU acceleration never changes authoritative spectral edit semantics.

## Internal Work Units

### WU-08.A — Spectral analysis/cache

- [ ] Implement FFT/STFT configuration and multi-resolution tile generation off UI thread
- [ ] Persist/regenerate disposable tiles

### WU-08.B — Spectral interaction

- [ ] Implement coordinate transforms, selections and tools
- [ ] Integrate pressure-optional brush strength and fixed deterministic mode

### WU-08.C — Repair operations

- [ ] Implement attenuation/remove/heal/repair as parametric operations
- [ ] Integrate processor/ML backends with preview/final quality

### WU-08.D — Verification/UX

- [ ] Add A/B comparison, overlays and explicit selection-target feedback
- [ ] Validate large-file and fallback renderer behaviour

## Failure and Recovery Behaviour

- Stale/missing spectral tiles regenerate safely.
- Unsupported GPU/FFT capability falls back without losing core spectral functionality.
- ML/model unavailability is explicit.

## Required Verification Commands / Suites

- `pnpm test --filter spectral`
- `cargo test -p analysis`
- `pnpm test:spectral-golden`
- `pnpm test:e2e:spectral`

## Acceptance Criteria

- [ ] Spectral edits round-trip through project persistence and branch history.
- [ ] Time-frequency selection remains aligned across zoom levels and renderer resets.
- [ ] Reference spectral operations produce stable golden outputs.
- [ ] Large spectrograms stream/tile without whole-file GPU allocation.
- [ ] Fixed-strength stylus/mouse editing remains deterministic regardless of pressure hardware.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No destructive baking as the only representation of spectral repair.
- No main-thread full-file STFT.
- No GPU-only implementation without fallback.

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

## Handoff Capsule

Create `traceability/handoffs/phase-08.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
