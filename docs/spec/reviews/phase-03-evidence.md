# Phase 03 — Audio Engine Foundation — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the tree this package describes, the phase branch
after its one review pass and the fixes that answered it.

## Phase identifier and objective

- **Phase:** 03 — Audio Engine Foundation.
- **Objective:** the N-channel, deterministic, local-first audio-engine
  foundation: transport, media clock, real-time graph execution, offline
  rendering, the Rust and WebAssembly bridge, capability-based acceleration,
  quality and performance profiles, and latency accounting.
- **User-visible outcome:** the Transport panel plays a deterministic test
  signal through the processing graph on the audio thread, fed from its own
  worker, with meters, a correlation reading, the transport's position, the
  performance profile, the processing modes and the DSP path of each thread,
  and renders it offline at maximum quality to a fingerprint that is the same
  on every machine and on both DSP paths.

## Checklist

Every box in the packet's **In Scope** list:

- N-channel, layout-aware PCM model: `packages/domain/src/audio` (positions,
  ambisonic sets, labels; `ADR-0033`), `packages/audio-engine/src/pcm`.
- Web Audio and AudioWorklet real-time engine: `packages/audio-runtime`
  (context lifecycle, processor, feeder worker, feeds, protocols).
- Typed directed processing graph: `packages/audio-graph`.
- Rust and WebAssembly DSP boundary: `crates/dsp-core`, `crates/resampling`,
  `crates/wasm-bindings`, `packages/audio-engine/src/dsp` (`ADR-0031`).
- Canonical offline render pipeline: `packages/audio-engine/src/render`, the
  render worker (`packages/audio-runtime/src/render`, `threads/render-worker.ts`).
- Transport and media clock: `packages/audio-engine/src/transport`, with the
  position counted on the audio thread (`processor/playback-count.ts`).
- Processor latency and delay compensation: `packages/audio-graph/src/latency.ts`,
  `path-latency.ts`, the executor's aligned inputs, the renderer's trim.
- Performance and quality profiles: `packages/audio-engine/src/profiles`, the
  Audio section of the settings and the Transport panel's profile choice.
- Worker scheduling and foreground priority:
  `packages/audio-engine/src/scheduling/priority-scheduler.ts`, the render
  host, and the priority policy setting.
- Capability-aware GPU and shared-memory hooks without hard dependency: the
  shared ring chosen when the page is cross-origin isolated, the posted feed
  otherwise; the GPU path selection in `packages/audio-engine/src/nodes`,
  reported in the panel.
- Resource-aware streaming and chunking: `PcmSource` reads by range and by
  view, the chunked renderer, `scheduling/workload.ts` and
  `render-strategy.ts`, and the coefficient budget of the resampler.

