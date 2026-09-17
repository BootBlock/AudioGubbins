# AudioGubbins — Implementation Specification

> **Status:** Requirements Baseline — Iteration 10  
> **Document type:** Phased implementation specification for agentic AI execution  
> **Primary implementation model:** One full phase at a time, gated by multi-lens review  
> **Target delivery:** Local development via Vite, browser-hosted deployment, installable PWA  
> **Repository model:** Open source, hosted on GitHub  
> **Deployment target:** GitHub Pages-compatible static deployment

---

## 1. Purpose

This document defines the technical and product requirements for a browser-based, installable Progressive Web Application (PWA) audio editor.

AudioGubbins is intended to provide a modern, visually rich, professional audio-editing experience comparable in ambition to applications such as Adobe Audition, while also providing especially strong workflows for game-audio creation and integration with Godot 4+ projects.

The implementation must not be constrained by decisions made purely for speed, ease, or short-term development convenience. Architectural and implementation choices must prioritise:

- Long-term capability
- Flexibility
- Robustness
- Maintainability
- Extensibility
- Professional-quality UX
- Performance
- Portability
- Testability
- Future expansion

Where a design choice clearly improves application capability without introducing a meaningful trade-off, it should be adopted by default rather than deferred for approval.

---

## 2. Implementation Philosophy

The specification is intended for implementation by an advanced agentic AI system.

Implementation must proceed:

1. One complete phase at a time.
2. With explicit TODO items per phase.
3. With defined prerequisites and invariants.
4. With required tests and acceptance criteria.
5. With mandatory multi-lens review gates before proceeding.
6. With all blocking reviewer findings resolved before the next phase begins.

No later phase may begin until the current phase has passed its review gate.

---

## 3. Product Positioning

The application shall be:

- A full-featured browser-based audio editor.
- Comparable in ambition to a modern Audition-style editing environment.
- Especially strong for processing, cleaning, preparing, and exporting audio for games.
- Suitable for software developers initially.
- Approachable enough for non-technical and creative users.
- Designed so that complexity is available when needed, but not forced onto casual users.
- Capable of evolving beyond its initial game-audio emphasis without being artificially pigeonholed.

The application shall not assume that all users are audio engineers or developers.

Task-oriented workflows, presets, progressive disclosure, contextual help, and strong defaults should be used to keep advanced functionality approachable.

---

## 4. Core Architectural Principles

### 4.1 Local-First

The editor must function primarily on the user's local machine.

Core editing functionality must not depend on:

- A user account
- A remote application server
- Cloud storage
- External processing
- Mandatory telemetry
- Uploading audio to third parties

Audio should remain local unless the user explicitly invokes a future online integration.

Future user-configured cloud integrations should be possible through provider-neutral abstractions, but the local project model must never depend on a cloud provider.

---

### 4.2 Non-Destructive Editing

Non-destructive editing is mandatory.

Original source audio must remain unchanged unless the user explicitly requests a destructive export or replacement workflow.

Edits must be represented as operations and parameters rather than repeatedly rewriting the source audio.

---

### 4.3 Parametric Editing

The editing architecture shall use a parametric model wherever practical.

Examples include:

- Gain changes
- Normalisation
- Equalisation
- Compression
- Filters
- Fades
- Time ranges
- Noise-reduction parameters
- Pitch processing
- Time stretching
- Spectral operations
- Loop definitions
- Region boundaries

The authoritative project state should be composed of:

- Immutable source assets or source references
- Parametric edit operations
- Effect chains
- Region and marker data
- Project metadata
- User configuration

Rendered intermediates, waveform peaks, spectrogram tiles, preview renders, proxies, and other derived data should be treated as disposable caches.

---

### 4.4 Future Multitrack Readiness

Initial releases shall focus on high-quality single-file and region-based waveform editing.

True multitrack editing will be added later.

The initial internal model must therefore avoid assumptions such as:

> one project = one waveform

The domain model should already support concepts such as:

- Projects
- Assets
- Clips
- Regions
- Tracks
- Processors
- Effect chains
- Buses
- Routing
- Automation-ready parameters

Even if some of those concepts are not exposed in the first UI.

---

## 5. User Experience Goals

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

## 6. Primary Users

Initial primary users:

- The project author
- Software developers
- Game developers
- Technical creators

The application must also remain approachable to:

- Sound designers
- Content creators
- Hobbyists
- General users
- Users without advanced audio-engineering knowledge

No UI or workflow should be made needlessly technical.

---

## 7. Primary Workflow Example

A representative workflow is:

1. Import an audio file.
2. Inspect waveform and spectral content.
3. Remove noise or unwanted artefacts.
4. Trim unwanted silence.
5. Edit one or more regions.
6. Apply processing.
7. Normalise or loudness-match.
8. Add fades.
9. Preview and A/B compare.
10. Configure loop points if applicable.
11. Export using a Godot-aware preset.
12. Optionally export directly into a selected Godot project.

---

## 8. Editing Modes

### 8.1 Project Mode

A full project-oriented workflow with persistent project state.

### 8.2 Quick Edit Mode

The user may choose a lightweight Quick Edit workflow.

Quick Edit should allow the user to:

- Open a file
- Edit it
- Preview changes
- Export it

without forcing explicit project-management steps.

Internally, Quick Edit may still use the same project model to preserve architectural consistency.

---

## 9. Audio Duration and Scale

The application must support audio ranging from:

- Very short game sound effects
- One-shots
- Loops
- Dialogue clips
- Music
- Ambience
- Recordings lasting tens of minutes

The application must not impose arbitrary artificial duration limits.

Architecture should avoid requiring entire large assets to remain duplicated in memory.

---

## 10. Format Support

The codec layer must be abstracted so that format support can evolve independently from the editor core.

Target common formats include:

### Import

- WAV
- AIFF
- FLAC
- MP3
- Ogg Vorbis
- Opus
- AAC / M4A
- Additional common or game-relevant formats where technically and legally practical

### Export

Broad export support should be provided where technically, legally, and browser-wise practical.

WAV support should be especially comprehensive.

Target WAV capabilities include:

- Integer PCM
- Floating-point PCM
- Common bit depths
- Broad sample-rate support
- Mono
- Stereo
- Channel conversion
- Metadata
- Loop metadata where applicable

Codec support must use capability detection and must not assume that all browsers expose identical native codecs.

Fallback implementations may use WebAssembly or other portable mechanisms where beneficial.

---

## 11. Audio Precision

Recommended baseline:

- 32-bit floating-point working PCM for normal editing and real-time processing
- Higher precision for offline calculations where materially beneficial
- Export precision independent of working precision
- No repeated unnecessary quantisation between operations

Where feasible, users should be given meaningful quality/precision controls rather than being locked to one mode.

---

## 12. Timeline and Editing Requirements

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

## 13. Snapping

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

## 14. Regions

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

## 15. Channel Editing

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

## 16. Spectral Editing

Interactive spectral editing is a required long-term feature.

Capabilities should include:

- Spectrogram display
- Time-frequency selection
- Attenuation
- Removal
- Repair/healing
- Noise isolation
- Spectral cleanup
- Selection-sensitive processing

This may be implemented in a later phase than the core waveform editor.

---

## 17. Effect Rack

The editor shall provide Audition-style effect-rack functionality.

Processors should support:

- Stacking
- Reordering
- Bypass
- Enable/disable
- Parameter editing
- Presets
- Real-time preview where practical
- A/B comparison
- Copy/paste
- Saving chains
- Batch reuse

Initial architecture should support future:

- Per-clip racks
- Per-track racks
- Bus racks
- Master racks

---

## 18. DSP Scope

The application should ultimately support a comprehensive processing toolset, including:

- Gain / amplify
- Peak normalisation
- Loudness normalisation
- Fades
- Invert
- Reverse
- Silence generation
- Silence trimming
- DC-offset removal
- Resampling
- Sample-rate conversion
- Channel conversion
- Equalisation
- Filtering
- Compression
- Limiting
- Expansion
- Gating
- De-essing
- Noise reduction
- De-hum
- De-click
- De-pop
- Pitch shifting
- Time stretching
- Reverb
- Delay
- Spectral processing

Additional processors that materially improve capability should be included without requiring separate approval.

---

## 19. Preview and Comparison

Where computationally practical, processors should support:

- Real-time preview
- Bypass
- A/B comparison
- Processed/original comparison
- Safe parameter adjustment during playback

Expensive operations may use cached intermediate renders where appropriate.

---

## 20. Recording

Recording is a first-class requirement.

The v1 recording system should aim beyond minimal microphone capture.

Target features include:

- Input-device selection
- Input level metering
- Gain monitoring
- Mono/stereo recording
- Input monitoring
- Monitoring through effects where feasible
- Pre-roll
- Punch-in
- Scheduled or controlled recording where beneficial
- Recording into a new project asset
- Safe recovery of interrupted recordings

Dry input should remain authoritative.

Monitoring effects should not destructively alter the original recording.

---

## 21. Undo, Redo, Autosave, and Recovery

Undo/redo should be effectively unlimited subject to available storage and practical performance.

Avoid arbitrary small undo limits.

Project history should be persisted where practical.

The application shall support:

- Continuous autosave
- Crash recovery
- Tab/process termination recovery
- Restoration of recent working state
- Transaction-safe project updates where practical

---

## 22. Variation Generation

Game-audio workflows should support controlled variation generation.

Potential parameters include:

- Pitch
- Gain
- Start offset
- Effect parameters
- Timing
- Processing-chain variations

Users should be able to:

- Define variation rules
- Generate multiple candidates
- Audition them
- Accept/reject candidates
- Export selected variations as a batch

---

## 23. Game-Audio Features

Game-specific functionality is a major product priority.

Target features include:

- Seamless-loop creation
- Loop-point editing
- Zero-crossing loop assistance
- Loop auditioning
- One-shot preparation
- Silence trimming
- Batch conversion
- Batch export
- Controlled random variation generation
- Sample-rate conversion
- Bit-depth conversion
- Mono/stereo conversion
- Loudness matching
- Naming templates
- Region naming
- Export presets
- Godot-aware export
- Godot project integration
- Game-oriented processing presets

---

## 24. Godot Integration

Target:

- Godot 4.x and newer
- No requirement to support Godot 3.x

The editor should support deep Godot integration where browser capabilities permit.

Potential functionality includes:

- Selecting a Godot project directory
- Detecting `project.godot`
- Browsing asset directories
- Selecting export destinations
- Exporting directly into a Godot project
- Godot-aware naming
- Godot-aware audio presets
- Loop metadata handling
- Asset preparation workflows
- Future metadata/resource integration where safe and beneficial

The application must never make broad, opaque, or destructive changes to a Godot project.

Any project modification must be:

- Explicit
- Transparent
- Previewable where appropriate
- Recoverable where practical

---

## 25. Storage Model

The application should use a hybrid storage model.

Working project data should primarily use browser-managed persistent storage such as OPFS where available.

The system should support:

- Internal project storage
- External file references
- Imported copies
- Portable project bundles
- User-configurable source handling
- Capability-based directory access

The user should be able to choose whether imported source assets are:

- Copied into managed project storage
- Referenced externally

The application should clearly explain trade-offs.

---

## 26. Project Format

The application must use an application-owned, documented, versioned project format.

The project format should be:

- Structured
- Portable
- Extensible
- Versioned
- Migration-capable
- Documented
- Suitable for external tooling in the future

The format may use:

- JSON or similar structured metadata
- Binary asset data
- Media files
- Optional caches

Portable project bundles should support moving projects between devices or browsers.

---

## 27. Cache Model

Derived artefacts should be disposable.

Examples:

- Waveform peaks
- Spectrogram tiles
- Preview renders
- Proxy audio
- Temporary renders
- Intermediate processing results

Loss or corruption of cache data must not invalidate the authoritative project.

Caches should be regenerable.

---

## 28. Platform Support

First-class desktop operating systems:

- Windows
- macOS
- Linux

Browser targets:

- Chrome
- Edge
- Firefox
- Safari

The application should use progressive enhancement.

Core editing functionality should remain portable across modern browsers.

Enhanced browser APIs should be capability-gated rather than assumed.

---

## 29. Mobile and Touch

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

## 30. PWA Requirements

The application must be usable:

- Directly in a browser
- As an installed PWA
- Offline where supported after required assets are available

PWA functionality should include:

- Installability
- Service-worker-based application shell caching
- Offline startup
- Versioned application updates
- Safe update prompts
- Recovery from stale caches
- Persistent-storage requests where appropriate
- Storage health/status display
- Capability detection

The specification must not assume that installing the PWA automatically guarantees increased storage quotas on every browser/platform.

---

## 31. Local Development

Vite is mandatory for local development and testing.

The project must support:

- Local development server
- Hot reload
- Production builds
- Static deployment
- PWA development/testing
- GitHub Pages deployment

---

## 32. Deployment

The application must be deployable as a static site to GitHub Pages.

Deployment must support:

- Direct browser use
- PWA installation where supported
- Correct routing/base-path configuration
- Asset versioning
- Cache-busting
- Update-safe service-worker behaviour

No mandatory backend should be required for core functionality.

---

## 33. Source Control and Licensing

The project will be:

- Open source
- Hosted on GitHub

Dependency selection must therefore consider:

- Licence compatibility
- Redistribution rights
- Codec licensing
- Patent implications where relevant
- Long-term maintainability
- Project health

---

## 34. Dependency Philosophy

High-quality open-source dependencies may be used where they materially improve quality or capability.

Core architectural ownership should remain within the application for:

- Project model
- Editing model
- Processing graph
- Storage abstractions
- Undo/redo model
- Command model
- Core state architecture

Avoid coupling the core editor to a library that would make future evolution difficult.

---

## 35. Front-End Technology Direction

Vite is fixed.

TypeScript should be treated as mandatory.

The final front-end framework should be chosen based on its ability to support:

- Rich modern UI
- Smooth animation
- Complex interactive workspaces
- High-frequency state updates
- Timeline interaction
- Canvas/WebGL/WebGPU integration where appropriate
- Docking/resizing
- Touch input
- Accessibility
- Strong ecosystem
- Long-term maintainability
- Static deployment
- PWA support

The choice must not be made because a framework is simply easier or quicker to implement.

---

## 36. Processing Architecture Direction

Heavy processing must not block the UI thread.

The architecture should support separation between:

- UI/controller layer
- Project/domain model
- Real-time playback
- AudioWorklet processing
- Worker-based offline computation
- WebAssembly processing where beneficial
- Codec subsystem
- Storage subsystem
- Rendering/cache subsystem

The UI thread must remain responsive during:

- Waveform generation
- Spectrogram generation
- Import
- Export
- Analysis
- DSP
- Batch processing

---

## 37. Waveform Rendering Direction

Waveform display should not repeatedly render directly from full-resolution PCM.

The system should use precomputed multi-resolution peak data.

Waveform rendering should support:

- Efficient zoom
- Efficient scroll
- Large files
- Progressive generation
- Background processing
- Cache persistence
- Regeneration

---

## 38. Cloud Extensibility

Cloud storage is not part of the initial implementation.

Future support may include user-supplied integrations such as:

- Google Drive
- OneDrive
- Dropbox
- S3-compatible storage
- Other providers

The architecture should expose provider-neutral storage abstractions.

Cloud support must remain optional.

---

## 39. Third-Party Plugins

Third-party plugins are a future goal.

The initial implementation will not expose arbitrary third-party plugin loading.

However, internal processor/plugin abstractions should avoid preventing a future plugin ecosystem.

Security boundaries, sandboxing, compatibility, and versioning must be considered before third-party plugins are exposed.

---

## 40. Multi-Lens Review Model

Every implementation phase must conclude with mandatory independent review lenses.

Required lenses should include, at minimum:

### Architecture Lens

Review:

- Modularity
- Coupling
- Extensibility
- Domain boundaries
- Future multitrack compatibility
- Future plugin compatibility

### Audio / DSP Correctness Lens

Review:

- Numerical correctness
- Signal integrity
- Clipping
- Precision
- Sample alignment
- Processing order
- Channel handling
- Loop correctness

### Performance Lens

Review:

- UI thread blocking
- Memory behaviour
- Large-file handling
- Worker usage
- Rendering performance
- Cache efficiency
- Audio latency

### Security / Privacy Lens

Review:

- Local-first guarantees
- File permissions
- Data leakage
- Browser storage handling
- CSP
- Third-party dependencies
- Unsafe code execution

### PWA / Browser Compatibility Lens

Review:

- PWA behaviour
- Browser API differences
- Offline behaviour
- Capability detection
- Update safety
- Mobile/touch support

### UX / Accessibility Lens

Review:

- Discoverability
- Keyboard support
- Touch support
- Screen-reader semantics
- Contrast
- Focus handling
- Responsive behaviour
- Progressive disclosure

### Code Quality / Maintainability Lens

Review:

- Type safety
- Testability
- Separation of concerns
- Naming
- Documentation
- Duplication
- Architectural consistency

### Testing / Regression Lens

Review:

- Unit coverage
- Integration coverage
- E2E coverage
- Audio regression tests
- Browser coverage
- Failure-path tests
- Recovery tests

---

## 41. Gate Rule

A phase may not advance until:

- All required TODO items are complete.
- All mandatory tests pass.
- Acceptance criteria are satisfied.
- Required reviewers have completed their review.
- All blocking findings are resolved.
- High-severity defects are resolved.
- Any accepted non-blocking findings are documented.

The implementation agent must not silently defer required work to a later phase.

---

## 42. Planned Phase Structure

The exact phase breakdown remains subject to further requirements refinement, but the current intended structure is:

### Phase 0 — Requirements and Architectural Baseline

No production implementation.

Defines:

- Product requirements
- Domain model
- Technical boundaries
- Browser capability strategy
- Data model
- Project format
- Processing model
- Review model

### Phase 1 — Application Foundation

### Phase 2 — Project and Storage System

### Phase 3 — Audio Engine Foundation

### Phase 4 — Waveform and Timeline Foundation

### Phase 5 — Core Non-Destructive Editing

### Phase 6 — Effect Rack and Core DSP

### Phase 7 — Recording

### Phase 8 — Spectral Editing

### Phase 9 — Import / Export / Codec System

### Phase 10 — Game-Audio Tooling

### Phase 11 — Godot Integration

### Phase 12 — PWA / Offline / Installation Hardening

### Phase 13 — Advanced Batch and Variation Workflows

### Phase 14 — Performance / Compatibility / Accessibility Hardening

### Phase 15 — Release Readiness

Future phases may add:

- Multitrack
- Automation
- Bus routing
- Plugin ecosystem
- Cloud integrations

---

## 43. Current Open Decisions

The following areas still require further requirements work before Phase 0 can be considered complete:

