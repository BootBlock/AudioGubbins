# Specification Change Record — CHG-0002

## Status
`Accepted` — approved by the maintainer on 2026-10-16. The placement was revised at the maintainer's direction to make Phase 16 the next phase, and the maintainer waived Phase 16's readiness review, so it is `READY`.

## Summary
A visual design and interaction phase, Phase 16, is added as the next phase: Phases 11, 12, 13 and 14 now depend on it. No phase owned the visual design of AudioGubbins:

1. **Phase 01 passed with `REQ-UX-005` mapped to evidence, and its intent is unmet.** Its first sentence asks for "a modern, sleek, visually rich multimedia application rather than a conventional form-based web application". Phase 01 owns it with `REQ-UX-069` (motion), `REQ-UX-070` (themes), `REQ-UX-071` (density) and `REQ-UX-155` (design-token architecture). Phase 01's evidence (`reviews/phase-01-evidence.md`, the requirement-to-evidence table) verified their structure: semantic tokens, computed contrast, themes, density modes, the motion preference, landmarks, focus and touch targets. Nothing in it measures appearance, and the evidence records no screenshot because "every visual and interaction claim … is asserted by an automated check". A check of that kind cannot judge whether a surface looks right.
2. **The shell animation was deferred and nothing took it up.** `ADR-0014` deferred the animation library until a component imports one, and left the shell's transitions to CSS over the motion tokens. No later requirement or phase asked for the animation `REQ-UX-069` lists.
3. **Every later phase built on the unmet design.** Phases 02 to 10 added panels on Phase 01's tokens and primitives. Phase 14 is performance, compatibility and accessibility hardening, and Phase 15 is release readiness. Neither designs the interface, so no remaining phase would fix it, and Phase 14 would harden an interface that is then redesigned.

The change:

- Splits two requirement groups from Phase 01's, as `ADR-0050` split `REQ-AUDIO-220` from `REQ-AUDIO-010`, because a requirement group has one owning phase: `REQ-UX-221` (visual design language and verified visual quality) and `REQ-UX-222` (motion system and shell animation), both owned by Phase 16.
- Adds a verification clause to each of `REQ-UX-005` (5.1), `REQ-UX-069` (69.1), `REQ-UX-070` (70.1), `REQ-UX-071` (71.1) and `REQ-UX-155` (155.1). Each clause states what verifies the visual outcome and that structural evidence does not. No requirement is weakened.
- Adds Phase 16 — Visual Design and Interaction (`phases/phase-16-visual-design-and-interaction.md`): a design language, a component inventory, a redesign of the shell and of every existing panel and dialogue on the existing tokens, mock-ups approved before implementation, and acceptance by the maintainer's sign-off and by screenshot comparison.
- Adds a Visual Design lens to `contracts/review-gates.md`: the maintainer's sign-off of each surface against its approved reference. The existing lenses cannot judge appearance.
- Records that `ADR-0014`'s deferral is taken up (an amendment to `ADR-0014`).

## Rationale
`REQ-EXEC-215` states that a requirement is not satisfied because related code exists. The structural evidence was correct for what it measured, and the requirement asks for more. Leaving the gap would let Phase 15 release an interface that its first requirement group describes and its evidence does not show.

### The interface as it stands
The built application was driven in Chromium on 2026-10-16 and every panel, menu and dialogue was captured in both themes and both densities. Observed:

- No icons anywhere: tools, transport, menus and tabs are text, so toolbars are wide and wrap.
- Most panels are vertical stacks of thin outlined text buttons with explanatory sentences between them.
- No type hierarchy beyond bold body text, in the operating system's font; a panel's title repeats its tab's name below the tab.
- Low separation between chrome, panels and fields in the dark theme; inactive tabs hard to read.
- In the light theme, the waveform, spectrogram and ruler stay black, and fields look disabled.
- A busy vertical grid over the waveform, and a selection that is hard to see.
- Red text for states that are not errors ("Nothing is playing."), against the reserved meaning of red.
- Inconsistent spacing and alignment between sections and panels; a members table wider than its panel and clipped.
- The compact density reduces padding and text slightly and is otherwise the same layout.
- Plain-sentence empty states, and long single-column dialogues.

### The product owner's direction
Shown the current panels on 2026-10-16, the product owner wrote: "Nothing is consistent; it looks extremely basic and plain; it doesn't look like a modern web application; there are no flashy visual effects and animations; too much walls of text; there are no icons. It should use the latest modern design styles and elements and use genuinely well designed UI controls/primitives. This just looks like a mess of random controls."

