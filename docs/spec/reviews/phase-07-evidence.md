# Phase 07 — Recording — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the phase branch at the commit the run names, after
the scope check's fixes. The in-depth review lenses are deferred to the review
after the whole specification is implemented, as `reviews/phase-07-review.md`
records.

## Phase identifier and objective

- **Phase:** 07 — Recording.
- **Objective:** advanced, resilient recording and audio input: the dry input
  captured on the audio thread and committed in chunks by the storage worker
  as it is made (`ADR-0070`, `ADR-0071`); take stacks and non-destructive
  punch recording in the edit model, where every recording is a new asset and
  a punch is an edit that reads a stack's chosen take (`ADR-0072`); a
  retrospective buffer; safe monitoring; latency calibration; and capability
  diagnostics.
- **User-visible outcome:** the person chooses an input and a capture profile
  and sees what the browser granted against what was asked; watches and hears
  the input's levels; monitors it, dry or through a live chain, after a
  feedback warning; calibrates the path's latency or gives an offset; keeps
  the seconds before they pressed Record; counts in, stops after a set length
  or starts at a set time; records successive takes into a stack, names,
  notes, auditions, chooses, rejects, duplicates, branches, removes, restores
  and consolidates them; punches in over a selected range with pre-roll,
  post-roll and crossfades and chooses another take for it; and finds every
  take after a reload, and any recording a reload or crash cut short offered
  for recovery when the project opens.

## Checklist

Every box in the packet's **In Scope** list:

- Device enumeration and selection: the media input adapter
  (`packages/capabilities/src/media-input.ts`, `input-devices.ts`,
  `microphone-permission.ts`, `device-list-watch.ts`, `opened-input.ts`), with
  the permission's state and its revocation and the device list watched for
  changes; a remembered device is found again by its identifier, then by its
  group and label together (`packages/recording/src/device-identity.ts`), and
  chosen by `recording.choose-input`
  (`apps/web/src/commands/recording-commands.ts`).
- Capture profiles: Raw/Studio by default, Voice and Custom
  (`packages/recording/src/capture-profile.ts`), the requested and the granted
  settings compared (`capture-comparison.ts`) from the settings read off the
  track (`packages/capabilities/src/capture-constraints.ts`), disclosed in the
  Audio settings (`apps/web/src/shell/settings/recording-input.tsx`,
  `capture-profile-form.tsx`, which sets each processing control the browser
  lets a page set, for a Custom profile) and in the diagnostics.
- Input meters on the dry input, by the engine's meter node
  (`packages/audio-runtime/src/capture-processor/input-meter.ts`), shown in
  the Recording panel and said in words for setting the gain by ear
  (`apps/web/src/recording/level-summary.ts`, `recording.say-levels`).
- Mono to N-channel recording at the input's granted channel count
  (`apps/web/src/recording/capture-facts.ts`: mono, stereo, or that many
  discrete channels), into a new asset of origin `recorded`
  (`packages/storage/src/recording-finishing.ts`, `recording-takes.ts`).
- Safe monitoring: a state machine apart from the session
  (`packages/recording/src/monitoring.ts`), off by default, one command
  (`recording.toggle-monitoring`, Shift+I), a feedback warning first
  (`recording.confirm-monitoring`), preferences per device and profile
  (`apps/web/src/state/recording-settings.ts`), automatic only for a profile
  marked for headphones (`recording.mark-headphones`); its state shown apart
  from the input's (`apps/web/src/shell/recording/monitoring-section.tsx`,
  `input-status.tsx`). Monitoring through a live chain runs in the capture
  worklet (`packages/audio-runtime/src/capture-processor/monitoring-path.ts`)
  through the effect rack's live form (`ChainProcessing.prepareLive`,
  `packages/effect-rack/src/chain-run.ts`), and a chain that cannot run live
  is refused with its reason.
- Pre-roll and punch-in, with post-roll and boundary crossfades: the punch
  edit (`PunchEdit`, `packages/domain/src/editing/operations.ts`), folded by
  `punch-fold.ts` through the plan's `mix` source and validated by
  `punch-validation.ts`; armed over the selection by `recording.arm-punch`
  (`apps/web/src/recording/punch-start.ts`, `take-arming.ts`), with its rolls
  set by `recording.set-punch-rolls`.
- Take stacks (`packages/domain/src/project/take-stack.ts`): successive takes,
  naming and notes, audition, promotion, rejection, duplication, branching,
  removal that keeps the take, restoring and consolidation, each a project
  command with its inverse (`packages/project-commands/src/takes/`) and an
  application command (`take.*` and `take-stack.*`,
  `apps/web/src/commands/take-commands.ts`, `take-audition-commands.ts`).
- The retrospective buffer of 5 to 60 seconds while armed, in the capture
  worklet's own memory (`packages/audio-runtime/src/capture/capture-queue.ts`,
  `capture-processor/capture-recorder.ts`), overwritten with zeros when it is
  let go; the status bar shows the device, armed, buffering and for how long,
  counting in, recording and calibrating for as long as an input is open
  (`apps/web/src/shell/recording/input-status.tsx`, from `inputStatus` in
  `apps/web/src/recording/input-view.ts`, the one derivation of that state).
  The buffer's length is shortened to what the page's reported memory allows
  (`retrospectiveFit` in `packages/recording/src/retrospective-buffer.ts`,
  `apps/web/src/recording/buffer-arming.ts`).