- Final UI framework selection
- State-management architecture
- Rendering stack
- Audio graph architecture
- Detailed project schema
- Detailed portable bundle format
- Detailed codec strategy
- Detailed recording feature model
- Detailed spectral-analysis architecture
- Detailed mobile workspace behaviour
- Detailed browser capability matrix
- Detailed Godot metadata/export model
- Detailed shortcut system
- Detailed accessibility requirements
- Detailed performance budgets
- Detailed test strategy
- Detailed review output format
- Detailed recovery/transaction model
- Detailed naming/export templating model
- Detailed preset system
- Detailed settings system

---

## 44. Standing Decision Rules

The specification process shall follow these decision rules:

1. Do not optimise for implementation ease or speed.
2. Prefer long-term power, flexibility, robustness, quality, and maintainability.
3. Automatically adopt straightforward improvements where the answer is effectively an unambiguous “yes”.
4. Ask for user input only when there is a genuine trade-off.
5. Genuine trade-offs include:
   - UX complexity
   - Performance
   - Browser compatibility
   - Security
   - Portability
   - Licensing
   - Data integrity
   - Architectural coupling
   - Significant scope expansion
6. Do not artificially restrict capability merely to simplify implementation.
7. Maintain future multitrack, plugin, and cloud extensibility unless doing so introduces a concrete disadvantage.

---

## 45. Next Requirements Areas

The next requirements interview should focus on:

1. Detailed game-audio workflows
2. Godot integration behaviour
3. Timeline interaction model
4. Advanced recording model
5. Processor/preset architecture
6. Workspace and panel system
7. Touch and mobile UX
8. Browser capability fallbacks
9. Performance expectations
10. Project portability and recovery



## 46. Godot Integration Capability Strategy

Deep Godot integration shall use progressive enhancement.

Where browser filesystem capabilities permit, the application may provide direct project-folder access and export/synchronisation workflows.

Where those capabilities are unavailable, the core editor must remain fully usable and provide equivalent export/download workflows without reducing the editor to the lowest common denominator.

Direct filesystem integration is an enhancement, not a prerequisite for core editing.

---

## 47. Godot Synchronisation Direction

Initial Godot integration is primarily editor-to-Godot.

The architecture must not prevent future two-way synchronisation.

Future two-way synchronisation may include:

- Detection of externally modified audio files
- Detection of Git or tool-driven changes
- Conflict detection
- Conflict resolution
- User-controlled reconciliation
- Change provenance

Two-way synchronisation is future scope and must not complicate initial implementation unnecessarily, but architectural dead ends are not acceptable.

---

## 48. Godot Project Modification Safety

The application may create or update explicitly requested audio assets, app-owned metadata, manifests, or Godot resources.

It must never silently rewrite unrelated Godot project settings or unrelated existing resources.

If an operation requires modification of an existing Godot resource or configuration file, the application should provide a preview or diff and require explicit confirmation unless the user has deliberately configured a trusted automation policy for that operation.

---

## 49. Deterministic Rendering

The application shall aim for deterministic rendering wherever technically practical.

Given identical:

- Source audio
- Project state
- Processor settings
- Export settings
- Application version

rendered output should be reproducible across supported browsers and machines where feasible.

This requirement should influence DSP, codec, and resampling architecture.

Where browser-native behaviour is not deterministic enough for a required feature, application-owned or WebAssembly-based processing may be preferred.

Any unavoidable sources of platform-dependent variation must be documented.

---

## 50. Presets and Advanced Codec Controls

Export workflows shall use progressive disclosure.

Users should be offered high-quality presets for common tasks while retaining access to advanced codec and format controls.

The user must not be forced to choose between simplicity and power.

Presets are convenience layers over fully configurable settings, not separate restricted modes.

---

## 51. Mobile Orientation Policy

Phones should strongly prefer landscape orientation for workstation-heavy editing workflows.

The application should remain robust in portrait where practical, but detailed waveform, spectral, multichannel, and other dense editing modes may recommend or require landscape on very small screens.

Tablets, Surface-class devices, and larger touch devices should retain fully adaptive layouts.

---

## 52. Project Schema Compatibility Policy

### Pre-1.0.0

Before version 1.0.0, the project and storage schemas are explicitly allowed to break.

The application must not accumulate backwards-compatibility shims or migration code during this period.

When a breaking schema change is detected, the application shall present a blocking compatibility screen that clearly explains that the current stored data is incompatible with the new schema.

The user must be able to choose, where technically possible, to:

- Back up/export current data before proceeding
- Cancel and remain on the current state
- Proceed and wipe incompatible local application data

After wipe, the application shall initialise storage using the current schema.

### Version 1.0.0 and Later

From 1.0.0 onward, backwards-compatible project/schema migration becomes a supported product responsibility.

Migration infrastructure should then include:

- Versioned schemas
- Explicit migration steps
- Validation
- Recovery/failure handling
- Migration tests
- Preservation of user project data wherever technically possible

---

## 53. External Source Change Policy

When a project references an external source file and that source changes outside the application, the default behaviour shall be to detect the mismatch and ask the user how to proceed.

The application should support configurable policies, including:

- Prompt on change
- Adopt the new external version
- Preserve/freeze the prior known version where possible
- Re-link to another file

Silent adoption must not be the default because external changes can invalidate non-destructive edit assumptions.

---

## 54. Export Collision Policy

Export collision handling shall be user-configurable.

The default should be safe and explicit.

Supported policies should include, where appropriate:

- Prompt
- Overwrite
- Skip
- Auto-version/rename
- Apply to all remaining collisions in the batch

For rapid Godot iteration, the user may configure trusted export destinations to silently overwrite matching generated assets so that switching back to Godot immediately reflects updated audio.

---

## 55. Undo/Redo Retention Policy

Undo/redo history should be effectively unlimited subject to available storage and application stability.

Retention must be user-configurable.

Supported policies should include:

- Unlimited until manually compacted/pruned
- User-defined storage budget
- Automatic compaction rules
- Protected recovery snapshots

The default should favour strong reversibility while clearly surfacing storage impact.


---

## 56. Product Name

The application is named **AudioGubbins**.

The product name should be used consistently in:

- Application chrome
- PWA manifest metadata
- Project documentation
- Repository documentation
- Exported diagnostic information
- About/help surfaces

Internal package, namespace, and identifier naming should remain stable and deliberately chosen so that display-name changes would not require invasive schema changes.

---

## 57. Dockable Workspace System

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

## 58. Workspace Presets

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

## 59. Workspace State Persistence

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

## 60. Asset Browser and Editor Tabs

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

## 61. Multiple Views of the Same Asset

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

## 62. Waveform and Spectral Presentation Modes

The editor shall support user-selectable combinations of waveform and spectral presentation.

Supported modes should include:

- Waveform-only
- Spectrogram-only
- Vertically stacked waveform + spectrogram
- Overlay/composite presentation where useful

The architecture should permit future additional analysis layers and overlays without reworking the editor model.

---

## 63. Explicit Selection Model

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

## 64. Selection Persistence

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

## 65. Hybrid Tool System

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

## 66. Shortcut System

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

## 67. Touch and Gesture Model

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

## 68. Stylus and Pressure Input

Stylus input should be first-class where browser/hardware capabilities permit.

Pressure-sensitive behaviour may be used for appropriate tools such as spectral painting/repair.

Pressure must be optional.

Users must be able to use deterministic fixed-strength behaviour regardless of pressure-capable hardware.

Hardware-specific expressive controls must never become a requirement for accessing an editing capability.

---

## 69. Motion and Animation

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

## 70. Theme System

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

## 71. Information Density and UI Customisation

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

## 72. Contextual Inspector

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

## 73. Unified Typed Command Architecture

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

## 74. Macros and Action Sequences

Reusable action sequences are future scope and should be architecturally supported.

Users should eventually be able to compose workflows such as:

`trim silence → high-pass → normalise → fade → export preset`

Macros are broader than DSP effect-chain presets and may include editing and export actions.

Future macro execution must integrate with:

- Undo/redo transactions
- Command validation
- Batch processing
- Presets
- Deterministic execution
- User review where an action affects external files

Macro support is not required in the initial implementation phases unless explicitly scheduled.

---

## 75. Guided Task Workflows

AudioGubbins shall provide task-oriented guided workflows without creating a separate restricted “beginner mode”.

Examples include:

- Prepare One-Shot
- Clean Dialogue
- Create Seamless Loop
- Normalise Game SFX
- Export for Godot

Guided workflows must produce the same underlying editable operations that an expert could create manually.

After completing a guided workflow, users must be able to inspect and modify the resulting:

- Regions
- Parameters
- Processor chain
- Loop metadata
- Export settings

This preserves approachability without creating a second, incompatible editing model.

---

## 76. Runtime Capability Tiers

AudioGubbins shall use a single codebase with capability-based runtime enhancement.

### Standard Web Runtime

The Standard Web Runtime must remain fully functional on static hosting environments such as GitHub Pages and must not require cross-origin isolation.

It must support all core editing workflows, even when high-performance shared-memory or threaded WebAssembly features are unavailable.

### Enhanced Web Runtime

Where hosting and browser capabilities permit additional security headers and APIs, AudioGubbins may enable enhanced execution features such as:

- Shared-memory WebAssembly
- Threaded WebAssembly
- SharedArrayBuffer-based pipelines
- Higher parallel processing throughput
- Other capability-gated optimisations

Enhanced runtime capabilities should primarily improve performance, scalability, responsiveness, or throughput rather than create incompatible project formats or separate feature sets.

---

## 77. Capability Degradation Transparency

Where a browser, device, hosting environment, or permission state causes a capability to be reduced, AudioGubbins must communicate that clearly.

The application shall provide an accessible capability/status surface that can explain:

- Which capabilities are fully available
- Which are degraded
- Which are unavailable
- Why the limitation exists
- Whether the limitation is browser-, device-, permission-, hosting-, or configuration-related
- What practical effect the limitation has
- Whether the user can improve the situation through configuration, installation, alternate hosting, or another supported browser/device

Capability degradation must not be hidden or presented as unexplained poor performance.

---

## 78. Graceful Performance Degradation

When an optimisation is unavailable, AudioGubbins should preserve functionality wherever technically practical.

Examples include falling back from:

- Threaded WASM to single-threaded WASM
- Shared-memory processing to message-passing workers
- WebGPU to WebGL2 or CPU processing
- Real-time processing to cached preview rendering
- Cached preview rendering to offline processing

Capability differences should normally affect performance rather than feature availability.

---

## 79. Adaptive Processing Modes

Computationally expensive operations may execute using different strategies depending on workload and runtime capability.

Supported execution strategies should include:

- Real-time processing
- Cached/pre-rendered preview processing
- Background offline processing
- High-quality final offline rendering

AudioGubbins should automatically select an appropriate strategy using measured runtime capability and workload characteristics while allowing advanced users to override the strategy where meaningful.

The selected processing mode must remain visible and understandable to the user.

---

## 80. Preview Quality and Final Render Quality

Processors may expose different quality modes for interactive preview and final output where the underlying algorithm materially benefits from this distinction.

Requirements:

- Preview quality may favour low latency and responsiveness.
- Final render quality may use more expensive algorithms or settings.
- The application must not silently produce materially different results without making the distinction clear.
- Users should be able to inspect and configure quality behaviour where relevant.
- Presets may simplify the normal workflow while advanced settings expose the underlying parameters.

---

## 81. Canonical Deterministic Processing

AudioGubbins shall aim for deterministic, reproducible output wherever technically practical.

The long-term canonical processing path should favour application-controlled DSP, resampling, and encoding implementations when that materially improves reproducibility.

Browser-native implementations may be used as accelerators or convenience paths when they meet correctness and reproducibility requirements.

Given identical source data, project state, processing settings, export settings, and AudioGubbins version, the target is bit-identical PCM output across supported machines and browsers wherever feasible.

Where bit-identical behaviour cannot be guaranteed, the cause and expected tolerance must be documented and tested.

---

## 82. GPU Acceleration Strategy

WebGPU should be used opportunistically where it provides meaningful benefit.

Candidate workloads include:

- Spectrogram generation
- Spectrogram rendering
- FFT-heavy analysis
- Visualisation
- Selected parallel DSP workloads where appropriate

AudioGubbins must provide graceful fallbacks, including WebGL2 and CPU/worker implementations where required.

WebGPU must not become a prerequisite for core editing functionality.

---

## 83. Audio Performance Profiles

AudioGubbins shall provide configurable audio-performance profiles.

At minimum:

- Low Latency
- Balanced
- Maximum Stability
- Custom

The application should measure relevant runtime behaviour and warn when the selected configuration is producing underruns, drop-outs, or instability.

Where possible, the application should recommend appropriate settings based on observed device/browser performance without preventing expert manual configuration.

---

## 84. Foreground and Background Processing Priority

Interactive editing and playback shall receive priority over background processing by default.

Background tasks such as:

- Analysis
- Peak generation
- Spectrogram generation
- Batch rendering
- Batch encoding
- Cache regeneration

may reduce their concurrency or throughput while interactive work is active.

The user shall be able to select alternate priority policies, including a throughput-oriented mode that prioritises batch/background completion when interactive responsiveness is not required.

---

## 85. Native Asset Sample Rates and Future Session Rate

During single-asset editing, source assets should retain their native sample rates internally wherever practical.

AudioGubbins must avoid unnecessary resampling merely to conform to a global project rate.

When multitrack sessions are introduced, a session or mix sample rate may be defined while preserving original source assets at their native rates.

Resampling must remain explicit, deterministic, and high quality.

---

## 86. Quality Presets and Expert Controls

Technical quality controls shall use progressive disclosure.

Where appropriate, AudioGubbins should expose approachable named presets such as:

- Draft
- High
- Maximum

Advanced users must also be able to inspect and configure the underlying parameters when doing so is meaningful and safe.

Named presets must map to explicit parameter values and must not create opaque hidden processing modes.

---

## 87. Resource-Aware Operation Without Artificial Limits

AudioGubbins must not impose arbitrary fixed limits on:

- Audio duration
- Region count
- Marker count
- Undo/redo depth
- Project asset count
- Batch size
- Analysis duration
- Other scalable project structures

Instead, the application should measure available resources and estimate workload requirements.

When an operation may exhaust memory, storage, compute capacity, or browser limits, the application should:

1. Warn the user clearly.
2. Explain the limiting resource.
3. Offer safer execution strategies where possible.
4. Prefer streaming, chunked, tiled, paged, or incremental processing over outright refusal.
5. Allow knowledgeable users to proceed where doing so is technically safe.

---

## 88. Fully Local Core Processing

All core DSP, analysis, rendering, encoding, decoding, waveform generation, and project processing must remain local and offline-capable once required application assets are available.

AudioGubbins must never silently upload work or switch to remote/cloud processing because a local device is slow.

Any future cloud-assisted processing must be:

- Explicitly enabled by the user
- Clearly identified
- Optional
- Provider-aware
- Privacy-transparent
- Non-essential to the core editor


---

## 89. Recording Take Management

AudioGubbins v1 shall support structured recording take stacks.

Take stacks shall allow multiple recordings of the same intended material to be grouped and managed without overwriting previous takes.

The user should be able to:

- Record successive takes into a logical take group
- Name and annotate takes
- Audition takes quickly
- Promote or select a preferred take
- Retain rejected takes non-destructively
- Duplicate or branch from a take where useful
- Remove takes from the active stack without immediately destroying recoverable history
- Integrate take changes with undo/redo and project recovery

Full comping, where arbitrary ranges from multiple takes are combined into a single composite performance, is deferred until later and should align with the future multitrack/clip architecture rather than being implemented as an isolated v1 special case.

---

## 90. Retrospective Recording

AudioGubbins shall support optional retrospective recording through a rolling pre-record buffer while an input is armed.

The user should be able to recover audio captured immediately before the explicit record command, with a configurable retrospective duration subject to available memory/storage and browser capabilities.

Target configuration should support useful ranges such as several seconds through at least tens of seconds where practical.

Because retrospective recording means input is continuously captured into a transient buffer while armed, the application must provide unambiguous privacy and state indicators, including:

- Microphone/input armed state
- Active retrospective-buffer state
- Input device identity
- Buffer duration/status where useful
- Clear distinction between transient buffering and committed project recording

Retrospective data must remain local and must be discarded securely when no longer required.

---

## 91. Input Monitoring Safety

Software input monitoring shall be disabled by default.

This default minimises accidental acoustic feedback when users record through speakers.

AudioGubbins shall provide:

- One-action monitoring enable/disable
- Persistent, highly visible monitoring state
- Feedback-risk warnings where appropriate
- Device/profile-specific remembered monitoring preferences
- Optional automatic monitoring for trusted headphone-oriented profiles
- Clear separation between input monitoring and recording state

The application must not silently enable software monitoring merely because an input device is armed.

---

## 92. Capture Processing Profiles

The default recording profile shall prioritise source fidelity rather than browser convenience processing.

The default profile shall be **Raw/Studio**.

Where the browser/device permits control, Raw/Studio should request capture with processing such as the following disabled:

- Automatic gain control
- Echo cancellation
- Noise suppression
- Other voice-oriented signal processing that materially alters the captured source

AudioGubbins shall also provide user-selectable profiles, including at minimum:

- Raw/Studio
- Voice
- Custom

Profiles must use progressive disclosure. Users should be able to inspect and override individual supported media-capture constraints where the platform exposes them.

The application must detect the actually granted/effective capture capabilities where possible rather than assuming requested constraints were honoured.

Any unavoidable platform processing or unavailable controls should be surfaced in the recording/device diagnostics UI.

---

## 93. Non-Destructive Punch Recording

Punch-in and replacement recording shall be non-destructive by default.

A punch operation must create new underlying recorded material for the target range rather than destructively overwriting the prior source.

Previous material shall remain recoverable through:

- Take management
- Undo/redo history
- Project recovery/history mechanisms

Punch workflows should support pre-roll and post-roll where useful for performance context.

Later consolidation/render operations may create flattened media when explicitly requested, but consolidation must not silently destroy the recoverable project history.

---

## 94. Device Latency, Bluetooth, and Recording Diagnostics

AudioGubbins shall treat device latency and capture-path quality as observable characteristics rather than reasons to block recording.

The application should detect or estimate, where browser APIs permit:

- Input latency
- Output latency
- Round-trip latency
- Sample-rate mismatch
- Device changes
- Bluetooth or similarly high-latency paths
- Capture-channel limitations
- Browser/device processing constraints

When the active configuration is unsuitable for precise monitoring, punch-in, overdub, or latency-sensitive work, AudioGubbins should provide a clear warning and explanation.

Recording must remain available unless a genuine technical failure prevents it.

The user retains final control over whether to continue with a suboptimal device configuration.

---

## 95. Recording Latency Calibration

AudioGubbins should support recording-latency calibration so that newly recorded material can be aligned accurately against the project timeline.

Calibration should support, where technically practical:

- Automatic or guided loopback calibration
- Manual offset entry
- Per-device/profile calibration values
- Recalibration prompts after meaningful device/path changes
- Separation of input, output, and round-trip measurements where useful

