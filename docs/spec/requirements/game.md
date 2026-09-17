# Game-Audio Authoring Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-GAME-022` — Variation Generation — owner Phase 13 — scope `CURRENT`
- `REQ-GAME-023` — Game-Audio Features — owner Phase 10 — scope `CURRENT`
- `REQ-GAME-074` — Macros and Action Sequences — owner Phase 13 — scope `PLANNED`
- `REQ-GAME-075` — Guided Task Workflows — owner Phase 10 — scope `CURRENT`
- `REQ-GAME-112` — Variation Sets as a First-Class Domain Concept — owner Phase 13 — scope `CURRENT`
- `REQ-GAME-113` — Runtime Variation Selection — owner Phase 13 — scope `CURRENT`
- `REQ-GAME-120` — Asset Groups and Inherited Game-Audio Policy — owner Phase 10 — scope `CURRENT`
- `REQ-GAME-121` — Seamless Loop Analysis and Validation — owner Phase 10 — scope `CURRENT`
- `REQ-GAME-122` — Game-Context Preview Simulator — owner Phase 10 — scope `CURRENT`

---

## REQ-GAME-022 — Variation Generation

- **Owner:** Phase 13 — Advanced Batch and Variation Workflows
- **Scope:** `CURRENT`
- **Legacy source:** section 22 of the pre-hardening baseline

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

## REQ-GAME-023 — Game-Audio Features

- **Owner:** Phase 10 — Game-Audio Tooling
- **Scope:** `CURRENT`
- **Legacy source:** section 23 of the pre-hardening baseline

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

## REQ-GAME-074 — Macros and Action Sequences

- **Owner:** Phase 13 — Advanced Batch and Variation Workflows
- **Scope:** `PLANNED`
- **Legacy source:** section 74 of the pre-hardening baseline

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

## REQ-GAME-075 — Guided Task Workflows

- **Owner:** Phase 10 — Game-Audio Tooling
- **Scope:** `CURRENT`
- **Legacy source:** section 75 of the pre-hardening baseline

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

## REQ-GAME-112 — Variation Sets as a First-Class Domain Concept

- **Owner:** Phase 13 — Advanced Batch and Variation Workflows
- **Scope:** `CURRENT`
- **Legacy source:** section 112 of the pre-hardening baseline

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

## REQ-GAME-113 — Runtime Variation Selection

- **Owner:** Phase 13 — Advanced Batch and Variation Workflows
- **Scope:** `CURRENT`
- **Legacy source:** section 113 of the pre-hardening baseline

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

## REQ-GAME-120 — Asset Groups and Inherited Game-Audio Policy

- **Owner:** Phase 10 — Game-Audio Tooling
- **Scope:** `CURRENT`
- **Legacy source:** section 120 of the pre-hardening baseline

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

## REQ-GAME-121 — Seamless Loop Analysis and Validation

- **Owner:** Phase 10 — Game-Audio Tooling
- **Scope:** `CURRENT`
- **Legacy source:** section 121 of the pre-hardening baseline

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

## REQ-GAME-122 — Game-Context Preview Simulator

- **Owner:** Phase 10 — Game-Audio Tooling
- **Scope:** `CURRENT`
- **Legacy source:** section 122 of the pre-hardening baseline

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
