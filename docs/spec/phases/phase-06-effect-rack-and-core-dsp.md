# Phase 06 — Effect Rack and Core DSP

## Status

`PASS` — completed on 2026-10-09; see `reviews/phase-06-evidence.md`, `reviews/phase-06-review.md` and `traceability/handoffs/phase-06.md`.

## Objective

Implement the professional effect-rack and DSP subsystem, canonical processor library, advanced quality modes, local ML model-pack infrastructure, processor versioning, and deterministic render integration. A rack is a chain of processors that the edit plan runs, over a selected range or over a whole asset or region, so the plan stays the only description of an edited sound (`ADR-0060`).

## User-Visible Outcome

Users can build/reorder/bypass/preset/A-B non-destructive effect chains, preview them interactively, and render at maximum quality using a broad professional processor set and optional local ML restoration/separation packs. They can apply a chain to a selection, give an asset or a region a rack that follows it through later edits, share one chain between several regions, save chains and presets to their library and apply them to several targets at once, and find all of it again after a reload.

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

### Requirements Consumed From Other Phases

Owned elsewhere; this phase delivers the part named, or keeps what it asks.

- `REQ-EDIT-014` — Regions (Phase 05): shared processing chains, which the Phase 05 handoff gave this phase (`ADR-0060`).
- `REQ-EDIT-012` — Timeline and Editing Requirements (Phase 04): a chain applied to a selection, or to the whole target without one.
- `REQ-EDIT-072` — Contextual Inspector (Phase 01): the Inspector shows and changes processors and racks.
- `REQ-ARCH-004` — Core Architectural Principles (Phase 01): effect chains are authoritative project state.
- `REQ-ARCH-081` — Canonical Deterministic Processing (Phase 03): every processor's final render is canonical; inference is pinned, with any tolerance documented and tested.
- `REQ-ARCH-140` — Typed Directed Processing Graph (Phase 03): a rack is realised as a graph; serial and parallel slots, with no central processor manager.
- `REQ-ARCH-141` — DSP Implementation Languages (Phase 03): Rust for heavy kernels behind the narrow ABI.
- `REQ-ARCH-144` — Processor Latency and Automatic Delay Compensation (Phase 03): every processor reports its latency, inference included.
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio (Phase 03): every processor declares the layouts it accepts.
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate (Phase 03): an asset's rate changes only by an explicit conversion.
- `REQ-ARCH-088` — Fully Local Core Processing (Phase 03): no remote processing, ever.
- `REQ-ARCH-153` — State Ownership and Workflow State (Phase 01): model-pack installation is an explicit state machine.
- `REQ-REPO-187` — Product Versioning (Phase 01): processor implementation versions and model-pack versions.
- `REQ-REPO-191` — Reference Assets, Fixtures, and Example Projects (Phase 01): model weights and large media stay out of Git history.
- `REQ-STOR-166` — Asset Provenance and Traceability (Phase 02): processor versions, render-quality mode and model versions in provenance.
- `REQ-STOR-195` — Whole-Project A/B State Comparison (Phase 02): chains and parameters compared between states.
- `REQ-PRIV-161` — Diagnostic Submission and Consent Policy (Phase 01): a diagnostic bundle may name processor and model versions.

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