Applied compensation must be explicit in diagnostics and must not irreversibly alter the original recorded PCM.

---

## 96. Recording Resilience

Recording shall use a crash-resilient, incremental persistence model rather than holding an entire long recording only in volatile memory until stop is pressed.

Where platform capabilities permit, capture data should be committed progressively in recoverable chunks while recording continues.

The design should minimise data loss from:

- Tab crashes
- Browser process termination
- Application reloads
- Device disconnects
- Storage pressure
- Unexpected exceptions

On restart, AudioGubbins should detect recoverable interrupted recording sessions and offer recovery before normal cleanup occurs.

Recovered recordings must clearly indicate that capture ended unexpectedly and may require user review.

---

## 97. Recording Capability Transparency

AudioGubbins shall provide a recording/audio-I/O diagnostics surface that explains the effective capabilities of the current browser and hardware combination.

Where functionality is degraded, unavailable, emulated, or operating through a fallback, the user should be able to discover:

- What capability is affected
- Why it is affected
- The practical impact
- Whether changing browser, device, permission, deployment runtime, or settings can improve it

Capability transparency must be informative rather than alarmist and should not obstruct normal workflows unless user action is genuinely required.

---

## 98. Concurrent Project Access and Single-Writer Ownership

AudioGubbins shall use a single-writer ownership model for any one project within a browser/profile storage context.

At most one application instance may hold authoritative write ownership for a project at a time.

Other tabs or windows attempting to open the same project should be able to:

- Open the project read-only where safe
- See which instance currently owns write access where identifiable
- Request ownership transfer
- Take ownership after an explicit user decision where the existing owner is unavailable or stale
- Refresh into the latest authoritative state after ownership changes

Write ownership must use robust coordination primitives available to the platform and must fail safely when coordination is unavailable.

The application must not attempt implicit same-project collaborative editing between browser tabs as part of the initial architecture.

Future collaborative or multi-writer editing, if ever implemented, shall be treated as a distinct feature with an explicit conflict/merge model rather than being layered accidentally onto the local persistence mechanism.

---

## 99. Content-Addressed Media Storage and Deduplication

AudioGubbins should support internal content-addressed media storage so that byte-identical imported source media can be shared across multiple local projects without unnecessary duplication.

The deduplication system should:

- Identify identical media by cryptographic content identity rather than filename
- Preserve logical project ownership/reference metadata independently of physical storage
- Maintain reference counts or equivalent reachability information
- Never remove media that is still reachable from an active project, retained history, backup, recovery state, or protected snapshot
- Support deterministic garbage collection
- Remain transparent to ordinary project editing workflows

Deduplication is an internal storage optimisation and must not prevent projects from being exported as fully self-contained portable bundles.

Users should be able to request project consolidation/materialisation when they want all linked/shared media copied into a self-contained project representation.

---

## 100. Project Encryption Scope

Application-level project encryption is not an implementation requirement.

AudioGubbins shall rely on the security guarantees provided by the operating system, browser profile, storage implementation, and user environment for normal local project data.

The architecture does not need to carry encryption-specific complexity, password recovery flows, encrypted-preview handling, or encrypted cache management in the initial or planned product scope.

A future encryption feature may be designed later if a concrete requirement emerges, but no current architecture should be distorted merely to anticipate it.

---

## 101. Command Journal and Immutable Snapshot Persistence

Project persistence shall use a command-journal plus periodic immutable-snapshot architecture rather than rewriting one monolithic project state on every change.

The persistence model should support:

- Ordered durable command/event records
- Transaction boundaries
- Periodic immutable snapshots of authoritative state
- Fast startup from the latest valid snapshot plus subsequent journal replay
- Validation of journal records before application
- Recovery from partially written or invalid tail records
- Effectively unlimited undo/redo subject to configured retention policy and available storage
- Future deterministic macro/replay functionality
- Auditability for diagnostics without requiring telemetry
- Safe compaction into newer snapshots

The implementation must distinguish clearly between:

- Authoritative project state
- Undo/redo history
- Recovery journal
- User backups
- Disposable caches

A failure in one layer must not unnecessarily invalidate the others.

---

## 102. Deleted Media Retention and Explicit Purge

Removing an asset or media object from the current project state shall not immediately make the underlying source bytes unrecoverable if they are still referenced by undo history, recovery snapshots, backup generations, or other retained project state.

Deleted media should remain recoverable until it becomes unreachable under the active retention policy.

AudioGubbins shall provide an explicit purge/cleanup workflow allowing the user to reclaim storage intentionally.

The purge workflow should:

- Show the amount of reclaimable storage
- Explain which history, recovery, or backup capabilities would be affected
- Distinguish safe cache deletion from irreversible source/history deletion
- Allow selective or comprehensive cleanup
- Require explicit confirmation before irreversible purge
- Never delete media still required by reachable authoritative state

Automatic storage-pressure cleanup may aggressively remove disposable caches first, but must not silently purge recoverable source media or protected history.

---

## 103. Git-Friendly Unpacked Project Format

In addition to a normal portable project bundle, AudioGubbins shall support an optional unpacked project representation designed for developer workflows and source control.

The unpacked format should prioritise:

- Stable directory structure
- Deterministic serialisation
- Human-readable structured metadata
- Stable identifiers
- Minimal meaningless diff churn
- Clear separation between metadata and binary media
- Relative paths where practical
- Tool-independent inspectability
- Compatibility with Git-based workflows

Binary audio remains binary and may optionally be managed by Git LFS or another user-selected repository strategy; AudioGubbins must not require a specific source-control provider.

The unpacked format and the portable bundle must represent the same logical project model and should be convertible in both directions without semantic loss, excluding disposable caches unless explicitly requested.

---

## 104. External Source Identity and Integrity Tracking

Externally linked source media shall not be identified solely by filename or path.

AudioGubbins should track a combination of available identity signals, including where practical:

- Persistent filesystem handle or equivalent capability token
- File size
- Modification timestamp
- Media/container metadata
- Fast fingerprints
- Cryptographic content hashes

For very large media, full cryptographic hashing may be performed progressively in the background when immediate full hashing would harm responsiveness.

The project should retain enough identity information to distinguish:

- The same unchanged file
- A modified version of the same external file
- A moved/relinked copy with identical content
- A different file occupying the previous path

External-change detection must integrate with the configurable external-source change policy defined elsewhere in this specification.

---

## 105. Automatic Backup Generations

AudioGubbins shall support automatic project backup generations distinct from ordinary undo/redo history and crash-recovery journalling.

Backup policy should be user-configurable and may include:

- Time-based checkpoints
- Save/activity-based checkpoints
- Retention by count
- Retention by age
- Retention by storage budget
- Protected/manual checkpoints that are never automatically pruned

Where filesystem capabilities permit, the user may select an external backup directory for automatic backup generations.

Where direct directory access is unavailable, backups may remain in managed application storage and be exportable on demand.

Backup generations should favour authoritative project data and required media references/content rather than disposable caches.

The application should make the distinction between autosave, crash recovery, undo history, snapshots, and backups understandable to users without requiring them to understand the underlying persistence architecture.

---

## 106. Storage Cleanup Priority

When storage pressure occurs, AudioGubbins should reclaim data in a safety-first order.

The default cleanup priority should be approximately:

1. Regenerable temporary data
2. Old disposable render/analysis caches
3. Rebuildable waveform/spectrogram caches
4. Unprotected redundant intermediates
5. User-approved expired backup/history data according to retention policy
6. Explicitly purged deleted media

Authoritative project state and live source media must never be silently sacrificed to free storage.

Before any cleanup that reduces recoverability, AudioGubbins must explain the consequence and require the user or an explicitly configured policy to authorise it.

---

## 107. Godot Integration Architecture

Godot integration is a first-class AudioGubbins subsystem rather than a simple export convenience.

The integration shall be designed as two cooperating but independently usable layers:

1. **AudioGubbins Godot Editor Addon** — an editor-facing Godot 4+ addon that runs inside the Godot editor.
2. **AudioGubbins Godot Runtime Addon** — an optional runtime-facing library that Godot games can use to consume AudioGubbins-authored assets, variation sets, events, metadata, and playback configuration.

Neither layer may become mandatory for using AudioGubbins itself.

The PWA must continue to support ordinary file export when no Godot addon is installed.

The editor and runtime layers must share stable versioned data contracts rather than depending on private implementation details.

---

## 108. AudioGubbins Godot Editor Addon

The Godot editor integration shall be implemented as a conventional Godot 4+ editor plugin under an `addons/` directory.

The main editor plugin script shall:

- Use the `@tool` annotation.
- Extend `EditorPlugin`.
- Execute only the minimum editor-time logic required for integration.
- Clean up all registered UI, signals, services, filesystem watches, and editor hooks when disabled.
- Avoid opaque or destructive modification of user scenes, project settings, or resources.

The addon may provide:

- An AudioGubbins dock or main-screen surface.
- Connection/status indicators.
- Linked AudioGubbins project information.
- Asset synchronisation state.
- Rebuild/re-export controls.
- Variation-set and event inspection.
- Import/reimport status.
- Diagnostics and degraded-capability explanations.
- Commands to reveal/open corresponding assets in AudioGubbins where browser/platform integration permits.
- User-controlled live-export and live-sync settings.
- Conflict and external-change resolution UI.
- Version compatibility reporting between the PWA project schema, interchange format, editor addon, and runtime addon.

The editor addon should use Godot's supported editor APIs rather than editing internal Godot-generated metadata directly whenever a supported API exists.

---

## 109. Godot Runtime Addon

AudioGubbins shall define an optional Godot runtime addon for games that want richer integration than plain exported audio files.

The runtime addon should remain lightweight and Godot-native.

Its responsibilities may include:

- Loading AudioGubbins-authored runtime metadata.
- Resolving named audio assets and variation sets.
- Selecting variations according to configurable strategies.
- Applying deterministic or non-deterministic randomisation.
- Managing repetition avoidance.
- Applying pitch, gain, start-offset, and other safe runtime variation parameters.
- Enforcing cooldowns and retrigger policies.
- Enforcing concurrency/polyphony rules.
- Applying priority and voice-stealing policies.
- Selecting AudioServer buses.
- Supporting 2D and 3D playback helpers.
- Exposing typed playback/event APIs to game code.
- Exposing signals for playback lifecycle and diagnostics.
- Supporting debug inspection in development builds.
- Remaining compatible with exported Godot games rather than only editor execution.

The runtime addon must not require the AudioGubbins PWA to be running during normal gameplay.

A shipped game shall consume generated/exported resources and metadata locally.

---

## 110. Godot-Native Resource Model

Where beneficial, AudioGubbins integration should generate Godot-native `Resource` objects rather than requiring game code to consume opaque JSON directly.

Candidate resource concepts include:

- `AudioGubbinsAsset`
- `AudioGubbinsVariation`
- `AudioGubbinsVariationSet`
- `AudioGubbinsEvent`
- `AudioGubbinsPlaybackProfile`
- `AudioGubbinsBank` or logical asset collection if a bank concept is later justified
- `AudioGubbinsManifest`

Names are provisional until the implementation architecture is finalised.

Godot-native resources should provide:

- Inspector integration.
- Stable identifiers.
- Typed properties.
- Human-readable `.tres` forms where practical.
- Clean source-control diffs for metadata.
- Runtime loading through normal Godot resource APIs.

Portable interchange metadata should remain separable from Godot-native generated resources so that AudioGubbins is not architecturally locked to Godot.

---

## 111. AudioGubbins Event Model for Godot

The runtime integration should provide an optional event-style abstraction above individual audio files.

An `AudioGubbinsEvent`-style object may define:

- One audio asset.
- One variation set.
- Multiple weighted sources.
- Nested logical groups where complexity remains understandable.
- Pitch range.
- Gain range.
- Start-offset range.
- Loop policy.
- Random seed policy.
- Repetition-avoidance policy.
- Cooldown.
- Maximum simultaneous voices.
- Voice-stealing strategy.
- Priority.
- Bus target.
- 2D/3D playback defaults.
- Distance/attenuation defaults where relevant.
- Runtime parameters.
- Tags/categories.
- Debug name and stable identifier.

This event model must complement rather than replace Godot's native audio system.

It should ultimately compile down to normal Godot audio streams, resources, buses, and playback nodes wherever practical.

---

## 112. Variation Sets as a First-Class Domain Concept

Variation sets shall be expanded into a first-class concept shared between AudioGubbins authoring and the optional Godot runtime integration.

A variation set may contain:

- Explicit hand-authored variants.
- Regions from a common source recording.
- Rendered derivatives generated from one source.
- Procedurally parameterised variants.
- Weighted members.
- Enabled/disabled members.
- Tags and semantic categories.
- Per-variant metadata.
- Shared processing/export settings.
- Per-variant overrides.

Variation-set authoring should support:

- Batch auditioning.
- Rapid repeated triggering.
- Shuffle/random playback.
- Weighted random playback.
- Sequential playback.
- Random-without-immediate-repeat.
- History-aware repetition avoidance.
- Loudness analysis and matching.
- Outlier detection.
- Similarity analysis where useful.
- Automatic indexing/naming.
- Manual ordering.
- Per-variant acceptance/rejection.
- Bulk processing.
- Bulk export.
- Export validation.
- Runtime preview using the same selection rules used by the Godot addon where practical.

Variation sets must retain stable member identifiers so renaming a rendered file does not unnecessarily break logical references.

---

## 113. Runtime Variation Selection

The Godot runtime addon should support configurable variation-selection strategies, including at minimum:

- Uniform random.
- Weighted random.
- Sequential.
- Ping-pong sequence where useful.
- Shuffle bag.
- Random with immediate-repeat prevention.
- Random with configurable recent-history exclusion.
- Deterministic seeded selection.
- User-supplied/custom strategy hooks in future.

Selection algorithms must have deterministic modes so gameplay systems, tests, replay systems, networking, or procedural generation can reproduce choices when supplied the same seed and state.

The default API should make high-quality repetition avoidance easy without requiring developers to write their own bookkeeping.

---

## 114. Runtime Parameterisation

AudioGubbins-authored runtime events and variation sets should allow safe, bounded runtime parameterisation.

Potential runtime-controlled parameters include:

- Gain.
- Pitch.
- Playback-rate-related parameters where semantically appropriate.
- Start offset.
- Variation weights.
- Probability.
- Bus selection from an allowed set.
- Spatial attenuation profile.
- Loop behaviour.
- Cooldown.
- Concurrency limits.

Authoring should distinguish between:

- Fixed authoring-time values.
- Randomised-at-trigger values.
- Game-controlled runtime parameters.

All runtime-controllable ranges should be explicitly bounded and serialised.

---

## 115. Godot Playback Components and API

The runtime addon should expose both component-oriented and service-oriented integration styles.

Potential interfaces include:

- `AudioGubbinsPlayer` for non-spatial playback.
- `AudioGubbinsPlayer2D` for 2D spatial playback.
- `AudioGubbinsPlayer3D` for 3D spatial playback.
- A lightweight runtime service/autoload for event lookup, shared concurrency, diagnostics, pooling, and global policy where appropriate.

These components should compose with or wrap Godot-native `AudioStreamPlayer`, `AudioStreamPlayer2D`, and `AudioStreamPlayer3D` behaviour rather than reimplementing Godot's mixer.

Developers should be able to choose between:

- Adding an AudioGubbins playback node in a scene.
- Calling a typed runtime API from code.
- Using native Godot playback directly with generated audio assets and ignoring the runtime addon entirely.

No integration style should unnecessarily lock the game into AudioGubbins.

---

## 116. Editor-to-Runtime Data Pipeline

AudioGubbins shall use an explicit authored-to-runtime pipeline for Godot integration.

Conceptually:

`AudioGubbins Project -> Export Recipes -> Rendered Audio + Runtime Metadata -> Godot-Native Generated Resources -> Runtime Addon`

The pipeline must clearly distinguish:

- Authoritative editable source/project data.
- Derived game-ready audio.
- Portable runtime metadata.
- Generated Godot-native resource wrappers.
- Disposable caches.

Generated runtime artefacts must be reproducible from authoritative AudioGubbins project data and export recipes.

A generated resource should not become the only copy of information required to rebuild it.

---

## 117. Live Godot Export and Synchronisation

Linked Godot targets shall support an optional seamless live-export workflow.

When enabled, relevant AudioGubbins changes may automatically trigger re-render/export after an appropriate debounce or explicit commit point.

Live export must support:

- Per-project enable/disable.
- Per-export-recipe enable/disable.
- Pause/resume.
- Visible pending/rendering/synchronised/error state.
- Safe write behaviour.
- User-configurable collision policy.
- Integration with Godot reimport behaviour where supported.
- Clear reporting when browser filesystem limitations prevent automatic writes.

The default workflow should minimise friction when repeatedly switching between AudioGubbins and Godot during game development.

---

## 118. Source and Generated Asset Placement

AudioGubbins shall support both primary repository strategies:

### External Masters

- AudioGubbins projects and high-resolution sources live outside the Godot repository.
- Only game-ready generated outputs are written into `res://`.

### Repository-Co-Located Masters

- AudioGubbins project metadata and/or source material may live inside the game's repository.
- Generated assets may also live in designated project subdirectories.

The application shall not force either model.

Path configuration must clearly distinguish authoritative source/project paths from generated-output paths so generated files can be cleaned/rebuilt safely.

---

## 119. Persistent Export Recipes

Export configurations shall be first-class persistent project objects rather than transient dialog state.

An export recipe may define:

- Output format.
- Codec settings.
- Sample rate.
- Bit depth or quality.
- Channel layout.
- Dithering policy where relevant.
- Processing/render-quality overrides.
- Naming template.
- Folder template.
- Target project.
- Target platform/profile.
- Collision behaviour.
- Live-export policy.
- Godot integration metadata.
- Runtime-resource generation policy.
- Inclusion in rebuild-all operations.

One source asset, region, or variation set may reference multiple export recipes.

This shall support one authoritative source producing multiple platform/game outputs without duplicating edit graphs.

---

## 120. Asset Groups and Inherited Game-Audio Policy

Assets, regions, variation sets, and events may be organised into hierarchical logical groups such as:

- `Footsteps/Grass`
- `Footsteps/Metal`
- `Weapons/Pistol`
- `UI/Confirm`
- `Ambience/Forest`

Groups may provide inherited defaults for:

- Processing chains.
- Loudness targets.
- Export recipes.
- Naming templates.
- Destination paths.
- Runtime variation policies.
- Bus assignment.
- Tags.

Inheritance must be explicit and inspectable.

Per-object overrides must be clearly distinguishable from inherited values and must support reset-to-inherited behaviour.

The inheritance system must avoid hidden state that makes it difficult to determine an asset's effective configuration.

---

## 121. Seamless Loop Analysis and Validation

Loop authoring shall include automatic quality analysis and diagnostics.

Potential checks include:

