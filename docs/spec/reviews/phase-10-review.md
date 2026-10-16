# Phase 10 — Game-Audio Tooling — Review Record

## The maintainer's decision

On 2026-10-15 the maintainer required this phase to run the review pipeline
of `contracts/review-gates.md` before `PASS`, and rejected the plan's
recommendation (its conflict C12) to defer the lenses as the decision of
2026-10-07 defers every phase's; section 16 of the plan
(`docs/todo/done/phase-10-game-audio-tooling.md`) was written so.

On 2026-10-16 the maintainer decided otherwise: the packet's lens reviews and
its adversarial review, with their verification, remediation and re-review,
are deferred to the review after the whole specification is implemented, as
Phase 09's were. A lens the packet requires is recorded below as deferred.
The work units run the narrow gates of what they change, the type checks,
lint, the dependency rules and the architecture and repository tests; the
integrator runs one full `pnpm run verify:commit` over the phase branch for
each wave of merges, recorded in the evidence
(`reviews/phase-10-evidence.md`). The same day the maintainer
relaxed, for this phase's units, the rule that a test written after the code
it guards is proved by mutating that code: per-test mutation proofs are not
required.

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

No read-only scope check ran over the integrated branch before `PASS`. Under
the maintainer's decision of 2026-10-16 the checks of the packet's In Scope
items, acceptance criteria, invariants, cross-package rules, failure
behaviour, forbidden shortcuts and required contracts, against `ADR-0100` to
`ADR-0106` and `CHG-0001`, fall to the review after the whole specification
is implemented, with the lenses. The evidence maps every item to its
implementation and tests (`reviews/phase-10-evidence.md`).

## Found by the build

The units and the integrator found B-01 to B-09 while building and
integrating; B-01 to B-03 were found by running the browser test
(`tests/e2e/game-workflows.spec.ts`). The deviations the units took from the
design are recorded with their evidence in `reviews/phase-10-evidence.md`
("Accepted deviations from the design") and in the plan and ADRs they amend.

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| B-01 | MEDIUM | CONFIRMED | A group command's availability asked only for a chosen group and never saw the invocation's group: with groups made and none chosen, as straight after Cut Into Sounds, pressing a group in the tree, F2 or Delete on it was refused with "Choose a group in the Asset groups panel first". |
| B-02 | HIGH | CONFIRMED | A looping voice's run was laid to the plan's end when it started and lengthened only while not cut: a voice started just before the end and cut after the end moved on read its run past its end, a plan the engine refuses, which ended a preview of overlapping loops within a minute. |
| B-03 | HIGH | CONFIRMED | The preview's plan was laid afresh only at a silent moment: a never-stopped loop, or triggers overlapping without a break, grew the plan (a cycle per cycle played), the motion (a point per waypoint) and the simulation's log and snapshots for as long as they played, past the 4,096 streams a message carries in minutes. |
| B-04 | MEDIUM | CONFIRMED | Create Seamless Loop asked to analyse a region that does not loop over its whole length, but its analyses read each region as the Loop panel does and refused one without a loop, so its analysis could never be asked and the region never planned. |
| B-05 | MEDIUM | CONFIRMED | A policy value a game command could not read was refused with the project format's document wording, which names no group or member, against the packet's rule that an invalid inherited setting identifies the group or override that owns it. |
| B-06 | LOW | CONFIRMED | `packages/game-audio`'s refusals quoted the names people gave with straight quotes, where every command's text quotes with `@audiogubbins/text`'s curly `quoted`; one refusal then quoted two ways. |
| B-07 | LOW | CONFIRMED | `hand-trigger.performance.test.ts` read the wall clock, and on a shared machine its 1 ms bound on the simulation read 1.28 to 1.60 ms even alone. |
| B-08 | LOW | CONFIRMED | The preview plan was tested only against a catalogue double, which restated the spatial panner's ranges. |
| B-09 | LOW | CONFIRMED | The Game preview's hand trigger had no default key, and the Loop panel's auditions were scoped to their keys by the panel's styling class. |

## Disposition