- [ ] Effect racks and processor descriptors: one object per processor type that states its `ProcessorDescriptor` and makes its kernel (`ADR-0061`)
- [ ] The domain's `EffectChain` extended with slots, parallel groups and wet/dry, bypass being its existing `enabled` flag extended to slots and groups; no second chain model (`ADR-0060`)
- [ ] A chain applied to a selected range as a processing operation, and a rack on an asset and on a region over the whole target, both realised by the plan (`ADR-0060`)
- [ ] Shared chains: several operations or targets naming one chain, and making one independent (`REQ-EDIT-014`)
- [ ] Professional core DSP suite: every processor of `REQ-AUDIO-018` that is not already an edit operation, listed under WU-06.B
- [ ] Time stretching and the sample-rate conversion of an asset as operations in its chain that carry positions by their ratio
- [ ] New canonical primitives (exponential, logarithm, power, trigonometric functions) in both implementations (`ADR-0032`, `ADR-0061`)
- [ ] `crates/analysis`: the short-time Fourier transform, peak and loudness measurement, and the detectors restoration needs
- [ ] Serial/parallel graph usage, wet/dry, side-chain-ready contracts
- [ ] Preview/final quality modes: `QualityMode` replacing `RenderQualityProfile`
- [ ] Real-time preview, bypass, A/B and processed/original comparison, and parameter changes during playback
- [ ] The cached preview producer that Phase 03's mode selector reports as missing
- [ ] Processor presets/chains: saved in the person's library, applied to one or to several selected targets in one history step
- [ ] Copying and pasting processors, slots, groups and chains through the one clipboard (`ADR-0053` amended)
- [ ] Processor versioning
- [ ] Local ML model-pack manager
- [ ] Local ML restoration/source-separation processors: the packs `ADR-0062` names
- [ ] Transient and noise classification, restoration assistance, repair suggestions and analysis that recommends processing, on `crates/analysis`'s detectors, recommending and never applying (`ADR-0062`)
- [ ] Deterministic canonical render integration
- [ ] Third-party plugin extension boundary only; no third-party loading
- [ ] Rack and processor views in the editor and the Inspector, invoking only project commands

## Explicitly Out of Scope