- Boundary discontinuity.
- DC mismatch.
- Level mismatch.
- Phase mismatch.
- Click/transient risk.
- Zero-crossing proximity.
- Spectral discontinuity.
- Crossfade suitability.
- Repeated-cycle stability.

AudioGubbins should be able to suggest candidate loop boundaries and appropriate micro-crossfades where beneficial while preserving user control.

Loop preview should support repeated cycling and stress-testing of the boundary.

Where target formats or Godot integration support loop metadata, exported configuration should preserve the intended loop semantics.

---

## 122. Game-Context Preview Simulator

AudioGubbins should include a game-context preview environment so game audio can be evaluated under conditions closer to runtime use.

Preview capabilities may include:

- Rapid one-shot triggering.
- Variation-set selection.
- Pitch/gain randomisation.
- Repetition-avoidance simulation.
- Concurrency limits.
- Voice stealing.
- Cooldowns.
- Layered event playback where later supported.
- 2D/3D attenuation preview.
- Distance simulation.
- Panning/spatial movement preview.
- Bus/routing preview where practical.
- Deterministic seeded simulation.
- Event parameter manipulation.

The preview simulator should reuse the same authored rules and, where feasible, equivalent runtime-selection logic as the Godot runtime addon to minimise authoring/runtime surprises.

---

## 123. Godot-Side Generated Descriptors

AudioGubbins may generate Godot resources, scripts, manifests, or other descriptors that help a game consume authored audio configuration.

Generation must be template- or integration-driven rather than assuming one game architecture.

The system should support:

- Built-in AudioGubbins runtime-addon descriptors.
- User-configurable templates in future.
- Project-specific templates in future.
- Versioned generated-resource schemas.

Generated code or resources must be clearly marked as generated and reproducible.

AudioGubbins must not silently overwrite hand-authored game logic.

---

## 124. Multiple Godot Targets

A single AudioGubbins project may target multiple Godot projects and/or multiple configurations of the same Godot project.

Examples include:

- Desktop game target.
- Mobile game target.
- Web game target.
- Demo project.
- Shared reusable Godot addon.
- Separate client/server repositories where audio packaging differs.

Each target may have independent:

- Root path/handle.
- Export recipes.
- Platform defaults.
- Naming/path templates.
- Live-export settings.
- Runtime-addon settings.
- Collision policies.
- Capability/status information.

Project-to-target relationships must use stable logical identifiers rather than assuming one fixed filesystem path.

---

## 125. Godot Addon Packaging and Independence

The Godot integration should be distributable as an ordinary Godot addon under a stable path such as:

`res://addons/audiogubbins/`

The package should be organised so that editor-only functionality is cleanly separated from runtime functionality.

The runtime portion must not accidentally depend on editor-only classes in exported games.

The editor portion may manage registration/setup for runtime helpers, but games that do not want the runtime layer should be able to use generated audio assets without it.

Version compatibility must be explicit between:

- AudioGubbins PWA version.
- AudioGubbins project/interchange schema.
- Godot editor addon version.
- Godot runtime addon version.
- Minimum supported Godot version.

---

## 126. Godot Integration Safety and Review Requirements

The Godot integration phases must receive dedicated reviewer coverage in addition to the normal multi-lens gate.

The reviewer must verify at minimum:

- `@tool` code does not perform unsafe scene/resource mutation implicitly.
- Editor addon disable/uninstall clean-up is complete.
- Runtime code contains no unintended editor-only dependencies.
- Generated resources are reproducible.
- Live export does not overwrite unexpected paths.
- Path traversal and malformed metadata are rejected.
- Version mismatches are surfaced clearly.
- Variation/event selection is deterministic when configured to be deterministic.
- Runtime allocation/performance is suitable for frequent game-audio triggering.
- Exported games remain functional without the AudioGubbins PWA.
- Removing the optional addon does not destroy source audio or AudioGubbins projects.


---

## 127. Godot Runtime Integration Direction

The AudioGubbins Godot integration is not limited to a lightweight variation helper.

It may evolve into a substantial first-party audio-authoring/runtime integration layer where doing so materially improves game-audio capability, iteration speed, determinism, or developer ergonomics.

The runtime layer should remain modular and should build on Godot's native audio facilities rather than replacing them without a concrete technical reason.

The preferred relationship is:

- AudioGubbins authors source audio, processing, events, variation rules, metadata, and export recipes.
- The AudioGubbins Godot editor addon imports, validates, synchronises, previews, and manages generated integration resources.
- The AudioGubbins Godot runtime addon evaluates authored runtime behaviour inside the game.
- Godot's native `AudioServer`, buses, `AudioStreamPlayer`, `AudioStreamPlayer2D`, `AudioStreamPlayer3D`, and other native playback facilities remain the low-level playback foundation where appropriate.

The integration may grow beyond this boundary if a later requirement demonstrably benefits from additional first-party runtime infrastructure.

The architecture must therefore avoid an artificially narrow API that would prevent AudioGubbins from becoming a more complete Godot-native audio middleware layer in future.

---

## 128. Parameter-Driven Runtime Audio Model

AudioGubbins events shall support typed runtime parameters that game code, editor tooling, animation systems, gameplay systems, or AudioGubbins-authored logic can set at runtime.

Parameter types should include, where useful:

- Float.
- Integer.
- Boolean.
- Enum/string identifier.
- Trigger/pulse.
- Vector-like values where future spatial or multidimensional use cases justify them.

Parameters may represent concepts such as:

- Surface type.
- Movement speed.
- Character weight.
- Weapon state.
- Engine RPM.
- Health.
- Intensity.
- Weather.
- Environment.
- Alert level.
- Material.
- Distance.
- Time of day.
- User-defined gameplay state.

The event system should support parameter use for:

- Variation selection.
- Weighted selection.
- Conditional branches.
- Layer enablement.
- Crossfades.
- Gain curves.
- Pitch curves.
- Filter or effect values where runtime processing is supported.
- Cooldowns.
- Concurrency rules.
- Routing/bus selection where safe.
- Transition rules.
- Sequence advancement.
- Probability modulation.

Parameter evaluation must be deterministic when all relevant event and random-state inputs are deterministic.

Advanced parameter behaviour should be authored visually in AudioGubbins where practical and serialised into explicit, versioned runtime data rather than hidden procedural behaviour.

The architecture should permit future concepts such as:

- Local event parameters.
- Global game parameters.
- Object-scoped parameters.
- Listener-scoped parameters.
- Parameter presets.
- Parameter snapshots.
- Parameter-driven state machines.
- Parameter automation curves.

---

## 129. Layered and Composite Events

An AudioGubbins event may contain multiple coordinated layers rather than representing only one audio file or one variation set.

A layered event may combine elements such as:

- Mechanical transient.
- Primary impact/blast.
- Environmental tail.
- Debris layer.
- Character vocalisation.
- Foley layer.
- Low-frequency reinforcement.
- Random accent layer.

Each layer may independently define:

- Source or variation set.
- Start delay.
- Gain range.
- Pitch range.
- Probability.
- Enable condition.
- Parameter-driven rules.
- Loop behaviour.
- Concurrency behaviour.
- Spatialisation policy.
- Routing/bus target.
- Random seed scope.
- Priority.

The event engine should support both parallel and ordered/sequence-oriented composition where useful.

The data model must be extensible enough to permit future graph-based event authoring without requiring replacement of the underlying event/resource format.

---

## 130. Advanced Event Authoring Direction

The runtime/event model should be designed to grow beyond simple randomised one-shots.

Future-capable authoring concepts may include:

- Random containers.
- Shuffle-bag containers.
- Sequential containers.
- Weighted branches.
- Parameter-conditioned branches.
- Switch containers.
- Layer containers.
- Blend/crossfade containers.
- Nested reusable sub-events.
- Event references.
- Delayed actions.
- Start/stop actions.
- Sustained/looping event states.
- Release tails.
- Transition regions.
- State-machine-like event behaviour.
- Stingers.
- Parameter snapshots.
- Bus/routing actions where appropriate.

These concepts must not be implemented as an untyped generic "anything graph" prematurely.

The implementation should introduce well-defined, typed domain nodes and contracts as requirements reach the relevant implementation phases.

The document's future-facing requirements are genuine product requirements and must not be dismissed by an implementation agent using YAGNI as justification for architectural dead ends.

---

## 131. Godot Generated Data Location

AudioGubbins-generated Godot integration data shall use a configurable project-relative output root.

The default should be explicit and discoverable rather than hidden. A recommended default is:

`res://audiogubbins/`

The user may change this location per Godot target.

The generated-data root may contain clearly separated subdirectories for concepts such as:

- Generated event resources.
- Variation-set resources.
- Manifests.
- Runtime metadata.
- Authoring/export metadata intended for Godot.
- Generated helper resources.

The Godot addon itself should remain independently installed under the conventional addon path:

`res://addons/audiogubbins/`

Disposable caches must not be mixed with source-controlled generated resources.

Generated resources must be clearly identifiable as generated and reproducible from authoritative AudioGubbins project data where technically possible.

---

## 132. Git and Source-Control Behaviour for Godot Integration

Generated textual Godot resources and manifests should be deterministic and Git-friendly.

Requirements include:

- Stable key ordering where the format permits it.
- Stable identifiers.
- Deterministic generation.
- Avoidance of timestamps or random values that create meaningless diffs unless they are semantically required.
- Human-inspectable metadata where practical.
- Clear generated-file headers/comments where supported.
- Reproducible regeneration.

Rendered binary audio may be committed to normal Git or managed with Git LFS according to repository policy.

AudioGubbins must not require Git LFS.

Disposable caches and machine-specific transient state must be separable from source-controlled project content and suitable for ignore rules.

---

## 133. Runtime Independence and Open Asset Principle

AudioGubbins-rendered audio must remain ordinary usable audio assets.

The runtime addon must not trap rendered media in a proprietary package that makes the underlying files unusable without AudioGubbins.

If the runtime addon is removed:

- Rendered WAV/Ogg/MP3/etc. assets remain valid ordinary Godot-importable files.
- AudioGubbins source projects remain valid outside Godot.
- Only AudioGubbins-specific event/variation/runtime behaviour is lost.

Generated AudioGubbins runtime resources must be documented and versioned.

The runtime layer should favour Godot-native resources and APIs where that improves interoperability and inspectability.

---

## 134. Live Synchronisation Architecture

Initial live integration should prefer direct filesystem/project synchronisation using capabilities already available to the PWA and Godot editor addon.

A mandatory native background service or daemon must not be required for ordinary AudioGubbins usage.

Initial live iteration may use mechanisms such as:

- Direct export to watched Godot project paths.
- Manifest/revision files.
- Godot editor filesystem/resource change detection.
- Explicit refresh/reimport actions initiated by the editor addon where supported.

If browser sandbox restrictions later prevent a materially better integration experience, AudioGubbins may introduce an optional local bridge component.

Any such bridge must be:

- Optional.
- Explicitly installed by the user.
- Authenticated/authorised appropriately.
- Narrowly scoped.
- Local-first.
- Independently versioned.
- Unnecessary for standard browser/PWA editing.

The core PWA must never silently depend on a local daemon.

---

## 135. Godot Runtime Diagnostics and Debugging

The Godot integration shall include rich optional development diagnostics.

Editor and runtime diagnostic surfaces should be able to expose, where relevant:

- Triggered event name/identifier.
- Selected variation.
- Selection reason.
- Random seed/state.
- Parameter values.
- Active event layers.
- Event instance lifetime.
- Active voices.
- Voice priority.
- Concurrency group.
- Rejected triggers.
- Voice-stealing decisions.
- Cooldown state.
- Target bus.
- 2D/3D playback mode.
- Source asset provenance.
- AudioGubbins project/resource origin.
- Runtime resource/schema version.

Diagnostics should support filtering and must avoid creating material runtime overhead when disabled.

Production exports must be able to exclude or disable development-only debug UI and verbose diagnostics cleanly.

---

## 136. AudioGubbins Agent Implementation Guardrails

This specification is intended to be implemented by an advanced coding agent. The agent must therefore follow explicit architectural guardrails rather than relying on generic coding slogans or default AI-generated project structure.

These guardrails are requirements, not optional style advice.

### 136.1 Principles Are Heuristics, Not Excuses

The implementation agent must not apply slogans such as YAGNI, DRY, KISS, SOLID, or design-pattern names mechanically.

In particular:

- **YAGNI must not be used to reject future capabilities explicitly required by this specification.** Documented future multitrack, plugin, Godot runtime, cloud, automation, and other extension requirements are real architectural constraints even when their user-facing feature is scheduled later.
- **DRY must not force unrelated concepts into shared abstractions merely because their current code looks similar.** Prefer duplication over incorrect coupling when two concepts do not yet share a stable domain abstraction.
- **KISS must not be interpreted as "choose the least capable architecture".** Simplicity means clear boundaries and comprehensible design, not sacrificing robustness or future requirements.
- **SOLID must not be reduced to excessive interfaces, one-method classes, or dependency-injection ceremony.** Apply the underlying design intent where it improves cohesion and substitutability.
- A named design pattern is not evidence that a design is good. Patterns must solve an actual documented problem.

### 136.2 No God Objects or Monolithic Modules

The implementation must not centralise unrelated responsibility into objects such as:

- `AppManager`.
- `AudioManager`.
- `ProjectManager`.
- `StateManager`.
- `GodService`-style orchestration classes.
- Giant stores that own unrelated domains.
- Mega-components containing workspace, audio, persistence, transport, and editing behaviour together.

Names such as `Manager`, `Service`, `Controller`, `Engine`, or `System` are permitted only when the implementation has a narrow, explicit, cohesive ownership boundary.

Modules should be organised around stable domain responsibilities and dependency direction.

### 136.3 Cohesive Module Boundaries

Each module/package must have:

- A clearly stated responsibility.
- Explicit public contracts.
- Explicit dependencies.
- A reason for ownership of its state.
- Tests at the appropriate boundary.

Likely bounded areas include, subject to architecture refinement:

- Project domain.
- Asset/media domain.
- Timeline/edit domain.
- Command system.
- Undo/history.
- Persistence.
- Codec/import/export.
- DSP graph.
- Realtime playback.
- Recording.
- Analysis/waveform/spectral rendering.
- Workspace/UI shell.
- Godot interchange.
- Runtime event authoring.
- Capability detection.

Cross-domain access must occur through typed contracts rather than arbitrary imports into internal implementation details.

### 136.4 Dependency Direction

Dependency direction must be deliberate and testable.

UI components must not become the authoritative owner of project/audio state.

UI code must not bypass the command/domain layer to mutate project data directly for convenience.

Persistence formats must not leak throughout the domain model.

Browser-specific API adapters must be isolated behind capabilities/contracts so that platform APIs do not become implicit global dependencies.

DSP domain logic should not depend on visual components.

Godot integration should consume stable interchange/domain contracts rather than reaching into unrelated editor internals.

### 136.5 Avoid Premature Generic Abstractions

The agent must not create vague frameworks such as generic `BaseManager`, `AbstractThingFactory`, universal event buses, universal repositories, generic graph engines, or catch-all plugin systems before concrete domain requirements justify them.

Prefer:

1. A concrete cohesive implementation.
2. A second concrete use case when required.
3. Extraction of the stable shared concept only when the domain relationship is understood.

This rule does not prohibit intentionally designed extension points that are explicitly required by this specification.

### 136.6 Avoid Hidden Coupling

Do not use implicit global mutable state as a shortcut.

Avoid hidden communication through:

- Global singleton bags.
- Unstructured event emitters.
- Stringly typed message names.
- Mutable module globals.
- DOM events as a substitute for domain contracts.
- Storage side effects as inter-module messaging.

Where event-driven communication is appropriate, events must be typed, scoped, documented, and owned by a clear subsystem.

### 136.7 File and Function Size Review Thresholds

Source size thresholds are review triggers, not code-golf targets.

As a default:

- A production source file approaching roughly 300–400 logical lines should trigger a cohesion review.
- A function approaching roughly 50–70 logical lines should trigger a decomposition review.
- A class/object with a large number of unrelated methods or dependencies should trigger an ownership review even if its line count is small.

Exceeding a threshold is acceptable when cohesion genuinely warrants it and the reviewer records the justification.

Splitting one coherent concept into meaningless tiny files merely to satisfy a number is prohibited.

### 136.8 Explicit Complexity Budgets

Each implementation phase must identify likely complexity hotspots.

Reviewers must actively inspect:

- Modules with unusually high dependency fan-in/fan-out.
- Deep inheritance trees.
- Large state stores.
- Highly connected event graphs.
- Repeated conditionals encoding the same domain rule.
- Functions with high branching complexity.
- Classes/modules that keep gaining unrelated responsibilities across phases.

Complexity must be reduced structurally rather than hidden behind comments or helper functions.

### 136.9 No Phase Leakage

An implementation agent must not partially implement later phases opportunistically unless required to establish a stable current-phase contract.

If future capability requires an extension point now, implement the minimal robust contract needed now and document the deferred implementation.

Do not add half-working future features, dead UI, speculative configuration, or placeholder production APIs that will be mistaken for supported behaviour.

### 136.10 No Permanent Temporary Hacks

Temporary compromises are allowed only when all of the following are true:

- They are necessary to unblock the current phase.
- They do not compromise data integrity or security.
- They are clearly marked in code and the phase record.
- They have an explicit removal task.
- The removal task is scheduled before the phase gate can pass unless the reviewer explicitly accepts the debt as non-blocking.

Comments such as `TODO later`, `temporary`, `quick fix`, or `hack` without a tracked remediation item are not acceptable.

### 136.11 Domain Rules Must Have One Authoritative Home

Business/domain rules must not be independently reimplemented in UI, storage, worker, and Godot-integration layers.

Examples include:

- Selection precedence.
- Export collision policy.
- Event variation selection.
- Loop rules.
- Project-version compatibility rules.
- Command validation.

Presentation layers may adapt the result, but authoritative rules must have a single clear owner with direct tests.

This is the appropriate use of DRY: avoid duplicated **domain truth**, not superficial duplicated syntax.

### 136.12 Typed Contracts and Runtime Validation

TypeScript compile-time typing is necessary but not sufficient at trust boundaries.

Use explicit schemas/runtime validation for:

- Project files.
- Portable bundles.
- Godot interchange manifests.
- Worker messages.
- Plugin/interchange data.
- Imported external metadata.
- Future network/cloud boundaries.

Internal contracts should avoid `any`, unbounded dictionaries, and stringly typed state when a domain type can express the invariant.

### 136.13 Architecture Tests

Architecture constraints should be executable where practical.

The project should include automated tests/lint rules capable of detecting violations such as:

- Forbidden dependency directions.
- UI packages importing persistence internals.
- Runtime Godot code depending on editor-only APIs.
- Domain packages importing browser-specific adapters directly.
- Circular dependencies.
- Cross-package use of non-public internals.

Architecture tests are part of CI and phase review.

### 136.14 Comments and Documentation

