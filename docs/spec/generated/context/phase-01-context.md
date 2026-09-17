# AudioGubbins Phase 01 Context Pack

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

# Phase 01 — Application Foundation

## Status

`READY` — Phase 00 specification gate has passed; implementation may begin when the repository/worktree is prepared.

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

# Referenced Requirement Blocks

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

## REQ-UX-005 — User Experience Goals

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 5 of the pre-hardening baseline

The application shall behave as a modern, sleek, visually rich multimedia application rather than a conventional form-based web application.

The UX should support:

- Mouse
- Keyboard
- Touch
- Pen/stylus where available
- Hybrid devices
- Surface-class devices
- Desktop
- Laptop
- Tablet
- Mobile

The interface should support professional desktop-style interaction patterns where appropriate, including:

- Menu systems
- Toolbars
- Context menus
- Dockable or resizable panels
- Drag and drop
- Keyboard shortcuts
- Command palette
- Status and transport controls
- Timeline interactions
- Touch-friendly controls
- Responsive layout adaptation
- Smooth animations and transitions

Accessibility must remain a first-class requirement.

Highly visual editing modes may use specialised interactions, but keyboard-operable and semantic alternatives should be provided wherever realistically possible.

---

## REQ-PROD-006 — Primary Users

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 6 of the pre-hardening baseline

Initial primary users:

- The project author
- Software developers
- Game developers
- Technical creators

The application must also remain approachable to:

- Sound designers
- Content creators
- Hobbyists
- General users
- Users without advanced audio-engineering knowledge

No UI or workflow should be made needlessly technical.

---

## REQ-PWA-031 — Local Development

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 31 of the pre-hardening baseline

Vite is mandatory for local development and testing.

The project must support:

- Local development server
- Hot reload
- Production builds
- Static deployment
- PWA development/testing
- GitHub Pages deployment

---

## REQ-REPO-033 — Source Control and Licensing

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 33 of the pre-hardening baseline

The project will be:

- Open source
- Hosted on GitHub

Dependency selection must therefore consider:

- Licence compatibility
- Redistribution rights
- Codec licensing
- Patent implications where relevant
- Long-term maintainability
- Project health

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

## REQ-PROD-056 — Product Name

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 56 of the pre-hardening baseline

The application is named **AudioGubbins**.

The product name should be used consistently in:

- Application chrome
- PWA manifest metadata
- Project documentation
- Repository documentation
- Exported diagnostic information
- About/help surfaces

Internal package, namespace, and identifier naming should remain stable and deliberately chosen so that display-name changes would not require invasive schema changes.

---

## REQ-UX-057 — Dockable Workspace System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 57 of the pre-hardening baseline

On desktop, laptop, tablet, and sufficiently large hybrid-device layouts, AudioGubbins shall provide a full professional docking system.

Panels should support, where appropriate:

- Docking to workspace edges
- Reordering
- Resizing
- Tab grouping
- Collapsing
- Hiding/showing
- Moving between dock regions
- Floating within the application workspace where practical
- Restoring default layouts
- Saving user-defined workspace layouts

Touch layouts may impose adaptive constraints where unrestricted docking would harm usability, but the underlying workspace model must remain consistent.

The docking system must be treated as core application infrastructure rather than implemented independently by individual panels.

---

## REQ-UX-058 — Workspace Presets

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 58 of the pre-hardening baseline

AudioGubbins shall provide built-in workspace presets targeted at common tasks.

Initial or planned presets should include:

- Editing
- Spectral Repair
- Recording
- Game Audio
- Batch Processing
- Future Multitrack

Users shall be able to:

- Create custom workspaces
- Save current layouts
- Duplicate layouts
- Rename layouts
- Reset built-in layouts
- Delete user-created layouts
- Switch rapidly between layouts

Workspace switching must not alter authoritative project audio state.

---

## REQ-UX-059 — Workspace State Persistence

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 59 of the pre-hardening baseline

Workspace and UI state should support both:

- Global user defaults
- Optional per-project overrides

Persistable state may include:

- Dock layout
- Panel visibility
- Panel sizes
- Toolbar configuration
- Favourite commands
- Recent tools
- Zoom/display preferences
- Inspector state
- Workspace preset
- Editor view configuration

Per-project workspace data must be clearly separable from project audio/editing data so that UI preferences cannot corrupt the authoritative project model.

---

