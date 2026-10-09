# Phase Handoff Capsule — Phase 07

## Capability Delivered

AudioGubbins records. The person chooses an input and a capture profile,
Raw/Studio by default, and sees what the browser granted against what was
asked. The dry input is captured on the audio thread, in the page's one audio
context, so recording, pre-roll and punch-in share the playback clock, and the
storage worker commits it in chunks of at most one second as it is made, so a
crash, a reload, a lost device or a full disk keeps every committed chunk
(`ADR-0070`, `ADR-0071`). A stopped recording becomes a new asset of origin
`recorded`, a 32-bit float WAV, RF64 past four gibibytes, with its provenance;
a recording cut short is offered for recovery when its project opens, before
anything is cleaned. Monitoring is a path apart from the capture, off by
default, dry or through a live chain, after a feedback warning. Takes gather in
stacks, are named, noted, auditioned, chosen, rejected, duplicated, branched,
removed, restored and consolidated by commands with inverses, and a punch is
an edit that reads a stack's chosen take with a crossfade at each boundary, so
no recording overwrites audio (`ADR-0072`). A retrospective buffer keeps up to
a minute before Record; a loopback calibration or a manual offset places a take
by its latency; count-in, a timed stop and a set start control a recording;
and the recording diagnostics explain what the browser and the hardware allow.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-07-evidence.md`, under "Requirement-to-evidence mapping", with
the consumed requirements beside them. Comping, a part of `REQ-REC-089`, is
deferred by that requirement, as recorded below.

- `REQ-REC-020`
- `REQ-REC-089`
- `REQ-REC-090`
- `REQ-REC-091`
- `REQ-REC-092`
- `REQ-REC-093`
- `REQ-REC-094`
- `REQ-REC-095`
- `REQ-REC-096`
- `REQ-REC-097`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them; these differ in name:

- The packet's media input adapter is `MediaInput`, answered by
  `readMediaInput`, in `@audiogubbins/capabilities`; it also reads the output
  the page plays through as an `OutputDeviceDescriptor`.
- The packet's capture worklet is the `./threads/capture-processor` entry of
  `@audiogubbins/audio-runtime`, driven by `CaptureSession`; its capture
  channel is the `MessagePort` `CaptureSession.record` answers, read by
  `CaptureReader`, also the `./capture-channel` entry.
- The packet's effect rack live form is `ChainProcessing.prepareLive`, taking
  a `LiveChainRequest`, in `@audiogubbins/audio-engine`, implemented by
  `chainProcessing` in `@audiogubbins/effect-rack`.
- The packet's punch edit is `PunchEdit`, a `RangeEdit` of kind `punch`.
- The packet's storage worker recording operations are `RecordingClient` and
  `RecordingStatus` in `@audiogubbins/storage-runtime`.
- The packet's recorded-media WAV writer is `recordedWavHeader` and
  `recordedWavLength` in `@audiogubbins/codecs`.
- The packet's Recording panel is the panel of kind `recording`, titled
  Recorder, so the Workspace menu does not list it beside the Recording
  preset under the same name.

And by package:

- `@audiogubbins/recording` (new): `RecordingSession`, `nextSession`,
  `SessionEvent`; `Monitoring` and `nextMonitoring`;
  `CaptureProfile` and the comparison of the asked and the granted settings;
  `DeviceIdentity`; `LatencyCalibration`, `calibrationOf`, `manualCalibration`,
  the loopback analysis and a take's compensation; the retrospective buffer's
  bounds and `retrospectiveFit`; `punchWindow`; the storage time left; the controlled recording's schedule; the
  recording diagnostics, `browserDiagnostics` and `pathChangesText`.
- `@audiogubbins/capabilities`: `MediaInput`, `readMediaInput`,
  `InputDeviceDescriptor`, `OutputDeviceDescriptor`, `OpenedInput`, the
  capture request and granted settings, `MicrophonePermission`, and page
  visibility.
- `@audiogubbins/audio-runtime`: `MediaStreamSourcePort` and a worklet node
  with one input on the context port, `CaptureSession`, `CaptureReader`, the
  capture messages, and `retrospectiveRefusal`, which refuses only a length
  no buffer could have; the span a person may choose is the recording
  package's.
- `@audiogubbins/audio-engine`: `ChainProcessing.prepareLive` and
  `LiveChainRequest`.
- `@audiogubbins/domain`: `TakeStack`, `Take`, `TakeState`, `PunchRange`,
  `PunchCrossfade`, `PunchEdit`, `Project.takeStacks`, the plan's `mix`
  source, `punchTakeProblem`.
- `@audiogubbins/project-format`: take stacks and the punch edit in their
  persisted form, `RecordedProvenance` on an asset's source,
  `RecoveryChunkManifest` and `TakeRequest`, `RecordingEnding` and
  `endedUnexpectedly`.
- `@audiogubbins/project-commands`: the take, stack and punch commands;
  `@audiogubbins/history`: take-stack and recorded-provenance differences.
- `@audiogubbins/storage`: the recording area, `CaptureStream`, interrupted
  recordings, their recovery and discarding, `recoverMediaStore`;
  `@audiogubbins/storage-runtime`: `RecordingClient`, `RecordingStatus`.
- `@audiogubbins/codecs`: `recordedWavHeader`, `recordedWavLength`;
  `@audiogubbins/workspace`: the Recording preset's panel.

## Persisted / Interchange Formats

- The project document, `projectDocument` version 7: take stacks, the punch
  edit, the plan's `mix` source, and recorded provenance on a recorded asset's
  source.
- Project storage, `projectStorage` version 11: recording sessions under
  `projects/<id>/recordings/<session>/`, each a `RecoveryChunkManifest` kept as
  a pair of files, chunks of 32-bit float little-endian interleaved frames
  named by their first frame in twelve digits, and markers of frames lost
  under `gaps/`; take stacks in history records.
- Audio settings, `audioSettings` version 3: capture profiles, monitoring
  preferences per device and profile, and calibrations per input device,
  output device and rate.
- Recorded media: 32-bit float PCM WAV, `WAVE_FORMAT_IEEE_FLOAT` for mono and
  stereo and `WAVE_FORMAT_EXTENSIBLE` with its speaker mask otherwise, RF64
  past four gibibytes, in the content-addressed store.
- Before 1.0 nothing migrates (`REQ-STOR-052`): a document, record or manifest
  of another version is refused with the reason.

## Invariants Downstream Agents Must Preserve

- The dry input is the recording. The capture processor copies the input
  before anything else touches it; no monitoring effect, gain or compensation
  reaches the recorded samples, and the page never holds them.
- Only `packages/capabilities` reads a browser global and reaches the input;
  only `packages/audio-runtime` makes audio nodes, in the page's one audio
  context, and its capture worklet loads the rack and processors only in its
  thread entry. No second context is made for capture.
- No input is opened, and nothing is buffered, unless the person arms or
  records. Arming never turns monitoring on; only a profile the person marked
  for headphones turns it on by itself. The retrospective buffer lives in the
  worklet's memory, is never written until Record, and is zeroed when let go.
- The status bar shows the device and whether it is armed, buffering and for
  how long, recording or calibrating, for as long as an input is open.
- Every recording is a new asset of origin `recorded`, and no source ever
  changes. A punch is an edit that names its stack and reads the chosen take
  from its unedited recording; a take is never edited by another take.
- Latency compensation is a take's `compensation` in frames, its placement,
  never a change to its samples.
- Only the storage worker writes recorded media, in chunks committed whole. A
  session's chunks and manifest are reachable state: no cleanup, cache relief,
  purge or the media store's recovery removes them, and only the person ends
  an interrupted session, by recovering or discarding it. Chunks are removed
  only once the journal holds the asset made of them.
- An interrupted session is offered when its project opens, before any
  cleanup, and its take is named and placed as the manifest recorded when the
  recording began; a recovered asset says capture ended unexpectedly.
- Frames lost on the way are a gap of their exact length, written as silence
  and counted in provenance, never passed off as audio.
- Only the tab holding the project's write lease arms or records, read each
  time the session asks; the storage worker refuses a window without write
  access.
- A device identifier is not taken to last: a device is found again by its
  identifier, then its group and label together. An output the browser does
  not name is unknown, never guessed. A device's label never enters a log or a
  diagnostic bundle.
- Every view changes takes, stacks, punches, profiles, monitoring and
  calibration only through commands.

## ADRs

- `ADR-0070` — capture, monitoring and latency; amended 2026-10-09 (a chain
  monitors where its listening is live; capabilities depends on the domain;
  the output the page plays through, unknown where the browser does not list
  it).
- `ADR-0071` — recorded media persistence and recovery; amended 2026-10-09
  (the media store's recovery at the worker's start, outside the sessions;
  the manifest keeps the take a recording was begun for).
- `ADR-0072` — take stacks and punch recording in the edit model.
- `ADR-0020`, `ADR-0022`, `ADR-0030`, `ADR-0050` and `ADR-0051` — amended by
  the three, as each records.

## Verification Baselines

- `pnpm run test:recording-recovery`: a crash at every step of a session, a
  torn chunk, a lost chunk, a lost device, storage that fills at every write,
  the capture channel's ends and gaps, and the media store's start-up
  recovery.
- `pnpm run test:e2e:recording` in Chromium with a fake input device: a take
  recorded, punched into twice, another take chosen and the choice undone,
  heard the same after a reload; and a recording cut short by a reload
  recovered.
- The punch property tests (`punch-edit-property.test.ts`, in
  `pnpm run test:editing-property`), the take commands in the random command
  walk, the round trip of take stacks, provenance and the manifest
  (`pnpm run test:project-roundtrip`), `pnpm run test:recovery`,
  `pnpm run test:storage-quota`, `pnpm run test:audio-latency` and
  `pnpm run test:architecture`.
- The final counts: `verify:commit` on the tree the closing commit holds, 695
  test files and 11,007 tests, after 693 files and 10,993 tests at
  `07192629` and `b6c07659`; every browser test
  the evidence lists passed, but for one intermittent smoke test that passed
  when run again (the evidence has each count).

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Comping across takes: deferred by `REQ-REC-089` to the multitrack and clip
  architecture, which no phase of this specification builds.
- MIDI control (`REQ-PROD-158`, excluded).
- Native-driver features, lower-latency native audio and system or loopback
  capture (`REQ-PWA-159`, a future native host).
- Measuring a live chain's cost and moving a too-costly monitoring chain to a
  render: Phase 14.
- Output device selection: Phase 14's device hardening.
- Every audio writer but the recorded-media WAV writer, and every export:
  Phase 09, which builds its WAV writing on this one.

## Accepted Non-Blocking Debt

- The output is named only where the browser lists a default output that names
  a device; in Firefox and Safari it is usually unknown, so monitoring asks
  for a confirmation, a calibration is kept for the unknown output, and a
  change of output cannot be noticed. Owed to Phase 14's device hardening.
- The recording browser test runs in Chromium only, with a fake device;
  Firefox and WebKit are not run for recording. Owed to Phase 14.
- The WAV writer refuses a layout no speaker mask states as held, such as the
  domain's `surround7_1`, `surround7_1_4` and ambisonic layouts, and a
  recording in one is refused when it starts; a capture is recorded as mono,
  stereo or three or more discrete channels, each of which it takes.
- When the capture worklet's queue fills it keeps no input until the queue
  drains, and the frames lost are one exact gap, written as silence and
  counted in provenance.
- The calibration's capture is the one page-side reader of captured samples:
  bounded, making no take, and shown as calibrating in the status bar.
- A punch reads its take's unedited recording, so an edit to a take's own
  asset is not heard in the punch.
- A punch whose target asset was edited after its set-up is refused with
  `recording.punch-moved` when it finishes or is recovered, and its session
  is kept.
- A recovered take's ending is `interrupted` unless its manifest records an
  unexpected ending of its own.
- A device label is replaced in log fields named for it, not in a message's
  text, which the recording code never writes one into.
- Fourteen exports of `@audiogubbins/recording` have no consumer outside the
  package; `tests/architecture/package-exports.test.ts` lists them under a
  reason written before the application's workspace was built.
- Tests that fail now and then under load and pass when run again: the
  storage runtime's backups-client restore test, the application's
  project-transfer commands test, and the smoke splitter test that lets a drag
  make a panel taller, a sibling of the one Phase 06 recorded. Each is in the
  evidence. Owed to Phase 14's hardening.
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-07-review.md`).
- The debt owed to this phase is closed: monitoring through effects (Phase 06,
  `1149f03b`, `389ace5c`); the media store's recovery and a consumer of the
  storage estimate (Phase 02, `838c78fe`, `07192629`); the runtime's input
  side and its fakes (Phase 03, `1149f03b`).

## Downstream Readiness

- No phase becomes newly eligible for `READY`. Phase 14 — Performance,
  Compatibility, and Accessibility Hardening still waits on Phases 08 to 13.
- Phase 08 — Spectral Editing and Phase 09 — Import, Export, and Codec System
  remain eligible, every hard dependency of each having passed with Phase 06;
  each one's readiness review decides it.
- Phase 10 still waits on Phase 09; Phase 11 on Phases 09 and 10; Phase 12 on
  Phase 09; Phase 13 on Phases 09, 10 and 11; Phase 15 on Phase 14.
