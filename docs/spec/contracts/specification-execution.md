# Specification Execution Protocol

## Canonical Sources

Authority order:

1. Approved requirement/change record in `requirements/`.
2. `contracts/agent-execution.md` and `contracts/architecture-invariants.md`.
3. Current hardened Phase Packet.
4. Approved ADR.
5. Public contract/handoff from a passed prerequisite phase.
6. Explanatory examples and generated compiled specification.
7. Existing implementation behaviour.

`generated/AudioGubbins_Implementation_Specification.md` is a compiled convenience artefact and MUST NOT be edited directly.

## Phase Readiness

A phase is `READY` only when:

- every hard dependency is `PASS`;
- the Phase Packet has no unresolved placeholders;
- all owned requirement IDs exist and have compatible scope;
- required public contracts/tooling/fixtures exist;
- the dependency DAG is acyclic;
- specification lint passes;
- no unresolved verified finding invalidates the phase assumptions.

## Phase Context Pack

A fresh agent receives only:

- Agent Execution Contract;
- Architecture Invariants;
- current Phase Packet;
- owned/referenced requirement blocks;
- referenced ADRs;
- prerequisite public contracts/handoff capsules;
- relevant implementation-ledger entry.

The agent retrieves additional requirements by ID when needed. It is prohibited to assume that omitted requirements do not exist.

## Internal Work Units

A large Phase Packet may be decomposed into work units. Each unit declares owned modules/files and contract boundaries. The parent phase remains open until every mandatory work unit passes integration and review.

## Parallel Work

Concurrent worktrees are permitted after shared contracts are committed. Agents must minimise overlapping ownership and must not independently invent competing forms of the same public contract.

## Specification Changes

Material changes after implementation begins require a change record identifying affected requirement IDs, phases, schemas/APIs, tests, and remediation needs. Silent edits are prohibited.
