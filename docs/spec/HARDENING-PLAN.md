# Specification Hardening Plan

The next documentation milestone is to convert the current rich requirements corpus into an agent-executable specification.

## Pass 1 — Normalise

- Remove duplicate requirements without losing intent.
- Resolve contradictions and overlapping policies.
- Separate normative requirements from rationale and examples.
- Replace ambiguous wording with MUST/SHOULD/MAY semantics where appropriate.

## Pass 2 — Identify

- Assign stable domain-scoped requirement IDs.
- Extract cross-cutting architecture invariants.
- Add interface/contract identifiers where phases exchange data.

## Pass 3 — Allocate

- Assign every normative requirement to one owning phase.
- Identify consuming/downstream phases.
- Build the explicit dependency DAG.

## Pass 4 — Phase-Pack

For each phase, populate objective, prerequisites, owned requirements, package ownership, TODOs, invariants, tests, acceptance criteria, forbidden shortcuts, reviewers, and evidence.

## Pass 5 — Verify the Specification

Run independent and adversarial reviews for ambiguity, impossible assumptions, browser incompatibilities, security/data-loss risks, missing failure behaviour, untestable acceptance criteria, phase leakage, and context overload.

## Pass 6 — Static Validation

Add a spec-lint process that detects duplicate IDs, broken references, unowned requirements, dependency cycles, incomplete Phase Packets, and requirements without verification.

## Exit Criterion

Production implementation begins only when Phase 00 and the first implementation phase are marked `READY` by the hardened specification process.
