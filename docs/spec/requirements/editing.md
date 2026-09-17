# Editing and Timeline Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-EDIT-008` — Editing Modes — owner Phase 05 — scope `CURRENT`
- `REQ-EDIT-012` — Timeline and Editing Requirements — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-013` — Snapping — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-014` — Regions — owner Phase 05 — scope `CURRENT`
- `REQ-EDIT-015` — Channel Editing — owner Phase 05 — scope `CURRENT`
- `REQ-EDIT-061` — Multiple Views of the Same Asset — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-062` — Waveform and Spectral Presentation Modes — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-063` — Explicit Selection Model — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-064` — Selection Persistence — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-065` — Hybrid Tool System — owner Phase 04 — scope `CURRENT`
- `REQ-EDIT-072` — Contextual Inspector — owner Phase 01 — scope `CURRENT`
- `REQ-EDIT-073` — Unified Typed Command Architecture — owner Phase 01 — scope `CURRENT`

---

## REQ-EDIT-008 — Editing Modes

- **Owner:** Phase 05 — Core Non-Destructive Editing
- **Scope:** `CURRENT`
- **Legacy source:** section 8 of the pre-hardening baseline

#### 8.1 Project Mode

A full project-oriented workflow with persistent project state.

#### 8.2 Quick Edit Mode

The user may choose a lightweight Quick Edit workflow.

Quick Edit should allow the user to:

- Open a file
- Edit it
- Preview changes
- Export it

without forcing explicit project-management steps.

Internally, Quick Edit may still use the same project model to preserve architectural consistency.

---

## REQ-EDIT-012 — Timeline and Editing Requirements

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 12 of the pre-hardening baseline

The editor shall support:

- Sample-accurate editing
- Movement down to individual samples
- Time display
- Millisecond display
- Sample display
- Future-ready musical time display
- Playhead
- Selection ranges
- Markers
- Named regions
- Loop boundaries
- Zoom
- Pan/scroll
- Channel-separated waveform display

Processing behaviour:

- If a selection exists, processing applies to the selection.
- If no selection exists, processing applies to the entire target asset or region.

---

## REQ-EDIT-013 — Snapping

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 13 of the pre-hardening baseline

Configurable snapping should support, where relevant:

- Zero crossings
- Samples
- Markers
- Region boundaries
- Loop boundaries
- Playhead
- Selection edges
- Grid divisions
- Future beat or musical-time divisions

Zero-crossing snapping is particularly important for game-audio workflows.

---

## REQ-EDIT-014 — Regions

- **Owner:** Phase 05 — Core Non-Destructive Editing
- **Scope:** `CURRENT`
- **Legacy source:** section 14 of the pre-hardening baseline

A single source asset may contain multiple independently editable regions.

Regions may support:

- Independent names
- Independent boundaries
- Independent processing
- Shared processing chains
- Per-region export
- Batch export
- Loop settings
- Metadata

Example:

- `footstep_grass_01`
- `footstep_grass_02`
- `footstep_grass_03`

A long source recording should be capable of producing many separately exported game-audio assets.

---

## REQ-EDIT-015 — Channel Editing

- **Owner:** Phase 05 — Core Non-Destructive Editing
- **Scope:** `CURRENT`
- **Legacy source:** section 15 of the pre-hardening baseline

The editor shall support:

- Separate left/right waveform rendering
- Per-channel selection
- Per-channel editing
- Stereo to mono conversion
- Mono to stereo conversion
- Channel swapping
- Copying one channel to another
- Channel balancing
- Additional channel operations where useful

AudioGubbins shall support channel layouts beyond mono/stereo as a real authoring capability, not merely as a future-compatible data model.

The channel architecture must support arbitrary labelled channel layouts where the container/codec and browser/runtime capabilities permit them, including surround and ambisonic workflows. Stereo remains a common default, but no core editing, metering, processor, project, renderer, or export contract may assume that an asset contains at most two channels.

---

## REQ-EDIT-061 — Multiple Views of the Same Asset

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 61 of the pre-hardening baseline

The same source asset, clip, or region may be opened in multiple simultaneous editor views.

Each view may independently retain:

- Zoom
- Scroll position
- Display mode
- Active tool
- Selection visualisation
- Channel visibility
- Spectral/waveform configuration
- Overlay state

The authoritative asset and edit graph remain shared.

A change to project content must propagate consistently to all views without forcing those views to share presentation state.

---

## REQ-EDIT-062 — Waveform and Spectral Presentation Modes

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 62 of the pre-hardening baseline

The editor shall support user-selectable combinations of waveform and spectral presentation.

Supported modes should include:

- Waveform-only
- Spectrogram-only
- Vertically stacked waveform + spectrogram
- Overlay/composite presentation where useful

The architecture should permit future additional analysis layers and overlays without reworking the editor model.

---

## REQ-EDIT-063 — Explicit Selection Model

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 63 of the pre-hardening baseline

Selection types must be modelled explicitly rather than collapsed into one ambiguous selection concept.

Selection categories should include:

- Time selection
- Spectral time-frequency selection
- Region/clip selection
- Channel selection
- Marker/object selection

Commands must operate using a documented and testable selection precedence model.

The application must avoid silently guessing between materially different editing targets.

Contextual UI should clearly communicate the active selection scope.

---

## REQ-EDIT-064 — Selection Persistence

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 64 of the pre-hardening baseline

Selections should generally persist across non-destructive navigation operations unless explicitly cleared or made invalid by a project change.

Examples include:

- Tool changes
- Zooming
- Scrolling
- Temporary navigation
- View switching where the selection remains meaningful

The UI must make persistent selections sufficiently visible to minimise accidental processing.

Where a command could cause a surprising destructive/export consequence because of a stale selection, contextual confirmation or target indication should be used rather than globally disabling selection persistence.

---

## REQ-EDIT-065 — Hybrid Tool System

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 65 of the pre-hardening baseline

AudioGubbins shall use a hybrid professional tool model.

Explicit precision tools should include, as appropriate:

- Selection
- Time selection
- Spectral marquee
- Spectral lasso
- Razor/split
- Hand/pan
- Zoom
- Brush/repair tools
- Marker/region tools

Contextual pointer behaviour, modifier keys, temporary tools, and gestures should reduce unnecessary tool switching.

Explicit tools and contextual behaviour must invoke the same underlying command/domain systems.

---

## REQ-EDIT-072 — Contextual Inspector

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 72 of the pre-hardening baseline

A contextual Inspector shall be a core workspace concept.

Depending on selection, it may expose properties for:

- Assets
- Regions
- Clips
- Markers
- Loop definitions
- Channels
- Processors
- Effect racks
- Recording configuration
- Export jobs
- Future tracks/buses/automation objects

Direct manipulation in the editor and property editing in the Inspector must update the same underlying domain state.

---

## REQ-EDIT-073 — Unified Typed Command Architecture

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 73 of the pre-hardening baseline

Every meaningful application action should invoke a shared typed command system.

This includes actions initiated from:

- Menus
- Context menus
- Toolbars
- Keyboard shortcuts
- Command palette
- Touch UI
- Gestures
- Inspector controls
- Guided workflows
- Future macros
- Future scripting/plugin APIs

The command architecture should support:

- Validation
- Target resolution
- Undo/redo integration
- Transaction grouping
- Telemetry-free diagnostics
- Testing
- Accessibility
- Command discovery
- Future automation

UI components must not bypass the command/domain layer for convenience.

---
