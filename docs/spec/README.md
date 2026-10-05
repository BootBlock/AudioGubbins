# AudioGubbins Specification Pack

This directory is the canonical implementation specification for **AudioGubbins**.

It is designed for autonomous phase-by-phase implementation by advanced coding agents without requiring any agent to ingest one giant document into working context.

## Start Here

### For the project owner/operator

Read `OPERATOR-GUIDE.md`. It explains how to verify the pack, identify the current READY phase, start an implementation agent, use worktrees, interpret reviews, remediate findings, merge completed work, and advance safely.

`AGENT-START-PROMPT.md` is a copy/paste starting prompt for the implementation agent.

Run `python tools/spec_status.py` at any time for a read-only view of phase readiness.

### For an implementation agent

Read, in order:

1. `contracts/agent-execution.md`
2. `contracts/architecture-invariants.md`
3. `contracts/specification-execution.md`
4. the current `READY` Phase Packet under `phases/`
5. preferably load `generated/context/phase-XX-context.md`, which deterministically contains only the requirement IDs referenced by that Phase Packet
6. relevant ADRs
7. relevant prerequisite handoff capsules
8. the phase entry in `traceability/implementation-ledger.json`

Do **not** start from the generated monolithic specification.

### For a reviewer

Read:

1. `contracts/review-gates.md`
2. the current Phase Packet
3. its owned requirement IDs
4. implementation evidence
5. public contracts from prerequisite phases that are affected

Reviewers should be independent of the implementer and must verify findings before remediation is demanded.

### For a human wanting one file

Use:

`generated/AudioGubbins_Implementation_Specification.md`

That file is generated from canonical modules and MUST NOT be edited directly.

## Current Readiness

- Phases 00–05 — **PASS**
- Phase 06 — **READY**, settled by its readiness review (`ADR-0060`, `ADR-0061`, `ADR-0062`)
- Phases 07–15 — **NOT_READY** until hard dependencies pass

See `traceability/implementation-ledger.md`.

## Directory Structure

```text
AudioGubbins_Specification_Pack_Hardened/
├── README.md
├── HARDENING-REPORT.md
├── OPERATOR-GUIDE.md
├── AGENT-START-PROMPT.md
├── requirements/
│   ├── README.md
│   ├── product.md
│   ├── architecture.md
│   ├── editing.md
│   ├── audio.md
│   ├── recording.md
│   ├── storage.md
│   ├── game.md
│   ├── godot.md
│   ├── pwa.md
│   ├── ux.md
│   ├── privacy.md
│   ├── repository.md
│   └── execution.md
├── contracts/
│   ├── agent-execution.md
│   ├── architecture-invariants.md
│   ├── review-gates.md
│   ├── specification-execution.md
│   ├── decision-rules.md
│   ├── requirement-writing-standard.md
│   ├── specification-change-template.md
│   ├── phase-packet-template.md
│   └── handoff-capsule-template.md
├── phases/
│   └── phase-00 ... phase-15
├── adr/
│   └── ADR-0001 ... ADR-0008
├── traceability/
│   ├── requirements-register.md
│   ├── requirements-register.json
│   ├── implementation-ledger.md
│   ├── implementation-ledger.json
│   ├── phase-dependency-graph.md
│   ├── phase-dependency-graph.json
│   ├── verification-catalogue.md
│   └── handoffs/
├── reviews/
│   ├── hardening-review.md
│   └── verification-report.md
├── tools/
│   ├── spec_status.py
│   ├── spec_lint.py
│   ├── build_spec.py
│   ├── build_phase_contexts.py
│   ├── verify_hardening.py
│   └── spec_manifest.json
└── generated/
    ├── AudioGubbins_Implementation_Specification.md
    └── LEGACY_Requirements_Baseline.md
```

## Authority

When sources conflict:

1. latest approved canonical requirement/change record;
2. global execution/architecture contracts;
3. current hardened Phase Packet;
4. approved ADR;
5. passed prerequisite public contracts/handoff;
6. generated/explanatory material;
7. existing code.

Existing code never wins merely because it already exists.

## Specification Validation

Run:

```bash
python tools/spec_status.py
python tools/spec_lint.py
python tools/build_spec.py --check
python tools/build_phase_contexts.py --check
python tools/verify_hardening.py
```

All three must pass before Phase 01 is treated as executable.

## Editing the Specification

- Edit canonical modules, not the generated full document.
- Never renumber existing `REQ-*` identifiers once production implementation starts.
- Update traceability when requirement ownership/scope changes.
- Update affected Phase Packets and ADRs for material changes.
- Rebuild the compiled document and run all specification checks.
