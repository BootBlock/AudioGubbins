# Phase 07 — Recording

## Status

`READY` — its hard dependencies, Phases 02, 03, 05 and 06, are `PASS`, and its readiness review on 2026-10-09 settled its scope in `ADR-0070`, `ADR-0071` and `ADR-0072`.

## Objective

Implement advanced, resilient recording and audio-I/O workflows using dry authoritative capture, take stacks, non-destructive punch recording, retrospective buffer, monitoring safety, latency calibration, and capability diagnostics. The dry input is captured on the audio thread and committed in chunks by the storage worker as it is made (`ADR-0070`, `ADR-0071`); every recording is a new asset, and a punch is an edit that reads a take stack's chosen take, so no recording overwrites audio (`ADR-0072`).

## User-Visible Outcome

Users can record professionally with device selection/meters/monitoring/effects/pre-roll/punch/take stacks and recover interrupted captures without destructive overwrite. They choose an input and a capture profile, see what the browser actually granted, monitor safely, calibrate latency, keep the seconds before they pressed Record, name, compare and choose takes, punch in over a range and change their mind, and find every take, and any recording a crash interrupted, after a reload.

## Hard Dependencies

- Phase 02 — Project and Storage System
- Phase 03 — Audio Engine Foundation
- Phase 05 — Core Non-Destructive Editing
- Phase 06 — Effect Rack and Core DSP

## Owned Requirements

- `REQ-REC-020` — Recording (`CURRENT`)
- `REQ-REC-089` — Recording Take Management (`CURRENT`)
- `REQ-REC-090` — Retrospective Recording (`CURRENT`)
- `REQ-REC-091` — Input Monitoring Safety (`CURRENT`)
- `REQ-REC-092` — Capture Processing Profiles (`CURRENT`)
- `REQ-REC-093` — Non-Destructive Punch Recording (`CURRENT`)
- `REQ-REC-094` — Device Latency, Bluetooth, and Recording Diagnostics (`CURRENT`)
- `REQ-REC-095` — Recording Latency Calibration (`CURRENT`)
- `REQ-REC-096` — Recording Resilience (`CURRENT`)
- `REQ-REC-097` — Recording Capability Transparency (`CURRENT`)

### Requirements Consumed From Other Phases

Owned elsewhere; this phase delivers the part named, or keeps what it asks.

- `REQ-ARCH-004` — Core Architectural Principles (Phase 01): a recorded source is immutable; takes and punches are project state changed by commands.
- `REQ-ARCH-085` — Native Asset Sample Rates and Future Session Rate (Phase 03): a recording keeps the rate it was captured at; a mismatch with the input's rate is disclosed, never hidden.
- `REQ-ARCH-087` — Resource-Aware Operation Without Artificial Limits (Phase 03): no limit on a recording's length beyond storage, which is watched and stated.
- `REQ-ARCH-144` — Processor Latency and Automatic Delay Compensation (Phase 03): monitoring latency, the live rack's included, is reported.
- `REQ-ARCH-153` — State Ownership and Workflow State (Phase 01): the recording session is an explicit state machine, and monitoring a second one.
- `REQ-ARCH-157` — Multichannel, Surround, and Ambisonic Audio (Phase 03): a recording has the input's granted channel count, mono to N channels.
- `REQ-AUDIO-156` — Video Reference and Sound-to-Picture Workflows (Phase 04): capture, pre-roll and punch-in share the one media clock.
- `REQ-AUDIO-220` — Native-Rate Reading of Uncompressed Audio (Phase 05): a recorded asset and a torn chunk are read to their last whole frame.
- `REQ-EDIT-012` — Timeline and Editing Requirements (Phase 04): punch-in over the selected range.
- `REQ-EDIT-072` — Contextual Inspector (Phase 01): the Inspector shows the recording configuration, a take and a take stack.
- `REQ-STOR-021` — Undo, Redo, Autosave, and Recovery (Phase 02): take and punch changes are undoable, and interrupted recordings are recovered.
- `REQ-STOR-052` — Project Schema Compatibility Policy (Phase 02): the raised schema versions are refused, never migrated, before 1.0.
- `REQ-STOR-098` — Concurrent Project Access and Single-Writer Ownership (Phase 02): only the tab that holds the write lease arms or records.
- `REQ-STOR-099` — Content-Addressed Media Storage and Deduplication (Phase 02): recorded media enters the content-addressed store; recording sessions are reachable state.
- `REQ-STOR-102` — Deleted Media Retention and Explicit Purge (Phase 02): a removed or rejected take's media stays while any state reaches it.
- `REQ-STOR-106` — Storage Cleanup Priority (Phase 02): no cleanup removes a recording in progress or an interrupted one.
- `REQ-STOR-166` — Asset Provenance and Traceability (Phase 02): a recorded asset's provenance states its device, profile, granted settings, time and whether it ended unexpectedly.
- `REQ-STOR-195` — Whole-Project A/B State Comparison (Phase 02): take stacks are compared between states.
- `REQ-PRIV-161` — Diagnostic Submission and Consent Policy (Phase 01): no recorded audio and no device label in a diagnostic bundle by default.
- `REQ-PRIV-165` — Structured Diagnostic Logging (Phase 01): no device label and no audio in a log.
- `REQ-UX-005` — User Experience Goals (Phase 01): meters, the armed, buffering, recording and monitoring states, and every recording control have keyboard and non-visual forms.
- `REQ-UX-058` — Workspace Presets (Phase 01): the Recording preset gains the Recording panel.
- `REQ-PWA-028` — Platform Support (Phase 12): capture features are capability-gated.
- `REQ-PWA-077` — Capability Degradation Transparency (Phase 12): a degraded recording capability is disclosed in the recording diagnostics and the capabilities panel.
- `REQ-PROD-009` — Audio Duration and Scale (Phase 03): recordings lasting tens of minutes, never held whole in memory.

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

