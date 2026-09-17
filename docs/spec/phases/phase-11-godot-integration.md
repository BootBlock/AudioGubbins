# Phase 11 — Godot Integration

## Status

`NOT_READY` — blocked by Phase(s) 02, 03, 06, 09, 10 reaching `PASS`.

## Objective

Implement first-class Godot 4+ integration: a `@tool` EditorPlugin, optional runtime addon, native resources/event model, live/export synchronisation, parameter/layer/variation runtime behaviour, multi-target projects, deterministic generated data, and debugging.

## User-Visible Outcome

A Godot 4 project can install AudioGubbins addons, receive deterministic game-ready audio/resources from AudioGubbins, use runtime events/variations/parameters/layers in games, and iterate seamlessly without trapping audio in proprietary packages.

## Hard Dependencies

- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 06 — Effect Rack and Core DSP
- Phase 09 — Import, Export, and Codec System
- Phase 10 — Game-Audio Tooling

## Owned Requirements

- `REQ-GODOT-024` — Godot Integration (`CURRENT`)
- `REQ-GODOT-046` — Godot Integration Capability Strategy (`CURRENT`)
- `REQ-GODOT-048` — Godot Project Modification Safety (`CURRENT`)
- `REQ-GODOT-107` — Godot Integration Architecture (`CURRENT`)
- `REQ-GODOT-108` — AudioGubbins Godot Editor Addon (`CURRENT`)
- `REQ-GODOT-109` — Godot Runtime Addon (`CURRENT`)
- `REQ-GODOT-110` — Godot-Native Resource Model (`CURRENT`)
- `REQ-GODOT-111` — AudioGubbins Event Model for Godot (`CURRENT`)
- `REQ-GODOT-114` — Runtime Parameterisation (`CURRENT`)
- `REQ-GODOT-115` — Godot Playback Components and API (`CURRENT`)
- `REQ-GODOT-116` — Editor-to-Runtime Data Pipeline (`CURRENT`)
- `REQ-GODOT-117` — Live Godot Export and Synchronisation (`CURRENT`)
- `REQ-GODOT-118` — Source and Generated Asset Placement (`CURRENT`)
- `REQ-GODOT-119` — Persistent Export Recipes (`CURRENT`)
- `REQ-GODOT-123` — Godot-Side Generated Descriptors (`CURRENT`)
- `REQ-GODOT-124` — Multiple Godot Targets (`CURRENT`)
- `REQ-GODOT-125` — Godot Addon Packaging and Independence (`CURRENT`)
- `REQ-GODOT-126` — Godot Integration Safety and Review Requirements (`CURRENT`)
- `REQ-GODOT-127` — Godot Runtime Integration Direction (`CURRENT`)
- `REQ-GODOT-128` — Parameter-Driven Runtime Audio Model (`CURRENT`)
- `REQ-GODOT-129` — Layered and Composite Events (`CURRENT`)
- `REQ-GODOT-130` — Advanced Event Authoring Direction (`CURRENT`)
- `REQ-GODOT-131` — Godot Generated Data Location (`CURRENT`)
- `REQ-GODOT-132` — Git and Source-Control Behaviour for Godot Integration (`CURRENT`)
- `REQ-GODOT-133` — Runtime Independence and Open Asset Principle (`CURRENT`)
- `REQ-GODOT-134` — Live Synchronisation Architecture (`CURRENT`)
- `REQ-GODOT-135` — Godot Runtime Diagnostics and Debugging (`CURRENT`)
- `REQ-REPO-190` — Godot Automated Testing with GUT (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-GODOT-047` — Godot Synchronisation Direction (`DEFERRED`)

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

- [ ] Godot `@tool` EditorPlugin
- [ ] Godot runtime addon
- [ ] Generated native `.tres`/resource schemas
- [ ] AudioGubbins event resources
- [ ] Variation/random/sequence containers
- [ ] Runtime parameters/conditions
- [ ] Layered/composite events
- [ ] Cooldown/concurrency/voice stealing
- [ ] 2D/3D playback helpers and bus routing
- [ ] Deterministic seeds/debug inspection
- [ ] Live export and trusted overwrite
- [ ] Configurable generated data path
- [ ] Multiple Godot targets
- [ ] Project safety/diffs
- [ ] Future two-way sync extension boundary
- [ ] GUT automated project

## Explicitly Out of Scope

- Godot 3 support
- Mandatory native bridge
- Opaque replacement of Godot AudioServer/mixer
- Automatic mutation of unrelated project settings
- Full two-way sync unless separately activated by future requirement

## Owned Modules / Packages

- `godot/addons/audiogubbins`
- `godot/runtime`
- `packages/godot-schema`
- `packages/godot-integration`
- `tests/godot-fixture-project`

## Cross-Package Dependency Rules

- Godot web-side integration depends on stable game/export schemas.
- Godot runtime addon cannot depend on EditorPlugin/editor-only APIs.
- Generated resources do not reach into private web-editor implementation details.

## Required Public Contracts

- Godot interchange manifest
- GeneratedResourceVersion
- AudioGubbinsEvent resource schema
- VariationSet resource schema
- RuntimeParameter schema
- EditorAddon protocol
- ExportTarget descriptor
- LiveSync status

## Data / Schema Changes

- Introduces versioned AudioGubbins↔Godot manifests, generated Godot resource schemas, event/variation/parameter/layer resources, target configuration and live-sync metadata.

## Browser / Platform Considerations

- Godot 4+ only.
- Direct local-folder integration is progressive enhancement; download/manual import fallback remains.
- Browser PWA cannot assume a native bridge.

## Architectural Invariants

- Rendered audio remains normal Godot-usable audio even without runtime addon.
- Runtime addon uses Godot-native AudioServer/AudioStreamPlayer* infrastructure rather than replacing the mixer.
- Generated text resources are deterministic/Git-friendly.
- No broad/opaque Godot project rewrite.
- Godot editor-only APIs do not leak into runtime addon.

## Internal Work Units

### WU-11.A — Interchange and packaging

- [ ] Define versioned schemas/resource generators
- [ ] Implement deterministic generated folder with configurable default
- [ ] Package editor/runtime addons independently

### WU-11.B — `@tool` editor addon

- [ ] Implement EditorPlugin install/discovery/status UI
- [ ] Detect AudioGubbins manifests/exports and request safe refresh/reimport workflows
- [ ] Provide project-link/debug surfaces

### WU-11.C — Runtime event system

- [ ] Implement event/variation/sequence resources
- [ ] Implement typed parameters/conditions, layers, randomisation, cooldowns, concurrency/voice stealing, deterministic seeds
- [ ] Implement 2D/3D helpers and bus routing

### WU-11.D — Live export and targets

- [ ] Implement one AudioGubbins project targeting multiple Godot projects
- [ ] Implement trusted auto-overwrite/live-export policy and status
- [ ] Support masters inside or outside game repository

### WU-11.E — Diagnostics and tests

- [ ] Implement editor/runtime debug inspection overlay/tools
- [ ] Create GUT headless tests for generated resources, deterministic selections, concurrency and runtime playback contracts

## Failure and Recovery Behaviour

- Missing addon must not make audio files unusable.
- Schema/resource version mismatch must produce explicit actionable errors.
- Running game/runtime must never depend on `@tool`/EditorPlugin APIs.
- Live-export permission/collision failure must not corrupt target files.
- Generated resource update must be atomic where possible.

## Required Verification Commands / Suites

- `pnpm test --filter godot-schema --filter godot-integration`
- `godot --headless --path tests/godot-fixture-project -s addons/gut/gut_cmdln.gd`
- `pnpm test:godot-generation`
- `pnpm test:godot-live-export`

## Acceptance Criteria

- [ ] Godot 4 fixture project loads all generated resources without editor errors.
- [ ] Same manifest/input/version yields deterministic text resources and seeded runtime variation choices.
- [ ] Runtime addon functions in exported/headless runtime without editor classes.
- [ ] Layered/parameterised events, cooldowns and concurrency are covered by GUT tests.
- [ ] Audio files remain directly usable after removing the runtime addon.
- [ ] Live export updates configured assets seamlessly under explicit trusted policy and reports degraded/manual paths where direct filesystem access is unavailable.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No Godot 3 compatibility code.
- No FMod-style proprietary bank lock-in.
- No silent rewrite of unrelated `project.godot` or resources.
- No editor addon singleton becoming the game's audio engine.

## Required Review Lenses

- Godot Editor / Runtime Integration
- Audio Correctness
- Architecture
- Data Integrity / External Files
- Testing / GUT
- Security / Permissions
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-11.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
