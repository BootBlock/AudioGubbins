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

---
