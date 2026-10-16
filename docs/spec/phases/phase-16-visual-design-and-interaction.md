# Phase 16 — Visual Design and Interaction

## Status

`READY` — its hard dependencies (Phases 01 to 10) have passed, and the maintainer waived its readiness review when approving `CHG-0002` on 2026-10-16. Added by the specification change `CHG-0002` (`traceability/changes/CHG-0002-visual-design-phase.md`). Its number names it and does not order it: Phases 11, 12, 13 and 14 depend on it, so it is the next phase, every later surface is built in its design language, and the hardening phases measure the interface it delivers.

## Objective

Give AudioGubbins a written visual design language and a motion system, and redesign the shell and every existing panel and dialogue against them, so that `REQ-UX-005`'s "modern, sleek, visually rich multimedia application" is met and verified by the product owner's sign-off and by automated screenshot comparison, not inferred from the token architecture.

## User-Visible Outcome

AudioGubbins looks and moves like a professional audio tool: a calm dark workspace whose panels, tabs, toolbars and dialogues share one chrome, one type scale, one icon set and one spacing rhythm; a waveform, spectrogram and meters drawn as their own presentation rather than as form controls; clear selection and keyboard focus; and transitions that help the eye follow a change without ever delaying a hand on a control. The light theme and the compact density are designed layouts, not afterthoughts.

## Hard Dependencies

- Phase 01 — Application Foundation
- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 04 — Waveform and Timeline Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP
- Phase 07 — Recording
- Phase 08 — Spectral Editing
- Phase 09 — Import, Export, and Codec System
- Phase 10 — Game-Audio Tooling

## Owned Requirements

- `REQ-UX-221` — Visual Design Language and Verified Visual Quality (`CURRENT`)
- `REQ-UX-222` — Motion System and Shell Animation (`CURRENT`)

Constraint requirements, owned by Phase 01, whose `CHG-0002` verification clauses this phase satisfies:

- `REQ-UX-005` — User Experience Goals, clause 5.1
- `REQ-UX-069` — Motion and Animation, clause 69.1
- `REQ-UX-070` — Theme System, clause 70.1
- `REQ-UX-071` — Information Density and UI Customisation, clause 71.1
- `REQ-UX-155` — Styling and Design-System Architecture, clause 155.1

Requirements whose behaviour this phase must keep while it changes their appearance: `REQ-UX-057`, `REQ-UX-060`, `REQ-UX-066`, `REQ-UX-067`, `REQ-EDIT-072`, `REQ-EDIT-073`, `REQ-EDIT-012`, `REQ-AUDIO-016`.

## Referenced Global Execution Requirements

- `REQ-EXEC-136`
- `REQ-EXEC-167`
- `REQ-EXEC-170`
- `REQ-EXEC-171`
- `REQ-EXEC-172`
- `REQ-EXEC-173`
- `REQ-EXEC-174`
- `REQ-EXEC-180`
- `REQ-EXEC-181`
- `REQ-EXEC-183`
- `REQ-EXEC-184`
- `REQ-EXEC-204`
- `REQ-EXEC-215`
- `REQ-EXEC-216`

## In Scope

- [ ] A written design language (`REQ-UX-221`): layout grid, type scale, spacing and radius scales, one licensed icon set, colour use within the `ADR-0012` tokens, elevation and panel chrome, focus and selection styling, the presentation of waveform, spectrogram, meters, ruler, markers and regions, and empty, loading and error states
- [ ] The control set, the panel composition patterns, the visual effects and the text-economy rule of `REQ-UX-221`, which answer the product owner's direction recorded in `CHG-0002`: consistent, modern, well-designed controls, icons, visual effects and animation, and no walls of text
- [ ] A motion system (`REQ-UX-222`), including the shell animation `ADR-0014` deferred, at the full, reduced and off levels and under `prefers-reduced-motion`
- [ ] The token system extended to every value the language states (`REQ-UX-155` clause 155.1), for both themes and both densities
- [ ] A component inventory: every shared component in `packages/design-system`, and every shared component this phase adds, in every state it has (default, hover, focus-visible, active, pressed, disabled, error, loading), at both densities and in both themes
- [ ] Mock-ups or variants of every surface, approved by the product owner before that surface is built, recorded as its visual reference
- [ ] A redesign of the shell: menu bar, toolbars and transport, status bar, dock chrome and tabs, command palette, context menus, popovers, notices, settings and the narrow-viewport message of `REQ-UX-057` clause 57.1
- [ ] A redesign of every existing panel: Assets, Editor (waveform, ruler, selection, markers, regions, video reference), Inspector, History, Effect rack (with its meters and controls), Library, Recording (with its meters and take lanes), Spectral, Export, Asset groups, Loop, Game preview, Capabilities and Diagnostics
- [ ] A redesign of every existing dialogue: the guided workflows, project open and save, import, export, the effect editors, recovery and the confirmations
- [ ] An automated screenshot comparison of every surface and every component state against its signed-off rendering, in each theme and density
- [ ] Automated motion checks at each motion level, read from the browser
- [ ] An editing-latency measurement before and after the redesign
- [ ] The product owner's design-review sign-off of every surface (`contracts/review-gates.md`, Visual Design)

