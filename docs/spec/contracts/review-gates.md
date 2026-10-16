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
- Visual Design (see below)

The Phase Packet identifies the applicable set.

## Visual Design Review

The other lenses cannot judge appearance: a reviewer agent can check that a token is used and a contrast ratio holds, and not that a surface looks right. The Visual Design lens is therefore a sign-off by the product owner (`REQ-UX-221`, `CHG-0002`). It is required for every surface a phase designs or whose appearance it changes, from Phase 16 onwards.

1. **Before implementation** — the implementer presents mock-ups or variants of each surface, in both themes and both densities, to the product owner. The approved version is recorded as the surface's visual reference, with the date and the decision, in the phase's evidence.
2. **After implementation** — the implementer presents each rendered surface beside its approved reference, in each theme and density, together with the component states it uses and, for motion, a recording at each motion level. The product owner signs off the surface or returns it with marked findings.
3. **Findings** — a returned surface is a finding of the Visual Design lens. It is fixed and presented again; it is not dismissed, and a reviewer agent does not overrule it. The product owner's preference is the criterion here, which is the one exception to "Reviewers must distinguish product preference from specification violation".
4. **Baseline** — the signed-off rendering becomes the baseline of the automated screenshot comparison. A later change that moves a surface beyond the comparison's tolerance fails until the product owner signs off the new rendering, and the new baseline is committed with that sign-off recorded.

The implementer may not sign off its own surface, and a reviewer agent may not sign off for the product owner. When other lens reviews are deferred, this sign-off is not deferred: a phase that requires it does not pass without it.

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