## REQ-UX-060 — Asset Browser and Editor Tabs

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 60 of the pre-hardening baseline

AudioGubbins shall support both:

- A project asset browser
- Multiple document-style editor tabs

The user should be able to keep several assets and/or several views open simultaneously.

Tab management should support professional workflows, including:

- Reordering
- Closing
- Reopening recently closed views where practical
- Pinning where beneficial
- Clear indication of the asset/view represented
- Preservation of independent view state

---

## REQ-UX-066 — Shortcut System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 66 of the pre-hardening baseline

AudioGubbins shall ship with a strong, coherent default keyboard shortcut profile.

Users must be able to fully remap shortcuts.

The shortcut architecture should support:

- Single-key shortcuts where appropriate
- Modifier combinations
- Multi-key chords
- Named shortcut profiles
- Import/export of profiles
- Reset to defaults
- Conflict detection
- Search
- Platform-specific representation
- Display of active shortcuts in menus and command search

Browser or operating-system-reserved shortcuts must be handled deliberately.

Where familiar professional desktop-editor conventions can be used safely, prefer them over inventing arbitrary mappings.

Alternative mappings must be provided when browser/OS interception makes a preferred shortcut unavailable.

---

## REQ-UX-067 — Touch and Gesture Model

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 67 of the pre-hardening baseline

Within editing canvases, the preferred default gesture model is:

- One finger: active primary editing tool
- Two fingers: pan/navigation
- Pinch: zoom
- Stylus/pen: precision primary input
- Long press: context action

Gesture behaviour should be configurable where beneficial.

Normal non-editor UI areas should retain conventional touch scrolling and controls.

The application must distinguish editing gestures from page/browser gestures carefully to avoid accidental browser navigation, zoom, or scrolling during editing.

---

## REQ-UX-068 — Stylus and Pressure Input

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 68 of the pre-hardening baseline

Stylus input should be first-class where browser/hardware capabilities permit.

Pressure-sensitive behaviour may be used for appropriate tools such as spectral painting/repair.

Pressure must be optional.

Users must be able to use deterministic fixed-strength behaviour regardless of pressure-capable hardware.

Hardware-specific expressive controls must never become a requirement for accessing an editing capability.

---

## REQ-UX-069 — Motion and Animation

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 69 of the pre-hardening baseline

The default visual experience should use the full intended animation richness.

Animation must remain functional, polished, and responsive rather than decorative at the expense of editing latency.

Appropriate animation may include:

- Dock/panel transitions
- Menu/context transitions
- Zoom transitions
- Drag/drop targets
- Meter movement
- Selection feedback
- Processor state changes
- Loading/progress transitions
- Workspace transitions

Direct manipulation of audio-editing controls must feel immediate.

Users shall be able to choose an animation/motion level.

At minimum the system should support:

- Full
- Reduced/subtle
- Minimal/off where practical

The application must also respect the operating system/browser `prefers-reduced-motion` preference, while allowing an explicit user override where accessibility guidance permits.

---

## REQ-UX-070 — Theme System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 70 of the pre-hardening baseline

Dark mode shall be the default visual theme.

AudioGubbins shall also support:

- Light mode
- System/automatic mode
- Accent-colour selection
- User-adjustable theme brightness/intensity
- Independent semantic palettes for waveform, spectrogram, selections, meters, markers, and analysis overlays

Theme brightness must not be implemented as a simple visual filter over the whole application.

Instead, the design system should expose semantic colour and luminance tokens so that contrast, accessibility, readability, and component hierarchy remain correct across the user-selectable brightness range.

The theme engine should be designed to permit future custom themes without requiring component-specific hard-coded colour overrides.

---

## REQ-UX-071 — Information Density and UI Customisation

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 71 of the pre-hardening baseline

The application must support multiple information-density preferences rather than forcing one compromise layout.

Users should be able to configure, where appropriate:

- Comfortable/approachable density
- Compact/high-density workspace
- Toolbar visibility
- Toolbar composition
- Panel layout
- Control sizing
- Inspector density
- Timeline ruler detail
- Meter detail
- Status information

Advanced controls should use progressive disclosure rather than being removed from approachable layouts.

---

## REQ-EDIT-072 — Contextual Inspector

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 72 of the pre-hardening baseline

A contextual Inspector shall be a core workspace concept.

Depending on selection, it may expose properties for:

- Assets
- Regions
- Clips
- Markers
- Loop definitions
- Channels
- Processors
- Effect racks
- Recording configuration
- Export jobs
- Future tracks/buses/automation objects

Direct manipulation in the editor and property editing in the Inspector must update the same underlying domain state.

---

## REQ-EDIT-073 — Unified Typed Command Architecture

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 73 of the pre-hardening baseline

Every meaningful application action should invoke a shared typed command system.

This includes actions initiated from:

- Menus
- Context menus
- Toolbars
- Keyboard shortcuts
- Command palette
- Touch UI
- Gestures
- Inspector controls
- Guided workflows
- Future macros
- Future scripting/plugin APIs

The command architecture should support:

- Validation
- Target resolution
- Undo/redo integration
- Transaction grouping
- Telemetry-free diagnostics
- Testing
- Accessibility
- Command discovery
- Future automation

UI components must not bypass the command/domain layer for convenience.

---

## REQ-REPO-142 — Open-Source Licence

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 142 of the pre-hardening baseline

AudioGubbins shall use the **Apache License 2.0** as the default project licence unless a later explicit project decision changes it.

This choice is intended to preserve permissive commercial and non-commercial reuse while providing an explicit patent licence/grant suitable for a project expected to include DSP, codecs, WebAssembly, and external contributors.

Dependency selection must include explicit licence review.

The project must maintain machine-readable and human-readable third-party attribution/licence information where required.

Dependencies with reciprocal/copyleft obligations must be evaluated deliberately before adoption. No implementation agent may introduce a dependency whose licence materially changes redistribution obligations for AudioGubbins without documenting the implications and passing the relevant architecture/licensing review gate.

Codec patent/licensing status must be considered separately from source-code licence compatibility.

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

## REQ-REPO-154 — Repository and Package Topology

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 154 of the pre-hardening baseline

AudioGubbins should use a single coordinated monorepo while the web application, Rust/WASM DSP, shared schemas, Godot editor addon, and Godot runtime addon are evolving together.

The repository shall use **pnpm workspaces** or an equivalently capable workspace system, with exact dependency versions locked by the repository lockfile.

A representative topology is:

```text
/
├─ apps/
│  └─ web/                    # AudioGubbins PWA
├─ packages/
│  ├─ domain/                 # Framework-agnostic project/domain model
│  ├─ commands/               # Typed command contracts and execution
│  ├─ project-format/         # Schemas, serialisation, validation
│  ├─ storage/                # OPFS/external/project storage adapters
│  ├─ audio-engine/           # TS orchestration for playback/graph engine
│  ├─ renderer/               # Editor renderer contracts/backends
│  ├─ design-system/          # AudioGubbins React UI/design tokens
│  ├─ workspace/              # Docking/workspace integration
│  ├─ codecs/                 # Codec orchestration/contracts
│  ├─ godot-schema/           # Shared generated/runtime integration schemas
│  └─ test-fixtures/          # Reusable deterministic fixtures
├─ crates/
│  ├─ dsp-core/               # Rust DSP primitives
│  ├─ resampling/             # Canonical resampling implementation
│  ├─ analysis/               # FFT/analysis primitives as appropriate
│  └─ wasm-bindings/          # Narrow WASM boundary layer
├─ godot/
│  ├─ addons/audiogubbins/    # @tool editor addon
│  └─ runtime/                # Runtime addon/package sources
├─ tools/                     # Build/codegen/validation tooling
├─ docs/                      # Architecture/ADRs/spec-derived documentation
└─ tests/                     # Cross-package/system/golden fixtures as appropriate
```

The exact topology may evolve through ADR-reviewed changes, but package boundaries must reflect subsystem ownership rather than arbitrary file-count splitting.

Packages must not be introduced merely to make the repository look modular. Each package requires a coherent responsibility, explicit dependency direction, and independently testable contract.

Circular package dependencies are prohibited.

---

## REQ-UX-155 — Styling and Design-System Architecture

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 155 of the pre-hardening baseline

AudioGubbins shall own a semantic design-token system rather than scattering literal colours, spacing values, radii, typography, motion settings, or density assumptions throughout components.

The styling architecture shall support:

- Dark/light/system themes
- User-selected accent colours
- Continuous or stepped theme-brightness controls
- Semantic contrast constraints
- Waveform/spectrogram palettes independent from chrome theme
- Comfortable and compact density modes
- Touch-target scaling
- Reduced-motion modes
- High-contrast/accessibility overrides
- Future custom themes