## Explicitly Out of Scope

- New editing, audio or game-audio behaviour: this phase changes appearance, presentation and motion only
- A change to the semantics of the command layer, the workspace layout model or the stored workspace format (`ADR-0010`, `ADR-0013`)
- Responsive narrow-viewport workspaces and phone layouts (`REQ-UX-029`, Phase 14)
- The matrix of browsers, operating systems and devices (Phase 14); this phase compares screenshots in one pinned Chromium environment
- User-authored custom themes; the token system keeps them possible (`REQ-UX-070`)
- Surfaces Phases 11, 12 and 13 add: they run after this phase and deliver them to this language (`CHG-0002`)
- The open Phase 10 question Q7 (a looping region with an effect rack restarts the rack once per cycle, and a wrapped render changes `ADR-0060`), which stays with the product owner

## Owned Modules / Packages

- `packages/design-system` — the tokens, the type, spacing, radius, elevation and motion scales, the icon component over the chosen set, the shared primitives and their states, and the design language's reference document
- `apps/web` — the shell and every panel and dialogue, restyled through the design system
- `packages/workspace` — the dock chrome and its transitions, through the Dockview adapter alone (`ADR-0010`)
- `packages/editor-view` and `packages/renderer` — the presentation palettes and drawing styles of waveform, spectrogram, ruler, markers, regions and selection in the frames the editor draws, read from tokens; no change to the peak pyramid (`packages/waveform`) or the spectrogram tiles (`packages/spectral-analysis`)
- `tests/e2e/visual` — the screenshot comparison suite, its signed-off baselines and the component-inventory harness page
- `tests/e2e/motion` — the motion checks
- `tests/architecture` — the rule that refuses a literal value in a component's styles (`REQ-UX-155` clause 155.1)
- `docs/design` — the design language, the approved references and the sign-off record

## Cross-Package Dependency Rules

- The icon set and any font are reached only through `@audiogubbins/design-system`, as Radix is (`ADR-0009`). No feature imports an icon package or a font file.
- A panel takes every colour, size, radius, shadow, duration and easing from a token. A canvas renderer (waveform, spectrogram, meters) reads the resolved token values through the design system, never a literal.
- The design system depends on no domain package. A presentation component that needs domain knowledge (a meter's scale, a waveform's channel layout) receives it as plain values from the panel that owns it.
- The docking engine's appearance changes only through the workspace adapter and the engine's own theming hooks (`ADR-0010`).
- The UI still changes authoritative project state only through typed commands (`REQ-EDIT-073`, `ADR-0013`); a redesign that moves a control keeps it a view onto the same command.

## Required Public Contracts

- `DesignLanguage` — the written language in `docs/design/design-language.md`, with each value named by the token that carries it
- Extended token contract: grid unit, type roles, spacing, radius, elevation and shadow, icon size and stroke, focus and selection indicators, and motion durations and easings per level, as CSS custom properties and typed scales
- `Icon` — one design-system component over the icon set, naming icons by AudioGubbins' own vocabulary; glyphs the set lacks (fades, knob, meter, spectrogram) are drawn to the set's own grid and stroke rules
- An ADR for the icon set and the fonts, with their licences, and for OFL-1.1 if a font needs it
- Audio presentation palettes — waveform, spectrogram, meter, selection, marker, region and analysis-overlay roles per theme, derived through `ADR-0012`
- `MotionSpec` — each kind of motion of `REQ-UX-069` with its properties, duration, easing and behaviour at each level
- Visual reference record — for each surface and component, the approved mock-up, the signed-off rendering, the date and the decision

## Data / Schema Changes

- None to the project document or project storage.
- The user preferences keep their theme, density, accent, brightness, contrast and motion settings. A new preference, if the language needs one, follows the preferences schema's change policy and is versioned.

## Browser / Platform Considerations

- Every font is self-hosted with the application and cached for offline use (`REQ-PWA-031`); none is fetched from a third-party host, and none relies on a font the operating system may lack.
- Screenshot baselines are captured in one pinned environment (one Chromium build, one operating system image, the vendored fonts, a fixed viewport and device pixel ratio, deterministic fixtures, motion off), stated in the suite. A comparison on another platform is Phase 14's.
- Motion is read from the browser (`getAnimations()`, computed transition values), and the levels reach the docking engine's own animation.
- Forced-colours mode and high contrast keep working: the language states their appearance, and the existing checks stand.

