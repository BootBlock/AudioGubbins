# Phase 10 — Game-Audio Tooling — Review Record

> **Draft.** Written while the phase is built. The scope checks over the
> integrated branch and the findings of the build are to be added when the
> remaining work units land (WU-10.B, WU-10.E1a, WU-10.E1b, WU-10.E2,
> WU-10.E3 and WU-10.F).

## The maintainer's decision

On 2026-10-15 the maintainer required this phase to run the review pipeline
of `contracts/review-gates.md` before `PASS`, and rejected the plan's
recommendation (its conflict C12) to defer the lenses as the decision of
2026-10-07 defers every phase's; section 16 of the plan
(`docs/todo/phase-10-game-audio-tooling.md`) was written so.

On 2026-10-16 the maintainer decided otherwise: the packet's lens reviews and
its adversarial review, with their verification, remediation and re-review,
are deferred to the review after the whole specification is implemented, as
Phase 09's were. A lens the packet requires is recorded below as deferred.
The work units run the narrow gates of what they change, the type checks,
lint, the dependency rules and the architecture and repository tests; the
integrator runs one full `pnpm run verify:commit` over the phase branch for
each wave of merges, recorded in the evidence
(`reviews/phase-10-evidence.md`).

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

## Lenses deferred

Each lens `phases/phase-10-game-audio-tooling.md` requires, and the Code
Quality / Maintainability lens every phase requires, is deferred to the
review after the whole specification is implemented:

| Lens | Disposition |
| --- | --- |
| Audio / DSP Correctness | Deferred to the post-specification review. |
| UX / Accessibility | Deferred to the post-specification review. |
| Architecture | Deferred to the post-specification review. |
| Testing / Regression | Deferred to the post-specification review. |
| Performance | Deferred to the post-specification review. |
| Code Quality / Maintainability | Deferred to the post-specification review. |
| Adversarial Agent-Quality | Deferred to the post-specification review. |

## The design-stage adversarial reviews

Before any product code, two independent adversarial reviews read the first
draft of the design (`c8164dbd`: the plan, `ADR-0100` to `ADR-0106`) against
the packet, the owned and referenced requirements, the ADRs it builds on and
the code it would change, each by an agent that had not written it:

| Review | Findings | Outcome |
| --- | --- | --- |
| Architecture | 14 | Each verified against the code and the specification and disposed of by the revision `61bd8f1a`. |
| Audio / DSP | 24 | Each verified against the code and the specification and disposed of by the revision `61bd8f1a`. |

Their dispositions are the revision itself; the findings' own texts were not
kept in the tree. By the area of the design they changed:

- **One authority for inherited processing.** A membership's `processing`,
  `inherit` or `own`, became the one record of whether a member inherits,
  validated against the member's rack (`game.member-processing-mismatch`),
  in place of a second record beside the rack that could disagree with what
  is heard; every command that changes what an inheriting member inherits
  re-points its rack in the same step; `projectChainUsers` became the one
  reader of a chain's users, groups included, guarded by an architecture
  rule against a new import of the domain's `chainUsers` (`10e519bf`)
  (`ADR-0101`).
- **Rules split by who holds them.** A player's emitter rules (selection,
  voices, cooldown, attenuation, filter), which a member cannot override,
  were split from each member's voice variation and bus, which it can; the
  game processing presets became built-in entries of the processing library,
  not a list of their own (`ADR-0101`, `ADR-0104`, `CHG-0001`'s C16).
- **Loop analysis reworked.** Seam metrics compare with what should follow
  the loop's end by a stated reference; the discontinuity became the click
  detector's Burg residual in median absolute deviations, which does not
  scale with the sample rate; Welch spectra over third-octave bands; one
  bounded streamed pass for the candidate search, with overlap-save
  correlation by the canonical FFT; crossfades scored over the faded audio;
  and the loop's crossfade heard in the region's plan with a tail join and a
  clamp (`ADR-0103`, `CHG-0001`'s C11).
- **The preview reworked.** Varispeed by a ratio of whole 4,096ths, so the
  resampler's table stays within its budget and no rate below the domain's
  least is declared; a canonical `spatial-panner` processor whose position is
  plan-chain automation, so motion renders the same offline and live;
  Godot's coordinate conventions; `limit + 1` lanes an emitter, so a stolen
  voice's fade never shares its replacement's lane; a measured voice budget;
  and hand triggers built incrementally from the simulation's state
  (`ADR-0104`).
- **The continued programme made a gated first unit.** Playback could change
  what plays only by reloading, which resets every processor and clicks; the
  revision made a continuation that keeps live readers the first unit of the
  audio path, with bit-identity acceptance tests (a) to (c), and blocks the
  phase rather than degrade if they fail (`ADR-0104`). The gate passed when
  WU-10.D3 merged (`c6677d89`; `plan-continuation.test.ts`,
  `feeder-continuation.test.ts`).
- **Workflows.** A workflow may target groups; an export is kept outside the
  undoable step, offered after it as its own action; what a planner reads of
  an assistant's report moves out of the web app to `packages/detection-runtime`
  (`ADR-0105`).
- **Scope and ownership.** The packet and scope conflicts became the
  specification change `CHG-0001`, which amends the packet; conflict C6 was
  withdrawn once pnpm was observed to consume `--filter` itself; C12 was
  rejected by the maintainer then (see above); Q6 was answered. The compiled
  specification, the phase contexts and the checksums were rebuilt.

## The scope checks

**PENDING.** As Phase 09 did in place of its lenses, read-only scope checks
by agents that built none of the work are to read the integrated branch
against every In Scope item, acceptance criterion, invariant, cross-package
rule, failure behaviour, forbidden shortcut and required contract of the
packet, and against `ADR-0100` to `ADR-0106` and `CHG-0001`. Their findings
will be numbered from F-01.

## Found by the build

**PENDING.** The units' reports and the integrator's follow-ups, numbered
from B-01, with their dispositions, once the remaining units land. The
deviations the merged units took from the design are recorded with their
evidence in `reviews/phase-10-evidence.md` ("Accepted deviations from the
design") and in the plan and ADRs they amend.

## Disposition

**PENDING.**