Comments should explain intent, invariants, non-obvious trade-offs, and reasons.

Do not generate commentary that merely restates code.

Public/domain contracts should be documented well enough for another agent or developer to use them without reading implementation internals.

Important architectural decisions should be captured as ADRs or equivalent decision records, especially where multiple valid designs were considered.

### 136.15 Error Handling Must Be Designed

The agent must not use blanket `try/catch` blocks, silent fallbacks, or logging-and-continuing as substitutes for defined failure behaviour.

Each boundary should define:

- Recoverable errors.
- Fatal errors.
- User-actionable errors.
- Retryable errors.
- Data-integrity failures.
- Capability degradation.

Errors should preserve causal information and be presented to users at the correct abstraction level.

### 136.16 Performance Must Not Destroy Architecture

Optimisation may introduce specialised paths, caches, worker pipelines, WASM, pooled resources, and GPU acceleration.

These optimisations must remain behind stable contracts so that performance code does not become the domain model.

Measure before and after optimisation.

Do not micro-optimise ordinary code while leaving architectural bottlenecks such as main-thread DSP, full-buffer copies, or excessive cross-thread serialisation unresolved.

### 136.17 Reviewer Enforcement

Every phase's Architecture and Code Quality reviewers must explicitly answer:

- Did this phase introduce or enlarge a god object?
- Did any module gain unrelated responsibilities?
- Did the implementation introduce speculative abstractions without a concrete requirement?
- Did DRY/YAGNI/KISS/SOLID reasoning cause loss of required capability or incorrect coupling?
- Are dependency directions still valid?
- Is domain logic duplicated across layers?
- Are files/functions exceeding review thresholds still cohesive?
- Did UI code bypass typed command/domain APIs?
- Did temporary debt escape the phase without explicit acceptance?
- Can the next phase extend this work without invasive rewrites?

A blocking finding in these areas prevents the phase gate from passing.

---

## 137. Specification Clarity Requirements for Agent Execution

Before implementation phases are considered ready for execution, the specification itself must be hardened so an implementation agent does not need to infer critical architecture.

Each implementation phase must ultimately include:

- Objective.
- Explicit in-scope work.
- Explicit out-of-scope work.
- Prerequisites.
- Required domain concepts.
- Required public interfaces/contracts.
- Expected package/module ownership.
- Data-flow description.
- Persistence implications.
- Browser capability implications.
- Performance constraints.
- Security/privacy constraints.
- Accessibility implications.
- Failure modes.
- TODO checklist.
- Required unit tests.
- Required integration tests.
- Required end-to-end tests where relevant.
- Required audio golden/regression tests where relevant.
- Acceptance criteria.
- Reviewer lenses.
- Gate conditions.
- Deferred work explicitly linked to future phases.

Ambiguous phrases such as "implement robustly", "support as needed", "use best practices", or "handle edge cases" are insufficient when concrete behaviour can be specified.

The specification should state the invariant, observable behaviour, or review criterion instead.

Implementation agents must not invent product behaviour silently when the specification contains a genuine unresolved decision.

Where the standing decision rules make the answer unambiguous, the agent should apply those rules rather than stopping for unnecessary approval.


---

## 138. Local Machine-Learning Processing

AudioGubbins shall support machine-learning-assisted audio processing where it materially improves restoration, cleanup, separation, analysis, or creative workflows. ML model packs may be optional for users to install because of their size, but ML infrastructure and the identified ML-assisted processor families are part of the planned AudioGubbins feature scope rather than being deferred solely by release-version labels.

ML functionality must remain local-first. Core ML processors shall not require audio to be uploaded to a remote service.

Candidate ML-assisted capabilities include:

- Advanced broadband noise removal
- Speech/dialogue enhancement
- Dereverberation
- Source separation
- Stem isolation
- Transient/noise classification
- Click/pop/artefact detection
- Intelligent restoration assistance
- Content-aware repair suggestions
- Optional analysis assistants that recommend processing without silently applying it

ML-derived results must remain non-destructive and must integrate with the same parametric edit graph, command architecture, undo/redo model, preview system, and final-render pipeline as conventional DSP.

Where an ML operation cannot be represented entirely by compact parameters, its authoritative inputs, model identity, model version, operation settings, masks/regions, and reproducibility metadata must be retained. Generated previews or intermediate inference outputs may be cached but must not become the sole authoritative project state.

No ML feature may silently transmit audio, project metadata, or derived content off-device.

---

## 139. ML Model Packs and Storage

Large ML models shall be distributed and managed as optional capability packs rather than forcing the base PWA bundle to include every model.

Model-pack management must support:

- Explicit model name and purpose
- Model version
- Download size
- Installed size
- Integrity/hash verification
- Licence information
- Compatibility information
- Quality/performance tier where applicable
- Download progress
- Pause/cancel/retry
- Storage-location abstraction where practical
- Removal and cleanup
- Update availability
- Rollback or retention of required historic versions where post-1.0 project reproducibility requires it

Models must not be downloaded merely because a project is opened unless they are required and the user has enabled an appropriate automatic-download policy.

The application shall clearly distinguish:

- Required model unavailable
- Optional enhancement unavailable
- Model update available
- Model incompatible with current runtime
- Model unavailable because of browser/device capability

Resource-heavy models may expose quality tiers such as Draft, High, and Maximum, with advanced users able to inspect the underlying model and inference settings where meaningful.

---

## 140. Typed Directed Processing Graph

The canonical processing architecture shall be a typed directed graph rather than a permanently linear effect-chain implementation.

The initial user interface may present conventional linear effect racks for approachability, but the engine must support future graph capabilities without architectural replacement.

The graph architecture must be capable of representing:

- Serial processing
- Parallel branches
- Split/mix paths
- Wet/dry paths
- Side-chain inputs
- Mid/side branches
- Analysis-only nodes
- Render/cache nodes
- Future multitrack sends and returns
- Future buses
- Future parameter-controlled routing
- Reusable subgraphs
- Future plugin-host nodes

Graph nodes and edges must use explicit typed contracts.

Invalid graph states must be rejected deterministically with actionable diagnostics.

The graph implementation must avoid a central god-object processor manager. Node lifecycle, scheduling, graph validation, latency propagation, and render planning should be decomposed into cohesive subsystems with explicit ownership and dependency direction.

---

## 141. DSP Implementation Languages

TypeScript remains the primary application, domain, orchestration, and UI language.

Performance-critical, numerically sensitive, safety-critical, or deterministic DSP infrastructure should use WebAssembly where it provides material benefits.

For new AudioGubbins-owned WASM/DSP infrastructure, Rust is the preferred default implementation language because of:

- Memory safety
- Strong type system
- Mature WebAssembly support
- Suitability for deterministic numerical code
- Strong tooling
- Good interoperability with generated bindings

This is a default, not an ideological restriction.

Mature C/C++ or other native-code libraries may be used where they provide objectively stronger DSP, codec, numerical, or interoperability capabilities and satisfy licensing, security, maintainability, portability, and deterministic-render requirements.

Language selection must never be made solely because one option is easier or faster for the implementation agent.

Bindings between TypeScript and WASM must use narrow, documented, typed interfaces and avoid leaking implementation-specific memory ownership throughout the application.

---

## 142. Open-Source Licence

AudioGubbins shall use the **Apache License 2.0** as the default project licence unless a later explicit project decision changes it.

This choice is intended to preserve permissive commercial and non-commercial reuse while providing an explicit patent licence/grant suitable for a project expected to include DSP, codecs, WebAssembly, and external contributors.

Dependency selection must include explicit licence review.

The project must maintain machine-readable and human-readable third-party attribution/licence information where required.

Dependencies with reciprocal/copyleft obligations must be evaluated deliberately before adoption. No implementation agent may introduce a dependency whose licence materially changes redistribution obligations for AudioGubbins without documenting the implications and passing the relevant architecture/licensing review gate.

Codec patent/licensing status must be considered separately from source-code licence compatibility.

---

## 143. Render Quality Policy

Final rendering and export shall default to the highest-quality practical processing path appropriate to the selected output format and operation.

The final-render path should prioritise:

1. Signal quality
2. Determinism/reproducibility
3. Numerical correctness
4. Preservation of source fidelity
5. Robustness
6. Performance

Performance must not be prioritised over final quality merely to reduce render time.

Users must retain control over quality/performance trade-offs.

Where meaningful, rendering should expose presets such as:

- Draft
- Standard
- High
- Maximum
- Custom

The normal default for final export should favour High or Maximum quality according to the processor/format, while preview workflows may use lower-latency paths.

Advanced settings should expose the actual underlying parameters rather than presenting opaque quality labels only.

Any non-deterministic or platform-native fast-render path must be explicitly identified and must not silently replace the canonical deterministic render path.

---

## 144. Processor Latency and Automatic Delay Compensation

Processor latency must be a first-class engine concept from the initial DSP architecture.

Processors that introduce latency must report it accurately or expose sufficient information for the engine to calculate it.

Examples include:

- Look-ahead dynamics
- Linear-phase filtering
- Convolution
- Spectral processing
- ML inference
- Oversampled processors
- Time-domain buffering

The processing graph must propagate latency information and provide automatic delay compensation where required so that:

- Parallel processing paths remain phase/time aligned
- Future multitrack playback remains aligned
- Side chains remain coherent
- Offline renders remain sample-correct
- Monitoring latency can be reported accurately

Latency compensation must not be retrofitted as a future multitrack-only concern.

---

## 145. Processor Versioning and Reproducibility

Processor identity and implementation version shall be persisted as part of authoritative project state where the processor's behaviour can affect rendered output.

At minimum, reproducibility metadata should be capable of identifying:

- Processor type
- Processor implementation version
- Parameter schema version
- Relevant model version for ML processors
- Relevant codec/resampler implementation version where necessary
- Render-engine version or compatibility level where necessary

Before version 1.0.0, the existing pre-1.0 breaking-change policy applies: legacy processor compatibility layers are not required, and incompatible stored data may require backup/export followed by reset.

From version 1.0.0 onward, AudioGubbins must deliberately manage processor evolution so that opening an older project does not silently alter its sound.

Post-1.0 strategies may include:

- Retaining compatible legacy implementations
- Explicit processor migration
- Version-pinned rendering
- User-visible upgrade comparison
- Render-freezing/archive workflows

Silent sonic changes caused solely by an application upgrade are not acceptable after 1.0.0.

---

## 146. DSP Architecture Review Requirements

Every implementation phase that introduces or materially changes DSP infrastructure must include review of:

- Deterministic behaviour
- Numerical stability
- Denormal handling where relevant
- Clipping and headroom
- Channel-count correctness
- Sample-rate correctness
- Latency reporting
- Delay compensation
- Parameter smoothing
- Thread/worker safety
- Real-time safety for AudioWorklet code
- Allocation behaviour on real-time paths
- WASM boundary overhead
- Cache invalidation correctness
- Processor versioning
- Offline versus real-time equivalence
- Golden audio regression coverage

Real-time processing code must not perform unbounded allocation, filesystem access, network access, blocking waits, or other operations unsuitable for an audio rendering thread/worklet.

Golden/regression audio tests should compare outputs using both exact checks where determinism permits and perceptually/numerically appropriate tolerances where exact bit identity is not guaranteed.

---

## 147. Release-Version Philosophy

AudioGubbins version numbers are project-owner-controlled release labels, not rigid feature-completeness gates.

Version `1.0.0` shall occur when the project owner judges the application ready for that label. The implementation plan must not defer valuable capabilities merely because they are conventionally considered "post-1.0" features, nor must it force an arbitrary feature checklist to be completed solely to justify the `1.0.0` label.

Development shall continue continuously across pre-release and release-labelled versions. Phase planning, architectural quality, test quality, and feature prioritisation must therefore be based on product value, technical dependencies, risk, and implementation readiness rather than semantic-version prestige.

The one explicit version-dependent compatibility contract currently retained is the project/schema migration policy:

- Before `1.0.0`, breaking persisted-schema changes may require backup/export followed by reset, and compatibility shims are not required.
- From `1.0.0` onward, supported migration and backwards-compatibility responsibilities begin as defined elsewhere in this specification.

No other requirement may infer that a feature is excluded merely because AudioGubbins has not yet reached `1.0.0`.

---

## 148. Continuous Feature-Delivery Policy

Capabilities should be implemented when their architectural prerequisites are ready and their implementation can pass the required phase gates.

The specification must not divide features into "real product" versus "future product" solely on the basis of a target marketing version.

In particular:

- Local ML restoration, separation, enhancement, model-pack infrastructure, and related ML workflows are intended implementation scope.
- The Godot editor addon and runtime addon are first-class product subsystems.
- The Godot runtime event system should be made as powerful and flexible as is technically justified by the architecture and phase dependencies.
- Advanced game-audio authoring capabilities should not be artificially postponed to preserve a narrow pre-1.0 feature set.
- Multitrack remains a later implementation area because of dependency/order decisions, not because it is intrinsically "post-1.0".

Feature sequencing must remain dependency-driven and quality-gated.

---

## 149. Release Channel and Maturity Labels

AudioGubbins should use the progression:

1. Alpha
2. Beta
3. Release Candidate
4. Final/stable release

These labels are intentionally conservative and are assigned by the project owner.

The project owner may continue to label a build Alpha or Beta even when its technical maturity, feature completeness, or stability might conventionally lead another project to call the same build a release candidate or final release.

Implementation agents, documentation, automation, and release tooling must not reinterpret or automatically promote maturity labels based on conventional industry expectations.

Release labels should communicate the owner's current confidence and intent, while objective quality evidence remains separately recorded through:

- Automated test results
- Browser/device compatibility results
- Performance benchmarks
- Recovery/data-integrity testing
- DSP regression testing
- Accessibility review
- Security review
- Real-world project usage
- Known issue tracking

A conservative maturity label must not be used as justification for lower engineering quality.

---

## 150. Real-World Validation Before Stable Releases

AudioGubbins should progress through meaningful real-world usage before stable/final releases are declared.

Validation should include substantial use on real audio-editing and Godot projects, including projects maintained by the project owner where practical.

Release readiness should consider evidence from:

- Long-running editing sessions
- Real game-audio production workflows
- Recording sessions
- Large and small source assets
- Crash/reload/recovery scenarios
- Storage pressure scenarios
- Browser upgrades
- PWA updates
- Godot live-export workflows
- Godot editor-addon workflows
- Godot runtime-addon workflows
- Touch, Surface-class, pen, mouse, and keyboard interaction
- Multiple supported browsers and operating systems

Feature completion alone is not sufficient evidence of production quality, but this validation policy does not impose an automatic semantic-version number. The final version label remains a project-owner decision.


---

## 151. Initial Front-End and Workspace Technology Selection

The initial web application technology baseline shall be:

- **React 19.x** for the application shell, docked workspace, inspectors, menus, dialogs, settings, accessibility-oriented UI, and component composition.
- **TypeScript** with the strictest practical compiler settings; application/domain code must not rely on implicit `any`, unchecked boundary data, or broad type assertions as an escape hatch.
- **Vite 8.x** as the development/build foundation, retaining the already-established requirement for local development, static production builds, PWA packaging, and GitHub Pages deployment.
- **Radix Primitives** as the preferred low-level accessible primitive layer for conventional interactive UI such as dialogs, menus, popovers, toolbars, sliders, tabs, and related controls. AudioGubbins shall build its own design system and visual identity on top rather than adopting a generic pre-styled component theme.
- **Dockview** as the initial docking/workspace engine, wrapped behind AudioGubbins-owned workspace contracts so the domain/application architecture is not coupled directly to Dockview APIs.
- **Motion for React** for rich application-shell animation and interaction feedback where it provides a clear UX benefit, while direct audio-editing manipulation and performance-critical canvases remain independent of React animation state.

This stack is selected because it combines a mature component ecosystem, strong accessibility primitives, professional docking capability, sophisticated animation support, and compatibility with custom high-performance rendering layers.

Framework choice must not cause high-frequency audio, meter, playhead, waveform, spectrogram, or pointer-motion state to flow through ordinary React component state on every update. Performance-critical state must use specialised stores, external subscriptions, shared buffers where available, renderer-owned state, or other bounded mechanisms appropriate to the subsystem.

The UI framework is an adapter over the AudioGubbins application/domain core. Core editing logic, project state, commands, DSP graphs, persistence rules, and file formats must remain independently testable without rendering React components.

---

## 152. High-Performance Editor Rendering Layer

Waveform, spectrogram, timeline, meter, selection-overlay, and other high-frequency visualisation systems shall use a dedicated renderer abstraction rather than DOM-heavy rendering or React reconciliation for every visual element.

The initial implementation may use **PixiJS 8.x** as a retained-mode GPU-accelerated rendering foundation where it materially accelerates implementation without constraining AudioGubbins' rendering requirements.

AudioGubbins must own the renderer-facing contracts so that rendering backends can evolve independently.

The renderer architecture shall support:

- WebGPU where available, validated, and sufficiently stable for the required feature path
- WebGL2 as a robust production fallback
- Canvas 2D or reduced renderer paths where necessary for graceful degradation
- High-DPI rendering
- Touch/stylus hit testing
- Large timeline coordinate spaces
- Virtualised/offscreen content
- Layered waveform/spectrogram/selection overlays
- GPU resource lifecycle management
- Context/device loss recovery
- Renderer capability diagnostics

No authoritative editor/domain state may be stored only inside the graphics scene graph.

The renderer must be reconstructible from domain/view state after renderer reset, GPU device loss, tab restoration, or capability-path changes.

---

## 153. State Ownership and Workflow State

AudioGubbins must not create a single global application store containing all project, UI, renderer, audio, and job state.

State shall be partitioned according to ownership and lifetime, including at least:

- Authoritative project/domain state
- Persisted command journal/history state
- User preferences
- Workspace/layout state
- Per-editor-view state
- Ephemeral interaction state
- Audio-engine runtime state
- Renderer runtime state
- Background job state
- Capability/runtime diagnostics

The typed command/domain layer remains authoritative for meaningful project mutations.

React-facing state libraries may be used for UI-oriented state, but they must not become an alternative domain model or bypass command validation, transactions, undo/redo, persistence, or architectural boundaries.

Explicit state machines should be used where workflows have meaningful lifecycle rules, failure/recovery states, or concurrency constraints—for example recording, export jobs, schema reset/backup flows, project ownership transfer, PWA updates, and long-running model installation—rather than representing complex lifecycle behaviour through scattered booleans.

---

## 154. Repository and Package Topology

AudioGubbins should use a single coordinated monorepo while the web application, Rust/WASM DSP, shared schemas, Godot editor addon, and Godot runtime addon are evolving together.

The repository shall use **pnpm workspaces** or an equivalently capable workspace system, with exact dependency versions locked by the repository lockfile.

A representative topology is:

```text
/
├─ apps/
│  └─ web/                    # AudioGubbins PWA
├─ packages/
│  ├─ domain/                 # Framework-agnostic project/domain model
│  ├─ commands/               # Typed command contracts and execution
│  ├─ project-format/         # Schemas, serialisation, validation
│  ├─ storage/                # OPFS/external/project storage adapters
│  ├─ audio-engine/           # TS orchestration for playback/graph engine
│  ├─ renderer/               # Editor renderer contracts/backends
│  ├─ design-system/          # AudioGubbins React UI/design tokens
│  ├─ workspace/              # Docking/workspace integration
│  ├─ codecs/                 # Codec orchestration/contracts
│  ├─ godot-schema/           # Shared generated/runtime integration schemas
│  └─ test-fixtures/          # Reusable deterministic fixtures
├─ crates/
│  ├─ dsp-core/               # Rust DSP primitives
│  ├─ resampling/             # Canonical resampling implementation
│  ├─ analysis/               # FFT/analysis primitives as appropriate
│  └─ wasm-bindings/          # Narrow WASM boundary layer
├─ godot/
│  ├─ addons/audiogubbins/    # @tool editor addon
│  └─ runtime/                # Runtime addon/package sources
├─ tools/                     # Build/codegen/validation tooling
├─ docs/                      # Architecture/ADRs/spec-derived documentation
└─ tests/                     # Cross-package/system/golden fixtures as appropriate
```

The exact topology may evolve through ADR-reviewed changes, but package boundaries must reflect subsystem ownership rather than arbitrary file-count splitting.

Packages must not be introduced merely to make the repository look modular. Each package requires a coherent responsibility, explicit dependency direction, and independently testable contract.

Circular package dependencies are prohibited.

---

## 155. Styling and Design-System Architecture

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

## 156. Video Reference and Sound-to-Picture Workflows

AudioGubbins shall support opening video and gameplay-reference media alongside audio for sound-design-to-picture workflows without attempting to become a general-purpose video editor.

The video-reference subsystem should support, where technically available:

- Synchronised audio/video transport
- Frame-accurate or best-available frame-aware scrubbing
- Timecode and frame display
- Configurable frame-rate interpretation
- Timeline markers and regions aligned to picture
- Waveform/spectrogram editing while picture remains synchronised
- Video thumbnails or filmstrip views where useful
- Detachable/dockable video preview panel
- Full-screen or enlarged picture preview
- Offset/calibration controls for externally prepared reference media
- Import of common browser-decodable video formats with capability-based fallback handling
- Extraction or reference of embedded audio tracks where legally and technically practical
- Export of edited audio independently from the reference video

The authoritative AudioGubbins project must treat video as reference media unless a later specification explicitly introduces video-editing capabilities. Video-reference support must not cause the project architecture to become coupled to a non-existent video-editing model.

The transport and timeline abstractions must therefore support a shared media clock suitable for future multitrack, picture sync, recording, and external-reference use.

---

## 157. Multichannel, Surround, and Ambisonic Audio

AudioGubbins shall support professional multichannel authoring beyond mono and stereo.

The channel model must be layout-aware rather than relying only on channel count. It should be capable of representing, validating, displaying, processing, and exporting layouts such as:

- Mono
- Stereo
- LCR
- Quadraphonic layouts
- 5.1
- 7.1
- Other discrete-channel layouts supported by relevant formats
- Ambisonic channel sets and ordering/normalisation conventions where supported
- Custom labelled channel maps

The architecture shall include explicit channel-layout metadata and channel-role identity. Channel order must not be inferred from array position alone when a format or workflow requires semantic channel identity.

Waveform, metering, selection, processor, routing, analysis, export, and future multitrack contracts must all be designed for N-channel operation.

Where a processor cannot support an input layout, it must declare that limitation explicitly and provide a well-defined adaptation policy where one is acoustically valid. Silent downmixing or accidental channel truncation is prohibited.

AudioGubbins should support professional channel-layout operations, including:

- Remapping
- Reordering
- Extraction
- Duplication
- Downmixing
- Upmix-assist workflows where appropriate
- Per-channel gain/polarity/delay
- Linked and unlinked processing
- Mid/side and other matrix operations
- Surround metering
- Phase/correlation analysis
- Ambisonic encode/decode/rotate/normalisation utilities where supported

Export recipes must preserve or intentionally transform channel-layout metadata according to explicit user configuration.

---

## 158. MIDI Scope Exclusion

MIDI input, MIDI sequencing, MIDI controllers, and MIDI control-surface integration are not current AudioGubbins requirements.

The implementation must not add MIDI infrastructure speculatively.

Generic command, automation, parameter, and input-abstraction systems should remain clean enough that MIDI could be considered in a future specification if requirements change, but no present phase should include MIDI work merely for hypothetical extensibility.

---

## 159. Future Native Host or Local Bridge

AudioGubbins remains a browser-first, installable PWA and must not require a native executable, daemon, local server, or companion process for its core functionality.

A future optional native host or local bridge may be considered if it unlocks material capabilities that browsers cannot expose reliably, such as:

- Deeper filesystem integration
- Lower-latency or more controllable audio I/O
- System/loopback audio capture
- Native codec or DSP acceleration
- OS-level file associations
- Native drag/drop or shell integration
- Richer communication with running game/editor processes
- Expanded local-device discovery

A future native host should preferentially reuse the same AudioGubbins web UI, domain contracts, project formats, DSP contracts, and test fixtures rather than creating a divergent second application. Technologies such as Tauri may be evaluated at that time, but no native-host framework is selected by this specification.

Native enhancements must remain optional unless a future requirement explicitly changes the browser-first product model.

---

## 160. Musical Timeline and Tempo Features — Deferred Possibility

Tempo maps, bars/beats, beat grids, transient-derived tempo analysis, rhythm-aware snapping, and other music-oriented timeline features are not current implementation requirements.

The current authoritative editing coordinate systems remain time- and sample-based.

The architecture should avoid choices that would make later musical-coordinate overlays prohibitively difficult, but implementation phases must not build speculative tempo or MIDI-style infrastructure without a future approved requirement.

Game-music looping and rhythm-game workflows may justify this capability later. If introduced, musical coordinates should be an additional mapping over the sample-accurate timeline rather than replacing sample/time coordinates as the underlying source of truth.


---

## 161. Diagnostic Submission and Consent Policy

AudioGubbins must never transmit diagnostic information, crash data, logs, capability information, project metadata, file metadata, source media, rendered audio, or any other user/project information without the user's express permission.

There must be no silent crash reporting, background error reporting, or automatic diagnostic upload.

The application may provide an explicit diagnostic-sharing workflow that allows the user to review and submit a sanitised diagnostic bundle. The bundle may include, where useful and non-sensitive:

- AudioGubbins version/build identifier
- Browser and operating-system information
- Runtime capability matrix
- Relevant feature flags and degraded-capability state
- Sanitised stack traces
- Structured application logs
- Performance timings and resource statistics
- Processor/plugin/model version identifiers
- Project/schema version numbers without project content
- Reproduction metadata explicitly selected by the user

By default, diagnostic bundles must exclude:

- Raw or rendered audio
- Project files or project contents
- Source filenames where they may reveal sensitive information
- Full local filesystem paths
- Credentials, access tokens, API keys, cookies, or authentication data
- User-entered free-form content unless deliberately included
- Cloud-provider data
- Private Godot project contents

The diagnostic-bundle UI must show the user what will be included before submission or export.

A user may explicitly opt into a remembered diagnostic-sharing preference so that AudioGubbins does not repeatedly present the same consent dialogue for equivalent diagnostic submissions. This opt-in must be:

- Explicit
- Revocable
- Easy to inspect and change
- Narrowly scoped to diagnostic sharing
- Never interpreted as permission to send analytics, audio, project content, or unrelated data

Even with remembered consent, AudioGubbins must not silently expand the categories of information being transmitted. Materially new data categories require renewed explicit consent.

Where automatic submission is later supported after opt-in, the user must be able to disable it immediately and inspect locally retained submission history where practical.

---

## 162. Usage Analytics Policy

AudioGubbins shall not implement usage analytics.

This prohibition includes, unless a future specification explicitly reverses it:

- Behavioural analytics
- Feature-usage tracking
- Session analytics
- User profiling
- Engagement metrics
- Advertising identifiers
- Marketing telemetry
- Hidden product instrumentation
- Third-party analytics SDKs

Normal local diagnostic logging is not analytics and remains subject to the privacy and retention requirements defined elsewhere in this specification.

Build tooling and third-party dependencies must be reviewed to ensure that analytics or telemetry are not introduced transitively without deliberate approval.

---

## 163. Collaboration Scope Exclusion

Real-time or asynchronous multi-user collaborative project editing is not a current AudioGubbins requirement.

The implementation must not introduce CRDTs, operational transforms, collaborative presence, shared cursors, remote locking protocols, collaboration servers, or similar infrastructure speculatively.

Team workflows may instead use normal project files, portable/unpacked project representations, Git, shared repositories, external storage, and future cloud-provider integrations.

The single-writer local-project ownership model remains authoritative for concurrent AudioGubbins instances unless a future collaboration specification deliberately replaces it.

---

## 164. Language and Localisation Policy

AudioGubbins shall use British English for all first-party user-facing text, documentation, comments, examples, diagnostic descriptions, help content, and implementation terminology where natural-language spelling differs.

Examples include:

- colour rather than color in prose and user-facing labels
- normalise rather than normalize
- behaviour rather than behavior
- artefact rather than artifact in prose, except where an external API, package, protocol, schema key, or established technical identifier uses another spelling

Internationalisation and translated UI support are not current requirements.

The implementation must not add a localisation framework solely for hypothetical future translation support unless a later requirement introduces it.

However, domain logic should still avoid depending on presentation strings as identifiers. Stable typed identifiers, enums, commands, schema keys, and machine-readable values must remain independent from visible British-English labels.

External standards, browser APIs, third-party library APIs, file-format field names, CSS properties, and source-code identifiers required by their ecosystems must retain their canonical spellings.

---

## 165. Structured Diagnostic Logging

AudioGubbins shall provide a configurable structured local logging system suitable for diagnosing complex audio, rendering, storage, browser-capability, PWA, Godot-integration, DSP, and recovery failures.

Supported severity levels should include at least:

- Error
- Warning
- Info
- Debug
- Trace

Logging should support:

- Subsystem/category filtering
- Correlation/operation identifiers
- Typed structured fields where practical
- Time stamps
- Bounded retention
- User-configurable verbosity
- Temporary diagnostic mode
- Export/download of logs
- Redaction/sanitisation before sharing
- Clear indication when diagnostic mode is active
- Performance-event logging without behavioural analytics

Diagnostic mode may collect richer execution metadata for a limited period but must not silently collect prohibited sensitive content.

Logs must not contain by default:

- Raw audio samples
- Encoded audio payloads
- Entire project documents
- Credentials or secrets
- Browser cookies
- Authentication tokens
- User passwords
- Full external file contents
- Sensitive cloud-provider data

Local file paths and filenames should be sanitised or redacted in shareable diagnostic bundles unless the user deliberately chooses to include them.

Log retention must be bounded and storage-aware. Users must be able to clear logs and inspect approximate log-storage usage.

---

## 166. Asset Provenance and Traceability

AudioGubbins should retain structured provenance for assets and generated outputs so that developers and sound designers can determine how a game-ready audio file was produced.

Provenance may include:

- Original filename
- Original source reference/handle where appropriate
- Import date/time
- Source fingerprint/hash
- Source size and format
- Source sample rate, bit depth, channel layout, and duration
- Originating AudioGubbins project and project identifier
- Asset/region identifiers
- Processing graph and processor-version references
- Relevant render/export recipe identifier
- Export date/time
- Destination information
- Generated Godot resource identifiers
- Variation-set/event membership
- Application version used for render
- Determinism/render-quality mode
- ML model version where applicable

Provenance must be represented as structured project metadata rather than inferred from filenames.

Users must be able to strip or minimise provenance and embedded metadata during export where privacy, distribution, or file-size requirements make that desirable.

Provenance metadata must not require network services and must remain compatible with local-first operation.

For deterministic or Git-friendly project modes, provenance serialisation should use stable ordering and avoid meaningless timestamp churn where the timestamp itself is not semantically required.


---

## 167. Agent Execution Contract

The implementation agent is expected to have full access to the AudioGubbins repository filesystem and the associated GitHub repository and to perform the implementation work directly from this specification.

This specification is the controlling implementation contract. The agent must not silently reinterpret, weaken, omit, postpone, stub, fake, or re-scope requirements because they are difficult, time-consuming, unfamiliar, or inconvenient.

The agent shall:

- Implement one gated phase at a time.
- Treat each phase TODO, invariant, required test, acceptance criterion, and review requirement as contractual.
- Preserve the architectural principles and dependency direction defined by this specification.
- Make reasonable autonomous implementation decisions where the specification intentionally leaves mechanism open.
- Record significant architectural decisions as ADRs.
- Prefer robust, explicit, maintainable architecture over expedient shortcuts.
- Refactor touched code when implementation reveals a poor abstraction rather than knowingly extending architectural debt.
- Keep unrelated sweeping rewrites outside the active phase unless they are necessary to satisfy a requirement or remove a blocking architectural defect.
- Leave the repository in a buildable, testable, reviewable state at meaningful checkpoints.

The agent must never use implementation speed or convenience as sufficient justification for reducing capability, correctness, test coverage, architectural quality, accessibility, determinism, portability, or maintainability.

---

## 168. Requirement Conflict and Deviation Protocol

If the implementation agent concludes that a requirement is technically impossible, internally contradictory, unsafe, legally problematic, or materially flawed, it must not silently substitute its own interpretation.

The agent must instead create a requirement-conflict record containing:

- The exact requirement or requirements in conflict.
- The observed technical or architectural constraint.
- Reproduction steps or evidence where applicable.
- Relevant browser/platform/library/tool limitations.
- The impact on dependent requirements and later phases.
- Viable alternatives.
- The agent's recommended resolution and rationale.
- Whether a reversible capability-detected fallback is already permitted by this specification.

A fallback may be implemented autonomously only when it is explicitly compatible with the specification's existing capability/fallback strategy and does not alter product semantics beyond those allowed boundaries.

Otherwise, the phase must remain blocked rather than quietly changing the product contract.

No requirement may be reclassified as optional or future work solely by the implementation agent.

---

## 169. Architectural Autonomy and ADR Policy

Within an approved phase, the implementation agent may make architectural and implementation decisions that are not explicitly prescribed by this specification, provided that those decisions:

- Satisfy all current requirements.
- Preserve future requirements already described by this specification.
- Follow defined dependency direction and module ownership.
- Do not introduce hidden product constraints.
- Do not trade long-term flexibility or robustness for short-term simplicity.
- Are testable and reviewable.
- Avoid unnecessary coupling to replaceable third-party libraries.

Significant decisions must be documented as Architecture Decision Records (ADRs).

An ADR is required when a decision materially affects one or more of:

- Domain model
- Persistence format
- Processing graph
- DSP implementation
- Runtime determinism
- Worker/WASM boundaries
- Rendering architecture
- Public/internal APIs
- Package/module ownership
- Cross-package dependency direction
- PWA/runtime capability strategy
- Godot integration contracts
- Security/privacy boundaries
- Third-party dependency lock-in
- Performance characteristics
- Long-term extensibility

ADRs should record context, considered options, decision, consequences, and future reversal/migration considerations.

Reviewer approval of a phase includes review of all ADRs introduced or materially modified during that phase.

---

## 170. Independent Multi-Lens and Adversarial Review

The implementation agent may not approve its own phase.

Every phase must be reviewed through independent reviewer passes using fresh review instructions/context where practical. Reviews may be performed by separate subagents or by separate isolated reviewer invocations, but they must be operationally independent from the implementation pass.

The review system shall combine:

- Required specialist lenses defined elsewhere in this specification.
- Cross-cutting architecture review.
- Adversarial review intended to find hidden defects rather than validate the implementer's narrative.
- Requirement-compliance review against the actual phase contract.
- Regression review of previously completed phase invariants where affected.

Adversarial reviewers should actively attempt to discover:

- Missing requirements disguised as complete work.
- Incorrect assumptions about browser/platform behaviour.
- Race conditions and lifecycle bugs.
- Data-loss or recovery failures.
- Hidden coupling.
- God objects and overgrown services/managers.
- Incorrect ownership boundaries.
- UI logic bypassing the command/domain layer.
- Unbounded memory/storage behaviour.
- Audio-thread violations.
- Main-thread blocking.
- Non-deterministic final-render paths.
- Incorrect DSP edge cases.
- State corruption under failure/reload.
- Accessibility regressions.
- Mobile/touch regressions.
- Security/privacy leakage.
- Dependency or licence risks.
- Test suites that appear comprehensive but do not exercise real behaviour.
- Phase leakage or unscheduled future-work placeholders.

Reviewers must inspect implementation evidence rather than relying on the implementer's summary or checked TODO boxes.

---

## 171. Review Finding Verification and Remediation

Reviewer findings are allegations until verified.

Before altering production code in response to a finding, the implementation workflow should verify the finding using the most appropriate evidence, including where relevant:

- Reproduction
- Targeted test
- Static analysis
- Type analysis
- Instrumentation
- Audio reference comparison
- Browser/platform reproduction
- Performance profiling
- Source/documentation verification
- Architectural dependency inspection

A reviewer finding that cannot be reproduced or substantiated must not be blindly implemented as a fix merely because a reviewer emitted it.

Verified genuine findings must be corrected unless this specification explicitly permits acceptance as tracked non-blocking debt.

Corrections must receive focused re-review, including:

- Confirmation that the original issue is resolved.
- Confirmation that the fix did not create a regression.
- Re-execution of affected tests and architecture checks.
- Re-review by the relevant specialist lens when severity warrants it.

When reviewers disagree, the workflow must reconcile the disagreement using evidence, specification requirements, and architectural principles rather than majority voting.

---

## 172. Review Severity and Gate Semantics

All review findings shall use the following common severity taxonomy:

- **BLOCKER** — implementation cannot safely or meaningfully proceed or the phase cannot be considered implemented.
- **CRITICAL** — severe correctness, data-loss, security/privacy, architectural, audio-integrity, or release-quality defect.
- **HIGH** — substantial product, correctness, performance, compatibility, accessibility, maintainability, or architecture defect.
- **MEDIUM** — meaningful defect or debt that should normally be resolved within the phase unless explicitly justified and tracked.
- **LOW** — minor defect, maintainability improvement, polish issue, or low-risk edge case.
- **NOTE** — observation, future consideration, or non-actionable context.

Gate rules:

- BLOCKER, CRITICAL, and HIGH findings always fail the phase gate until resolved and verified.
- MEDIUM findings must be resolved or explicitly accepted with written rationale, ownership, and tracking.
- LOW findings may be deferred when justified and tracked.
- NOTE findings do not block the phase.

Severity must be based on impact and likelihood, not on how difficult the fix is.

The implementation agent may not downgrade severity merely to pass a gate.