`REQ-UX-221` turns that direction into checkable items: one control set every surface is built from, one panel composition, an icon set, stated visual effects, and a text-economy rule that keeps every reason, accessible name and announcement reachable. `REQ-UX-222` adds animated feedback at the full motion level. The product owner's sign-off judges whether the result meets the direction.

### Placement and number
Phase 16 is the next phase, and it is numbered 16:

- **Before Phase 14.** Phase 14 audits accessibility, compatibility and performance across the browser and device matrix. Run after the redesign, it measures the final interface. Run before, its accessibility, contrast and interaction evidence would describe surfaces that Phase 16 then replaces.
- **Next, before Phases 11, 12 and 13.** Phase 16 depends on Phases 01 to 10, all `PASS`, so it could become `READY`; the maintainer waived its readiness review. Phases 11, 12 and 13 now depend on it, at the product owner's direction on 2026-10-16 ("move the UI redesign to the very next phase"). Every web surface those phases add is therefore built in the design language from the start, with its own reference, sign-off and screenshot comparison, rather than built in the old style and redesigned. The cost is that Godot integration, offline hardening and batch workflows wait for the redesign.
- **Number 16, not 11 with the later phases renumbered.** The tooling (`tools/spec_lint.py`, `tools/spec_status.py`, `traceability/phase-dependency-graph.json`, `implementation-ledger.json`, `tools/spec_manifest.json`) keys every phase by an integer and supports no inserted number such as "13a". Renumbering Phases 11 to 15 would change identifiers that accepted records cite: `CHG-0001`, the handoffs, the review and evidence records of Phases 01 to 10, and the ADRs that assign work to "Phase 14". Those records are past-tense and are not rewritten. The dependency graph, which `traceability/phase-dependency-graph.md` already states is normative ("Markdown file order is not execution order"), gives the order. Two tools assumed exactly sixteen phases: `tools/build_phase_contexts.py` (`range(16)`) and `tools/verify_hardening.py` (a count of 16). Both now take the phases from the ledger, and `verify_hardening.py` checks that the packets on disk are the ledger's.

### Reference applications
The packet's design language takes its principles from the conventions of professional audio tools (Ableton Live 12, iZotope RX 11, Adobe Audition, Reaper, FL Studio, Bitwig Studio 5) and of web applications known for their chrome (Figma's UI3, Linear). It copies none of them. The principles, from their published documentation and design write-ups:

- **Layout.** One central editing surface that cannot be hidden, a browser on one side, an inspector that follows the selection, transport and status at the edges, and panels that resize, collapse and dock (Bitwig, Ableton, Figma UI3).
- **Panel chrome.** Surfaces separate panels; lines do not. On a dark theme, elevation is a step in lightness, not a shadow, and separators are few and quiet (Linear's 2024 and 2026 redesigns, which generate a theme in LCH from a base, an accent and a contrast value, as `ADR-0012` does in OKLCH).
- **Typography.** A small, dense UI size with a clear hierarchy, one UI family, and tabular figures for every time, level and frequency readout so that digits do not move as values change.
- **Iconography.** One stroke-drawn set on one grid, at one stroke weight, with an icon beside or in place of a label only where its meaning is conventional (transport, tools).
- **Waveform and spectrogram.** A peak envelope with a lighter RMS band inside it, a centre line, clipping marked in its own colour, and a selection drawn as a fill over the audio (Audacity, Audition). Spectrogram colour maps whose lightness only rises, so that level reads correctly in any hue (iZotope RX's maps, Matplotlib's and Kovesi's perceptual maps), with an adjustable dynamic range and frequency scale.
- **Meters.** Peak and RMS together, coloured segments by level band, a peak hold, stated ballistics (EBU PPM: 80 % in 10 ms, a 24 dB fall in 2.8 s; VU: 300 ms), and loudness by EBU Tech 3341 (momentary 0.4 s, short-term 3 s, integrated, on the EBU +9 scale by default). A meter is data, so it is not slowed by a motion level.
- **Colour on dark themes.** Neutral, slightly warm or cool greys above black, an accent used sparingly for the current tool, focus and the primary action, and semantic colours reserved: red for clipping, error and recording only.
- **Motion.** Short durations on a fixed scale (IBM Carbon's 70 to 700 ms, with a "productive" curve for task work), motion that shows where a thing went, and nothing that delays a hand on a control.
- **Focus and selection.** Focus is an outline at least 2 px around the control at 3:1 contrast (WCAG 2.2, 2.4.13); selection is a fill; an inactive selection stays visible (VS Code separates focus, active selection, inactive selection and hover).

Many of AudioGubbins' tokens already follow these principles: OKLCH surfaces, a 3 px focus ring, motion durations by level, a spectrogram ramp whose lightness only rises, and waveform and meter palettes. What is missing is the language that uses them, and the surfaces built to it.

**Icons and fonts.** The research recommends Lucide (`lucide-react`, ISC with MIT for its Feather-derived icons, both on the allow-list in `tools/sync-third-party-notices.mjs`) for icons, and Inter and JetBrains Mono (OFL-1.1, with no Reserved Font Name) for UI text and numeric readouts, all self-hosted. OFL-1.1 is not on the allow-list today, so a font under it needs an ADR, as `ADR-0091` decided MPL-2.0, before the allow-list changes. Remix Icon is unsuitable: its manifest states Apache-2.0, and the licence it ships is a custom one. Phase 16 makes the final choice under these rules (packet, WU-16.A).

## Affected Requirement IDs
- `REQ-UX-005` — clause 5.1 added
- `REQ-UX-069` — clause 69.1 added
- `REQ-UX-070` — clause 70.1 added
- `REQ-UX-071` — clause 71.1 added
- `REQ-UX-155` — clause 155.1 added
- `REQ-UX-221` — new, owned by Phase 16
- `REQ-UX-222` — new, owned by Phase 16
- `REQ-UX-057`, `REQ-UX-060`, `REQ-UX-066`, `REQ-UX-067`, `REQ-EDIT-072`, `REQ-EDIT-073`, `REQ-EDIT-012`, `REQ-AUDIO-016` — unchanged; their behaviour is kept while their surfaces are redesigned

## Affected Phases
- Phase 01 (passed): its evidence verified the structure of `REQ-UX-005`, `REQ-UX-069`, `REQ-UX-070`, `REQ-UX-071` and `REQ-UX-155`, and not their visual outcome. See remediation below.
- Phases 02 to 10 (passed): their panels and dialogues are redesigned by Phase 16. Their behaviour, commands and tests are unchanged.
- Phases 11, 12 and 13: each depends on Phase 16, and gains one invariant and the Visual Design lens for the web surfaces it adds.
- Phase 14: depends on Phase 16, and gains an in-scope item, an acceptance criterion and the Visual Design lens for a remediation that changes a surface's appearance.
- Phase 16: new.

## Compatibility Impact
- Project/schema: none. No project document, project storage or stored layout changes. A user preference the language may need follows the preferences schema's change policy.
- Processor/render: none to audio. The editor's frames draw with new palettes read from tokens.
- Public API: the design system's token contract grows; `Icon`, the audio presentation palettes and `MotionSpec` are added (packet, Required Public Contracts).
- Godot interchange/runtime: none.
- PWA/browser: fonts and icons are self-hosted and cached offline; no third-party host is contacted.

## Already-Passed Phase Remediation
- Phase 01 stays `PASS`. Its claims for the structure of the five requirements stand, and each test its evidence names stays. Its claim for `REQ-UX-005` covered "keyboard-first shell, named landmarks, visible focus, touch targets", which clause 5.1 now states does not verify the visual sentence. Phase 16's evidence records the visual outcome against clauses 5.1, 69.1, 70.1, 71.1 and 155.1. Phase 01's evidence is a past record and is not rewritten.
- Phases 02 to 10 stay `PASS`. Their end-to-end suites must still pass after the redesign (Phase 16 acceptance).

## Verification Changes
- New verification families: `DESIGN-SIGNOFF`, `VISUAL-E2E`, `MOTION-E2E`, `INTERACTION-LATENCY`, with `APP-ARCH` (`traceability/verification-catalogue.md`).
- New suites in Phase 16: `pnpm test:e2e:visual` (screenshot comparison of every surface and component state against signed-off baselines, in a pinned environment) and `pnpm test:e2e:motion` (motion read from the browser at each level).
- An architecture check that refuses a literal colour, length, duration or shadow in a component's styles (`REQ-UX-155` clause 155.1).
- An editing-latency measurement before and after the redesign.
- The Visual Design lens: the maintainer's sign-off, recorded per surface, not deferred.

## Open Items Carried Forward
- Q7 from Phase 10 stays open for the maintainer: a looping region with an effect rack restarts the rack once per cycle. A wrapped render would fix it and changes `ADR-0060`. This change does not act on it.

## Decision
- Approved/rejected by: approved by the maintainer on 2026-10-16, with Phase 16's readiness review waived.
- ADR/change references: `ADR-0014` amended; `ADR-0009`, `ADR-0010`, `ADR-0012` and `ADR-0013` stand and constrain Phase 16.
