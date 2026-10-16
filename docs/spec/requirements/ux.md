# UX, Workspace, Touch, Theme, and Accessibility Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-UX-005` — User Experience Goals — owner Phase 01 — scope `CURRENT`
- `REQ-UX-029` — Mobile and Touch — owner Phase 14 — scope `CURRENT`
- `REQ-UX-057` — Dockable Workspace System — owner Phase 01 — scope `CURRENT`
- `REQ-UX-058` — Workspace Presets — owner Phase 01 — scope `CURRENT`
- `REQ-UX-059` — Workspace State Persistence — owner Phase 01 — scope `CURRENT`
- `REQ-UX-060` — Asset Browser and Editor Tabs — owner Phase 01 — scope `CURRENT`
- `REQ-UX-066` — Shortcut System — owner Phase 01 — scope `CURRENT`
- `REQ-UX-067` — Touch and Gesture Model — owner Phase 01 — scope `CURRENT`
- `REQ-UX-068` — Stylus and Pressure Input — owner Phase 01 — scope `CURRENT`
- `REQ-UX-069` — Motion and Animation — owner Phase 01 — scope `CURRENT`
- `REQ-UX-070` — Theme System — owner Phase 01 — scope `CURRENT`
- `REQ-UX-071` — Information Density and UI Customisation — owner Phase 01 — scope `CURRENT`
- `REQ-UX-155` — Styling and Design-System Architecture — owner Phase 01 — scope `CURRENT`
- `REQ-UX-221` — Visual Design Language and Verified Visual Quality — owner Phase 16 — scope `CURRENT`
- `REQ-UX-222` — Motion System and Shell Animation — owner Phase 16 — scope `CURRENT`

---

## REQ-UX-005 — User Experience Goals

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 5 of the pre-hardening baseline

The application shall behave as a modern, sleek, visually rich multimedia application rather than a conventional form-based web application.

The UX should support:

- Mouse
- Keyboard
- Touch
- Pen/stylus where available
- Hybrid devices
- Surface-class devices
- Desktop
- Laptop
- Tablet
- Mobile

The interface should support professional desktop-style interaction patterns where appropriate, including:

- Menu systems
- Toolbars
- Context menus
- Dockable or resizable panels
- Drag and drop
- Keyboard shortcuts
- Command palette
- Status and transport controls
- Timeline interactions
- Touch-friendly controls
- Responsive layout adaptation
- Smooth animations and transitions

Accessibility must remain a first-class requirement.

Highly visual editing modes may use specialised interactions, but keyboard-operable and semantic alternatives should be provided wherever realistically possible.

#### 5.1 Verifying the Visual Goal

The first sentence of this requirement is a visual outcome, and it shall be verified as one. Evidence that the shell is keyboard-first, names its landmarks, shows focus and sizes its touch targets verifies the rest of this block and does not verify that sentence.

The sentence is verified when `REQ-UX-221` is: every surface follows the written design language, matches the reference the product owner approved, and is signed off by the product owner in the design review, in both themes and both densities. "Smooth animations and transitions" is verified by `REQ-UX-222`.

Phase 01's evidence verified the structure of this block (`CHG-0002`). Until Phase 16 passes, the visual outcome is unmet, and no evidence package may claim it.

---

## REQ-UX-029 — Mobile and Touch

- **Owner:** Phase 14 — Performance, Compatibility, and Accessibility Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 29 of the pre-hardening baseline

Mobile, tablet, touch, and hybrid devices are first-class targets.

The application should support:

- Phones where practical
- Tablets
- Touchscreen laptops
- Microsoft Surface-class devices
- Pointer + touch hybrid interaction
- Responsive workspace layouts
- Touch-friendly controls
- Gesture-based editing where beneficial

The application should not simply shrink a desktop interface onto small screens.

Responsive layouts may adapt the workspace while preserving functionality.

---

## REQ-UX-057 — Dockable Workspace System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 57 of the pre-hardening baseline

On desktop, laptop, tablet, and sufficiently large hybrid-device layouts, AudioGubbins shall provide a full professional docking system.

