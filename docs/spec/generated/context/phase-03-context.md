# AudioGubbins Phase 03 Context Pack

> **Generated artefact. Do not edit.**
> This is the bounded context intended for a fresh implementation/review agent. Canonical source remains the modular specification.

# Global Agent Execution Contract

# Agent Execution Contract

> **Normative authority:** `requirements/execution.md`, especially `REQ-EXEC-136`, `REQ-EXEC-167` through `REQ-EXEC-184`, and `REQ-EXEC-201` through `REQ-EXEC-219`.
>
> This contract is loaded for every implementation and review context. It is intentionally concise; referenced requirement IDs contain the complete normative detail.

## Non-Negotiable Rules

1. Implement only from a **READY** Phase Packet. Do not infer a phase from the compiled specification.
2. Do not reduce, postpone, stub, fake, or reinterpret scope because it is difficult.
3. If a requirement is impossible, contradictory, or unsafe, use the deviation protocol in `REQ-EXEC-168`; do not silently change it.
4. UI code must not mutate authoritative project state outside the typed command/domain boundary.
5. Do not create god objects, catch-all managers, giant stores, universal event buses, hidden global state, or speculative generic frameworks.
6. Do not use YAGNI, DRY, KISS, SOLID, or named patterns as slogans. Apply them only when they preserve documented capability and cohesion.
7. A production `TODO`, `FIXME`, `HACK`, placeholder, dummy implementation, `Not implemented` branch, or silent fallback is a gate failure unless explicitly authorised by the current Phase Packet.
8. Do not weaken tests, update golden data without evidence, mock away the behaviour under test, or suppress failures.
9. Refactor touched architecture when necessary to preserve boundaries. Do not perform unrelated sweeping rewrites.
10. Significant architectural decisions require an ADR and adversarial review.
11. Work in isolated Git worktrees when agents run concurrently. Integrate using atomic commits and direct merge into `main`; do not assume a PR workflow.
12. The implementing agent cannot approve its own phase. Independent multi-lens and adversarial review is mandatory.
13. Reviewer findings are hypotheses until verified. Verified genuine findings must be remediated according to severity before PASS.
14. Every requirement claimed complete must have evidence and a verification mechanism.
15. Never rely on the full compiled specification being resident in context. Load the Phase Context Pack and retrieve extra requirements by ID as needed.

## Mandatory Context Load Order

1. This contract.
2. `architecture-invariants.md`.
3. Current `phases/phase-XX-*.md`.
4. Requirement blocks named in that Phase Packet.
5. Referenced ADRs.
6. Public contracts and handoff capsules from prerequisite phases.
7. Relevant implementation-ledger entry.

## Stop Conditions

The agent must stop the current implementation path and mark the phase `BLOCKED` when:

- a blocker/critical contradiction cannot be resolved from authoritative sources;
- an upstream public contract is missing or incompatible;
- data integrity would be put at risk;
- a mandatory requirement is technically impossible and no approved fallback exists;
- the Phase Packet itself fails specification linting.

Stopping a path is not permission to abandon the phase. Record the issue, evidence, and recommended resolution.

# Global Architecture Invariants

# Global Architecture Invariants

These invariants apply to every phase. Violations are gate failures unless an approved ADR/specification change explicitly supersedes the invariant.

## State and Domain

- `REQ-ARCH-004`: source media is immutable by default; editing is non-destructive and parametric.
- `REQ-EDIT-073`: meaningful project mutations go through the typed command/domain layer.
- `REQ-ARCH-153`: authoritative domain, persisted history, user preferences, workspace/view state, renderer state, audio runtime state, and background-job state have explicit owners and lifetimes.
- Domain truth has one authoritative home. UI, persistence, workers, and Godot integrations may adapt domain results but must not reimplement rules independently.

## Dependency Direction

- UI depends on application/domain contracts, never persistence internals.
- Domain packages do not import browser-specific adapters.
- Persistence schemas do not become the domain model.
- DSP/audio domains do not depend on React or visual renderer internals.
- Godot integration consumes stable interchange contracts and does not reach into unrelated web-editor internals.
- Cross-package access uses public typed APIs; importing private package internals is prohibited.
- Circular package dependencies are prohibited.

## Media and Processing

- `REQ-ARCH-157`: the core channel model is N-channel and layout-aware; stereo assumptions are local adaptations only.
- `REQ-ARCH-049` and `REQ-ARCH-081`: deterministic canonical processing is the target for final render paths.
- `REQ-ARCH-144`: processor latency is explicit and compensable.
- Heavy analysis, DSP, codecs, waveform generation, spectrogram generation, import/export, and batch work must not block the UI thread.
- Derived waveform/spectrogram/render data is disposable cache, never the sole authoritative project state.

## Local-First and Privacy

- Core editing and rendering remain local and offline-capable.
- No diagnostics, logs, project metadata, capability data, audio, or other user data is transmitted without explicit permission.
- No usage analytics.
- Future cloud/native-host/plugin capabilities remain optional and cannot become hidden core dependencies.

## Failure and Recovery

- Errors have explicit recoverability semantics; blanket catches and silent fallback are prohibited.
- Project mutations and persistence operations protect data integrity across crash, tab termination, quota failure, and partial I/O.
- External side effects are never falsely represented as undoable.

## Extensibility Without Speculation

- Preserve explicitly documented future multitrack, plugin, cloud, and native-host extension boundaries.
- Do not implement speculative user-facing future features before their owning phase.
- Extension points must be concrete and narrow, not universal frameworks.

## Cohesion

- REQ-EXEC-136.7: "A **production** source file approaching roughly 300–400 logical lines should trigger a cohesion review", and "A function approaching roughly 50–70 logical lines should trigger a decomposition review". Thresholds are review triggers, not automatic failures or code-golf targets.
- Large fan-in/fan-out, giant stores, deep inheritance, unrelated responsibilities, and repeated domain conditionals trigger architectural review.

# Current Phase Packet

# Phase 03 — Audio Engine Foundation

## Status

`PASS` — completed on 2026-09-29; see `reviews/phase-03-evidence.md`, `reviews/phase-03-review.md` and `traceability/handoffs/phase-03.md`.

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

# Referenced Requirement Blocks

## REQ-PROD-009 — Audio Duration and Scale

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 9 of the pre-hardening baseline

The application must support audio ranging from:

- Very short game sound effects
- One-shots
- Loops
- Dialogue clips
- Music
- Ambience
- Recordings lasting tens of minutes

The application must not impose arbitrary artificial duration limits.

Architecture should avoid requiring entire large assets to remain duplicated in memory.

---

## REQ-ARCH-011 — Audio Precision

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 11 of the pre-hardening baseline

Recommended baseline:

- 32-bit floating-point working PCM for normal editing and real-time processing
- Higher precision for offline calculations where materially beneficial
- Export precision independent of working precision
- No repeated unnecessary quantisation between operations

Where feasible, users should be given meaningful quality/precision controls rather than being locked to one mode.

---

## REQ-ARCH-036 — Processing Architecture Direction

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 36 of the pre-hardening baseline

Heavy processing must not block the UI thread.

The architecture should support separation between:

- UI/controller layer
- Project/domain model
- Real-time playback
- AudioWorklet processing
- Worker-based offline computation
- WebAssembly processing where beneficial
- Codec subsystem
- Storage subsystem
- Rendering/cache subsystem

The UI thread must remain responsive during:

- Waveform generation
- Spectrogram generation
- Import
- Export
- Analysis
- DSP
- Batch processing

---

## REQ-ARCH-049 — Deterministic Rendering

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 49 of the pre-hardening baseline

The application shall aim for deterministic rendering wherever technically practical.

Given identical:

- Source audio
- Project state
- Processor settings
- Export settings
- Application version

rendered output should be reproducible across supported browsers and machines where feasible.

This requirement should influence DSP, codec, and resampling architecture.

Where browser-native behaviour is not deterministic enough for a required feature, application-owned or WebAssembly-based processing may be preferred.

Any unavoidable sources of platform-dependent variation must be documented.

---

## REQ-ARCH-079 — Adaptive Processing Modes

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 79 of the pre-hardening baseline

Computationally expensive operations may execute using different strategies depending on workload and runtime capability.

Supported execution strategies should include:

- Real-time processing
- Cached/pre-rendered preview processing
- Background offline processing
- High-quality final offline rendering

AudioGubbins should automatically select an appropriate strategy using measured runtime capability and workload characteristics while allowing advanced users to override the strategy where meaningful.

The selected processing mode must remain visible and understandable to the user.

---

## REQ-ARCH-081 — Canonical Deterministic Processing

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 81 of the pre-hardening baseline

AudioGubbins shall aim for deterministic, reproducible output wherever technically practical.

The long-term canonical processing path should favour application-controlled DSP, resampling, and encoding implementations when that materially improves reproducibility.

Browser-native implementations may be used as accelerators or convenience paths when they meet correctness and reproducibility requirements.

Given identical source data, project state, processing settings, export settings, and AudioGubbins version, the target is bit-identical PCM output across supported machines and browsers wherever feasible.

Where bit-identical behaviour cannot be guaranteed, the cause and expected tolerance must be documented and tested.

---

## REQ-ARCH-083 — Audio Performance Profiles

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 83 of the pre-hardening baseline

AudioGubbins shall provide configurable audio-performance profiles.

At minimum:

- Low Latency
- Balanced
- Maximum Stability
- Custom

The application should measure relevant runtime behaviour and warn when the selected configuration is producing underruns, drop-outs, or instability.

Where possible, the application should recommend appropriate settings based on observed device/browser performance without preventing expert manual configuration.

---

## REQ-ARCH-084 — Foreground and Background Processing Priority

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 84 of the pre-hardening baseline

Interactive editing and playback shall receive priority over background processing by default.

Background tasks such as:

- Analysis
- Peak generation
- Spectrogram generation
- Batch rendering
- Batch encoding
- Cache regeneration

may reduce their concurrency or throughput while interactive work is active.

The user shall be able to select alternate priority policies, including a throughput-oriented mode that prioritises batch/background completion when interactive responsiveness is not required.

---

## REQ-ARCH-085 — Native Asset Sample Rates and Future Session Rate

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 85 of the pre-hardening baseline

During single-asset editing, source assets should retain their native sample rates internally wherever practical.

AudioGubbins must avoid unnecessary resampling merely to conform to a global project rate.

When multitrack sessions are introduced, a session or mix sample rate may be defined while preserving original source assets at their native rates.

Resampling must remain explicit, deterministic, and high quality.

---

## REQ-ARCH-087 — Resource-Aware Operation Without Artificial Limits

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 87 of the pre-hardening baseline

AudioGubbins must not impose arbitrary fixed limits on:

- Audio duration
- Region count
- Marker count
- Undo/redo depth
- Project asset count
- Batch size
- Analysis duration
- Other scalable project structures

Instead, the application should measure available resources and estimate workload requirements.

When an operation may exhaust memory, storage, compute capacity, or browser limits, the application should:

1. Warn the user clearly.
2. Explain the limiting resource.
3. Offer safer execution strategies where possible.
4. Prefer streaming, chunked, tiled, paged, or incremental processing over outright refusal.
5. Allow knowledgeable users to proceed where doing so is technically safe.

---

## REQ-ARCH-088 — Fully Local Core Processing

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 88 of the pre-hardening baseline

All core DSP, analysis, rendering, encoding, decoding, waveform generation, and project processing must remain local and offline-capable once required application assets are available.

AudioGubbins must never silently upload work or switch to remote/cloud processing because a local device is slow.

Any future cloud-assisted processing must be:

- Explicitly enabled by the user
- Clearly identified
- Optional
- Provider-aware
- Privacy-transparent
- Non-essential to the core editor

---

## REQ-ARCH-140 — Typed Directed Processing Graph

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 140 of the pre-hardening baseline

The canonical processing architecture shall be a typed directed graph rather than a permanently linear effect-chain implementation.

The initial user interface may present conventional linear effect racks for approachability, but the engine must support future graph capabilities without architectural replacement.

The graph architecture must be capable of representing:

- Serial processing
- Parallel branches
- Split/mix paths
- Wet/dry paths
- Side-chain inputs
- Mid/side branches
- Analysis-only nodes
- Render/cache nodes
- Future multitrack sends and returns
- Future buses
- Future parameter-controlled routing
- Reusable subgraphs
- Future plugin-host nodes

Graph nodes and edges must use explicit typed contracts.

Invalid graph states must be rejected deterministically with actionable diagnostics.

The graph implementation must avoid a central god-object processor manager. Node lifecycle, scheduling, graph validation, latency propagation, and render planning should be decomposed into cohesive subsystems with explicit ownership and dependency direction.

---

## REQ-ARCH-141 — DSP Implementation Languages

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 141 of the pre-hardening baseline

TypeScript remains the primary application, domain, orchestration, and UI language.

Performance-critical, numerically sensitive, safety-critical, or deterministic DSP infrastructure should use WebAssembly where it provides material benefits.

For new AudioGubbins-owned WASM/DSP infrastructure, Rust is the preferred default implementation language because of:

- Memory safety
- Strong type system
- Mature WebAssembly support
- Suitability for deterministic numerical code
- Strong tooling
- Good interoperability with generated bindings

This is a default, not an ideological restriction.

Mature C/C++ or other native-code libraries may be used where they provide objectively stronger DSP, codec, numerical, or interoperability capabilities and satisfy licensing, security, maintainability, portability, and deterministic-render requirements.

Language selection must never be made solely because one option is easier or faster for the implementation agent.

Bindings between TypeScript and WASM must use narrow, documented, typed interfaces and avoid leaking implementation-specific memory ownership throughout the application.

---

## REQ-ARCH-144 — Processor Latency and Automatic Delay Compensation

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 144 of the pre-hardening baseline

Processor latency must be a first-class engine concept from the initial DSP architecture.

Processors that introduce latency must report it accurately or expose sufficient information for the engine to calculate it.

Examples include:

- Look-ahead dynamics
- Linear-phase filtering
- Convolution
- Spectral processing
- ML inference
- Oversampled processors
- Time-domain buffering

The processing graph must propagate latency information and provide automatic delay compensation where required so that:

- Parallel processing paths remain phase/time aligned
- Future multitrack playback remains aligned
- Side chains remain coherent
- Offline renders remain sample-correct
- Monitoring latency can be reported accurately

Latency compensation must not be retrofitted as a future multitrack-only concern.

---

## REQ-ARCH-157 — Multichannel, Surround, and Ambisonic Audio

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 157 of the pre-hardening baseline

AudioGubbins shall support professional multichannel authoring beyond mono and stereo.

The channel model must be layout-aware rather than relying only on channel count. It should be capable of representing, validating, displaying, processing, and exporting layouts such as:

- Mono
- Stereo
- LCR
- Quadraphonic layouts
- 5.1
- 7.1
- Other discrete-channel layouts supported by relevant formats
- Ambisonic channel sets and ordering/normalisation conventions where supported
- Custom labelled channel maps

The architecture shall include explicit channel-layout metadata and channel-role identity. Channel order must not be inferred from array position alone when a format or workflow requires semantic channel identity.

Waveform, metering, selection, processor, routing, analysis, export, and future multitrack contracts must all be designed for N-channel operation.

Where a processor cannot support an input layout, it must declare that limitation explicitly and provide a well-defined adaptation policy where one is acoustically valid. Silent downmixing or accidental channel truncation is prohibited.

AudioGubbins should support professional channel-layout operations, including:

- Remapping
- Reordering
- Extraction
- Duplication
- Downmixing
- Upmix-assist workflows where appropriate
- Per-channel gain/polarity/delay
- Linked and unlinked processing
- Mid/side and other matrix operations
- Surround metering
- Phase/correlation analysis
- Ambisonic encode/decode/rotate/normalisation utilities where supported

Export recipes must preserve or intentionally transform channel-layout metadata according to explicit user configuration.

---

## REQ-EXEC-136 — AudioGubbins Agent Implementation Guardrails

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 136 of the pre-hardening baseline

This specification is intended to be implemented by an advanced coding agent. The agent must therefore follow explicit architectural guardrails rather than relying on generic coding slogans or default AI-generated project structure.