Every finding is fixed on the phase branch: B-08 by WU-10.E3 (`9cea6fc2`),
B-07 by WU-10.E3, and B-01 to B-06 and B-09 by the final integration fixes,
WU-10.FX (`39a4885e`). No `BLOCKER`, `CRITICAL`, `HIGH` or `MEDIUM` finding
is open. The accepted `LOW` debt is listed in the evidence ("Accepted
non-blocking debt") and the handoff (`traceability/handoffs/phase-10.md`):
the browser test does not apply the built-in "Game SFX, −16 LUFS" chain;
`packages/guided-workflows`' refusals still quote with straight quotes; the
preview's simulation runs on the page at 2 to 3 ms a trigger; and the tests
that time out under the whole suite's load. Q7, a looping region's rack
rendered wrapped, is open for the maintainer.

| Id | Disposition |
| --- | --- |
| B-01 | **Fixed** in `a14f67ee`. A command's availability is given the invocation where it is known: the bus passes the one it runs, and a control asks with the arguments it would run with. Held by "chooses the group an invocation names while none is chosen", "renames the group an invocation names while none is chosen, and refuses one naming none" and "deletes the group an invocation names while none is chosen" (`apps/web/src/commands/game-commands.test.ts`), and "hands a command the invocation it would run with, asked and run alike" (`packages/commands/src/registry.test.ts`). |
| B-02 | **Fixed** in `08beafbd`. Every looping voice is lengthened as far as it sounds within the end: to the end where it is not cut, and to its fade's end where it is. Held by "lays a looping voice cut past the plan’s old end as far as it sounds" (`packages/game-audio/src/preview/extend-preview-plan.test.ts`). |
| B-03 | **Fixed** in `121a40f3`, `e80d3951` and `ff40b06a`. A plan stream may state `forgottenBefore`, the first frame it still describes, and a continuation compares it only from there; `forgetPreviewBefore` and `forgetPreviewPlanBefore` drop what was heard; the run forgets every 5 s of playback what was heard more than 1 s behind the listener, and the laying afresh at a silent moment is removed (`ADR-0104` amended). Held by "holds a plan and a simulation no larger after eight minutes than after two", "sounds the same from the frame forgotten, and goes on into a hand trigger after it alike" and "refuses to go on from a frame it has forgotten" (`packages/game-audio/src/preview/preview-forgetting.test.ts`); "keeps every reader and sounds on bit for bit where the forgetting is stated" (`packages/audio-engine/src/pcm/plan-continuation.test.ts`); "compares a stream that has forgotten its past only from where it remembers" (`plan-divergence.test.ts`); "let a stream forgotten whole hold its place where nothing reads it, and no other" (`packages/domain/src/editing/preview-streams.test.ts`); and "keeps its plan from growing without end where a loop and its triggers never fall silent" (`apps/web/src/audio/preview-run.test.ts`). |
| B-04 | **Fixed** in `1c2ed9ea`. The workflow's analyses read such a region as its whole length joined hard; the Loop panel and the auditions still read only a loop the region has. Held by "analyses the whole of a region that does not loop as the loop Create Seamless Loop asks for" (`apps/web/src/shell/workflows/workflow-dialog.test.tsx`). |
| B-05 | **Fixed** in `00a727eb`. Each refusal of a value read for a group's policy, a member's override, a membership's overrides or a new group's policy names the group by its path or the member by its name, and the field (`packages/project-commands/src/game/value-owners.ts`). Held by "refuses a policy value that does not read, naming the new group by its path and the field" and "refuses a value that does not read, naming the group by its path and the field" (`group-commands.test.ts`), "is refused naming the member by its name and the field" (`member-setting-commands.test.ts`) and "are refused naming the member by its name and each field" (`membership-commands.test.ts`). |
| B-06 | **Fixed** in `291d875b` for `packages/game-audio`, which gains the dependency on `@audiogubbins/text` in the workspace graph, the cruise rule and the allowed dependencies. Held by the curly quotes its tests now expect (`state-validation.test.ts`, `group-names.test.ts`, `game-export-plan.test.ts`, `member-names.test.ts`, `destination-path.test.ts`, `scenario-commands.test.ts`, `rack-commands.test.ts`). `packages/guided-workflows`' refusals keep straight quotes, accepted as `LOW` debt. |
| B-07 | **Fixed** in `2d7f613f`. The test measures the thread's processor time. Held by "is simulated within 1 ms and planned within 5 ms in all" (`packages/game-audio/src/preview/hand-trigger.performance.test.ts`). |
| B-08 | **Fixed** in `0ecedebc`. The preview plan is held to the real processors' catalogue in the web app, which may import them. Held by "takes every value of $space, $rules.attenuation.kind" and "states %s as the processors do" (`apps/web/src/audio/preview-catalogue.test.ts`). |
| B-09 | **Fixed** in `47438def`. T triggers the hand trigger, run only where the Game preview panel has the keyboard; both panels mark themselves with an attribute of their own (`data-ag-preview-panel`, `data-ag-loop-panel`), which the shortcut scoping reads. Held by "marks itself as the place its hand trigger’s key is its own" (`apps/web/src/shell/preview/preview-panel.test.tsx`). |