CSS custom properties should form the runtime theme contract. Build-time type-safe styling may be used where it improves correctness, but runtime theme changes must not require rebuilding stylesheets.

Tailwind-style utility usage must not become a substitute for semantic design tokens or component ownership. Any styling tool introduced must preserve the ability to reason about themes, accessibility, density, and component states at the design-system level.

---

## REQ-PRIV-161 — Diagnostic Submission and Consent Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 161 of the pre-hardening baseline

AudioGubbins must never transmit diagnostic information, crash data, logs, capability information, project metadata, file metadata, source media, rendered audio, or any other user/project information without the user's express permission.

There must be no silent crash reporting, background error reporting, or automatic diagnostic upload.

The application may provide an explicit diagnostic-sharing workflow that allows the user to review and submit a sanitised diagnostic bundle. The bundle may include, where useful and non-sensitive:

- AudioGubbins version/build identifier
- Browser and operating-system information
- Runtime capability matrix
- Relevant feature flags and degraded-capability state
- Sanitised stack traces
- Structured application logs
- Performance timings and resource statistics
- Processor/plugin/model version identifiers
- Project/schema version numbers without project content
- Reproduction metadata explicitly selected by the user

By default, diagnostic bundles must exclude:

- Raw or rendered audio
- Project files or project contents
- Source filenames where they may reveal sensitive information
- Full local filesystem paths
- Credentials, access tokens, API keys, cookies, or authentication data
- User-entered free-form content unless deliberately included
- Cloud-provider data
- Private Godot project contents

The diagnostic-bundle UI must show the user what will be included before submission or export.

A user may explicitly opt into a remembered diagnostic-sharing preference so that AudioGubbins does not repeatedly present the same consent dialogue for equivalent diagnostic submissions. This opt-in must be:

- Explicit
- Revocable
- Easy to inspect and change
- Narrowly scoped to diagnostic sharing
- Never interpreted as permission to send analytics, audio, project content, or unrelated data

Even with remembered consent, AudioGubbins must not silently expand the categories of information being transmitted. Materially new data categories require renewed explicit consent.

Where automatic submission is later supported after opt-in, the user must be able to disable it immediately and inspect locally retained submission history where practical.

---

## REQ-PRIV-162 — Usage Analytics Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 162 of the pre-hardening baseline

AudioGubbins shall not implement usage analytics.

This prohibition includes, unless a future specification explicitly reverses it:

- Behavioural analytics
- Feature-usage tracking
- Session analytics
- User profiling
- Engagement metrics
- Advertising identifiers
- Marketing telemetry
- Hidden product instrumentation
- Third-party analytics SDKs

Normal local diagnostic logging is not analytics and remains subject to the privacy and retention requirements defined elsewhere in this specification.

Build tooling and third-party dependencies must be reviewed to ensure that analytics or telemetry are not introduced transitively without deliberate approval.

---

## REQ-PRIV-164 — Language and Localisation Policy

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 164 of the pre-hardening baseline

AudioGubbins shall use British English for all first-party user-facing text, documentation, comments, examples, diagnostic descriptions, help content, and implementation terminology where natural-language spelling differs.

Examples include:

- colour rather than color in prose and user-facing labels
- normalise rather than normalize
- behaviour rather than behavior
- artefact rather than artifact in prose, except where an external API, package, protocol, schema key, or established technical identifier uses another spelling

Internationalisation and translated UI support are not current requirements.

The implementation must not add a localisation framework solely for hypothetical future translation support unless a later requirement introduces it.

However, domain logic should still avoid depending on presentation strings as identifiers. Stable typed identifiers, enums, commands, schema keys, and machine-readable values must remain independent from visible British-English labels.

External standards, browser APIs, third-party library APIs, file-format field names, CSS properties, and source-code identifiers required by their ecosystems must retain their canonical spellings.

---

## REQ-PRIV-165 — Structured Diagnostic Logging

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 165 of the pre-hardening baseline

AudioGubbins shall provide a configurable structured local logging system suitable for diagnosing complex audio, rendering, storage, browser-capability, PWA, Godot-integration, DSP, and recovery failures.

Supported severity levels should include at least:

- Error
- Warning
- Info
- Debug
- Trace

Logging should support:

- Subsystem/category filtering
- Correlation/operation identifiers
- Typed structured fields where practical
- Time stamps
- Bounded retention
- User-configurable verbosity
- Temporary diagnostic mode
- Export/download of logs
- Redaction/sanitisation before sharing
- Clear indication when diagnostic mode is active
- Performance-event logging without behavioural analytics

Diagnostic mode may collect richer execution metadata for a limited period but must not silently collect prohibited sensitive content.

Logs must not contain by default:

- Raw audio samples
- Encoded audio payloads
- Entire project documents
- Credentials or secrets
- Browser cookies
- Authentication tokens
- User passwords
- Full external file contents
- Sensitive cloud-provider data

Local file paths and filenames should be sanitised or redacted in shareable diagnostic bundles unless the user deliberately chooses to include them.

Log retention must be bounded and storage-aware. Users must be able to clear logs and inspect approximate log-storage usage.

---

## REQ-REPO-185 — Repository and Monorepo Structure

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 185 of the pre-hardening baseline

AudioGubbins shall use a single monorepo for the product codebase.

The monorepo should contain, as first-class components:

- The Vite/React/TypeScript PWA.
- Shared TypeScript contracts and schemas.
- Audio/domain/command packages.
- Rust/WASM DSP crates.
- Codec and media-processing packages/adapters.
- Rendering infrastructure.
- Storage/persistence infrastructure.
- Godot `@tool` editor addon.
- Godot runtime addon.
- Godot integration test project.
- GUT test suites for Godot-side behaviour.
- Cross-language/generated bindings where required.
- Test fixtures and deterministic reference assets.
- Documentation and architecture decision records.
- Build and developer tooling.

The repository structure must make dependency direction visible. It must not collapse unrelated concerns into one `src/` hierarchy merely for convenience.

Package boundaries should map to cohesive architectural responsibilities rather than framework conventions alone.

---

## REQ-REPO-186 — Package and Workspace Management

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 186 of the pre-hardening baseline

The TypeScript/JavaScript workspace shall use **pnpm workspaces**.

Rust components shall use Cargo workspaces/crates as appropriate.

The build architecture should support coordinated tasks across both ecosystems without hiding their native toolchains behind opaque wrapper scripts.

Requirements include:

- Strict declaration of package dependencies.
- No accidental reliance on undeclared transitive dependencies.
- Workspace-local package imports through documented public entry points.
- Lockfiles committed to source control.
- Reproducible dependency installation.
- CI validation that lockfiles and generated dependency metadata are current.
- Clear separation between application dependencies, development tooling, and test-only dependencies.

---

## REQ-REPO-187 — Product Versioning

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 187 of the pre-hardening baseline

AudioGubbins shall expose one primary product release version shared across the web application and first-party Godot integration packages.

A release should therefore be understandable to users as, for example:

`AudioGubbins 0.x.y`

rather than requiring users to reason about unrelated public versions for the PWA, editor addon, and runtime addon.

Independent internal compatibility/version identifiers are still required where technically necessary, including:

- Project schema version.
- Persistence schema version.
- Processor implementation version.
- DSP graph contract version.
- Godot generated-resource schema version.
- Runtime event schema/API version.
- Model-pack version.
- Cache-format version.

Internal compatibility identifiers must not be conflated with the product marketing/release version.

Pre-1.0 schema-breaking policy and post-1.0 migration policy remain as defined elsewhere in this specification.

---

## REQ-REPO-191 — Reference Assets, Fixtures, and Example Projects

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 191 of the pre-hardening baseline

The public repository shall contain a deliberately small, legally clean set of reference assets and examples sufficient for contributors, agents, and automated tests to exercise AudioGubbins without external setup.

This should include, as appropriate:

- Synthetic deterministic test signals.
- Small openly licensed audio clips.
- Mono and stereo examples.
- Representative multichannel examples.
- Loopable examples.
- Deliberately damaged/noisy reference samples for restoration tests.
- Known transient/click/DC-offset test signals.
- Small reference video clips for sound-to-picture tests where licensing permits.
- Example AudioGubbins projects.
- Example Godot integration project.
- Example event/variation resources.

Rules:

- Licensing/provenance must be documented for non-generated fixtures.
- Test fixtures must remain stable once they are used for golden/reference tests unless a deliberate reviewed change is required.
- Large corpora and heavyweight ML/audio datasets must not bloat normal Git history; they should be generated or fetched on demand with integrity/version metadata.
- Deterministic synthetic signals are preferred wherever they adequately test the required behaviour.

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

