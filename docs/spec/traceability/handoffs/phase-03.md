# Phase Handoff Capsule — Phase 03

## Capability Delivered

AudioGubbins has an N-channel, deterministic, local-first audio engine. A
typed processing graph is validated, its latency propagated and compensated,
and planned; the plan runs block by block on an AudioWorklet, fed from its own
worker through a shared ring or posted blocks, and offline on a render worker
in chunks, at maximum quality by default. Canonical DSP is Rust compiled to
WebAssembly behind a narrow ABI, with a TypeScript reference path that gives
the same bits. The transport's position is counted on the audio thread, and
the context's suspension, a resume that awaits a gesture and a device change
all recover. Performance profiles, Custom among them, processing modes, a
priority policy and a workload estimate that warns and chunks rather than
refuses are the person's to see and choose, in the Transport panel and the
Audio settings.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-03-evidence.md`, under "Requirement-to-evidence mapping". Two
parts of `REQ-ARCH-157` and one browser are owed elsewhere, as recorded below.

- `REQ-PROD-009`
- `REQ-ARCH-011`
- `REQ-ARCH-036`
- `REQ-ARCH-049`
- `REQ-ARCH-079`
- `REQ-ARCH-081`
- `REQ-ARCH-083`
- `REQ-ARCH-084`
- `REQ-ARCH-085`
- `REQ-ARCH-087`
- `REQ-ARCH-088`
- `REQ-ARCH-140`
- `REQ-ARCH-141`
- `REQ-ARCH-144`
- `REQ-ARCH-157`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them.

- `@audiogubbins/audio-graph`: `GraphDescriptor`, `NodeContract`, validation
  and its diagnostics, latency analysis, `ExecutionPlan`.
- `@audiogubbins/audio-engine`: `AudioFrameBlock`, `PcmSource`, `InputFeed`,
  `RenderSink`, `CanonicalDsp` with `REFERENCE_DSP` and the WebAssembly
  binding, `NodeImplementation` and the built-in node types, `MediaClock`,
  `TransportState` and `nextTransportState`, `RenderJob`,
  `RenderQualityProfile`, the offline renderer, performance profiles,
  processing modes, the priority scheduler, the workload estimate and the
  render strategy; `./testing` for other packages' tests.
- `@audiogubbins/audio-runtime`: the context lifecycle, playback sessions, the
  render host, the typed protocols, `DspDelivery`, and the thread entries
  `./threads/engine-processor`, `./threads/feeder-worker` and
  `./threads/render-worker`.
- `@audiogubbins/capabilities`: `AudioRuntimeCapabilities`, the audio features
  and the memory the page reports.
- `@audiogubbins/domain`: `ChannelLayout` extended with positions, ambisonic
  sets and labels, and `ProcessorLatency`, which the effect chain now uses.

## Persisted / Interchange Formats

- The application's audio settings, schema `audioSettings` version 1: the
  chosen profile and the Custom profile's values, the priority policy and the
  render mode, each field read back by the engine's own validation.
- Nothing else is persisted. Layouts, graphs, render jobs and latencies are
  runtime values; Phase 02's project format converts from the domain's layout.

## Invariants Downstream Agents Must Preserve

- `packages/audio-graph` depends on the domain alone, the engine on the domain
  and the graph, and neither may name a browser or Node global: they compile
  with `lib: ["ES2023"]` and no ambient types, and the worklet's and workers'
  code compiles in the scope of its own thread (`scope-projects.test.ts`).
- Only `packages/capabilities` probes the browser. `fetch` is used nowhere.
- A node type is one `NodeImplementation` that states its contract and makes
  its kernel. A kernel allocates nothing per quantum
  (`kernel-allocation.test.ts`).
- Canonical processing uses basic IEEE-754 arithmetic in a stated order, the
  same in Rust and the reference, and a change of order needs new golden
  values agreed by both paths and justified (`ADR-0032`, `REQ-EXEC-180`). A
  GPU path is never chosen for a final render.
- Only `packages/audio-engine/src/dsp/wasm` knows the ABI, which is versioned;
  the module's WebAssembly features stay within the browser floor
  (`dsp-module-features.test.ts`).
- Processor latency is known or unknown with a reason, and unknown latency
  never enters a parallel path silently.
- The transport's position is the frame that has left the graph, counted on
  the audio thread.
- No output is downmixed or truncated at the device: channels are placed by
  role, or the output is refused with its reason.
- Nothing is refused for size; a heavy operation warns, names the resource and
  offers a safer strategy.

## ADRs

- `ADR-0030` — the engine is three packages: the graph, the engine and the
  browser runtime.
- `ADR-0031` — the WebAssembly boundary is a hand-written C ABI over handles,
  with a reference path beside it.
- `ADR-0032` — canonical processing uses only basic IEEE-754 arithmetic, in a
  stated order.
- `ADR-0033` — the phase extends the domain's channel layout.

## Verification Baselines

- Golden values, zero tolerance, on both DSP paths and in Rust: the sine of
  six turns, the tone `0xc92ed51ca6467571`, the conversion
  `0x98be85a59ec272f0`, the far-seek tone `0x6c15de3e30ae6635`, the golden
  render `0x6b1d7f884c8844a1`; the application's test signal renders to
  `0xe576a76257ddb259`.
- The resampler's measured response per quality (`resampler-response.test.ts`).
- `pnpm run test:audio-golden`, `test:audio-latency`,
  `test:worker-responsiveness`, `cargo test --workspace`, and
  `tests/e2e/transport.spec.ts` in Chromium.

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Ambisonic encode, decode and rotate are processors; the canonical processor
  library is Phase 06's (packet: "Full processor library" out of scope).
- Cached preview processing has no producer until a phase renders ahead of
  playback; the mode selector reports it unavailable with the reason.

## Accepted Non-Blocking Debt

- F-20 (MEDIUM): Safari on macOS and iOS was not run, because no Safari is
  available to the test machine. Owed to Phase 14's compatibility hardening.
- F-02 residue: the device order Chromium gives a 7.1 output was not checked on
  a device of eight channels. Owed to Phase 14 with the rest of its N-channel,
  surround and ambisonic end-to-end validation.
- The main application chunk is over Vite's 500 kB warning. Owed to Phase 14's
  performance hardening.

## Downstream Readiness

- Phase 04 — Waveform and Timeline Foundation is `READY`.
- Phase 05 still waits on Phases 02 and 04, and Phase 06 on Phase 05.
