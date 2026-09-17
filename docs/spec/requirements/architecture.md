# Architecture and Runtime Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-ARCH-004` — Core Architectural Principles — owner Phase 01 — scope `CURRENT`
- `REQ-ARCH-011` — Audio Precision — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-034` — Dependency Philosophy — owner Phase 01 — scope `CURRENT`
- `REQ-ARCH-036` — Processing Architecture Direction — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-037` — Waveform Rendering Direction — owner Phase 04 — scope `CURRENT`
- `REQ-ARCH-049` — Deterministic Rendering — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-054` — Export Collision Policy — owner Phase 09 — scope `CURRENT`
- `REQ-ARCH-079` — Adaptive Processing Modes — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-081` — Canonical Deterministic Processing — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-083` — Audio Performance Profiles — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-084` — Foreground and Background Processing Priority — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-087` — Resource-Aware Operation Without Artificial Limits — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-088` — Fully Local Core Processing — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-140` — Typed Directed Processing Graph — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-141` — DSP Implementation Languages — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-144` — Processor Latency and Automatic Delay Compensation — owner Phase 03 — scope `CURRENT`
- `REQ-ARCH-151` — Initial Front-End and Workspace Technology Selection — owner Phase 01 — scope `CURRENT`
- `REQ-ARCH-153` — State Ownership and Workflow State — owner Phase 01 — scope `CURRENT`
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio — owner Phase 03 — scope `CURRENT`

---

## REQ-ARCH-004 — Core Architectural Principles

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 4 of the pre-hardening baseline

#### 4.1 Local-First

The editor must function primarily on the user's local machine.

Core editing functionality must not depend on:

- A user account
- A remote application server
- Cloud storage
- External processing
- Mandatory telemetry
- Uploading audio to third parties

Audio should remain local unless the user explicitly invokes a future online integration.

Future user-configured cloud integrations should be possible through provider-neutral abstractions, but the local project model must never depend on a cloud provider.

---

#### 4.2 Non-Destructive Editing

Non-destructive editing is mandatory.

Original source audio must remain unchanged unless the user explicitly requests a destructive export or replacement workflow.

Edits must be represented as operations and parameters rather than repeatedly rewriting the source audio.

---

#### 4.3 Parametric Editing

The editing architecture shall use a parametric model wherever practical.

Examples include:

- Gain changes
- Normalisation
- Equalisation
- Compression
- Filters
- Fades
- Time ranges
- Noise-reduction parameters
- Pitch processing
- Time stretching
- Spectral operations
- Loop definitions
- Region boundaries

The authoritative project state should be composed of:

- Immutable source assets or source references
- Parametric edit operations
- Effect chains
- Region and marker data
- Project metadata
- User configuration

Rendered intermediates, waveform peaks, spectrogram tiles, preview renders, proxies, and other derived data should be treated as disposable caches.

---

#### 4.4 Future Multitrack Readiness

Initial releases shall focus on high-quality single-file and region-based waveform editing.

True multitrack editing is deferred to a later approved phase/specification, but the architecture SHALL remain multitrack-ready from the first production phase.

The initial internal model must therefore avoid assumptions such as:

> one project = one waveform

The domain model should already support concepts such as:

- Projects
- Assets
- Clips
- Regions
- Tracks
- Processors
- Effect chains
- Buses
- Routing
- Automation-ready parameters

Even if some of those concepts are not exposed in the first UI.

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

## REQ-ARCH-034 — Dependency Philosophy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 34 of the pre-hardening baseline

High-quality open-source dependencies may be used where they materially improve quality or capability.

Core architectural ownership should remain within the application for:

- Project model
- Editing model
- Processing graph
- Storage abstractions
- Undo/redo model
- Command model
- Core state architecture

Avoid coupling the core editor to a library that would make future evolution difficult.

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

## REQ-ARCH-037 — Waveform Rendering Direction

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 37 of the pre-hardening baseline

Waveform display should not repeatedly render directly from full-resolution PCM.

The system should use precomputed multi-resolution peak data.

Waveform rendering should support:

- Efficient zoom
- Efficient scroll
- Large files
- Progressive generation
- Background processing
- Cache persistence
- Regeneration

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

## REQ-ARCH-054 — Export Collision Policy

- **Owner:** Phase 09 — Import, Export, and Codec System
- **Scope:** `CURRENT`
- **Legacy source:** section 54 of the pre-hardening baseline

Export collision handling shall be user-configurable.

The default should be safe and explicit.

Supported policies should include, where appropriate:

- Prompt
- Overwrite
- Skip
- Auto-version/rename
- Apply to all remaining collisions in the batch

For rapid Godot iteration, the user may configure trusted export destinations to silently overwrite matching generated assets so that switching back to Godot immediately reflects updated audio.

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

## REQ-ARCH-151 — Initial Front-End and Workspace Technology Selection

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 151 of the pre-hardening baseline

The initial web application technology baseline shall be:

- **React 19.x** for the application shell, docked workspace, inspectors, menus, dialogs, settings, accessibility-oriented UI, and component composition.
- **TypeScript** with the strictest practical compiler settings; application/domain code must not rely on implicit `any`, unchecked boundary data, or broad type assertions as an escape hatch.
- **Vite 8.x** as the development/build foundation, retaining the already-established requirement for local development, static production builds, PWA packaging, and GitHub Pages deployment.
- **Radix Primitives** as the preferred low-level accessible primitive layer for conventional interactive UI such as dialogs, menus, popovers, toolbars, sliders, tabs, and related controls. AudioGubbins shall build its own design system and visual identity on top rather than adopting a generic pre-styled component theme.
- **Dockview** as the initial docking/workspace engine, wrapped behind AudioGubbins-owned workspace contracts so the domain/application architecture is not coupled directly to Dockview APIs.
- **Motion for React** for rich application-shell animation and interaction feedback where it provides a clear UX benefit, while direct audio-editing manipulation and performance-critical canvases remain independent of React animation state.

This stack is selected because it combines a mature component ecosystem, strong accessibility primitives, professional docking capability, sophisticated animation support, and compatibility with custom high-performance rendering layers.

Framework choice must not cause high-frequency audio, meter, playhead, waveform, spectrogram, or pointer-motion state to flow through ordinary React component state on every update. Performance-critical state must use specialised stores, external subscriptions, shared buffers where available, renderer-owned state, or other bounded mechanisms appropriate to the subsystem.

The UI framework is an adapter over the AudioGubbins application/domain core. Core editing logic, project state, commands, DSP graphs, persistence rules, and file formats must remain independently testable without rendering React components.

---

## REQ-ARCH-153 — State Ownership and Workflow State

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 153 of the pre-hardening baseline

AudioGubbins must not create a single global application store containing all project, UI, renderer, audio, and job state.

State shall be partitioned according to ownership and lifetime, including at least:

- Authoritative project/domain state
- Persisted command journal/history state
- User preferences
- Workspace/layout state
- Per-editor-view state
- Ephemeral interaction state
- Audio-engine runtime state
- Renderer runtime state
- Background job state
- Capability/runtime diagnostics

The typed command/domain layer remains authoritative for meaningful project mutations.

React-facing state libraries may be used for UI-oriented state, but they must not become an alternative domain model or bypass command validation, transactions, undo/redo, persistence, or architectural boundaries.

Explicit state machines should be used where workflows have meaningful lifecycle rules, failure/recovery states, or concurrency constraints—for example recording, export jobs, schema reset/backup flows, project ownership transfer, PWA updates, and long-running model installation—rather than representing complex lifecycle behaviour through scattered booleans.

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
