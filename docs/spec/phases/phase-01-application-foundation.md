# Phase 01 — Application Foundation

## Status

`PASS` — completed on 2026-09-28; see `reviews/phase-01-evidence.md`, `reviews/phase-01-review.md` and `traceability/handoffs/phase-01.md`.

## Objective

Create the production monorepo foundation, web application shell, design system, workspace infrastructure, typed command boundary, state-ownership model, settings/diagnostics foundations, and development/build tooling required by all later phases.

## User-Visible Outcome

AudioGubbins launches locally as a polished responsive shell with docking, themes, settings, command discovery, shortcuts, capability/status surfaces, and strict architecture boundaries, but does not yet edit real audio.

## Hard Dependencies

- Phase 00 — Requirements and Architectural Baseline

## Owned Requirements

- `REQ-ARCH-004` — Core Architectural Principles (`CURRENT`)
- `REQ-UX-005` — User Experience Goals (`CURRENT`)
- `REQ-PROD-006` — Primary Users (`CURRENT`)
- `REQ-PWA-031` — Local Development (`CURRENT`)
- `REQ-REPO-033` — Source Control and Licensing (`CURRENT`)
- `REQ-ARCH-034` — Dependency Philosophy (`CURRENT`)
- `REQ-PROD-056` — Product Name (`CURRENT`)
- `REQ-UX-057` — Dockable Workspace System (`CURRENT`)
- `REQ-UX-058` — Workspace Presets (`CURRENT`)
- `REQ-UX-059` — Workspace State Persistence (`CURRENT`)
- `REQ-UX-060` — Asset Browser and Editor Tabs (`CURRENT`)
- `REQ-UX-066` — Shortcut System (`CURRENT`)
- `REQ-UX-067` — Touch and Gesture Model (`CURRENT`)
- `REQ-UX-068` — Stylus and Pressure Input (`CURRENT`)
- `REQ-UX-069` — Motion and Animation (`CURRENT`)
- `REQ-UX-070` — Theme System (`CURRENT`)
- `REQ-UX-071` — Information Density and UI Customisation (`CURRENT`)
- `REQ-EDIT-072` — Contextual Inspector (`CURRENT`)
- `REQ-EDIT-073` — Unified Typed Command Architecture (`CURRENT`)
- `REQ-REPO-142` — Open-Source Licence (`CURRENT`)
- `REQ-ARCH-151` — Initial Front-End and Workspace Technology Selection (`CURRENT`)
- `REQ-ARCH-153` — State Ownership and Workflow State (`CURRENT`)
- `REQ-REPO-154` — Repository and Package Topology (`CURRENT`)
- `REQ-UX-155` — Styling and Design-System Architecture (`CURRENT`)
- `REQ-PRIV-161` — Diagnostic Submission and Consent Policy (`CURRENT`)
- `REQ-PRIV-162` — Usage Analytics Policy (`CURRENT`)
- `REQ-PRIV-164` — Language and Localisation Policy (`CURRENT`)
- `REQ-PRIV-165` — Structured Diagnostic Logging (`CURRENT`)
- `REQ-REPO-185` — Repository and Monorepo Structure (`CURRENT`)
- `REQ-REPO-186` — Package and Workspace Management (`CURRENT`)
- `REQ-REPO-187` — Product Versioning (`CURRENT`)
- `REQ-REPO-191` — Reference Assets, Fixtures, and Example Projects (`CURRENT`)

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

- [ ] pnpm/Cargo monorepo skeleton
- [ ] React/TypeScript/Vite application shell
- [ ] AudioGubbins design-token/theme system
- [ ] Dockview-based workspace abstraction
- [ ] Typed command bus/application boundary
- [ ] Partitioned state model and lifecycle state machines
- [ ] Shortcut/command palette infrastructure
- [ ] Local structured diagnostics with zero telemetry
- [ ] Input abstraction for mouse/touch/pen/keyboard
- [ ] Initial architecture tests and deterministic test fixtures

## Explicitly Out of Scope

- Project persistence implementation
- Audio playback/DSP
- Waveform editing
- Godot integration
- PWA offline hardening beyond basic dev manifest scaffolding

## Owned Modules / Packages