## Architectural Invariants

- One design language, one icon set, one type scale: no surface keeps a private style.
- Every visual value is a token; a literal in a component's styles fails the architecture check unless the check names the exception and its reason.
- Contrast is computed by the token system, never chosen (`ADR-0012`).
- Motion never delays input: direct manipulation follows the pointer in the next frame, and a meter shows the engine's level with its own ballistics.
- The redesign changes no command, no stored layout format and no project data.
- Keyboard operation and visible focus hold on every surface.
- A surface is built only from an approved reference, and accepted only with the product owner's sign-off.
- Every panel follows the panel composition and is built from the control set; a control the set lacks is added to the set, not built in the panel.
- Text economy never removes an accessible name, an unavailable command's reason (`ADR-0013`) or an announcement; each moves to a hint, a popover or the live region.

## Internal Work Units

Each unit owns the files it names. Units B to E start only after WU-16.A's language and the references for their surfaces are approved. Units C, D and E may run in parallel in separate worktrees once WU-16.B has merged.

### WU-16.A — Design language, references and approvals

Owns `docs/design/`.

- [ ] Study the reference applications (`CHG-0002` summarises the principles) and write the design language of `REQ-UX-221` and the motion system of `REQ-UX-222`
- [ ] Choose the icon set and the fonts, checked against the repository's licence and dependency rules (`REQ-REPO-033`, `REQ-REPO-142`), and record the choice and licences in `THIRD-PARTY-NOTICES.md` through its tool. `CHG-0002` records the research's recommendation (Lucide; Inter and JetBrains Mono). OFL-1.1 is not on the allow-list of `tools/sync-third-party-notices.mjs`: a font under it needs an ADR that decides the licence, as `ADR-0091` decided MPL-2.0, before the allow-list changes. A package whose shipped licence differs from its manifest's is refused
- [ ] Present variants of the language (palette roles, chrome, type, density) to the product owner and record the choice
- [ ] Present mock-ups of the shell and of every panel and dialogue in both themes and both densities, and record the approved references with the date and decision
- [ ] Record the editing-latency baseline before any change (WU-16.F)

### WU-16.B — Tokens, icons and the component inventory

Owns `packages/design-system/src` and `tests/e2e/visual/inventory`.

- [ ] Extend the tokens and scales to every value of the language, for both themes and both densities
- [ ] Add the `Icon` component over the chosen icon set, and replace every existing glyph or text stand-in
- [ ] Bring every shared component to the language in every state, and add the shared components the redesign needs (for example a panel header, a meter, a transport button, a segmented control, a knob, an empty state)
- [ ] Build the inventory harness page that renders every component in every state, theme and density
- [ ] Add the architecture check of `REQ-UX-155` clause 155.1

### WU-16.C — Shell and motion

Owns `apps/web/src/shell`, the workspace adapter's chrome and `tests/e2e/motion`.

- [ ] Redesign the menu bar, toolbars, transport, status bar, dock chrome and tabs, command palette, context menus, popovers, notices and settings to their references
- [ ] Build the motion system and the shell animation; decide CSS or a library and record it against `ADR-0014`
- [ ] Verify each kind of motion at each level in the browser

### WU-16.D — Editing panels

Owns the Assets, Editor, Inspector, History, Spectral and Recording panels and the waveform and spectrogram presentation.

- [ ] Redesign each panel and its audio presentation to its references, keeping every behaviour and test of Phases 04 to 08

### WU-16.E — Processing, export and game-audio panels and dialogues

Owns the Effect rack, Library, Export, Asset groups, Loop, Game preview, Capabilities and Diagnostics panels and every dialogue.

- [ ] Redesign each panel and dialogue to its references, keeping every behaviour and test of Phases 06, 09 and 10

### WU-16.F — Verification and sign-off

Owns `tests/e2e/visual` (outside the inventory) and the evidence.

- [ ] Build the screenshot comparison of every surface in each theme and density, with its pinned environment
- [ ] Present each rendered surface beside its reference for the product owner's sign-off, fix what is returned, and commit the signed-off baselines
- [ ] Measure editing latency against the WU-16.A baseline
- [ ] Assemble the evidence and the handoff

## Failure and Recovery Behaviour

- A font that fails to load falls back to a stated fallback stack with the same metrics class, and the layout does not shift beyond the type scale's tolerance; the fallback is tested.
- An icon name with no glyph is a type error, not a blank square at runtime.
- A motion level that cannot reach a third-party animation disables that animation rather than leaving it at full motion.
- A canvas presentation whose token cannot be resolved draws with the theme's default role and logs a structured record, never with a hard-coded colour.

