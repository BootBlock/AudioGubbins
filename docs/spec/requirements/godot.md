# Godot Editor and Runtime Integration Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-GODOT-024` — Godot Integration — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-046` — Godot Integration Capability Strategy — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-047` — Godot Synchronisation Direction — owner Phase 11 — scope `DEFERRED`
- `REQ-GODOT-048` — Godot Project Modification Safety — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-107` — Godot Integration Architecture — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-108` — AudioGubbins Godot Editor Addon — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-109` — Godot Runtime Addon — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-110` — Godot-Native Resource Model — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-111` — AudioGubbins Event Model for Godot — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-114` — Runtime Parameterisation — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-115` — Godot Playback Components and API — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-116` — Editor-to-Runtime Data Pipeline — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-117` — Live Godot Export and Synchronisation — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-118` — Source and Generated Asset Placement — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-119` — Persistent Export Recipes — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-123` — Godot-Side Generated Descriptors — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-124` — Multiple Godot Targets — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-125` — Godot Addon Packaging and Independence — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-126` — Godot Integration Safety and Review Requirements — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-127` — Godot Runtime Integration Direction — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-128` — Parameter-Driven Runtime Audio Model — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-129` — Layered and Composite Events — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-130` — Advanced Event Authoring Direction — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-131` — Godot Generated Data Location — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-132` — Git and Source-Control Behaviour for Godot Integration — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-133` — Runtime Independence and Open Asset Principle — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-134` — Live Synchronisation Architecture — owner Phase 11 — scope `CURRENT`
- `REQ-GODOT-135` — Godot Runtime Diagnostics and Debugging — owner Phase 11 — scope `CURRENT`

---

## REQ-GODOT-024 — Godot Integration

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 24 of the pre-hardening baseline

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

## REQ-GODOT-046 — Godot Integration Capability Strategy

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 46 of the pre-hardening baseline

Deep Godot integration shall use progressive enhancement.

Where browser filesystem capabilities permit, the application may provide direct project-folder access and export/synchronisation workflows.

Where those capabilities are unavailable, the core editor must remain fully usable and provide equivalent export/download workflows without reducing the editor to the lowest common denominator.

Direct filesystem integration is an enhancement, not a prerequisite for core editing.

---

## REQ-GODOT-047 — Godot Synchronisation Direction

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `DEFERRED`
- **Legacy source:** section 47 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

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

## REQ-GODOT-048 — Godot Project Modification Safety

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 48 of the pre-hardening baseline

The application may create or update explicitly requested audio assets, app-owned metadata, manifests, or Godot resources.

It must never silently rewrite unrelated Godot project settings or unrelated existing resources.

If an operation requires modification of an existing Godot resource or configuration file, the application should provide a preview or diff and require explicit confirmation unless the user has deliberately configured a trusted automation policy for that operation.

---

## REQ-GODOT-107 — Godot Integration Architecture

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 107 of the pre-hardening baseline

Godot integration is a first-class AudioGubbins subsystem rather than a simple export convenience.

The integration shall be designed as two cooperating but independently usable layers:

1. **AudioGubbins Godot Editor Addon** — an editor-facing Godot 4+ addon that runs inside the Godot editor.
2. **AudioGubbins Godot Runtime Addon** — an optional runtime-facing library that Godot games can use to consume AudioGubbins-authored assets, variation sets, events, metadata, and playback configuration.

Neither layer may become mandatory for using AudioGubbins itself.

The PWA must continue to support ordinary file export when no Godot addon is installed.

The editor and runtime layers must share stable versioned data contracts rather than depending on private implementation details.

---

## REQ-GODOT-108 — AudioGubbins Godot Editor Addon

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 108 of the pre-hardening baseline

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

## REQ-GODOT-109 — Godot Runtime Addon

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 109 of the pre-hardening baseline

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

## REQ-GODOT-110 — Godot-Native Resource Model

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 110 of the pre-hardening baseline

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

## REQ-GODOT-111 — AudioGubbins Event Model for Godot

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 111 of the pre-hardening baseline

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

## REQ-GODOT-114 — Runtime Parameterisation

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 114 of the pre-hardening baseline

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

## REQ-GODOT-115 — Godot Playback Components and API

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 115 of the pre-hardening baseline

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

## REQ-GODOT-116 — Editor-to-Runtime Data Pipeline

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 116 of the pre-hardening baseline

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

## REQ-GODOT-117 — Live Godot Export and Synchronisation

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 117 of the pre-hardening baseline

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

## REQ-GODOT-118 — Source and Generated Asset Placement

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 118 of the pre-hardening baseline

AudioGubbins shall support both primary repository strategies:

#### External Masters

- AudioGubbins projects and high-resolution sources live outside the Godot repository.
- Only game-ready generated outputs are written into `res://`.

#### Repository-Co-Located Masters

- AudioGubbins project metadata and/or source material may live inside the game's repository.
- Generated assets may also live in designated project subdirectories.

The application shall not force either model.

Path configuration must clearly distinguish authoritative source/project paths from generated-output paths so generated files can be cleaned/rebuilt safely.

---

## REQ-GODOT-119 — Persistent Export Recipes

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 119 of the pre-hardening baseline

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

## REQ-GODOT-123 — Godot-Side Generated Descriptors

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 123 of the pre-hardening baseline

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

## REQ-GODOT-124 — Multiple Godot Targets

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 124 of the pre-hardening baseline

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

## REQ-GODOT-125 — Godot Addon Packaging and Independence

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 125 of the pre-hardening baseline

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

## REQ-GODOT-126 — Godot Integration Safety and Review Requirements

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 126 of the pre-hardening baseline

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

## REQ-GODOT-127 — Godot Runtime Integration Direction

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 127 of the pre-hardening baseline

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

## REQ-GODOT-128 — Parameter-Driven Runtime Audio Model

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 128 of the pre-hardening baseline

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

## REQ-GODOT-129 — Layered and Composite Events

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 129 of the pre-hardening baseline

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

## REQ-GODOT-130 — Advanced Event Authoring Direction

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 130 of the pre-hardening baseline

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

## REQ-GODOT-131 — Godot Generated Data Location

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 131 of the pre-hardening baseline

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

## REQ-GODOT-132 — Git and Source-Control Behaviour for Godot Integration

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 132 of the pre-hardening baseline

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

## REQ-GODOT-133 — Runtime Independence and Open Asset Principle

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 133 of the pre-hardening baseline

AudioGubbins-rendered audio must remain ordinary usable audio assets.

The runtime addon must not trap rendered media in a proprietary package that makes the underlying files unusable without AudioGubbins.

If the runtime addon is removed:

- Rendered WAV/Ogg/MP3/etc. assets remain valid ordinary Godot-importable files.
- AudioGubbins source projects remain valid outside Godot.
- Only AudioGubbins-specific event/variation/runtime behaviour is lost.

Generated AudioGubbins runtime resources must be documented and versioned.

The runtime layer should favour Godot-native resources and APIs where that improves interoperability and inspectability.

---

## REQ-GODOT-134 — Live Synchronisation Architecture

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 134 of the pre-hardening baseline

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

## REQ-GODOT-135 — Godot Runtime Diagnostics and Debugging

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 135 of the pre-hardening baseline

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
