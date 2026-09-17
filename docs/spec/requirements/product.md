# Product and Scope Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-PROD-001` — Purpose — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-003` — Product Positioning — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-006` — Primary Users — owner Phase 01 — scope `CURRENT`
- `REQ-PROD-007` — Primary Workflow Example — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-009` — Audio Duration and Scale — owner Phase 03 — scope `CURRENT`
- `REQ-PROD-038` — Cloud Extensibility — owner Phase 02 — scope `DEFERRED`
- `REQ-PROD-039` — Third-Party Plugins — owner Phase 06 — scope `DEFERRED`
- `REQ-PROD-056` — Product Name — owner Phase 01 — scope `CURRENT`
- `REQ-PROD-147` — Release-Version Philosophy — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-148` — Continuous Feature-Delivery Policy — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-149` — Release Channel and Maturity Labels — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-150` — Real-World Validation Before Stable Releases — owner Phase 15 — scope `CURRENT`
- `REQ-PROD-158` — MIDI Scope Exclusion — owner Phase 00 — scope `EXCLUDED`
- `REQ-PROD-160` — Musical Timeline and Tempo Features — Deferred Possibility — owner Phase 04 — scope `DEFERRED`

---

## REQ-PROD-001 — Purpose

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 1 of the pre-hardening baseline

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

## REQ-PROD-003 — Product Positioning

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 3 of the pre-hardening baseline

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

## REQ-PROD-006 — Primary Users

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 6 of the pre-hardening baseline

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

## REQ-PROD-007 — Primary Workflow Example

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 7 of the pre-hardening baseline

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

## REQ-PROD-009 — Audio Duration and Scale

- **Owner:** Phase 03 — Audio Engine Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 9 of the pre-hardening baseline

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

## REQ-PROD-038 — Cloud Extensibility

- **Owner:** Phase 02 — Project and Storage System
- **Scope:** `DEFERRED`
- **Legacy source:** section 38 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

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

## REQ-PROD-039 — Third-Party Plugins

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `DEFERRED`
- **Legacy source:** section 39 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

Third-party plugins are a future goal.

The initial implementation will not expose arbitrary third-party plugin loading.

However, internal processor/plugin abstractions should avoid preventing a future plugin ecosystem.

Security boundaries, sandboxing, compatibility, and versioning must be considered before third-party plugins are exposed.

---

## REQ-PROD-056 — Product Name

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 56 of the pre-hardening baseline

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

## REQ-PROD-147 — Release-Version Philosophy

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 147 of the pre-hardening baseline

AudioGubbins version numbers are project-owner-controlled release labels, not rigid feature-completeness gates.

Version `1.0.0` shall occur when the project owner judges the application ready for that label. The implementation plan must not defer valuable capabilities merely because they are conventionally considered "post-1.0" features, nor must it force an arbitrary feature checklist to be completed solely to justify the `1.0.0` label.

Development shall continue continuously across pre-release and release-labelled versions. Phase planning, architectural quality, test quality, and feature prioritisation must therefore be based on product value, technical dependencies, risk, and implementation readiness rather than semantic-version prestige.

The one explicit version-dependent compatibility contract currently retained is the project/schema migration policy:

- Before `1.0.0`, breaking persisted-schema changes may require backup/export followed by reset, and compatibility shims are not required.
- From `1.0.0` onward, supported migration and backwards-compatibility responsibilities begin as defined elsewhere in this specification.

No other requirement may infer that a feature is excluded merely because AudioGubbins has not yet reached `1.0.0`.

---

## REQ-PROD-148 — Continuous Feature-Delivery Policy

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 148 of the pre-hardening baseline

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

## REQ-PROD-149 — Release Channel and Maturity Labels

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 149 of the pre-hardening baseline

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

## REQ-PROD-150 — Real-World Validation Before Stable Releases

- **Owner:** Phase 15 — Release Readiness
- **Scope:** `CURRENT`
- **Legacy source:** section 150 of the pre-hardening baseline

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

## REQ-PROD-158 — MIDI Scope Exclusion

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `EXCLUDED`
- **Legacy source:** section 158 of the pre-hardening baseline

> **Execution rule:** This is an explicit exclusion. Do not implement the excluded capability unless a future approved specification change supersedes this requirement.

MIDI input, MIDI sequencing, MIDI controllers, and MIDI control-surface integration are not current AudioGubbins requirements.

The implementation must not add MIDI infrastructure speculatively.

Generic command, automation, parameter, and input-abstraction systems should remain clean enough that MIDI could be considered in a future specification if requirements change, but no present phase should include MIDI work merely for hypothetical extensibility.

---

## REQ-PROD-160 — Musical Timeline and Tempo Features — Deferred Possibility

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `DEFERRED`
- **Legacy source:** section 160 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

Tempo maps, bars/beats, beat grids, transient-derived tempo analysis, rhythm-aware snapping, and other music-oriented timeline features are not current implementation requirements.

The current authoritative editing coordinate systems remain time- and sample-based.

The architecture should avoid choices that would make later musical-coordinate overlays prohibitively difficult, but implementation phases must not build speculative tempo or MIDI-style infrastructure without a future approved requirement.

Game-music looping and rhythm-game workflows may justify this capability later. If introduced, musical coordinates should be an additional mapping over the sample-accurate timeline rather than replacing sample/time coordinates as the underlying source of truth.

---