- [ ] Device enumeration/selection: input devices, permission state and its revocation, device changes, and remembering a device by identifier, then group and label (`ADR-0070`)
- [ ] Raw/Studio default capture profile, with Voice and Custom; the requested and the granted settings compared and disclosed, with progressive disclosure and per-constraint override (`REQ-REC-092`)
- [ ] Input meters, with a non-visual form, and input gain monitoring
- [ ] Mono to N-channel recording at the input's granted channel count, into a new project asset of origin `recorded` (`ADR-0071`)
- [ ] Safe software monitoring and effect monitoring: monitoring off by default, one command to turn it on or off, a persistent visible state apart from recording, a feedback warning, preferences per device and profile, and automatic monitoring only for a profile the person marks as for headphones; monitoring through a live chain on the audio thread, refused with its reason for a chain that cannot run live (`ADR-0070`)
- [ ] Pre-roll/punch-in, with post-roll and boundary crossfades, as a punch edit that reads a take stack's chosen take (`ADR-0072`)
- [ ] Take stacks: successive takes, naming and notes, quick audition, promotion, rejection, duplication, branching, removal that keeps the take recoverable, and consolidation that keeps history, each a command with its inverse (`ADR-0072`)
- [ ] Retrospective recording buffer of 5 to 60 seconds while armed, local and transient, overwritten with zeros when no longer needed, with the device, armed, buffering, duration and recording states shown in the status bar for as long as an input is open (`ADR-0070`)
- [ ] Latency calibration/compensation metadata: output, input and round-trip latency, guided loopback calibration, a manual offset, values per device pair and rate, recalibration prompts, and compensation applied as a take's placement, never to samples (`ADR-0070`)
- [ ] Bluetooth/high-latency warnings, as estimates, and sample-rate mismatch, device change and channel-limit diagnostics, with recording kept available (`REQ-REC-094`)
- [ ] Incremental crash-resilient capture: one-second chunks committed by the storage worker, recording sessions as reachable state, recovery offered when the project opens and before any cleanup, recovered assets marked as ended unexpectedly, and quota watched before and during recording (`ADR-0071`)
- [ ] Scheduled/controlled recording where platform permits: count-in or pre-roll, a timed stop, and a start at a set time while the page stays open, armed and visible, with background and screen-lock suspension detected and explained (`ADR-0070`)
- [ ] A recording diagnostics surface that explains the effective capabilities of the browser and hardware, what a degradation affects, why, its impact and what would improve it, without obstructing work (`REQ-REC-097`)
- [ ] The recorded-media WAV writer in `packages/codecs`: 32-bit float PCM, RF64 past four gibibytes (`ADR-0071`)
- [ ] Recording views: a Recording panel, the status bar's input state, the Inspector's recording configuration, take and take stack, the Audio settings' input section, and the Recording preset; every view invokes only commands

