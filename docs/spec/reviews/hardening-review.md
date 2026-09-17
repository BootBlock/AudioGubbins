# Adversarial Specification Hardening Review

## Result

**PASS**

Unresolved BLOCKER/CRITICAL/HIGH: **0**

The review treated findings as hypotheses, verified each against the recorded AudioGubbins decisions and the pre-hardening baseline, and changed the specification only where the finding was genuine.

## Review Lenses Applied

- Agent-context overload and instruction ambiguity
- Requirement traceability
- Contradiction and stale-decision detection
- Architecture/dependency boundaries
- Phase sizing/readiness
- Audio/DSP and channel-model consistency
- PWA/browser capability feasibility
- Project data-loss/recovery
- Godot editor/runtime integration
- Privacy/diagnostics
- Testing/verifiability
- Repository/agent concurrency
- Release/version compatibility semantics

## Verified Findings and Remediation

### AG-SPEC-001 — Phase Packets were non-executable shells
- **Severity:** BLOCKER
- **Verification:** All 16 phase files contained placeholder objectives, dependencies, requirement ownership, tests, and acceptance criteria.
- **Remediation:** Replaced every shell with a complete Phase Packet containing objective, user-visible outcome, hard dependencies, owned requirements, scope, module ownership, public contracts, invariants, internal work units, failure/recovery behaviour, verification, measurable acceptance criteria, forbidden shortcuts, reviewer lenses, evidence requirements, and handoff rules.
- **Status:** RESOLVED.

### AG-SPEC-002 — Requirements had no stable implementation identifiers or single ownership
- **Severity:** BLOCKER
- **Verification:** The pre-hardening document depended on mutable section numbers and prose placement.
- **Remediation:** Created 215 stable `REQ-*` requirement groups, canonical requirement modules, one owner phase per group, explicit scope state, and machine-readable/human-readable registers.
- **Status:** RESOLVED.

### AG-SPEC-003 — Monolithic context created unacceptable agent-overload risk
- **Severity:** HIGH
- **Verification:** The legacy compiled specification exceeded 5,600 lines and mixed product requirements, process history, architecture, reviewer rules, and future ideas.
- **Remediation:** Made modular files canonical; added Phase Context Pack rules and deterministic `generated/context/phase-XX-context.md` builders; generated full specification is now archival/human convenience only.
- **Status:** RESOLVED.

### AG-SPEC-004 — Stale or superseded process sections remained mixed with current decisions
- **Severity:** HIGH
- **Verification:** Legacy sections 35, 42, 43, and 45 were superseded by later selected technology, the hardened phase system, resolved decisions, and completed interviews.
- **Remediation:** Removed them from canonical requirements, documented supersession in `requirements/README.md`, and retained the legacy baseline for auditability.
- **Status:** RESOLVED.

### AG-SPEC-005 — Early stereo/future-multichannel wording conflicted with later mandatory N-channel support
- **Severity:** HIGH
- **Verification:** Legacy channel-edit wording treated >2 channels as merely future-compatible while later requirements mandate surround/ambisonics/N-channel authoring.
- **Remediation:** Canonical `REQ-EDIT-015` now states N-channel/layout-aware support and references `REQ-ARCH-157`; format requirements also explicitly include multichannel where supported.
- **Status:** RESOLVED.

### AG-SPEC-006 — No machine-enforced dependency/readiness model
- **Severity:** HIGH
- **Verification:** Phase order was a prose list, allowing an autonomous agent to start downstream work prematurely.
- **Remediation:** Added normative DAG in Markdown/JSON and an implementation ledger. Phase 00 is `PASS`, Phase 01 alone is `READY`, all others are `NOT_READY`.
- **Status:** RESOLVED.

### AG-SPEC-007 — Generated full document could diverge from modular sources
- **Severity:** HIGH
- **Verification:** The original pack contained a monolithic document but no deterministic generation contract.
- **Remediation:** Added `tools/build_spec.py`, source manifest, generation fingerprint, and `--check`; generated document is explicitly non-editable.
- **Status:** RESOLVED.

### AG-SPEC-008 — Current, deferred, and excluded scope was not mechanically distinguishable
- **Severity:** HIGH
- **Verification:** Future cloud, third-party plugins, two-way Godot sync, native host, MIDI exclusion, encryption exclusion, and collaboration exclusion appeared in prose without a uniform execution state.
- **Remediation:** Every requirement group now has `CURRENT`, `PLANNED`, `DEFERRED`, or `EXCLUDED` scope semantics. Phase Packets separate deferred/exclusion constraints.
- **Status:** RESOLVED.

