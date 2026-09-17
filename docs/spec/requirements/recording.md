# Recording and Audio I/O Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-REC-020` — Recording — owner Phase 07 — scope `CURRENT`
- `REQ-REC-089` — Recording Take Management — owner Phase 07 — scope `CURRENT`
- `REQ-REC-090` — Retrospective Recording — owner Phase 07 — scope `CURRENT`
- `REQ-REC-091` — Input Monitoring Safety — owner Phase 07 — scope `CURRENT`
- `REQ-REC-092` — Capture Processing Profiles — owner Phase 07 — scope `CURRENT`
- `REQ-REC-093` — Non-Destructive Punch Recording — owner Phase 07 — scope `CURRENT`
- `REQ-REC-094` — Device Latency, Bluetooth, and Recording Diagnostics — owner Phase 07 — scope `CURRENT`
- `REQ-REC-095` — Recording Latency Calibration — owner Phase 07 — scope `CURRENT`
- `REQ-REC-096` — Recording Resilience — owner Phase 07 — scope `CURRENT`
- `REQ-REC-097` — Recording Capability Transparency — owner Phase 07 — scope `CURRENT`

---

## REQ-REC-020 — Recording

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 20 of the pre-hardening baseline

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

## REQ-REC-089 — Recording Take Management

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 89 of the pre-hardening baseline

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

## REQ-REC-090 — Retrospective Recording

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 90 of the pre-hardening baseline

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

## REQ-REC-091 — Input Monitoring Safety

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 91 of the pre-hardening baseline

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

## REQ-REC-092 — Capture Processing Profiles

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 92 of the pre-hardening baseline

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

## REQ-REC-093 — Non-Destructive Punch Recording

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 93 of the pre-hardening baseline

Punch-in and replacement recording shall be non-destructive by default.

A punch operation must create new underlying recorded material for the target range rather than destructively overwriting the prior source.

Previous material shall remain recoverable through:

- Take management
- Undo/redo history
- Project recovery/history mechanisms

Punch workflows should support pre-roll and post-roll where useful for performance context.

Later consolidation/render operations may create flattened media when explicitly requested, but consolidation must not silently destroy the recoverable project history.

---

## REQ-REC-094 — Device Latency, Bluetooth, and Recording Diagnostics

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 94 of the pre-hardening baseline

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

## REQ-REC-095 — Recording Latency Calibration

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 95 of the pre-hardening baseline

AudioGubbins should support recording-latency calibration so that newly recorded material can be aligned accurately against the project timeline.

Calibration should support, where technically practical:

- Automatic or guided loopback calibration
- Manual offset entry
- Per-device/profile calibration values
- Recalibration prompts after meaningful device/path changes
- Separation of input, output, and round-trip measurements where useful

Applied compensation must be explicit in diagnostics and must not irreversibly alter the original recorded PCM.

---

## REQ-REC-096 — Recording Resilience

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 96 of the pre-hardening baseline

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

## REQ-REC-097 — Recording Capability Transparency

- **Owner:** Phase 07 — Recording
- **Scope:** `CURRENT`
- **Legacy source:** section 97 of the pre-hardening baseline

AudioGubbins shall provide a recording/audio-I/O diagnostics surface that explains the effective capabilities of the current browser and hardware combination.

Where functionality is degraded, unavailable, emulated, or operating through a fallback, the user should be able to discover:

- What capability is affected
- Why it is affected
- The practical impact
- Whether changing browser, device, permission, deployment runtime, or settings can improve it

Capability transparency must be informative rather than alarmist and should not obstruct normal workflows unless user action is genuinely required.

---