---

## 173. No Autonomous Scope Reduction

The implementation agent must never remove, downgrade, postpone, stub, fake, simplify away, or relabel required work as future scope because implementation is difficult or the phase is large.

If the work is too large to execute safely in one coding pass, the agent may subdivide the phase internally into ordered implementation slices, provided that:

- The externally defined phase boundary remains unchanged.
- Intermediate slices do not masquerade as a completed phase.
- The phase gate remains closed until every required slice is complete.
- Intermediate architectural decisions still satisfy the final phase contract.

Phrases such as the following are not acceptable substitutes for implementation unless the specification explicitly schedules the work later:

- "Future improvement"
- "Out of scope for now"
- "Can be added later"
- "MVP implementation"
- "Simplified implementation"
- "Temporary implementation"
- "Placeholder"
- "Good enough for this phase"

The specification, not the implementation agent, defines scope.

---

## 174. TODO and Acceptance-Criteria Integrity

Phase TODOs are contractual implementation statements.

A TODO may be marked complete only when its stated behaviour exists and all associated tests, invariants, and acceptance criteria are satisfied.

Examples of invalid completion claims include:

- Marking a feature complete because interfaces/types exist but behaviour does not.
- Marking persistence complete because data can be written but recovery/failure cases are absent.
- Marking a DSP processor complete because nominal input works but edge cases/reference validation are missing.
- Marking accessibility complete because controls have ARIA attributes without keyboard/focus testing.
- Marking mobile support complete because a desktop layout technically renders on a phone.
- Marking Godot integration complete because files export but the specified editor/runtime contracts are absent.

Reviewers must independently spot-check TODO completion against actual code, tests, generated artefacts, and runtime behaviour.

TODO checkboxes must never be treated as proof.

---

## 175. Dependency Introduction Policy

Every substantive runtime, build-time, DSP, rendering, storage, UI, testing, or tooling dependency must be evaluated before adoption.

The evaluation must consider:

- Functional necessity
- Quality and maturity
- Licence compatibility
- Patent considerations where relevant
- Active maintenance
- Release cadence
- Security history
- Browser/platform support
- Bundle/download impact
- WASM/model size impact where relevant
- Performance characteristics
- Tree-shaking/modularity
- API stability
- Lock-in risk
- Ability to wrap behind an AudioGubbins-owned abstraction
- Availability of robust tests
- Replacement/migration cost

Dependencies must not be introduced merely to avoid implementing a small amount of cohesive project-owned code.

Conversely, the agent must not reimplement complex, mature, well-tested technology solely to reduce dependency count when doing so would materially reduce quality, correctness, capability, or maintainability.

All dependencies should be isolated behind project-owned boundaries when coupling directly to the dependency would leak implementation details into the domain architecture.

---

## 176. Cohesion and Complexity Guardrails

AudioGubbins must not use arbitrary hard line-count limits as a substitute for architecture review.

Instead, the repository shall use soft complexity thresholds and mandatory scrutiny for suspicious growth.

Review attention is required when a unit becomes unusually large or complex, including:

- Source files with many unrelated responsibilities
- Functions with extensive branching or deeply nested control flow
- Classes/services/managers coordinating multiple unrelated domains
- Stores containing unrelated state and business logic
- React components containing domain orchestration, persistence, DSP, and rendering logic
- Modules that become universal dependency hubs
- Utility files that become dumping grounds
- Interfaces that continuously grow unrelated methods

A reviewer should ask whether the unit has one cohesive reason to change, whether its dependencies point in the correct direction, and whether responsibilities can be named precisely.

Splitting code only to satisfy a line-count metric is prohibited when it merely creates fragmented files with the same hidden coupling.

The preferred result is cohesive small modules with explicit ownership and typed contracts, not arbitrary file fragmentation.

---

## 177. Anti-God-Object and Module-Ownership Rules

God objects, god services, god stores, and monolithic managers are prohibited.

No central object may become the informal owner of unrelated application concerns simply because it is convenient to access globally.

Major subsystems must have explicit ownership boundaries, including at minimum:

- Project/domain model
- Command system
- Persistence
- Undo/history journal
- Audio graph
- DSP processors
- Real-time engine
- Offline renderer
- Recording
- Codec/import/export
- Waveform/spectral analysis
- GPU/editor rendering
- Workspace/UI state
- PWA lifecycle
- Capability detection
- Diagnostics
- Godot authoring integration
- Godot runtime integration

Cross-subsystem interaction must occur through typed contracts/events/commands appropriate to the architecture rather than shared mutable implementation state.

The architecture reviewer must specifically search for newly emerging god objects during every phase.

---

## 178. Design-Principle Anti-Cargo-Cult Rule

Engineering principles such as DRY, YAGNI, KISS, SOLID, design patterns, and abstraction heuristics are tools, not overriding goals.

The implementation agent must not cite a principle as a slogan to justify architecture without analysing consequences.

Examples:

- **DRY** must not create an over-generalised abstraction that couples unrelated domain concepts merely because code looks similar.
- **YAGNI** must not be used to ignore future capabilities that this specification explicitly requires the architecture to support.
- **KISS** must not be used to select a weaker architecture whose simplicity exists only because required failure modes or extensibility have been omitted.
- **SOLID** must not produce excessive indirection, interface proliferation, or trivial wrapper classes without meaningful ownership boundaries.
- A named design pattern must not be introduced merely because it is familiar; the concrete forces and trade-offs must justify it.

Prefer domain-specific clarity, cohesive ownership, explicit dependency direction, and evidence-based design.

---

## 179. Refactoring Expectations During Phase Work

Refactoring is part of implementation, not a separate optional clean-up activity.

When work within the active phase reveals:

- A wrong abstraction
- Duplicate domain logic
- Hidden coupling
- Poor dependency direction
- An emerging god object
- An ownership violation
- Unsafe state management
- Unmaintainable complexity

then the agent is expected to refactor the affected touched architecture before completing the phase.

However, broad unrelated rewrites are prohibited unless they are necessary to satisfy a requirement or remove a blocking defect.

Refactors must preserve behaviour through tests and must remain reviewable as part of the active phase.

---

## 180. Test Integrity and Anti-Cheating Rules

Tests are evidence of behaviour, not obstacles to be weakened until a build turns green.

The implementation agent must not:

- Remove or weaken assertions merely to pass a test.
- Update golden/reference audio output without documented technical justification and reviewer verification.
- Replace integration/E2E coverage with easier unit mocks when the requirement is integration behaviour.
- Mock the subsystem whose integration behaviour is the subject of the test.
- Assert only implementation details while failing to verify user/domain outcomes.
- Swallow exceptions or convert hard failures into warnings to make tests pass.
- Disable flaky tests without root-cause analysis and tracking.
- Add arbitrary retries to hide races.
- Mark tests skipped/todo as a substitute for required coverage.
- Alter test fixtures so that they no longer represent the required scenario.

Audio/DSP tests should use objective reference signals, tolerances, invariants, and golden/reference renders where appropriate.

Critical persistence and recovery tests should exercise process/tab interruption, partial writes, stale caches, storage pressure, and incompatible schema behaviour rather than only happy paths.

Architecture tests should verify dependency direction and prohibited imports where practical.

---

## 181. Placeholder, Stub, and Temporary-Code Gate Rule

Unless this specification explicitly schedules an implementation for a later phase, the following are gate failures when present in phase-owned production paths:

- `TODO`
- `FIXME`
- `HACK`
- Placeholder UI representing required behaviour
- Dummy or fabricated production data
- Empty implementations
- Unimplemented branches
- `throw new Error("Not implemented")` or equivalent
- Silent no-op fallbacks
- Temporary mock implementations
- Fake persistence
- Fake processing
- Hard-coded responses standing in for required systems
- Compatibility shims introduced contrary to the pre-1.0 schema policy
- Disabled required behaviour hidden behind an undocumented flag

A future-phase extension point is acceptable only when the current phase's required behaviour is complete and the extension point is an explicit architectural seam rather than a stub.

All temporary code must have an explicit specification-approved purpose and removal boundary.

---

## 182. Source-Control Execution Model

The implementation agent has full repository filesystem access and Git access and is responsible for maintaining a reviewable source-control history while executing this specification.

Repository hosting, branch-protection configuration, GitHub Actions administration, and other GitHub-repository setup are intentionally outside the scope of this implementation specification and will be managed separately by the project owner.

### 182.1 Worktree-First Concurrent Agent Model

When multiple implementation or review agents operate concurrently, they shall use isolated Git worktrees rather than sharing one mutable working directory.

The worktree model must provide:

- One isolated worktree per concurrent implementation/review stream.
- Explicit ownership of the files/subsystems currently being modified.
- No two agents editing the same files concurrently without deliberate coordination.
- Clean commits produced within the owning worktree.
- Review/remediation work performed against a known commit/state.
- Removal of stale worktrees after their work is integrated.

Agents must not use worktrees as an excuse to fragment architecture ownership or duplicate implementation across branches.

### 182.2 Direct Integration into `main`

The project intentionally uses rapid direct integration rather than pull-request-driven workflow.

Agents shall not raise pull requests unless the project owner explicitly changes this policy.

After a worktree's implementation has:

- completed its phase/sub-phase contract,
- passed required automated verification,
- passed independent multi-lens/adversarial review,
- remediated verified blocking findings,
- and produced a clean evidence package,

its commits may be merged directly into `main`.

`main` must remain the authoritative integration branch.

The absence of pull requests does not weaken review requirements. Review occurs before direct integration and must be evidence-based.

### 182.3 Commit Discipline

Git workflow must favour meaningful atomic commits.

Commits should:

- Represent one coherent implementation/refactor/test/documentation unit.
- Leave the repository in a buildable/testable state whenever practical.
- Use clear messages describing intent rather than implementation trivia.
- Keep mechanical/generated changes separate from semantic code changes when this materially improves reviewability.
- Avoid mixing unrelated cleanup with feature work.
- Include tests with the behaviour they validate when practical.
- Avoid drive-by formatting/reordering that obscures the semantic diff.

The agent must not use history rewriting, squashing, or rebasing in a way that obscures important implementation/review evidence unless repository policy explicitly permits it.

For each phase, the agent should maintain a traceable mapping between:

- Phase TODOs
- Relevant commits
- Tests
- ADRs
- Reviewer findings
- Finding-verification evidence
- Remediation commits
- Final gate result

No phase should be integrated/declared complete while its mandatory gate is failing.

---

## 183. Phase Evidence Package

At the end of every implementation phase, the agent must produce a concise but complete evidence package for reviewers.

The package should include:

- Phase identifier and objective
- Completed TODO checklist
- Files/packages materially changed
- New or changed public/internal contracts
- ADRs created/updated
- Tests added/changed
- Commands used for verification
- Build/type/lint/test results
- Browser/device compatibility results required by the phase
- Performance measurements required by the phase
- Audio/DSP reference results required by the phase
- Storage/recovery results required by the phase
- Accessibility results required by the phase
- Known non-blocking limitations explicitly permitted by the specification
- Dependency additions/removals and their review
- Migration/schema impact
- Screenshots or recordings where visual/touch behaviour is part of acceptance evidence
- Reviewer findings and remediation status

The evidence package is not a substitute for reviewers inspecting the implementation. It is an index to the evidence they must verify.

---

## 184. Architecture Enforcement Tests

AudioGubbins shall use executable architecture constraints where practical rather than relying solely on prose discipline.

Architecture tests/static rules should verify, where appropriate:

- Package dependency direction
- Prohibited cross-layer imports
- Domain code independence from React/UI implementation details
- UI inability to mutate authoritative domain state except through approved contracts/commands
- Separation of persistence from presentation
- Separation of DSP/audio-thread code from UI code
- No direct third-party implementation leakage across designated abstraction boundaries
- No circular dependencies
- Godot integration boundaries
- Browser capability access through approved capability adapters
- Diagnostic/telemetry restrictions

These tests should evolve with the architecture and be reviewed whenever package boundaries change.

An agent must not bypass an architecture test by weakening or deleting the rule unless the architectural change is deliberate, documented in an ADR, and approved by the architecture review lens.

---

## 185. Repository and Monorepo Structure

AudioGubbins shall use a single monorepo for the product codebase.

The monorepo should contain, as first-class components:

- The Vite/React/TypeScript PWA.
- Shared TypeScript contracts and schemas.
- Audio/domain/command packages.
- Rust/WASM DSP crates.
- Codec and media-processing packages/adapters.
- Rendering infrastructure.
- Storage/persistence infrastructure.
- Godot `@tool` editor addon.
- Godot runtime addon.
- Godot integration test project.
- GUT test suites for Godot-side behaviour.
- Cross-language/generated bindings where required.
- Test fixtures and deterministic reference assets.
- Documentation and architecture decision records.
- Build and developer tooling.

The repository structure must make dependency direction visible. It must not collapse unrelated concerns into one `src/` hierarchy merely for convenience.

Package boundaries should map to cohesive architectural responsibilities rather than framework conventions alone.

---

## 186. Package and Workspace Management

The TypeScript/JavaScript workspace shall use **pnpm workspaces**.

Rust components shall use Cargo workspaces/crates as appropriate.

The build architecture should support coordinated tasks across both ecosystems without hiding their native toolchains behind opaque wrapper scripts.

Requirements include:

- Strict declaration of package dependencies.
- No accidental reliance on undeclared transitive dependencies.
- Workspace-local package imports through documented public entry points.
- Lockfiles committed to source control.
- Reproducible dependency installation.
- CI validation that lockfiles and generated dependency metadata are current.
- Clear separation between application dependencies, development tooling, and test-only dependencies.

---

## 187. Product Versioning

AudioGubbins shall expose one primary product release version shared across the web application and first-party Godot integration packages.

A release should therefore be understandable to users as, for example:

`AudioGubbins 0.x.y`

rather than requiring users to reason about unrelated public versions for the PWA, editor addon, and runtime addon.

Independent internal compatibility/version identifiers are still required where technically necessary, including:

- Project schema version.
- Persistence schema version.
- Processor implementation version.
- DSP graph contract version.
- Godot generated-resource schema version.
- Runtime event schema/API version.
- Model-pack version.
- Cache-format version.

Internal compatibility identifiers must not be conflated with the product marketing/release version.

Pre-1.0 schema-breaking policy and post-1.0 migration policy remain as defined elsewhere in this specification.

---

## 188. Tiered Verification and CI Requirements

AudioGubbins shall define verification tiers suitable for later implementation in the project's CI environment.

Repository-hosting/CI-provider administration is outside this document's scope, but the codebase must contain the scripts/configuration/contracts required to execute these tiers.

### 188.1 Fast Commit Tier

Expected on normal implementation checkpoints:

- Formatting validation.
- Static analysis/linting.
- Type checking.
- Architecture/dependency-rule validation.
- Fast unit tests.
- Rust checks/tests appropriate to changed crates.
- Schema/contract validation.
- Generated-file freshness checks.

### 188.2 Integration Tier

Expected before direct integration into `main` when relevant:

- Browser integration tests.
- Persistence/storage integration tests.
- PWA/service-worker tests.
- Worker/AudioWorklet integration tests.
- DSP reference tests.
- Import/export tests.
- Godot GUT tests.
- Headless Godot runtime/integration tests.
- Accessibility checks.
- Visual/UI regression checks where applicable.

### 188.3 Phase-Gate / Heavyweight Tier

Expected at phase gates and major release checkpoints as applicable:

- Full supported-browser matrix.
- Desktop/touch/tablet interaction coverage.
- Offline/PWA lifecycle coverage.
- Storage corruption/interruption/recovery scenarios.
- Large-file/resource-pressure tests.
- Deterministic render/golden tests.
- Cross-browser render verification.
- Performance/benchmark suites.
- Memory/regression profiling.
- Godot editor-addon/runtime integration scenarios.
- End-to-end export-to-Godot scenarios.
- Accessibility/manual-interaction evidence required by the phase.

A required verification failure blocks the corresponding integration/gate unless the specification explicitly permits that failure mode.

---

## 189. Performance Regression Philosophy

Performance is a first-class quality attribute, but AudioGubbins must not remove valuable capability merely to satisfy arbitrary timing targets.

Performance tests exist to:

- Detect regressions.
- Expose poor algorithms or accidental complexity.
- Identify memory growth.
- Catch UI-thread blocking.
- Catch audio-thread instability.
- Track render/import/export throughput.
- Track startup and interaction responsiveness.
- Provide engineering evidence for optimisation work.

Performance tests must **not** become simplistic feature-kill switches.

Rules:

- No feature may be dropped solely because it is inherently computationally expensive.
- No quality mode may be reduced solely to meet an arbitrary benchmark number.
- Highest-quality final rendering may legitimately take longer than preview/draft rendering.
- A slower but correct high-quality operation is acceptable when its computational cost is inherent and clearly surfaced to the user.
- Performance regressions caused by poor implementation must still be investigated and corrected.
- Performance thresholds should distinguish interactive-latency requirements from offline-throughput observations.
- Statistical/tolerance-based comparison should be used where CI hardware variability makes exact thresholds unreliable.
- Where an operation is expensive, prefer better scheduling, chunking, workers, GPU/WASM acceleration, progressive results, caching, and user-selectable quality/performance profiles over scope reduction.

Interactive audio stability and UI responsiveness may have hard correctness-style limits where missing them causes drop-outs, data loss, unusable interaction, or other functional failure. These are not arbitrary performance gates; they are behavioural requirements.

---

## 190. Godot Automated Testing with GUT

Godot-side unit/integration tests should use **GUT (Godot Unit Test)** as the preferred GDScript-first testing framework where compatible with the targeted Godot 4.x version.

GUT 9.x supports Godot 4.x and includes CLI execution, making it suitable for headless automated verification. The exact pinned GUT version must match the minimum/current Godot versions supported by AudioGubbins and must be reviewed when Godot support changes.

The repository shall include a dedicated Godot integration/test project containing representative AudioGubbins-generated content and runtime/editor-addon scenarios.

Godot test coverage should include, as applicable:

- Resource serialisation/deserialisation.
- Generated `.tres` resources.
- Event definitions.
- Variation selection.
- Shuffle-bag/repetition-avoidance behaviour.
- Deterministic random seeds.
- Runtime parameters and conditions.
- Layered events.
- Cooldowns.
- Concurrency limits.
- Voice-stealing policies.
- Bus-routing configuration.
- 2D/3D playback helpers.
- Failure behaviour for missing/invalid assets.
- Schema/version compatibility contracts.
- Editor-addon generated-data contracts where testable headlessly.

Headless Godot verification should complement GUT where behaviours require launching Godot rather than isolated GDScript assertions.

---

## 191. Reference Assets, Fixtures, and Example Projects

The public repository shall contain a deliberately small, legally clean set of reference assets and examples sufficient for contributors, agents, and automated tests to exercise AudioGubbins without external setup.

This should include, as appropriate:

