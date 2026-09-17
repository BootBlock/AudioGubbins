# Review Gates

## Review Pipeline

Every implementation phase executes this pipeline after implementation tests are green:

1. **Evidence assembly** — implementation agent records commits, tests, benchmark/golden outputs, screenshots where applicable, ADRs, and requirement coverage.
2. **Independent lens reviews** — reviewers receive the Phase Packet, referenced requirements, evidence, and relevant public contracts. They do not receive instructions to preserve the implementation.
3. **Adversarial review** — actively search for hidden shortcuts, unimplemented edge cases, architecture erosion, test cheating, data-loss paths, capability assumptions, and requirement drift.
4. **Finding verification** — reproduce or prove each finding before remediation. False positives are documented and closed.
5. **Remediation** — verified findings are fixed in owned scope. Fixes receive regression tests where mechanically testable.
6. **Re-review** — affected lenses re-run after remediation.
7. **Gate decision** — PASS only when the Phase Packet acceptance criteria and severity rules are satisfied.

## Required Lenses

Every phase:
- Architecture
- Code Quality / Maintainability
- Testing / Regression
- Adversarial Agent-Quality

Conditionally required:
- Audio/DSP Correctness
- Data Integrity / Recovery
- Security / Privacy
- Performance / Scalability
- UX / Accessibility / Input
- Browser / PWA Compatibility
- Godot Editor / Runtime Integration
- Codec / Interchange Correctness

The Phase Packet identifies the applicable set.

## Severity

- `BLOCKER`: implementation cannot safely proceed or phase evidence is invalid.
- `CRITICAL`: severe data-loss/security/correctness/architectural failure.
- `HIGH`: mandatory behaviour incorrect or a serious architecture/test-quality violation.
- `MEDIUM`: genuine defect or debt that must be fixed or explicitly accepted with justification and tracking.
- `LOW`: non-blocking improvement.
- `NOTE`: observation, question, or future consideration.

`BLOCKER`, `CRITICAL`, and `HIGH` prevent PASS. `MEDIUM` requires remediation or an explicit accepted-debt record. `LOW` and `NOTE` may remain if tracked.

## Reviewer Rules

- The implementer cannot be the approving reviewer.
- A reviewer must cite requirement IDs, code/evidence locations, and reproduction/proof.
- Reviewers must distinguish product preference from specification violation.
- A reviewer must not propose scope reduction as a fix.
- Genuine findings are corrected; findings are not dismissed because a fix is inconvenient.