- Spectral painting UI and spectral selection editing (Phase 08, which reads this phase's `crates/analysis` and ML processors)
- Third-party plugin ecosystem
- Cloud ML processing
- Track, bus and master racks: no track or bus exists yet; their `effectChainId` fields stay, and a later phase runs them as `ADR-0060` says
- Export and every audio writer (Phase 09), which renders through this phase's chains
- Monitoring through effects while recording (Phase 07)
- Loudness matching across groups and variation sets (Phases 10 and 13), which read this phase's loudness measurement
- Advanced batch workflows beyond applying a saved chain to several selected targets (Phase 13)
- ML packs whose weights are not licensed for redistribution (`ADR-0062`); the infrastructure admits them unchanged once they are

## Owned Modules / Packages

- `packages/processors`
- `packages/effect-rack`
- `packages/ml-runtime`
- `packages/model-packs`
- `crates/analysis`
- `crates/dsp-core` (Phase 03's; this phase extends it with the new primitives and kernels)
- `crates/wasm-bindings` (Phase 03's; this phase extends its ABI and raises its version)
- `packages/domain/processing` and `packages/domain/editing` (the chain, processor state and the plan's processed stream)
- `packages/project-commands` rack and processor commands
- `apps/web rack, processor and model-pack views`

## Cross-Package Dependency Rules

- Processors implement audio-graph contracts and are independent of React/workspace.
- Model-pack storage uses storage public APIs, not OPFS internals.
- Third-party plugin code loading remains absent.
- `packages/processors` depends on the domain, `audio-graph`, `audio-engine`, `text` and the inference port of `packages/ml-runtime`; `packages/effect-rack` on the domain, `audio-graph` and `processors`; neither knows a browser global (`ADR-0061`).
- `packages/audio-graph` and `packages/audio-engine` may depend on `packages/text` (`ADR-0030` amended); on nothing else new.
- `packages/ml-runtime` is reached by the ML processors through its inference port; only its worker adapter knows ONNX Runtime Web, and capabilities are probed by `packages/capabilities` (`ADR-0062`).
- The interface changes racks, chains, processors and packs only through project and application commands.

## Required Public Contracts

- ProcessorDescriptor
- ParameterDescriptor
- ProcessorStateVersion
- EffectRack
- Preset/Chain format
- ModelPackManifest
- MLProcessorCapability
- QualityMode
- The rack edit, and the rack of an asset and of a region (`ADR-0060`)
- The plan's processed stream (`ADR-0060`)
- The inference port (`ADR-0062`)
- AudioDetector, the analysis contract detectors and model packs implement (`ADR-0061`)

## Data / Schema Changes

- Introduces versioned processor state, effect-rack/chain preset formats, processor implementation IDs, model-pack manifests and quality-profile data.
- The project format gains rack edits, the racks of assets and regions, the extended chain, and time-stretch and rate-conversion operations, raising the project's schema version; before 1.0 nothing migrates (`REQ-STOR-052`).
- The person's library gains saved chains and presets, in the chain's one persisted form.
- The WASM ABI version is raised.
- Settled by this phase's readiness review (`ADR-0060`, `ADR-0061`, `ADR-0062`): where a rack sits in the edit model, how processors are joined to the engine and held canonical, and the inference runtime and first packs.

## Browser / Platform Considerations

- WASM/SIMD/GPU/inference acceleration is capability-based.
- ML model availability/storage may vary; no remote fallback.
- Real-time preview may use a different disclosed quality path than final render.
- ONNX Runtime Web's files are served by the application and loaded only when an ML processor first runs; a final render's inference uses one thread, so it needs no cross-origin isolation.

## Architectural Invariants

- Processors declare supported channel layouts, latency and determinism characteristics.
- Final render defaults to highest-quality supported mode; user may choose lower/faster modes.
- ML audio never leaves device.
- Changing processor algorithm/version cannot silently change old post-1.0 project sound.
- The edit plan is the only description of an edited sound; racks are realised in it.
- A chain has one persisted form, in a project or a library.
- A processed stream renders from its own start; the audio a region's rack reads is exactly its span of its asset's processed audio.
- Every canonical kernel in Rust has its reference TypeScript implementation, run by the same golden test.
- No platform transcendental function or browser-native node is in a canonical path.

## Internal Work Units

### WU-06.A — Processor framework

- [ ] Implement typed processor descriptors/parameters/state versioning
- [ ] Join each processor's descriptor to its node implementation
- [ ] Implement effect racks, bypass, reorder, wet/dry, preset/chain serialisation
- [ ] Copy and paste processors, slots, groups and chains through the clipboard
- [ ] Integrate graph latency compensation
- [ ] Fold rack edits and racks into the plan as processed streams, with their commands, inverses and validation
- [ ] Implement shared chains, making one independent, and applying a saved chain to several targets

### WU-06.B — Core DSP

- [ ] Add the canonical exponential, logarithm, power and trigonometric primitives in both implementations
- [ ] Implement gain/normalisation/EQ/filter/compression/limiting/gate/expansion/de-ess/DC/channel/fade/reverse/delay/reverb and cleanup processors, where fade, reverse, polarity, silence and channel edits are Phase 05's edit operations, gain is the engine's gain node, and resampling is the asset rate conversion below
- [ ] Implement peak and loudness normalisation with a whole-input analysis pass
- [ ] Implement silence generation and silence trimming through the insertion and trim operations
- [ ] Implement pitch shifting as a processor, and time stretching and asset rate conversion as chain operations
- [ ] Implement ambisonic encode, decode and rotate processors (Phase 03's F-38)
- [ ] Provide deterministic audio golden tests and N-channel behaviour

### WU-06.C — Advanced restoration

- [ ] Implement de-hum/de-click/de-pop/noise-reduction foundations
- [ ] Implement dereverberation by weighted prediction error, and click and pop detection, as canonical processors
- [ ] Implement analysis and preview caching where needed
- [ ] Implement the classification, restoration and repair assistants on the detectors, each recommending a chain the person applies

### WU-06.D — Local ML infrastructure

- [ ] Implement model-pack download/import with progress, pause, cancel and retry, and integrity/version/storage/delete controls
- [ ] Implement local inference abstraction and quality tiers
- [ ] Add the restoration, enhancement and separation packs `ADR-0062` names, without remote fallback

### WU-06.E — Quality/reproducibility

- [ ] Implement preview vs final quality disclosure
- [ ] Persist processor implementation versions
- [ ] Add A/B and processed/original comparison
- [ ] Replace `RenderQualityProfile` with `QualityMode`, and produce cached preview renders

## Failure and Recovery Behaviour

- Missing ML models must degrade to an explicit unavailable capability, never cloud fallback.
- Model-pack corruption/incompatibility must not affect project validity.
- Processor failure must not silently output zero/unchanged audio as success.
- Unsupported channel layouts must fail/adapt explicitly.
- A chain, processor or state version the reader does not know is refused with the reason, before 1.0 with no migration.
- A chain that something names cannot be removed.
- An interrupted or cancelled pack download or import keeps nothing unverified, and can be resumed or retried.

## Required Verification Commands / Suites

- `cargo test --workspace`
- `pnpm --filter @audiogubbins/processors --filter @audiogubbins/effect-rack --filter @audiogubbins/ml-runtime --filter @audiogubbins/model-packs test`
- `pnpm test:audio-golden`
- `pnpm test:audio-latency`
- `pnpm test:editing-property`
- `pnpm test:project-roundtrip`
- `pnpm test:dsp-property`, which this phase adds
- `pnpm test:ml-locality`, which this phase adds
- `pnpm test:architecture`

## Acceptance Criteria

- [ ] Every required processor has golden/property tests covering silence, impulses, full-scale, denormals/NaN defence, and representative programme material.
- [ ] Effect chains round-trip through project persistence with identical parameter state.
- [ ] Maximum-quality final render is the default and visibly distinct from lower quality when relevant.
- [ ] Model packs can be installed/verified/removed without transmitting audio or breaking projects.
- [ ] Processor latency and channel-layout declarations are enforced.
- [ ] No third-party arbitrary code/plugin loading exists.
- [ ] Every Rust kernel and new primitive renders the same bits as its reference implementation; every ML processor's final render is pinned as `ADR-0062` states.
- [ ] A chain applied to a selection, an asset's rack and a region's rack render as `ADR-0060` orders them, and the audio a region's rack reads is exactly its span of its asset's processed audio.
- [ ] A change to a shared chain reaches every operation and target that names it, and one undo restores it.
- [ ] Each ML pack's final render is one hash per pack and settings in every browser the tests run, or within a documented and tested tolerance.
- [ ] A browser test applies a chain to a selection, gives a region a rack, reloads, and hears the same project.

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
- No second chain model beside the domain's `EffectChain`, and no rack rendered outside the plan.
- No processor that re-implements an edit operation Phase 05 made.
- No model weights or large test media committed to the repository.

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

## Inherited Debt

Assigned to this phase by the Phase 03 and Phase 05 reviews and their handoffs:

- F-07's remnants (Phase 05, LOW): `audio-graph` and `audio-engine` each write their own count (`layout-description.ts`, `stability.ts`) and take `counted` from `packages/text` (`ADR-0030` amended); a time of day to the second is written three ways (`packages/storage-runtime/src/host/browser-host.ts`, `apps/web/src/app.tsx`, `apps/web/src/shell/diagnostics-panel.tsx`); `packages/storage/src/usage-measurement.ts` lists projects by hand; and names are quoted two ways, curly in `packages/project-commands/src/project-command.ts` and straight in `apps/web/src/wording.ts`.
- The shared processing chains of `REQ-EDIT-014` (Phase 05), listed under In Scope.
- F-38 (Phase 03): ambisonic encode, decode and rotate are processors, listed under WU-06.B.
- Phase 03's cached preview mode, which has no producer, listed under In Scope.
- The tests that time out under load at Vitest's five-second default (Phase 05) and that this phase's gates run: the golden render (`pnpm test:audio-golden`), the random command walk in `project-commands.test.ts` (`pnpm test:editing-property`) and the ESLint and Prettier exclusion test in `tests/architecture/dependency-rules.test.ts` (`pnpm test:architecture`). The comment-width and keyboard-wiring tests, which no gate of this phase runs, stay Phase 14's.

## Handoff Capsule

Create `traceability/handoffs/phase-06.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