### AG-SPEC-009 — Agent engineering guardrails were extensive but not load-bounded
- **Severity:** MEDIUM
- **Verification:** Guardrails existed in the monolithic document but an agent could miss them when working from a phase fragment.
- **Remediation:** Added concise mandatory `contracts/agent-execution.md` and `contracts/architecture-invariants.md` loaded for every phase, with canonical detailed `REQ-EXEC-*` references.
- **Status:** RESOLVED.

### AG-SPEC-010 — Significant already-decided architecture lacked ADRs
- **Severity:** MEDIUM
- **Verification:** Web stack, persistence, WASM strategy, renderer, Godot architecture, history, runtime tiers, and monorepo topology were decided but had no compact decision record.
- **Remediation:** Added accepted ADR-0001 through ADR-0008.
- **Status:** RESOLVED.

### AG-SPEC-011 — Requirement-to-verification planning was implicit
- **Severity:** MEDIUM
- **Verification:** The legacy document named test categories but did not map every requirement group to a verification family.
- **Remediation:** Added verification catalogue and per-requirement planned verification IDs in the traceability register; Phase Packets provide concrete planned commands/suites and require exact evidence before PASS.
- **Status:** RESOLVED.

### AG-SPEC-012 — Direct-to-main workflow could be misread as bypassing independent review
- **Severity:** HIGH
- **Verification:** User explicitly requires worktrees/direct merge and no PR workflow, while also requiring independent/adversarial review.
- **Remediation:** Contracts explicitly require independent review before integration while retaining worktree/direct-main workflow. PRs are not required for review.
- **Status:** RESOLVED.

### AG-SPEC-013 — Arbitrary `1.0.0` maturity philosophy could appear to conflict with migration obligations
- **Severity:** HIGH (potential)
- **Verification:** This is a deliberate distinction, not a contradiction: feature scope is not tied to 1.0, but persisted-schema migration obligations intentionally begin once the project owner chooses 1.0.0.
- **Remediation:** Clarified in Phase 15 and canonical product/storage requirements; no feature is deferred merely due to pre-1.0 status.
- **Status:** VERIFIED AS INTENTIONAL / CLOSED.

### AG-SPEC-014 — Local diagnostics and “no analytics” could be conflated
- **Severity:** MEDIUM (potential)
- **Verification:** User permits structured local diagnostics and explicit/remembered consent for submission, while prohibiting usage analytics entirely.
- **Remediation:** Architecture/Phase 01 explicitly distinguish local diagnostics from telemetry/analytics and prohibit any implicit transmission.
- **Status:** VERIFIED / CLARIFIED.

### AG-SPEC-015 — GitHub Pages capability limits could undermine maximum-performance design
- **Severity:** HIGH (potential)
- **Verification:** Cross-origin-isolation-dependent features cannot be a universal assumption for a GitHub Pages deployment.
- **Remediation:** Retained Standard/Enhanced runtime tiers and capability-transparent fallbacks as a normative architecture; no core feature may silently disappear merely because an optimisation is unavailable.
- **Status:** VERIFIED / RESOLVED BY EXISTING DECISION.


### AG-SPEC-016 — Legacy generated section index referenced superseded sections
- **Severity:** MEDIUM
- **Verification:** The copied pre-hardening pack still contained `generated/SECTION-INDEX.md`, including superseded sections 35/42/43/45, which could mislead an agent about canonical content.
- **Remediation:** Removed the stale index. `requirements/README.md`, the traceability register, generated Phase Context Packs, and the deterministic compiled specification are now the supported navigation mechanisms.
- **Status:** RESOLVED.


### AG-SPEC-017 — Hardened Phase Packets initially omitted fields required by their own Phase Packet contract
- **Severity:** HIGH
- **Verification:** `REQ-EXEC-203` requires explicit data/schema changes, browser/platform considerations, and cross-package dependency rules. The first hardened packet draft had these concerns only implicitly.
- **Remediation:** Added explicit `Cross-Package Dependency Rules`, `Data / Schema Changes`, and `Browser / Platform Considerations` sections to all 16 Phase Packets and to the template; specification lint now requires those headings.
- **Status:** RESOLVED.

## Residual Non-Blocking Risks

These are implementation risks, not unresolved specification defects:

- Exact codec availability/licensing must be re-validated when dependencies are selected/pinned.
- Browser capability matrices will evolve and must be measured rather than inferred.
- ML model quality/storage/performance will require empirical benchmarking.
- Exact Godot 4 minimum version and pinned GUT version must be selected when the repository is initialised.
- Some deterministic lossy-codec output may require format-specific limitations to be documented.
- Mobile browser audio/input restrictions may require capability-specific UX.

Each risk already has an owning phase and deviation/review mechanism.

## Gate Decision

Phase 00 hardening gate: **PASS**.

Phase 01 is eligible for `READY`.