These guardrails are requirements, not optional style advice.

#### 136.1 Principles Are Heuristics, Not Excuses

The implementation agent must not apply slogans such as YAGNI, DRY, KISS, SOLID, or design-pattern names mechanically.

In particular:

- **YAGNI must not be used to reject future capabilities explicitly required by this specification.** Documented future multitrack, plugin, Godot runtime, cloud, automation, and other extension requirements are real architectural constraints even when their user-facing feature is scheduled later.
- **DRY must not force unrelated concepts into shared abstractions merely because their current code looks similar.** Prefer duplication over incorrect coupling when two concepts do not yet share a stable domain abstraction.
- **KISS must not be interpreted as "choose the least capable architecture".** Simplicity means clear boundaries and comprehensible design, not sacrificing robustness or future requirements.
- **SOLID must not be reduced to excessive interfaces, one-method classes, or dependency-injection ceremony.** Apply the underlying design intent where it improves cohesion and substitutability.
- A named design pattern is not evidence that a design is good. Patterns must solve an actual documented problem.

#### 136.2 No God Objects or Monolithic Modules

The implementation must not centralise unrelated responsibility into objects such as:

- `AppManager`.
- `AudioManager`.
- `ProjectManager`.
- `StateManager`.
- `GodService`-style orchestration classes.
- Giant stores that own unrelated domains.
- Mega-components containing workspace, audio, persistence, transport, and editing behaviour together.

Names such as `Manager`, `Service`, `Controller`, `Engine`, or `System` are permitted only when the implementation has a narrow, explicit, cohesive ownership boundary.

Modules should be organised around stable domain responsibilities and dependency direction.

#### 136.3 Cohesive Module Boundaries

Each module/package must have:

- A clearly stated responsibility.
- Explicit public contracts.
- Explicit dependencies.
- A reason for ownership of its state.
- Tests at the appropriate boundary.

Likely bounded areas include, subject to architecture refinement:

- Project domain.
- Asset/media domain.
- Timeline/edit domain.
- Command system.
- Undo/history.
- Persistence.
- Codec/import/export.
- DSP graph.
- Realtime playback.
- Recording.
- Analysis/waveform/spectral rendering.
- Workspace/UI shell.
- Godot interchange.
- Runtime event authoring.
- Capability detection.

Cross-domain access must occur through typed contracts rather than arbitrary imports into internal implementation details.

#### 136.4 Dependency Direction

Dependency direction must be deliberate and testable.

UI components must not become the authoritative owner of project/audio state.

UI code must not bypass the command/domain layer to mutate project data directly for convenience.

Persistence formats must not leak throughout the domain model.

Browser-specific API adapters must be isolated behind capabilities/contracts so that platform APIs do not become implicit global dependencies.

DSP domain logic should not depend on visual components.

Godot integration should consume stable interchange/domain contracts rather than reaching into unrelated editor internals.

#### 136.5 Avoid Premature Generic Abstractions

The agent must not create vague frameworks such as generic `BaseManager`, `AbstractThingFactory`, universal event buses, universal repositories, generic graph engines, or catch-all plugin systems before concrete domain requirements justify them.

Prefer:

1. A concrete cohesive implementation.
2. A second concrete use case when required.
3. Extraction of the stable shared concept only when the domain relationship is understood.

This rule does not prohibit intentionally designed extension points that are explicitly required by this specification.

#### 136.6 Avoid Hidden Coupling

Do not use implicit global mutable state as a shortcut.

Avoid hidden communication through:

- Global singleton bags.
- Unstructured event emitters.
- Stringly typed message names.
- Mutable module globals.
- DOM events as a substitute for domain contracts.
- Storage side effects as inter-module messaging.

Where event-driven communication is appropriate, events must be typed, scoped, documented, and owned by a clear subsystem.

#### 136.7 File and Function Size Review Thresholds

Source size thresholds are review triggers, not code-golf targets.

As a default:

- A production source file approaching roughly 300–400 logical lines should trigger a cohesion review.
- A function approaching roughly 50–70 logical lines should trigger a decomposition review.
- A class/object with a large number of unrelated methods or dependencies should trigger an ownership review even if its line count is small.

Exceeding a threshold is acceptable when cohesion genuinely warrants it and the reviewer records the justification.

Splitting one coherent concept into meaningless tiny files merely to satisfy a number is prohibited.

#### 136.8 Explicit Complexity Budgets

Each implementation phase must identify likely complexity hotspots.

Reviewers must actively inspect:

- Modules with unusually high dependency fan-in/fan-out.
- Deep inheritance trees.
- Large state stores.
- Highly connected event graphs.
- Repeated conditionals encoding the same domain rule.
- Functions with high branching complexity.
- Classes/modules that keep gaining unrelated responsibilities across phases.

Complexity must be reduced structurally rather than hidden behind comments or helper functions.

#### 136.9 No Phase Leakage

An implementation agent must not partially implement later phases opportunistically unless required to establish a stable current-phase contract.

If future capability requires an extension point now, implement the minimal robust contract needed now and document the deferred implementation.

Do not add half-working future features, dead UI, speculative configuration, or placeholder production APIs that will be mistaken for supported behaviour.

#### 136.10 No Permanent Temporary Hacks

Temporary compromises are allowed only when all of the following are true:

- They are necessary to unblock the current phase.
- They do not compromise data integrity or security.
- They are clearly marked in code and the phase record.
- They have an explicit removal task.
- The removal task is scheduled before the phase gate can pass unless the reviewer explicitly accepts the debt as non-blocking.

Comments such as `TODO later`, `temporary`, `quick fix`, or `hack` without a tracked remediation item are not acceptable.

#### 136.11 Domain Rules Must Have One Authoritative Home

Business/domain rules must not be independently reimplemented in UI, storage, worker, and Godot-integration layers.

Examples include:

- Selection precedence.
- Export collision policy.
- Event variation selection.
- Loop rules.
- Project-version compatibility rules.
- Command validation.

Presentation layers may adapt the result, but authoritative rules must have a single clear owner with direct tests.

This is the appropriate use of DRY: avoid duplicated **domain truth**, not superficial duplicated syntax.

#### 136.12 Typed Contracts and Runtime Validation

TypeScript compile-time typing is necessary but not sufficient at trust boundaries.

Use explicit schemas/runtime validation for:

- Project files.
- Portable bundles.
- Godot interchange manifests.
- Worker messages.
- Plugin/interchange data.
- Imported external metadata.
- Future network/cloud boundaries.

Internal contracts should avoid `any`, unbounded dictionaries, and stringly typed state when a domain type can express the invariant.

#### 136.13 Architecture Tests

Architecture constraints should be executable where practical.

The project should include automated tests/lint rules capable of detecting violations such as:

- Forbidden dependency directions.
- UI packages importing persistence internals.
- Runtime Godot code depending on editor-only APIs.
- Domain packages importing browser-specific adapters directly.
- Circular dependencies.
- Cross-package use of non-public internals.

Architecture tests are part of CI and phase review.

#### 136.14 Comments and Documentation

Comments should explain intent, invariants, non-obvious trade-offs, and reasons.

Do not generate commentary that merely restates code.

Public/domain contracts should be documented well enough for another agent or developer to use them without reading implementation internals.

Important architectural decisions should be captured as ADRs or equivalent decision records, especially where multiple valid designs were considered.

#### 136.15 Error Handling Must Be Designed

The agent must not use blanket `try/catch` blocks, silent fallbacks, or logging-and-continuing as substitutes for defined failure behaviour.

Each boundary should define:

- Recoverable errors.
- Fatal errors.
- User-actionable errors.
- Retryable errors.
- Data-integrity failures.
- Capability degradation.

Errors should preserve causal information and be presented to users at the correct abstraction level.

#### 136.16 Performance Must Not Destroy Architecture

Optimisation may introduce specialised paths, caches, worker pipelines, WASM, pooled resources, and GPU acceleration.

These optimisations must remain behind stable contracts so that performance code does not become the domain model.

Measure before and after optimisation.

Do not micro-optimise ordinary code while leaving architectural bottlenecks such as main-thread DSP, full-buffer copies, or excessive cross-thread serialisation unresolved.

#### 136.17 Reviewer Enforcement

Every phase's Architecture and Code Quality reviewers must explicitly answer:

- Did this phase introduce or enlarge a god object?
- Did any module gain unrelated responsibilities?
- Did the implementation introduce speculative abstractions without a concrete requirement?
- Did DRY/YAGNI/KISS/SOLID reasoning cause loss of required capability or incorrect coupling?
- Are dependency directions still valid?
- Is domain logic duplicated across layers?
- Are files/functions exceeding review thresholds still cohesive?
- Did UI code bypass typed command/domain APIs?
- Did temporary debt escape the phase without explicit acceptance?
- Can the next phase extend this work without invasive rewrites?

A blocking finding in these areas prevents the phase gate from passing.

---

## REQ-EXEC-167 — Agent Execution Contract

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 167 of the pre-hardening baseline

The implementation agent is expected to have full access to the AudioGubbins repository filesystem and the associated GitHub repository and to perform the implementation work directly from this specification.

This specification is the controlling implementation contract. The agent must not silently reinterpret, weaken, omit, postpone, stub, fake, or re-scope requirements because they are difficult, time-consuming, unfamiliar, or inconvenient.

The agent shall:

- Implement one gated phase at a time.
- Treat each phase TODO, invariant, required test, acceptance criterion, and review requirement as contractual.
- Preserve the architectural principles and dependency direction defined by this specification.
- Make reasonable autonomous implementation decisions where the specification intentionally leaves mechanism open.
- Record significant architectural decisions as ADRs.
- Prefer robust, explicit, maintainable architecture over expedient shortcuts.
- Refactor touched code when implementation reveals a poor abstraction rather than knowingly extending architectural debt.
- Keep unrelated sweeping rewrites outside the active phase unless they are necessary to satisfy a requirement or remove a blocking architectural defect.
- Leave the repository in a buildable, testable, reviewable state at meaningful checkpoints.

The agent must never use implementation speed or convenience as sufficient justification for reducing capability, correctness, test coverage, architectural quality, accessibility, determinism, portability, or maintainability.

---

## REQ-EXEC-170 — Independent Multi-Lens and Adversarial Review

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 170 of the pre-hardening baseline

The implementation agent may not approve its own phase.

Every phase must be reviewed through independent reviewer passes using fresh review instructions/context where practical. Reviews may be performed by separate subagents or by separate isolated reviewer invocations, but they must be operationally independent from the implementation pass.

The review system shall combine:

- Required specialist lenses defined elsewhere in this specification.
- Cross-cutting architecture review.
- Adversarial review intended to find hidden defects rather than validate the implementer's narrative.
- Requirement-compliance review against the actual phase contract.
- Regression review of previously completed phase invariants where affected.

Adversarial reviewers should actively attempt to discover:

- Missing requirements disguised as complete work.
- Incorrect assumptions about browser/platform behaviour.
- Race conditions and lifecycle bugs.
- Data-loss or recovery failures.
- Hidden coupling.
- God objects and overgrown services/managers.
- Incorrect ownership boundaries.
- UI logic bypassing the command/domain layer.
- Unbounded memory/storage behaviour.
- Audio-thread violations.
- Main-thread blocking.
- Non-deterministic final-render paths.
- Incorrect DSP edge cases.
- State corruption under failure/reload.
- Accessibility regressions.
- Mobile/touch regressions.
- Security/privacy leakage.
- Dependency or licence risks.
- Test suites that appear comprehensive but do not exercise real behaviour.
- Phase leakage or unscheduled future-work placeholders.

Reviewers must inspect implementation evidence rather than relying on the implementer's summary or checked TODO boxes.

---

## REQ-EXEC-171 — Review Finding Verification and Remediation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 171 of the pre-hardening baseline

Reviewer findings are allegations until verified.

Before altering production code in response to a finding, the implementation workflow should verify the finding using the most appropriate evidence, including where relevant:

- Reproduction
- Targeted test
- Static analysis
- Type analysis
- Instrumentation
- Audio reference comparison
- Browser/platform reproduction
- Performance profiling
- Source/documentation verification
- Architectural dependency inspection

A reviewer finding that cannot be reproduced or substantiated must not be blindly implemented as a fix merely because a reviewer emitted it.

Verified genuine findings must be corrected unless this specification explicitly permits acceptance as tracked non-blocking debt.

Corrections must receive focused re-review, including:

- Confirmation that the original issue is resolved.
- Confirmation that the fix did not create a regression.
- Re-execution of affected tests and architecture checks.
- Re-review by the relevant specialist lens when severity warrants it.

When reviewers disagree, the workflow must reconcile the disagreement using evidence, specification requirements, and architectural principles rather than majority voting.

---

## REQ-EXEC-172 — Review Severity and Gate Semantics

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 172 of the pre-hardening baseline

All review findings shall use the following common severity taxonomy:

- **BLOCKER** — implementation cannot safely or meaningfully proceed or the phase cannot be considered implemented.
- **CRITICAL** — severe correctness, data-loss, security/privacy, architectural, audio-integrity, or release-quality defect.
- **HIGH** — substantial product, correctness, performance, compatibility, accessibility, maintainability, or architecture defect.
- **MEDIUM** — meaningful defect or debt that should normally be resolved within the phase unless explicitly justified and tracked.
- **LOW** — minor defect, maintainability improvement, polish issue, or low-risk edge case.
- **NOTE** — observation, future consideration, or non-actionable context.

Gate rules:

- BLOCKER, CRITICAL, and HIGH findings always fail the phase gate until resolved and verified.
- MEDIUM findings must be resolved or explicitly accepted with written rationale, ownership, and tracking.
- LOW findings may be deferred when justified and tracked.
- NOTE findings do not block the phase.

Severity must be based on impact and likelihood, not on how difficult the fix is.

The implementation agent may not downgrade severity merely to pass a gate.

---

## REQ-EXEC-173 — No Autonomous Scope Reduction

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 173 of the pre-hardening baseline

The implementation agent must never remove, downgrade, postpone, stub, fake, simplify away, or relabel required work as future scope because implementation is difficult or the phase is large.

If the work is too large to execute safely in one coding pass, the agent may subdivide the phase internally into ordered implementation slices, provided that:

- The externally defined phase boundary remains unchanged.
- Intermediate slices do not masquerade as a completed phase.
- The phase gate remains closed until every required slice is complete.
- Intermediate architectural decisions still satisfy the final phase contract.

Phrases such as the following are not acceptable substitutes for implementation unless the specification explicitly schedules the work later:

- "Future improvement"
- "Out of scope for now"
- "Can be added later"
- "MVP implementation"
- "Simplified implementation"
- "Temporary implementation"
- "Placeholder"
- "Good enough for this phase"

The specification, not the implementation agent, defines scope.

---

## REQ-EXEC-174 — TODO and Acceptance-Criteria Integrity

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 174 of the pre-hardening baseline

Phase TODOs are contractual implementation statements.

A TODO may be marked complete only when its stated behaviour exists and all associated tests, invariants, and acceptance criteria are satisfied.

Examples of invalid completion claims include:

- Marking a feature complete because interfaces/types exist but behaviour does not.
- Marking persistence complete because data can be written but recovery/failure cases are absent.
- Marking a DSP processor complete because nominal input works but edge cases/reference validation are missing.
- Marking accessibility complete because controls have ARIA attributes without keyboard/focus testing.
- Marking mobile support complete because a desktop layout technically renders on a phone.
- Marking Godot integration complete because files export but the specified editor/runtime contracts are absent.

Reviewers must independently spot-check TODO completion against actual code, tests, generated artefacts, and runtime behaviour.

TODO checkboxes must never be treated as proof.

---

## REQ-EXEC-180 — Test Integrity and Anti-Cheating Rules

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 180 of the pre-hardening baseline

Tests are evidence of behaviour, not obstacles to be weakened until a build turns green.

The implementation agent must not:

- Remove or weaken assertions merely to pass a test.
- Update golden/reference audio output without documented technical justification and reviewer verification.
- Replace integration/E2E coverage with easier unit mocks when the requirement is integration behaviour.
- Mock the subsystem whose integration behaviour is the subject of the test.
- Assert only implementation details while failing to verify user/domain outcomes.
- Swallow exceptions or convert hard failures into warnings to make tests pass.
- Disable flaky tests without root-cause analysis and tracking.
- Add arbitrary retries to hide races.
- Mark tests skipped/todo as a substitute for required coverage.
- Alter test fixtures so that they no longer represent the required scenario.

Audio/DSP tests should use objective reference signals, tolerances, invariants, and golden/reference renders where appropriate.

Critical persistence and recovery tests should exercise process/tab interruption, partial writes, stale caches, storage pressure, and incompatible schema behaviour rather than only happy paths.

Architecture tests should verify dependency direction and prohibited imports where practical.

---

## REQ-EXEC-181 — Placeholder, Stub, and Temporary-Code Gate Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 181 of the pre-hardening baseline

Unless this specification explicitly schedules an implementation for a later phase, the following are gate failures when present in phase-owned production paths:

- `TODO`
- `FIXME`
- `HACK`
- Placeholder UI representing required behaviour
- Dummy or fabricated production data
- Empty implementations
- Unimplemented branches
- `throw new Error("Not implemented")` or equivalent
- Silent no-op fallbacks
- Temporary mock implementations
- Fake persistence
- Fake processing
- Hard-coded responses standing in for required systems
- Compatibility shims introduced contrary to the pre-1.0 schema policy
- Disabled required behaviour hidden behind an undocumented flag

A future-phase extension point is acceptable only when the current phase's required behaviour is complete and the extension point is an explicit architectural seam rather than a stub.

All temporary code must have an explicit specification-approved purpose and removal boundary.

---

## REQ-EXEC-183 — Phase Evidence Package

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 183 of the pre-hardening baseline

At the end of every implementation phase, the agent must produce a concise but complete evidence package for reviewers.

The package should include:

- Phase identifier and objective
- Completed TODO checklist
- Files/packages materially changed
- New or changed public/internal contracts
- ADRs created/updated
- Tests added/changed
- Commands used for verification
- Build/type/lint/test results
- Browser/device compatibility results required by the phase
- Performance measurements required by the phase
- Audio/DSP reference results required by the phase
- Storage/recovery results required by the phase
- Accessibility results required by the phase
- Known non-blocking limitations explicitly permitted by the specification
- Dependency additions/removals and their review
- Migration/schema impact
- Screenshots or recordings where visual/touch behaviour is part of acceptance evidence
- Reviewer findings and remediation status

The evidence package is not a substitute for reviewers inspecting the implementation. It is an index to the evidence they must verify.

---

## REQ-EXEC-184 — Architecture Enforcement Tests

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 184 of the pre-hardening baseline

AudioGubbins shall use executable architecture constraints where practical rather than relying solely on prose discipline.

Architecture tests/static rules should verify, where appropriate:

- Package dependency direction
- Prohibited cross-layer imports
- Domain code independence from React/UI implementation details
- UI inability to mutate authoritative domain state except through approved contracts/commands
- Separation of persistence from presentation
- Separation of DSP/audio-thread code from UI code
- No direct third-party implementation leakage across designated abstraction boundaries
- No circular dependencies
- Godot integration boundaries
- Browser capability access through approved capability adapters
- Diagnostic/telemetry restrictions

These tests should evolve with the architecture and be reviewed whenever package boundaries change.

An agent must not bypass an architecture test by weakening or deleting the rule unless the architectural change is deliberate, documented in an ADR, and approved by the architecture review lens.

---

## REQ-EXEC-204 — Phase Context Loading Protocol

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 204 of the pre-hardening baseline

Implementation agents must not be expected to repeatedly consume the entire full specification for every coding task.

For a phase, the agent shall load a bounded **Phase Context Pack** consisting of:

1. Global Agent Execution Contract.
2. Global architectural invariants.
3. Current Phase Packet.
4. Normative requirements explicitly referenced by that packet.
5. Public contracts/interfaces from prerequisite phases that the phase depends upon.
6. Previous phase handoff/evidence summary where directly relevant.
7. Current Architecture Decision Records referenced by the phase.
8. Current implementation ledger entries relevant to owned packages.

The agent may consult additional specification sections when necessary, but implementation must not rely on remembering unrelated sections from a previous context window.

Phase packets must reference requirements explicitly rather than saying things such as `follow the audio requirements above`.

---

## REQ-EXEC-215 — Requirements-to-Tests Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 215 of the pre-hardening baseline

Every normative behaviour that can be mechanically verified should have at least one identified verification mechanism before its implementation phase passes.

Verification mechanisms may include:

- Unit tests.
- Property-based tests.
- Integration tests.
- Browser/E2E tests.
- Audio golden/reference tests.
- Deterministic render hashes.
- GUT/Godot tests.
- Architecture tests.
- Accessibility automation plus manual checks.
- Performance/latency measurements.
- Static analysis.
- Manual evidence for behaviours that cannot be meaningfully automated.

A requirement must not be considered satisfied solely because code that appears related to it exists.

---

## REQ-EXEC-216 — No Hidden Implementation Assumptions

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 216 of the pre-hardening baseline

Phase packets shall explicitly state assumptions that materially affect correctness.

Agents must not silently assume:

- Browser APIs are universally available.
- A file fits in memory.
- Audio is stereo.
- Sample rates match.
- A Godot project is writable.
- A user is online.
- A PWA is installed.
- SharedArrayBuffer/WebGPU is available.
- Touch input implies no keyboard/mouse.
- Export destinations can be overwritten.
- External files remain unchanged.
- Storage quota is sufficient.
- A processor is zero-latency.

Capability-sensitive assumptions require explicit fallback/error behaviour.

---

# Relevant Accepted ADRs

<!-- adr/ADR-0003-audio-engine-wasm.md -->

# ADR-0003 — Canonical Audio Engine and WASM Strategy

- **Status:** Accepted
- **Decision:** Use Web Audio/AudioWorklet for real-time browser I/O and a typed processing graph, with Rust as the default language for new performance/safety-critical canonical DSP compiled to WebAssembly. Mature C/C++/other libraries may be used when objectively superior and licence-compatible.
- **Drivers:** deterministic rendering, performance, numerical correctness, local processing, portability.
- **Constraints:** SharedArrayBuffer/threaded WASM is an enhancement, not a GitHub Pages hard dependency. Final render defaults to maximum quality.
- **Related requirements:** `REQ-ARCH-036`, `REQ-ARCH-049`, `REQ-ARCH-081`, `REQ-ARCH-140`, `REQ-ARCH-141`, `REQ-ARCH-144`.

<!-- adr/ADR-0009-design-system-boundary.md -->

# ADR-0009 — Design-System Boundary and Trigger Composition

- **Status:** Accepted
- **Decision:** Every third-party UI primitive is reached only through `@audiogubbins/design-system`, which exposes AudioGubbins-named components narrower than the library beneath them. A control that has to be two things at once, such as a menu bar's trigger or a toolbar button with a hint, is supplied as one composed primitive (`MenuBarMenu`, `ControlBarButton`) rather than assembled at the call site by nesting wrappers.
- **Drivers:** one place to solve focus, naming, roles and inertness; a call site that cannot assemble an inaccessible control; the ability to replace the primitive library without touching features.
- **Constraints:** `asChild` composition only works while every component in the chain passes its props and its ref to a real element, so a wrapper whose root is another component may never be nested inside one. A composed primitive states the reason in its documentation, and a component test proves the composed control is reachable with one Tab.
- **Related requirements:** `REQ-UX-155`, `REQ-UX-005`, `REQ-EXEC-184`.

<!-- adr/ADR-0010-workspace-layout-ownership.md -->

# ADR-0010 — Workspace Layout Ownership

- **Status:** Accepted
- **Decision:** The docking engine is confined to one adapter module, and AudioGubbins stores its own layout shape: which panels are open, which group holds each, which is active and what proportion each group takes. The engine's serialised form is never persisted. A preset names the panel the user starts in, so a layout is complete before anything mounts it.
- **Drivers:** replacing or upgrading the docking engine must not migrate every user's saved workspaces; a layout has to be validated, recovered and reasoned about without a browser.
- **Constraints:** the adapter is the only module that may import the engine, enforced by the architecture rules. Anything the engine does that AudioGubbins cannot express in its own layout is not persisted. A stored layout naming a panel this build does not have falls back to a preset rather than failing to mount.
- **Related requirements:** `REQ-ARCH-151`, `REQ-UX-058`, `REQ-UX-059`, `REQ-EXEC-184`.

<!-- adr/ADR-0011-partitioned-stores.md -->

# ADR-0011 — Partitioned External Stores

- **Status:** Accepted
- **Decision:** Shell state is held in small external stores, one per ownership area (preferences, workspace, interaction), each created once in the composition root, passed to what needs it and read through `useSyncExternalStore`. There is no global store, no application context holding unrelated domains, and no module-level mutable singleton reached by import.
- **Drivers:** state partitioned by ownership; a store testable without React; a composition root that is the only place knowing what the real clock, storage and capability probes are.
- **Constraints:** a store exposes its members as properties rather than methods, so a reader cannot capture an unbound method. Authoritative project and audio state does not live here, and React never owns high-frequency state.
- **Related requirements:** `REQ-ARCH-153`, `REQ-EXEC-136.4`, `REQ-EDIT-073`.

<!-- adr/ADR-0016-version-registry-package.md -->

# ADR-0016 — The Version Registry Is Its Own Leaf Package

- **Status:** Accepted
- **Decision:** The product version and the version of every persisted format are generated from `version.json` into `packages/version` (`@audiogubbins/version`), a package with no dependencies whose whole source is the generated module. It is the TypeScript counterpart of `crates/audiogubbins-version`. A package that writes or reads a versioned format depends on it directly; the diagnostics package depends on it to stamp a bundle and to report the format versions in it.
- **Drivers:** the registry was generated into `packages/diagnostics`, so the design system and the workspace package each depended on the logging package for one constant, and any later package that persisted anything would have done the same. That made the logging package a dependency of everything for a reason unrelated to logging, and put a version question behind a package whose job is diagnostics (review finding F-27). `REQ-REPO-187` keeps product and format versions in one source, and `REQ-REPO-154` requires dependency direction to reflect ownership.
- **Constraints:** the package holds generated constants and nothing else; `pnpm version:check` fails if it differs from `version.json`, and the architecture rules keep it a leaf. It is a package rather than a module in `packages/domain` because the design system must not depend on the domain, and the formats it versions (preferences, workspace layouts, shortcut profiles, diagnostic bundles) are not domain concepts. It does not introduce a package for appearance's sake: it removes a dependency edge from two packages and replaces a false one on a third.
- **Change record:** affected requirements `REQ-REPO-154`, `REQ-REPO-187`; affected phase 01, whose owned modules gain `packages/version`; compatibility impact none, because every constant keeps its name and value; already-passed phase remediation none; verification by the version freshness gate and the architecture layering rules, which now name the package.
- **Related requirements:** `REQ-REPO-154`, `REQ-REPO-185`, `REQ-REPO-186`, `REQ-REPO-187`, `REQ-EXEC-184`.

<!-- adr/ADR-0017-input-model-package.md -->

# ADR-0017 — The Input Model Is One Package, With Nothing of the Browser

- **Status:** Accepted
- **Decision:** Mouse, touch, pen and keyboard input are modelled as values in `packages/input` (`@audiogubbins/input`): the pointer sample, the gesture and its recogniser, tool strength with pressure optional, the key press, and the translation of a pointer event or a key event into those values. A browser event is read through a structural type naming only the fields a value is built from, so the package is compiled without the browser's type definitions and depends on no other AudioGubbins package (amended by `ADR-0018`: it depends on `packages/text`, and on nothing else). The command layer depends on it, because a shortcut is a sequence of key presses bound to a command; the application reads key events through it; an editing canvas will read pointer events through it.
- **Drivers:** WU-01.D asks for one input abstraction over mouse, touch, pen and keyboard, and `REQ-UX-005` makes each first-class. The pointer half lived in the design system, which owns presentation (`REQ-UX-155`), and the keyboard half in the command layer and the application's shortcut hook, so one model had three homes and none of them was about input (review finding F-29). `REQ-REPO-154` requires package boundaries to follow ownership.
- **Constraints:** nothing here knows the browser, a component, a command or a theme; the architecture rules keep it a leaf and forbid a browser global in it, as in the domain and the command layer. Whether a device offers pressure is a capability question and stays with the capability package; this package only carries what a device reported. What a gesture does in an editing canvas is the canvas's decision. `GestureSettings` is a value with a default and no owner in the preference contract: `REQ-UX-068` requires a user to be able to choose fixed strength over pressure, and Phase 01 has no tool whose strength could vary, so nothing persists the choice and no control offers it. The phase that adds the first pressure-sensitive tool adds both, and until then the default stands. Recorded as a known limitation of the Phase 01 evidence rather than left to be noticed later (review finding F-65).
- **Change record:** affected requirements `REQ-UX-005`, `REQ-UX-067`, `REQ-UX-068`, `REQ-REPO-154`; affected phase 01, whose owned modules gain `packages/input`; compatibility impact none, because no persisted format holds these values in a new shape and the key press keeps its fields; already-passed phase remediation none; verification by the moved pointer tests, new key-press tests and the architecture layering rules, which name the package.
- **Amended by:** `ADR-0018`, in the clause above that this package depends on no other AudioGubbins package. It depends on `packages/text` for the characters a reader sees, which the rule for a key's label needs, and on nothing else. Every other clause stands.
- **Related requirements:** `REQ-UX-005`, `REQ-UX-066`, `REQ-UX-067`, `REQ-UX-068`, `REQ-REPO-154`, `REQ-EXEC-184`.

<!-- adr/ADR-0018-reader-facing-text-package.md -->

# ADR-0018 — The Rules For Text A Reader Is Shown Are One Leaf Package

