# AudioGubbins Specification Pack — Operator Guide

This guide is for the human project owner operating the AudioGubbins implementation process.

You do **not** need to understand or manually feed the whole specification to an implementation agent. The pack is designed so that the agent works one gated phase at a time from a bounded context.

## 1. What You Actually Need To Do

At a high level, your loop is:

1. Put this specification pack in the AudioGubbins repository.
2. Verify the pack.
3. Ask the status tool which phase is `READY`.
4. Create an isolated Git worktree for the implementation agent when concurrent work requires it.
5. Give the agent the start prompt and tell it to implement the current `READY` phase completely.
6. Let the implementation agent run the required multi-lens and adversarial review process.
7. Require every reported finding to be verified before remediation.
8. Require every genuine blocking finding to be fixed and re-reviewed.
9. Merge the completed, reviewed work into `main` using the repository workflow.
10. Ensure the phase handoff and implementation ledger are updated.
11. Re-run specification and project verification.
12. Move to the next phase that becomes `READY`.

Do not manually mark later phases ready just to keep work moving. Readiness follows the dependency graph and phase gates.

---

## 2. Recommended Repository Location

Place the pack in a stable location in the repository, for example:

```text
AudioGubbins/
├── docs/
│   └── spec/
│       ├── README.md
│       ├── OPERATOR-GUIDE.md
│       ├── requirements/
│       ├── contracts/
│       ├── phases/
│       ├── traceability/
│       └── ...
├── apps/
├── packages/
├── crates/
└── ...
```

The exact repository layout may be established by Phase 01. What matters is that the specification pack remains version controlled alongside the implementation.

Do not copy only the generated monolithic document into the repository. The modular files are canonical.

---

## 3. Prerequisites For Operating The Specification

The specification tooling requires Python 3.

From the specification-pack root, verify the tooling with:

```bash
python tools/spec_status.py
python tools/spec_lint.py
python tools/build_spec.py --check
python tools/build_phase_contexts.py --check
python tools/verify_hardening.py
```

All validation commands must pass before implementation begins or resumes after material specification changes.

`spec_status.py` is read-only. It tells you which phases are `PASS`, `READY`, or not yet ready.

---

## 4. Starting The First Implementation Phase

The initial hardened state is:

- Phase 00 — `PASS`
- Phase 01 — `READY`
- Phases 02–15 — gated by dependencies

Run:

```bash
python tools/spec_status.py
```

Then use the current phase context, for example:

```text
generated/context/phase-01-context.md
```

The implementation agent should **not** begin by reading the entire generated specification.

---

## 5. What To Give The Implementation Agent

Use `AGENT-START-PROMPT.md` as the starting instruction.

For Phase 01, the agent's primary implementation context is:

```text
contracts/agent-execution.md
contracts/architecture-invariants.md
contracts/specification-execution.md
contracts/review-gates.md
phases/phase-01-application-foundation.md
generated/context/phase-01-context.md
traceability/implementation-ledger.json
```

The generated Phase Context Pack already contains the bounded requirements needed for the phase. The agent may open referenced ADRs, prerequisite handoffs, and canonical requirement files when required for authoritative detail.

It must not use the monolithic generated specification as its normal working context.

---

## 6. Worktrees And Concurrent Agents

When multiple agents work concurrently, each implementation unit should use an isolated Git worktree unless the repository workflow deliberately gives it exclusive ownership of the main working tree.

A typical manual setup is conceptually:

```bash
git worktree add ../AudioGubbins-phase-01 -b phase/01-application-foundation main
```

The exact branch naming is not normative. The specification's important rules are:

- concurrent agents must not edit the same owned files without explicit coordination;
- shared contracts must be agreed before parallel implementations depend on them;
- every agent must know its package/file ownership;
- reviews must use the actual implementation produced in that worktree;
- reviewed changes are integrated into `main` according to the project owner's repository workflow;
- do not raise pull requests merely because conventional workflows often do so; AudioGubbins intentionally uses the project owner's direct-integration workflow.

The implementation agent has full repository and filesystem access and is expected to perform the work itself.

---

## 7. What “Complete A Phase” Means

A phase is **not** complete when the agent says it has finished coding.

A phase is complete only when all of the following are true:

- every owned requirement in the Phase Packet is satisfied;
- every mandatory TODO is complete;
- all specified tests and verification commands pass;
- acceptance criteria pass;
- architecture invariants remain valid;
- the required independent review lenses have executed;
- adversarial review has executed where required;
- reviewer findings have been verified rather than blindly accepted;
- every verified `BLOCKER`, `CRITICAL`, or `HIGH` finding is fixed;
- every required `MEDIUM` finding is fixed or explicitly accepted according to the review contract;
- remediation is re-reviewed;
- no disallowed placeholder, `TODO`, `FIXME`, `HACK`, fake implementation, or silent fallback remains;
- the implementation ledger contains evidence and relevant commits;
- the phase handoff capsule is produced;
- the phase reaches `PASS` through the specified gate process.

