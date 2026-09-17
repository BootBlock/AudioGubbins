# Requirements Traceability Register

Canonical requirement groups: **215**.

> Machine-readable source: `requirements-register.json`. This Markdown table is generated for human review.

| Requirement | Scope | Owner | Status | Planned verification |
|---|---|---:|---|---|
| `REQ-PROD-001` — Purpose | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-EXEC-002` — Implementation Philosophy | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-PROD-003` — Product Positioning | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-ARCH-004` — Core Architectural Principles | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-005` — User Experience Goals | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PROD-006` — Primary Users | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PROD-007` — Primary Workflow Example | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-EDIT-008` — Editing Modes | `CURRENT` | Phase 05 | `PENDING` | `EDIT-UNIT`, `EDIT-PROPERTY`, `EDIT-E2E`, `DATA-ROUNDTRIP` |
| `REQ-PROD-009` — Audio Duration and Scale | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-010` — Format Support | `CURRENT` | Phase 09 | `PENDING` | `CODEC-UNIT`, `CODEC-FIXTURES`, `CODEC-ROUNDTRIP`, `CODEC-MALFORMED`, `DSP-RUST` |
| `REQ-ARCH-011` — Audio Precision | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-EDIT-012` — Timeline and Editing Requirements | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-013` — Snapping | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-014` — Regions | `CURRENT` | Phase 05 | `PENDING` | `EDIT-UNIT`, `EDIT-PROPERTY`, `EDIT-E2E`, `DATA-ROUNDTRIP` |
| `REQ-EDIT-015` — Channel Editing | `CURRENT` | Phase 05 | `PENDING` | `EDIT-UNIT`, `EDIT-PROPERTY`, `EDIT-E2E`, `DATA-ROUNDTRIP` |
| `REQ-AUDIO-016` — Spectral Editing | `CURRENT` | Phase 08 | `PENDING` | `SPEC-UNIT`, `SPEC-GOLDEN`, `SPEC-E2E`, `DSP-RUST` |
| `REQ-AUDIO-017` — Effect Rack | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-AUDIO-018` — DSP Scope | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-AUDIO-019` — Preview and Comparison | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-REC-020` — Recording | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-GAME-022` — Variation Generation | `CURRENT` | Phase 13 | `PENDING` | `VAR-UNIT`, `VAR-DETERMINISM`, `BATCH-RECOVERY`, `VAR-E2E` |
| `REQ-GAME-023` — Game-Audio Features | `CURRENT` | Phase 10 | `PENDING` | `GAME-UNIT`, `LOOP-GOLDEN`, `GAME-E2E` |
| `REQ-GODOT-024` — Godot Integration | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-STOR-025` — Storage Model | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-026` — Project Format | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-027` — Cache Model | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-PWA-028` — Platform Support | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-UX-029` — Mobile and Touch | `CURRENT` | Phase 14 | `PENDING` | `MATRIX-BROWSER`, `MATRIX-A11Y`, `MATRIX-PERF`, `MATRIX-STRESS`, `MATRIX-RECOVERY`, `GODOT-GUT` |
| `REQ-PWA-030` — PWA Requirements | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-PWA-031` — Local Development | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PWA-032` — Deployment | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-REPO-033` — Source Control and Licensing | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-ARCH-034` — Dependency Philosophy | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-ARCH-036` — Processing Architecture Direction | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-ARCH-037` — Waveform Rendering Direction | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-PROD-038` — Cloud Extensibility | `DEFERRED` | Phase 02 | `DEFERRED` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-PROD-039` — Third-Party Plugins | `DEFERRED` | Phase 06 | `DEFERRED` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-EXEC-040` — Multi-Lens Review Model | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-041` — Gate Rule | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-044` — Standing Decision Rules | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-GODOT-046` — Godot Integration Capability Strategy | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-047` — Godot Synchronisation Direction | `DEFERRED` | Phase 11 | `DEFERRED` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-048` — Godot Project Modification Safety | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-ARCH-049` — Deterministic Rendering | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-050` — Presets and Advanced Codec Controls | `CURRENT` | Phase 09 | `PENDING` | `CODEC-UNIT`, `CODEC-FIXTURES`, `CODEC-ROUNDTRIP`, `CODEC-MALFORMED`, `DSP-RUST` |
| `REQ-PWA-051` — Mobile Orientation Policy | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-STOR-052` — Project Schema Compatibility Policy | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-053` — External Source Change Policy | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-ARCH-054` — Export Collision Policy | `CURRENT` | Phase 09 | `PENDING` | `CODEC-UNIT`, `CODEC-FIXTURES`, `CODEC-ROUNDTRIP`, `CODEC-MALFORMED`, `DSP-RUST` |
| `REQ-STOR-055` — Undo/Redo Retention Policy | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-PROD-056` — Product Name | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-057` — Dockable Workspace System | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-058` — Workspace Presets | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-059` — Workspace State Persistence | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-060` — Asset Browser and Editor Tabs | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-EDIT-061` — Multiple Views of the Same Asset | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-062` — Waveform and Spectral Presentation Modes | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-063` — Explicit Selection Model | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-064` — Selection Persistence | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-EDIT-065` — Hybrid Tool System | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-UX-066` — Shortcut System | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-067` — Touch and Gesture Model | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-068` — Stylus and Pressure Input | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-069` — Motion and Animation | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-070` — Theme System | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-071` — Information Density and UI Customisation | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-EDIT-072` — Contextual Inspector | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-EDIT-073` — Unified Typed Command Architecture | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-GAME-074` — Macros and Action Sequences | `PLANNED` | Phase 13 | `PENDING` | `VAR-UNIT`, `VAR-DETERMINISM`, `BATCH-RECOVERY`, `VAR-E2E` |
| `REQ-GAME-075` — Guided Task Workflows | `CURRENT` | Phase 10 | `PENDING` | `GAME-UNIT`, `LOOP-GOLDEN`, `GAME-E2E` |
| `REQ-PWA-076` — Runtime Capability Tiers | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-PWA-077` — Capability Degradation Transparency | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-PWA-078` — Graceful Performance Degradation | `CURRENT` | Phase 12 | `PENDING` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-ARCH-079` — Adaptive Processing Modes | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-080` — Preview Quality and Final Render Quality | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-ARCH-081` — Canonical Deterministic Processing | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-082` — GPU Acceleration Strategy | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-ARCH-083` — Audio Performance Profiles | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-ARCH-084` — Foreground and Background Processing Priority | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-086` — Quality Presets and Expert Controls | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-ARCH-087` — Resource-Aware Operation Without Artificial Limits | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-ARCH-088` — Fully Local Core Processing | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-REC-089` — Recording Take Management | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-090` — Retrospective Recording | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-091` — Input Monitoring Safety | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-092` — Capture Processing Profiles | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-093` — Non-Destructive Punch Recording | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-094` — Device Latency, Bluetooth, and Recording Diagnostics | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-095` — Recording Latency Calibration | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-096` — Recording Resilience | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-REC-097` — Recording Capability Transparency | `CURRENT` | Phase 07 | `PENDING` | `REC-UNIT`, `REC-STATE`, `REC-RECOVERY`, `REC-E2E` |
| `REQ-STOR-098` — Concurrent Project Access and Single-Writer Ownership | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-099` — Content-Addressed Media Storage and Deduplication | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-100` — Project Encryption Scope | `EXCLUDED` | Phase 02 | `ACTIVE_EXCLUSION` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-101` — Command Journal and Immutable Snapshot Persistence | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-102` — Deleted Media Retention and Explicit Purge | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-103` — Git-Friendly Unpacked Project Format | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-104` — External Source Identity and Integrity Tracking | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-105` — Automatic Backup Generations | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-106` — Storage Cleanup Priority | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-GODOT-107` — Godot Integration Architecture | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-108` — AudioGubbins Godot Editor Addon | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-109` — Godot Runtime Addon | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-110` — Godot-Native Resource Model | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-111` — AudioGubbins Event Model for Godot | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GAME-112` — Variation Sets as a First-Class Domain Concept | `CURRENT` | Phase 13 | `PENDING` | `VAR-UNIT`, `VAR-DETERMINISM`, `BATCH-RECOVERY`, `VAR-E2E` |
| `REQ-GAME-113` — Runtime Variation Selection | `CURRENT` | Phase 13 | `PENDING` | `VAR-UNIT`, `VAR-DETERMINISM`, `BATCH-RECOVERY`, `VAR-E2E` |
| `REQ-GODOT-114` — Runtime Parameterisation | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-115` — Godot Playback Components and API | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-116` — Editor-to-Runtime Data Pipeline | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-117` — Live Godot Export and Synchronisation | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-118` — Source and Generated Asset Placement | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-119` — Persistent Export Recipes | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GAME-120` — Asset Groups and Inherited Game-Audio Policy | `CURRENT` | Phase 10 | `PENDING` | `GAME-UNIT`, `LOOP-GOLDEN`, `GAME-E2E` |
| `REQ-GAME-121` — Seamless Loop Analysis and Validation | `CURRENT` | Phase 10 | `PENDING` | `GAME-UNIT`, `LOOP-GOLDEN`, `GAME-E2E` |
| `REQ-GAME-122` — Game-Context Preview Simulator | `CURRENT` | Phase 10 | `PENDING` | `GAME-UNIT`, `LOOP-GOLDEN`, `GAME-E2E` |
| `REQ-GODOT-123` — Godot-Side Generated Descriptors | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-124` — Multiple Godot Targets | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-125` — Godot Addon Packaging and Independence | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-126` — Godot Integration Safety and Review Requirements | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-127` — Godot Runtime Integration Direction | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-128` — Parameter-Driven Runtime Audio Model | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-129` — Layered and Composite Events | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-130` — Advanced Event Authoring Direction | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-131` — Godot Generated Data Location | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-132` — Git and Source-Control Behaviour for Godot Integration | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-133` — Runtime Independence and Open Asset Principle | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-134` — Live Synchronisation Architecture | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-GODOT-135` — Godot Runtime Diagnostics and Debugging | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-EXEC-136` — AudioGubbins Agent Implementation Guardrails | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-137` — Specification Clarity Requirements for Agent Execution | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-AUDIO-138` — Local Machine-Learning Processing | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-AUDIO-139` — ML Model Packs and Storage | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-ARCH-140` — Typed Directed Processing Graph | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-ARCH-141` — DSP Implementation Languages | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-REPO-142` — Open-Source Licence | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-AUDIO-143` — Render Quality Policy | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-ARCH-144` — Processor Latency and Automatic Delay Compensation | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-AUDIO-145` — Processor Versioning and Reproducibility | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-AUDIO-146` — DSP Architecture Review Requirements | `CURRENT` | Phase 06 | `PENDING` | `DSP-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `DSP-PROPERTY`, `ML-LOCALITY` |
| `REQ-PROD-147` — Release-Version Philosophy | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-PROD-148` — Continuous Feature-Delivery Policy | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-PROD-149` — Release Channel and Maturity Labels | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-PROD-150` — Real-World Validation Before Stable Releases | `CURRENT` | Phase 15 | `PENDING` | `RELEASE-VERIFY`, `FULL-SUITE`, `REALWORLD-VALIDATION`, `SPEC-LINT` |
| `REQ-ARCH-151` — Initial Front-End and Workspace Technology Selection | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-AUDIO-152` — High-Performance Editor Rendering Layer | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-ARCH-153` — State Ownership and Workflow State | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-REPO-154` — Repository and Package Topology | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-UX-155` — Styling and Design-System Architecture | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-AUDIO-156` — Video Reference and Sound-to-Picture Workflows | `CURRENT` | Phase 04 | `PENDING` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio | `CURRENT` | Phase 03 | `PENDING` | `AUDIO-UNIT`, `DSP-RUST`, `AUDIO-GOLDEN`, `AUDIO-LATENCY`, `AUDIO-RESPONSIVENESS` |
| `REQ-PROD-158` — MIDI Scope Exclusion | `EXCLUDED` | Phase 00 | `ACTIVE_EXCLUSION` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-PWA-159` — Future Native Host or Local Bridge | `DEFERRED` | Phase 12 | `DEFERRED` | `PWA-BUILD`, `PWA-OFFLINE`, `PWA-UPDATE`, `PWA-GHPAGES`, `PWA-BROWSER` |
| `REQ-PROD-160` — Musical Timeline and Tempo Features — Deferred Possibility | `DEFERRED` | Phase 04 | `DEFERRED` | `TIMELINE-UNIT`, `WAVEFORM-UNIT`, `RENDERER-E2E`, `INPUT-E2E`, `VIDEO-REF` |
| `REQ-PRIV-161` — Diagnostic Submission and Consent Policy | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PRIV-162` — Usage Analytics Policy | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PRIV-163` — Collaboration Scope Exclusion | `EXCLUDED` | Phase 00 | `ACTIVE_EXCLUSION` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-PRIV-164` — Language and Localisation Policy | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-PRIV-165` — Structured Diagnostic Logging | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-STOR-166` — Asset Provenance and Traceability | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-EXEC-167` — Agent Execution Contract | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-168` — Requirement Conflict and Deviation Protocol | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-169` — Architectural Autonomy and ADR Policy | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-170` — Independent Multi-Lens and Adversarial Review | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-171` — Review Finding Verification and Remediation | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-172` — Review Severity and Gate Semantics | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-173` — No Autonomous Scope Reduction | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-174` — TODO and Acceptance-Criteria Integrity | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-175` — Dependency Introduction Policy | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-176` — Cohesion and Complexity Guardrails | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-177` — Anti-God-Object and Module-Ownership Rules | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-178` — Design-Principle Anti-Cargo-Cult Rule | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-179` — Refactoring Expectations During Phase Work | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-180` — Test Integrity and Anti-Cheating Rules | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-181` — Placeholder, Stub, and Temporary-Code Gate Rule | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-REPO-182` — Source-Control Execution Model | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-183` — Phase Evidence Package | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-184` — Architecture Enforcement Tests | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-REPO-185` — Repository and Monorepo Structure | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-REPO-186` — Package and Workspace Management | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-REPO-187` — Product Versioning | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-REPO-188` — Tiered Verification and CI Requirements | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-REPO-189` — Performance Regression Philosophy | `CURRENT` | Phase 14 | `PENDING` | `MATRIX-BROWSER`, `MATRIX-A11Y`, `MATRIX-PERF`, `MATRIX-STRESS`, `MATRIX-RECOVERY`, `GODOT-GUT` |
| `REQ-REPO-190` — Godot Automated Testing with GUT | `CURRENT` | Phase 11 | `PENDING` | `GODOT-SCHEMA`, `GODOT-GUT`, `GODOT-GENERATION`, `GODOT-LIVE` |
| `REQ-REPO-191` — Reference Assets, Fixtures, and Example Projects | `CURRENT` | Phase 01 | `PENDING` | `APP-LINT`, `APP-TYPE`, `APP-UNIT`, `APP-ARCH`, `APP-E2E-SMOKE` |
| `REQ-REPO-192` — CI/Repository Setup Handoff Requirement | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-STOR-193` — Branching Project History | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-194` — Named Project Snapshots | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-195` — Whole-Project A/B State Comparison | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-196` — History Workspace Panel | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-197` — Export Provenance in Project History | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-198` — External Side Effects and Undo Semantics | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-199` — Project Forks from Historical State | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-STOR-200` — History Storage Inspection and Compaction | `CURRENT` | Phase 02 | `PENDING` | `DATA-UNIT`, `DATA-RECOVERY`, `DATA-ROUNDTRIP`, `DATA-QUOTA`, `APP-ARCH` |
| `REQ-EXEC-201` — Specification Execution Architecture | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-202` — Normative Requirement Identifiers | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-203` — Phase Packet Contract | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-204` — Phase Context Loading Protocol | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-205` — Requirement Traceability Matrix | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-206` — Phase Dependency Graph and Readiness Gate | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-207` — Phase Size and Internal Work Breakdown | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-208` — Parallel-Agent and Worktree Coordination | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-209` — Implementation Ledger | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-210` — Phase Handoff Capsule | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-211` — Decision Authority and Conflict Resolution | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-212` — Specification Change Control During Implementation | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-213` — Specification Static Validation | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-214` — Context-Overload Guardrail | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-215` — Requirements-to-Tests Rule | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-216` — No Hidden Implementation Assumptions | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-217` — Specification Hardening Milestone Before Production Implementation | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-218` — Adversarial Specification Review | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
| `REQ-EXEC-219` — Compiled Specification Generation | `CURRENT` | Phase 00 | `SATISFIED_BASELINE` | `SPEC-LINT`, `SPEC-BUILD`, `SPEC-ADVERSARIAL` |
