# Phase 03 — Audio Engine Foundation

## Status

`READY` — Phase 01, its one hard dependency, has reached `PASS`; see `traceability/handoffs/phase-01.md`.

## Objective

Implement the N-channel, deterministic, local-first audio-engine foundation: transport, media clock, real-time graph execution, offline rendering, Rust/WASM bridge, capability-based acceleration, quality/performance profiles, and latency accounting.

## User-Visible Outcome

AudioGubbins can play deterministic test PCM through a robust transport and processing graph, render it offline at maximum quality, report capabilities/latency, and degrade performance paths without losing core functionality.

## Hard Dependencies

- Phase 01 — Application Foundation

## Owned Requirements

- `REQ-PROD-009` — Audio Duration and Scale (`CURRENT`)
- `REQ-ARCH-011` — Audio Precision (`CURRENT`)
- `REQ-ARCH-036` — Processing Architecture Direction (`CURRENT`)
- `REQ-ARCH-049` — Deterministic Rendering (`CURRENT`)
- `REQ-ARCH-079` — Adaptive Processing Modes (`CURRENT`)
- `REQ-ARCH-081` — Canonical Deterministic Processing (`CURRENT`)
- `REQ-ARCH-083` — Audio Performance Profiles (`CURRENT`)
- `REQ-ARCH-084` — Foreground and Background Processing Priority (`CURRENT`)
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate (`CURRENT`)
- `REQ-ARCH-087` — Resource-Aware Operation Without Artificial Limits (`CURRENT`)
- `REQ-ARCH-088` — Fully Local Core Processing (`CURRENT`)
- `REQ-ARCH-140` — Typed Directed Processing Graph (`CURRENT`)
- `REQ-ARCH-141` — DSP Implementation Languages (`CURRENT`)
- `REQ-ARCH-144` — Processor Latency and Automatic Delay Compensation (`CURRENT`)
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio (`CURRENT`)

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

- [ ] N-channel/layout-aware PCM model
- [ ] Web Audio/AudioWorklet real-time engine
- [ ] Typed directed processing graph foundation
- [ ] Rust/WASM DSP core boundary
- [ ] Canonical offline render pipeline
- [ ] Transport/media clock
- [ ] Processor latency reporting and delay-compensation foundation
- [ ] Performance/quality profiles
- [ ] Worker scheduling and foreground priority
- [ ] Capability-aware GPU/shared-memory hooks without hard dependency
- [ ] Resource-aware streaming/chunking primitives

## Explicitly Out of Scope

- Full processor library
- File codecs
- Recording
- Waveform renderer
- Multitrack UI

## Owned Modules / Packages

- `packages/audio-engine`
- `packages/audio-graph`
- `packages/audio-runtime`
- `crates/dsp-core`
- `crates/resampling`
- `crates/wasm-bindings`
- `packages/capabilities`

## Cross-Package Dependency Rules

- Audio engine depends on domain-neutral audio contracts and WASM bindings, never React.
- Rust/WASM boundary stays narrow; TypeScript orchestration must not leak browser/UI types into DSP crates.

## Required Public Contracts

- ChannelLayout
- AudioFrameBlock/stream contract
- Transport
- MediaClock
- ProcessingGraph
- ProcessorLatency
- RenderJob
- RenderQualityProfile
- AudioRuntimeCapabilities

## Data / Schema Changes

- Introduces versioned runtime/interchange types for channel layouts, graph descriptors, render jobs and processor latency; they are not yet user project processor schemas unless explicitly persisted by Phase 6.

## Browser / Platform Considerations

- AudioWorklet/Web Audio availability and lifecycle differ across browsers/devices.
- SharedArrayBuffer/threaded WASM and WebGPU are optional accelerators.
- Audio context autoplay/suspend policies require explicit handling.

## Architectural Invariants

- No stereo-only core arrays/APIs.
- Final render path targets deterministic output for same version/input/settings.
- Real-time/audio threads never depend on React.
- Heavy offline work runs outside UI thread.
- Processor latency is explicit; unknown latency cannot silently enter parallel paths.

## Internal Work Units

### WU-03.A — Audio domain

- [ ] Define channel-layout semantics, PCM/block types and sample-rate rules
- [ ] Implement media clock and transport state machine

### WU-03.B — Real-time graph

- [ ] Implement AudioWorklet-safe graph runtime and message contracts
- [ ] Implement graph lifecycle and parameter smoothing foundations

### WU-03.C — Rust/WASM and offline renderer

- [ ] Create narrow Rust/WASM ABI
- [ ] Implement deterministic DSP primitives/resampling baseline
- [ ] Implement chunked offline renderer with maximum-quality default

### WU-03.D — Latency and scheduling

- [ ] Implement processor latency accounting/compensation primitives
- [ ] Implement foreground/background priorities and resource-aware chunking

### WU-03.E — Capability profiles

- [ ] Implement low-latency/balanced/stability/custom profiles
- [ ] Expose capability/degradation reasons without hiding features

## Failure and Recovery Behaviour

- AudioWorklet underruns must be observable and diagnosable.
- WASM/accelerator failure must fall back to a documented supported path.
- Large media processing must avoid whole-file duplication assumptions.
- Device/context suspension and resume must preserve transport correctness.

## Required Verification Commands / Suites

- `cargo test --workspace`
- `pnpm test --filter audio-engine`
- `pnpm test:audio-golden`
- `pnpm test:audio-latency`
- `pnpm test:worker-responsiveness`

## Acceptance Criteria

- [ ] Golden PCM renders are deterministic on canonical path within documented unavoidable platform limits.
- [ ] N-channel tests cover mono, stereo, 5.1 and a custom layout without truncation/reordering.
- [ ] UI remains responsive during representative offline renders.
- [ ] Latency metadata propagates through serial/parallel graph paths.
- [ ] Performance profiles change scheduling/buffering without changing required feature availability.
- [ ] Audio context suspend/resume and device capability changes recover cleanly.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No browser-native decoder/DSP implementation as sole canonical final-render dependency.
- No WebGPU/SharedArrayBuffer hard requirement.
- No full-file copies as the normal long-file processing model.
- No stringly typed AudioWorklet message protocol.

## Required Review Lenses

- Audio / DSP Correctness
- Architecture
- Performance / Scalability
- Testing / Regression
- Browser Compatibility
- Code Quality / Maintainability
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-03.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
