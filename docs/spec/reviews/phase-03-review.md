# Phase 03 — Audio Engine Foundation — Review Record

The seven lenses `phases/phase-03-audio-engine-foundation.md` requires, run as
independent read-only reviewers over `git diff 2d9f195..e980832`, the phase as
it stood when its implementation was complete, against the packet,
`contracts/review-gates.md`, the owned requirements and `ADR-0030` to
`ADR-0033`. No reviewer was told to preserve the implementation, and none
edited the tree.

Under the owner's decision of 2026-09-28 the phase has one review pass, whose
verified findings are all fixed or explicitly accepted, and no mutation
harness. Each fix still carries a test that was seen to fail against the code
it replaced.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

Every finding was verified by its reviewer before it was reported, by a
measurement, a run or a reading of the code against the rule it breaks, and
again by the remediation, which reproduced it in a test before fixing it.
**Status** records that verification:

- `CONFIRMED` — reproduced, or established by reading the code against the
  requirement.
- `REJECTED` — investigated and shown not to hold. The reasoning is recorded.

## Lenses run

| Lens | Findings | Blocking |
| --- | --- | --- |
| Audio / DSP Correctness | 4 | none |
| Architecture | 6 | none |
| Performance / Scalability | 6 | 1 HIGH |
| Testing / Regression | 7 | none |
| Browser Compatibility | 5 | none |
| Code Quality / Maintainability | 9 | none |
| Adversarial Agent-Quality | 8, and a table of the owned requirements | none |

Findings raised by more than one lens are merged under one identifier, with
the lenses listed together. The merged list has thirty-eight findings: one
`HIGH`, twenty `MEDIUM` and seventeen `LOW`.

## Blocking findings

### F-01 — HIGH — The matrix and mix kernels allocate on every multiply-add

- **Lens:** Performance / Scalability. **Status:** `CONFIRMED`, measured.
- `nodes/matrix.ts` and `nodes/mix.ts` read each sample as
  `columns[column]?.[frame] ?? 0`, which V8 boxes: one heap allocation per
  multiply-add on the audio thread. A 64-channel matrix took 2,665 µs of a
  2,667 µs quantum with four minor collections per quantum.
- **Disposition:** fixed in `89c3e1a`. Each kernel holds typed arrays sized
  when it is made and adds one whole input channel at a time, so each output
  sample still receives its terms in channel order and no golden value moves.
  The 64-channel matrix fell to 448 µs. `nodes/kernel-allocation.test.ts`
  runs every built-in node type for 1,024 quanta and requires that none
  allocates, measured as the bytes in use in V8's young generation with any
  trial that collected garbage dropped; it failed against the matrix, mix,
  delay, tone, graph input, gain ramp and reference oscillator as they were.

## Non-blocking findings

