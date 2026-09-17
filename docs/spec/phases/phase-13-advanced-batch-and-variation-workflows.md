# Phase 13 — Advanced Batch and Variation Workflows

## Status

`NOT_READY` — blocked by Phase(s) 05, 06, 09, 10, 11 reaching `PASS`.

## Objective

Implement advanced batch processing, variation-family authoring/generation, reusable action sequences, and scalable game-asset production over the already-stable edit/DSP/export/Godot contracts.

## User-Visible Outcome

Users can define rich variation families and processing/export automation, generate/audition/reject/rebuild large asset sets deterministically, and integrate those sets with Godot runtime resources.

## Hard Dependencies

- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP
- Phase 09 — Import, Export, and Codec System
- Phase 10 — Game-Audio Tooling
- Phase 11 — Godot Integration

## Owned Requirements

- `REQ-GAME-022` — Variation Generation (`CURRENT`)
- `REQ-GAME-074` — Macros and Action Sequences (`PLANNED`)
- `REQ-GAME-112` — Variation Sets as a First-Class Domain Concept (`CURRENT`)
- `REQ-GAME-113` — Runtime Variation Selection (`CURRENT`)

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

- [ ] First-class variation families
- [ ] Weighted/shuffle/repetition-avoidance generation
- [ ] Controlled pitch/gain/start/processor variation
- [ ] Seeded deterministic generation
- [ ] Batch processing/export jobs
- [ ] Action sequences/macros
- [ ] Audition/accept/reject candidate workflow
- [ ] Variation loudness/naming/indexing
- [ ] Godot variation-set integration

## Explicitly Out of Scope

- Live multi-user collaboration
- MIDI automation
- Full DAW automation lanes

## Owned Modules / Packages

- `packages/variations`
- `packages/batch`
- `packages/action-sequences`
- `packages/game-audio`
- `packages/godot-schema integration`

## Cross-Package Dependency Rules

- Macros invoke public typed commands rather than domain internals.
- Variation generation depends on generic game/DSP/export contracts; Godot adapters consume its public results.

## Required Public Contracts

- VariationFamily
- VariationRule
- GenerationSeed
- BatchJob
- BatchItemResult
- ActionSequence
- ActionTransaction

## Data / Schema Changes

- Introduces variation-family/rule/seed data, batch-job/item results and action-sequence/transaction formats.

## Browser / Platform Considerations

- Batch execution is bounded/resource-aware on all supported runtimes; acceleration is optional.
- External export effects remain permission/policy-sensitive.

## Architectural Invariants

- Generated variants retain provenance to source/rules/seed.
- Same source/rules/seed/version yields reproducible generation where processors are deterministic.
- Batch failures are itemised and never silently skipped.
- Macros use the same typed commands as interactive UI.

## Internal Work Units

### WU-13.A — Variation domain

- [ ] Implement variation families/rules/weights/shuffle/repetition avoidance
- [ ] Implement candidate lifecycle and deterministic seed controls

### WU-13.B — Batch engine

- [ ] Implement bounded-concurrency job scheduler with cancellation/resume/reporting
- [ ] Integrate import/edit/DSP/export without blocking UI

### WU-13.C — Action sequences

- [ ] Implement recorded/composed typed command sequences
- [ ] Group execution into coherent undo transactions and external-side-effect review

### WU-13.D — Godot/game integration

- [ ] Generate variation resources/exports coherently
- [ ] Implement auditioning/loudness matching/naming and rebuild workflows

## Failure and Recovery Behaviour

- One failed item must not falsely mark a batch successful.
- Cancellation must leave completed outputs valid and incomplete outputs clearly identified.
- External overwrites follow explicit destination policy.

## Required Verification Commands / Suites

- `pnpm test --filter variations --filter batch --filter action-sequences`
- `pnpm test:batch-recovery`
- `pnpm test:variation-determinism`
- `pnpm test:e2e:variation-workflow`

## Acceptance Criteria

- [ ] Variation generation is reproducible from recorded source/rule/seed/version.
- [ ] Large batch jobs keep interactive UI/audio responsive under default priority policy.
- [ ] Macros execute through public typed commands and are undo-grouped appropriately.
- [ ] Godot variation resources match the authored family and deterministic selection tests.
- [ ] Per-item error/retry reporting is complete.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No separate macro-only implementation of domain rules.
- No unbounded Promise fan-out for large batches.
- No random generation without recorded seed when reproducibility is requested.

## Required Review Lenses

- Architecture
- Audio Correctness
- Performance / Scalability
- Testing / Regression
- Godot Integration
- UX / Accessibility
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-13.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