- Latency calibration and compensation: output, input and round-trip latency;
  the guided loopback calibration
  (`packages/recording/src/loopback-analysis.ts`, `calibration-signal.ts`;
  `apps/web/src/recording/calibration-control.ts`,
  `loopback-capture.ts`, `loopback-worker.ts`); a manual offset
  (`recording.set-manual-offset`); calibrations kept per input device, output
  device and rate, and a change of any asking for another
  (`packages/recording/src/latency-calibration.ts`); compensation applied as
  the take's `compensation` in frames (`apps/web/src/recording/take-set-up.ts`),
  never to samples.
- Bluetooth and high-latency warnings as estimates, sample-rate mismatch with
  the offer to restart the engine at the input's rate
  (`recording.restart-at-input-rate`, `apps/web/src/recording/engine-rate.ts`),
  a chosen input no longer connected, and channel-limit diagnostics, none of
  which blocks recording (`packages/recording/src/capture-diagnostics.ts`,
  `latency-diagnostics.ts`, `recording-diagnostics.ts`).
- Incremental crash-resilient capture: chunks of at most one second committed
  by the storage worker (`packages/storage/src/recording-capture.ts`,
  `recording-chunks.ts`, `recording-manifests.ts`;
  `packages/storage-runtime/src/host/recording-area.ts`,
  `running-recording.ts`, `capture-input.ts`); sessions as reachable state
  counted apart by usage (`packages/storage/src/usage-measurement.ts`);
  recovery offered when the project opens and before any cleanup
  (`recording-sessions.ts`, `project-recovery.ts`, `project-opening.ts`;
  `apps/web/src/state/interrupted-recordings.ts`,
  `apps/web/src/shell/interrupted-recordings-offer.tsx`); recovered assets
  marked as ended unexpectedly (`recording-recovery.ts`); quota watched before
  arming (`apps/web/src/recording/take-arming.ts`) and while recording
  (`packages/storage-runtime/src/host/quota-watch.ts`).
- Controlled recording: count-in or pre-roll, a timed stop and a start at a
  set time while the page stays open, armed and visible
  (`packages/recording/src/controlled-recording.ts`,
  `apps/web/src/recording/controlled-run.ts`; `recording.set-count-in`,
  `recording.set-timed-stop`, `recording.record-at`), with the page's
  visibility watched (`packages/capabilities/src/page-visibility.ts`) and the
  track's mute and end events (`apps/web/src/recording/open-input-watch.ts`).
- The recording diagnostics surface: each entry says what is affected, why,
  its impact and what would improve it, listed in the capability panel and the
  Recording panel without blocking work
  (`apps/web/src/shell/recording/recording-diagnostics-list.tsx`,
  `apps/web/src/shell/panels.tsx`,
  `apps/web/src/recording/input-diagnostics.ts`).
- The recorded-media WAV writer: 32-bit float PCM, RF64 past four gibibytes
  (`packages/codecs/src/recorded-wav.ts`).
- Recording views: the Recording panel, titled Recorder
  (`apps/web/src/shell/recording/recording-panel.tsx` and its sections), the
  status bar's input state, the Inspector's recording configuration, take and
  take stack (`recording-configuration.tsx`, `take-inspector.tsx`), the Audio
  settings' input section (`apps/web/src/shell/settings/recording-input.tsx`,
  `latency-settings.tsx`) and the Recording preset
  (`packages/workspace/src/presets.ts`); each invokes only commands.

Work units: WU-07.A to WU-07.E as the packet defines them.

## Inherited debt

