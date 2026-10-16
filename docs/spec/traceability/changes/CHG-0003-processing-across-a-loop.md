# Specification Change Record — CHG-0003

## Status
`Accepted` — decided by the maintainer on 2026-10-16.

## Summary
Phase 10 left one question open for the maintainer, Q7 (`docs/todo/done/phase-10-game-audio-tooling.md`, section 15; `traceability/handoffs/phase-10.md`). A region's rack runs from the region's start (`ADR-0060`), so in a looping region a stateful processor's tail at the loop's start is the intro's, not the loop's own end's. An exported file holds one loop body that every repeat plays (`ADR-0093`), so a game hears that seam on every cycle after the first.

The maintainer decided that a loop renders "wrapped" by default: its body sounds as it does on every repeat, with the processing's tail carried from the loop's end into its start. The maintainer also asked for the choice per sound. `ADR-0107` states the rendering, and each loop gains `processingAcrossLoop`, `wrapped` or `from-start`.

## Rationale
Tools that render loops render the steady state: Ableton Live's "Render as Loop" runs a silent first pass to build the tails and writes the second; Logic Pro's "Bounce 2nd Cycle Pass" keeps the second pass; FL Studio's "Wrap remainder" folds the decaying tail back to the start. Reaper and Cubase have no option, and their users are taught to repeat the loop's start before it by hand, which builds the same state. The body is heard on every repeat and the intro's join once, so the body is the part to make exact. The one-time join from the intro into the loop is spliced inside the intro, which no repeat plays.

The per-loop choice keeps the old behaviour available where it is wanted: an intro meant to colour the first cycle, or a render that must match an unlooped one.

The Phase 10 plan also promised that a seam fault caused by a rack would name the rack, and nothing names it. `ADR-0107` makes that part of this change: a loop rendered `from-start` under a rack says so when its seam or stability check warns or fails.

## Affected Requirement IDs
- `REQ-GAME-121` — clause 121.1 added
- `REQ-GAME-023` — seamless-loop creation, unchanged in text
- `REQ-EDIT-014` — a region's loop gains a field
- `REQ-AUDIO-017` — a rack's render across a loop
- `REQ-STOR-052` — the project document raise, no migration before 1.0

## Affected Phases
- Phase 05 (passed): its loop (`AnchoredLoop`) gains a field; its plan's rule for a looping region changes (`ADR-0051`, through `ADR-0060`).
- Phase 06 (passed): `ADR-0060`'s canonical rendering clause gains the looping-region exception.
- Phase 10 (passed): Q7 is answered and delivered; the loop analysis gains the explanation its plan promised; the Inspector gains the setting.
- Phase 16: designs the new setting with the Inspector's other controls.

## Compatibility Impact
- Project/schema: `projectDocument` raised for the loop's new field. An older document is refused, with no migration before 1.0 (`REQ-STOR-052`). `projectStorage` and the preferences are unchanged.
- Processor/render: a looping region with stateful processing renders differently by default; a region with no processing upstream of its loop renders the same in either mode.
- Public API: `AnchoredLoop` and `LoopDefinition` gain `processingAcrossLoop`.
- Godot interchange/runtime: an exported loop's body is the steady state an engine repeats; loop points are unchanged.
- PWA/browser: none.

## Already-Passed Phase Remediation
- Phase 05 and Phase 06 stay `PASS`. The tests that pin a rack read from the region's start (`packages/domain/src/editing/loop-crossfade.test.ts`, "crosses what the region's rack made, read from the region's start", and the property tests of `loop-crossfade-property.test.ts`) keep that claim for a loop rendered `from-start`, and gain the wrapped mode against the domain's oracle. None is weakened.
- Phase 10 stays `PASS`. Its handoff records Q7 as open; that record is past and is not rewritten, and this change answers it.

## Verification Changes
- Property tests of a looping region's plan in both modes against the domain's oracle, with random racks, loops and edits.
- A fixture with a stateful rack (a recursive filter or a reverb-like tail) whose seam fails `from-start` and passes `wrapped`.
- The project round trip of the new field, its refusal when absent, and the history comparator.
- The region command, its undo, and the Inspector's control; the analysis explanation for a `from-start` loop under a rack.

## Implementation
- Delivered with this change: the loop's field and its persistence (`projectDocument` 11), the region plan's wrapped render (`packages/domain/src/editing/loop-rendering.ts`, `loop-wrapping.ts`), the `region.set-loop-processing` command with its undo, the Inspector's "Effects across the loop" field, and the Loop panel's explanation for a `from-start` loop under a rack.
- In a real browser, a loop with a loud intro under a reverb kept its level flat across every cycle when wrapped (largest step 0.26 dB) and jumped about 18 dB at every seam from the region's start (largest step 23.4 dB).
- Whole-pass processors take `ADR-0107`'s stated path: the engine cannot share one run's measurement with the other, so such a loop renders `from-start` and says why.

## Decision
- Approved/rejected by: the maintainer, 2026-10-16: "let's go with your recommendation", with the choice per sound.
- ADR/change references: `ADR-0107`; `ADR-0060` and `ADR-0103` amended by it.
