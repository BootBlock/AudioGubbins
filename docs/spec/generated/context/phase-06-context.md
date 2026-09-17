# AudioGubbins Phase 06 Context Pack

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

# Phase 06 — Effect Rack and Core DSP

## Status

`NOT_READY` — blocked by Phase(s) 03, 05 reaching `PASS`.

## Objective

Implement the professional effect-rack and DSP subsystem, canonical processor library, advanced quality modes, local ML model-pack infrastructure, processor versioning, and deterministic render integration.

## User-Visible Outcome

Users can build/reorder/bypass/preset/A-B non-destructive effect chains, preview them interactively, and render at maximum quality using a broad professional processor set and optional local ML restoration/separation packs.

## Hard Dependencies

- Phase 03 — Audio Engine Foundation
- Phase 05 — Core Non-Destructive Editing

## Owned Requirements

- `REQ-AUDIO-017` — Effect Rack (`CURRENT`)
- `REQ-AUDIO-018` — DSP Scope (`CURRENT`)
- `REQ-AUDIO-019` — Preview and Comparison (`CURRENT`)
- `REQ-AUDIO-080` — Preview Quality and Final Render Quality (`CURRENT`)
- `REQ-AUDIO-086` — Quality Presets and Expert Controls (`CURRENT`)
- `REQ-AUDIO-138` — Local Machine-Learning Processing (`CURRENT`)
- `REQ-AUDIO-139` — ML Model Packs and Storage (`CURRENT`)
- `REQ-AUDIO-143` — Render Quality Policy (`CURRENT`)
- `REQ-AUDIO-145` — Processor Versioning and Reproducibility (`CURRENT`)
- `REQ-AUDIO-146` — DSP Architecture Review Requirements (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-PROD-039` — Third-Party Plugins (`DEFERRED`)

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

- [ ] Effect racks and processor descriptors
- [ ] Professional core DSP suite
- [ ] Serial/parallel graph usage, wet/dry, side-chain-ready contracts
- [ ] Preview/final quality modes
- [ ] Processor presets/chains
- [ ] Processor versioning
- [ ] Local ML model-pack manager
- [ ] Local ML restoration/source-separation processors
- [ ] Deterministic canonical render integration
- [ ] Third-party plugin extension boundary only; no third-party loading

## Explicitly Out of Scope

- Spectral painting UI
- Third-party plugin ecosystem
- Cloud ML processing

## Owned Modules / Packages

- `packages/processors`
- `packages/effect-rack`
- `packages/ml-runtime`
- `packages/model-packs`
- `crates/dsp-core`
- `crates/analysis`
- `crates/wasm-bindings`

## Cross-Package Dependency Rules

- Processors implement audio-graph contracts and are independent of React/workspace.
- Model-pack storage uses storage public APIs, not OPFS internals.
- Third-party plugin code loading remains absent.

## Required Public Contracts

- ProcessorDescriptor
- ParameterDescriptor
- ProcessorStateVersion
- EffectRack
- Preset/Chain format
- ModelPackManifest
- MLProcessorCapability
- QualityMode

## Data / Schema Changes

- Introduces versioned processor state, effect-rack/chain preset formats, processor implementation IDs, model-pack manifests and quality-profile data.

## Browser / Platform Considerations

- WASM/SIMD/GPU/inference acceleration is capability-based.
- ML model availability/storage may vary; no remote fallback.
- Real-time preview may use a different disclosed quality path than final render.

## Architectural Invariants

- Processors declare supported channel layouts, latency and determinism characteristics.
- Final render defaults to highest-quality supported mode; user may choose lower/faster modes.
- ML audio never leaves device.
- Changing processor algorithm/version cannot silently change old post-1.0 project sound.

## Internal Work Units

### WU-06.A — Processor framework

- [ ] Implement typed processor descriptors/parameters/state versioning
- [ ] Implement effect racks, bypass, reorder, wet/dry, preset/chain serialisation
- [ ] Integrate graph latency compensation

### WU-06.B — Core DSP

- [ ] Implement gain/normalisation/EQ/filter/compression/limiting/gate/expansion/de-ess/DC/resample/channel/fade/reverse/delay/reverb and cleanup processors
- [ ] Provide deterministic audio golden tests and N-channel behaviour

### WU-06.C — Advanced restoration

- [ ] Implement de-hum/de-click/de-pop/noise-reduction foundations
- [ ] Implement analysis and preview caching where needed

### WU-06.D — Local ML infrastructure

- [ ] Implement model-pack download/import, integrity/version/storage/delete controls
- [ ] Implement local inference abstraction and quality tiers
- [ ] Add agreed restoration/separation/dereverberation capabilities without remote fallback

### WU-06.E — Quality/reproducibility

- [ ] Implement preview vs final quality disclosure
- [ ] Persist processor implementation versions
- [ ] Add A/B and processed/original comparison

## Failure and Recovery Behaviour

- Missing ML models must degrade to an explicit unavailable capability, never cloud fallback.
- Model-pack corruption/incompatibility must not affect project validity.
- Processor failure must not silently output zero/unchanged audio as success.
- Unsupported channel layouts must fail/adapt explicitly.

## Required Verification Commands / Suites

- `cargo test --workspace`
- `pnpm test --filter processors --filter effect-rack --filter model-packs`
- `pnpm test:audio-golden`
- `pnpm test:dsp-property`
- `pnpm test:ml-locality`

## Acceptance Criteria

- [ ] Every required processor has golden/property tests covering silence, impulses, full-scale, denormals/NaN defence, and representative programme material.
- [ ] Effect chains round-trip through project persistence with identical parameter state.
- [ ] Maximum-quality final render is the default and visibly distinct from lower quality when relevant.
- [ ] Model packs can be installed/verified/removed without transmitting audio or breaking projects.
- [ ] Processor latency and channel-layout declarations are enforced.
- [ ] No third-party arbitrary code/plugin loading exists.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No browser-native black-box DSP as sole canonical processor.
- No hidden online ML.
- No processor parameters stored only in UI components.
- No universal plugin framework built for hypothetical third parties.

## Required Review Lenses

- Audio / DSP Correctness
- Architecture
- Performance / Scalability
- Security / Privacy
- Testing / Golden Regression
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

Create `traceability/handoffs/phase-06.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.

# Referenced Requirement Blocks

## REQ-AUDIO-017 — Effect Rack

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 17 of the pre-hardening baseline

The editor shall provide Audition-style effect-rack functionality.

Processors should support:

- Stacking
- Reordering
- Bypass
- Enable/disable
- Parameter editing
- Presets
- Real-time preview where practical
- A/B comparison
- Copy/paste
- Saving chains
- Batch reuse

Initial architecture should support future:

- Per-clip racks
- Per-track racks
- Bus racks
- Master racks

---

## REQ-AUDIO-018 — DSP Scope

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 18 of the pre-hardening baseline

The application should ultimately support a comprehensive processing toolset, including:

- Gain / amplify
- Peak normalisation
- Loudness normalisation
- Fades
- Invert
- Reverse
- Silence generation
- Silence trimming
- DC-offset removal
- Resampling
- Sample-rate conversion
- Channel conversion
- Equalisation
- Filtering
- Compression
- Limiting
- Expansion
- Gating
- De-essing
- Noise reduction
- De-hum
- De-click
- De-pop
- Pitch shifting
- Time stretching
- Reverb
- Delay
- Spectral processing

Additional processors that materially improve capability should be included without requiring separate approval.

---

## REQ-AUDIO-019 — Preview and Comparison

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 19 of the pre-hardening baseline

Where computationally practical, processors should support:

- Real-time preview
- Bypass
- A/B comparison
- Processed/original comparison
- Safe parameter adjustment during playback

Expensive operations may use cached intermediate renders where appropriate.

---

## REQ-AUDIO-080 — Preview Quality and Final Render Quality

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 80 of the pre-hardening baseline

Processors may expose different quality modes for interactive preview and final output where the underlying algorithm materially benefits from this distinction.

Requirements:

- Preview quality may favour low latency and responsiveness.
- Final render quality may use more expensive algorithms or settings.
- The application must not silently produce materially different results without making the distinction clear.
- Users should be able to inspect and configure quality behaviour where relevant.
- Presets may simplify the normal workflow while advanced settings expose the underlying parameters.

---

## REQ-AUDIO-086 — Quality Presets and Expert Controls

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 86 of the pre-hardening baseline

Technical quality controls shall use progressive disclosure.

Where appropriate, AudioGubbins should expose approachable named presets such as:

- Draft
- High
- Maximum

Advanced users must also be able to inspect and configure the underlying parameters when doing so is meaningful and safe.

Named presets must map to explicit parameter values and must not create opaque hidden processing modes.

---

## REQ-AUDIO-138 — Local Machine-Learning Processing

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 138 of the pre-hardening baseline

AudioGubbins shall support machine-learning-assisted audio processing where it materially improves restoration, cleanup, separation, analysis, or creative workflows. ML model packs may be optional for users to install because of their size, but ML infrastructure and the identified ML-assisted processor families are part of the planned AudioGubbins feature scope rather than being deferred solely by release-version labels.

ML functionality must remain local-first. Core ML processors shall not require audio to be uploaded to a remote service.

Candidate ML-assisted capabilities include:

- Advanced broadband noise removal
- Speech/dialogue enhancement
- Dereverberation
- Source separation
- Stem isolation
- Transient/noise classification
- Click/pop/artefact detection
- Intelligent restoration assistance
- Content-aware repair suggestions
- Optional analysis assistants that recommend processing without silently applying it

ML-derived results must remain non-destructive and must integrate with the same parametric edit graph, command architecture, undo/redo model, preview system, and final-render pipeline as conventional DSP.

Where an ML operation cannot be represented entirely by compact parameters, its authoritative inputs, model identity, model version, operation settings, masks/regions, and reproducibility metadata must be retained. Generated previews or intermediate inference outputs may be cached but must not become the sole authoritative project state.

No ML feature may silently transmit audio, project metadata, or derived content off-device.

---

## REQ-AUDIO-139 — ML Model Packs and Storage

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 139 of the pre-hardening baseline

Large ML models shall be distributed and managed as optional capability packs rather than forcing the base PWA bundle to include every model.

Model-pack management must support:

- Explicit model name and purpose
- Model version
- Download size
- Installed size
- Integrity/hash verification
- Licence information
- Compatibility information
- Quality/performance tier where applicable
- Download progress
- Pause/cancel/retry
- Storage-location abstraction where practical
- Removal and cleanup
- Update availability
- Rollback or retention of required historic versions where post-1.0 project reproducibility requires it

Models must not be downloaded merely because a project is opened unless they are required and the user has enabled an appropriate automatic-download policy.

The application shall clearly distinguish:

- Required model unavailable
- Optional enhancement unavailable
- Model update available
- Model incompatible with current runtime
- Model unavailable because of browser/device capability

Resource-heavy models may expose quality tiers such as Draft, High, and Maximum, with advanced users able to inspect the underlying model and inference settings where meaningful.

---

## REQ-AUDIO-143 — Render Quality Policy

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 143 of the pre-hardening baseline

Final rendering and export shall default to the highest-quality practical processing path appropriate to the selected output format and operation.

The final-render path should prioritise:

1. Signal quality
2. Determinism/reproducibility
3. Numerical correctness
4. Preservation of source fidelity
5. Robustness
6. Performance

Performance must not be prioritised over final quality merely to reduce render time.

Users must retain control over quality/performance trade-offs.

Where meaningful, rendering should expose presets such as:

- Draft
- Standard
- High
- Maximum
- Custom

The normal default for final export should favour High or Maximum quality according to the processor/format, while preview workflows may use lower-latency paths.

Advanced settings should expose the actual underlying parameters rather than presenting opaque quality labels only.

Any non-deterministic or platform-native fast-render path must be explicitly identified and must not silently replace the canonical deterministic render path.

---

## REQ-AUDIO-145 — Processor Versioning and Reproducibility

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 145 of the pre-hardening baseline

Processor identity and implementation version shall be persisted as part of authoritative project state where the processor's behaviour can affect rendered output.

At minimum, reproducibility metadata should be capable of identifying:

- Processor type
- Processor implementation version
- Parameter schema version
- Relevant model version for ML processors
- Relevant codec/resampler implementation version where necessary
- Render-engine version or compatibility level where necessary

Before version 1.0.0, the existing pre-1.0 breaking-change policy applies: legacy processor compatibility layers are not required, and incompatible stored data may require backup/export followed by reset.

From version 1.0.0 onward, AudioGubbins must deliberately manage processor evolution so that opening an older project does not silently alter its sound.

Post-1.0 strategies may include:

- Retaining compatible legacy implementations
- Explicit processor migration
- Version-pinned rendering
- User-visible upgrade comparison
- Render-freezing/archive workflows

Silent sonic changes caused solely by an application upgrade are not acceptable after 1.0.0.

---

## REQ-AUDIO-146 — DSP Architecture Review Requirements

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 146 of the pre-hardening baseline

Every implementation phase that introduces or materially changes DSP infrastructure must include review of:

- Deterministic behaviour
- Numerical stability
- Denormal handling where relevant
- Clipping and headroom
- Channel-count correctness
- Sample-rate correctness
- Latency reporting
- Delay compensation
- Parameter smoothing
- Thread/worker safety
- Real-time safety for AudioWorklet code
- Allocation behaviour on real-time paths
- WASM boundary overhead
- Cache invalidation correctness
- Processor versioning
- Offline versus real-time equivalence
- Golden audio regression coverage

Real-time processing code must not perform unbounded allocation, filesystem access, network access, blocking waits, or other operations unsuitable for an audio rendering thread/worklet.

Golden/regression audio tests should compare outputs using both exact checks where determinism permits and perceptually/numerically appropriate tolerances where exact bit identity is not guaranteed.

---

## REQ-PROD-039 — Third-Party Plugins

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `DEFERRED`
- **Legacy source:** section 39 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

Third-party plugins are a future goal.

The initial implementation will not expose arbitrary third-party plugin loading.

However, internal processor/plugin abstractions should avoid preventing a future plugin ecosystem.

Security boundaries, sandboxing, compatibility, and versioning must be considered before third-party plugins are exposed.

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

# Current Ledger Entry

```json
{
  "phase": 6,
  "name": "Effect Rack and Core DSP",
  "status": "NOT_READY",
  "hard_dependencies": [
    3,
    5
  ],
  "phase_file": "phases/phase-06-effect-rack-and-core-dsp.md",
  "requirements": [
    "REQ-AUDIO-017",
    "REQ-AUDIO-018",
    "REQ-AUDIO-019",
    "REQ-PROD-039",
    "REQ-AUDIO-080",
    "REQ-AUDIO-086",
    "REQ-AUDIO-138",
    "REQ-AUDIO-139",
    "REQ-AUDIO-143",
    "REQ-AUDIO-145",
    "REQ-AUDIO-146"
  ],
  "open_verified_findings": [],
  "commits": [],
  "evidence": [],
  "handoff": null
}
```