| Id | Severity | Lens | Finding |
| --- | --- | --- | --- |
| F-02 | MEDIUM | DSP | An output of more than two channels reached the device through the destination's default two-channel speaker mixing: six channels were mixed as Web Audio's 5.1 whatever their roles, and seven or eight lost every channel past the second (`REQ-ARCH-157`, `ADR-0033`). |
| F-03 | MEDIUM | DSP | The resampler's cutoff sat at the lower Nyquist frequency, so its transition band straddled it: content just above folded back at about −30 dB, and no quality met its documented passband or stopband. |
| F-04 | MEDIUM | DSP | The transport's position was the frames the graph consumed, read from the main thread's clock: a pause and resume lost the frames inside a latent graph, the end overshot by the latency, and an underrun moved the position ahead of the audio. Two findings of the lens, merged. |
| F-05 | MEDIUM | Architecture | The engine, the graph and the domain were compiled with Node's ambient types, so `AbortSignal`, `setTimeout`, `fetch` and `performance` type-checked in code `ADR-0030` says runs in an AudioWorklet. |
| F-06 | MEDIUM | Architecture, Adversarial | Playback's audio was made and fed from the main thread, where a long task became an underrun, and the tone was made on the reference path while the panel said the WebAssembly module was processing. |
| F-07 | MEDIUM | Testing, Adversarial | The ABI version check had no test, no failure code of the module's refusal was asserted, and the reported reason dropped the missing exports and the versions `ADR-0031` says it names. |
| F-08 | MEDIUM | Testing | Nothing tested that the processor faults when a feed refuses a block. |
| F-09 | MEDIUM | Testing | No test showed at session level that a profile changes buffering and leaves every feature alone. |
| F-10 | MEDIUM | Adversarial | The packet's GPU hook was a capability boolean nothing read, documented as reporting a GPU "for the processors that can use one". |
| F-11 | MEDIUM | Architecture, Code Quality | The engine published no testing entry point, so its test support was copied into the runtime and the application. |
| F-12 | MEDIUM | Code Quality, Adversarial | The reason for a cancelled signal was worked out in five places, and an unused child cancellation leaked its listener. |
| F-13 | MEDIUM | Code Quality | The protocol modules re-implemented the field readers the protocol's reading module exists to hold. |
| F-15 | MEDIUM | Code Quality | Three comments said the worklet is sent a compiled module, where it is sent the bytes. |
| F-16 | MEDIUM | Code Quality | Catches whose comments named a browser refusal took any `Error`, so a programming fault read as a refusal or a fallback. |
| F-17 | MEDIUM | Performance | A resampled or tone source read from a later position replayed everything before it. |
| F-18 | MEDIUM | Performance | The reference oscillator allocated a heap number per sample on the audio thread's fallback path. |
| F-19 | MEDIUM | Performance | The processor posted an underrun per quantum and a message per meter, and each re-rendered the Transport panel on the thread that fed the audio. |
| F-20 | MEDIUM | Browser | No automated browser test pressed Play or Render, and Safari was never exercised. |
| F-21 | MEDIUM | Adversarial, Testing | `REQ-ARCH-079`, `083`, `084` and `087` were met only in the engine: mode selection, the Custom profile, the priority policy and the workload estimate had no consumer. |
| F-38 | MEDIUM | Adversarial | `REQ-ARCH-157`'s channel operations lacked per-channel gain, polarity and delay, correlation analysis, and ambisonic ordering and normalisation. |
| F-14 | LOW | Architecture, Code Quality | "Is there a DSP module, or why not" had six shapes, some pairs of optionals allowing neither or both. |
| F-22 | LOW | Testing | `pnpm test --filter audio-engine` runs one of the three engine packages. |
| F-23 | LOW | Testing | In watch mode a crate edit neither rebuilt the module nor reran the tests. |
| F-24 | LOW | Testing | Nothing automated ran the real worker and worklet glue. |
| F-25 | LOW | Architecture | Every panel was handed the audio store's setters. |
| F-26 | LOW | Architecture | Three of the packet's contract names have no documented mapping to the names in the code. |
| F-27 | LOW | Adversarial, Code Quality | The WebAssembly path accepted uneven channels and failed on an empty render where the reference path refused or returned. |
| F-28 | LOW | Adversarial | Processor latency had two models, the domain's always-known count and the graph's known-or-unknown value. |
| F-29 | LOW | Adversarial | Promises were voided where a rejection could go unobserved, and a failed context creation was retried silently. |
| F-30 | LOW | Adversarial | The fingerprint said it read samples little-endian and read them in the host's order. |
| F-31 | LOW | Browser | A resume the browser does not allow without a gesture never settles, so a start that was not a click waited for ever; the test fake rejected, as no browser does. |
| F-32 | LOW | Browser | The render worker did not listen for `messageerror`, so an unreadable render hung its scheduler slot. |
| F-33 | LOW | Browser | The worklet code was type-checked with the DOM library, whose globals the worklet scope lacks. |
| F-34 | LOW | Browser | The WebAssembly features the module uses followed the unpinned stable toolchain. |
| F-35 | LOW | Code Quality | The superseded-playback failure code was a literal written in three places. |
| F-36 | LOW | Code Quality | A duration formatted with `toFixed`, a double cast in a test, and a process reference in the resume note. |
| F-37 | LOW | Performance | The delay line built a closure per call, and the reference resampler a view and a closure per output sample. |

