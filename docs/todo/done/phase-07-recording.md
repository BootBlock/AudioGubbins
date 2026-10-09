> **Status:** Done. 2026-10-10: every slice is built, the scope check's and
> the gate run's findings are fixed and written into
> `docs/spec/reviews/phase-07-review.md`, with the review lenses deferred by
> the owner's decision of 2026-10-07. Phase 07 is closed at `PASS` in the
> ledger, with its evidence and its handoff.

# Phase 07 — Recording

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-07-recording.md`, and the decisions that
shape the work are `ADR-0070`, `ADR-0071` and `ADR-0072`.

## Where the work is

|        |                           |
| ------ | ------------------------- |
| Branch | `phase-07-recording`      |
| Base   | `main` at `9d8e9f9`       |
| Head   | see `git log`, not pushed |

## Gates

Light gates (owner decision, 2026-10-07): `pnpm run verify:commit` for every
change, `pnpm run spec:verify` after an edit under `docs/spec/`, and the
packet's commands at the phase's end. The review lenses the packet names are
deferred to the review after the whole specification is built. The author of a
new test sees it fail once against the code it guards.

## Slices

Each slice owns its files. The shared lists (`version.json`,
`tests/architecture/*`, `.dependency-cruiser.cjs`, `eslint.config.js`,
`tools/sync-workspace-graph.mjs`) are edited line by line by whichever slice
needs a line, and `tests/architecture/public-contracts.txt` is regenerated
once the slices of a stage are in.

| Slice | Packages                                                                        | Needs    |
| ----- | ------------------------------------------------------------------------------- | -------- |
| A     | domain, project-format, project-commands, history, audio-engine plan readers    | —        |
| B1    | capabilities (media input adapter), codecs (recorded-media WAV writer)          | —        |
| B2    | recording (new)                                                                 | —        |
| C     | audio-runtime (input side, capture worklet, capture channel), effect-rack live  | —        |
| D     | storage, storage-runtime (recording area, recovery, quota watch)                | A, B1, C |
| E     | apps/web, workspace (composition, views, commands, settings), the browser suite | all      |

## Decisions taken in the build

These settle what the ADRs leave to the implementation.

1. **Take stacks (`ADR-0072`).** `TakeStackId` and `TakeId` are branded
   identifiers. `Project.takeStacks` maps a `TakeStackId` to a `TakeStack`:
   `id`, `name`, `takes` in the order they were made, `chosen` (a `TakeId` or
   none), and `punch` (a `PunchRange`) for a punch stack. A `Take` is `id`,
   `asset` (an `AssetId` of origin `recorded`), `name`, `note`, `state`
   (`kept`, `rejected` or `removed`) and `compensation`, a signed whole number
   of frames at the take's rate. Removing a take marks it `removed`; nothing
   deletes a take but the command that made it, undone. An asset a take names
   cannot be removed, and a stack a punch edit names cannot be removed.
2. **The punch edit.** A `RangeEdit` of kind `punch` naming a stack, carried by
   a `process` operation as a rack edit is, so it changes no time and carries
   every position unchanged. It is an asset operation only, on every channel.
   The stack's `PunchRange` holds the range's `length`, the `preRoll` and
   `postRoll` in the take's frames, the boundary `crossfade` (a length and a
   `FadeShape`, default 10 ms and equal power) and the canonical resampler's
   `resampler` version, used only for a take at another rate than the target.
   The operation's range is the placement and its length must equal the
   `PunchRange`'s. The chosen take is read from `preRoll + compensation` for
   the range's length, converted to the target's rate where it differs. A take
   that is too short, of another channel count, or whose crossfades would
   overlap is refused for the punch with the reason; a punch stack with no
   chosen take plays the target's own audio.
3. **The crossfade in the plan.** A segment may read a fourth source, `mix`:
   the sample-wise sum, in the order stated, of the same frame range of two or
   more later streams of the reading stream's rate and layout. The punch fold
   gives each boundary a mix of the earlier audio, faded out, and the take,
   faded in (or the reverse at the end), and reads the take alone between
   them. Every plan reader, the oracle, the preview cache key, the slicing,
   the stream renumbering and the project format read the fourth source.
4. **Recorded provenance (`ADR-0071`).** A recorded asset's source carries a
   `recording` provenance: when it was recorded, the device as recorded (its
   label, group and channel count, where the browser gave them), the profile
   (its kind and name), the requested and the granted capture settings, the
   rate, the layout, the length in frames, whether capture ended
   unexpectedly, and why it ended. Provenance stripping removes the device's
   label and group at every level below full, as it removes a file name.
5. **The recovery manifest.** `RecoveryChunkManifest` in `project-format`:
   format, schema version, session id, project id, sample format `f32le`,
   rate, layout, the recorded provenance as at the start, the transport frame
   of the first frame, the purpose (a new take in a stack, a new stack, or a
   punch over a range of an asset) and the take it is begun for (its name,
   the new stack's name and its compensation), so a finished and a recovered
   take are named and placed alike. It is a checked record of project
   storage, kept as a pair of files so a torn rewrite loses neither. Chunks
   are files named by their first frame (twelve digits) under
   `projects/<id>/recordings/<session>/chunks/`.
6. **The capture channel (`ADR-0070`).** Owned by `packages/audio-runtime`
   (`src/capture/`): a `MessagePort` the capture worklet writes and the storage
   worker reads, carrying either posted blocks of frames, transferred, or,
   where shared memory is offered, the wake-ups of a sample ring the worklet
   writes, then the end with its reason. The runtime exports the reader the
   storage worker uses, as the `./capture-channel` entry, which compiles in a
   worker's scope; `storage-runtime` may depend on `audio-runtime` for that
   reader only. The reader reports lost frames as a gap with its frame count.
   The storage package takes its blocks through its own port,
   `CaptureStream`, and knows no channel.
7. **The live chain (`ADR-0070`).** `ChainProcessing.prepareLive(request)`
   answers a `ChainRun` for an unbounded live input with no measuring pass,
   and refuses a chain whose listening is not `live`, with the reason. The
   domain's listening rule (`ADR-0061`) is the one authority: a processor
   that keeps state, such as noise reduction, is live and may monitor, and
   is refused only when its state is missing. `ADR-0070`'s list of refused
   processors is read through its own controlling clause, "only a chain whose
   listening is live", and its amendment line records this.
8. **Settings.** Capture profiles, monitoring preferences per device and
   profile, and calibrations per input device, output device and rate are
   fields of the person's audio settings, raising `audioSettings`. A device is
   remembered by its identifier, then its group and label.
9. **Schema versions.** `projectDocument` 6 → 7 (take stacks, the punch edit,
   the `mix` source, recorded provenance); `projectStorage` 10 → 11 (recording
   sessions, the manifest, take stacks in history records); `audioSettings`
   2 → 3.

## Left to do

Every slice (A, B1, B2, C, D, E1, F, E2) is built and committed, ending at
`0f0d9b21`, where `pnpm run verify:commit` passes (10,952 tests) and the
`chromium-recording` browser project passes. Slice F identified the playing
output (`ADR-0070` amended). In order:

1. Land the scope audit's fixes (a separate agent): the sample-rate
   restart offer, device labels kept out of logs and bundles, the quota read
   before arming, the secure-context entry without a context, a device-change
   diagnostic, two view tests, the real lease flag and one wording fix.
2. Run the packet's commands: the four-package filter test,
   `test:recovery`, `test:storage-quota`, `test:project-roundtrip`,
   `test:editing-property`, `test:audio-latency`, `test:architecture`,
   `test:recording-recovery`, and `pnpm run build` then
   `test:e2e:recording`; also `test:e2e:effect-rack` and the smoke project.
3. Check every In Scope box and acceptance criterion against the code,
   and file what is missing.
4. Write `docs/spec/reviews/phase-07-evidence.md` and a review record that
   defers every lens to the post-specification review, the ledger entry
   (`PASS`, evidence, commits), `traceability/handoffs/phase-07.md`, the
   README's readiness line and the ledger's markdown; run `spec:verify`.
5. Move this note to `docs/todo/done/`, merge `main` in, run
   `verify:commit`, merge into `main` with `--no-ff` and push.
