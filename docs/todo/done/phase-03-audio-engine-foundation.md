> **Status:** Done. 2026-09-29: the one review pass of the seven lenses found
> thirty-eight findings, every one fixed or accepted with tracking and written
> into the review record, and Phase 03 is closed at `PASS`: the ledger gives it
> `PASS` and Phase 04 `READY`, and its handoff capsule is
> `docs/spec/traceability/handoffs/phase-03.md`. The fixes changed the golden
> tone, conversion and render and the test signal's fingerprint, now
> `0xe576a76257ddb259`; the values below are those of the time they were
> written.

# Phase 03 — Audio Engine Foundation

Resume note. It says where the work is and what is left. The packet is
`docs/spec/phases/phase-03-audio-engine-foundation.md`, and the decisions that
shape the work are `ADR-0030` to `ADR-0033`.

## Where the work is

|        |                                                             |
| ------ | ----------------------------------------------------------- |
| Branch | `phase-03-audio-engine`                                     |
| Shared | Phase 02 takes `ADR-0020` to `ADR-0029`, Phase 03 from 0030 |

## Checking the state

```bash
pnpm run verify:commit
cargo test --workspace
pnpm test --filter audio-engine
pnpm test:audio-golden
pnpm test:audio-latency
pnpm test:worker-responsiveness
```

## Slices

1. Decisions: `ADR-0030` topology, `ADR-0031` WASM boundary, `ADR-0032`
   canonical arithmetic, `ADR-0033` channel layouts.
2. Channel layouts in `packages/domain` (WU-03.A).
3. Rust crates `dsp-core`, `resampling` and `wasm-bindings`, and the build of
   the WASM module (WU-03.C).
4. `packages/audio-graph`: descriptors, validation, latency and plans
   (WU-03.B, WU-03.D).
5. `packages/audio-engine`: blocks and streams, the DSP port, execution,
   smoothing, transport and clock, offline render, profiles and scheduling
   (WU-03.A to WU-03.E).
6. `packages/capabilities`: the audio runtime's capabilities and features.
7. `packages/audio-runtime`: the context, the worklet, the render worker and
   the source feed.
8. The application: the Audio engine panel, its commands, the security policy
   and the build.
9. Verification scripts, the evidence package, one review pass, its fixes, the
   ledger and the handoff.

## Progress

Committed on the branch: `054bae2` decisions, `3a4939b` channel layouts,
`13e5159` Rust crates, `832b055` capabilities, `0f1aff0`
`packages/audio-graph`, `c104416` `packages/audio-engine`, `4644b18`
`packages/audio-runtime` and tooling, `a9ea715` the application (Transport
panel, commands, composition, Vite wiring, `'wasm-unsafe-eval'`). At
`a9ea715` `pnpm run verify:commit` passes: 3085 tests, lint, both type-checks,
the record check and the dependency cruise.

Verified in a real Chromium on the built app, before the review: Play reaches
Playing on the WebAssembly module with no fallback reason, the position
advances, both meters read −12.0 dB, Pause holds and Play resumes, Stop returns
to 0:00.000, and the offline render of 480,000 frames gives the fingerprint
`0x0ed5ce5b65bfb45d` on both DSP paths. With `WebAssembly` removed, the
reference path plays and says why. The console shows no policy or worklet
error.

What followed: one review pass with the packet's seven lenses over
`2d9f195..e980832`, its fixes (`89c3e1a` to `375a2c5`), the evidence package
and the review record under `docs/spec/reviews/`, the handoff capsule, and the
ledger at `PASS`. The built application was driven again in Chromium on both
DSP paths before it landed.

Lessons: run `cargo fmt -p <crate>`, never `--all` (it rewrote the version
crate). Check a realm-sensitive `instanceof` in anything the jsdom projects read. The engine is compiled with `lib: ES2023` only, so it names no
`AbortSignal` (use `CancellationSignal`) and reaches `WebAssembly` through
`Reflect` in test support.

## Design of `packages/audio-engine`

No DOM, depends on `domain` and `audio-graph`. One folder per responsibility;
nothing called a manager. Every numeric path follows ADR-0032.

- `pcm/`: `AudioFrameBlock` (layout, rate, frame count, planar `Float32Array`
  views; a view, never a copy), a block pool sized once per plan, and the
  stream contract `PcmSource` (`layout`, `sampleRate`, `length: SampleCount |
undefined` for unbounded, `read(start, into, signal): Promise<number>`,
  chunked and abortable), with an in-memory source over planar arrays that
  reads by view.
