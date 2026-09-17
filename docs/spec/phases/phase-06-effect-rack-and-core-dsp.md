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
