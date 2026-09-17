# Phase 07 — Recording

## Status

`NOT_READY` — blocked by Phase(s) 02, 03, 05, 06 reaching `PASS`.

## Objective

Implement advanced, resilient recording and audio-I/O workflows using dry authoritative capture, take stacks, non-destructive punch recording, retrospective buffer, monitoring safety, latency calibration, and capability diagnostics.

## User-Visible Outcome

Users can record professionally with device selection/meters/monitoring/effects/pre-roll/punch/take stacks and recover interrupted captures without destructive overwrite.

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

- [ ] Device enumeration/selection
- [ ] Raw/Studio default capture profile
- [ ] Input meters
- [ ] Safe software monitoring and effect monitoring
- [ ] Pre-roll/punch-in
- [ ] Take stacks
- [ ] Retrospective recording buffer
- [ ] Latency calibration/compensation metadata
- [ ] Bluetooth/high-latency warnings
- [ ] Incremental crash-resilient capture
- [ ] Scheduled/controlled recording where platform permits

## Explicitly Out of Scope

- Full multitrack comping
- MIDI control
- Native-driver-only features

## Owned Modules / Packages

- `packages/recording`
- `packages/audio-io`
- `packages/domain/takes`
- `apps/web recording workspace`

## Cross-Package Dependency Rules

- Recording uses audio-engine and project/media-store public APIs.
- Device/browser adapters do not become the take/project domain model.

## Required Public Contracts

- RecordingSession
- CaptureProfile
- InputDeviceDescriptor
- TakeStack
- PunchRange
- LatencyCalibration
- RecoveryChunkManifest

## Data / Schema Changes

- Introduces recording-session metadata, take-stack records, punch ranges, latency calibration profiles and incremental recovery-chunk manifests.

## Browser / Platform Considerations

- Microphone permissions, device IDs, browser capture processing controls and Bluetooth behaviour vary by platform.
- Mobile background/screen-lock capture restrictions must be detected and explained.

## Architectural Invariants

- Dry capture remains authoritative.
- Monitoring effects are non-destructive.
- Punch-in creates a new take rather than overwriting prior audio.
- Microphone/retrospective buffering has persistent visible privacy/status indication.

## Internal Work Units

### WU-07.A — Device/capture state machine

- [ ] Implement device enumeration/change handling
- [ ] Implement Raw/Studio, Voice and Custom capture profiles
- [ ] Implement meters and explicit browser-processing controls

### WU-07.B — Monitoring and latency

- [ ] Implement monitoring-off default with feedback warning
- [ ] Implement effects monitoring path
- [ ] Implement latency measurement/calibration and Bluetooth diagnostics

### WU-07.C — Takes and punch

- [ ] Implement take stacks and audition/promote operations
- [ ] Implement pre-roll and non-destructive punch-in

### WU-07.D — Retrospective/resilience

- [ ] Implement configurable armed rolling buffer with privacy indicator
- [ ] Persist recording incrementally so process/tab failure can recover completed chunks

## Failure and Recovery Behaviour

- Device removal mid-recording must finalise/recover valid captured chunks.
- Permission denial/revocation must not corrupt project state.
- Quota pressure during recording must surface early and recover all committed capture.
- Monitoring feedback-risk state must be visible.

## Required Verification Commands / Suites

- `pnpm test --filter recording`
- `pnpm test:recording-state-machine`
- `pnpm test:recording-recovery`
- `pnpm test:e2e:recording`

## Acceptance Criteria

- [ ] Interrupted recording recovery reconstructs valid audio up to the last committed chunk.
- [ ] Punch-in never destroys the previous take.
- [ ] Retrospective capture recovers the configured pre-record interval while armed.
- [ ] Browser AGC/echo/noise processing is disabled in Raw/Studio where the platform permits and any inability is disclosed.
- [ ] Input monitoring starts disabled by default and warnings/preferences work as specified.

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

## Required Review Lenses

- Audio / DSP Correctness
- Privacy / Permissions
- Data Integrity / Recovery
- UX / Accessibility
- Browser Compatibility
- Testing / Regression
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-07.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