- `dsp/`: the `CanonicalDsp` port (`sineOfTurns`, `createOscillator`,
  `createResampler`), the reference TypeScript implementation mirroring the
  Rust crates operation for operation, and the WASM binding: the one module
  that knows the ABI of `crates/wasm-bindings`, taking an instantiated
  module's exports from its host, checking every export and `ag_abi_version()
=== 1`, owning every memory view (re-created after any call that may grow
  memory). Golden values shared with Rust: sine bits of turns 0.1, 0.3, 0.6,
  0.9, -0.2, 12.345 = `0x3fe2cf2304755a5e 0x3fee6f0e134454ff
0xbfe2cf2304755a5c 0xbfe2cf2304755a5c 0xbfee6f0e134454fe
0x3fea7771ae3550f5`; the 440 Hz half-scale tone, 4 800 frames at 48 kHz,
  FNV-1a-64 over little-endian f32 bits = `0x46fc8a6833be7402`; the ramp
  `((i % 97) - 48) / 64` of 2 000 frames, 44.1 to 48 kHz at maximum quality,
  pushed in 300s and pulled in 256s = `0x07bc2c6d5a22da3f`. Both paths must
  meet every value.
- `nodes/`: `NodeImplementation extends NodeContract` with
  `createKernel(node, context)`; built-in types: graph input (reads a
  `PcmSource` or a ring), output (sink), gain (smoothed), mix (sum with a gain
  per input), channel map (remap, reorder, extract, duplicate by index),
  matrix (downmix and mid/side as a gain matrix, with ITU-R BS.775 5.1 to
  stereo as a named matrix), delay (whole frames), tone (via the DSP port),
  meter (analysis: peak and RMS per channel). Each declares the layouts it
  supports; mono-only processing adapts per channel only where declared.
- `execution/`: the executor that runs an `ExecutionPlan` block by block over
  pooled buffers, with a delay line on each compensated input, and parameter
  smoothing (linear ramps, arithmetic only).
- `transport/`: `MediaClock` (context time and frames to timeline frames,
  anchored, integer frames) and the `Transport` state machine (stopped,
  playing, paused, suspended by the system; seek; suspend and resume keep the
  position).
- `render/`: `RenderJob` (graph, sources, range, output rate, quality,
  chunk frames), `RenderQualityProfile` (maximum by default), the chunked
  offline renderer (latency trimmed, tail rendered, output written to a sink
  chunk by chunk, identical bits whatever the chunk size, abortable, with
  progress), and the explicit resampled source.
- `scheduling/` and `profiles/`: performance profiles (low latency, balanced,
  maximum stability, custom) that set buffering and scheduling only; the
  underrun monitor and its recommendation; processing-mode selection
  (real-time, cached preview, background offline, final offline) with a
  reason and an override; the priority scheduler (foreground first by default,
  a throughput policy, bounded concurrency); the workload estimate and chunk
  plan that warns and chunks, never refuses.

## Design of `packages/audio-runtime`

DOM, depends on `domain`, `diagnostics`, `capabilities`, `audio-graph`,
`audio-engine`. Given `AudioRuntimeCapabilities`, never probes.

- `context/`: the audio context's lifecycle over an injected factory: the
  autoplay rule (resume on a user's play), `statechange` and Safari's
  `interrupted`, device changes through `watchAudioDevices`, and the measured
  device report (rate, base and output latency, channel count).
- `threads/engine-processor.ts`: the AudioWorklet processor running the
  engine's executor; `threads/render-worker.ts`: the offline-render worker.
  Exported as `./threads/*`.
- `protocol/`: the typed, runtime-validated messages each way (no string
  message names outside one discriminated union with decoders).
- `feed/`: source frames into the worklet over a shared-memory ring or posted
  blocks, as `playbackTransport` says, with underruns counted and reported.
- `render/`: the worker host, bounded by the scheduler, with abort and
  progress.

## Scripts to add

`test:audio-golden`, `test:audio-latency` and `test:worker-responsiveness`
select test files by name (`golden`, `latency`, `responsiveness`). `pnpm test
--filter audio-engine` must be checked for what pnpm does with it. The build
of the WASM module runs as Vitest global setup and in the application's build.
The page's security policy gains `'wasm-unsafe-eval'` in `script-src`.