- **Status:** Accepted
- **Decision:** The rules a sentence shown to a reader, or read to one, is held to live in `packages/text` (`@audiogubbins/text`): the characters a reader sees and how many a text holds, how many bytes a text takes in UTF-8, the quoting of a stored or imported value a refusal names, the cut at the last word that fits in code units and in characters, the cut at a whole sentence, a reader's own text kept to a size on a whole character, the shape of a name a reader gives, held without the space around it, when two names are one, the first name free of those in use and what a copy is called, the identifier derived from a name, which storage keys and a message or a file name quotes, and the shape an identifier read from storage is held to, each within the bound in bytes its caller gives, which entry of a list holds a name, the names a list holds, asked of many times as numbering asks, and whether this runtime compares names by the rule, and the identifier each entry is held under beside the others (the count and the size amended in the fourteenth round, F-813; the cut in characters, the shape of a name, the comparison of two, the first free name and the identifier in the eighteenth, F-970, F-982, F-978 and F-971; the holder of a name and the identifiers a list holds in the nineteenth, F-1012 and F-1023; the shape and bound of a stored identifier in the twentieth, F-1038, and the names a list holds and whether names can be compared in the same round, F-1061 and F-1041; the bound given by each caller, and the bytes a text takes, in the twenty-first, F-1074). It is a leaf with no dependencies (narrowed by `ADR-0019`: its tests may take the fixtures package, and nothing it ships does), compiled without the browser's type definitions, and it knows nothing of the domain, a command or a theme. `packages/input` depends on it, and on nothing else, for the characters a reader sees; `packages/commands` depends on it to quote a value a refusal names, to hold a profile's name to the shape of a name, to find the profile that holds a name, to name a copy nobody named and number a profile imported under a name another profile has, and to hold each profile under an identifier derived from its name, and a stored profile's identifier to the shape one is derived in, within a bound of its own that it derives from the ending it writes after a profile's identifier, counted in UTF-8 bytes by this package (amended in the eighteenth round, F-970, F-978, F-971 and F-982, where it counted the name's characters itself and derived the identifier itself, and in the nineteenth, F-1012, where it compared the names held and numbered the identifiers itself, and the stored identifier's shape in the twentieth, F-1038, and the bound in the twenty-first, F-1074, where this package set it); `packages/workspace` depends on it to quote a value a refusal names, to hold a workspace's name to the shape of a name, to find the workspace that holds a name as a reader hears it, to name a copy nobody named, and a workspace saved with no name, by the first free name, cut at a word in the characters the name's bound counts, and to hold each workspace under an identifier derived from its name, and a stored workspace's identifier to the shape one is derived in, within 227 bytes, the bound storage holds a layout's identifier to, which no file name sets (the count amended in the fifteenth round, F-864, the cut in the seventeenth, F-936, the shape, the comparison, the first free name and the identifier in the eighteenth, F-970, F-978, F-971 and F-982, and the holder and the identifiers in the nineteenth, F-1012, and the stored identifier's shape in the twentieth, F-1038, and the bound in the twenty-first, F-1074, where this package set it from a file's name); `packages/diagnostics` depends on it to keep a reproduction note to its size (amended in the fourteenth round, F-813); `packages/capabilities` depends on it to probe whether names can be compared here, by the check every comparison reads (since the twentieth round, F-1041); `apps/web` depends on it for the cut of a reason at a word and the cut of a notice at a sentence (amended in the twenty-first round, F-1069 and F-1078, where it also quoted a file's name through `asQuoted`, which cut it, and asked whether names can be compared where the built-in shortcuts cannot be copied, which it reads from the command layer's refusal). This amends the clause of `ADR-0017` that the input package depends on no other AudioGubbins package: it depends on this one, which sits below it, and on nothing else.
- **Drivers:** one rule for the characters a reader sees was written in the input package, because a key's label needed it first, and the rule for quoting a value was written in the diagnostics package, because the two packages that quoted one shared that package and nothing below it. Neither could reach the other, so the quoting bound counted code units and moved its cut back from half a surrogate pair alone: a letter was still cut from the combining mark a reader sees on it, and that was written down as an accepted cost rather than fixed (review findings F-738, F-721). The diagnostics package's description then needed "and" to cover a responsibility that is neither logging nor a bundle, in four places at once, and a module that needs "and" to describe it is two modules. Three different cuts of text a reader is shown had by then been written in three packages, only one of them guarded against cutting a character in half, and they meet in one sentence that reaches an assertive live region. `REQ-REPO-154` requires package boundaries to follow ownership.
- **Constraints:** the package holds text rules and nothing else, and the architecture rules keep it a leaf. Its entry point offers the fourteen rules its consumers use (four until the fourteenth round, F-813, six until the eighteenth, F-970, F-971, F-978 and F-982, eleven until the twentieth, F-1038, which added `isIdentifier`, and twelve until F-1061 and F-1041 in the same round added `namesHeldBy` and `namesCanBeCompared`; `holderOf` and `identifiersHeldBy` stand where `sameName` and `freeIdentifier` stood until the nineteenth, F-1012, and `identifierRule` and `utf8Bytes` where `identifiersHeldBy` and `isIdentifier` stood until the twenty-first, F-1074) and not the pieces they are built from, the segmenter, the count of the characters a reader sees, the comparison of two names and the cut to a bound that adds an ellipsis, so a caller that wants another cut or another count reads one of these rather than assembling another. `wholeCharactersWithin` is offered as a rule, not as one of those pieces: it keeps a reader's own text, such as a reproduction note, to a size and adds nothing to say it was cut, because the reader wrote it and sees it whole where they wrote it; that the ellipsis cut and the cut at a word are built on it inside the package is the package's business. The dependency `ADR-0017` forbade is permitted for this package alone, and the cruiser rule that keeps the input package a leaf names it: the input model still sits below the command layer, still knows nothing of the browser, and gains no second edge. A text rule that belongs to one reader of it — what a key is called on a layout, how a log record is redacted — stays with that reader, because it is about what the text means there; this package holds the rules about the shape of text a reader is shown or read, how it is measured, cut, quoted and compared, whichever package shows it, and the identifier derived from a name, because that identifier is readable text that storage keys and a message or a file name quotes, so a rule for it is a rule for text a reader is shown; nine of the fourteen are built on its one reading of the characters a reader sees (eight until the twentieth round, F-1038, when an identifier came to be cut at a whole character to its bound, which `isIdentifier` and `identifiersHeldBy` read, and ten until the twenty-first, F-1074, when the two became the one rule `identifierRule` and `utf8Bytes`, which reads no character a reader sees, came to the entry point). How many packages read a rule is not the test: most of the fourteen have one reader today (restated in the fifteenth round, F-855, where this clause said the package holds only what more than one reader needs). The package has one responsibility, the rules for text a reader is shown: its measure, its cut, its quoting, its comparison, and the identifiers named from it. Each of the fourteen rules is one of those: the holder of a name is the comparison read over a list, the names a list holds are that comparison read over a list sorted by it, whether names can be compared is the comparison's own condition, the identifier rule within its caller's bound answers the identifiers a list holds, the rule read over a list, and the shape a stored identifier is held to, the rule's result stated as a test, and the bytes a text takes are its size in the unit that bound is written in, so none is a second responsibility, and the package's description names the one (reviewed against the description test of `CLAUDE.md` G1 in the nineteenth round, F-1006, when the name rules, the comparison and the identifiers had made the description false).
- **Change record:** affected requirements `REQ-REPO-154`, `REQ-UX-005`, `REQ-UX-066`; affected phase 01, whose owned modules gain `packages/text`; affected `ADR-0017`, whose leaf clause is amended here and nowhere else; compatibility impact: names cut by these rules, a copy's and that of a workspace saved with no name, and identifiers derived by them are stored in `audiogubbins.workspaces` and `audiogubbins.shortcuts`, so a change to the cut or the derivation changes what a later save writes, and, where a stored identifier or the name of the workspace on screen clashes with one held, what it is read under, while a stored name and a stored identifier that clash with none are read as they are stored (corrected in the nineteenth round, F-1006, where this clause said no persisted format holds text cut by these rules), and a stored identifier out of the shape an identifier is derived in, or past its bound, is read as text that cannot be read: the shortcut profile or the workspace stored under it is left out, with a notice, its collection's text set aside as for any other entry that cannot be read, never kept under it nor renamed without a word (since the twentieth round, F-1038, where such an identifier was kept as stored and became the name of an exported profile's file and the words of the announcement); every quoted value keeps its bound, and a rule of this package decides whether a stored name is read. A stored workspace whose name is longer than 120 characters is left out of the saved workspaces, with a notice and its text set aside, and a stored shortcut profile whose name is longer than 120 characters is left out, with a notice, the stored text it came in set aside under `audiogubbins.shortcuts.unreadable` before anything is written over it, and the profiles' write withheld and tried again with every write where there is no room to set it aside (amended in the eighteenth round, F-973, where this clause said the profile was left out with a log record). No build has shipped, so no stored data is affected (corrected in the sixteenth round, F-902, where this clause said the impact was none; the bound on a stored workspace's name came in the fifteenth round, F-864, and a stored profile's name, bounded since the tenth, is counted so since the fifteenth, F-850); already-passed phase remediation none; verification by the moved quoting tests, new tests for each cut and for the browser without a segmenter, and the architecture layering rules, which name the package.
- **Amended:** in the fourteenth review round, in two clauses (review finding F-813). Two more surfaces had text a reader writes or is told about measured in code units: a reproduction note cut at its bound wherever the bound fell, and a profile name refused as "longer than 120 characters" by its code units, so a name of sixty emoji was refused. The entry point offers two more rules for them: `wholeCharactersWithin`, which keeps a reader's own text to a size on a whole character and adds nothing to say it was cut, and `longerThan`, which counts the characters a reader sees and reads no further than the one past the bound. Since the fifteenth round (F-850), a character longer than any real one counts once for each allowance it fills, so a bound in characters is also a bound in size, and the checks on a profile's name and a workspace's name rely on it for that (stated here in the sixteenth round, F-902). `packages/diagnostics` depends on this package for the first, which cannot close a cycle because this package depends on nothing; `packages/commands` read the second (superseded in the eighteenth round, F-970, when `longerThan` left the entry point and the command layer came to read the bound through `asName` and `asWrittenName`). The clause that the entry point offers four rules now reads six, and the list of consumers gains diagnostics; until the fifteenth round (F-855) this row said so and the two clauses did not, and the Decision and Constraints clauses now read so where they stand. The architecture rules keep the package a leaf and framework-free by name, which the verification clause above claimed and the rules did not do until this round. Since the seventeenth round (F-936), the ellipsis a cut adds is counted inside the cut's bound, so a caller passes the room it has rather than allowing for a character added past it, and the cut at a word keeps a word the cut ends exactly at, which is the bound less the ellipsis (corrected in the eighteenth round, F-984, where this row said the bound). Since the eighteenth round (F-970, F-978, F-982, F-971), the entry point offers `asName`, the shape of a name, which answers `blank` for a value that is not text as for one of nothing but space and `too-long` for one past its bound, so each package words each part of the rule once; a name given, whether typed, carried in a file or made for a copy, is held without the space around it, trimmed before the rule reads it and before it is numbered, and `asWrittenName` holds a name in stored text to the same rule and keeps it as it is written, so a stored name is read as it was stored; `sameName`, which holds two names to be one where they differ only in case, in how a letter is encoded, or in space, trimmed and each run inside one space, as a screen reader says them alike, and by which the workspace refuses a name another workspace has, and the command layer a name typed for a profile that another has; `firstFreeName`, the first of a name, then of the name with a number after it, that no name in use has, the name cut at a word in the characters `longerThan` counts to leave room for what follows it, by which each package names a workspace or a profile nobody named and the command layer numbers a profile imported under a name another profile has, where a cut in code units kept half the characters its bound allows of a name outside the basic plane; `firstFreeCopyName`, the first free of the name with the word a copy adds after it (" copy" in the eighteenth round, the word the caller gives since the nineteenth, F-1004), then with a number after that, cut the same way, by which each package names a copy nobody named, and by which a copy of a name that is itself a copy's, "<stem> copy" or "<stem> copy <number>", takes the stem's next free number, so a copy of "Editing copy" is "Editing copy 2" rather than "Editing copy copy"; and `freeIdentifier`, the identifier derived from a name, in lower case, each run of anything but a letter or a digit one hyphen and the caller's word where nothing is left, then numbered until no identifier in use has it, which the workspace and the command layer each derived for themselves, and which belongs here because the identifier is readable text that storage keys and a message or a file name quotes. `longerThan` and the cut at a word in characters are not on the entry point: the two name rules read the first through `asName` and `asWrittenName`, and `firstFreeName` and `firstFreeCopyName` read the second inside the package. The clause that the entry point offers six rules now reads eleven. Since the nineteenth round (F-999, F-1001, F-1004, F-1012 and F-1023), two names are compared by English collation with every option that decides whether two names are one stated, punctuation not ignored and digits compared as they are written, on every machine, because a name travels in an exported file and is refused or numbered on the machine it is imported on, where the reader's language made Turkish hold "MIXING" and "mixing" to be two names, Danish "Gaard" and "Gård" to be one, and Thai ignore punctuation, and the rule refuses to load where the runtime resolves another collation, ignores punctuation or reads digits as numbers; the identifier derived from a name keeps the letters, marks and digits of every script, taken from the name's compatibility form (NFKC) in a lower case without a locale, where it kept the letters a to z alone, so "Écoute" gave `coute` and a name in Cyrillic the caller's word; `firstFreeCopyName` takes the word a copy adds from the package that names the copy, which words it for its reader, reads a copy's series by that word as `sameName` compares a name, so a copy of "Editing Copy" is "Editing copy 2", and counts the word in the characters the bound counts; and `holderOf`, the entry of a list other than the one a name is being given to whose name is that name as a reader hears it, and `identifiersHeldBy`, the identifiers a list of entries holds, from which each entry added is given the one derived from its name or, for an entry read from storage, its own where it is free, numbered from two where the one it would take is held, take the place of `sameName` and `freeIdentifier` on the entry point, so the workspace and the command layer each keep their list and word their refusal and neither writes the rule. The identifiers a list holds are read as a set, and each count resumes where the last under the same identifier stopped, which is the first free number because nothing held is let go while the set lives, so an allocation costs about the same however many entries share its identifier, where counting from two for each entry over every entry held made a list read from storage take time that grew with the cube of its length. Since the twentieth round (F-1038), `isIdentifier` holds exactly the identifiers the package gives, one that is not empty and is its own identifier, so letters, marks and digits of any script in their compatibility form and lower case, in runs joined by single hyphens, with no hyphen at either end, where a stored `Mine` would sit beside the `mine` its name derives, and within its bound, in UTF-8 bytes (one bound for every caller until the twenty-first round, F-1074, set here from the name of a file a caller writes, when each caller came to give its own); a name's identifier is cut at a whole character to the bound, and cut again before it is numbered, so every identifier derived, numbered or not, is one it accepts, where 120 letters in Cyrillic derived 240 bytes; and `identifiersHeldBy` holds an identifier read from storage only where it accepts it, answering none, and holding none, for one it refuses, which the workspace's reading and the command layer's restore of a stored list each read as an entry that cannot be read. Since the twentieth round (F-1041), the collation is resolved once and held to the rule at the capability probe at start or at the first comparison, whichever comes first, never where the package loads (corrected in the twenty-first round, F-1091, where this clause placed it at the first comparison alone), where the refusal to load stopped every package that reads this one, the logger and the keyboard among them, and the page started blank with nothing said: `namesCanBeCompared` is the one statement of the check, which every comparison reads, and a comparison asked where it does not hold throws, a caller's fault, since each caller asks first. A runtime that fails it stops naming alone, and says so through the unsupported-capability path: the capabilities package probes the check at start as the name-comparison capability, which the status bar counts among the missing and the Capabilities panel explains under "Naming workspaces and shortcut profiles", and saving a workspace as a new one, copying or renaming a workspace, importing a profile and changing the built-in shortcuts, which are changed in a copy that is named, are unavailable with a sentence that names that feature and the panel; the layout store and the command layer refuse the same operations in words of their own for any caller that does not ask first. It does not stop the rest of this package, nor the start: the stored workspaces and profiles are read, each name as it is stored, and the workspace on screen is placed among them under the name it has, since whether another has that name cannot be decided, so it may be listed beside a workspace of its name, as two stored ones of one name are. Since the same round (F-1061), `namesHeldBy` holds the names of a list, other than the entry a name is being given to, sorted by the collator names are compared by, and answers which entry holds a name, and whether one is taken, by a binary search with the same collator, so numbering a name beside a list that holds it with every number to thousands costs comparisons that grow as n log n, where asking `holderOf` of every entry for each number made the start, which numbers the workspace on screen, grow with the square of the stored collection; sorted by the collator rather than keyed by a folding of the text, because the collator holds two names one that differ in a code point it ignores, a soft hyphen or a joiner, which no folding sees. `holderOf` stays for one question of a list. Since the twenty-first round (F-1074, F-1089 and F-1091), the identifier rule takes its bound from its caller: `identifierRule(longestBytes)` answers `isIdentifier` and `identifiersHeldBy`, and derives and numbers within that bound, and `utf8Bytes` counts a text's bytes in the unit a bound is written in, so this package knows no name a caller gives a file; the command layer derives its bound from the ending it writes after a profile's identifier, and the workspace holds a layout's identifier to 227 bytes, the bound storage holds it to, which no file name sets, so no stored layout changes verdict. An identifier keeps no code point a reader does not see, `\p{Default_Ignorable_Code_Point}`, and derives each as it looks: one that is not a letter, a variation selector, U+034F, a Mongolian free variation selector, a joiner or non-joiner, a soft hyphen, a zero-width space, a tag, or one not yet assigned, which a runtime that does not know it shows as nothing, is left out of the name before anything else reads it and adds nothing, so "Mix", a zero-width joiner and "ing" give `mixing`, and a mark after one reaches its letter; the four that are letters, the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, which show as a blank gap, separate as a space does, so `a`, U+3164 and `b` give `a-b`. A name of nothing but such code points and space is refused as blank, given or written, since a list would show it as nothing. The names Windows reserves for a device, `con`, `prn`, `aux`, `nul`, `com0` to `com9` and `lpt0` to `lpt9`, compared after the derivation, are never an identifier, because Windows reserves the name of a file before its first dot whatever follows it, and a browser renames a download so named: a name that derives one is numbered from two as a clash is, "Con" as `con-2`, and `isIdentifier` refuses one, so a profile or a workspace stored under one, or under an identifier holding a code point a reader does not see, is set aside with a notice. A runtime whose collator cannot be made fails the check as one that resolves another collation does, answered once and held, so the probe and every comparison read one answer, and a comparison asked there throws the package's refusal. Every other clause stands.
- **Related requirements:** `REQ-REPO-154`, `REQ-REPO-185`, `REQ-REPO-186`, `REQ-UX-005`, `REQ-UX-066`, `REQ-EXEC-184`.

<!-- adr/ADR-0019-tests-take-the-fixtures-package.md -->

# ADR-0019 — The Text And Diagnostics Packages' Tests May Take The Test Fixtures Package

- **Status:** Accepted
- **Decision:** The tests of `packages/text` and `packages/diagnostics` may import `@audiogubbins/test-fixtures`, and so may the tests of every package that no rule of its own in the cruise governs. The tests of `packages/input` and `packages/version` may not, and those of `packages/domain` cannot, since the fixtures package depends on it. A package whose tests take it declares it as a development dependency, through the `devDeps` of its entry in the graph's declaration in `tools/sync-workspace-graph.mjs`, which writes it into the package's manifest and its compiler project's references, and which refuses any other package there. The cruise's rules `text-owns-nothing-else` and `diagnostics-owns-nothing-else` leave the fixtures package out of what they refuse (`to.pathNot`), and refuse every other package as before; `domain-owns-nothing-else`, `input-owns-nothing-else` and `version-owns-nothing-else` leave nothing out. Beside its generated fixtures, the fixtures package holds two measures: `relativeCost`, the processor time one workload takes against another, the two read in turn in blocks, which the cost tests of the text, diagnostics and application packages share; and `comparisonsIn`, the number of comparisons of names a piece of work makes, counted at the collator, which the cost tests of the commands and workspace packages share. Every test that reads `relativeCost`, itself or through a helper of its file, is allowed `LONGEST_COST_TEST_MS`, 520 seconds by the clock, as its timeout, which an architecture rule holds each to. The figure is derived in the package from the measure's own cap: the two first readings, `LONGEST_US` (32 seconds of processor time) of pairs of blocks, and one pair more whose blocks each take up to a reading more than the longer first reading, where the longest one reading the measure allows (`LONGEST_READING_US`) is 12 seconds, which comes to 104 seconds of processor time, taken five times (`CLOCK_OVER_PROCESSOR`) for the clock with forty busy processes beside the tests. That longest reading is about twice the longest reading any proven defect makes on a quiet machine, about 5.8 seconds, so a defect's reading under load stays within it and the defect fails on its ratio. The measure enforces that longest reading: a reading of either side that costs more ends it with a failure naming the side, the reading's cost and the 12 seconds, so the bound holds of every measure it answers, and a slower defect fails on its first such reading rather than at the timeout. `comparisonsIn` takes a ceiling, past which the comparison it counts throws a failure naming it: a count test takes the count at a thousand names and holds the count at four thousand to `N_LOG_N_FOURFOLD`, 5.5, times it, above the 4.8 of work that grows as n log n and under the 5.8 of n log² n, with that as the ceiling, so a quadratic defect is stopped in its first moments and each count test keeps Vitest's default timeout. Five packages declare it as a development dependency: the text and diagnostics packages, and the commands and workspace packages and the application, which no rule of their own governs.
- **Drivers:** the cost tests of three packages at three layers need one measure. The redaction tests held a text against prose of the same length with a helper of their own, which read one side whole and then the other, so a change in the machine's speed between the two fell on one side alone (review finding F-1036). The identifier cost tests counted the reads of one kind of collection, so a quadratic search through any other passed them (F-1054). The owner decided that both move to one fixed helper that reads the two sides alternately in blocks. The cost tests of numbering in the commands and workspace packages counted the comparisons of names with a copy of one function in each package's tests (F-1061), which the twentieth round's reading of its whole change found; a count is a measure of cost too, so it lives once, beside the other. The text package sits at the bottom of the graph, and the diagnostics package just above it, so the only package all three can reach is one their tests may take. The fixtures package is that package by its purpose (`REQ-REPO-191`), and its leaf rules were the only thing that refused it. A copy in each package would be three measures that drift apart, and a home in the text package would put a measure of processor time among the rules for text a reader is shown.
- **Constraints:** only test code gains the edge. `fixtures-are-test-only` still refuses the fixtures package from every production file (`REQ-EXEC-181`), and no manifest declares it as a runtime dependency, which the architecture rules check. No test of the input or version package needs the fixtures package, and an edge nobody uses is one the layering would allow for no reason, so their rules still refuse it, in their tests as in their production code. The domain package's tests cannot take it: the fixtures package depends on the domain package, so the edge would close a cycle between the two packages, and `domain-owns-nothing-else` refuses it as well. Every other package those rules refuse stays refused, in a package's tests as in its production code. The fixtures package depends on `packages/domain` alone, so the text and diagnostics packages' tests reach the domain through it, and nothing either package ships does. Neither measure generates anything, and `PROVENANCE.md` says so beside the generated set. `relativeCost` reads the machine it runs on and answers a ratio; it reads Node's processor time through a structural type naming the one call it makes, because each package's entry point is compiled without Node's types, as the input package reads a browser event (`ADR-0017`). `comparisonsIn` reads no machine time: it counts the comparisons a collator makes while the work runs, through the collator's own `compare`, and leaves the collator as it was whether the work returns or throws, so a limit held to its count holds on any machine and under any load. The leaf clause of `ADR-0018` stands for everything the text package ships.
- **Change record:** affected requirements `REQ-REPO-154`, `REQ-REPO-186`, `REQ-REPO-191`, `REQ-EXEC-181`, `REQ-EXEC-184`. Affected phase 01, whose text, diagnostics, commands and workspace packages and application gain a development dependency on the fixtures package. Affected `ADR-0018`, whose leaf clause this narrows for test code alone. Compatibility impact none, because nothing is persisted and nothing shipped changes. Already-passed phase remediation none. Verification by the dependency cruise (`pnpm test:dependencies`), the architecture rules on manifests and on the fixtures package, the generated graph (`pnpm graph:check`), and the fixtures package's own tests of the two measures; the count reads no machine time, so its tests and those it serves read the same on a quiet machine and a busy one. Three standing rules hold the edge to what this decision allows: the rule over each package's own rule in the cruise requires its `to.pathNot` to be `^packages/test-fixtures/` on the text and diagnostics packages' rules and absent on every other; a rule over every manifest requires each AudioGubbins development dependency of a package or the application to be the fixtures package, taken by some test of that package; and the graph's declaration refuses a `devDeps` entry that names any other package, before it writes or checks anything.
- **Related requirements:** `REQ-REPO-154`, `REQ-REPO-186`, `REQ-REPO-191`, `REQ-EXEC-181`, `REQ-EXEC-184`.

<!-- adr/ADR-0020-project-storage-packages.md -->

# ADR-0020 — Project Storage Is Six Packages Over Ports, With A Protocol That Needs No Atomic Rename

- **Status:** Accepted
- **Decision:** Phase 02 is built as six packages, each with one responsibility, layered so that nothing above the browser adapters reaches a browser API.
  - `packages/project-format` holds the authoritative, versioned project: the aggregate `ProjectState` (the domain `Project` of `ADR-0015`, each asset's media source and its import provenance), `ContentId`, the external source identity record, the source change policy, export provenance, canonical JSON, the runtime-validated project document, the one rule of pre-1.0 schema compatibility, the chunked content digest, the ZIP container, the portable bundle manifest and the unpacked tree. It is pure: bytes and digests reach it through ports.
  - `packages/project-commands` holds the commands that change a project, each with its inverse. The packet names this module `packages/commands/project`. A package nested inside `packages/commands` would be read as the command machinery by every per-package architecture rule, which captures the package from the first path segment, so it is a package of its own beside it.
  - `packages/history` holds the branching history as values: nodes, the cursor, the path between two nodes, branch names, named snapshots, A/B comparison with the difference of two states, and retention and compaction planning.
  - `packages/media-store` holds source media by content: the shared object store over a backend port, import by copy or by reference, the progressive fingerprint, the classification of an external source, and reachability with deterministic collection.
  - `packages/storage` holds the keeping of projects over a backend port: the storage root and its compatibility, `ProjectRepository`, `CommandJournal`, `SnapshotStore`, the project session, the `ProjectWriteLease` contract, autosave and recovery, `BackupPolicy` and generations, usage by category, cleanup priority and purge, forks, and the export and import of bundles and unpacked trees.
  - `packages/browser-storage` implements the ports in the browser: the origin-private file system through a dedicated worker with synchronous access handles, Web Locks and a broadcast channel for the write lease, IndexedDB for kept file handles, and the file and directory pickers. It receives the platform objects from new files of `packages/capabilities`, the one package that reads the browser's globals.
- **Persistence protocol:** no rename and no atomic replace is assumed, because Safari at the floor (16.4) offers the origin-private file system only through synchronous access handles, which write in place. Every file except the two heads is written once, under a name no other content takes, and carries a checksum, so a torn write fails its check and is never read as data. A project's commit point is one of two head files, each with a generation number and a checksum; the valid head with the higher generation is current, and the next checkpoint writes the other. A checkpoint holds the project's history graph without its nodes, which are written once in segments of their own that the checkpoint names, so what a checkpoint writes grows with what changed since the last and never with the whole history. Between checkpoints, every change is a journal record numbered in sequence; recovery replays records after the head's position and stops at the first record that is missing or fails its check, keeping the rest aside and reporting it. The write lease is fenced by an epoch: an owner that takes a project raises the epoch and seals the old one at its last record, and records of an older epoch after the seal are ignored.
- **Content identity:** a `ContentId` is the SHA-256 of the byte length and of the SHA-256 of each 1 MiB chunk. A file is hashed as it streams, in the platform's native digest through an injected port, and never whole in memory; the fixed chunk size is part of the format.
- **Drivers:** `REQ-STOR-101` requires a command journal with periodic immutable snapshots and recovery from a torn tail; `REQ-STOR-098` requires one writer per project in a storage context, with transfer and a safe failure where coordination is absent; `REQ-STOR-099` requires cryptographic content identity; `REQ-EXEC-136.4` and the packet keep the project domain off the origin-private file system and the File System Access API; `REQ-EXEC-216` forbids assuming a file fits in memory; `CLAUDE.md` G1 requires one responsibility per module and I/O through injected ports.
- **Constraints:** only `packages/browser-storage` and the application touch a browser storage API. The five other packages compile without the DOM library and are framework-free under the architecture rules. Nothing in them persists the domain's in-memory values directly: the document is converted field by field and validated when read (`REQ-EXEC-136.12`). Before 1.0 a stored document of another schema version is refused and reported, never migrated (`REQ-STOR-052`).
- **Change record:** affected requirements are the Phase 02 owned set; affected phase 02 only; the packet's owned module `packages/commands/project` is realised as `packages/project-commands`, and `packages/browser-storage` is added beneath the ports; compatibility impact none, because nothing is yet persisted in these formats; already-passed phase remediation none; verification by the architecture rules, which name each package, and the packages' own suites.
- **Related requirements:** `REQ-STOR-021`, `REQ-STOR-025`, `REQ-STOR-026`, `REQ-STOR-052`, `REQ-STOR-098` through `REQ-STOR-106`, `REQ-STOR-193` through `REQ-STOR-200`, `REQ-EXEC-136`, `REQ-EXEC-184`.

<!-- adr/ADR-0021-annotations-move-with-native-rate-import.md -->

# ADR-0021 — The Editor's Markers Move Into The Project When Audio Is Imported At Its Own Rate

- **Status:** Accepted
- **Decision:** `ADR-0047` gave its in-memory holder of each asset's markers and regions a removal boundary: when Phase 02's project session is on the branch, the markers and regions move into the project and the marker commands become project commands. The boundary is moved. The markers and regions move into the project when the editor opens the open project's assets, and that needs audio imported into the project at the rate the file was recorded at. Until then the editor's assets are the test assets and the sound of a reference picture, none of them an asset of the project, and their markers stay the session's, as `ADR-0047` describes, with the interface saying they are not kept.
- **Drivers:** `REQ-ARCH-085` keeps each asset at its native sample rate. A marker is stored at its asset's own frames, so an asset stored at another rate would put every stored marker in the wrong place once the file is read at its own rate. The browser's decoder (`decodeAudioData`, which Phase 04 uses for a picture's sound) resamples to its context's rate and reports no rate of its own, and nothing on the branch reads a file's rate: reading formats is `REQ-AUDIO-010`, Phase 09's, whose packet says the browser's codecs are not assumed. Phase 02's packet puts audio decoding and the waveform editor out of its scope.
- **Constraints:** the move keeps what `ADR-0047` asked of it: the markers and regions become project state, the marker commands become project commands with the same inverses, and the in-memory holder (`apps/web/src/state/session-content.ts`) is removed, with no persisted format for the session's markers before then. The project's history already reaches every asset (`REQ-STOR-021`), so a marker becomes undoable with the project's own undo; today the marker commands return inverses that no history keeps. Phase 09 owns importing at the native rate, and the move with it. Phase 05's packet persists regions and edit operations in the project, which meets the same need first, because Phase 09 depends on Phase 05: Phase 05's readiness review settles, by a change record, whether native-rate reading is brought forward into Phase 05 or its region editing stays the session's until Phase 09.
- **Change record:** affected requirements `REQ-EDIT-012`, `REQ-EDIT-014`, `REQ-EDIT-061`, `REQ-ARCH-085`, `REQ-AUDIO-010`; affected phases 02, 05 and 09 (Phase 04, already passed, needs no remediation: its session holder stands as its ADR describes, and only the interface sentence that named the project system as the arrival is corrected); Phase 09's packet gains the import at the native rate and the move, and Phase 05's packet names the question its readiness review settles; compatibility impact none, because nothing persists the session's markers; verification by the editor panel test of the sentence that says markers are not kept, and in Phase 09 by the move's own tests.
- **Amended by:** `ADR-0050` (2026-10-02), in the Constraints clause that Phase 09 owns importing at the native rate and the move with it. Phase 05's readiness review settled the question this record left to it: native-rate reading of uncompressed PCM is brought forward into Phase 05, which imports audio into the project at its own rate, opens the project's assets in the editor, moves the markers and regions into the project and removes the in-memory holder. Phase 09 keeps export, the compressed formats and batch import. Every other clause stands.
- **Related requirements:** `REQ-EDIT-012`, `REQ-EDIT-014`, `REQ-EDIT-061`, `REQ-ARCH-085`, `REQ-AUDIO-010`, `REQ-STOR-021`, `REQ-EXEC-181`.

<!-- adr/ADR-0022-storage-core-in-a-worker.md -->

# ADR-0022 — The Storage Core Runs In A Worker Behind A Typed Port

- **Status:** Accepted
- **Decision:** Project storage runs in one dedicated worker, and the page holds no storage core. A package `packages/storage-runtime`, shaped as `packages/audio-runtime` is, is the browser host of project storage: the worker's composition root, which builds the tree, the digest, identifiers, the clock, the write leases, the project command bus, the media store, the caches and the repository there; the typed messages between the worker and the page; and the page's client, a typed facade for each kind of thing the application's stores use. An open project is a handle in the worker: the page's copy of its snapshot is brought up to date by the save status, the access, the state when it changed and a history delta (`historyDelta` and `applyHistoryDelta` in `@audiogubbins/history`), so the page keeps persistent maps and pays for a change, not for the history. The ports only the page can serve (byte sinks the person chose, a file the person picked, a folder to read or write, the search for a linked file that may need a permission prompt) cross as handles the worker calls back, with their bytes transferred. The worker reads the origin-private file system directly through sync access handles, so the file-only messages between the page and a file worker are removed. Every long path takes an `AbortSignal`, which the page's cancel reaches through the port, and yields to the worker's host, so a cancel or another call is heard mid-path.
- **Drivers:** the architecture invariants keep heavy work, import, export and batch work off the UI thread. Before this decision the page built every storage service and only file reads and writes crossed to the worker, so canonical text, parsing, fingerprints, usage and roots scans, backups and ZIP checksums ran on the page: a project of 16,000 changes took 331 ms to write and 483 ms to read one checkpoint there. `REQ-STOR-021` asks for effectively unlimited undo, so a history long enough to make the page stall is a supported project, not an edge case.
- **Constraints:** the storage core's packages stay framework-free and take every platform object through their ports, so the worker is only a new composition root; no rule moves. One operation table names each operation with its argument and answer types, and both ends compile from it, so no payload is described twice; the envelopes are read field by field, as the tree's messages were. A failure crosses as the `DomainResult` it is, and a refused tree operation as its kind. The page's mirror of an open project publishes a new snapshot value only when the worker publishes, so identity still marks a change for `useSyncExternalStore`. Tests run the worker's real composition over an in-process pair that structured-clones every message, and a dependency rule keeps the page to the storage package's types.
- **Change record:** affected requirements `REQ-STOR-021`, `REQ-STOR-098`, `REQ-STOR-193`, `REQ-EXEC-216`; affected phase 02, whose review found the page doing the storage work, and whose owner ruled that it is fixed in Phase 02 rather than Phase 14; compatibility impact none, because nothing persisted changes; verification by the history delta's tests, the port's tests over a structured clone, the application's tests through the client, the dependency rule, cancellation and yield tests for each long path, and a measurement of the page's time for a change and an open at 16,000 changes.
- **Related requirements:** `REQ-STOR-021`, `REQ-STOR-098`, `REQ-STOR-193`, `REQ-EXEC-216`, `REQ-EXEC-136`.

<!-- adr/ADR-0030-audio-engine-package-topology.md -->

# ADR-0030 — The Audio Engine Is Three Packages: The Graph, The Engine And The Browser Runtime

- **Status:** Accepted
- **Decision:** Phase 03's TypeScript is three packages, each with one responsibility and one direction between them.
  - `packages/audio-graph` (`@audiogubbins/audio-graph`) is the typed directed processing graph as a value, and everything that can be decided from it without running it: nodes, ports and edges, the versioned graph descriptor, reusable subgraphs, validation with its diagnostics, processor latency and its propagation, delay compensation, and the execution plan. It depends on `packages/domain` alone and knows no thread, browser or buffer. The `ProcessorLatency` value it propagates is the domain's, in `packages/domain/src/processing/processor-latency.ts`, the one type a processor's descriptor declares and a chain's latency is found in, so the project model and the graph cannot hold two models of latency.
  - `packages/audio-engine` (`@audiogubbins/audio-engine`) is the audio core that runs on any thread: the frame block and stream contracts, node kernels and the executor that runs a plan block by block, parameter smoothing, the canonical DSP port and its two implementations, the media clock and transport, the chunked offline renderer, performance and quality profiles, processing-mode selection and the priority scheduler. It depends on `packages/domain` and `packages/audio-graph`, and is compiled without the browser's type definitions, so the same code runs in an AudioWorklet, a worker and a Node test.
  - `packages/audio-runtime` (`@audiogubbins/audio-runtime`) is the browser host: the audio context and its lifecycle, the AudioWorklet processor and its typed message protocol, the offline-render worker and its protocol, the feed of source frames into the worklet, and the observation of underruns. It depends on the two above, `packages/domain`, `packages/diagnostics` and `packages/capabilities`, and is the only one of the three compiled with the browser's type definitions.
  - A module that runs in another global scope, the worklet processor and the render worker, sits under `src/threads/` and is exported as `./threads/*`, so the application can give the bundler its URL without reaching past the package's entry points.
- **Drivers:** `REQ-ARCH-140` forbids a central processor manager and asks for node lifecycle, scheduling, validation, latency propagation and render planning as cohesive subsystems with explicit ownership. `REQ-ARCH-036` separates real-time playback, AudioWorklet processing and worker-based offline computation. The packet names the three packages. Validation and planning are decisions over a value, execution is work over buffers, and hosting is the browser, and each has a different set of things it may know.
- **Constraints:** a node type is one object that states its contract and makes its kernel (`NodeImplementation` in the engine extends `NodeContract` in the graph), so a type cannot be validated by one table and run by another. Browser probes stay in `packages/capabilities`: the runtime is given what exists, never asks. The engine takes the WASM instance from its host, so it never touches a browser global. No package here imports React.
- **Change record:** affected requirements `REQ-ARCH-036`, `REQ-ARCH-140`, `REQ-REPO-154`, `REQ-EXEC-184`; affected phase 03, whose owned modules these are; compatibility impact none; verification by the dependency cruise, the layering rules in `tests/architecture/dependency-rules.test.ts` and the generated graph.
- **Related requirements:** `REQ-ARCH-036`, `REQ-ARCH-140`, `REQ-REPO-154`, `REQ-EXEC-136`, `REQ-EXEC-184`.

<!-- adr/ADR-0031-narrow-wasm-boundary.md -->

# ADR-0031 — The WASM Boundary Is A Hand-Written C ABI Over Handles, With A Reference Path Beside It

- **Status:** Accepted
- **Decision:** `crates/wasm-bindings` exports a small C ABI from a `cdylib` built for `wasm32-unknown-unknown`: an ABI version, allocation and release of sample buffers, and create, run, query and free functions for each canonical DSP object, each object named by an integer handle into a table the crate owns. No pointer to a Rust object crosses the boundary; only the offset of a buffer the TypeScript side filled or will read. `packages/audio-engine` holds the one TypeScript module that knows the ABI: it checks the exports and the ABI version when the module is instantiated, owns every view of the module's memory, and offers the engine the same `CanonicalDsp` port as the reference TypeScript implementation. The `.wasm` file is built by `tools/build-wasm.mjs` into `target/wasm/`, which is ignored, and is never committed.
- **Drivers:** `REQ-ARCH-141` asks for narrow, documented, typed bindings that do not leak memory ownership through the application. Generated bindings (`wasm-bindgen`) emit JavaScript glue that reads `TextDecoder`, which an AudioWorkletGlobalScope does not have, and pin a command-line tool to the crate's exact version on every contributor's machine. A hand-written ABI of a dozen functions is narrower than generated glue and runs in every scope the engine runs in. The failure path the packet requires ("WASM/accelerator failure must fall back to a documented supported path") is the reference implementation, which `ADR-0032` makes bit-identical.
- **Constraints:** `unsafe` is allowed in `crates/wasm-bindings` alone, by a crate-level `allow` naming this ADR, and each `unsafe` block states the invariant it relies on. `dsp-core` and `resampling` keep the workspace's `deny`. A module whose ABI version differs, or which lacks an export, is refused with a failure that names what is missing, and the engine runs on the reference path with that reason reported. The build of the module is part of the test setup, so a test never runs against a stale binary.
- **Change record:** affected requirements `REQ-ARCH-141`, `REQ-ARCH-081`, `REQ-REPO-186`; affected phase 03; compatibility impact none; verification by `cargo test --workspace`, the ABI conformance tests in the engine, and the golden tests that run both paths.
- **Related requirements:** `REQ-ARCH-141`, `REQ-ARCH-081`, `REQ-ARCH-049`, `REQ-EXEC-216`.

<!-- adr/ADR-0032-canonical-arithmetic.md -->

# ADR-0032 — Canonical Processing Uses Only Basic IEEE-754 Arithmetic, In A Stated Order

- **Status:** Accepted
- **Decision:** Every canonical DSP primitive is written with the operations IEEE-754 defines exactly, addition, subtraction, multiplication, division, square root, floor and conversion between `f64` and `f32`, evaluated in one stated order, and never with a platform's transcendental functions. A sine is AudioGubbins' own: its argument is reduced by a split constant and evaluated by a fixed polynomial. The Kaiser window's Bessel function is a fixed series. Accumulation is in `f64` in a fixed order and rounded once to `f32`. Rust never contracts `a * b + c` into a fused operation and JavaScript cannot, so the Rust module and the reference TypeScript implementation produce the same bits on every machine, and a golden render is one hash for both.
- **Drivers:** `REQ-ARCH-081` targets bit-identical PCM across machines and browsers wherever feasible. `Math.sin` and the C library's `sin` are approximations whose last bit differs between engines and platforms, so an oscillator or a filter designed with them cannot be bit-identical, while the basic operations are required to be correctly rounded everywhere.
- **Documented platform variation:** the canonical path ends at the frames the engine produces. What the browser does after that is outside it: the audio context's own output resampling when the device rate differs from the context rate, its channel up- or down-mixing to the device, and its output latency. Real-time playback is therefore not canonical and is not held to a hash. Offline renders are. The tolerance for the canonical path is zero, and the tests hold it to zero.
- **Constraints:** a new canonical primitive states its operation order in both implementations and gains a golden test that runs both. Performance work may not change the order of operations without new golden values, which `REQ-EXEC-180` requires to be justified and reviewed.
- **Change record:** affected requirements `REQ-ARCH-049`, `REQ-ARCH-081`, `REQ-ARCH-011`; affected phase 03; compatibility impact none; verification by the golden tests (`pnpm test:audio-golden`) and the Rust vectors in `cargo test --workspace`.
- **Related requirements:** `REQ-ARCH-049`, `REQ-ARCH-081`, `REQ-ARCH-011`, `REQ-ARCH-085`.

<!-- adr/ADR-0033-channel-layouts-in-the-domain.md -->

# ADR-0033 — Phase 03 Extends The Domain's Channel Layout Rather Than Owning A Second One

- **Status:** Accepted
- **Decision:** `ChannelLayout` stays in `packages/domain`, where `ADR-0015` placed it, and Phase 03 extends it there to meet `REQ-ARCH-157`: the speaker positions of the WAVEFORMATEXTENSIBLE set, an ambisonic set with its order, channel ordering (ACN or FuMa) and normalisation (SN3D, N3D or FuMa), and a label on each channel of a custom map. Layout equality compares the roles, the labels and the ambisonic convention. The channel operations the graph runs (remapping, reordering, extraction, duplication and matrix mixing, of which downmixing and mid/side are instances) are graph node types in `packages/audio-graph` and `packages/audio-engine`, not functions of the domain value.
- **Drivers:** `ADR-0015` gives Phase 01 the value model and asks a later phase to extend its types rather than keep a copy. The packet names `ChannelLayout` among Phase 03's required contracts and owns `REQ-ARCH-157`. Two layout types would let a graph accept a layout the project model cannot state.
- **Constraints:** nothing here is persisted, so no format changes (`REQ-STOR-052`); Phase 02's format converts from this value. An ambisonic set cannot be mixed with positional roles in one layout, because no format carries that and a processor could not tell which channels form the sphere. A layout whose roles do not say what a processor needs is not guessed at: the processor declares what it supports, and the graph refuses an edge that would need a silent downmix.
- **Change record:** affected requirements `REQ-ARCH-157`; affected phases 01 (whose module this extends) and 03; compatibility impact none, because nothing stores a layout yet; verification by the domain's channel-layout tests and the engine's N-channel tests.
- **Related requirements:** `REQ-ARCH-157`, `REQ-EXEC-216`, `REQ-STOR-052`.

<!-- adr/ADR-0040-editor-package-topology.md -->

# ADR-0040 — The Editor Foundation Is Five Packages, With The Selection Model Moved Into The Timeline

- **Status:** Accepted
- **Decision:** Phase 04's TypeScript is five packages, each with one responsibility and one direction between them.
  - `packages/timeline` (`@audiogubbins/timeline`) is the time axis as values: zoom, the viewport and its exact conversions between CSS pixels and sample boundaries, time formats and timecode, ruler and grid ticks, the selection set with its command-target precedence, and snapping. It depends on `packages/domain` alone, knows no thread or browser, and is portable (`ADR-0030`).
  - `packages/waveform` (`@audiogubbins/waveform`) is the multi-resolution peak pyramid: its generation over a `PcmSource`, its progressive assembly, its query per display column, its disposable cache format, the zero-crossing search, the peak worker's protocol and thread entry, and the main-thread host that shares one pyramid per source among every view. It depends on `packages/domain` and `packages/audio-engine`, and its worker compiles in the dedicated-worker scope.
  - `packages/renderer` (`@audiogubbins/renderer`) is the renderer contract and its backends: the render frame as a value, WebGPU, WebGL2 and Canvas 2D backends, the choice between them, device and context loss recovery, and the renderer's capability report. It depends on `packages/domain` for its results, with the WebGPU type definitions (`@webgpu/types`, BSD-3-Clause, published by the W3C GPU for the Web group) beside the DOM's, and is compiled with the browser's type definitions.
  - `packages/editor-view` (`@audiogubbins/editor-view`) is one editor view as values: its presentation state, lane layout, tools and their pointer interpretation, hit testing, snap candidates, and the composition of a render frame from view state, content and peaks. It depends on `packages/domain`, `packages/input`, `packages/timeline`, `packages/waveform` and `packages/renderer`, imports no UI framework and reads no browser global.
  - `packages/video-reference` (`@audiogubbins/video-reference`) is picture as reference media: the binding of a picture's time to the shared media clock, frame arithmetic at a chosen frame-rate interpretation, offset calibration, and the synchronisation policy. It depends on `packages/domain` and `packages/timeline`, and is portable. The video element, the file and the panel belong to the application.
- **Selection:** `packages/domain/src/selection` held a single-kind selection that no consumer used. `REQ-EDIT-063` requires time, spectral, channel and object selections to be modelled apart, with a documented precedence, so the selection model moves to `packages/timeline` as a selection set (`ADR-0042`) and the domain's copy is removed, keeping one authoritative home (`REQ-EXEC-136.11`).
- **Renderer:** AudioGubbins draws with its own three backends rather than PixiJS, which `ADR-0004` permits but does not require. The editor draws rectangles, segments, text and images in clipped layers, a set small enough to own; PixiJS 8 would have to be wrapped rather than used to keep the contract AudioGubbins's, and its loss recovery and Canvas 2D path would not be ours to hold to the recovery rule (`ADR-0044`).
- **Drivers:** `REQ-EXEC-136.3` cohesive boundaries; the packet's owned modules; `REQ-AUDIO-152`'s renderer contract owned by AudioGubbins; `REQ-ARCH-037`'s off-thread peak generation; the working agreement's rule of one responsibility per module.
- **Constraints:** the renderer holds no authoritative state: the view composes a whole frame from state each time, so a lost device is recovered by drawing the next frame (`REQ-AUDIO-152`). Only `packages/capabilities` reads browser globals; the renderer and the video adapter are handed the objects they use. Video never enters the audio edit domain (`REQ-AUDIO-156`).
- **Change record:** affected requirements `REQ-EDIT-063`, `REQ-EXEC-136.11`, `REQ-AUDIO-152`; affected phases 01 (whose selection value moves) and 04; compatibility impact none, because nothing persisted or consumed the domain selection; verification by the dependency rules, the dependency cruise, the scope projects and each package's suite.
- **Related requirements:** `REQ-EDIT-012`, `REQ-EDIT-013`, `REQ-EDIT-061` to `REQ-EDIT-065`, `REQ-ARCH-037`, `REQ-AUDIO-082`, `REQ-AUDIO-152`, `REQ-AUDIO-156`, `REQ-EXEC-136`, `REQ-EXEC-184`.

<!-- adr/ADR-0041-timeline-coordinates.md -->

# ADR-0041 — Timeline Coordinates Are Integer Sample Boundaries Under An Integer Zoom

- **Status:** Accepted
- **Decision:** A position on the editor's timeline is a sample boundary, a `SampleCount`, never a pixel or a second; the domain's `SampleCount` is the packet's `TimelineCoordinate`/`SamplePosition`, so no second type names the same value. Zoom is one of two integers: whole samples per CSS pixel (one or more), or whole CSS pixels per sample (two or more), so every conversion is exact integer arithmetic. A viewport is the boundary at its left edge, a whole number of pixels into that sample when a sample is wider than a pixel, the zoom and the width. Scrolling moves the left edge by a count computed afresh from the pixel distance, rounded half away from zero, so a scroll and its reverse cancel exactly; zooming keeps the boundary under the anchor pixel exactly where it was, and at a zoom of samples per pixel a zoom and its reverse return the same left edge. A pointer position is converted once, to the nearest boundary or to the sample under it, and nothing converts back and forth.
- **Drivers:** the packet requires sample coordinates that are integer-safe and not derived from lossy pixel floats, and no drift over huge zoom and scroll ranges; `REQ-EDIT-012` requires movement down to individual samples; `REQ-PROD-160` keeps sample and time coordinates as the source of truth under any later musical mapping.
- **Constraints:** positions stay below 2^53, the domain's bound, and the largest zoom keeps every product of pixels and samples per pixel exact. Device pixels are a drawing concern: the frame composer divides CSS pixels by the pixel ratio when it chooses columns, and no coordinate depends on it. Seconds, milliseconds and timecode are formats of a boundary, computed with integer division at an explicit rate.
- **Change record:** affected requirements `REQ-EDIT-012`, `REQ-EDIT-013`, `REQ-PROD-160`; affected phase 04; compatibility impact none; verification by the timeline's round-trip and far-position tests.
- **Related requirements:** `REQ-EDIT-012`, `REQ-EDIT-013`, `REQ-PROD-160`, `REQ-EXEC-216`.

<!-- adr/ADR-0042-selection-set.md -->

# ADR-0042 — The Selection Is A Set Of Explicit Facets, And The Active Facet Decides A Command's Target

- **Status:** Accepted
- **Decision:** A selection set holds, each optional and each kept until it is cleared or made invalid: a time range, a spectral selection (a time range, a frequency band and a rectangle or lasso shape), an object selection (markers, regions, clips, tracks, assets or processors, one kind at a time), and a channel scope. The set records the order the facets were made in, and the one made last is active; when it is cleared, the one made before it becomes active, which is the person's own earlier choice rather than a guess. A command states the target kinds it accepts and what it does when nothing is selected, and resolution is deterministic: the active facet is the target when the command accepts it; when it does not, the command is refused with the reason, and never falls back to another facet; with nothing active, the command either takes the whole asset or refuses, as it declared. The channel scope narrows a time, spectral or whole-asset target and never an object one. A selection is kept per asset, shared by every view of the asset, changed only through the selection commands, and reconciled when content changes: a range is clipped to the asset, channels beyond its layout are dropped, and objects that no longer exist are removed.
- **Drivers:** `REQ-EDIT-063` forbids collapsing selection into one ambiguous concept and silently guessing between targets; `REQ-EDIT-064` keeps a selection across tools, zoom, scroll and views; `REQ-EDIT-012` applies processing to the whole asset or region when nothing is selected; `REQ-EDIT-065` requires tools and contextual input to act through the same commands.
- **Constraints:** the resolved target carries a description the interface shows as the active selection scope, and a view can tell whether the target lies outside what it shows, so a command with a surprising consequence can indicate or confirm it (`REQ-EDIT-064`). Spectral rendering and spectral tools belong to Phase 08; the facet exists so that their commands have a target. Nothing here is persisted.
- **Change record:** affected requirements `REQ-EDIT-012`, `REQ-EDIT-063`, `REQ-EDIT-064`, `REQ-EDIT-065`; affected phases 01 (whose domain selection this replaces, `ADR-0040`) and 04; compatibility impact none; verification by the timeline's selection and precedence tests.
- **Related requirements:** `REQ-EDIT-012`, `REQ-EDIT-063`, `REQ-EDIT-064`, `REQ-EDIT-065`, `REQ-EXEC-136.11`.

<!-- adr/ADR-0043-peak-pyramid.md -->

# ADR-0043 — Waveform Peaks Are A Quantised Pyramid Made Off The UI Thread And Kept As A Disposable Cache

- **Status:** Accepted
- **Decision:** A source's peaks are a pyramid of levels per channel. Level zero summarises 256 frames per bucket and each level above it four buckets of the one below. A bucket holds its minimum and maximum, rounded outward to a 16-bit step over ±4 full scale so the envelope never shrinks, its root mean square to the same step, and whether any sample in it reached full scale or was not finite. A worker makes the pyramid by reading the source in chunks of 65,536 frames, nearest first to the range a view shows, and sends the runs of buckets it finishes to the page in batches at most once a display frame, merged where they touch, so a view draws what is known and marks what is not. A view below 256 frames per device pixel asks the worker for a window of detail buckets of 16 frames each, summarised by the same rule, and below 16 frames per device pixel for the samples themselves, so no column reads more than sixteen values a frame. A window spans the view and one view's width either side, asked for before the view reaches its edge, and is bounded by the widest view it is sized for; a view never asks again for a window it holds, and one it no longer needs is cancelled in the worker, which answers requests one at a time and reads no more of a cancelled one. When the pyramid is whole the worker encodes it (a header naming the format version, the source identity and revision, the rate, length, channel count and bucket geometry, then the levels, then a checksum) and the page keeps the bytes in a cache store keyed by the source's identity and revision. The worker checks a cache before it is used, and one that is missing, stale, torn or of another format is made again, which changes nothing in the project.
- **Drivers:** `REQ-ARCH-037` (precomputed multi-resolution peaks, progressive and background generation, cache persistence and regeneration); the packet's forbidden shortcut of waveform generation on the main thread and its acceptance criterion that large assets scroll and zoom without rebuilding peaks from raw PCM per frame; `REQ-ARCH-157` N channels; `REQ-EXEC-216`, a source that does not fit in memory.
- **Constraints:** one pyramid per source identity and revision is shared by every view, and lives as long as a view in the view store shows its source, not as long as a component, so a view mounted again keeps a pyramid half made. The cache is derived data (`REQ-STOR-106`) and never the sole copy of anything. The cache store is a port: the application keeps the bytes in IndexedDB under its own database until Phase 02's cache store is on the branch, whose waveform category then implements it.
- **Change record:** affected requirements `REQ-ARCH-037`, `REQ-ARCH-157`; affected phase 04; compatibility impact none, because the format is new and disposable; verification by the pyramid, codec and host tests and the timeline browser suite.
- **Related requirements:** `REQ-ARCH-037`, `REQ-AUDIO-152`, `REQ-ARCH-157`, `REQ-EXEC-216`.

<!-- adr/ADR-0045-signal-recipes.md -->

# ADR-0045 — Generated Audio Crosses A Thread As A Signal Recipe, Which Replaces The Tone Description

- **Status:** Accepted
- **Decision:** `packages/audio-engine` gains the signal recipe: per channel, an ordered list of segments, each silence, an impulse or a tone from the canonical oscillator at a frequency and a peak, over a stated length. A recipe is validated by one function, where it is made and where it is read from a message. A recipe source makes any frame on demand, at a cost that does not grow with its position, so an asset of hours is described in a few hundred bytes and never held. `packages/audio-runtime`'s source description replaces its tone kind with a signal kind that carries a recipe; the test signal is a recipe of one tone on each channel and renders to the same bits, and the engine's tone source, which the signal source supersedes, is removed. The application's deterministic test assets are recipes, played by the feeder worker, rendered by the render worker and summarised by the peak worker, each making the same frames.
- **Drivers:** the packet's user-visible outcome of opening deterministic test assets, and its acceptance criterion on large assets; `REQ-EXEC-216`, which forbids assuming a file fits in memory; `ADR-0030`, which keeps sources in the engine; one description of generated audio rather than two.
- **Constraints:** a tone segment's oscillator starts at phase zero at the segment's first frame, so a frame's bits do not depend on how it was reached. Recipes are bounded in segments and channels when read, so a message cannot ask a worker for unbounded work.
- **Change record:** affected requirements `REQ-ARCH-157`, `REQ-EXEC-216`; affected phases 03 (whose tone description this generalises) and 04; compatibility impact none, because a description is never persisted, and the test signal's golden render is unchanged; verification by the recipe source's tests, the unchanged golden render and the runtime's protocol tests.
- **Related requirements:** `REQ-ARCH-157`, `REQ-EXEC-216`, `REQ-ARCH-081`.

<!-- adr/ADR-0047-session-annotations.md -->

# ADR-0047 — Phase 04's Markers Are Held Per Asset For The Session Until A Project Holds Them

- **Status:** Accepted
- **Decision:** An asset opened in an editor view carries its own markers and regions for the session, as the domain's `Marker` and `Region` values at the asset's own frames. Markers are added, moved and removed only by typed commands that each give their inverse, and every view of the asset shows the change. Regions are shown and snapped to, and are made only by a test asset that defines them, because making and editing regions is Phase 05's (`REQ-EDIT-014`). The session holds this content in memory and the interface says so, because persisting a project is Phase 02's.
- **Drivers:** `REQ-EDIT-012` (markers, named regions and loop boundaries in the editor), `REQ-EDIT-061` (a change to content propagates to every view), `REQ-AUDIO-156` (picture-aligned markers), and the absence of a persisted project on the branch Phase 04 starts from.
- **Constraints:** this is temporary by `REQ-EXEC-181`'s rule, with a stated removal boundary: when Phase 02's project session is on the branch, the markers and regions move into the project, these commands become project commands with the same inverses, and the in-memory holder is removed. No persisted format is introduced for them.
- **Change record:** affected requirements `REQ-EDIT-012`, `REQ-EDIT-061`; affected phases 02, 04 and 05; compatibility impact none; verification by the marker command tests and the multi-view browser test.
- **Amended by:** `ADR-0021`, in the removal boundary of the Constraints clause. The markers and regions move into the project when the editor opens the project's own assets, which needs audio imported at its own rate (Phase 09), not when Phase 02's project session is on the branch. Every other clause stands.
- **Amended by:** `ADR-0050` (2026-10-02), in the phase `ADR-0021` gave the removal boundary: audio imported at its own rate arrives in Phase 05, not Phase 09, so the markers and regions move into the project and the in-memory holder is removed there. Every other clause stands.
- **Related requirements:** `REQ-EDIT-012`, `REQ-EDIT-014`, `REQ-EDIT-061`, `REQ-AUDIO-156`, `REQ-EXEC-181`.

<!-- adr/ADR-0050-native-rate-reading-in-phase-05.md -->

# ADR-0050 — Phase 05 Reads Uncompressed Audio At Its Own Rate, And The Markers Move Into The Project There

- **Status:** Accepted
- **Decision:** Phase 05's readiness review brings native-rate reading forward from Phase 09, settling the question `ADR-0021` left to it. From Phase 05 on, audio a person imports becomes an asset of the open project, read by AudioGubbins' own readers at the rate the file was recorded at, and the editor opens the project's assets. What moves is the reading of the formats that hold uncompressed PCM, split from `REQ-AUDIO-010` as `REQ-AUDIO-220`: WAV (integer PCM of 8 to 32 bits and IEEE floating-point PCM of 32 and 64 bits, plain and `WAVE_FORMAT_EXTENSIBLE`, with RF64 and BW64 for files past 4 GiB) and AIFF and uncompressed AIFF-C (integer PCM of 8 to 32 bits, either byte order, and floating-point PCM of 32 and 64 bits), at any rate and channel count the file declares, with the channel layout its header states. Phase 05 also takes what was waiting on that import: running Phase 02's import pipeline from the interface with the person's copy-or-link setting, recording each source's rate, bit depth, channel layout and duration in its provenance (`REQ-STOR-166`), playing and drawing a project asset through the feeder, render and peak workers, auditioning the two states of an A/B comparison (`REQ-STOR-195`), and the move of the markers and regions into the project that `ADR-0047` and `ADR-0021` describe. Regions, edit operations and markers are kept in the project and undone with its history from Phase 05 on. Phase 09 keeps export and every writer, the compressed formats and their decoders (FLAC, MP3, Ogg Vorbis, Opus, AAC/M4A, and the compressed codes WAV and AIFF-C can carry, ADPCM, µ-law and A-law among them), the metadata and loop metadata a file carries, codec capability detection and fallbacks, import analysis for those codecs, and batch import.
- **Drivers:** `REQ-EDIT-014` is Phase 05's, and a region is only worth editing if it is kept: under `ADR-0021` as it stood, Phase 05 would have built regions and edit operations, persisted them nowhere the editor could reach, and left Phase 09 to move them, so the phase's central acceptance criterion, that every core edit survives save and reload, could not have been met on real audio. `REQ-ARCH-085` keeps each asset at its native rate, and a marker, a region boundary and an edit operation are all stored at their asset's own frames, so they can be persisted only against audio read at the rate it was recorded at; the browser's decoder (`decodeAudioData`) resamples to its context's rate and reports no rate of its own, so it cannot be the reader. Uncompressed PCM is the set that meets that need without a codec: reading it is parsing a container, whose every sample is checked bit for bit against its fixture, while each compressed format needs a decoder whose licence, build and capability rules are Phase 09's codec work (`REQ-AUDIO-010`, Phase 09's packet). WAV is the working format of game audio and AIFF its counterpart on macOS, and the two share one verification domain, so a project can be started from the files a sound designer records and exchanges, and nothing else in the import path is left for later.
- **Constraints:** the readers are the first implementations of the read contract in `packages/codecs`: the format recognised from the file's bytes, never its name alone; an `AudioFormatDescriptor` of its rate, bit depth, sample encoding, channel count, layout and length in frames; and frames read on demand, in chunks, at the native rate, off the UI thread, with every read taking an `AbortSignal`. A file is never read whole into memory to import, play or draw it. Phase 09 extends this contract with its registry, capability descriptors, decoders and writers, and does not introduce a second one. Samples are converted to the engine's representation by one stated rule, giving the same bits on every machine (`ADR-0032`), and nothing is resampled. A file in a format Phase 05 does not read is refused before anything is stored, with a sentence naming the format and the formats that can be read. A malformed or hostile file fails without changing the project. A file whose data runs short of its declared length, as a recording cut off by a crash does, is read to its last whole frame and the shortfall said, never refused whole. The source bytes stay unchanged, copied into the media store or linked as the person chose (`REQ-STOR-025`, `REQ-STOR-104`). The markers and regions become project state through project commands with the same inverses, a region carries its edit operations, and the project's history undoes and redoes all of them (`REQ-STOR-021`); persisting them raises the project's schema version, with no migration before 1.0 (`REQ-STOR-052`). The in-memory holder (`apps/web/src/state/session-content.ts`) is removed, with the interface's sentence that markers are not kept. Audio that is not an asset of the project, the deterministic test assets and the sound of a reference picture, carries no markers or regions, and the marker and region tools say why on it. The picture's sound is still decoded by the browser, so the bound on its channels that Phase 04 left stays Phase 09's. Of the Phase 02 review's tracked findings, F-42 (the peak cache's readiness wiring) and the reserved-key half of F-53 pass to Phase 05, the first phase to open the project's own assets in the editor and to bring linked files in from the interface; F-51 stays Phase 09's.
- **Change record:** affected requirements `REQ-AUDIO-010` (its uncompressed PCM reading split out), `REQ-AUDIO-220` (new, owner Phase 05), `REQ-ARCH-085`, `REQ-EDIT-012`, `REQ-EDIT-014`, `REQ-EDIT-061`, `REQ-STOR-021`, `REQ-STOR-025`, `REQ-STOR-166` and `REQ-STOR-195`; affected phases 05, which becomes `READY` with this scope, and 09, which loses the import at the native rate of uncompressed PCM and the move of the markers and keeps the rest; Phases 02, 03 and 04, already passed, need no remediation, since what they deferred to the import is now Phase 05's and their handoffs stand as records. Compatibility impact: the project's format gains regions, edit operations and markers, raising its schema version; no build has shipped, so no stored project is affected. Public API: `packages/codecs` is created by Phase 05, with the read contract and `AudioFormatDescriptor`. Godot interchange and runtime: none. PWA and browser: none, since no browser codec is used for these formats. Verification: codec fixtures for every encoding, depth, byte order and form named above, checked sample for sample; malformed and truncated files; a project round trip of imported assets with their markers, regions and edit operations through save, reload and undo, redo and branch traversal; source hashes unchanged after import and editing; and the browser test that imports a file and finds its markers after a reload.
- **Amends:** `ADR-0021`, in its clause that Phase 09 owns importing at the native rate and the move with it. Its other clauses stand.
- **Related requirements:** `REQ-AUDIO-010`, `REQ-AUDIO-220`, `REQ-ARCH-085`, `REQ-EDIT-012`, `REQ-EDIT-014`, `REQ-EDIT-061`, `REQ-STOR-021`, `REQ-STOR-025`, `REQ-STOR-052`, `REQ-STOR-104`, `REQ-STOR-166`, `REQ-STOR-195`, `REQ-EXEC-181`.

# Passed Dependency Handoffs

<!-- traceability/handoffs/phase-01.md -->

# Phase Handoff Capsule — Phase 01

## Capability Delivered

AudioGubbins starts locally as a web shell over a pnpm and Cargo monorepo: a
docking workspace behind one adapter, themes and densities from perceptual
tokens with computed contrast, settings, a typed command boundary with a
palette, rebindable shortcuts and chords, capability reporting, local
structured diagnostics with redaction and no telemetry, an input model for
mouse, touch, pen and keyboard, and the architecture tests and deterministic
fixtures every later phase builds on. It edits no audio, and says so.

## Requirements Satisfied

Each owned requirement below is mapped to its implementation and its evidence
in `reviews/phase-01-evidence.md`, under "Requirement-to-evidence mapping",
with the referenced global requirements `REQ-EXEC-184` and `REQ-EXEC-216`. Two
are met with a recorded limit: `REQ-UX-057`, whose reflow below the declared
minimum width of 640 CSS pixels is owed to Phase 14 (F-574, F-689), and
`REQ-UX-067`, whose long press has no editing surface in this phase to open it
(F-188).

- `REQ-ARCH-004`
- `REQ-UX-005`
- `REQ-PROD-006`
- `REQ-PWA-031`
- `REQ-REPO-033`
- `REQ-ARCH-034`
- `REQ-PROD-056`
- `REQ-UX-057`
- `REQ-UX-058`
- `REQ-UX-059`
- `REQ-UX-060`
- `REQ-UX-066`
- `REQ-UX-067`
- `REQ-UX-068`
- `REQ-UX-069`
- `REQ-UX-070`
- `REQ-UX-071`
- `REQ-EDIT-072`
- `REQ-EDIT-073`
- `REQ-REPO-142`
- `REQ-ARCH-151`
- `REQ-ARCH-153`
- `REQ-REPO-154`
- `REQ-UX-155`
- `REQ-PRIV-161`
- `REQ-PRIV-162`
- `REQ-PRIV-164`
- `REQ-PRIV-165`
- `REQ-REPO-185`
- `REQ-REPO-186`
- `REQ-REPO-187`
- `REQ-REPO-191`

## Public Contracts Introduced or Changed

Every entry point's exported names, signatures and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code; the evidence
lists each round's change to it.

- `@audiogubbins/commands`: command descriptor, execution result and refusal
  reason, registry, bus, transactions, shortcuts, chords, profiles, conflicts,
  palette ranking, platform reservations, and the export of a profile.
- `@audiogubbins/capabilities`: capability registry, feature requirement and
  degradation descriptor, late answers, the keyboard layout map and whether
  names can be compared.
- `@audiogubbins/design-system`: theme, density, motion and contrast preference
  schema, tokens, the theme provider and the accessible primitives.
- `@audiogubbins/workspace`: panel and layout API, six presets, the layout
  store, its reading of a stored layout and its recovery.
- `@audiogubbins/diagnostics`: diagnostic record schema, redaction contract,
  bounded log store and consented bundle.
- `@audiogubbins/input`: pointer sample, gesture, key press, and the readings of
  events they are built from.
- `@audiogubbins/text`: the rules for text a reader is shown, names and the
  identifiers they are held under (`ADR-0018`).
- `@audiogubbins/domain`: the non-authoritative domain value model
  (`ADR-0015`).
- `@audiogubbins/version`: the product and schema versions, generated from
  `version.json` (`ADR-0016`).
- `@audiogubbins/test-fixtures`: deterministic signals and projects, and the
  two measures the tests of cost share (`ADR-0019`).
- The public package dependency graph, declared in
  `tools/sync-workspace-graph.mjs` and asserted by
  `tests/architecture/dependency-rules.test.ts`.

## Persisted / Interchange Formats

- `userPreferences` 1, under `audiogubbins.preferences`.
- `workspaceLayout` 1, under `audiogubbins.workspace` and
  `audiogubbins.workspaces`, with `audiogubbins.workspace.unreadable`,
  `audiogubbins.workspaces.unreadable` and `audiogubbins.workspaces.recovered`.
- `shortcutProfile` 1, under `audiogubbins.shortcuts`, with
  `audiogubbins.shortcuts.unreadable`, and exported to a file in the same shape.
- `logVerbosity` 1, under `audiogubbins.verbosity`.
- `keyboardLayout` 1, under `audiogubbins.keyboard-layout`.
- `diagnosticBundle` 1, written to a file the user chooses and never kept.

## Invariants Downstream Agents Must Preserve

- The interface changes authoritative state only through the typed command
  boundary; the stores are partitioned and created in the composition root
  (`ADR-0011`, `ADR-0013`, `tests/architecture/command-route.test.ts`).
- Dockview is reached only through the workspace package's adapter, and Radix
  only through the design system's primitives (`ADR-0009`, `ADR-0010`).
- The docking engine's serialised form is never stored; a stored layout is
  parsed field by field before use.
- No network call, analytics or telemetry in production source; a diagnostic
  record's strings are redacted, and a bundle is described before consent.
- Colours live in the tokens; contrast is computed, never chosen.
- An identifier read from storage is kept only where it is AudioGubbins's own
  derivation within its store's bound; anything else is set aside with a
  notice, never lost silently.
- The layering the architecture rules and dependency-cruiser enforce, the
  package graph generated from its one declaration, and every test of cost held
  to the fixtures package's measures.
- British English in prose and user-facing text.

## ADRs

- `ADR-0009` — Design-System Boundary and Trigger Composition.
- `ADR-0010` — Workspace Layout Ownership.
- `ADR-0011` — Partitioned External Stores.
- `ADR-0012` — Perceptual Colour Tokens with Computed Contrast.
- `ADR-0013` — Command-First Shell Surfaces.
- `ADR-0014` — Shell Animation Deferred Until a Consumer Exists.
- `ADR-0015` — Phase 01 Owns the Non-Authoritative Domain Value Model.
- `ADR-0016` — The Version Registry Is Its Own Leaf Package.
- `ADR-0017` — The Input Model Is One Package, With Nothing of the Browser.
- `ADR-0018` — The Rules For Text A Reader Is Shown Are One Leaf Package.
- `ADR-0019` — The Text And Diagnostics Packages' Tests May Take The Test
  Fixtures Package.

## Verification Baselines

- `reviews/phase-01-evidence.md`, the evidence package, and
  `reviews/phase-01-review.md`, twenty-one review rounds, 1097 findings, each
  with its disposition.
- `pnpm run verify:commit`: lint, the forced typecheck, the unit suite, the
  record's titles and the cruise. The unit suite gave 2369 tests in 101 files
  over the code the phase commits.
- The browser suite, `pnpm run test:e2e`, nine Playwright projects: its last
  whole run, over the twentieth round's code, gave 900 passed and 22 skipped;
  it did not run whole over the twenty-first round's code, at the owner's
  decision on the gates, and the evidence names the focused runs that did.
- `cargo test --workspace`, 5 tests.
- `packages/test-fixtures`: deterministic signals and projects with
  provenance, and `relativeCost` and `comparisonsIn`, the measures every test
  of cost reads.
- `python tools/verify_hardening.py` and `sha256sum -c CHECKSUMS.sha256`, from
  `docs/spec/`.

## Intentionally Deferred Items

Only items explicitly authorised by the specification: none. What this phase
leaves to later ones is debt its review accepted, below.

## Accepted Non-Blocking Debt

Each item is a finding the review record tracks or accepts, or a part of one
fixed in this phase that its disposition leaves to a later one, with its owner;
the resume note, now `docs/todo/done/phase-01-application-foundation.md`,
carried this list until this capsule was written. No `BLOCKER`, `CRITICAL` or
`HIGH` finding is open. At the owner's decision in the twenty-first round, the
phase closed with that round's findings fixed and no further round of the
lenses; its browser mutations were not run, and three of its unit-suite
mutations were not proven, as its record gives.

- Phase 02: an inverse for deleting a workspace (F-123); offering every text set
  aside because it could not be read as an export, an entry stored under an
  identifier out of the shape one is derived in among them (F-1038), and letting
  the user discard it: the collection's and its copy's under
  `audiogubbins.workspaces.unreadable`, the mounted layout's under
  `audiogubbins.workspace.unreadable`, and the shortcut profiles' under
  `audiogubbins.shortcuts.unreadable`; and text too large to set aside, which is
  left in place, so its store's writes are withheld until it is discarded: the
  mounted layout's under `audiogubbins.workspace`, the workspace on screen not
  kept; the collection's under `audiogubbins.workspaces`, with its copy's under
  `audiogubbins.workspaces.recovered`, the workspaces saved not kept; and the
  shortcut profiles' under `audiogubbins.shortcuts`, the profiles not kept
  (F-206, F-305, F-401, F-496, F-973, F-993, F-1021); the export and the discard
  reachable before the quota is met, and a bound on each list set aside, with a
  notice when an old text is dropped, so the room the lists take never withholds
  every write unseen (F-401, F-1022); a cause and a remedy in the
  storage-failure notice (F-209); carrying these items into its packet (F-271).
- Phase 03: wrapping the bundle fields a computed capability key would carry
  (F-138); a branded log-category type, and the loggers made from the one list,
  as the audio engine adds categories (F-249, F-330).
- Phase 04: a group's scroll position kept across a rebuild of the dock, which
  the engine keeps and the adapter would restore once the contents are drawn;
  the Diagnostics panel's filter is kept already (F-304, F-560); the first
  surface that mounts the long-press context action, and its test (F-188,
  F-281); the first caller of `sampleFromPointerEvent` (F-218);
  a split of the main area kept across a remount (F-275); focus following a
  panel an arrangement command moved (F-283).
- Phase 05: one menu-parts factory for every menu (F-255); one `RunCommand`
  type taking a `CommandId`, the dock's `Run` among the signatures (F-256,
  F-468); a marker on a command that needs arguments from a dialogue, for the
  first such commands, the gain and the fade (F-302, F-562).
- Phase 09: a path rule that stops before a date or "and/or" (F-192);
  decoding a run of percent-encoded characters before the path rules read it,
  and a `data:` written with a space after its scheme (F-618).
- Phases 11 and 13: a seed is named in `ORDINARY_NAMES`, and logged as a
  field written out in place so the logged-field rule holds the name to it,
  since every other name that ends in `seed` is redacted and a generation
  seed is what reproduces a fault (F-883, F-928).
- Phase 12: an unregistering service worker for any browser an earlier
  deployment reached (F-139); the manifest's icons (F-133); gating the sub-path
  build in `pnpm build` (F-222); a worker gate that parses the bundle (F-367);
  asking the browser to keep the site's storage, telling a Safari user who has
  not put the application on the Home Screen that what it holds is removed after
  seven days of browsing without it, and offering the export before it is
  (F-1025).
- Phase 14: the repeated refusal's text asserted in the browser (F-107); stacked
  switches' touch targets in compact density (F-120); guarding the tab while the
  shortcut recorder listens, and the recorder's platform wiring (F-253, F-265);
  the Firefox skip premises held by a test, and reservation reasons that name
  their browser (F-276, F-277); the keyboard platform as one fact (F-317); what
  remains of the chord notice and reset (F-332); the redaction test's wall-clock
  limit (F-334); ChromeOS's own shortcuts, in the compatibility matrix of
  WU-14.A (F-412, F-459); a press checked with NVDA and JAWS in browse mode, and
  a Command press on macOS "Dvorak – QWERTY ⌘" on each engine (F-545, F-522);
  disabling a binding by the browser in force rather than by the union of the
  supported engines, with the reservation table split into what never arrives
  and what may not, a convention of its own for Android, which takes the Linux
  rows today and has no window manager to take them, and a case of its own for
  an installed window, which keeps nothing from the page in Chromium and has no
  address bar there or in a web app Safari installs on macOS, iOS or iPadOS,
  where what WebKit keeps has not been run (F-579, F-641, F-684, F-930, F-937);
  what Safari's own menus take before WebKit gives the page a press, which no
  Apple row stands on now (F-818, F-866); a refusal in a dialogue read with an
  on-screen keyboard up, on a phone and a tablet, where the footer that holds it
  is what the keyboard covers first, and placing the dialogue against the visual
  viewport if it is covered (F-867, F-898); a dialogue taller than the page,
  which scrolls as a whole, on a phone and a tablet: a finger's scroll of it on
  WebKit, which the tablet project cannot drive, and `85dvh` while a phone's
  browser toolbars show and hide (F-962); each text field focused on a real
  iPhone in Safari, and on iPadOS, in both densities, the palette's, the export
  dialogue's and the name field of Rename and Duplicate among them, to confirm
  the page does not zoom into it, which no engine the suite drives does (F-975),
  and the same iPhone turned on its side, in Safari, with a dialogue and the
  dock open, to confirm the text is drawn at the size the stylesheets give it
  and not enlarged, which the document asks for, in the prefixed form Safari on
  an iPhone reads, `-webkit-text-size-adjust: 100%`, which the build keeps and
  its gate holds, and which no engine the suite drives can show (F-1026,
  F-1034), and an iPad's reading of its own touch points, which the suite gives
  the tablet since Playwright's WebKit reports none (F-1093); the rule for names
  on Safari, on a Mac, an iPhone and an iPad, whose collation is Apple's and no
  engine the suite drives on Windows gives (F-1090); what Safari on an iPhone
  keeps of the site's storage after a week unused, installed on the Home Screen
  and not (F-1025); the WebKit hang, a test timed out loading the page or in its
  script in three of eight whole runs of the eighteenth round's code, its cause
  not found, with the browser matrix under load, and until then a run that meets
  it has its `test-results` copied aside and is diagnosed from the preview
  servers' request logs, which answer a client error as Node does and write the
  whole user agent and the header naming each request's project and test
  (F-1002, F-1035, F-1063); dropping a stored keyboard layout that was learned
  on another keyboard, on Firefox and Safari, which offer no layout map to tell
  one from another (F-622); whether WebKit suppresses the click it synthesises
  from a pencil tap as it does from a finger tap, which a pen driven through the
  Chrome DevTools Protocol cannot show (F-699); reading the layout map once for
  a return that fires two events, which the guard covers only while the read is
  in flight (F-645); a workspace that adapts to a narrow viewport rather than
  declining to draw one, which is `REQ-UX-029` and is the accepted half of F-574
  (F-689). Phase 14's packet does not carry these; this list does, and the
  handoff after it.
- The first pressure-sensitive tool: the gesture preference (F-65) and tilt in
  the pointer sample (F-130).
- Every phase after Phase 02: carrying the items above into its own packet as
  it starts (F-271).

## Downstream Readiness

- Phase 02 — Project and Storage System is `READY`.
- Phase 03 — Audio Engine Foundation is `READY`.

# Current Ledger Entry

```json
{
  "phase": 3,
  "name": "Audio Engine Foundation",
  "status": "PASS",
  "hard_dependencies": [
    1
  ],
  "phase_file": "phases/phase-03-audio-engine-foundation.md",
  "requirements": [
    "REQ-PROD-009",
    "REQ-ARCH-011",
    "REQ-ARCH-036",
    "REQ-ARCH-049",
    "REQ-ARCH-079",
    "REQ-ARCH-081",
    "REQ-ARCH-083",
    "REQ-ARCH-084",
    "REQ-ARCH-085",
    "REQ-ARCH-087",
    "REQ-ARCH-088",
    "REQ-ARCH-140",
    "REQ-ARCH-141",
    "REQ-ARCH-144",
    "REQ-ARCH-157"
  ],
  "open_verified_findings": [],
  "commits": [],
  "evidence": [
    "reviews/phase-03-evidence.md",
    "reviews/phase-03-review.md"
  ],
  "handoff": "traceability/handoffs/phase-03.md"
}
```