Do not advance because the implementation merely “looks done”.

---

## 8. Review Behaviour You Should Expect

Reviewers are deliberately adversarial, but they are not automatically correct.

The expected loop is:

```text
Implementation
    ↓
Independent multi-lens review
    ↓
Adversarial review
    ↓
Verify each finding against code/spec/tests
    ↓
Reject false findings
    ↓
Fix genuine findings
    ↓
Re-run affected tests/review lenses
    ↓
Gate decision
```

A reviewer must not force a change merely because it has expressed an opinion. Findings need evidence and must be checked against the specification.

Likewise, the implementation agent must not dismiss an inconvenient finding without evidence.

---

## 9. If An Agent Says A Requirement Is Impossible

The agent must not silently weaken it.

It should produce a concise conflict report containing:

- requirement ID;
- what is technically blocked;
- evidence;
- affected platforms/capabilities;
- whether an already-specified graceful degradation applies;
- recommended resolution;
- consequences of the resolution.

If the existing specification already defines a compatible capability-based fallback, the agent may use it.

Otherwise, the phase becomes `BLOCKED` until the specification is deliberately changed.

---

## 10. If You Change Your Mind About A Requirement

Do not edit random generated prose.

Use the canonical requirement and specification change process:

1. identify the affected `REQ-*` IDs;
2. update the canonical requirement module;
3. document a material decision in an ADR when appropriate;
4. update affected phase ownership, Phase Packets, dependency graph, tests, and traceability;
5. rebuild generated artefacts;
6. run all specification checks;
7. identify already-passed phases affected by the change;
8. reopen/remediate those phases if the new requirement invalidates their previous evidence.

Use `contracts/specification-change-template.md` for material changes.

---

## 11. Rebuilding Generated Specification Artefacts

After canonical specification changes, run:

```bash
python tools/spec_lint.py
python tools/build_spec.py
python tools/build_phase_contexts.py
python tools/verify_hardening.py
```

Then verify determinism:

```bash
python tools/build_spec.py --check
python tools/build_phase_contexts.py --check
```

Generated files must never be edited directly.

---

## 12. Reading The Status Without Understanding The Ledger JSON

Run:

```bash
python tools/spec_status.py
```

For machine-readable output:

```bash
python tools/spec_status.py --json
```

For details about one phase:

```bash
python tools/spec_status.py --phase 01
```

The status command does not mutate anything.

---

## 13. When To Intervene Personally

You normally only need to intervene when:

- the agent reports a genuine specification conflict;
- two desirable behaviours require a product trade-off not covered by the decision rules;
- a phase is `BLOCKED`;
- a reviewer finding changes product intent rather than merely correcting implementation;
- an external dependency/licence constraint materially changes capability;
- browser/platform behaviour makes the specified contract genuinely impossible;
- you want to alter product direction.

You do **not** need to choose routine implementation details that the contracts already delegate to the agent.

---

## 14. What Not To Do

Do not:

- tell an agent to “implement the whole specification” in one run;
- ask an agent to ingest the monolithic generated document as its normal context;
- manually skip a failed phase gate;
- accept reviewer findings without verification;
- allow the agent to postpone difficult phase requirements into invented future work;
- allow temporary hacks to survive a phase gate;
- allow tests to be weakened to make a phase pass;
- merge concurrent work that changed shared contracts independently without reconciliation;
- edit generated specification files directly;
- interpret `1.0.0` as a fixed feature boundary — AudioGubbins version labels follow the project owner's judgement.

---

## 15. Minimal Operating Loop

If you remember nothing else, use this loop:

```text
VERIFY SPEC
    ↓
CHECK READY PHASE
    ↓
CREATE/ASSIGN WORKTREE
    ↓
GIVE AGENT START PROMPT + PHASE CONTEXT
    ↓
IMPLEMENT FULL PHASE
    ↓
MULTI-LENS + ADVERSARIAL REVIEW
    ↓
VERIFY FINDINGS
    ↓
REMEDIATE GENUINE FINDINGS
    ↓
RE-VERIFY
    ↓
UPDATE LEDGER + HANDOFF
    ↓
MERGE TO MAIN
    ↓
CHECK NEXT READY PHASE
```

That is the intended way to “run” this specification.
