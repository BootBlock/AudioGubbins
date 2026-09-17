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

- Files approaching 300–400 logical lines and functions approaching 50–70 logical lines trigger cohesion review; thresholds are not automatic failures or code-golf targets.
- Large fan-in/fan-out, giant stores, deep inheritance, unrelated responsibilities, and repeated domain conditionals trigger architectural review.

# Current Phase Packet

# Phase 03 — Audio Engine Foundation

## Status

`NOT_READY` — blocked by Phase(s) 01 reaching `PASS`.

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

# Current Ledger Entry

```json
{
  "phase": 3,
  "name": "Audio Engine Foundation",
  "status": "NOT_READY",
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
  "evidence": [],
  "handoff": null
}
```
