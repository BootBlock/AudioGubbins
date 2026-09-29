> **Status:** In progress. Phase 03 is being implemented on the branch
> `phase-03-audio-engine`, concurrently with Phase 02 on its own branch. The
> ledger keeps the phase `READY` until its gate passes.

# Phase 03 — Audio Engine Foundation

Resume note. It says where the work is and what is left. The packet is
`docs/spec/phases/phase-03-audio-engine-foundation.md`, and the decisions that
shape the work are `ADR-0030` to `ADR-0033`.

## Where the work is

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| Worktree | `../AudioGubbins-phase-03`, beside the primary checkout     |
| Branch   | `phase-03-audio-engine`                                     |
| Shared   | Phase 02 takes `ADR-0020` to `ADR-0029`, Phase 03 from 0030 |

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
`13e5159` Rust crates and `tools/build-wasm.mjs` (`cargo test --workspace`: 32
tests pass, clippy clean), `832b055` capabilities, `0f1aff0`
`packages/audio-graph`, `c104416` `packages/audio-engine` (nodes, executor,
offline renderer, golden, latency and N-channel tests). At `c104416`
`pnpm run verify:commit` passes: 2752 tests.

Engine facts a later step needs: the golden render hash is
`0x797fca5300be6765` (`render/offline-render.golden.test.ts`); the delay's
setting is `as-latency` (setting names are lower-case and hyphenated);
`InputFeed` has a `layout`; `PcmSource` has `release()`; test support is in
`src/testing/` (`render-harness.ts`, `kernel-harness.ts`, `counting-dsp.ts`,
`pcm-fingerprint.ts`). The export lists in
`tests/architecture/package-exports.test.ts` name the engine's, the graph's
and the new capabilities' exports as waiting for `packages/audio-runtime`;
remove each name there as the runtime imports it.

Next steps, in order:

1. Write `packages/audio-runtime` to the design below, registered as the
   engine was (graph tool, cruiser, `ALLOWED`, Vitest project, build).
2. The application: the Audio engine panel, its commands,
   `'wasm-unsafe-eval'` in the page policy, the module, worklet and worker
   URLs in the Vite build.
3. Add the scripts `test:audio-golden`, `test:audio-latency`,
   `test:worker-responsiveness`; check `pnpm test --filter audio-engine`.
4. Evidence package, one review pass with the packet's seven lenses, fixes,
   ledger, handoff capsule, merge to `main` and push.

Lessons: run `cargo fmt -p <crate>`, never `--all` (it rewrote the version
crate). The engine is compiled with `lib: ES2023` only, so it names no
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