Panels should support, where appropriate:

- Docking to workspace edges
- Reordering
- Resizing
- Tab grouping
- Collapsing
- Hiding/showing
- Moving between dock regions
- Floating within the application workspace where practical
- Restoring default layouts
- Saving user-defined workspace layouts

Touch layouts may impose adaptive constraints where unrestricted docking would harm usability, but the underlying workspace model must remain consistent.

The docking system must be treated as core application infrastructure rather than implemented independently by individual panels.

#### 57.1 The Width a Docking Layout Needs

"Sufficiently large" shall be a stated number rather than a judgement.

AudioGubbins shall declare the smallest viewport width at which it draws a docking workspace, and that width shall be `640` CSS pixels. Three docked columns at the declared minimum of a panel, with the splitters between them, do not fit in less.

Below that width AudioGubbins shall show, in place of the workspace, a message that names the width it needs and what the reader can do about it. It shall not draw a docking layout that clips its panels or scrolls in two directions.

The menus, the command palette, the settings and the status bar shall keep working below that width, so a reader who arrives there can still reach every command.

A workspace that adapts to a narrow viewport, rather than declining to draw one, is `REQ-UX-029`'s responsive workspace layout and is owned with it. Until that exists, AudioGubbins does not meet WCAG 2.2 success criterion 1.4.10 Reflow below the declared width, and its conformance claim shall say so.

Declaring a width rather than reflowing is the product owner's decision, taken during Phase 01 and recorded here so that a reader of the review record can see whose it was. It is not a review remediation's to take: the alternative is `REQ-UX-029`, which is a phase of work rather than a clause.

---

## REQ-UX-058 — Workspace Presets

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 58 of the pre-hardening baseline

AudioGubbins shall provide built-in workspace presets targeted at common tasks.

Initial or planned presets should include:

- Editing
- Spectral Repair
- Recording
- Game Audio
- Batch Processing
- Future Multitrack

Users shall be able to:

- Create custom workspaces
- Save current layouts
- Duplicate layouts
- Rename layouts
- Reset built-in layouts
- Delete user-created layouts
- Switch rapidly between layouts

Workspace switching must not alter authoritative project audio state.

---

## REQ-UX-059 — Workspace State Persistence

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 59 of the pre-hardening baseline

Workspace and UI state should support both:

- Global user defaults
- Optional per-project overrides

Persistable state may include:

- Dock layout
- Panel visibility
- Panel sizes
- Toolbar configuration
- Favourite commands
- Recent tools
- Zoom/display preferences
- Inspector state
- Workspace preset
- Editor view configuration

Per-project workspace data must be clearly separable from project audio/editing data so that UI preferences cannot corrupt the authoritative project model.

---

## REQ-UX-060 — Asset Browser and Editor Tabs

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 60 of the pre-hardening baseline

AudioGubbins shall support both:

- A project asset browser
- Multiple document-style editor tabs

The user should be able to keep several assets and/or several views open simultaneously.

Tab management should support professional workflows, including:

- Reordering
- Closing
- Reopening recently closed views where practical
- Pinning where beneficial
- Clear indication of the asset/view represented
- Preservation of independent view state

---

## REQ-UX-066 — Shortcut System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 66 of the pre-hardening baseline

AudioGubbins shall ship with a strong, coherent default keyboard shortcut profile.

Users must be able to fully remap shortcuts.

The shortcut architecture should support:

- Single-key shortcuts where appropriate
- Modifier combinations
- Multi-key chords
- Named shortcut profiles
- Import/export of profiles
- Reset to defaults
- Conflict detection
- Search
- Platform-specific representation
- Display of active shortcuts in menus and command search

Browser or operating-system-reserved shortcuts must be handled deliberately.

Where familiar professional desktop-editor conventions can be used safely, prefer them over inventing arbitrary mappings.

Alternative mappings must be provided when browser/OS interception makes a preferred shortcut unavailable.

---

## REQ-UX-067 — Touch and Gesture Model

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 67 of the pre-hardening baseline