### Rejected

- **The WebAssembly module is compiled on every worklet `load`.** Raised as a
  known point and measured by the Performance lens: 4.5 ms on the first
  compile and about 0.05 ms after, since the engine caches it, while the
  processor is halted. The Architecture lens found the choice of bytes over a
  compiled module sound, because Chromium raises `messageerror` for a module
  sent to a worklet, which the Browser lens reproduced in Chromium 153.
  `REJECTED` as a defect.

## What the reviewers found sound

- The canonical arithmetic: the sine's reduction and polynomial, the Bessel
  series, and every kernel's operation order are identical in Rust and the
  TypeScript reference, and the golden values are literal constants asserted
  against the WebAssembly module, the reference path and the Rust crates.
- The package topology of `ADR-0030`: the dependency cruise and the
  architecture project passed, `ag_*` names appear in one module, objects
  cross the boundary only as handles, and `unsafe` is allowed in one crate.
- The shared-memory ring's ordering, the posted fallback's transfer of
  blocks, the offline renderer's chunk-bounded memory, the scheduler's bounded
  concurrency and the absence of `Atomics.wait`, `fetch` and unbounded
  `Promise.all`.
- The browser paths the Browser lens drove in Chromium 153 and Firefox 155,
  with and without cross-origin isolation: `'wasm-unsafe-eval'` inside the
  worklet, both Vite thread bundles, and the defensive reading of optional
  context features.

## Disposition