## Explicitly Out of Scope

- Full multitrack comping: `REQ-REC-089` defers it to the future multitrack and clip architecture, which no phase of this specification builds; a stack chooses one take for its range (`ADR-0072`)
- MIDI control (`REQ-PROD-158`, excluded, Phase 00)
- Native-driver-only features, lower-latency native audio I/O and system or loopback capture (`REQ-PWA-159`, deferred to a future native host)
- Measuring a live chain's cost and moving a too-costly monitoring chain to a render (Phase 14, as the Phase 06 handoff records)
- Output device selection, whose capability and port exist from Phase 03 (Phase 14's device hardening)
- Every audio writer other than the recorded-media WAV writer, and every export (Phase 09, `ADR-0050` amended)

## Owned Modules / Packages

- `packages/recording` (new and portable: the session state machine, capture profiles, the calibration's analysis and controlled recording, `ADR-0070`)
- `packages/capabilities` (Phase 01's; this phase adds the media input adapter, the only place the browser's input is reached)
- `packages/audio-runtime` (Phase 03's; this phase adds the input side of its context port and the capture worklet)
- `packages/effect-rack` (Phase 06's; this phase adds its live form for monitoring)
- `packages/codecs` (Phase 05's; this phase adds the recorded-media WAV writer)
- `packages/storage` and `packages/storage-runtime` (Phase 02's; this phase adds the recording area, the recovery of sessions, the quota watch, and runs the media store's recovery)
- `packages/domain/project` and `packages/domain/editing` (take stacks and the punch edit, `ADR-0072`)
- `packages/project-format` take stacks, the punch edit, recorded provenance and `RecoveryChunkManifest`
- `packages/project-commands` take and punch commands
- `packages/history` take-stack differences
- `packages/workspace` (the Recording preset's panel)
- `apps/web recording workspace`: the Recording panel, the status bar's input state, the Inspector's recording views, the Audio settings' input section and the recording commands

## Cross-Package Dependency Rules

- Recording uses audio-engine and project/media-store public APIs.
- Device/browser adapters do not become the take/project domain model.
- Only `packages/capabilities` reads a browser global; it gives the media input adapter to the application, which gives what it opens to the runtime (`ADR-0030`, `ADR-0040`, `ADR-0070`).
- `packages/recording` depends on the domain and `packages/text` only; it knows no browser global, no React, no storage and no audio host.
- `packages/audio-runtime` alone makes audio nodes; its capture worklet loads `packages/effect-rack` and `packages/processors` in its thread entry only (`ADR-0030` amended).
- Only the storage worker writes recorded media; the page reaches it through `StorageClient`, and the capture worklet sends it the samples (`ADR-0022`, `ADR-0071`).
- The interface changes takes, stacks, punches, profiles, monitoring and calibration only through project and application commands.

## Required Public Contracts

- RecordingSession (`packages/recording`, `ADR-0070`)
- CaptureProfile (`packages/recording`, `ADR-0070`)
- InputDeviceDescriptor (`packages/capabilities`, `ADR-0070`)
- TakeStack (`packages/domain`, `ADR-0072`)
- PunchRange (`packages/domain`, `ADR-0072`)
- LatencyCalibration (`packages/recording`, `ADR-0070`)
- RecoveryChunkManifest (`packages/project-format`, `ADR-0071`)
- The media input adapter (`packages/capabilities`, `ADR-0070`)
- The capture worklet and its capture channel (`packages/audio-runtime`, `ADR-0070`)
- The effect rack's live form (`packages/effect-rack`, `ADR-0070`)
- The punch edit (`packages/domain`, `ADR-0072`)
- The storage worker's recording operations (`packages/storage-runtime`, `ADR-0071`)
- The recorded-media WAV writer (`packages/codecs`, `ADR-0071`)

## Data / Schema Changes

- Introduces recording-session metadata, take-stack records, punch ranges, latency calibration profiles and incremental recovery-chunk manifests.
- The project document gains take stacks, the punch edit and recorded provenance, raising `projectDocument`; project storage gains recording sessions, raising `projectStorage`; the person's audio settings gain capture profiles, monitoring preferences and calibrations, raising `audioSettings`. Before 1.0 nothing migrates (`REQ-STOR-052`).
- Settled by this phase's readiness review (`ADR-0070`, `ADR-0071`, `ADR-0072`): where capture, monitoring and latency live, how a recording is made durable and recovered, and where takes and punches sit in the edit model.

## Browser / Platform Considerations

- Microphone permissions, device IDs, browser capture processing controls and Bluetooth behaviour vary by platform.
- Mobile background/screen-lock capture restrictions must be detected and explained.
- Assumed nowhere (`REQ-EXEC-216`): that a microphone, a permission or a given device exists; that a device identifier lasts; that requested constraints were granted; that the input's rate is the context's; that storage quota suffices; that a browser reports input latency; that a device is Bluetooth or headphones. Each is probed, measured or asked, and its absence has stated behaviour.
- Capture works without cross-origin isolation, by posted blocks, as playback feeds do (`ADR-0007`).
- Recording needs a secure context; the capabilities panel says so where it is missing.

## Architectural Invariants

- Dry capture remains authoritative.
- Monitoring effects are non-destructive.
- Punch-in creates a new take rather than overwriting prior audio.
- Microphone/retrospective buffering has persistent visible privacy/status indication.
- Every recording is a new asset; no source is ever changed (`ADR-0072`).
- Latency compensation is a take's placement, never a change to its samples.
- Every chunk committed before a crash, a reload, a lost device or a refused write is recoverable, and nothing removes it until the person recovers or discards it (`ADR-0071`).
- No input is opened, and nothing is buffered, unless the person arms or records.
- Monitoring is never turned on by arming.
- Only the write-lease holder records into a project.

## Internal Work Units

### WU-07.A — Device/capture state machine

- [ ] Implement the media input adapter in `packages/capabilities`: permission state and changes, input devices, supported constraints, opening an input, and the granted settings
- [ ] Implement device enumeration/change handling, and finding a remembered device again
- [ ] Implement Raw/Studio, Voice and Custom capture profiles, and the comparison of requested and granted settings
- [ ] Implement the recording session's state machine in `packages/recording`
- [ ] Implement the capture worklet and the input side of the context port, with input meters and explicit browser-processing controls

### WU-07.B — Monitoring and latency

- [ ] Implement monitoring-off default with feedback warning, one-command toggling, per-device and per-profile preferences, and headphone profiles
- [ ] Implement effects monitoring path: the effect rack's live form in the capture worklet, refusing a chain that cannot run live
- [ ] Implement latency measurement/calibration and Bluetooth diagnostics, sample-rate mismatch and device-change diagnostics
- [ ] Implement the recording diagnostics surface

### WU-07.C — Takes and punch

- [ ] Implement take stacks and audition/promote operations, with naming, notes, rejection, duplication, branching, removal and consolidation, their commands, inverses, persisted form and history differences
- [ ] Implement pre-roll and non-destructive punch-in: the punch edit, its crossfades and its validation, folded by the plan

### WU-07.D — Retrospective/resilience

- [ ] Implement configurable armed rolling buffer with privacy indicator
- [ ] Persist recording incrementally so process/tab failure can recover completed chunks: the storage worker's recording area, the manifest, one-second chunks, and recording sessions as reachable state
- [ ] Implement the recorded-media WAV writer and the path from a whole recording to an asset with its provenance
- [ ] Offer interrupted sessions for recovery when a project opens, before cleanup, and run the media store's recovery after them
- [ ] Watch the storage estimate before and during recording, and stop and keep what is committed when a write is refused

### WU-07.E — Views and controlled recording

- [ ] Implement the Recording panel, the status bar's input state, the Inspector's recording views, the Audio settings' input section and the Recording preset's panel
- [ ] Implement count-in, timed stop and scheduled start, with background and screen-lock detection

## Failure and Recovery Behaviour

- Device removal mid-recording must finalise/recover valid captured chunks.
- Permission denial/revocation must not corrupt project state.
- Quota pressure during recording must surface early and recover all committed capture.
- Monitoring feedback-risk state must be visible.
- A crash, a reload or a closed tab keeps every committed chunk; the next opening of the project offers the session for recovery before any cleanup, and a recovered asset says capture ended unexpectedly.
- A torn last chunk is read to its last whole frame.
- A take shorter than its punch range is refused for it, with the reason; nothing else changes.
- A chain that cannot run live is refused for monitoring with its reason; recording continues.
- A capture that a browser suspends in the background stops and keeps what it has, and says why.
- A tab without the write lease is told why it cannot arm or record.

## Required Verification Commands / Suites

- `pnpm --filter @audiogubbins/recording --filter @audiogubbins/capabilities --filter @audiogubbins/audio-runtime --filter @audiogubbins/codecs test`
- `pnpm test:recovery`
- `pnpm test:storage-quota`
- `pnpm test:project-roundtrip`
- `pnpm test:editing-property`
- `pnpm test:audio-latency`
- `pnpm test:architecture`
- `pnpm test:recording-recovery`, which this phase adds: the recording session's recovery tests, which stop the writer at every step, tear a chunk, refuse a write for quota and lose a device
- `pnpm test:e2e:recording`, which this phase adds: a Chromium project with a fake input device and a granted microphone permission

## Acceptance Criteria

- [ ] Interrupted recording recovery reconstructs valid audio up to the last committed chunk.
- [ ] Punch-in never destroys the previous take.
- [ ] Retrospective capture recovers the configured pre-record interval while armed.
- [ ] Browser AGC/echo/noise processing is disabled in Raw/Studio where the platform permits and any inability is disclosed.
- [ ] Input monitoring starts disabled by default and warnings/preferences work as specified.
- [ ] The recorded asset's samples are the dry input's, bit for bit, whatever monitoring, effects or compensation was on.
- [ ] Choosing another take in a punch stack changes what the punch plays, one undo restores the choice, and no take's media is lost while any state names it.
- [ ] Latency compensation is applied as a take's placement, and the take's samples are unchanged.
- [ ] No input is open, and no audio is buffered, unless an input is armed or recording, and the status bar says which.
- [ ] A browser test records with a fake input, punches in over a range, chooses another take, reloads, and hears the same project; another reloads mid-recording and recovers the committed chunks.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No destructive punch overwrite.
- No hidden microphone buffering when not armed.
- No assumption that device IDs remain stable forever.
- No browser speech-processing defaults silently applied in Raw/Studio.
- No browser global read outside `packages/capabilities`, and no second audio context for capture.
- No recording held whole in memory until stop; no recorded samples passed through the page.
- No second take or timeline model beside the edit model; no take that edits another take's source.
- No compensation, gain or monitoring effect applied to recorded samples.

## Required Review Lenses

- Architecture
- Audio / DSP Correctness
- Security / Privacy
- Data Integrity / Recovery
- Performance / Scalability
- UX / Accessibility / Input
- Browser / PWA Compatibility
- Testing / Regression
- Code Quality / Maintainability
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Inherited Debt

Assigned to this phase by the Phase 06 handoff and by this phase's readiness review:

- Monitoring through effects while recording (Phase 06 handoff), listed under In Scope.
- The media store's recovery of an incomplete store, `MediaObjectStore.recoverIncomplete`, is run by no production path (Phase 02, found by this review): this phase runs it at the storage worker's start, after recording sessions are listed (`ADR-0071`).
- The storage estimate the capabilities package reads has no consumer, so nothing warns before storage runs out (Phase 02, found by this review): this phase's quota watch reads it (`ADR-0071`).
- The audio runtime's context port and worklet have no input, and its fakes none either (Phase 03, found by this review): this phase adds the input side and its fakes (`ADR-0070`).

## Handoff Capsule

Create `traceability/handoffs/phase-07.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