Within editing canvases, the preferred default gesture model is:

- One finger: active primary editing tool
- Two fingers: pan/navigation
- Pinch: zoom
- Stylus/pen: precision primary input
- Long press: context action

Gesture behaviour should be configurable where beneficial.

Normal non-editor UI areas should retain conventional touch scrolling and controls.

The application must distinguish editing gestures from page/browser gestures carefully to avoid accidental browser navigation, zoom, or scrolling during editing.

---

## REQ-UX-068 — Stylus and Pressure Input

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 68 of the pre-hardening baseline

Stylus input should be first-class where browser/hardware capabilities permit.

Pressure-sensitive behaviour may be used for appropriate tools such as spectral painting/repair.

Pressure must be optional.

Users must be able to use deterministic fixed-strength behaviour regardless of pressure-capable hardware.

Hardware-specific expressive controls must never become a requirement for accessing an editing capability.

---

## REQ-UX-069 — Motion and Animation

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 69 of the pre-hardening baseline

The default visual experience should use the full intended animation richness.

Animation must remain functional, polished, and responsive rather than decorative at the expense of editing latency.

Appropriate animation may include:

- Dock/panel transitions
- Menu/context transitions
- Zoom transitions
- Drag/drop targets
- Meter movement
- Selection feedback
- Processor state changes
- Loading/progress transitions
- Workspace transitions

Direct manipulation of audio-editing controls must feel immediate.

Users shall be able to choose an animation/motion level.

At minimum the system should support:

- Full
- Reduced/subtle
- Minimal/off where practical

The application must also respect the operating system/browser `prefers-reduced-motion` preference, while allowing an explicit user override where accessibility guidance permits.

#### 69.1 Verifying Motion

The kinds of motion listed above shall be designed as one motion system and verified at each motion level in a real browser, as `REQ-UX-222` states. A test that the motion preference is stored and honoured verifies the levels' plumbing and does not verify that anything moves well, or that "the full intended animation richness" exists.

The shell animation `ADR-0014` deferred is part of this requirement and is delivered under `REQ-UX-222` (`CHG-0002`).

---

## REQ-UX-070 — Theme System

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 70 of the pre-hardening baseline

Dark mode shall be the default visual theme.

AudioGubbins shall also support:

- Light mode
- System/automatic mode
- Accent-colour selection
- User-adjustable theme brightness/intensity
- Independent semantic palettes for waveform, spectrogram, selections, meters, markers, and analysis overlays

Theme brightness must not be implemented as a simple visual filter over the whole application.

Instead, the design system should expose semantic colour and luminance tokens so that contrast, accessibility, readability, and component hierarchy remain correct across the user-selectable brightness range.

The theme engine should be designed to permit future custom themes without requiring component-specific hard-coded colour overrides.

#### 70.1 Verifying a Theme by Its Appearance

Each theme shall be verified by its rendered appearance as well as by its computed contrast. Every surface shall have an approved visual reference in the dark theme and in the light theme, and the screenshot comparison of `REQ-UX-221` shall hold each to it.

The independent semantic palettes this block lists (waveform, spectrogram, selections, meters, markers and analysis overlays) shall be designed as part of the design language of `REQ-UX-221`, stated per theme, and derived through the tokens of `ADR-0012`, so their contrast against the surface beneath them is computed rather than chosen.

---

## REQ-UX-071 — Information Density and UI Customisation

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 71 of the pre-hardening baseline

The application must support multiple information-density preferences rather than forcing one compromise layout.

Users should be able to configure, where appropriate:

- Comfortable/approachable density
- Compact/high-density workspace
- Toolbar visibility
- Toolbar composition
- Panel layout
- Control sizing
- Inspector density
- Timeline ruler detail
- Meter detail
- Status information

Advanced controls should use progressive disclosure rather than being removed from approachable layouts.

#### 71.1 Verifying Each Density by Its Appearance