| Debt | Fix |
| --- | --- |
| Monitoring through effects while recording (Phase 06 handoff) | `1149f03b`: the effect rack's live form and the capture worklet's monitoring path; `389ace5c`: choosing the chain monitored through. |
| `MediaObjectStore.recoverIncomplete` run by no production path (Phase 02) | `838c78fe`: the storage worker runs it as it starts, with the storage-wide lock held alone (`packages/storage/src/media-recovery.ts`, `packages/storage-runtime/src/host/storage-host.ts`; `ADR-0071` amended). |
| The storage estimate with no consumer (Phase 02) | `838c78fe`: the recording area reads it for the time left and the quota watch; `07192629`: it is read before an input is opened. |
| The context port, worklet and fakes without an input (Phase 03) | `1149f03b`: `MediaStreamSourcePort`, a worklet node with one input, the capture processor, and the fakes `fake-media-stream.ts`, `fake-capture-node.ts` and `capture-rig.ts` in `packages/audio-runtime/src/testing/`. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/recording` | New and portable. The session and monitoring state machines, capture profiles and their comparison with the grant, device identity, the loopback analysis, calibration and take compensation, the retrospective buffer's bounds, the storage time left, controlled recording and the diagnostics. |
| `packages/capabilities` | The media input adapter (`readMediaInput`), `InputDeviceDescriptor`, `OutputDeviceDescriptor`, the granted settings, and page visibility. |
| `packages/audio-runtime` | The input side of the context port, the capture processor and its thread entry, the capture session, the capture channel (writer, queue, wire, reader) and the capture messages; the capture fakes. |
| `packages/effect-rack`, `packages/audio-engine` | `ChainProcessing.prepareLive` and its implementation; the plan readers (`mixed-content.ts`) and the preview cache key read the `mix` source. |
| `packages/codecs` | The recorded-media WAV header and length, and the speaker mask of a layout. |
| `packages/domain` | `TakeStack`, `Take`, `PunchRange`, `PunchEdit`, the punch fold and validation, the `mix` plan source, take users. |
| `packages/project-format` | Take stacks, the punch edit, the `mix` source, recorded provenance and its stripping, `RecoveryChunkManifest`; `projectDocument` 7, `projectStorage` 11. |
| `packages/project-commands`, `packages/history` | The take, stack and punch commands with inverses and the random take walk; take-stack and recorded-provenance differences. |
| `packages/storage`, `packages/storage-runtime` | The recording area, chunks, manifests, finishing, recovery and discarding of sessions, the media store's recovery, usage, the quota watch, `RecordingClient`. |
| `packages/diagnostics` | Device labels replaced in every log record (`device-labels.ts`). |
| `packages/workspace` | The Recording preset's panel. |
| `apps/web` | The recording workspace: input, monitoring, calibration, take recording and controlled recording (`src/recording/`), their commands, the views (`src/shell/recording/`, the settings, the status bar, the Inspector, the recovery offer), the recording settings (`audioSettings` 3), and the one audio context shared with capture (`src/audio/context-host.ts`). |
| `tests/` | The architecture rules for the new package and thread scope; `tests/e2e/recording.spec.ts`, and `tests/e2e/hearing.ts`, the page tap taken out of `effect-rack.spec.ts` for both. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| RecordingSession | `RecordingSession` in `@audiogubbins/recording`: closed, asking, ready, armed, counting in, recording, stopping and failed, moved by `nextSession` over a `SessionEvent`; `inputIsOpen` reads it, and the application's `inputStatus` derives the status bar's state from it. |
| CaptureProfile | `CaptureProfile` and `CaptureProfileKind` (`raw-studio`, `voice`, `custom`) in `@audiogubbins/recording`. |
| InputDeviceDescriptor | `InputDeviceDescriptor` in `@audiogubbins/capabilities`: identifier, group, label, channel counts and rates, each `undefined` where withheld. |
| TakeStack | `TakeStack` and `Take` in `@audiogubbins/domain`, held in `Project.takeStacks`. |
| PunchRange | `PunchRange` in `@audiogubbins/domain`: length, pre-roll, post-roll, crossfade and resampler version. |
| LatencyCalibration | `LatencyCalibration` in `@audiogubbins/recording`, found by `calibrationOf`, made by `manualCalibration` and the loopback measurement. |
| RecoveryChunkManifest | `RecoveryChunkManifest` in `@audiogubbins/project-format`, with its `TakeRequest`. |
| The media input adapter | Implemented as `MediaInput`, answered by `readMediaInput`, in `@audiogubbins/capabilities`; it also reads the output the page plays through (`OutputDeviceDescriptor`, `ADR-0070` amended). |
| The capture worklet and its capture channel | The capture worklet is the `./threads/capture-processor` entry of `@audiogubbins/audio-runtime`, driven by `CaptureSession`; the channel is the `MessagePort` that `CaptureSession.record` answers, read by `CaptureReader`, offered also as the `./capture-channel` entry. |
| The effect rack's live form | `ChainProcessing.prepareLive(LiveChainRequest)` in `@audiogubbins/audio-engine`, implemented by `chainProcessing` in `@audiogubbins/effect-rack`. |
| The punch edit | `PunchEdit` (`{ kind: 'punch', stack }`), a `RangeEdit` carried by a `process` operation, in `@audiogubbins/domain`. |
| The storage worker's recording operations | `RecordingClient` (`timeLeft`, `begin`, `status`, `stop`, `interrupted`, `recover`, `discard`) and `RecordingStatus` in `@audiogubbins/storage-runtime`, over the `recording.*` operations. |
| The recorded-media WAV writer | `recordedWavHeader` and `recordedWavLength` in `@audiogubbins/codecs`. |

## ADRs created and changed

`ADR-0070`, `ADR-0071` and `ADR-0072` were written by the phase's readiness
review, merged in `9d8e9f95` before the phase began; this phase implements
them. They amend `ADR-0020`, `ADR-0022`, `ADR-0030`, `ADR-0050` and
`ADR-0051`, each of which carries an **Amended by** line. The build amended
these records, each by a dated line:

- `ADR-0070` — 2026-10-09: a chain may monitor when its listening is live, as
  the domain's one listening rule (`ADR-0061`) decides, so a processor that
  keeps state is refused only when its state is missing;
  `packages/capabilities` depends on `packages/domain`; the adapter reads the
  output the page plays through, and where the browser lists none the output
  is unknown, never guessed.
- `ADR-0071` — 2026-10-09: the media store's recovery runs when the storage
  worker starts, with the storage-wide lock held alone, and never reaches a
  session's chunks and manifest; the manifest keeps the take a recording was
  begun for.

`ADR-0072` stands as written. The dependency cruise
(`.dependency-cruiser.cjs`) and `tests/architecture/dependency-rules.test.ts`
hold the package rules these records state.

## Decisions taken beyond the ADRs

The build plan (`docs/todo/phase-07-recording.md`) settles what the ADRs left
to the implementation:

1. `TakeStackId` and `TakeId` are branded identifiers; a take's state is
   `kept`, `rejected` or `removed`, and its compensation a signed whole number
   of frames at its rate. Nothing deletes a take but undoing the command that
   made it.
2. The punch edit is a `RangeEdit` of kind `punch` carried by a `process`
   operation, on every channel, changing no time. A take too short, of
   another channel count, or whose crossfades would overlap is refused with
   the reason; a stack with no chosen take plays the target's own audio. A
   take at another rate is read converted by the canonical resampler.
3. The plan gains a fourth segment source, `mix`: the sample-wise sum, in
   order, of the same frames of two or more later streams. Each punch boundary
   is a mix of the earlier audio fading out and the take fading in, and every
   plan reader, the oracle, the preview key and the format read it.
4. A recorded asset's provenance states when, the device as recorded, the
   profile, the requested and the granted settings, the rate, the layout, the
   length, the frames lost, and how capture ended. Stripping removes the
   device's label and group below full provenance.
5. The manifest is a checked record kept as a pair of files, and chunks are
   files named by their first frame in twelve digits under
   `projects/<id>/recordings/<session>/chunks/`.
6. The capture channel is owned by `packages/audio-runtime`, which exports its
   reader as `./capture-channel` for the storage worker; `storage-runtime`
   depends on `audio-runtime` for that reader only, and `packages/storage`
   takes blocks through its own port, `CaptureStream`.
7. `prepareLive` answers a `ChainRun` for an unbounded live input with no
   measuring pass, and refuses a chain whose listening is not live.
8. Capture profiles, monitoring preferences and calibrations are fields of the
   person's audio settings; a device is remembered by its identifier, then its
   group and label.
9. The schema versions below.

## Tests

| Area | Where |
| --- | --- |
| The media input adapter and page visibility | `packages/capabilities/src/media-input.test.ts`, `page-visibility.test.ts` |
| The session, monitoring, profiles and device identity | `packages/recording/src/session-transition.test.ts`, `monitoring.test.ts`, `capture-comparison.test.ts`, `device-identity.test.ts` |
| Calibration, diagnostics, buffer, storage time, schedule | `packages/recording/src/loopback-analysis.test.ts`, `latency-calibration.test.ts`, `recording-diagnostics.test.ts`, `retrospective-buffer.test.ts`, `storage-time.test.ts`, `controlled-recording.test.ts` |
| The capture processor, session and channel | `packages/audio-runtime/src/capture-processor/capture-processor-core.test.ts`, `capture-session/capture-session.test.ts`, `capture/capture-channel.test.ts`, `protocol/capture-messages.test.ts` |
| The live chain | `packages/effect-rack/src/live-run.test.ts` |
| The WAV writer | `packages/codecs/src/recorded-wav.test.ts` |
| Take stacks and the punch in the plan | `packages/domain/src/project/take-stack.test.ts`, `editing/punch-edit-property.test.ts`, `punch-validation.test.ts`, `mix-source.test.ts`, `edit-property.test.ts` |
| Persisted form, provenance and manifest | `packages/project-format/src/take-stack-json.test.ts`, `edit-json.test.ts`, `project-json.test.ts` |
| Project commands and history | `packages/project-commands/src/takes/take-commands.test.ts`, `project-commands.test.ts` (the random command walk, with `testing/random-takes.ts`), `packages/history/src/take-stack-differences.test.ts` |
| Recording in storage | `packages/storage/src/recording.test.ts`, `recording.recording-recovery.test.ts`, `recording-quota.recording-recovery.test.ts`; `packages/storage-runtime/src/client/recording-client.recording-recovery.test.ts`, `host/quota-watch.test.ts`, `host/media-store.recovery.test.ts` |
| Device labels out of logs | `packages/diagnostics/src/device-labels.test.ts` |
| The preset | `packages/workspace/src/presets.test.ts` |
| Application control | `apps/web/src/recording/*.test.ts`, `apps/web/src/audio/context-host.test.ts`, `playback-control.test.ts` |
| Application commands | `apps/web/src/commands/recording-commands.test.ts`, `take-commands.test.ts`, `take-recording-commands.test.ts` |
| Application state and views | `apps/web/src/state/recording-settings.test.ts`, `interrupted-recordings.test.ts`, `apps/web/src/shell/recording/recording-views.test.tsx`, `take-inspector.test.tsx`, `apps/web/src/shell/settings/recording-input.test.tsx`, `apps/web/src/shell/interrupted-recordings-offer.test.tsx`, `apps/web/src/shell/panels.test.tsx`, `apps/web/src/shell/history/difference-words.test.ts` |
| Layering, exports and scopes | `tests/architecture/*.test.ts` |
| The built application in a browser | `tests/e2e/recording.spec.ts` |

## Commands used for verification

```
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:recovery               # vitest run --project media-store --project storage recovery
pnpm run test:storage-quota          # vitest run --project storage quota
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:editing-property       # vitest run --project domain --project project-commands edit-property project-commands.test
pnpm run test:audio-latency          # vitest run latency
pnpm run test:architecture           # pnpm run test:dependencies, then vitest run --project architecture
pnpm run test:recording-recovery     # vitest run --project storage --project storage-runtime recording-recovery media-store.recovery
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run test:e2e:recording          # playwright test --project=chromium-recording
pnpm run test:e2e:effect-rack        # playwright test --project=chromium-effect-rack
pnpm run test:e2e:smoke              # playwright test --project=chromium-smoke
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet's package filter,
`pnpm --filter @audiogubbins/recording --filter @audiogubbins/capabilities --filter @audiogubbins/audio-runtime --filter @audiogubbins/codecs test`,
is not a script of the manifest, so it stands outside the list.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit`, at `07192629` | Passed, exit 0: lint, both type checks, 693 test files and 10,993 tests, the record check (1,987 cited titles), and no dependency violations (2,337 modules, 13,798 dependencies). |
| The packet's package filter | Exit 0. The combined run reported capabilities 10 files, 164 tests and audio-runtime 32 files, 462 tests; run per package: recording 10 files, 283 tests; capabilities 10, 164; audio-runtime 32, 462; codecs 3 files, 260 tests; all passed. |
| `pnpm run test:recovery` | 10 files, 35 tests passed. |
| `pnpm run test:storage-quota` | 4 files, 23 tests passed. |
| `pnpm run test:project-roundtrip` | 7 files, 277 tests passed. |
| `pnpm run test:editing-property` | 4 files, 16 tests passed. |
| `pnpm run test:audio-latency` | 4 files, 34 tests passed. |
| `pnpm run test:architecture` | No dependency violations (2,337 modules, 13,798 dependencies); 10 files, 313 tests passed. |
| `pnpm run test:recording-recovery` | 4 files, 20 tests passed. |
| `pnpm run build` | Exit 0; the build check found the output free of local paths and analytics hosts, 35 files. |
| `pnpm run spec:verify` | PASS, all four checks. |
| `pnpm run test`, at `b6c07659` | 693 test files and 10,993 tests passed, exit 0. |
| `pnpm run verify:commit`, on the tree the closing commit holds (F-13 fixed) | Passed, exit 0: lint, both type checks, 695 test files and 11,007 tests, the record check (2,024 cited titles), and no dependency violations (2,340 modules, 13,818 dependencies). `pnpm run spec:verify` passed its four checks. |

`b6c07659`, after the gate run, changes only the Recording panel's title
(`apps/web/src/panel-descriptors.ts`) and the two places that name it
(`apps/web/src/testing/shell-context.ts`, `tests/e2e/recording.spec.ts`); the
unit suite was run again over it for the record check.

## Browser and device results

Each browser test ran through Playwright 1.63.0 against a production build the
preview server serves.

- `pnpm run test:e2e:recording`, at `b6c07659`: 2 passed (39.3 s), in
  Chromium with its fake input device and the microphone permission granted.
  The first test records a take into a new stack, arms a punch over a range of
  it and punches in two takes, chooses the other take and undoes the choice,
  captures what the page plays with an AudioWorklet tap, reloads, and requires
  the same samples. The second reloads while a take is recorded and recovers
  what was committed from the offer the opening makes.
- `pnpm run test:e2e:effect-rack`, at `07192629`: 1 passed (30.0 s), after its
  page tap moved into `tests/e2e/hearing.ts`.
- `pnpm run test:e2e:smoke`: the first run, at `07192629`, failed 1: the
  Workspace menu listed a panel titled Recording beside the Recording preset,
  which `b6c07659` fixes by titling the panel Recorder (F-10 in the review
  record). The second failed 1, the splitter test under Known limitations
  (expected more than 221, received 120), which passed 3 of 3 alone. The third
  run of the whole project passed 110, with 1 skipped (the existing iPadOS
  skip), exit 0.
- No recording test runs in Firefox or WebKit (Known limitations).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Interrupted recording recovery reconstructs valid audio up to the last committed chunk. | `recording.recording-recovery.test.ts`: a crash at every step of a session keeps every chunk committed before it, recovered bit for bit, with a write torn short or full-length; a torn last chunk is read to its last whole frame; a chunk storage lost is read as counted silence; `recording-quota.recording-recovery.test.ts` at every write; `recording-client.recording-recovery.test.ts`; the second browser test. `pnpm run test:recording-recovery`. |
| Punch-in never destroys the previous take. | `punch-edit-property.test.ts` (random chains of punches render to the bits of each edit applied in turn; the earlier audio plays again when the stack chooses none); `take-stack.test.ts` and `take-commands.test.ts` (a recording a take names stays in the project); `recording.test.ts` (a punch's take is a new asset, its punch added where it was set up). |
| Retrospective capture recovers the configured pre-record interval while armed. | `capture-processor-core.test.ts` (the buffer becomes exactly the configured seconds before Record, ahead of the live frames; nothing is kept unarmed; it is zeroed when disarmed, rearmed or let go; 5 to 60 seconds); `retrospective-buffer.test.ts`; `session-transition.test.ts`; `take-set-up.test.ts` (a take that begins with buffered frames is placed by them). |
| Browser AGC/echo/noise processing is disabled in Raw/Studio where the platform permits and any inability is disclosed. | `capture-comparison.test.ts` (Raw/Studio asks every processing control off; only what the browser supports is asked, and what it cannot control is named; each difference and each control not set is an entry); `media-input.test.ts` (granted settings read from the track, not from the request); `recording-diagnostics.test.ts`; `recording-views.test.tsx`; `recording-input.test.tsx`. |
| Input monitoring starts disabled by default and warnings/preferences work as specified. | `monitoring.test.ts`, `capture-processor-core.test.ts` (silent until turned on, whatever arming and recording do), `monitoring-control.test.ts`, `input-control.test.ts` (arming never turns monitoring on), `recording-commands.test.ts`, `recording-settings.test.ts` (a preference found again by group and label), `recording-views.test.tsx`. |
| The recorded asset's samples are the dry input's, bit for bit, whatever monitoring, effects or compensation was on. | `capture-processor-core.test.ts` (the take is the dry input, bit for bit, while monitoring plays it through a chain); `recording.test.ts` (the asset's file is the dry input, bit for bit, under the identity it was hashed as); `recorded-wav.test.ts` (each layout read back bit for bit). |
| Choosing another take in a punch stack changes what the punch plays, one undo restores the choice, and no take's media is lost while any state names it. | `punch-edit-property.test.ts` (another take plays as soon as the stack chooses it); `apps/web/src/commands/take-commands.test.ts` (another take chosen, one undo gives it back); `take-stack.test.ts` (a recording stays in use while any take names it, removed takes among them); the first browser test. |
| Latency compensation is applied as a take's placement, and the take's samples are unchanged. | `latency-calibration.test.ts` (the take's compensation), `take-set-up.test.ts` (placement by latency, buffered frames and missing pre-roll), `punch-validation.test.ts` and `punch-edit-property.test.ts` (the take read shifted by its compensation), `take-commands.test.ts` in project-commands (a compensation the punch cannot play is refused); `recording.test.ts` for the samples. |
| No input is open, and no audio is buffered, unless an input is armed or recording, and the status bar says which. | `session-transition.test.ts` (an input opens only once armed, in every state events reach; the indicator), `input-control.test.ts` (nothing asked of the browser at start; inputs listed and none opened), `recording-input.test.tsx` and `recording-views.test.tsx` (the panel and settings open none; the status bar shows nothing while none is armed, and the device, armed, buffering, monitoring and recording as distinct states), `capture-processor-core.test.ts` (nothing kept while unarmed). |
| A browser test records with a fake input, punches in over a range, chooses another take, reloads, and hears the same project; another reloads mid-recording and recovers the committed chunks. | `tests/e2e/recording.spec.ts`, above. |

## Known limitations

- Comping, choosing parts of several takes over one range, is deferred by
  `REQ-REC-089` to the multitrack and clip architecture; a stack chooses one
  take for its range (packet, Out of Scope).
- Output device selection is Phase 14's. The output the page plays through is
  named only where the browser lists a default output that names a device
  (`packages/capabilities/src/output-devices.ts`). Firefox and Safari usually
  list none, so there the output is unknown: monitoring asks for a
  confirmation before it starts unless the profile is marked for headphones, a
  calibration is kept for the unknown output, and the diagnostics say a change
  of output cannot then be noticed.
- Nothing measures a live chain's cost, so a too-costly monitoring chain is not
  moved to a render; that is Phase 14's.
- The recording browser test runs in Chromium only, with a fake input device.
  Firefox and WebKit are not run for recording.
- The WAV writer refuses a layout no WAV speaker mask states as it is held:
  labelled and ambisonic layouts, one or two discrete channels, and speakers
  out of mask order, among them the domain's `surround7_1` and `surround7_1_4`,
  which hold the side pair before the rear pair. A recording in such a layout
  is refused when it starts (`packages/storage/src/recording-capture.ts`). A
  capture is recorded as mono, stereo or three or more discrete channels
  (`apps/web/src/recording/capture-facts.ts`), each of which the writer takes.
- When the capture worklet's queue fills because its reader has fallen
  behind, it keeps no input until the queue has drained, and reports the
  frames lost as one gap of their exact length, which storage writes as
  silence and counts in the asset's provenance (`RecordedGaps`).
- The latency calibration's capture is the one page-side reader of captured
  samples (`apps/web/src/recording/calibration-control.ts`,
  `loopback-capture.ts`): it holds a bounded measurement of a second or so,
  makes no take, and the status bar says the input is calibrating.
- A punch reads its take's unedited recording, so an edit made to a take's own
  asset is not heard in the punch (`packages/domain/src/editing/punch-fold.ts`).
- A punch whose target asset was edited after the punch was set up is refused
  when its recording finishes or is recovered, with `recording.punch-moved`,
  and its session is kept to be recovered (`recording-takes.ts`).
- A recovered take's ending is `interrupted`, unless its manifest records an
  unexpected ending of its own, such as storage full or a lost device
  (`recording-sessions.ts`).
- A device's label is replaced in a log record's fields named for it
  (`packages/diagnostics/src/device-labels.ts`); a label written into a
  message's text would not be found there, and the recording code writes none.
- Fourteen exports of `@audiogubbins/recording` have no consumer outside the
  package and its tests, listed in `tests/architecture/package-exports.test.ts`
  under a reason written before the application's workspace was built.
- Tests that fail now and then under load and pass when run again:
  `packages/storage-runtime` `backups-client.test.ts`'s "stops the worker's
  restore in place before it replaces the project" failed once under the
  whole suite and passed alone; `apps/web` `project-transfer-commands.test.ts`
  timed out at 5 s once under load and passed alone, 23 of 23; the smoke test
  "lets a splitter drag make a panel taller, so the limit above is a limit",
  a sibling of the splitter test Phase 06 recorded, failed once and passed 3
  of 3 alone. The recording crash sweep, which had no time limit and timed out
  once under the suite, now has the 120 s its sibling sweeps have
  (`07192629`).
- The review lenses the packet names are deferred to the review after the
  whole specification is implemented (`reviews/phase-07-review.md`).

## Dependencies added, and their review

None from outside the repository. `packages/recording` is a new workspace
package depending on `@audiogubbins/domain` and `@audiogubbins/text`;
`packages/storage-runtime` gains `@audiogubbins/recording` and
`@audiogubbins/audio-runtime`, the latter for the capture channel's reader
only.

## Migration and schema impact

`version.json` raises `projectDocument` to version 7 (take stacks, the punch
edit, the `mix` source, recorded provenance), `projectStorage` to version 11
(recording sessions, the manifest, take stacks in history records) and
`audioSettings` to version 3 (capture profiles, monitoring preferences and
calibrations). Before 1.0 nothing migrates (`REQ-STOR-052`): a document,
record or manifest of another version is refused with the reason.

## Screenshots and recordings

None kept in the tree. The browser tests and the runs recorded above are the
evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-REC-020` Recording | Input choice, meters and levels in words, mono to N channels, monitoring dry or through a live chain, pre-roll, punch-in, count-in, timed stop and set start, recording into a new asset, recovery of interrupted recordings; the dry input is the recording and monitoring never touches it. | `media-input.test.ts`, `capture-processor-core.test.ts`, `capture-session.test.ts`, `live-run.test.ts`, `level-summary.test.ts`, `controlled-recording.test.ts`, `controlled-run.test.ts`, `take-recording-commands.test.ts`, `recording.test.ts`, `recording.spec.ts`. |
| `REQ-REC-089` Recording Take Management | Successive takes into the armed stack; naming and notes; audition without changing the project; choosing, rejecting, removing and restoring; duplicating and branching; consolidation; each with its inverse, in undo and recovery. Comping deferred. | `take-commands.test.ts` (project-commands and application), `take-stack.test.ts`, `take-stack-json.test.ts`, `take-stack-differences.test.ts`, `take-recording-commands.test.ts`, `take-inspector.test.tsx`, `recording.spec.ts`. |
| `REQ-REC-090` Retrospective Recording | A 5 to 60 second buffer in the capture worklet while armed, never written until Record, zeroed when let go; armed, buffering with its seconds, device and recording shown and announced in the status bar. | `capture-processor-core.test.ts`, `retrospective-buffer.test.ts`, `session-transition.test.ts`, `input-control.test.ts`, `recording-views.test.tsx`. |
| `REQ-REC-091` Input Monitoring Safety | Off by default and never turned on by arming; one command; its state shown apart; a feedback warning, also where the output is unknown; preferences per device and profile; automatic only for a headphones profile. | `monitoring.test.ts`, `monitoring-control.test.ts`, `capture-processor-core.test.ts`, `recording-commands.test.ts`, `recording-settings.test.ts`, `recording-views.test.tsx`. |
| `REQ-REC-092` Capture Processing Profiles | Raw/Studio by default, Voice and Custom; only supported constraints asked; the grant read from the track and compared; disclosed in the settings and the diagnostics. | `capture-comparison.test.ts`, `media-input.test.ts`, `input-control.test.ts`, `recording-input.test.tsx`, `recording-diagnostics.test.ts`. |
| `REQ-REC-093` Non-Destructive Punch Recording | A punch records a new asset, through the pre-roll and post-roll, and a punch edit reads the stack's chosen take with a crossfade at each boundary; undo, the stack and recovery keep the earlier audio; consolidation marks takes removed and deletes nothing. | `punch-edit-property.test.ts`, `punch-validation.test.ts`, `mix-source.test.ts`, `take-commands.test.ts` (both), `recording.test.ts`, `controlled-recording.test.ts`, `recording.spec.ts`. |
| `REQ-REC-094` Device Latency, Bluetooth, and Recording Diagnostics | Output, input and round-trip latency; a high round trip and a Bluetooth name warned of as estimates; a rate mismatch with the offer to restart at the input's rate; a chosen input no longer connected; channel limits; browser processing; none blocks recording but a genuine failure. | `recording-diagnostics.test.ts`, `capture-comparison.test.ts`, `recording-commands.test.ts`, `context-host.test.ts`, `recording-views.test.tsx`, `panels.test.tsx`. |
| `REQ-REC-095` Recording Latency Calibration | Guided loopback by correlation with a maximum-length sequence, a manual offset, values per input, output and rate, a prompt when any changes, input and output shares, compensation shown and applied as placement. | `loopback-analysis.test.ts`, `latency-calibration.test.ts`, `calibration-control.test.ts`, `take-set-up.test.ts`, `recording-commands.test.ts`, `recording-views.test.tsx`. |
| `REQ-REC-096` Recording Resilience | Chunks of at most one second committed by the storage worker; sessions as reachable state; recovery offered when the project opens, before cleanup; recovered takes named and placed as begun and said to have ended unexpectedly; quota read before arming and watched while recording; a refused write stops and keeps every chunk. | `recording.recording-recovery.test.ts`, `recording-quota.recording-recovery.test.ts`, `recording-client.recording-recovery.test.ts`, `quota-watch.test.ts`, `storage-time.test.ts`, `interrupted-recordings.test.ts`, `interrupted-recordings-offer.test.tsx`, `take-recording-commands.test.ts`, `recording.spec.ts`. |
| `REQ-REC-097` Recording Capability Transparency | Each diagnostic says what is affected, why, its impact and what would improve it; entries that rest on the browser alone, such as an insecure page or a refused permission, are shown at once; a platform that may suspend capture is cautioned of before a controlled recording and watched during one. | `recording-diagnostics.test.ts`, `panels.test.tsx`, `recording-views.test.tsx`, `controlled-recording.test.ts`, `input-control.test.ts`, `take-recording-commands.test.ts`. |

The requirements this phase consumes are met as the packet names them:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-ARCH-004` | A recorded asset's source never changes; takes and punches change only by project commands. | `punch-edit-property.test.ts`, `take-commands.test.ts`. |
| `REQ-ARCH-085` | A recording keeps the context's rate; an input at another rate is disclosed as resampled, with the restart offer. | `capture-comparison.test.ts`, `recording-diagnostics.test.ts`, `recording-commands.test.ts`. |
| `REQ-ARCH-087` | No length limit but storage, whose time left is read and stated. | `storage-time.test.ts`, `quota-watch.test.ts`, `recorded-wav.test.ts` (RF64). |
| `REQ-ARCH-144` | Monitoring latency, a live chain's included, is reported. | `monitoring.test.ts`, `monitoring-control.test.ts`, `capture-session.test.ts`, `live-run.test.ts`. |
| `REQ-ARCH-153` | The session and monitoring are two explicit state machines. | `session-transition.test.ts`, `monitoring.test.ts`. |
| `REQ-ARCH-157` | The input's granted channel count, fed channel by channel. | `capture-session.test.ts`, `capture-comparison.test.ts`, `recorded-wav.test.ts`. |
| `REQ-AUDIO-156` | Capture joins the playback context, so recording, pre-roll and punch share its clock and a take's first frame is a known context frame. | `context-host.test.ts`, `capture-processor-core.test.ts`, `controlled-run.test.ts`. |
| `REQ-AUDIO-220` | A recorded asset and a torn chunk are read to their last whole frame. | `recording.recording-recovery.test.ts`, `recorded-wav.test.ts`. |
| `REQ-EDIT-012` | A punch over the selected range (`recording.arm-punch`). | `apps/web/src/commands/take-commands.test.ts`, `recording.spec.ts`. |
| `REQ-EDIT-072` | The Inspector shows the recording configuration, a take and a take stack. | `recording-views.test.tsx`, `take-inspector.test.tsx`. |
| `REQ-STOR-021` | Take and punch changes undo; a recording and its take are one undoable change; interrupted recordings are recovered. | `take-commands.test.ts`, `recording.test.ts`, `interrupted-recordings.test.ts`. |
| `REQ-STOR-052` | The raised versions are refused, never migrated; the manifest refuses another version. | `take-stack-json.test.ts`. |
| `REQ-STOR-098` | Only the write-lease holder arms or records, read when recording starts and when an armed input reopens; the worker refuses a window without write access. | `session-transition.test.ts`, `input-control.test.ts`, `take-recording-commands.test.ts`, `apps/web/src/commands/take-commands.test.ts`, `recording.test.ts`. |
| `REQ-STOR-099` | A recording enters the content-addressed store under the identity it was hashed as; sessions are reachable state. | `recording.test.ts`, `recording.recording-recovery.test.ts`. |
| `REQ-STOR-102` | A take's recording stays while any take names it; an asset a take names cannot be removed. | `take-stack.test.ts`, `take-commands.test.ts`. |
| `REQ-STOR-106` | No cleanup, cache relief or purge removes a session in progress or interrupted. | `recording.recording-recovery.test.ts`. |
| `REQ-STOR-166` | Provenance states the device, profile, settings, time, rate, layout, frames lost and ending. | `recording.test.ts`, `take-stack-json.test.ts`. |
| `REQ-STOR-195` | Take stacks and recorded provenance are compared between states. | `take-stack-differences.test.ts`, `difference-words.test.ts`. |
| `REQ-PRIV-161`, `REQ-PRIV-165` | No device label in a log or the diagnostic report; provenance stripping removes label and group. | `device-labels.test.ts`, `take-recording-commands.test.ts`, `take-stack-json.test.ts`. |
| `REQ-UX-005` | The status bar's states announced as distinct; levels in words; every recording control a command, with Shift+I, A, P, R and S bound. | `recording-views.test.tsx`, `level-summary.test.ts`, `recording-commands.test.ts`. |
| `REQ-UX-058` | The Recording preset gains the Recording panel. | `presets.test.ts`. |
| `REQ-PWA-028`, `REQ-PWA-077` | Recording is gated on the `RECORDING` feature; a degraded capability is disclosed in the recording diagnostics and the capability panel. | `presets.test.ts`, `panels.test.tsx`, `recording-diagnostics.test.ts`. |
| `REQ-PROD-009` | A recording is committed in chunks and read through them, never held whole. | `recording.test.ts`, `recording.recording-recovery.test.ts`, `recorded-wav.test.ts`. |

## Commits

Oldest first, on `phase-07-recording`, from `9d8e9f95`:

- `60a344d0` Plan the Phase 07 build
- `0551a6cf` Write recorded media as 32-bit float WAV
- `65312676` Reach the microphone through one adapter
- `1d0b7885` Add the portable recording package
- `e2b0a95f` Add take stacks and the punch edit
- `1149f03b` Capture the dry input on the audio thread
- `64e3ba59` Hold the new recording modules to the architecture
- `1657e8f6` Record how monitoring chooses a chain
- `838c78fe` Commit a recording in chunks as it is made
- `389ace5c` Open an input only when the person arms it
- `e6b1c065` Know which output the page plays through
- `0f0d9b21` Record into a project, with takes, punches and recovery
- `910f1a66` Bring the Phase 07 resume note up to date
- `4f97a530` Keep a recovered take's name and placement
- `07192629` Close the gaps the Phase 07 scope check found
- `b6c07659` Title the recording panel Recorder

The commit that records this package, the review record and the handoff
follows, and the integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-07-review.md` records the owner's decision that defers every
lens to the review after the whole specification is implemented, and the scope
check a separate read-only agent ran in their place against the packet. Its
nine findings, one `HIGH`, seven `MEDIUM` and one `LOW`, and the two the gate
run found, one `MEDIUM` and one `LOW`, are fixed in `4f97a530`, `07192629` and
`b6c07659`.
