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