Each density shall be a designed layout, not the other scaled. Every surface shall have an approved visual reference at the comfortable density and at the compact density, and the screenshot comparison of `REQ-UX-221` shall hold each to it. The touch target stays the same size at both densities, as Phase 01 verified.

---

## REQ-UX-155 — Styling and Design-System Architecture

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 155 of the pre-hardening baseline

AudioGubbins shall own a semantic design-token system rather than scattering literal colours, spacing values, radii, typography, motion settings, or density assumptions throughout components.

The styling architecture shall support:

- Dark/light/system themes
- User-selected accent colours
- Continuous or stepped theme-brightness controls
- Semantic contrast constraints
- Waveform/spectrogram palettes independent from chrome theme
- Comfortable and compact density modes
- Touch-target scaling
- Reduced-motion modes
- High-contrast/accessibility overrides
- Future custom themes

CSS custom properties should form the runtime theme contract. Build-time type-safe styling may be used where it improves correctness, but runtime theme changes must not require rebuilding stylesheets.

Tailwind-style utility usage must not become a substitute for semantic design tokens or component ownership. Any styling tool introduced must preserve the ability to reason about themes, accessibility, density, and component states at the design-system level.

#### 155.1 What the Token System Covers

The semantic token system shall cover every value the design language of `REQ-UX-221` states: the layout grid unit, the type scale and its families, spacing, radii, elevation and shadow, icon sizes and stroke, the focus and selection indicators, and the motion durations and easings of `REQ-UX-222`, each for both densities and both themes where it varies with them.

A component stylesheet shall take each such value from a token. An automated architecture check shall refuse a literal colour, length, duration or shadow in a component's styles outside the token definitions, and shall name each exception it allows with its reason.

---

## REQ-UX-221 — Visual Design Language and Verified Visual Quality

- **Owner:** Phase 16 — Visual Design and Interaction
- **Scope:** `CURRENT`
- **Legacy source:** none; split from `REQ-UX-005`, `REQ-UX-070`, `REQ-UX-071` and `REQ-UX-155` by `CHG-0002`

`REQ-UX-005` asks for "a modern, sleek, visually rich multimedia application rather than a conventional form-based web application". This requirement makes that goal a stated design language and a check that can fail. A requirement group has one owning phase, and Phase 01, which owns those four, verified their structure and not their appearance.

AudioGubbins shall have one written design language, and every visible surface shall follow it. The language shall state:

- A layout grid: the base unit every size is a multiple of, and the alignment of panel content to it
- A type scale: families, sizes, weights and line heights for each role (display, heading, body, label, caption, numeric readout), with tabular figures for every time, level and frequency readout
- A spacing scale and a radius scale, each for both densities
- One icon set under a licence the repository accepts, used for every icon, at stated sizes and one stroke weight, with no icon drawn ad hoc in a component
- Colour use within the semantic tokens of `ADR-0012`: which surfaces, borders, text and accents each role takes in both themes, where the accent appears and where it does not, and the semantic colours of state (error, warning, success, recording, clipping, selection)
- Elevation and panel chrome: the surface levels, how a panel, a panel header, a tab, a toolbar, a menu, a popover and a dialogue are separated, and which of them cast a shadow in each theme
- Focus and selection styling: one visible focus indicator for keyboard focus, distinct from the selection of an item, of a region of audio and of a tool
- The presentation of audio: waveform, spectrogram, meters, the ruler, markers and regions, each with its semantic palette (`REQ-UX-070`)
- Empty, loading and error states for each panel
- The control set: the shared controls every surface is built from (for example icon buttons and grouped toolbars, segmented controls, toggles, sliders, knobs, faders, meters, property grids, lists and tables, tabs, panel headers), each designed once for the language
- Panel composition: the patterns every panel follows (a header with its title, icon and actions, a toolbar, sections, a property grid, an empty state), so that two panels showing the same kind of thing look alike
- Visual richness: the depth and effects the language uses (for example layered surfaces, gradients, translucency and blur behind overlays, glows and highlights on active, selected and live elements, and animated feedback on hover, press and state changes), stated per theme and per motion level
- Text economy: a control is labelled in a word or two, or by an icon with an accessible name; an explanation is a hint, a popover, an empty state or progressive disclosure, never a paragraph standing in a panel

