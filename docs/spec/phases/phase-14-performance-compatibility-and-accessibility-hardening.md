# Phase 14 — Performance, Compatibility, and Accessibility Hardening

## Status

`NOT_READY` — blocked by Phase(s) 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13 reaching `PASS`.

## Objective

Perform cross-cutting performance, compatibility, accessibility, input-device, memory/storage, and resilience hardening across every implemented capability without removing features to satisfy arbitrary metrics.

## User-Visible Outcome

AudioGubbins is robust across the supported browser/OS/device matrix, including Surface/touch/pen/mobile-landscape workflows, and has documented performance/degradation behaviour with no known blocking accessibility/data-integrity regressions.

## Hard Dependencies

- Phase 01 — Application Foundation
- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP
- Phase 07 — Recording
- Phase 08 — Spectral Editing
- Phase 09 — Import, Export, and Codec System
- Phase 10 — Game-Audio Tooling
- Phase 11 — Godot Integration
- Phase 12 — PWA, Offline, and Installation Hardening
- Phase 13 — Advanced Batch and Variation Workflows

## Owned Requirements

- `REQ-UX-029` — Mobile and Touch (`CURRENT`)
- `REQ-REPO-189` — Performance Regression Philosophy (`CURRENT`)

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

- [ ] Cross-browser/OS matrix
- [ ] Mobile/tablet/Surface layouts and landscape preference
- [ ] Keyboard-only and assistive accessibility audits
- [ ] Touch/pen gesture stress tests
- [ ] Memory/storage pressure
- [ ] Long-file/large-project tests
- [ ] Performance benchmark baselines/regression detection
- [ ] GPU/device/audio-context loss
- [ ] Offline/update/recovery stress
- [ ] N-channel/surround/ambisonic end-to-end validation
- [ ] Video-reference synchronisation validation

## Explicitly Out of Scope

- Dropping features solely to hit a benchmark
- Introducing unrelated new product subsystems

## Owned Modules / Packages

- `tests/compatibility`
- `tests/performance`
- `tests/accessibility`
- `tests/stress`
- `all packages as remediation targets`

## Cross-Package Dependency Rules

- Hardening changes stay within existing package ownership unless an ADR justifies a boundary correction.
- Test harnesses may observe packages but must not become production dependencies.

## Required Public Contracts

- PerformanceBaseline report
- CompatibilityMatrix
- AccessibilityEvidence
- DegradationMatrix

## Data / Schema Changes

- No new authoritative product schema is expected; benchmark baselines, compatibility matrices and accessibility evidence are verification artefacts.
- Any schema change required by a verified defect must follow the owning subsystem's change policy.

## Browser / Platform Considerations

- This phase explicitly covers the supported browser/OS/device matrix, including Surface-class touch/pen and phone landscape.
- Fallback and degraded paths receive first-class validation.

## Architectural Invariants

- Performance gates identify regressions; they do not authorise feature removal.
- Fallback paths preserve correctness and explain degradation.
- Hardening fixes must preserve package/domain boundaries.

## Internal Work Units

### WU-14.A — Compatibility matrix

- [ ] Run supported Chromium/Firefox/Safari-class and OS/device coverage
- [ ] Verify fallback/degradation surfaces

### WU-14.B — Accessibility/input

- [ ] Audit keyboard/focus/semantics/contrast/reduced motion
- [ ] Test touch/pen/hybrid layouts including Surface-class and phone landscape

### WU-14.C — Performance/stress

- [ ] Benchmark startup, interaction, waveform, DSP, import/export, batch, memory and bundle size statistically
- [ ] Stress long files, N-channel projects, storage pressure and background jobs

### WU-14.D — Resilience

- [ ] Inject renderer/audio/device loss, quota errors, tab termination and update interruption
- [ ] Remediate every verified blocking/high finding and add regressions

## Failure and Recovery Behaviour

- Any test-induced crash/corruption must produce a reproducible fixture before PASS.
- Browser-specific unsupported capabilities must remain explicit rather than quietly disabled.

## Required Verification Commands / Suites

- `pnpm test:browser-matrix`
- `pnpm test:a11y`
- `pnpm test:performance`
- `pnpm test:stress`
- `pnpm test:recovery`
- `cargo test --workspace`
- GUT suite

## Acceptance Criteria

- [ ] No unresolved BLOCKER/CRITICAL/HIGH cross-matrix finding.
- [ ] All core workflows are keyboard-operable where realistically applicable and specialised visual tools expose accessible alternatives/status.
- [ ] Touch/pen/mouse/keyboard hybrid input does not corrupt gesture/tool state.
- [ ] Performance regressions outside documented statistical tolerances are investigated and fixed/justified without deleting required capability.
- [ ] Long-duration/N-channel/stress projects remain recoverable under memory/storage pressure.
- [ ] Compatibility/degradation matrix is complete and user-facing explanations match actual runtime behaviour.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No arbitrary 'max file length/region count' introduced as a performance fix.
- No disabling required feature on a browser when a viable slower fallback exists.
- No accessibility overlay/plugin used as substitute for semantic implementation.

## Required Review Lenses

- Performance / Scalability
- Browser / PWA Compatibility
- UX / Accessibility / Input
- Data Integrity / Recovery
- Audio / DSP Correctness
- Architecture
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-14.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