Every verified finding is fixed or accepted with tracking. Each fix carries a
test that failed against the code it replaced, unless the entry says why none
can. Commits are on `phase-03-audio-engine`.

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `89c3e1a`, as above. |
| F-02 | **Fixed** in `b3663a8`, and re-checked on a device change in `0bcd193`. The destination takes the output's channel count as discrete channels, the channels are placed for the device by role in the WAVEFORMATEXTENSIBLE order through a splitter and a merger that reorder and never mix, and an output the device cannot take, or whose roles cannot be placed, is refused before playback with a reason naming both counts. Six tests through the fake context failed against the old code. The 7.1 order Chromium gives a device of eight channels is not driven on real hardware; see the evidence's limitations. |
| F-03 | **Fixed** in `ab56867`. Each quality states a passband edge and an attenuation, the cutoff sits at the centre of a transition band that ends at the lower Nyquist, and the kernel's length and window follow Kaiser's formulas, in both languages in one order. `resampler-response.test.ts` measures 72 cases on both paths; 34 of the reference path's 36 failed against the old kernel. The golden conversion moved from `0x07bc2c6d5a22da3f` to `0x98be85a59ec272f0`, and the golden render from `0x797fca5300be6765` to `0x6b1d7f884c8844a1`, with Rust, the module and the reference in agreement and a justification beside each (`REQ-EXEC-180`). |
| F-04 | **Fixed** in `0bcd193`. The processor counts the frames that have left the graph, runs a quantum only when every feed can supply it, and sends the count with every report and reply; a pause keeps the pipeline. A 4,800-frame latent graph paused three times matches an uninterrupted play bit for bit and stops at the end, and a 16-quantum underrun leaves the position and the resume exact. |
| F-05 | **Fixed** in `b3663a8`. The engine, the graph and the domain are compiled again with `types: []` and `lib: ["ES2023"]` in generated scope projects; `tests/architecture/scope-projects.test.ts` compiles probes that must fail, and seven of its eight tests failed with the scopes removed. |
| F-06 | **Fixed** in `0bcd193`. A feeder worker reads the sources and makes the tone on the compiled module, falling back to the reference path with its reason, and writes the ring or posts blocks to the worklet on its own channel. The panel reports each thread's DSP path, and the browser run read "WebAssembly module" for the feeder. |
| F-07 | **Fixed** in `ab56867`. `dsp-exports.test.ts` covers every refusal code with hand-built exports, and the reason names the missing exports or both ABI versions; 18 tests failed against the old texts. |
| F-08 | **Fixed** in `0bcd193`. Three processor tests: a posted block past the queue, a block after its end and a mono block to a stereo feed, each a fault naming the node and then silence. |
| F-09 | **Fixed** in `0bcd193`. A session test under Low latency and Maximum stability: 2,304 against 42,112 frames queued before start, an 8 ms against a 125.3 ms wake, the same output and a normal end. |
| F-10 | **Fixed** in `375a2c5`. A node type may declare a GPU path, one selection chooses each node's path from the capabilities and never a GPU path for a final render, whose bits are canonical, and the panel says whether a GPU is available and whether any processor uses it. No built-in processor has a GPU path; the canonical processor library is Phase 06's. |
| F-11 | **Fixed** in `375a2c5`. The engine publishes `@audiogubbins/audio-engine/testing`, and the runtime's copies are deleted. |
| F-12 | **Fixed** in `375a2c5`. One `cancellationReason`; the unused child cancellation is removed. |
| F-13 | **Fixed** in `375a2c5`. Every shared reader is in `protocol/message-reading.ts`. |
| F-14 | **Fixed** in `375a2c5`. One `DspDelivery` union from the page to every thread and its reader. |
| F-15 | **Fixed** in `375a2c5`. The comments say the worklet is sent the bytes and the workers the compiled module. |
| F-16 | **Fixed** in `b3663a8` (the context, the module, the worklet's DSP), `ab56867` (the DSP instance) and `375a2c5` (the render worker). Each catch takes only the errors its reason names, a `DOMException` read by its name across realms; a `TypeError` surfaces as itself in each test. **Found with it:** a rejected module addition was an unhandled rejection in `WorkletModule.addTo`, fixed. |
| F-17 | **Fixed** in `ab56867` and `50f8675`. The resampler seeks to the exact phase and input frame, and the oscillator's phase is a 64-bit fixed-point count of turns whose frame is known without replay, both through new exports of the module (ABI version 3). A read from the middle equals the same frames of a read from zero on both paths, and the frames read do not grow with the start. The golden tone moved from `0x46fc8a6833be7402` to `0xc92ed51ca6467571`, and a new golden reads 4,800 frames from frame 10¹². |
| F-18 | **Fixed** in `89c3e1a`, and kept allocation-free by the redefined oscillator in `50f8675`. |
| F-19 | **Fixed** in `0bcd193` and `bb8529c`. One report about every 30 ms carries the summed underruns and every meter, the stability history is a ring with a running sum, a warning is logged once per episode, and the panel reads levels and render progress once per display frame. |
| F-20 | **Fixed for Chromium, accepted for Safari.** `tests/e2e/transport.spec.ts` plays, pauses, resumes, stops and renders to the fingerprint, and passed in Chromium. Safari on macOS and iOS is not available on this machine, where Playwright's WebKit has no `AudioContext`; its run is owed to Phase 14's compatibility hardening, whose packet owns the end-to-end validation of N-channel, surround and ambisonic audio. |
| F-21 | **Fixed** in `5bf2fd0`. The selector is told which modes this build runs and why the others cannot, the Transport panel shows the playback and render modes with their reasons and an override, the Custom profile is edited in the settings, the priority policy reaches the scheduler, and every render is planned before it starts, with a warning that names the limiting resource and a safer strategy, never a refusal for size. |
| F-22 | **Recorded.** The evidence lists `pnpm test --filter audio-engine` as the packet names it and, beside it, the whole suite that runs the graph and runtime packages. |
| F-23 | **Fixed** in `ab56867` and `50f8675`. The global setup rebuilds the module on every rerun, and a crate edit triggers one. Checked by hand in watch mode; no automated test runs a watcher. |
| F-24 | **Fixed** by F-20's browser test, which runs the real worklet, feeder and render worker in Chromium. |
| F-25 | **Fixed** in `375a2c5`. Panels receive the read side of the audio stores, held by a type test. |
| F-26 | **Fixed** in the evidence, in its section on the public contracts, which maps each of the packet's names to the code's. |
| F-27 | **Fixed** in `ab56867`. Both paths share one shape check, an empty render works on both, and the module reports a buffer too small by its own status. |
| F-28 | **Fixed** in `89c3e1a`. `ProcessorLatency` lives in the domain, the graph uses it, and a chain with a processor of unknown latency says so rather than summing; `ADR-0030` names where it lives. |
| F-29 | **Fixed** in `5bf2fd0` (the render) and `375a2c5` (playback and the context, which reports a context it cannot make once, with its reason). |
| F-30 | **Fixed** in `375a2c5`. No test can fail on a little-endian host; the golden tests confirm the hash is unchanged. |
| F-31 | **Fixed** in `b3663a8`. The resume is bounded by the injected schedule, the context reports that it awaits a click or a key press while keeping the resume, and the fake leaves a resume pending as the browsers do; ten lifecycle tests failed against the old code. |
| F-32 | **Fixed** in `b3663a8`. The worker answers an unreadable message with a refusal. |
| F-33 | **Fixed** in `b3663a8`. The worklet's code is compiled with `lib: ["ES2023"]` and a declaration of exactly the scope's globals it uses, the render worker's with `WebWorker`. |
| F-34 | **Fixed** in `ab56867`. The build passes `-C target-cpu=mvp` and an explicit feature list, and `tests/architecture/dsp-module-features.test.ts` holds the module's `target_features` section to the browser floor. |
| F-35 | **Fixed** in `0bcd193`. `PLAYBACK_SUPERSEDED` is exported once. |
| F-36 | **Fixed** in `5bf2fd0` (the duration), `375a2c5` (the cast) and the resume note's move to `docs/todo/done/`. |
| F-37 | **Fixed** in `89c3e1a` (the delay line) and `ab56867` (the reference resampler). |
| F-38 | **Fixed** in `89c3e1a`: per-channel gain, polarity and delay, a correlation reading per channel pair, and a named matrix converting an ambisonic set between ACN and FuMa ordering and SN3D, N3D and FuMa scaling, refusing FuMa above third order. **Accepted with tracking:** ambisonic encode, decode and rotate are processors, and the canonical processor library is Phase 06's (`phases/phase-06-effect-rack-and-core-dsp.md`). |

### Found during remediation

- The ring feed counted audio behind its mark as queued after a seek, which
  held back the new position's first chunks for a wake interval. Fixed in
  `0bcd193`.
- Every call into the module allocated a rest-argument array and the views
  of its memory were remade per call. Fixed in `ab56867`, with an allocation
  test that failed at 212,352 bytes per 1,024 quanta.
- A coefficient table for a rate pair with many phases can take hundreds of
  megabytes. The render now gives the resampler a budget from the memory the
  page reports; within it the table is kept, beyond it every tap is computed
  with the same bits, and the chunk plan counts the tables (`50f8675`,
  `375a2c5`).
- The processor's acknowledgement of a posted block allocated a message per
  block. Each feed now reuses one record (`375a2c5`).
- The drive of the built application before landing found the Transport
  panel's meter names in a column of fixed width, which cut "Correlation" and
  would cut a surround role. The meters are one grid whose name column fits
  the longest name, in the commit that records this review.
- The test that holds an evidence's commands to the manifest read Phase 01's
  evidence alone. It reads every phase's now, and an untrue line of this
  phase's list fails it, in the same commit.

## Re-review

The owner's decision of 2026-09-28 replaces looped review rounds with one
pass whose findings are fixed. No lens was re-run. Each fix was verified by
the test that failed before it and by the gate over the merged tree, and the
whole of the phase was driven once in Chromium before it landed.

### Quoted text that names no test

| Quoted | In |
| --- | --- |
| pnpm test --filter audio-engine | F-22 |