The product owner's direction for the language, recorded in `CHG-0002`, is that AudioGubbins shall look like a current, well-designed modern application: consistent across every surface, built from well-designed controls, with icons, visual effects and animation, and without walls of text. The language shall meet that direction, and the product owner's sign-off judges it.

Every surface shall follow the panel composition and be built from the control set. A surface that needs a control the set lacks shall add it to the set, designed in the language, rather than build its own.

Text economy shall not remove what a reader needs: the reason an action is unavailable (`ADR-0013`), an accessible name for every control, and every announcement stay, reached through the hint, the popover or the live region rather than shown as standing text.

Before a surface is built or changed, the design of that surface shall be shown to the product owner as mock-ups or variants, in both themes and both densities, and the version the product owner approves shall be recorded as its visual reference, with the date and the decision. Work shall not continue on a surface whose reference is not approved.

A surface shall be accepted only when:

1. The product owner has signed off the rendered surface against its approved reference, in each theme and density, through the design review of `contracts/review-gates.md`.
2. An automated screenshot comparison holds the rendered surface, in each theme and density, to the signed-off rendering. A difference beyond the stated tolerance fails, and a new rendering is accepted only by a new sign-off.
3. Every shared component in `packages/design-system` renders in every state it has (default, hover, focus-visible, active, pressed, disabled, error and loading where each applies), in both themes and both densities, and the screenshot comparison covers each.

Structural evidence (tokens exist, contrast is computed, landmarks are named) is necessary and does not verify this requirement.

The design language shall not reduce accessibility. Contrast shall be computed through the token system as `ADR-0012` requires, keyboard focus shall stay visible on every surface, and every control shall stay keyboard-operable.

The language changes appearance and presentation only. The UI shall still change authoritative project state only through typed commands (`REQ-EDIT-073`), and the command-first shell (`ADR-0013`), the workspace layout ownership (`ADR-0010`) and the design-system boundary (`ADR-0009`) stand.

---

## REQ-UX-222 — Motion System and Shell Animation

- **Owner:** Phase 16 — Visual Design and Interaction
- **Scope:** `CURRENT`
- **Legacy source:** none; split from `REQ-UX-069` by `CHG-0002`, taking up the shell animation `ADR-0014` deferred

The motion `REQ-UX-069` lists shall be designed and built as one motion system, not as transitions each component chooses.

The motion system shall state, for each kind of motion `REQ-UX-069` lists (dock and panel transitions, menu and context transitions, zoom transitions, drag-and-drop targets, meter movement, selection feedback, processor state changes, loading and progress, workspace transitions):

- Whether it animates, and what (position, size, opacity, colour)
- Its duration and easing, from the motion tokens
- What it does at each motion level: full, reduced and off

The shell shall animate at the full level: a panel opening, closing, docking and floating, a menu and a popover opening, a dialogue entering and leaving, a workspace switching, and a notice appearing.

At the full level, the application shall also give animated feedback: a control's hover, press and state change, a selection appearing, a list item added or removed, progress and loading, and a live element (a meter, a recording indicator, the playhead) drawn with the effects the design language states. The motion system states each effect, its tokens and what it becomes at the reduced and off levels.

Motion shall never delay input. Direct manipulation of an audio-editing control (a drag of a selection, a fader, a knob, a zoom gesture, a scrub) shall follow the pointer in the next frame with no easing, and a meter shall show the level the audio engine reports, with its stated ballistics rather than an animation's.

At the reduced level, motion shall keep only what helps a reader follow a change, without movement across the screen. At the off level, nothing shall animate. The system preference `prefers-reduced-motion` shall select the reduced level until the user chooses another, as `REQ-UX-069` states. The levels shall reach third-party animation, the docking engine's included.

Each kind of motion shall be verified at each level in a real browser, by its duration and properties as the browser reports them, not by reading a stylesheet.

---