- Synthetic deterministic test signals.
- Small openly licensed audio clips.
- Mono and stereo examples.
- Representative multichannel examples.
- Loopable examples.
- Deliberately damaged/noisy reference samples for restoration tests.
- Known transient/click/DC-offset test signals.
- Small reference video clips for sound-to-picture tests where licensing permits.
- Example AudioGubbins projects.
- Example Godot integration project.
- Example event/variation resources.

Rules:

- Licensing/provenance must be documented for non-generated fixtures.
- Test fixtures must remain stable once they are used for golden/reference tests unless a deliberate reviewed change is required.
- Large corpora and heavyweight ML/audio datasets must not bloat normal Git history; they should be generated or fetched on demand with integrity/version metadata.
- Deterministic synthetic signals are preferred wherever they adequately test the required behaviour.

---

## 192. CI/Repository Setup Handoff Requirement

Although GitHub repository setup is intentionally managed separately, AudioGubbins implementation work must leave behind an explicit machine-readable and human-readable description of required verification commands and CI tiers so that repository automation can be configured without reverse-engineering the codebase.

The implementation shall therefore provide, at minimum:

- Canonical root-level commands for each verification tier.
- Documented environment/toolchain prerequisites.
- Deterministic test entry points.
- Headless Godot/GUT invocation commands.
- Browser-matrix test entry points.
- Benchmark entry points.
- Required artefact/report outputs.
- Clear failure exit codes.
- No interactive prompts in CI-targeted commands.

CI scripts/configuration must call the same underlying commands developers/agents can run locally rather than maintaining a separate hidden validation path.

---

## 193. Branching Project History

AudioGubbins shall use a branching history model rather than a traditional destructive linear redo stack.

If the user performs edits `A → B → C`, moves back to `A`, and then creates `D`, the historical `B → C` path must not be silently discarded merely because a new branch now exists.

The history model shall support:

- Branch-preserving command history.
- Navigation between historical branches.
- Stable identifiers for history nodes.
- Branch creation without duplicating immutable source media.
- Branch-aware retained-media/reference accounting.
- Safe restoration of historical project state.
- Integration with named snapshots.
- Integration with project forks.
- Clear distinction between current active history and retained alternative branches.

Branching history must remain an implementation detail of project-state evolution rather than leaking ad hoc branching logic into UI components.

---

## 194. Named Project Snapshots

Users shall be able to create explicit named project snapshots independently of ordinary undo/redo operations.

Snapshots may include:

- User-defined name.
- Optional notes/description.
- Creation timestamp.
- Author/application identity where relevant.
- Current active history node.
- Project-state fingerprint.
- Relevant export/provenance references.

Example snapshot names include:

- `Before aggressive denoise`
- `Approved game export`
- `Loop candidate B`
- `Client version 2`

Snapshots are immutable restore points unless the user explicitly deletes them.

---

## 195. Whole-Project A/B State Comparison

AudioGubbins shall support comparison and auditioning of complete historical project states, not only processor-level A/B comparison.

The user should be able to select two compatible snapshots/history states and:

- Switch rapidly between them.
- Audition the resulting audio.
- Compare processor chains and parameters.
- Compare region/marker/loop state.
- Inspect meaningful differences where practical.
- Promote either state to become the current working state without destroying the other.

Comparison state must not mutate either source snapshot merely by auditioning it.

---

## 196. History Workspace Panel

A dedicated professional History panel shall expose the persistent project-history model.

The panel should support, where appropriate:

- Command timeline/tree visualisation.
- Historical branches.
- Named snapshots.
- Current-state indication.
- Search/filtering.
- Affected asset/region indication.
- Restore/navigation actions.
- Snapshot creation.
- Branch naming where useful.
- Project-fork creation from a historical point.
- Storage impact inspection.
- History compaction/purge tools.

The panel must remain usable without requiring users to understand implementation-level command-journal internals.

---

## 197. Export Provenance in Project History

Export operations shall be recorded as provenance/history events but shall not be treated as ordinary reversible audio-edit mutations.

Export provenance should record, where applicable:

- Source project-state fingerprint/history node.
- Export recipe identifier/version.
- Render-engine/processor versions.
- Output format/settings.
- Target path or logical destination.
- Output fingerprint/hash where practical.
- Godot target/project linkage.
- Timestamp.
- Result status.

This shall allow a user to answer questions such as:

> Which project state and settings produced this game asset?

Normal Undo must not misleadingly imply that it can reliably remove or reverse arbitrary external filesystem side effects.

---

## 198. External Side Effects and Undo Semantics

Internal project edits that lead to an external operation remain fully subject to the normal non-destructive history model.

External side effects, such as writing or overwriting files in a Godot project, must use explicit transactional/recovery behaviour where technically possible.

Rules:

- Never claim an external operation is undoable when it is not reliably reversible.
- Preserve pre-write data or recovery metadata where practical and proportionate.
- Clearly distinguish internal undo from external recovery/revert operations.
- Batch external writes should use explicit transaction boundaries where possible.
- Partial external failures must be surfaced and reconciled rather than hidden.
- Provenance must retain enough information to diagnose what was written and from which project state.

---

## 199. Project Forks from Historical State

Users shall be able to create a new project/fork from a historical state or named snapshot.

Local project forks should share immutable/content-addressed source media where possible rather than duplicating large audio assets unnecessarily.

A fork must receive its own independent:

- Project identity.
- Command journal.
- Active history branch.
- Project metadata.
- Export recipes unless deliberately linked/copied by policy.
- Future modifications.

Forking must never mutate the source project.

Portable/exported projects must remain capable of becoming self-contained regardless of local deduplication.

---

## 200. History Storage Inspection and Compaction

History storage must be inspectable and selectively manageable.

AudioGubbins shall distinguish storage consumed by categories such as:

- Command journal.
- Named snapshots.
- Alternative branches.
- Retained deleted media.
- Immutable source media.
- Render caches.
- Waveform/spectrogram caches.
- Recovery checkpoints.
- Automatic backups.

Users shall be able to compact or purge eligible categories deliberately rather than being offered only a blunt `Clear History` operation.

Before destructive history/media compaction, AudioGubbins must explain the recovery capability that will be lost.

---

## 201. Specification Execution Architecture

The implementation specification itself shall be treated as an engineered execution system rather than a prose document that an agent is expected to hold entirely in working memory.

The canonical specification shall support two representations:

1. **Modular canonical source** — logically separated specification modules and phase packets used by implementation agents.
2. **Compiled full specification** — a generated single Markdown document containing the complete current specification for human review, archival, and download.

The compiled full specification remains authoritative only to the extent that it is generated from the current canonical modules. During the pre-repository requirements process, this single document may act as the canonical source, but the repository implementation phase shall split it into modular source files before substantial production work begins.

The specification architecture must minimise:

- Context-window overload.
- Requirement loss.
- Repeated interpretation.
- Contradictory local decisions.
- Phase drift.
- Reviewer ambiguity.
- Hidden cross-cutting requirements.

---

## 202. Normative Requirement Identifiers

Before autonomous implementation begins, every normative requirement that can affect implementation or acceptance shall receive a stable identifier.

Recommended identifier families include:

- `REQ-PROD-*` — product behaviour.
- `REQ-UX-*` — UX/accessibility/interaction.
- `REQ-AUDIO-*` — audio/DSP behaviour.
- `REQ-DATA-*` — project/storage/history.
- `REQ-PWA-*` — browser/PWA/platform behaviour.
- `REQ-GODOT-*` — Godot integration/runtime.
- `REQ-SEC-*` — security/privacy.
- `REQ-PERF-*` — performance/responsiveness.
- `REQ-ARCH-*` — architecture/invariants.
- `REQ-TEST-*` — verification requirements.
- `REQ-AGENT-*` — agent-execution requirements.

Identifiers must be stable once implementation begins. Renumbering/reordering Markdown headings must not change requirement identity.

Normative terms shall be used deliberately:

- **MUST / SHALL** — mandatory gate requirement.
- **MUST NOT / SHALL NOT** — prohibited behaviour.
- **SHOULD** — expected unless a documented and reviewed reason justifies deviation.
- **MAY** — explicitly optional capability.

Casual prose must not silently override a normative requirement.

---

## 203. Phase Packet Contract

No implementation phase may remain merely a title such as `Implement the audio engine`.

Before a phase becomes executable it must be converted into a self-contained **Phase Packet** containing, at minimum:

- Phase identifier and name.
- Objective.
- User-visible outcome.
- Explicit in-scope requirements by stable requirement ID.
- Explicit out-of-scope items.
- Prerequisite phases and capabilities.
- Required architectural contracts/interfaces.
- Owned packages/modules/directories.
- Cross-package dependency rules.
- Domain invariants that must remain true.
- Detailed TODO checklist.
- Expected deliverables.
- Data/schema changes.
- Browser/platform considerations.
- Failure/recovery behaviour.
- Required unit tests.
- Required integration tests.
- Required E2E/browser tests where applicable.
- Required audio golden/reference tests where applicable.
- Performance/responsiveness checks where applicable.
- Accessibility checks where applicable.
- Security/privacy checks where applicable.
- Acceptance criteria.
- Explicit forbidden shortcuts.
- Required reviewer lenses.
- Phase evidence-package contents.
- Handoff information for dependent phases.

A Phase Packet must contain enough information for a fresh implementation agent to execute it without inventing product scope.

---

## 204. Phase Context Loading Protocol

Implementation agents must not be expected to repeatedly consume the entire full specification for every coding task.

For a phase, the agent shall load a bounded **Phase Context Pack** consisting of:

1. Global Agent Execution Contract.
2. Global architectural invariants.
3. Current Phase Packet.
4. Normative requirements explicitly referenced by that packet.
5. Public contracts/interfaces from prerequisite phases that the phase depends upon.
6. Previous phase handoff/evidence summary where directly relevant.
7. Current Architecture Decision Records referenced by the phase.
8. Current implementation ledger entries relevant to owned packages.

The agent may consult additional specification sections when necessary, but implementation must not rely on remembering unrelated sections from a previous context window.

Phase packets must reference requirements explicitly rather than saying things such as `follow the audio requirements above`.

---

## 205. Requirement Traceability Matrix

Before implementation begins, AudioGubbins shall maintain a traceability matrix mapping each normative requirement to implementation and verification ownership.

At minimum, each requirement must track:

- Requirement ID.
- Requirement summary.
- Owning phase.
- Implementing package/module where known.
- Verification/test identifiers.
- Review lenses responsible for validating it.
- Current status.
- Evidence reference after completion.

No mandatory requirement may remain permanently unassigned to a phase.

No phase may claim completion while mandatory requirements assigned to that phase lack verification/evidence.

The traceability matrix should be machine-readable as well as human-readable.

---

## 206. Phase Dependency Graph and Readiness Gate

Implementation order shall be controlled by an explicit dependency graph rather than by Markdown section order.

Every phase shall declare hard dependencies and optional/enhancement dependencies.

A phase is **READY** only when:

- All hard prerequisite phases passed their gates.
- Required contracts/interfaces exist at the expected versions.
- Required fixtures/toolchains are available.
- No unresolved blocker invalidates the phase assumptions.
- Its Phase Packet is complete.
- Its normative requirements are assigned and internally consistent.

Agents must not begin downstream implementation merely because useful-looking work is available.

---

## 207. Phase Size and Internal Work Breakdown

A phase must be large enough to produce a coherent independently reviewable capability, but not so broad that one agent context must implement unrelated subsystems simultaneously.

If a Phase Packet is too large for reliable execution, it may be decomposed into internal work units or sub-phases provided that:

- The original phase scope is not reduced.
- The parent phase gate remains closed until every mandatory unit is complete.
- Shared contracts are established deliberately before parallel work.
- Subdivision does not become an excuse to defer difficult requirements.
- Each unit has explicit ownership and acceptance evidence.

Sub-phase decomposition is an execution technique, not scope reduction.

---

## 208. Parallel-Agent and Worktree Coordination

When multiple agents work concurrently using Git worktrees, parallelisation must follow module/contract ownership rather than allowing arbitrary overlapping edits.

Before concurrent implementation:

- Shared interfaces/contracts must be agreed and committed first where practical.
- Each work unit must declare owned files/packages.
- Overlapping ownership must be minimised.
- Agents must not independently invent incompatible versions of the same contract.
- Cross-worktree integration points require explicit tests.
- Merge order must respect dependency direction.
- Integration conflicts must be resolved semantically, not by mechanically choosing one side.

A coordinator agent may manage work allocation, but it must not waive phase gates or reviewer independence.

---

## 209. Implementation Ledger

The repository shall maintain a machine-readable **Implementation Ledger** that records execution state without requiring an agent to infer progress from Git history or prose.

Each phase/work unit entry should include:

- Status: `NOT_READY`, `READY`, `IN_PROGRESS`, `REVIEW`, `REMEDIATION`, `PASS`, or `BLOCKED`.
- Requirement IDs covered.
- Owning worktree/agent where applicable.
- Commits produced.
- Tests/evidence produced.
- Open verified findings.
- Blocking dependencies.
- ADRs created/changed.
- Handoff summary.

The ledger is execution metadata and must not replace normative requirements in the specification.

---

## 210. Phase Handoff Capsule

Every passed phase shall produce a concise Handoff Capsule for future agents.

It must describe:

- What capability now exists.
- Public contracts/interfaces introduced.
- Key architectural decisions.
- Invariants downstream code must preserve.
- Persisted/schema formats introduced.
- Known intentionally deferred items explicitly authorised by the specification.
- Relevant benchmarks/baselines.
- Relevant fixtures/test utilities.
- Exact requirement IDs satisfied.

The capsule must not contain speculative future design decisions that are absent from the specification.

---

## 211. Decision Authority and Conflict Resolution

When sources disagree, implementation agents shall resolve authority in this order unless an explicit superseding decision says otherwise:

1. Latest approved normative requirement/change record.
2. Global Agent Execution Contract and architectural invariants.
3. Current approved Phase Packet.
4. Approved ADRs.
5. Public contracts from passed prerequisite phases.
6. Non-normative explanatory prose/examples.
7. Existing implementation behaviour.

Existing code does not overrule the specification merely because it already exists.

Any genuine unresolved contradiction must use the Requirement Conflict and Deviation Protocol rather than being guessed away.

---

## 212. Specification Change Control During Implementation

Once autonomous implementation begins, substantive specification changes must be recorded explicitly rather than silently editing old text and expecting agents to notice.

Each material change shall identify:

- Change identifier.
- Affected requirement IDs.
- Rationale.
- Affected phases.
- Whether already-passed phases require remediation.
- Schema/API/project compatibility impact.
- Required test changes.

The implementation ledger and traceability matrix must be updated accordingly.

Pre-1.0 product schemas may still break according to the established policy; specification traceability must nevertheless remain explicit.

---

## 213. Specification Static Validation

The modular specification should have automated validation analogous to code linting.

Validation should detect, where practical:

- Duplicate requirement IDs.
- Broken requirement references.
- Mandatory requirements with no owning phase.
- Phase dependency cycles.
- References to missing ADRs/contracts.
- Duplicate/conflicting ownership declarations.
- Phase packets missing mandatory sections.
- Passed phases with unresolved blocking findings.
- TODOs lacking acceptance criteria/tests where required.
- Stale traceability entries.

Specification validation must run before a Phase Packet is declared READY.

---

## 214. Context-Overload Guardrail

No implementation or review instruction may rely on an agent retaining the complete AudioGubbins specification in conversational memory.

Agents must retrieve/read authoritative source material when needed.

Reviewers shall evaluate the implementation against explicit requirement IDs and phase evidence rather than a vague instruction to `review against the full spec`.

If a phase requires so many unrelated requirement sections that its Phase Context Pack becomes unwieldy, this is evidence that the phase boundaries or requirement organisation should be refactored before implementation continues.

---

## 215. Requirements-to-Tests Rule

Every normative behaviour that can be mechanically verified should have at least one identified verification mechanism before its implementation phase passes.

Verification mechanisms may include:

- Unit tests.
- Property-based tests.
- Integration tests.
- Browser/E2E tests.
- Audio golden/reference tests.
- Deterministic render hashes.
- GUT/Godot tests.
- Architecture tests.
- Accessibility automation plus manual checks.
- Performance/latency measurements.
- Static analysis.
- Manual evidence for behaviours that cannot be meaningfully automated.

A requirement must not be considered satisfied solely because code that appears related to it exists.

---

## 216. No Hidden Implementation Assumptions

Phase packets shall explicitly state assumptions that materially affect correctness.

Agents must not silently assume:

- Browser APIs are universally available.
- A file fits in memory.
- Audio is stereo.
- Sample rates match.
- A Godot project is writable.
- A user is online.
- A PWA is installed.
- SharedArrayBuffer/WebGPU is available.
- Touch input implies no keyboard/mouse.
- Export destinations can be overwritten.
- External files remain unchanged.
- Storage quota is sufficient.
- A processor is zero-latency.

Capability-sensitive assumptions require explicit fallback/error behaviour.

---

## 217. Specification Hardening Milestone Before Production Implementation

Before the autonomous implementation agent begins production work, the requirements document must undergo a dedicated hardening milestone.

That milestone shall:

1. Remove obsolete/redundant prose without losing normative behaviour.
2. Assign stable requirement IDs.
3. Organise requirements into modular canonical files.
4. Define the dependency graph.
5. Convert every planned implementation phase into a complete Phase Packet.
6. Build the requirement traceability matrix.
7. Create the initial implementation ledger.
8. Identify cross-cutting invariants and package ownership.
9. Resolve contradictory requirements.
10. Define the initial ADR set for architecture choices already made.
11. Define exact verification commands and evidence formats.
12. Run adversarial specification reviews before code implementation begins.

The hardening milestone is itself gated. Production implementation must not begin merely because the requirements prose is extensive.

---

## 218. Adversarial Specification Review

Before implementation, independent reviewers shall review the specification itself through multiple lenses, including:

- Missing-requirements lens.
- Contradiction/ambiguity lens.
- Agent-confusion lens.
- Architecture/dependency lens.
- Browser/PWA feasibility lens.
- Audio/DSP correctness lens.
- Data-loss/recovery lens.
- Security/privacy lens.
- Godot integration lens.
- UX/accessibility lens.
- Performance/scalability lens.
- Testing/verifiability lens.
- Scope/phase-boundary lens.

Findings must be verified before changing the specification. Genuine findings must be corrected or explicitly resolved before production implementation.

---

## 219. Compiled Specification Generation

The repository should provide a deterministic command that compiles the modular specification into a single complete Markdown document named similarly to:

`AudioGubbins_Implementation_Specification.md`

The generated file shall:

- Preserve stable requirement identifiers.
- Include a generated table of contents/index.
- Include phase summaries and traceability references.
- Be reproducible from repository state.
- Contain generation metadata/version/commit identifier where appropriate.
- Be suitable for human download and archival.

The generated file must not become a separately edited divergent copy of the modular source.

