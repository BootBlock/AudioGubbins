# Phase 10 — Game-Audio Tooling

## Status

`NOT_READY` — blocked by Phase(s) 05, 06, 09 reaching `PASS`.

## Objective

Implement AudioGubbins' distinctive game-audio authoring workflows: loop creation/validation, asset groups, guided preparation, game-context auditioning, persistent export policy, and scalable one-shot/region production.

## User-Visible Outcome

Users can turn long recordings or individual sounds into organised game-ready assets, validate seamless loops, preview game-like triggering/attenuation, and reuse coherent processing/export policy without requiring Godot.

## Hard Dependencies

- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP
- Phase 09 — Import, Export, and Codec System

## Owned Requirements

- `REQ-GAME-023` — Game-Audio Features (`CURRENT`)
- `REQ-GAME-075` — Guided Task Workflows (`CURRENT`)
- `REQ-GAME-120` — Asset Groups and Inherited Game-Audio Policy (`CURRENT`)
- `REQ-GAME-121` — Seamless Loop Analysis and Validation (`CURRENT`)
- `REQ-GAME-122` — Game-Context Preview Simulator (`CURRENT`)

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

- [ ] Game-audio workspace/guided workflows
- [ ] Asset groups and inherited policy
- [ ] One-shot preparation
- [ ] Named regions and game naming templates
- [ ] Seamless loop editor/analyser/candidate suggestions
- [ ] Game-context preview simulator
- [ ] Game-oriented export policy/recipes
- [ ] Loudness matching and game presets
- [ ] Batch-ready domain hooks

## Explicitly Out of Scope

- Godot editor/runtime addon implementation
- Advanced stochastic variation generation owned by Phase 13
- Full multitrack composition

## Owned Modules / Packages

- `packages/game-audio`
- `packages/loop-analysis`
- `packages/export-recipes game layer`
- `apps/web game-audio workspace`

## Cross-Package Dependency Rules

- Game-audio domain depends on generic editing/DSP/export contracts.
- It must not import Godot-specific runtime/editor types.

## Required Public Contracts

- GameAssetGroup
- InheritedPolicy
- LoopDefinition/LoopAnalysis
- GamePreviewScenario
- NamingTemplate
- GameExportProfile

## Data / Schema Changes

- Introduces game asset-group policy, loop-analysis results, naming templates, game-preview scenarios and game export profiles.

## Browser / Platform Considerations

- All authoring features remain local/browser-based; direct Godot filesystem integration is not required in this phase.

## Architectural Invariants

- Guided workflows create the same inspectable operations an expert could create manually.
- Inheritance is explicit and overridable; no hidden magic settings.
- Loop suggestions never silently replace user loop points.
- Game preview is audition tooling, not the authoritative game runtime.

## Internal Work Units

### WU-10.A — Asset groups/policy

- [ ] Implement hierarchical game asset groups and override resolution
- [ ] Implement naming and export defaults

### WU-10.B — Guided workflows

- [ ] Implement Prepare One-Shot, Create Seamless Loop, Normalise Game SFX and related task flows
- [ ] Ensure generated operations remain fully editable

### WU-10.C — Loop analysis

- [ ] Implement discontinuity/DC/phase/level/zero-crossing analysis
- [ ] Implement candidate loop point suggestions and repeated-cycle audition

### WU-10.D — Game preview

- [ ] Implement rapid triggering, variation hooks, pitch/gain/start-offset simulation, attenuation and concurrency simulation

## Failure and Recovery Behaviour

- Invalid inherited settings must identify the owning group/override.
- Loop analysis failure must not alter saved loop points.
- Batch/guided operations fail atomically or record per-item failure explicitly.

## Required Verification Commands / Suites

- `pnpm test --filter game-audio --filter loop-analysis`
- `pnpm test:loop-golden`
- `pnpm test:e2e:game-workflows`

## Acceptance Criteria

- [ ] Long recordings can be segmented/named/processed/export-configured as many regions without source duplication.
- [ ] Loop analyser identifies known discontinuity fixtures and suggested points are reproducible.
- [ ] Guided workflows produce ordinary edit/effect/export objects visible in Inspector/history.
- [ ] Asset-group inheritance/override resolution is deterministic and directly tested.
- [ ] Game preview can repeatedly trigger representative one-shot/loop scenarios without changing authoritative edits.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No hidden beginner-only data model.
- No Godot-specific types in core game-audio domain.
- No automatic loop-point mutation without explicit user action.

## Required Review Lenses

- Audio / DSP Correctness
- UX / Accessibility
- Architecture
- Testing / Regression
- Performance
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-10.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