- `apps/web`
- `packages/domain`
- `packages/commands`
- `packages/design-system`
- `packages/workspace`
- `packages/capabilities`
- `packages/diagnostics`
- `packages/test-fixtures`
- `packages/version` (`ADR-0016`)
- `packages/input` (`ADR-0017`)
- `packages/text` (`ADR-0018`)
- `crates/ (workspace skeleton only)`

## Cross-Package Dependency Rules

- `apps/web` may depend on public domain/commands/design/workspace contracts.
- Framework/UI packages must not be imported by domain packages.
- Dockview/Radix/Motion types are contained behind UI/workspace adapters.

## Required Public Contracts

- Command descriptor/execution/result types
- Capability registry and degradation descriptor
- Theme/density/motion preference schema
- Workspace panel/layout API
- Diagnostics event schema and redaction contract
- Public package dependency graph

## Data / Schema Changes

- Persisted user-preference/workspace-layout/shortcut-profile formats may be introduced; version them independently from project data.
- No authoritative audio-project schema is owned by this phase.
- The non-authoritative domain value model in `packages/domain` is owned by this phase (`ADR-0015`): in-memory value types with no schema version, serialisation or storage path, which the deterministic fixtures (`REQ-REPO-191`) are built from.

## Browser / Platform Considerations

- Support modern Chrome/Edge/Firefox/Safari-class browsers; input architecture must handle mouse, keyboard, touch and pen.
- Basic static build must remain compatible with GitHub Pages pathing; full offline/install hardening is Phase 12.

## Architectural Invariants

- React state is not authoritative project/domain state.
- No global catch-all store.
- No UI component imports persistence or future audio-engine internals.
- No network telemetry/analytics path exists.
- Touch and pointer abstractions coexist; touch does not disable mouse/keyboard.

## Internal Work Units

### WU-01.A — Repository and boundaries

- [ ] Create pnpm and Cargo workspaces
- [ ] Define package public APIs and dependency rules
- [ ] Install architecture linting/cycle checks
- [ ] Configure strict TypeScript, formatting, linting, and test runners

### WU-01.B — Application shell and design system

- [ ] Implement semantic design tokens, dark/light/system themes, accent colour and brightness controls
- [ ] Implement density and motion settings with reduced-motion handling
- [ ] Implement accessible menu/dialog/popover/toolbar primitives

### WU-01.C — Workspace and commands

- [ ] Wrap Dockview behind AudioGubbins workspace contracts
- [ ] Implement built-in/custom workspace persistence model
- [ ] Implement typed command registry, command palette, shortcut profiles and conflict detection

### WU-01.D — Input, capabilities and diagnostics

- [ ] Create mouse/touch/pen/keyboard input abstraction
- [ ] Create capability registry and degraded-feature explanation surface
- [ ] Implement structured local logging, diagnostic mode and explicit-consent export path

### WU-01.E — Verification harness

- [ ] Create reusable deterministic fixtures
- [ ] Add architecture tests for forbidden dependency directions
- [ ] Add baseline visual/accessibility/browser smoke tests

## Failure and Recovery Behaviour

- Unsupported browser capabilities must be represented explicitly, not silently ignored.
- Workspace corruption must fall back to a known default without touching project/domain data.
- Diagnostic export failures must remain local and actionable.

## Required Verification Commands / Suites

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:architecture`
- `pnpm test:e2e:smoke`
- `cargo test --workspace`

## Acceptance Criteria

- [ ] Application starts through Vite and production build succeeds with no backend dependency.
- [ ] Dark/light/system themes, accent colour, brightness, density and motion settings work and meet contrast/reduced-motion requirements.
- [ ] Dock layouts can be saved/restored without storing authoritative project state in the docking engine.
- [ ] Every meaningful shell action goes through the typed command registry.
- [ ] Architecture tests reject forbidden cross-package imports and circular dependencies.
- [ ] No usage analytics or implicit diagnostic transmission exists.
- [ ] Mouse, keyboard, touch and pen-capability smoke tests pass on representative inputs.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No `AppManager`/global service bag.
- No React Context/store containing unrelated application domains.
- No direct Dockview types in domain packages.
- No hard-coded component colour system bypassing semantic tokens.

## Required Review Lenses

- Architecture
- Code Quality / Maintainability
- Testing / Regression
- UX / Accessibility / Input
- Security / Privacy
- Browser Compatibility
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-01.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