Work units: WU-03.A to WU-03.E as the packet defines them, every box done.

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/domain` | The channel layout extended with positions, ambisonic sets and labels (`ADR-0033`), and the one `ProcessorLatency`, known or unknown with a reason, that the effect chain and the graph both use. |
| `packages/audio-graph` | The graph as a value: descriptors and their reading, validation and diagnostics, flattening of subgraphs, latency propagation, delay compensation, slot allocation and the execution plan (`ADR-0030`). Depends on the domain alone. |
| `packages/audio-engine` | Frame blocks and sources, the `CanonicalDsp` port with its reference and WebAssembly implementations, node kernels, the executor and parameter ramps, the media clock and transport, the chunked offline renderer, profiles, processing modes, the scheduler, the workload estimate and the render strategy, and `./testing`. Compiled with `lib: ["ES2023"]` and no ambient types. |
| `packages/audio-runtime` | The browser host: the context's lifecycle and device output, the AudioWorklet processor, the feeder and render workers, the feeds, the typed protocols with their readers, playback sessions and the render host. Each thread's code is compiled in its own scope. |
| `packages/capabilities` | The audio runtime's capabilities and features, and the memory the page reports. The only package that probes the browser. |
| `crates/dsp-core`, `crates/resampling`, `crates/wasm-bindings` | The canonical sine, oscillator and window; the streaming resampler; the C ABI over handles (`ADR-0031`, `ADR-0032`). |
| `apps/web` | The Transport panel, the Audio settings, the audio commands, the audio settings and view stores, the composition of the engine, the Vite wiring of the threads and the module, and `'wasm-unsafe-eval'` in the page's policy. |

Tooling: `tools/build-wasm.mjs` (the module, with pinned features),
`tools/sync-workspace-graph.mjs` (the thread scope projects),
`tests/setup/dsp-module.ts` (the module built as Vitest's global setup, and
rebuilt on every rerun in watch mode).

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| ChannelLayout | `ChannelLayout` in `@audiogubbins/domain` (`ADR-0033`). |
| AudioFrameBlock / stream contract | `AudioFrameBlock`, and the stream contracts `PcmSource` (read by range into planar views), `InputFeed` and `RenderSink`, in `@audiogubbins/audio-engine`. |
| Transport | The state machine `TransportState` with `nextTransportState` over `TransportEvent`, in `@audiogubbins/audio-engine`: a value and a transition function rather than an object, so the audio thread's counts drive it. |
| MediaClock | `MediaClock` in `@audiogubbins/audio-engine`. |
| ProcessingGraph | `GraphDescriptor`, with its validation and `ExecutionPlan`, in `@audiogubbins/audio-graph`. |
| ProcessorLatency | `ProcessorLatency` in `@audiogubbins/domain`, used by the graph (`ADR-0030`). |
| RenderJob | `RenderJob` in `@audiogubbins/audio-engine`. |
| RenderQualityProfile | `RenderQualityProfile` in `@audiogubbins/audio-engine`, maximum quality by default. |
| AudioRuntimeCapabilities | `AudioRuntimeCapabilities` in `@audiogubbins/capabilities`. |

The worklet, feeder and render protocols are discriminated unions with runtime
readers in `packages/audio-runtime/src/protocol`, and the module's delivery to
each thread is one `DspDelivery` union. Nothing is persisted: the settings
store's `audioSettings` schema, version 1, is the only stored format the phase
adds.

## ADRs created and changed

- `ADR-0030` — the engine is three packages, the graph, the engine and the
  browser runtime. Changed during remediation to say `ProcessorLatency` lives
  in the domain.
- `ADR-0031` — the WebAssembly boundary is a hand-written C ABI over handles,
  with a reference path beside it. The ABI is at version 3, which adds the
  resampler's and the oscillator's seek and the coefficient report.
- `ADR-0032` — canonical processing uses only basic IEEE-754 arithmetic in a
  stated order.
- `ADR-0033` — the phase extends the domain's channel layout.

## Tests

| Area | Where |
| --- | --- |
| Golden values on both DSP paths and in Rust | `packages/audio-engine/src/dsp/golden-dsp.test.ts`, `render/offline-render.golden.test.ts`, the Rust tests of `turns.rs`, `oscillator.rs`, `stream.rs` |
| Resampler quality | `dsp/resampler-response.test.ts` (72 cases, both paths), `dsp/resampler-coefficients.test.ts` |
| The ABI and the module | `dsp/wasm/dsp-exports.test.ts`, `packages/audio-runtime/src/dsp/*.test.ts`, `tests/architecture/dsp-module-features.test.ts` |
| Allocation on the audio thread | `nodes/kernel-allocation.test.ts`, `dsp/wasm/wasm-dsp-allocation.test.ts`, `testing/allocation.test.ts` |
| N-channel layouts | `offline-renderer.test.ts` (mono, stereo, 5.1, a labelled custom layout), the node tests, `ambisonic-conversion.test.ts`, `playback/device-output.test.ts` |
| Latency | `packages/audio-graph/src/latency.test.ts`, `render/offline-render.latency.test.ts`, `playback/playback-session.test.ts` (a latent graph paused and resumed) |
| Responsiveness | `packages/audio-runtime/src/render/render-responsiveness.test.ts` |
| Suspend, resume, devices | `context/context-lifecycle.test.ts`, `device-channels.test.ts`, `device-routing.test.ts`, `playback/playback-session.test.ts` |
| Profiles, modes, priority, workload | `profiles/*.test.ts`, `scheduling/*.test.ts`, `apps/web/src/state/audio-settings-store.test.ts`, `apps/web/src/commands/audio-settings-commands.test.ts`, `render/render-host.test.ts` |
| Thread scopes and layering | `tests/architecture/scope-projects.test.ts`, `dependency-rules.test.ts`, `package-exports.test.ts`, `public-contracts.test.ts` |
| The built application in a browser | `tests/e2e/transport.spec.ts` |

## Commands used for verification

```
pnpm run lint                        # pnpm run version:check, pnpm run graph:check, pnpm run notices:check, eslint ., prettier --check .
pnpm run typecheck:full              # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json
pnpm run test                        # vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.cache/audiogubbins/vitest-report.json
pnpm run record:check                # node tools/check-record-titles.mjs
pnpm run test:dependencies           # depcruise --config .dependency-cruiser.cjs apps packages tests tools
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:audio-golden           # vitest run golden
pnpm run test:audio-latency          # vitest run latency
pnpm run test:worker-responsiveness  # vitest run responsiveness
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
cargo test --workspace
```

The packet also names `pnpm test --filter audio-engine`, which pnpm reads as a
workspace filter and runs as the package's own script, `vitest run --root ../../
--project audio-engine`, with the root's global setup that builds the module.
It runs the engine alone; the graph's and the runtime's tests run in the whole
suite, `pnpm run test`. The browser test ran as
`playwright test tests/e2e/transport.spec.ts --project=chromium-transport`.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Pass, over the tree of the final remediation commit: lint and formatting clean, both type-checks clean with every thread scope, 3558 tests passed in 186 files, 0 failed, every cited title resolved, no dependency violations in 600 modules. |
| `cargo test --workspace` | Pass: `dsp-core` 13, `resampling` 21, `wasm-bindings` 8, `audiogubbins-version` 5. |
| `pnpm test --filter audio-engine` | Pass: 482 tests in 36 files. |
| `pnpm run test:audio-golden` | Pass: 21 tests in 2 files. |
| `pnpm run test:audio-latency` | Pass: 18 tests in 2 files. |
| `pnpm run test:worker-responsiveness` | Pass: 4 tests in 1 file. |
| `pnpm run build` | Pass, with the build-output check. Vite warns that the main chunk is over 500 kB. |
| `pnpm run spec:verify` | Pass. |

Three runs of the whole suite failed on timing. Twice it was the Phase 01 test
"reads four times the work as about four times the cost, and the same work as
the same", once while other work loaded the machine and once with the suite's
own workers alone; it passed three times on its own and in the next whole run
each time, and this phase changed neither it nor what it measures. Once it was
the whole-render responsiveness test, whose render at maximum quality now
outlasts the default timeout under load, and which was given a bound that only
stops a hang, since it holds the shape of the work and never its speed.

## Browser and device results

The built application was driven in Chromium through Playwright on a device
running at 48 kHz, from a preview server of the production build:

- On the WebAssembly path, Play reached Playing with the audio context
  running, the feeder thread and the audio thread both reporting the
  WebAssembly module, the position advancing, both meters reading −12.0 dB
  and the stereo correlation +1.00. Pause held the position (0:01.571 over
  700 ms), Play resumed from it, and Stop returned to 0:00.000. The offline
  render gave the fingerprint `0xe576a76257ddb259`.
- With `WebAssembly` removed from the page, every thread ran on the reference
  path and said why, playback behaved the same, and the render gave the same
  fingerprint, `0xe576a76257ddb259`.
- The console showed no policy, worklet or page error. Its one warning is
  Chromium's "No available adapters." from the WebGPU probe of a headless
  browser, and the panel reported the GPU as not available.
- `tests/e2e/transport.spec.ts` passed, 2 of 2.

Before the review, the fingerprint was `0x0ed5ce5b65bfb45d`. It moved with the
oscillator's redefinition as a 64-bit fixed-point phase (F-17), which the
golden tests of both paths and Rust carry.

The Browser lens drove the application at the start of the review in Chromium
153 and Firefox 155, with and without cross-origin isolation: playback and
render worked in both, on the shared ring and on the posted feed.

## Performance, audio and DSP

| Golden | Value |
| --- | --- |
| Sine of turns 0.1, 0.3, 0.6, 0.9, −0.2, 12.345 | `0x3fe2cf2304755a5e`, `0x3fee6f0e134454ff`, `0xbfe2cf2304755a5c`, `0xbfe2cf2304755a5c`, `0xbfee6f0e134454fe`, `0x3fea7771ae3550f5` |
| 440 Hz tone, 4,800 frames at 48 kHz | `0xc92ed51ca6467571` |
| Ramp of 2,000 frames, 44.1 to 48 kHz at maximum quality | `0x98be85a59ec272f0` |
| Golden render | `0x6b1d7f884c8844a1` |
| The application's test signal, rendered offline | `0xe576a76257ddb259` |

Every value is a literal asserted against the WebAssembly module and the
reference path, and the tone, conversion and sine values against the Rust
crates too; the tolerance is zero (`ADR-0032`). The resampler's qualities are
flat to 97, 95 and 90 % of the lower Nyquist frequency and attenuate at least
140, 100 and 60 dB at and above it. A 64-channel matrix takes 448 µs of a
2,667 µs quantum, and no built-in kernel allocates.

## Known limitations

- Safari on macOS and iOS was not run: Playwright's WebKit on this machine has
  no `AudioContext`. Owed to Phase 14 (F-20).
- The device order of a 7.1 output in Chromium was not checked on a device of
  eight channels (F-02).
- Cached preview processing has no producer in this phase, and the panel says
  so rather than choosing it.
- Ambisonic encode, decode and rotate are processors, owed to Phase 06 (F-38).
- A storage warning has nothing to act on until an operation writes; the
  first one that does owns it.
- No built-in processor has a GPU path; the selection and its report are in
  place for the first that declares one (F-10).
- The worklet compiles the module's bytes on each load, measured at 4.5 ms the
  first time and about 0.05 ms after.
- A coefficient table beyond the render's budget is computed per tap, with the
  same bits and far more slowly, and the plan says so.

## Dependencies added, and their review

None outside the workspace. The crates depend only on each other, and every
new package dependency is `workspace:*`.

## Migration and schema impact

The settings store `audioSettings` is new at schema version 1. Nothing else is
persisted: channel layouts, graph descriptors, render jobs and processor
latencies are runtime values (`REQ-STOR-052` untouched).

## Screenshots and recordings

None kept in the tree. The browser test and the drive above are the evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-PROD-009` Audio duration and scale | Sources read by range into views, a chunked renderer whose memory is one chunk, seeks in constant work, no duration cap | `offline-renderer.test.ts`, `resampled-source.test.ts`, `tone-source.test.ts` (a read from frame 10¹²) |
| `REQ-ARCH-011` Audio precision | 32-bit float blocks, 64-bit accumulation rounded once, three resampling qualities with stated responses | `mix.test.ts`, `matrix.test.ts`, `resampler-response.test.ts` |
| `REQ-ARCH-036` Processing architecture direction | Playback on the AudioWorklet, sources on a feeder worker, offline renders on a render worker; the main thread commands | `engine-processor-core.test.ts`, `feeder-core.test.ts`, `render-worker-core.test.ts`, `render-responsiveness.test.ts`, `tests/e2e/transport.spec.ts` |
| `REQ-ARCH-049` Deterministic rendering | The canonical path and its goldens; the platform variation after it documented in `ADR-0032` | `offline-render.golden.test.ts` at four chunk sizes on both paths |
| `REQ-ARCH-079` Adaptive processing modes | `selectProcessingMode` told which modes the build runs, `render-strategy.ts`, the panel's Processing section and the override | `processing-mode.test.ts`, `render-strategy.test.ts`, `audio-settings-commands.test.ts`, `transport-panel.test.tsx` |
| `REQ-ARCH-081` Canonical deterministic processing | Basic arithmetic in a stated order in Rust and TypeScript; the reference path as the documented fallback | `golden-dsp.test.ts`, the Rust vectors, the browser drive on both paths |
| `REQ-ARCH-083` Audio performance profiles | Four profiles, Custom edited in the settings, underruns measured with a warning and a recommendation | `performance-profile.test.ts`, `stability.test.ts`, `audio-settings-store.test.ts`, the session test under Low latency and Maximum stability |
| `REQ-ARCH-084` Foreground and background priority | Interactive work first by default, a throughput policy the person chooses, renders queued by mode | `priority-scheduler.test.ts`, `render-host.test.ts` |
| `REQ-ARCH-085` Native asset rates and session rate | Sources keep their rate; conversions are explicit, reported and seekable | `resampled-source.test.ts`, `offline-renderer.test.ts` (the summary's conversions) |
| `REQ-ARCH-087` Resource-aware operation | The workload estimate and chunk plan, a warning naming the resource and a safer strategy, the coefficient budget, no refusal for size | `workload.test.ts`, `workload-conversions.test.ts`, `render-strategy.test.ts`, `resampler-coefficients.test.ts` |
| `REQ-ARCH-088` Fully local core processing | The module bundled with the page and delivered to each thread; no request of any kind | `tests/build-output.test.ts`, the architecture rule against `fetch` |
| `REQ-ARCH-140` Typed directed processing graph | `packages/audio-graph` | `validation.test.ts`, `flattening.test.ts`, `plan.test.ts`, `shapes.test.ts` |
| `REQ-ARCH-141` DSP implementation languages | Rust crates behind a C ABI of handles, one TypeScript module that knows it, pinned features | `cargo test --workspace`, `dsp-exports.test.ts`, `dsp-module-features.test.ts` |
| `REQ-ARCH-144` Processor latency and delay compensation | Known or unknown latency, propagated, compensated on parallel paths, trimmed from renders, and counted in the transport's position | `latency.test.ts`, `offline-render.latency.test.ts`, `effect-chain.test.ts`, `playback-session.test.ts` |
| `REQ-ARCH-157` Multichannel, surround and ambisonic audio | Layout roles, ambisonic sets and labels; remap, extract, duplicate, matrix, per-channel gain, polarity and delay, correlation, ambisonic ordering and scaling; discrete device output placed by role, and a refusal where it cannot be | `channel-layout.test.ts`, `ambisonic-layout.test.ts`, the node tests, `ambisonic-conversion.test.ts`, `device-output.test.ts` |

The referenced global requirements `REQ-EXEC-184` and `REQ-EXEC-216` are held by
the architecture tests and the capability report as in Phase 01, extended to
the three new packages and the audio features.

## Commits

Oldest first, on `phase-03-audio-engine`, from `2d9f195`:

- `054bae2` Record the decisions the audio engine is built on
- `3a4939b` Give the channel layout the positions, ambisonic sets and labels it lacked
- `13e5159` Add the canonical DSP crates and the WebAssembly boundary
- `832b055` Tell the audio runtime what this device offers it
- `0f1aff0` Add the processing graph as a value, with validation, latency and plans
- `c104416` Add the audio engine core: blocks, DSP, nodes, execution and offline render
- `1ca16b4` Record where Phase 03 stands after the engine core
- `4644b18` Add the browser runtime that hosts the audio engine
- `a9ea715` Make the Transport panel play and render the engine's test signal
- `e980832` Record where Phase 03 stands after the runtime and the panel
- `89c3e1a` Stop the engine's kernels allocating on the audio thread, and widen its channel operations
- `b3663a8` Send every output channel to the device intact, and compile each thread in its own scope
- `ab56867` Make the resampler meet its stated quality, seek directly, and refuse the same inputs on both DSP paths
- `50f8675` Bound the resampler's coefficients by measured memory, and make the oscillator seekable
- `52c9fa8` Re-wrap the merged comments to their width, and bound the whole-render test by its work
- `5bf2fd0` Let the person choose the render mode, the priority and a custom profile, and warn before a heavy render
- `c9e2ec7` Record the render strategy's conversions among the public contracts
- `0bcd193` Feed playback from its own worker, and count the position on the audio thread
- `375a2c5` Give the engine's test support one home, and carry the DSP module and cancellation in one shape each

The merge commits between them join the remediation's branches. The commit
that records this package, the review and the handoff follows, and the
integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-03-review.md` records the seven lenses, their thirty-eight
findings, the one rejected, and the disposition of each with its commit. The
one `HIGH` finding and all twenty `MEDIUM` findings are fixed, except two parts
accepted with tracking: Safari's run (Phase 14) and ambisonic encode, decode and
rotate (Phase 06).