## Required Verification Commands / Suites

- `pnpm run verify:commit`
- `pnpm test:architecture`
- `pnpm test --filter design-system`
- `pnpm test:e2e:visual` — the screenshot comparison, new in this phase
- `pnpm test:e2e:motion` — the motion checks, new in this phase
- `pnpm test:e2e:accessibility`
- `pnpm test:e2e:smoke`, and the end-to-end suites of Phases 04 to 10 for the panels this phase changes
- The editing-latency measurement of WU-16.F, before and after
- `pnpm run spec:verify`

## Acceptance Criteria

- [ ] `docs/design/design-language.md` states every item `REQ-UX-221` lists, and each value it states is carried by a named token.
- [ ] Every surface has an approved mock-up recorded before it was built, and a design-review sign-off by the product owner of its rendering in the dark and light themes at the comfortable and compact densities.
- [ ] The screenshot comparison covers every surface and every component state in each theme and density, passes against the signed-off baselines, and fails for a one-token change to a surface (proved by a deliberate change).
- [ ] Every shared component renders every state it has, in both themes and both densities, in the inventory harness.
- [ ] Every panel follows the panel composition and uses only controls of the set; an architecture or component check finds no panel-local control that duplicates one of the set.
- [ ] No panel shows an explanation as standing text where the text-economy rule moves it to a hint, popover, empty state or disclosure, and every reason, name and announcement is still reachable (tested).
- [ ] At the full motion level, each effect and animated feedback the motion system states is present, read from the browser; at the reduced and off levels each becomes what it states.
- [ ] One icon set, under a licence the repository accepts, draws every icon; no component draws its own.
- [ ] The architecture check refuses a literal colour, length, duration or shadow in a component's styles, and lists each allowed exception with its reason.
- [ ] Each kind of motion of `REQ-UX-069` behaves as `MotionSpec` states at the full, reduced and off levels, read from the browser; `prefers-reduced-motion` selects reduced until the user chooses; the docking engine follows the level.
- [ ] Contrast holds across the whole theme, accent, brightness and contrast matrix of `ADR-0012` with the new tokens, and the axe checks pass on every redesigned surface.
- [ ] Every control stays keyboard-operable, and keyboard focus is visible on every surface in every theme and density.
- [ ] Editing latency (pointer to paint for a selection drag, a zoom and a fader drag; key to paint for the command palette) shows no regression beyond the measurement's stated statistical tolerance against the WU-16.A baseline (`REQ-REPO-189`).
- [ ] Every end-to-end suite of Phases 01 to 10 still passes; no test was weakened to reach green.
- [ ] No command, stored layout format or project data changed.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No surface built before its reference is approved, and no surface accepted without the product owner's sign-off; an agent may not sign off for the product owner.
- No baseline captured from the implementation and committed as the reference without that sign-off.
- No screenshot tolerance widened, no region masked and no surface left out of the comparison to make it pass; a mask for a genuinely varying region (a live meter, a clock) states its reason.
- No literal colour, size, radius, shadow or duration in a component's styles, and no per-component theme override.
- No second icon set, no icon drawn ad hoc, no font fetched from a third-party host.
- No global CSS filter or opacity over the application to make a theme or a density (`REQ-UX-070`).
- No animation on direct manipulation, and no motion that ignores the motion level.
- No restyling of the docking engine outside the workspace adapter.
- No removal or hiding of a control to make a surface look simpler; advanced controls use progressive disclosure (`REQ-UX-071`).
- No visual effect that costs editing latency or ignores the motion level, and no effect used in place of the design language's consistency.
- No shortening of text that drops a reason, an accessible name or an announcement.

## Required Review Lenses

- Visual Design — the product owner's sign-off, required and not deferred (`contracts/review-gates.md`)
- UX / Accessibility / Input
- Architecture
- Code Quality / Maintainability
- Testing / Regression
- Performance / Scalability
- Adversarial Agent-Quality

The product owner deferred the lens and adversarial reviews of each phase to the review after the whole specification is implemented. That decision covers the lenses above except Visual Design, whose sign-off this phase needs to pass.

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement, and for each `CHG-0002` clause of `REQ-UX-005`, `REQ-UX-069`, `REQ-UX-070`, `REQ-UX-071` and `REQ-UX-155`.
- The design language, the approved references and the sign-off record, each with its date and decision.
- Screenshot comparison, motion, accessibility, architecture and latency reports.
- The icon and font licences, and the `THIRD-PARTY-NOTICES.md` entries.
- ADRs created or changed, including the outcome against `ADR-0014`.
- Verified review findings, remediation commits, and re-review disposition.

## Handoff Capsule

Create `traceability/handoffs/phase-16.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