<!-- adr/ADR-0001-web-stack.md -->

# ADR-0001 — Web Application Stack

- **Status:** Accepted
- **Decision:** Use React 19.x + TypeScript + Vite 8.x for the web shell, Radix Primitives for accessible low-level controls, Dockview behind an AudioGubbins-owned workspace abstraction, and Motion for React for application-shell animation.
- **Drivers:** rich professional UI, accessibility, mature ecosystem, dockable workspaces, strong animation, static/PWA deployment.
- **Constraints:** React must not own high-frequency audio/render state or authoritative project state. Domain packages remain framework-agnostic.
- **Related requirements:** `REQ-ARCH-151`, `REQ-ARCH-153`, `REQ-UX-057`, `REQ-EDIT-073`.

<!-- adr/ADR-0008-monorepo.md -->

# ADR-0008 — Monorepo and Workspace Model

- **Status:** Accepted
- **Decision:** Keep the web app, TypeScript packages, Rust crates, Godot addons, fixtures, tests and specification in one coordinated monorepo using pnpm workspaces and Cargo workspaces.
- **Drivers:** shared schema/versioning, cross-component refactors, agent worktree coordination, unified release version.
- **Constraints:** package boundaries must reflect coherent ownership; no package proliferation for appearances; circular dependencies are prohibited.
- **Related requirements:** `REQ-REPO-154`, `REQ-REPO-185`, `REQ-REPO-186`, `REQ-REPO-187`.

# Passed Dependency Handoffs

<!-- traceability/handoffs/phase-00.md -->

# Phase Handoff Capsule — Phase 00

## Capability Delivered

The specification has been converted from an iterative monolithic requirements document into an agent-executable modular specification with stable requirement IDs, hardened phase packets, explicit dependencies, traceability, initial ADRs, static validation, and verified hardening evidence.

## Requirements Satisfied

All `CURRENT` Phase 00 `REQ-EXEC-*` requirements in the traceability register are satisfied by the specification pack. Explicit exclusions/deferred constraints remain active rather than “completed”.

## Public Contracts Introduced or Changed

- Requirement ID format and scope states.
- Phase Packet format.
- Implementation Ledger format.
- Requirement Traceability Register format.
- Review severity and finding-verification process.
- Specification context-loading and authority order.

## Invariants Downstream Agents Must Preserve

- Do not edit the generated compiled specification directly.
- Do not renumber existing requirement IDs.
- Do not begin a `NOT_READY` phase.
- Do not weaken scope or tests.
- Load the bounded Phase Context Pack, not the whole specification by default.
- Update traceability and ledger metadata as phases pass.

## Verification Baselines

- `reviews/verification-report.md`
- `reviews/hardening-review.md`
- `python tools/spec_lint.py`
- `python tools/build_spec.py --check`
- `python tools/verify_hardening.py`

## Downstream Readiness

Phase 01 — Application Foundation is `READY`.

# Current Ledger Entry

```json
{
  "phase": 1,
  "name": "Application Foundation",
  "status": "READY",
  "hard_dependencies": [
    0
  ],
  "phase_file": "phases/phase-01-application-foundation.md",
  "requirements": [
    "REQ-ARCH-004",
    "REQ-UX-005",
    "REQ-PROD-006",
    "REQ-PWA-031",
    "REQ-REPO-033",
    "REQ-ARCH-034",
    "REQ-PROD-056",
    "REQ-UX-057",
    "REQ-UX-058",
    "REQ-UX-059",
    "REQ-UX-060",
    "REQ-UX-066",
    "REQ-UX-067",
    "REQ-UX-068",
    "REQ-UX-069",
    "REQ-UX-070",
    "REQ-UX-071",
    "REQ-EDIT-072",
    "REQ-EDIT-073",
    "REQ-REPO-142",
    "REQ-ARCH-151",
    "REQ-ARCH-153",
    "REQ-REPO-154",
    "REQ-UX-155",
    "REQ-PRIV-161",
    "REQ-PRIV-162",
    "REQ-PRIV-164",
    "REQ-PRIV-165",
    "REQ-REPO-185",
    "REQ-REPO-186",
    "REQ-REPO-187",
    "REQ-REPO-191"
  ],
  "open_verified_findings": [],
  "commits": [],
  "evidence": [],
  "handoff": null
}
```
