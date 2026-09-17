# AudioGubbins Phase 00 Context Pack

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

# Phase 00 — Requirements and Architectural Baseline

## Status

`PASS` — completed by this hardening milestone; see `reviews/hardening-review.md` and `reviews/verification-report.md`.

## Objective

Freeze a coherent, agent-executable requirements and architecture baseline with stable requirement IDs, explicit phase ownership, an acyclic dependency graph, review gates, ADRs, traceability, and automated specification validation.

## User-Visible Outcome

No production feature is implemented. The repository/specification pack is safe to hand to a fresh implementation agent without requiring it to infer scope from the historical monolithic document.

## Hard Dependencies

- None.

## Owned Requirements

- `REQ-EXEC-002` — Implementation Philosophy (`CURRENT`)
- `REQ-EXEC-040` — Multi-Lens Review Model (`CURRENT`)
- `REQ-EXEC-041` — Gate Rule (`CURRENT`)
- `REQ-EXEC-044` — Standing Decision Rules (`CURRENT`)
- `REQ-EXEC-136` — AudioGubbins Agent Implementation Guardrails (`CURRENT`)
- `REQ-EXEC-137` — Specification Clarity Requirements for Agent Execution (`CURRENT`)
- `REQ-EXEC-167` — Agent Execution Contract (`CURRENT`)
- `REQ-EXEC-168` — Requirement Conflict and Deviation Protocol (`CURRENT`)
- `REQ-EXEC-169` — Architectural Autonomy and ADR Policy (`CURRENT`)
- `REQ-EXEC-170` — Independent Multi-Lens and Adversarial Review (`CURRENT`)
- `REQ-EXEC-171` — Review Finding Verification and Remediation (`CURRENT`)
- `REQ-EXEC-172` — Review Severity and Gate Semantics (`CURRENT`)
- `REQ-EXEC-173` — No Autonomous Scope Reduction (`CURRENT`)
- `REQ-EXEC-174` — TODO and Acceptance-Criteria Integrity (`CURRENT`)
- `REQ-EXEC-175` — Dependency Introduction Policy (`CURRENT`)
- `REQ-EXEC-176` — Cohesion and Complexity Guardrails (`CURRENT`)
- `REQ-EXEC-177` — Anti-God-Object and Module-Ownership Rules (`CURRENT`)
- `REQ-EXEC-178` — Design-Principle Anti-Cargo-Cult Rule (`CURRENT`)
- `REQ-EXEC-179` — Refactoring Expectations During Phase Work (`CURRENT`)
- `REQ-EXEC-180` — Test Integrity and Anti-Cheating Rules (`CURRENT`)
- `REQ-EXEC-181` — Placeholder, Stub, and Temporary-Code Gate Rule (`CURRENT`)
- `REQ-REPO-182` — Source-Control Execution Model (`CURRENT`)
- `REQ-EXEC-183` — Phase Evidence Package (`CURRENT`)
- `REQ-EXEC-184` — Architecture Enforcement Tests (`CURRENT`)
- `REQ-REPO-188` — Tiered Verification and CI Requirements (`CURRENT`)
- `REQ-REPO-192` — CI/Repository Setup Handoff Requirement (`CURRENT`)
- `REQ-EXEC-201` — Specification Execution Architecture (`CURRENT`)
- `REQ-EXEC-202` — Normative Requirement Identifiers (`CURRENT`)
- `REQ-EXEC-203` — Phase Packet Contract (`CURRENT`)
- `REQ-EXEC-204` — Phase Context Loading Protocol (`CURRENT`)
- `REQ-EXEC-205` — Requirement Traceability Matrix (`CURRENT`)
- `REQ-EXEC-206` — Phase Dependency Graph and Readiness Gate (`CURRENT`)
- `REQ-EXEC-207` — Phase Size and Internal Work Breakdown (`CURRENT`)
- `REQ-EXEC-208` — Parallel-Agent and Worktree Coordination (`CURRENT`)
- `REQ-EXEC-209` — Implementation Ledger (`CURRENT`)
- `REQ-EXEC-210` — Phase Handoff Capsule (`CURRENT`)
- `REQ-EXEC-211` — Decision Authority and Conflict Resolution (`CURRENT`)
- `REQ-EXEC-212` — Specification Change Control During Implementation (`CURRENT`)
- `REQ-EXEC-213` — Specification Static Validation (`CURRENT`)
- `REQ-EXEC-214` — Context-Overload Guardrail (`CURRENT`)
- `REQ-EXEC-215` — Requirements-to-Tests Rule (`CURRENT`)
- `REQ-EXEC-216` — No Hidden Implementation Assumptions (`CURRENT`)
- `REQ-EXEC-217` — Specification Hardening Milestone Before Production Implementation (`CURRENT`)
- `REQ-EXEC-218` — Adversarial Specification Review (`CURRENT`)
- `REQ-EXEC-219` — Compiled Specification Generation (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-PROD-158` — MIDI Scope Exclusion (`EXCLUDED`)
- `REQ-PRIV-163` — Collaboration Scope Exclusion (`EXCLUDED`)

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

- [x] Canonical modular requirement files with immutable IDs
- [x] Hardened Phase Packets for Phases 01–15
- [x] Global agent-execution and architecture contracts
- [x] Initial ADR set for decisions already made
- [x] Requirement traceability and implementation ledger
- [x] Specification linter and deterministic compiled-spec builder
- [x] Adversarial hardening review with verified remediation

## Explicitly Out of Scope

- Application production code
- User-facing AudioGubbins features
- GitHub repository administration

## Owned Modules / Packages

- `docs/spec/**` — canonical specification source
- `tools/spec_lint.py` — static specification validation
- `tools/build_spec.py` — deterministic compiled-spec generation

## Cross-Package Dependency Rules

- Canonical requirements must not depend on generated artefacts.
- Generated documents/context packs depend one-way on canonical modules and traceability data.

## Required Public Contracts

- Stable `REQ-*` identifier scheme
- Phase Packet schema
- Implementation Ledger schema
- Review finding/severity schema

## Data / Schema Changes

- No production project/application schema is created. Specification metadata schemas introduced: requirement register, implementation ledger, dependency graph.

## Browser / Platform Considerations

- Platform feasibility is reviewed at requirement level; no runtime code is produced.

## Architectural Invariants

- There are no unresolved BLOCKER/CRITICAL/HIGH specification findings.
- Every non-superseded requirement has one owner phase.
- Every Phase Packet is complete and contains no execution placeholders.
- The dependency graph is acyclic.

## Internal Work Units

### WU-00.A — Normalise requirements

- [x] Remove stale/superseded process-history sections from canonical sources
- [x] Assign stable requirement IDs and scope states
- [x] Resolve known contradictory wording, including N-channel support and selected front-end stack

### WU-00.B — Harden execution

- [x] Complete every Phase Packet
- [x] Define global authority/context-loading rules
- [x] Create traceability and ledger artefacts

### WU-00.C — Verify specification

- [x] Run structural/specification lint
- [x] Run deterministic build check
- [x] Perform adversarial multi-lens hardening review
- [x] Fix every verified blocking/high finding and re-run validation

## Failure and Recovery Behaviour

- If a contradiction cannot be resolved from recorded user decisions, record it as BLOCKED rather than guessing.
- Generated artefacts must never overwrite canonical modules in a way that loses source data.

## Required Verification Commands / Suites

- `python tools/spec_lint.py`
- `python tools/build_spec.py --check`
- `python tools/verify_hardening.py`

## Acceptance Criteria

- [x] Specification lint reports zero errors.
- [x] Compiled specification is byte-for-byte reproducible from canonical modules.
- [x] Every canonical requirement appears exactly once in the requirement register.
- [x] Every current/planned requirement has a valid owner phase.
- [x] Phase dependency graph has no cycles.
- [x] Phase 01 is eligible for READY and all later phases have explicit blockers/dependencies.
- [x] Hardening review has no unresolved BLOCKER/CRITICAL/HIGH finding.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- Do not declare hardening complete while phase files are shells.
- Do not keep the legacy 5,600-line document as an independently editable authority.
- Do not hide contradictory requirements by duplicating both versions.

## Required Review Lenses

- Architecture
- Agent Execution / Context Safety
- Requirement Traceability
- Testing / Verifiability
- Adversarial Specification Review

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Phase 00 established the canonical modular requirement system, Phase Packets, dependency DAG, initial ADRs, traceability register, implementation ledger, linter, compiled-spec builder, and adversarial hardening evidence.

Downstream agents must preserve stable requirement IDs and must not edit the generated compiled specification directly.

**Newly ready phase:** Phase 01 — Application Foundation.

# Referenced Requirement Blocks

## REQ-EXEC-002 — Implementation Philosophy

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 2 of the pre-hardening baseline

The specification is intended for implementation by an advanced agentic AI system.

Implementation must proceed:

1. One complete phase at a time.
2. With explicit TODO items per phase.
3. With defined prerequisites and invariants.
4. With required tests and acceptance criteria.
5. With mandatory multi-lens review gates before proceeding.
6. With all blocking reviewer findings resolved before the next phase begins.

No later phase may begin until the current phase has passed its review gate.

---

## REQ-EXEC-040 — Multi-Lens Review Model

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 40 of the pre-hardening baseline

Every implementation phase must conclude with mandatory independent review lenses.

Required lenses should include, at minimum:

#### Architecture Lens

Review:

- Modularity
- Coupling
- Extensibility
- Domain boundaries
- Future multitrack compatibility
- Future plugin compatibility

#### Audio / DSP Correctness Lens

Review:

- Numerical correctness
- Signal integrity
- Clipping
- Precision
- Sample alignment
- Processing order
- Channel handling
- Loop correctness

#### Performance Lens

Review:

- UI thread blocking
- Memory behaviour
- Large-file handling
- Worker usage
- Rendering performance
- Cache efficiency
- Audio latency

#### Security / Privacy Lens

Review:

- Local-first guarantees
- File permissions
- Data leakage
- Browser storage handling
- CSP
- Third-party dependencies
- Unsafe code execution

#### PWA / Browser Compatibility Lens

Review:

- PWA behaviour
- Browser API differences
- Offline behaviour
- Capability detection
- Update safety
- Mobile/touch support

#### UX / Accessibility Lens

Review:

- Discoverability
- Keyboard support
- Touch support
- Screen-reader semantics
- Contrast
- Focus handling
- Responsive behaviour
- Progressive disclosure

#### Code Quality / Maintainability Lens

Review:

- Type safety
- Testability
- Separation of concerns
- Naming
- Documentation
- Duplication
- Architectural consistency

#### Testing / Regression Lens

Review:

- Unit coverage
- Integration coverage
- E2E coverage
- Audio regression tests
- Browser coverage
- Failure-path tests
- Recovery tests

---

## REQ-EXEC-041 — Gate Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 41 of the pre-hardening baseline

A phase may not advance until:

- All required TODO items are complete.
- All mandatory tests pass.
- Acceptance criteria are satisfied.
- Required reviewers have completed their review.
- All blocking findings are resolved.
- High-severity defects are resolved.
- Any accepted non-blocking findings are documented.

The implementation agent must not silently defer required work to a later phase.

---

## REQ-EXEC-044 — Standing Decision Rules

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 44 of the pre-hardening baseline

The specification process shall follow these decision rules:

1. Do not optimise for implementation ease or speed.
2. Prefer long-term power, flexibility, robustness, quality, and maintainability.
3. Automatically adopt straightforward improvements where the answer is effectively an unambiguous “yes”.
4. Ask for user input only when there is a genuine trade-off.
5. Genuine trade-offs include:
   - UX complexity
   - Performance
   - Browser compatibility
   - Security
   - Portability
   - Licensing
   - Data integrity
   - Architectural coupling
   - Significant scope expansion
6. Do not artificially restrict capability merely to simplify implementation.
7. Maintain future multitrack, plugin, and cloud extensibility unless doing so introduces a concrete disadvantage.

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

## REQ-EXEC-137 — Specification Clarity Requirements for Agent Execution

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 137 of the pre-hardening baseline

Before implementation phases are considered ready for execution, the specification itself must be hardened so an implementation agent does not need to infer critical architecture.

Each implementation phase must ultimately include:

- Objective.
- Explicit in-scope work.
- Explicit out-of-scope work.
- Prerequisites.
- Required domain concepts.
- Required public interfaces/contracts.
- Expected package/module ownership.
- Data-flow description.
- Persistence implications.
- Browser capability implications.
- Performance constraints.
- Security/privacy constraints.
- Accessibility implications.
- Failure modes.
- TODO checklist.
- Required unit tests.
- Required integration tests.
- Required end-to-end tests where relevant.
- Required audio golden/regression tests where relevant.
- Acceptance criteria.
- Reviewer lenses.
- Gate conditions.
- Deferred work explicitly linked to future phases.

Ambiguous phrases such as "implement robustly", "support as needed", "use best practices", or "handle edge cases" are insufficient when concrete behaviour can be specified.

The specification should state the invariant, observable behaviour, or review criterion instead.

Implementation agents must not invent product behaviour silently when the specification contains a genuine unresolved decision.

Where the standing decision rules make the answer unambiguous, the agent should apply those rules rather than stopping for unnecessary approval.

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

## REQ-EXEC-168 — Requirement Conflict and Deviation Protocol

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 168 of the pre-hardening baseline

If the implementation agent concludes that a requirement is technically impossible, internally contradictory, unsafe, legally problematic, or materially flawed, it must not silently substitute its own interpretation.

The agent must instead create a requirement-conflict record containing:

- The exact requirement or requirements in conflict.
- The observed technical or architectural constraint.
- Reproduction steps or evidence where applicable.
- Relevant browser/platform/library/tool limitations.
- The impact on dependent requirements and later phases.
- Viable alternatives.
- The agent's recommended resolution and rationale.
- Whether a reversible capability-detected fallback is already permitted by this specification.

A fallback may be implemented autonomously only when it is explicitly compatible with the specification's existing capability/fallback strategy and does not alter product semantics beyond those allowed boundaries.

Otherwise, the phase must remain blocked rather than quietly changing the product contract.

No requirement may be reclassified as optional or future work solely by the implementation agent.

---

## REQ-EXEC-169 — Architectural Autonomy and ADR Policy

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 169 of the pre-hardening baseline

Within an approved phase, the implementation agent may make architectural and implementation decisions that are not explicitly prescribed by this specification, provided that those decisions:

- Satisfy all current requirements.
- Preserve future requirements already described by this specification.
- Follow defined dependency direction and module ownership.
- Do not introduce hidden product constraints.
- Do not trade long-term flexibility or robustness for short-term simplicity.
- Are testable and reviewable.
- Avoid unnecessary coupling to replaceable third-party libraries.

Significant decisions must be documented as Architecture Decision Records (ADRs).

An ADR is required when a decision materially affects one or more of:

- Domain model
- Persistence format
- Processing graph
- DSP implementation
- Runtime determinism
- Worker/WASM boundaries
- Rendering architecture
- Public/internal APIs
- Package/module ownership
- Cross-package dependency direction
- PWA/runtime capability strategy
- Godot integration contracts
- Security/privacy boundaries
- Third-party dependency lock-in
- Performance characteristics
- Long-term extensibility

ADRs should record context, considered options, decision, consequences, and future reversal/migration considerations.

Reviewer approval of a phase includes review of all ADRs introduced or materially modified during that phase.

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

## REQ-EXEC-175 — Dependency Introduction Policy

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 175 of the pre-hardening baseline

Every substantive runtime, build-time, DSP, rendering, storage, UI, testing, or tooling dependency must be evaluated before adoption.

The evaluation must consider:

- Functional necessity
- Quality and maturity
- Licence compatibility
- Patent considerations where relevant
- Active maintenance
- Release cadence
- Security history
- Browser/platform support
- Bundle/download impact
- WASM/model size impact where relevant
- Performance characteristics
- Tree-shaking/modularity
- API stability
- Lock-in risk
- Ability to wrap behind an AudioGubbins-owned abstraction
- Availability of robust tests
- Replacement/migration cost

Dependencies must not be introduced merely to avoid implementing a small amount of cohesive project-owned code.

Conversely, the agent must not reimplement complex, mature, well-tested technology solely to reduce dependency count when doing so would materially reduce quality, correctness, capability, or maintainability.

All dependencies should be isolated behind project-owned boundaries when coupling directly to the dependency would leak implementation details into the domain architecture.

---

## REQ-EXEC-176 — Cohesion and Complexity Guardrails

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 176 of the pre-hardening baseline

AudioGubbins must not use arbitrary hard line-count limits as a substitute for architecture review.

Instead, the repository shall use soft complexity thresholds and mandatory scrutiny for suspicious growth.

Review attention is required when a unit becomes unusually large or complex, including:

- Source files with many unrelated responsibilities
- Functions with extensive branching or deeply nested control flow
- Classes/services/managers coordinating multiple unrelated domains
- Stores containing unrelated state and business logic
- React components containing domain orchestration, persistence, DSP, and rendering logic
- Modules that become universal dependency hubs
- Utility files that become dumping grounds
- Interfaces that continuously grow unrelated methods

A reviewer should ask whether the unit has one cohesive reason to change, whether its dependencies point in the correct direction, and whether responsibilities can be named precisely.

Splitting code only to satisfy a line-count metric is prohibited when it merely creates fragmented files with the same hidden coupling.

The preferred result is cohesive small modules with explicit ownership and typed contracts, not arbitrary file fragmentation.

---

## REQ-EXEC-177 — Anti-God-Object and Module-Ownership Rules

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 177 of the pre-hardening baseline

God objects, god services, god stores, and monolithic managers are prohibited.

No central object may become the informal owner of unrelated application concerns simply because it is convenient to access globally.

Major subsystems must have explicit ownership boundaries, including at minimum:

- Project/domain model
- Command system
- Persistence
- Undo/history journal
- Audio graph
- DSP processors
- Real-time engine
- Offline renderer
- Recording
- Codec/import/export
- Waveform/spectral analysis
- GPU/editor rendering
- Workspace/UI state
- PWA lifecycle
- Capability detection
- Diagnostics
- Godot authoring integration
- Godot runtime integration

Cross-subsystem interaction must occur through typed contracts/events/commands appropriate to the architecture rather than shared mutable implementation state.

The architecture reviewer must specifically search for newly emerging god objects during every phase.

---

## REQ-EXEC-178 — Design-Principle Anti-Cargo-Cult Rule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 178 of the pre-hardening baseline

Engineering principles such as DRY, YAGNI, KISS, SOLID, design patterns, and abstraction heuristics are tools, not overriding goals.

The implementation agent must not cite a principle as a slogan to justify architecture without analysing consequences.

Examples:

- **DRY** must not create an over-generalised abstraction that couples unrelated domain concepts merely because code looks similar.
- **YAGNI** must not be used to ignore future capabilities that this specification explicitly requires the architecture to support.
- **KISS** must not be used to select a weaker architecture whose simplicity exists only because required failure modes or extensibility have been omitted.
- **SOLID** must not produce excessive indirection, interface proliferation, or trivial wrapper classes without meaningful ownership boundaries.
- A named design pattern must not be introduced merely because it is familiar; the concrete forces and trade-offs must justify it.

Prefer domain-specific clarity, cohesive ownership, explicit dependency direction, and evidence-based design.

---

## REQ-EXEC-179 — Refactoring Expectations During Phase Work

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 179 of the pre-hardening baseline

Refactoring is part of implementation, not a separate optional clean-up activity.

When work within the active phase reveals:

- A wrong abstraction
- Duplicate domain logic
- Hidden coupling
- Poor dependency direction
- An emerging god object
- An ownership violation
- Unsafe state management
- Unmaintainable complexity

then the agent is expected to refactor the affected touched architecture before completing the phase.

However, broad unrelated rewrites are prohibited unless they are necessary to satisfy a requirement or remove a blocking defect.

Refactors must preserve behaviour through tests and must remain reviewable as part of the active phase.

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

## REQ-REPO-182 — Source-Control Execution Model

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 182 of the pre-hardening baseline

The implementation agent has full repository filesystem access and Git access and is responsible for maintaining a reviewable source-control history while executing this specification.

Repository hosting, branch-protection configuration, GitHub Actions administration, and other GitHub-repository setup are intentionally outside the scope of this implementation specification and will be managed separately by the project owner.

#### 182.1 Worktree-First Concurrent Agent Model

When multiple implementation or review agents operate concurrently, they shall use isolated Git worktrees rather than sharing one mutable working directory.

The worktree model must provide:

- One isolated worktree per concurrent implementation/review stream.
- Explicit ownership of the files/subsystems currently being modified.
- No two agents editing the same files concurrently without deliberate coordination.
- Clean commits produced within the owning worktree.
- Review/remediation work performed against a known commit/state.
- Removal of stale worktrees after their work is integrated.

Agents must not use worktrees as an excuse to fragment architecture ownership or duplicate implementation across branches.

#### 182.2 Direct Integration into `main`

The project intentionally uses rapid direct integration rather than pull-request-driven workflow.

Agents shall not raise pull requests unless the project owner explicitly changes this policy.

After a worktree's implementation has:

- completed its phase/sub-phase contract,
- passed required automated verification,
- passed independent multi-lens/adversarial review,
- remediated verified blocking findings,
- and produced a clean evidence package,

its commits may be merged directly into `main`.

`main` must remain the authoritative integration branch.

The absence of pull requests does not weaken review requirements. Review occurs before direct integration and must be evidence-based.

#### 182.3 Commit Discipline

Git workflow must favour meaningful atomic commits.

Commits should:

- Represent one coherent implementation/refactor/test/documentation unit.
- Leave the repository in a buildable/testable state whenever practical.
- Use clear messages describing intent rather than implementation trivia.
- Keep mechanical/generated changes separate from semantic code changes when this materially improves reviewability.
- Avoid mixing unrelated cleanup with feature work.
- Include tests with the behaviour they validate when practical.
- Avoid drive-by formatting/reordering that obscures the semantic diff.

The agent must not use history rewriting, squashing, or rebasing in a way that obscures important implementation/review evidence unless repository policy explicitly permits it.

For each phase, the agent should maintain a traceable mapping between:

- Phase TODOs
- Relevant commits
- Tests
- ADRs
- Reviewer findings
- Finding-verification evidence
- Remediation commits
- Final gate result

No phase should be integrated/declared complete while its mandatory gate is failing.

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

## REQ-REPO-188 — Tiered Verification and CI Requirements

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 188 of the pre-hardening baseline

AudioGubbins shall define verification tiers suitable for later implementation in the project's CI environment.

Repository-hosting/CI-provider administration is outside this document's scope, but the codebase must contain the scripts/configuration/contracts required to execute these tiers.

#### 188.1 Fast Commit Tier

Expected on normal implementation checkpoints:

- Formatting validation.
- Static analysis/linting.
- Type checking.
- Architecture/dependency-rule validation.
- Fast unit tests.
- Rust checks/tests appropriate to changed crates.
- Schema/contract validation.
- Generated-file freshness checks.

#### 188.2 Integration Tier

Expected before direct integration into `main` when relevant:

- Browser integration tests.
- Persistence/storage integration tests.
- PWA/service-worker tests.
- Worker/AudioWorklet integration tests.
- DSP reference tests.
- Import/export tests.
- Godot GUT tests.
- Headless Godot runtime/integration tests.
- Accessibility checks.
- Visual/UI regression checks where applicable.

#### 188.3 Phase-Gate / Heavyweight Tier

Expected at phase gates and major release checkpoints as applicable:

- Full supported-browser matrix.
- Desktop/touch/tablet interaction coverage.
- Offline/PWA lifecycle coverage.
- Storage corruption/interruption/recovery scenarios.
- Large-file/resource-pressure tests.
- Deterministic render/golden tests.
- Cross-browser render verification.
- Performance/benchmark suites.
- Memory/regression profiling.
- Godot editor-addon/runtime integration scenarios.
- End-to-end export-to-Godot scenarios.
- Accessibility/manual-interaction evidence required by the phase.

A required verification failure blocks the corresponding integration/gate unless the specification explicitly permits that failure mode.

---

## REQ-REPO-192 — CI/Repository Setup Handoff Requirement

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 192 of the pre-hardening baseline

Although GitHub repository setup is intentionally managed separately, AudioGubbins implementation work must leave behind an explicit machine-readable and human-readable description of required verification commands and CI tiers so that repository automation can be configured without reverse-engineering the codebase.

The implementation shall therefore provide, at minimum:

- Canonical root-level commands for each verification tier.
- Documented environment/toolchain prerequisites.
- Deterministic test entry points.
- Headless Godot/GUT invocation commands.
- Browser-matrix test entry points.
- Benchmark entry points.
- Required artefact/report outputs.
- Clear failure exit codes.
- No interactive prompts in CI-targeted commands.

CI scripts/configuration must call the same underlying commands developers/agents can run locally rather than maintaining a separate hidden validation path.

---

## REQ-EXEC-201 — Specification Execution Architecture

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 201 of the pre-hardening baseline

The implementation specification itself shall be treated as an engineered execution system rather than a prose document that an agent is expected to hold entirely in working memory.

The canonical specification shall support two representations:

1. **Modular canonical source** — logically separated specification modules and phase packets used by implementation agents.
2. **Compiled full specification** — a generated single Markdown document containing the complete current specification for human review, archival, and download.

The compiled full specification remains authoritative only to the extent that it is generated from the current canonical modules. During the pre-repository requirements process, this single document may act as the canonical source, but the repository implementation phase shall split it into modular source files before substantial production work begins.

The specification architecture must minimise:

- Context-window overload.
- Requirement loss.
- Repeated interpretation.
- Contradictory local decisions.
- Phase drift.
- Reviewer ambiguity.
- Hidden cross-cutting requirements.

---

## REQ-EXEC-202 — Normative Requirement Identifiers

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 202 of the pre-hardening baseline

Before autonomous implementation begins, every normative requirement that can affect implementation or acceptance shall receive a stable identifier.

Recommended identifier families include:

- `REQ-PROD-*` — product behaviour.
- `REQ-UX-*` — UX/accessibility/interaction.
- `REQ-AUDIO-*` — audio/DSP behaviour.
- `REQ-DATA-*` — project/storage/history.
- `REQ-PWA-*` — browser/PWA/platform behaviour.
- `REQ-GODOT-*` — Godot integration/runtime.
- `REQ-SEC-*` — security/privacy.
- `REQ-PERF-*` — performance/responsiveness.
- `REQ-ARCH-*` — architecture/invariants.
- `REQ-TEST-*` — verification requirements.
- `REQ-AGENT-*` — agent-execution requirements.

Identifiers must be stable once implementation begins. Renumbering/reordering Markdown headings must not change requirement identity.

Normative terms shall be used deliberately:

- **MUST / SHALL** — mandatory gate requirement.
- **MUST NOT / SHALL NOT** — prohibited behaviour.
- **SHOULD** — expected unless a documented and reviewed reason justifies deviation.
- **MAY** — explicitly optional capability.

Casual prose must not silently override a normative requirement.

---

## REQ-EXEC-203 — Phase Packet Contract

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 203 of the pre-hardening baseline

No implementation phase may remain merely a title such as `Implement the audio engine`.

Before a phase becomes executable it must be converted into a self-contained **Phase Packet** containing, at minimum:

- Phase identifier and name.
- Objective.
- User-visible outcome.
- Explicit in-scope requirements by stable requirement ID.
- Explicit out-of-scope items.
- Prerequisite phases and capabilities.
- Required architectural contracts/interfaces.
- Owned packages/modules/directories.
- Cross-package dependency rules.
- Domain invariants that must remain true.
- Detailed TODO checklist.
- Expected deliverables.
- Data/schema changes.
- Browser/platform considerations.
- Failure/recovery behaviour.
- Required unit tests.
- Required integration tests.
- Required E2E/browser tests where applicable.
- Required audio golden/reference tests where applicable.
- Performance/responsiveness checks where applicable.
- Accessibility checks where applicable.
- Security/privacy checks where applicable.
- Acceptance criteria.
- Explicit forbidden shortcuts.
- Required reviewer lenses.
- Phase evidence-package contents.
- Handoff information for dependent phases.

A Phase Packet must contain enough information for a fresh implementation agent to execute it without inventing product scope.

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

## REQ-EXEC-205 — Requirement Traceability Matrix

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 205 of the pre-hardening baseline

Before implementation begins, AudioGubbins shall maintain a traceability matrix mapping each normative requirement to implementation and verification ownership.

At minimum, each requirement must track:

- Requirement ID.
- Requirement summary.
- Owning phase.
- Implementing package/module where known.
- Verification/test identifiers.
- Review lenses responsible for validating it.
- Current status.
- Evidence reference after completion.

No mandatory requirement may remain permanently unassigned to a phase.

No phase may claim completion while mandatory requirements assigned to that phase lack verification/evidence.

The traceability matrix should be machine-readable as well as human-readable.

---

## REQ-EXEC-206 — Phase Dependency Graph and Readiness Gate

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 206 of the pre-hardening baseline

Implementation order shall be controlled by an explicit dependency graph rather than by Markdown section order.

Every phase shall declare hard dependencies and optional/enhancement dependencies.

A phase is **READY** only when:

- All hard prerequisite phases passed their gates.
- Required contracts/interfaces exist at the expected versions.
- Required fixtures/toolchains are available.
- No unresolved blocker invalidates the phase assumptions.
- Its Phase Packet is complete.
- Its normative requirements are assigned and internally consistent.

Agents must not begin downstream implementation merely because useful-looking work is available.

---

## REQ-EXEC-207 — Phase Size and Internal Work Breakdown

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 207 of the pre-hardening baseline

A phase must be large enough to produce a coherent independently reviewable capability, but not so broad that one agent context must implement unrelated subsystems simultaneously.

If a Phase Packet is too large for reliable execution, it may be decomposed into internal work units or sub-phases provided that:

- The original phase scope is not reduced.
- The parent phase gate remains closed until every mandatory unit is complete.
- Shared contracts are established deliberately before parallel work.
- Subdivision does not become an excuse to defer difficult requirements.
- Each unit has explicit ownership and acceptance evidence.

Sub-phase decomposition is an execution technique, not scope reduction.

---

## REQ-EXEC-208 — Parallel-Agent and Worktree Coordination

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 208 of the pre-hardening baseline

When multiple agents work concurrently using Git worktrees, parallelisation must follow module/contract ownership rather than allowing arbitrary overlapping edits.

Before concurrent implementation:

- Shared interfaces/contracts must be agreed and committed first where practical.
- Each work unit must declare owned files/packages.
- Overlapping ownership must be minimised.
- Agents must not independently invent incompatible versions of the same contract.
- Cross-worktree integration points require explicit tests.
- Merge order must respect dependency direction.
- Integration conflicts must be resolved semantically, not by mechanically choosing one side.

A coordinator agent may manage work allocation, but it must not waive phase gates or reviewer independence.

---

## REQ-EXEC-209 — Implementation Ledger

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 209 of the pre-hardening baseline

The repository shall maintain a machine-readable **Implementation Ledger** that records execution state without requiring an agent to infer progress from Git history or prose.

Each phase/work unit entry should include:

- Status: `NOT_READY`, `READY`, `IN_PROGRESS`, `REVIEW`, `REMEDIATION`, `PASS`, or `BLOCKED`.
- Requirement IDs covered.
- Owning worktree/agent where applicable.
- Commits produced.
- Tests/evidence produced.
- Open verified findings.
- Blocking dependencies.
- ADRs created/changed.
- Handoff summary.

The ledger is execution metadata and must not replace normative requirements in the specification.

---

## REQ-EXEC-210 — Phase Handoff Capsule

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 210 of the pre-hardening baseline

Every passed phase shall produce a concise Handoff Capsule for future agents.

It must describe:

- What capability now exists.
- Public contracts/interfaces introduced.
- Key architectural decisions.
- Invariants downstream code must preserve.
- Persisted/schema formats introduced.
- Known intentionally deferred items explicitly authorised by the specification.
- Relevant benchmarks/baselines.
- Relevant fixtures/test utilities.
- Exact requirement IDs satisfied.

The capsule must not contain speculative future design decisions that are absent from the specification.

---

## REQ-EXEC-211 — Decision Authority and Conflict Resolution

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 211 of the pre-hardening baseline

When sources disagree, implementation agents shall resolve authority in this order unless an explicit superseding decision says otherwise:

1. Latest approved normative requirement/change record.
2. Global Agent Execution Contract and architectural invariants.
3. Current approved Phase Packet.
4. Approved ADRs.
5. Public contracts from passed prerequisite phases.
6. Non-normative explanatory prose/examples.
7. Existing implementation behaviour.

Existing code does not overrule the specification merely because it already exists.

Any genuine unresolved contradiction must use the Requirement Conflict and Deviation Protocol rather than being guessed away.

---

## REQ-EXEC-212 — Specification Change Control During Implementation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 212 of the pre-hardening baseline

Once autonomous implementation begins, substantive specification changes must be recorded explicitly rather than silently editing old text and expecting agents to notice.

Each material change shall identify:

- Change identifier.
- Affected requirement IDs.
- Rationale.
- Affected phases.
- Whether already-passed phases require remediation.
- Schema/API/project compatibility impact.
- Required test changes.

The implementation ledger and traceability matrix must be updated accordingly.

Pre-1.0 product schemas may still break according to the established policy; specification traceability must nevertheless remain explicit.

---

## REQ-EXEC-213 — Specification Static Validation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 213 of the pre-hardening baseline

The modular specification should have automated validation analogous to code linting.

Validation should detect, where practical:

- Duplicate requirement IDs.
- Broken requirement references.
- Mandatory requirements with no owning phase.
- Phase dependency cycles.
- References to missing ADRs/contracts.
- Duplicate/conflicting ownership declarations.
- Phase packets missing mandatory sections.
- Passed phases with unresolved blocking findings.
- TODOs lacking acceptance criteria/tests where required.
- Stale traceability entries.

Specification validation must run before a Phase Packet is declared READY.

---

## REQ-EXEC-214 — Context-Overload Guardrail

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 214 of the pre-hardening baseline

No implementation or review instruction may rely on an agent retaining the complete AudioGubbins specification in conversational memory.

Agents must retrieve/read authoritative source material when needed.

Reviewers shall evaluate the implementation against explicit requirement IDs and phase evidence rather than a vague instruction to `review against the full spec`.

If a phase requires so many unrelated requirement sections that its Phase Context Pack becomes unwieldy, this is evidence that the phase boundaries or requirement organisation should be refactored before implementation continues.

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

## REQ-EXEC-217 — Specification Hardening Milestone Before Production Implementation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 217 of the pre-hardening baseline

Before the autonomous implementation agent begins production work, the requirements document must undergo a dedicated hardening milestone.

That milestone shall:

1. Remove obsolete/redundant prose without losing normative behaviour.
2. Assign stable requirement IDs.
3. Organise requirements into modular canonical files.
4. Define the dependency graph.
5. Convert every planned implementation phase into a complete Phase Packet.
6. Build the requirement traceability matrix.
7. Create the initial implementation ledger.
8. Identify cross-cutting invariants and package ownership.
9. Resolve contradictory requirements.
10. Define the initial ADR set for architecture choices already made.
11. Define exact verification commands and evidence formats.
12. Run adversarial specification reviews before code implementation begins.

The hardening milestone is itself gated. Production implementation must not begin merely because the requirements prose is extensive.

---

## REQ-EXEC-218 — Adversarial Specification Review

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 218 of the pre-hardening baseline

Before implementation, independent reviewers shall review the specification itself through multiple lenses, including:

- Missing-requirements lens.
- Contradiction/ambiguity lens.
- Agent-confusion lens.
- Architecture/dependency lens.
- Browser/PWA feasibility lens.
- Audio/DSP correctness lens.
- Data-loss/recovery lens.
- Security/privacy lens.
- Godot integration lens.
- UX/accessibility lens.
- Performance/scalability lens.
- Testing/verifiability lens.
- Scope/phase-boundary lens.

Findings must be verified before changing the specification. Genuine findings must be corrected or explicitly resolved before production implementation.

---

## REQ-EXEC-219 — Compiled Specification Generation

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 219 of the pre-hardening baseline

The repository should provide a deterministic command that compiles the modular specification into a single complete Markdown document named similarly to:

`AudioGubbins_Implementation_Specification.md`

The generated file shall:

- Preserve stable requirement identifiers.
- Include a generated table of contents/index.
- Include phase summaries and traceability references.
- Be reproducible from repository state.
- Contain generation metadata/version/commit identifier where appropriate.
- Be suitable for human download and archival.

The generated file must not become a separately edited divergent copy of the modular source.

---

## REQ-PROD-158 — MIDI Scope Exclusion

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `EXCLUDED`
- **Legacy source:** section 158 of the pre-hardening baseline

> **Execution rule:** This is an explicit exclusion. Do not implement the excluded capability unless a future approved specification change supersedes this requirement.

MIDI input, MIDI sequencing, MIDI controllers, and MIDI control-surface integration are not current AudioGubbins requirements.

The implementation must not add MIDI infrastructure speculatively.

Generic command, automation, parameter, and input-abstraction systems should remain clean enough that MIDI could be considered in a future specification if requirements change, but no present phase should include MIDI work merely for hypothetical extensibility.

---

## REQ-PRIV-163 — Collaboration Scope Exclusion

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `EXCLUDED`
- **Legacy source:** section 163 of the pre-hardening baseline

> **Execution rule:** This is an explicit exclusion. Do not implement the excluded capability unless a future approved specification change supersedes this requirement.

Real-time or asynchronous multi-user collaborative project editing is not a current AudioGubbins requirement.

The implementation must not introduce CRDTs, operational transforms, collaborative presence, shared cursors, remote locking protocols, collaboration servers, or similar infrastructure speculatively.

Team workflows may instead use normal project files, portable/unpacked project representations, Git, shared repositories, external storage, and future cloud-provider integrations.

The single-writer local-project ownership model remains authoritative for concurrent AudioGubbins instances unless a future collaboration specification deliberately replaces it.

---

# Current Ledger Entry

```json
{
  "phase": 0,
  "name": "Requirements and Architectural Baseline",
  "status": "PASS",
  "hard_dependencies": [],
  "phase_file": "phases/phase-00-requirements-and-architectural-baseline.md",
  "requirements": [
    "REQ-EXEC-002",
    "REQ-EXEC-040",
    "REQ-EXEC-041",
    "REQ-EXEC-044",
    "REQ-EXEC-136",
    "REQ-EXEC-137",
    "REQ-PROD-158",
    "REQ-PRIV-163",
    "REQ-EXEC-167",
    "REQ-EXEC-168",
    "REQ-EXEC-169",
    "REQ-EXEC-170",
    "REQ-EXEC-171",
    "REQ-EXEC-172",
    "REQ-EXEC-173",
    "REQ-EXEC-174",
    "REQ-EXEC-175",
    "REQ-EXEC-176",
    "REQ-EXEC-177",
    "REQ-EXEC-178",
    "REQ-EXEC-179",
    "REQ-EXEC-180",
    "REQ-EXEC-181",
    "REQ-REPO-182",
    "REQ-EXEC-183",
    "REQ-EXEC-184",
    "REQ-REPO-188",
    "REQ-REPO-192",
    "REQ-EXEC-201",
    "REQ-EXEC-202",
    "REQ-EXEC-203",
    "REQ-EXEC-204",
    "REQ-EXEC-205",
    "REQ-EXEC-206",
    "REQ-EXEC-207",
    "REQ-EXEC-208",
    "REQ-EXEC-209",
    "REQ-EXEC-210",
    "REQ-EXEC-211",
    "REQ-EXEC-212",
    "REQ-EXEC-213",
    "REQ-EXEC-214",
    "REQ-EXEC-215",
    "REQ-EXEC-216",
    "REQ-EXEC-217",
    "REQ-EXEC-218",
    "REQ-EXEC-219"
  ],
  "open_verified_findings": [],
  "commits": [],
  "evidence": [
    "reviews/hardening-review.md",
    "reviews/verification-report.md"
  ],
  "handoff": "traceability/handoffs/phase-00.md"
}
```
