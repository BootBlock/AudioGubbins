# Phase 06 — Effect Rack and Core DSP — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the tree this package describes, the phase branch
after its one review pass and the fixes that answered it.

## Phase identifier and objective

- **Phase:** 06 — Effect Rack and Core DSP.
- **Objective:** the effect rack and its DSP: a chain of processors that the
  edit plan runs over a selected range, or over a whole asset or region, so the
  plan stays the only description of an edited sound (`ADR-0060`); a canonical
  processor library joined to the engine and held to the same bits in both
  implementations (`ADR-0061`); preview and final quality modes; processor
  versioning; and local machine-learning processing from optional model packs,
  run on the device with no remote fallback (`ADR-0062`).
- **User-visible outcome:** the person builds a chain in the Effects rack panel
  or the Inspector, adds, removes, reorders, bypasses and solos processors,
  groups them in parallel, sets their mix and parameters, and hears the result
  while it plays. They apply a chain to a selection, give an asset or a region
  a rack that follows it through later edits, share one chain between several
  targets or make one independent, copy and paste processors and chains, save
  chains and presets to their library and apply them to several targets in one
  history step, switch between the processed and the original sound and
  between the states of an A/B comparison, choose render and preview quality,
  install, pause, resume, cancel, retry, import and remove model packs, run
  DeepFilterNet 3, MossFormer2 SE 48K and Spleeter on their own machine,
  analyse a target and apply what the assistants recommend, remove silence,
  and find all of it again after a reload.

## Checklist

Every box in the packet's **In Scope** list:

- Effect racks and processor descriptors: one `ProcessorType` per processor
  type (`packages/processors/src/framework/processor-type.ts`), which states
  its `ProcessorDescriptor` (`packages/domain/src/processing/processor-descriptor.ts`)
  and makes its kernel, joined to the engine as node type `processor.<typeKey>`
  (`framework/processor-node.ts`) (`ADR-0061`).
- The domain's `EffectChain` extended with slots, parallel groups, solo and
  wet/dry, bypass being its `enabled` flag on every slot and group, with no
  second chain model (`packages/domain/src/processing/effect-chain.ts`).
- A chain applied to a selected range as a rack edit (`RackEdit`, a
  `process` operation), and a rack on an asset and on a region over the whole
  target (`Asset.rack`, `Region.rack`), each folded into the plan as a
  processed stream (`PlanStream.processing`) in `ADR-0060`'s order
  (`packages/domain/src/editing/plan-building.ts`, `placement.ts`,
  `processed-streams.ts`).
- Shared chains: several operations or targets naming one chain, a change to it
  reaching every one, and making one independent, through the typed project
  commands of `packages/project-commands/src/processing/` (`chain-naming.ts`
  keeps a chain in the project exactly while something names it).
- The core DSP suite: twenty-two canonical processors in
  `packages/processors/src/catalogue.ts` (gain, peak and loudness
  normalisation, parametric equaliser, filter, compressor, limiter, gate,
  expander, de-esser, delay, pitch shift, reverb, ambisonic encode, rotate and
  decode, DC-offset removal, de-hum, de-click, de-pop, noise reduction and
  dereverberation). Fades, reversal, polarity, silence over a range and
  channel edits stay Phase 05's edit operations, gain on a range stays the
  engine's gain node, and resampling is the asset rate conversion below.
- Silence generation: `edit.insert-silence` inserts new silent time, a plan
  source of silence (`silencePlan` in `packages/domain/src/editing/plan.ts`)
  that reads no asset, which every plan reader, the oracle, the preview cache
  key and the project format read.
- Time stretching (`stretch`) and asset rate conversion (`convert-rate`) as
  edit operations that carry positions by their exact ratio and persist the
  engine's algorithm version (`packages/audio-engine/src/pcm/stretched-content.ts`
  on `dsp/phase-vocoder.ts`; `dsp/algorithm-versions.ts`), made by
  `edit.stretch` and `edit.convert-rate`
  (`apps/web/src/commands/time-edit-commands.ts`).
- The canonical exponential, logarithm, power and trigonometric primitives and
  the FFT in `crates/dsp-core` and the reference path
  (`packages/audio-engine/src/dsp/reference/`), DSP ABI 4.
- `crates/analysis` and its reference: the short-time Fourier transform, peak
  and true peak, BS.1770 loudness, and the click, clipping, DC-offset, hum,
  noise-floor, silence and transient features, DSP ABI 6.
- Serial and parallel graph use, wet/dry, and the `side-chain` port a node may
  declare: `packages/effect-rack` realises a chain as a graph of the engine,
  whose latency analysis and delay compensation align every path.
- `QualityMode` replaces `RenderQualityProfile` end to end, with named levels
  and expert settings (`packages/domain/src/processing/quality-mode.ts`).
- Real-time preview, bypass, A/B and processed/original comparison, and
  parameter changes during playback (`ChainRun.setParameter`, keyed by stream
  place and processor; `transport.listen-original`/`-processed`;
  `rack.compare-before-change`).
- The cached preview producer Phase 03's mode selector reported missing: the
  preview worker (`packages/audio-engine/src/preview/`,
  `packages/audio-runtime/src/preview/`), within a stated memory bound
  (`ADR-0061` amended).
- Presets and chains saved in the person's library (`processingLibrary`
  schema 1, `packages/storage/src/processing-library-store.ts`), applied to one
  or several targets in one history step (`library.apply-chain`,
  `library.apply-preset`).
- Copying and pasting processors, slots, groups and chains through the one
  clipboard, as a copy under new identifiers
  (`packages/clipboard`, `apps/web/src/commands/rack-clipboard-commands.ts`;
  `ADR-0053` amended).
- Processor versioning: every instance carries its `ProcessorStateVersion`
  (implementation, parameter schema, a model's identity or a resampler's
  version where one applies), refused when unknown.
- The local model-pack manager: `packages/model-packs` (manifest, install state
  machine, integrity, download, installer, availability) over storage's
  `ModelPackStore`, and the Model packs panel.
- Local ML restoration and separation processors: DeepFilterNet 3,
  MossFormer2 SE 48K and Spleeter 2 and 4 stems
  (`packages/processors/src/ml/`), on `packages/ml-runtime`'s inference port
  (`ADR-0062`).
- Classification, restoration, repair and silence assistants on seven
  canonical detectors (`packages/processors/src/detection/`), run in a worker
  by `packages/detection-runtime`, recommending a chain the person applies and
  never applying one themselves.
- Deterministic canonical render integration: the render, peak, feeder,
  preview and detection workers run chains through the one
  `ChainProcessing` port, a render at the render quality its job carries
  (`RenderJob.quality`), from the stream's start.
- The third-party plugin boundary only: a processor is a `ProcessorType` in the
  build's catalogue, and nothing loads code from elsewhere.
- Rack and processor views in the editor and the Inspector, the Inspector's
  time controls and the Edit menu's "Time and rate" group, the Library panel,
  the Model packs panel and the Analysis panel, each invoking only shell
  commands over the project commands.

Work units: WU-06.A to WU-06.E as the packet defines them.

## Inherited debt

| Debt | Fix |
| --- | --- |
| F-07's remnants (Phase 05) | `5aba08c`: `audio-graph` and `audio-engine` word their counts with the text package's `counted` (`layout-description.ts`, `profiles/stability.ts`; `ADR-0030` amended); `quoted` and `timeOfDay` in `packages/text` (`ADR-0018` amended) are read by the project commands, the storage runtime and the application; usage measurement lists projects by `projectsIn`. |
| Shared processing chains of `REQ-EDIT-014` (Phase 05) | `bfcfdee`, `a04b24f`: shared chains and independence as project commands. |
| F-38 (Phase 03) | `5aba08c`: ambisonic encode, rotate and decode processors. |
| The cached preview mode without a producer (Phase 03) | `1783288`: the preview worker's cached producer. |
| The tests that timed out under load (Phase 05) | `c6e0134`: the golden render, the random command walk and the lint exclusion test have time budgets, and the allocation tests run as their own later project. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/effect-rack` | New. `chainProcessing(types)`: a chain realised as a graph of the engine, whole passes measured in signal order, lead-in and frame grid, running parameter changes. |
| `packages/processors` | New. The processor framework, the catalogue of twenty-two canonical processors, the four ML processors, the seven detectors and four assistants, and the property and golden harnesses. |
| `packages/ml-runtime` | New. The inference port, pinned `InferenceOptions`, the adapter over `onnxruntime-web`, the inference worker, its host and the model channel. |
| `packages/model-packs` | New. `ModelPackManifest` and its one reader, the install state machine, integrity through a `Sha256` port, the `PackSource` port and its HTTP adapter, the installer, availability, the pack path grammar. |
| `packages/detection-runtime` | New. The detection worker's core, protocol and thread entry (`ADR-0061` amended). |
| `crates/analysis` | New. STFT, peak, loudness and the detector features, with its reference in `packages/audio-engine/src/dsp/`. |
| `crates/dsp-core`, `crates/wasm-bindings` | The new primitives and the FFT; the analysis exports; DSP ABI 3 to 6. |
| `packages/domain` | The chain, descriptors, parameters, versions, `QualityMode`, the rack edit, target racks, stretch and rate conversion, the processed stream, chain listening, detection data, the treatment chain, the one structured-clone field reader. |
| `packages/project-format` | The chain's one persisted form (`chain-writing.ts`, `chain-reading.ts`), racks, operations, generated silence, the library entry; `projectDocument` 6, `projectStorage` 10. |
| `packages/project-commands` | The rack, slot, processor and shared-chain commands with inverses. |
| `packages/audio-engine`, `packages/audio-runtime`, `packages/audio-graph` | The `ChainProcessing` port, the processed and stretched sources, read turns, the preview producer and cache, the threads that make the rack. |
| `packages/storage`, `packages/storage-runtime` | `ModelPackStore`, pack pins, cleanup, the processing library, pack import. |
| `packages/capabilities` | `LOCAL_INFERENCE` and `localInferenceCapabilities`. |
| `packages/clipboard`, `packages/history`, `packages/waveform`, `packages/text` | The chain payload; chain differences and names; peaks of racked audio; `quoted` and `timeOfDay`. |
| `apps/web` | The rack, library, pack, analysis and quality commands and views, the ML services, workers started under the page's policy, the build's runtime file and pack serving. |
| `tools/` | The model-pack build (`tools/model-packs/`), the third-party notices generator, the ported-code notices. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| ProcessorDescriptor | `ProcessorDescriptor` in `@audiogubbins/domain`; `ProcessorType` in `@audiogubbins/processors` states one and makes its kernel. |
| ParameterDescriptor | `ParameterDescriptor` in `@audiogubbins/domain`: numeric (with its taper), choice or toggle. |
| ProcessorStateVersion | `ProcessorStateVersion` in `@audiogubbins/domain`, carried by every `ProcessorInstance`. |
| EffectRack | Implemented as `chainProcessing(types)` in `@audiogubbins/effect-rack` (`packages/effect-rack`), which answers the engine's `ChainProcessing` port (`packages/audio-engine/src/pcm/chain-processing.ts`): `prepare` answers a `ChainRun`, `listening` how the chain is heard. The rack's data is the domain's `EffectChain`. |
| Preset/Chain format | The chain's one persisted form, `chain-writing.ts` and `chain-reading.ts` in `@audiogubbins/project-format`, for a project, a plan's processed stream, the library and the clipboard; a library entry is `audiogubbins.library-entry` (`library-json.ts`, `LibraryEntry` in the domain). |
| ModelPackManifest | `ModelPackManifest` in `@audiogubbins/model-packs`, read by its one validating reader. |
| MLProcessorCapability | Implemented as `LocalInferenceCapabilities`, answered by `localInferenceCapabilities`, with the `LOCAL_INFERENCE` requirement, in `@audiogubbins/capabilities` (`packages/capabilities/src/local-inference.ts`). |
| QualityMode | `QualityMode` in `@audiogubbins/domain`, with `MAXIMUM_QUALITY` and the named levels. |
| The rack edit, and the rack of an asset and of a region | `RackEdit` (`{ kind: 'rack', chain }`) in `@audiogubbins/domain`, and `Asset.rack` and `Region.rack`, each an `EffectChainId`. |
| The plan's processed stream | `PlanStream.processing`, a `StreamProcessing` of kind `chain` or `stretch`, in `@audiogubbins/domain`. |
| The inference port | `InferencePort` in `@audiogubbins/ml-runtime`. |
| AudioDetector | `AudioDetector` in `@audiogubbins/processors`. |

## ADRs created and changed

`ADR-0060`, `ADR-0061` and `ADR-0062` were written by the phase's readiness
review, merged in `563d5a4` before the phase began; this phase implements
them. The build amended these records, each by a dated line:

- `ADR-0061` — 2026-10-07: the cached render is made by the preview worker,
  not the render worker. 2026-10-09: `packages/detection-runtime`.
- `ADR-0062` — 2026-10-07: the `queued` install state; removal through the
  installer; the runtime's WebAssembly read from the application's origin.
  2026-10-09: the `PackStore` port inverted; no faster preview path; workers
  under the page's policy; model bytes read on demand and sessions shared; a
  pack's tier is its model's own speed against thoroughness.
- `ADR-0030` — 2026-10-09: `packages/audio-runtime` depends on the rack, the
  processors and the ML runtime only in its thread entries and test support.
- `ADR-0040` — 2026-10-09: the same for `packages/waveform`'s peak worker.
- `ADR-0018` — `quoted` and `timeOfDay` in the text package.

The dependency cruise (`.dependency-cruiser.cjs`) holds the package rules
these records state.

## Tests

| Area | Where |
| --- | --- |
| Chain, slots, groups, versions, validation | `packages/domain/src/processing/effect-chain.test.ts`, `chain-validation.test.ts`, `chain-edits.test.ts`, `processor-version.test.ts`, `parameter-control.test.ts`, `quality-mode.test.ts` |
| The plan with racks against each edit applied in order | `packages/domain/src/editing/rack-edit-property.test.ts`, `edit-property.test.ts`, `validation.test.ts`, `algorithm-versions.test.ts` |
| Chain listening and lead-in | `packages/domain/src/processing/chain-listening.test.ts`, `packages/effect-rack/src/chain-measures.test.ts`, `part-way-start.test.ts`, `preview-start.test.ts` |
| The rack in the engine | `packages/effect-rack/src/chain-run.test.ts`, `rack-latency.test.ts`, `measuring-pass.test.ts`, `normalisation-run.test.ts`, `running-parameters.test.ts`, `pasted-copy-parameters.test.ts`, `concurrent-reads.test.ts`, `cached-preview.test.ts`, `measurement-memory.test.ts` |
| Processed and stretched sources | `packages/audio-engine/src/pcm/processed-content.test.ts`, `stretched-content.test.ts`, `resampled-source.test.ts`, `running-changes.test.ts`, `read-turns.test.ts` |
| Preview producer and cache | `packages/audio-engine/src/preview/preview-producer.test.ts`, `render-cache.test.ts`, `cached-stream-key.test.ts`, `rendered-stream.test.ts`, `preview-channel.test.ts` |
| Canonical primitives, FFT and analysis | `crates/dsp-core/src/{exponential,logarithm,power,trigonometry,fft}.rs`, `crates/analysis/src/` tests; `packages/audio-engine/src/dsp/canonical-primitives.golden.test.ts`, `canonical-fft.golden.test.ts`, `canonical-analysis.golden.test.ts`, `canonical-analysis-agreement.golden.test.ts`, `reference/fft.test.ts`, the allocation tests |
| Processors | per processor under `packages/processors/src/`: `<name>.test.ts`, `<name>.golden.test.ts`, `<name>.properties.test.ts` (the harness is `testing/processor-properties.ts`), and `catalogue-properties.test.ts`, `catalogue.test.ts`, the allocation tests |
| ML processors | `packages/processors/src/ml/**/*.test.ts`; the pinned goldens `ml/deepfilternet/deepfilternet.ml-golden.test.ts`, `ml/mossformer2/mossformer2.ml-golden.test.ts`, `ml/spleeter/spleeter.ml-golden.test.ts` |
| Detectors and assistants | `packages/processors/src/detection/*.test.ts`, `packages/detection-runtime/src/detection-worker-core.test.ts`, `detection-host.test.ts`, `packages/domain/src/processing/treatment-chain.test.ts`, `packages/domain/src/editing/removal-operations.test.ts` |
| Inference runtime | `packages/ml-runtime/src/**/*.test.ts`, `packages/capabilities/src/local-inference.test.ts`, `tests/inference-runtime.test.ts` |
| Model packs | `packages/model-packs/src/**/*.test.ts`, `packages/storage/src/model-pack-store.test.ts`, `pack-pins.test.ts`, `pack-cleanup.test.ts`, `tests/model-packs.test.ts`, `tests/model-pack-serving.test.ts` |
| Persisted format and library | `packages/project-format/src/edit-json.test.ts`, `project-json.test.ts`, `project-tree.roundtrip.test.ts`, `library-json.test.ts`, `packages/storage/src/processing-library-store.test.ts` |
| Project commands | `packages/project-commands/src/processing/rack-commands.test.ts`, `slot-commands.test.ts`, `processor-commands.test.ts`, `project-commands.test.ts` (the random command walk) |
| Clipboard and history | `packages/clipboard/src/processing-payload.test.ts`, `packages/history/src/chain-differences.test.ts`, `difference-names.test.ts`, `apps/web/src/shell/history/entity-names.test.ts` |
| Application commands | `apps/web/src/commands/rack-commands.test.ts`, `library-commands.test.ts`, `pack-commands.test.ts`, `quality-commands.test.ts`, `analysis-commands.test.ts`, `audition-commands.test.ts`, `time-edit-commands.test.ts` |
| Application views | `apps/web/src/shell/rack/rack-panel.test.tsx`, `inspector/inspector-panel.test.tsx`, `library/library-panel.test.tsx`, `library/library-words.test.ts`, `packs/pack-manager-panel.test.tsx`, `analysis/analysis-panel.test.tsx`, `processing-modes.test.tsx`, `transport-panel.test.tsx`, `settings/audio.test.tsx`, `storage/storage-panel.test.tsx` |
| ML in the application and locality | `apps/web/src/ml/ml-locality.test.ts`, `model-availability.test.ts`, `model-services.test.ts`, `pack-needs.test.ts`, `installed-model-files.test.ts` |
| Layering, network rule, exports, notices, build output | `tests/architecture/*.test.ts`, `tests/third-party-notices.test.ts`, `tests/build-output.test.ts` |
| The built application in a browser | `tests/e2e/effect-rack.spec.ts`, `tests/e2e/ml-golden.spec.ts`, `tests/e2e/worker-policy.spec.ts`, `tests/e2e/analysis.spec.ts` |

## Commands used for verification

```
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
cargo test --workspace
pnpm run test:audio-golden           # vitest run golden
pnpm run test:audio-latency          # vitest run latency
pnpm run test:editing-property       # vitest run --project domain --project project-commands edit-property project-commands.test
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:dsp-property           # vitest run --project processors --project domain properties.test rack-edit-property
pnpm run test:ml-locality            # vitest run --tagsFilter ml-locality
pnpm run test:architecture           # pnpm run test:dependencies, then vitest run --project architecture
pnpm run test:ml-golden              # vitest run --project ml-golden
pnpm run test:e2e:effect-rack        # playwright test --project=chromium-effect-rack
pnpm run test:e2e:smoke              # playwright test --project=chromium-smoke
pnpm run test:e2e:accessibility      # playwright test --project=chromium-accessibility
pnpm run test:e2e:core-editing       # playwright test --project=chromium-core-editing
pnpm run test:e2e:ml-golden          # playwright test --project=chromium-ml-golden --project=firefox-ml-golden --project=webkit-ml-golden
pnpm run test:e2e:worker-policy      # playwright test --project=chromium-worker-policy
pnpm run test:e2e:analysis           # playwright test --project=chromium-analysis
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The pack cache is a folder outside the repository that `pnpm packs:build`
fills from the pinned sources (`REQ-REPO-191`); the ML goldens fail, never
skip, without it, and `pnpm test` never runs them. The worker-policy test
needs a build that carries the packs: the same variable, and
`AUDIOGUBBINS_PACKS_IN_BUILD=1`.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Passed: lint, both type checks, 643 test files and 10,313 tests, the record check, and no dependency violations (2,126 modules). |
| `cargo test --workspace` | 121 passed, 0 failed. |
| The packet's four package filters | Passed: processors 103 files, 2,530 tests; effect-rack 13 files, 39 tests; ml-runtime 11 files, 129 tests; model-packs 12 files, 276 tests. A first run timed out one model-packs test under load (Known limitations). |
| `pnpm run test:audio-golden` | 30 files, 195 tests passed, the ML goldens among them. |
| `pnpm run test:audio-latency` | 3 files, 22 tests passed. |
| `pnpm run test:editing-property` | 3 files, 13 tests passed. |
| `pnpm run test:project-roundtrip` | 7 files, 277 tests passed. |
| `pnpm run test:dsp-property` | 27 files, 2,117 tests passed. |
| `pnpm run test:ml-locality` | 6 files, 33 tests passed (the others filtered out by tag). |
| `pnpm run test:architecture` | No dependency violations; 10 files, 310 tests passed. |
| `pnpm run test:ml-golden` | 3 files, 4 tests passed. |
| `pnpm run spec:verify` | PASS. |

## Browser and device results

Each browser test ran through Playwright 1.63.0: the effect-rack, worker-policy
and analysis tests against a production build the preview server serves, and
the ML goldens against their own harness (`tests/e2e/ml-golden/`).

- The final run, on 2026-10-09 over `956f2f5`, each against a build made for
  it: effect-rack 1 passed, with the check that keeps its sliders apart;
  smoke 109 passed, 1 skipped (the tablet's report, run by the tablet
  project) and 1 failed, the intermittent splitter test under Known
  limitations, which passed when run again; accessibility 75 passed; core
  editing 1 passed; analysis 2 passed; worker-policy 2 passed, against a
  build that carries the packs; the ML goldens 1 passed in each of
  Chromium, Firefox and WebKit, each rendering every pack's golden.
- The accessibility run found that the application did not start where the
  runtime makes no collator: a channel name comparer was made as its module
  loaded. `84f9e1b` compares channel names by the text package's one names
  rule, and `channel-names.test.ts` failed against the old code. The smoke
  and core-editing tests expected straight quotes and two placeholder texts
  that earlier phases replaced, and a worker's `blob:` module of the page's
  own origin counted as a request elsewhere; `956f2f5` corrects them.
- `tests/e2e/effect-rack.spec.ts` passed in Chromium over `a04b24f`. It
  applies a chain to a selection from the Effects rack panel, gives a region a
  rack, captures what the page plays with an AudioWorklet tap, reloads, and
  requires the same samples; the region's samples are compared with the
  original's span times the gain within one float32 rounding unit. That region
  check was seen to fail with the span moved by one sample (F-21).
- `tests/e2e/worker-policy.spec.ts` passed, 2 of 2, in Chromium against a
  build made for the check in batch C; against a build of the old code both
  workers' requests to another origin were answered (F-14).
- `tests/e2e/ml-golden.spec.ts` passed, 3 of 3, in each of Chromium, Firefox
  and WebKit, through a configuration made for the check in batch D: each
  pack's pinned final render through the real inference worker gave the same
  hash as Node, so no tolerance is needed (F-08).
- `tests/e2e/analysis.spec.ts`, with its silence removal, passed in Chromium
  against a build made for the check (F-11).
- The ML hearing check in a built app: DeepFilterNet 3 installed from the
  application's origin, paused and resumed, racked and played, about 50 dB less
  noise against the original; every request was on the application's origin,
  the runtime's `.wasm` among them, and opening the project fetched nothing.
- The replay check, on 2026-10-09 in a built app in Chromium: a one-second
  sound played to its end and then from the start three times played whole
  each time, plain and with a peak normalisation rack heard from a render. The
  defect seen before this phase, Play staying stopped after a move to the
  start, no longer happens; which change fixed it was not proven.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Every required processor has golden/property tests covering silence, impulses, full-scale, denormals/NaN defence, and representative programme material. | Each processor's `<name>.golden.test.ts` and `<name>.properties.test.ts` under `packages/processors/src/`, on the harness `testing/processor-properties.ts` (silence, an impulse, full scale, programme material, subnormals, NaN and infinity with recovery, block-size independence, the WebAssembly DSP against the reference, every quality level, declared latency, a tail falling to exact zero); `catalogue-properties.test.ts` fails for a catalogue type held to no layout; the ML processors' property tests run stand-in graphs, one of which emits NaN and infinity (F-07). `pnpm run test:dsp-property`. |
| Effect chains round-trip through project persistence with identical parameter state. | `edit-json.test.ts`, `project-json.test.ts`, `project-tree.roundtrip.test.ts`, `library-json.test.ts`; `processing-library-store.test.ts`; the browser test's reload. |
| Maximum-quality final render is the default and visibly distinct from lower quality when relevant. | `quality-mode.test.ts`, `audio-settings-store.test.ts`, `quality-commands.test.ts`, `processing-modes.test.tsx`, `transport-panel.test.tsx`, `settings/audio.test.tsx`. |
| Model packs can be installed/verified/removed without transmitting audio or breaking projects. | `pack-installer.test.ts`, `install-state.test.ts`, `integrity.test.ts`, `availability.test.ts`, `pack-store.test.ts`, `pack-cleanup.test.ts`, `pack-pins.test.ts`, `model-availability.test.ts`; `ml-locality.test.ts` (no request while a pack's chain is opened, applied, previewed, rendered and analysed; installing makes bodiless GETs of the pack's files only); `pnpm run test:ml-locality`. |
| Processor latency and channel-layout declarations are enforced. | `rack-latency.test.ts`, `chain-measures.test.ts`, the pass-through-with-latency property, `chain-validation.test.ts`, `chain-run.test.ts`; a chain of unknown latency is refused. `pnpm run test:audio-latency`. |
| No third-party arbitrary code/plugin loading exists. | `tests/architecture/dependency-rules.test.ts` refuses every way out of the page in production source, `import()` of a specifier that is not a literal among them, with two named exceptions, and the cruise rules keep `onnxruntime-web` to its adapter; processors are the build's catalogue (`catalogue.test.ts`). |
| Every Rust kernel and new primitive renders the same bits as its reference implementation; every ML processor's final render is pinned as `ADR-0062` states. | `canonical-primitives.golden.test.ts`, `canonical-fft.golden.test.ts`, `canonical-analysis.golden.test.ts`, `canonical-analysis-agreement.golden.test.ts`; the WebAssembly-against-reference property per processor; the three `*.ml-golden.test.ts` files. |
| A chain applied to a selection, an asset's rack and a region's rack render as `ADR-0060` orders them, and the audio a region's rack reads is exactly its span of its asset's processed audio. | `rack-edit-property.test.ts` (the plan against the edits and racks applied to samples in order), `processed-content.test.ts`; the browser test's region check (F-21). |
| A change to a shared chain reaches every operation and target that names it, and one undo restores it. | `packages/project-commands/src/processing/rack-commands.test.ts`, `slot-commands.test.ts`; the random command walk in `project-commands.test.ts`; `apps/web/src/commands/library-commands.test.ts`. |
| Each ML pack's final render is one hash per pack and settings in every browser the tests run, or within a documented and tested tolerance. | `tests/e2e/ml-golden.spec.ts` in Chromium, Firefox and WebKit, giving the Node hashes from one table (`processors/src/testing/ml-goldens.ts`). |
| A browser test applies a chain to a selection, gives a region a rack, reloads, and hears the same project. | `tests/e2e/effect-rack.spec.ts`, above. |

## Known limitations

- No history mechanism joins a drag's changes into one step, so a dragged
  parameter is committed and heard at release. A range's position shows at the
  asset's current rate. A processor selection replaces a region selection.
  After a reload no editor is in use until clicked.
- A parameter change of an ML processor while playing is refused, since it
  needs a new pass; a running change is heard after the feeder's read-ahead.
- Preview renders are held in memory, not on disk; the preview worker uses the
  reference DSP; nothing measures live cost, so a too-costly live chain never
  moves to a render. No interface yet makes a whole-pass rack, so the cached
  mode has no browser test, and the Library panel has none.
- The pack manager says which version a project needs, not which project. No
  pack serves a detector, so "optional enhancement unavailable" is never shown.
  `updatePack` has no command; a newer version installs beside the old.
- The download bound is per installer, not across tabs; an import waits in the
  same slot; storage-pressure relief does not yet take partial downloads;
  `PackStore.transferring` is not in the store contract tests.
- A refused setup or a malformed page message ends the inference worker for
  every thread on it. The runtime sorts a failure into runtime unavailable or
  model refused by its message text, the only signal it gives. Whether the PWA
  precache takes the runtime's `.wasm` and copied packs was not checked.
- `SHALLOW_RECORD_DEPTH` (32) is a hand-picked floor for records that hold no
  chain; `apps/web/src/commands/clipboard-commands.ts` has no test of its own.
- `vitest list` shows no tests in the `*.properties.test.ts` files, though
  they run.
- The ML packs: Spleeter's butted segments leave a measurable seam at each
  join, as Spleeter's own pipeline does; DeepFilterNet 3's chunk joins restart
  its recurrent state (55 dB against a whole-stream run); each channel runs the
  model in turn, so stereo costs twice mono.
- The processors: de-click repairs a click whose context holds another from
  corrupted context; de-pop lowers music below its frequency during a pop; a
  QR sign-flip mutation in `autoregressive.ts` survived (numerical only); pitch
  shift's Draft quality may ripple up to 3 dB, and its frame grid has no
  sample-level test.
- `crates/analysis`'s extractors: `hum.rs` leaves out only 5 bins around a
  peak, so a loud hum's margin stops near 40 to 50 dB; `clipping.rs` applies
  its minimum run within a block, so the detector joins runs itself;
  `noise_floor.rs` reports level only; `transients.rs` sums linear magnitudes.
- Three tests fail now and then and pass when run again, none touched by this
  phase's last changes. The dereverberation allocation tests failed under the
  whole suite's load twice (4096 bytes against a bound of 1024), and passed
  three times out of three alone. `integrity.test.ts`'s "hands over the bytes
  read for use only once every one matched" timed out at 5 s when four
  packages' suites ran at once, and passed alone in 1.9 s twice. The smoke
  test "keeps a panel no shorter than its minimum when the splitter above it
  is dragged" failed three times in eight runs within ten minutes, with
  Transport a tab beside Editor and so no splitter above it, and passed in
  the other five, with and without this phase's last change to the app.
- Safari is not run; WebKit runs only the ML goldens. The browser matrix is
  Phase 14's.

## Dependencies added, and their review

| Package | Version | Licence | Where | Review |
| --- | --- | --- | --- | --- |
| `onnxruntime-web` | 1.30.0 | MIT | `packages/ml-runtime` | Imported only by `import()` in its adapter (cruise rules); its one `.wasm` file is served by the application, hashed by the build and checked again before use. Brings `onnxruntime-common` 1.30.0 (MIT), `flatbuffers` 25.9.23 (Apache-2.0), `guid-typescript` 1.0.9 (ISC), `long` 5.3.2 (Apache-2.0), `platform` 1.3.6 (MIT) and `protobufjs` 7.6.6 (BSD-3-Clause). |
| `@noble/hashes` | 2.4.0 | MIT | `packages/ml-runtime`, `packages/model-packs` | The streaming SHA-256 behind model-packs' `Sha256` port (`nobleSha256`); Cure53 audited 1.0.0 only. |

`THIRD-PARTY-NOTICES.md` is generated from the committed lockfiles by
`tools/sync-third-party-notices.mjs` and checked by `pnpm run lint`, which
refuses a shipped licence off its allow-list; ported source is credited from
`tools/ported-code-notices.json`. Model weights are not dependencies: each
pack is built outside the repository from sources pinned by commit and hash,
and carries its licence texts and a NOTICE.

## Migration and schema impact

The project document's schema is raised to `projectDocument` version 6, and
project storage to `projectStorage` version 10, for rack edits, the racks of
assets and regions, the extended chain, stretch and rate conversion with their
algorithm versions, a converted paste's resampler version, and generated
silence. The person's
library is new, `processingLibrary` version 1; audio settings are raised to
version 2 for render and preview quality. The DSP ABI is 6. Before 1.0 nothing
migrates (`REQ-STOR-052`): a document of an earlier version, or a chain,
processor or state version this build does not know, is refused with the
reason.

## Screenshots and recordings

None kept in the tree. The browser tests and the runs recorded above are the
evidence.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-AUDIO-017` Effect Rack | Stacking, reordering, bypass and enable, solo, parallel groups, mix, parameter editing, presets, real-time preview, A/B comparison, copy and paste, saved chains and applying one to several targets, as project commands with inverses; racks on a selection, an asset and a region, with track, bus and master racks left to their phases through the `effectChainId` fields (`ADR-0060`). | `rack-commands.test.ts` and `slot-commands.test.ts` (project commands), `apps/web/src/commands/rack-commands.test.ts`, `library-commands.test.ts`, `processing-payload.test.ts`, `rack-panel.test.tsx`, `inspector-panel.test.tsx`, `library-panel.test.tsx`, `effect-rack.spec.ts`. |
| `REQ-AUDIO-018` DSP Scope | The twenty-two canonical processors; fades, invert, reverse, silence over a range and channel conversion as Phase 05's edits; silence generation by `edit.insert-silence`; peak and loudness normalisation by a whole-input pass; silence trimming by `removalEdits` and `analysis.remove-silence`; resampling and sample-rate conversion by `convert-rate` and the converting paste; pitch shifting as a processor and time stretching as an operation; noise reduction and dereverberation as spectral processors; the ML processors beyond the list. | The processors' tests under `packages/processors/src/`, `stretched-content.test.ts`, `resampled-source.test.ts`, `silence-plan.test.ts`, `edited-source.test.ts`, `time-edit-commands.test.ts`, `silence-detector.test.ts`, `removal-operations.test.ts`, `analysis-commands.test.ts`, `analysis.spec.ts`. |
| `REQ-AUDIO-019` Preview and Comparison | Live preview where a chain is real-time and a cached render where it is not, with the reason shown; bypass; A/B through the history comparison; processed/original through the page's hearing choice; parameter changes during playback through `ChainRun.setParameter`, refused for a rendered chain, whose playback reloads. | `chain-listening.test.ts`, `running-parameters.test.ts`, `running-changes.test.ts`, `cached-preview.test.ts`, `preview-producer.test.ts`, `audition-commands.test.ts`, `effect-rack.spec.ts`. |
| `REQ-AUDIO-080` Preview Quality and Final Render Quality | `QualityMode` for render and preview, chosen separately; the transport and the processing modes say which is heard and why; a render runs at the render quality from the stream's start, and a preview at the preview quality from part way. | `quality-mode.test.ts`, `preview-quality.test.ts`, `processing-mode.test.ts`, `processing-modes.test.tsx`, `transport-panel.test.tsx`, `quality-commands.test.ts`. |
| `REQ-AUDIO-086` Quality Presets and Expert Controls | Draft, Standard, High and Maximum each map to explicit quality settings, and the custom settings expose each one. | `quality-mode.test.ts`, `settings/audio.test.tsx`, `audio-settings-store.test.ts`. |
| `REQ-AUDIO-138` Local Machine-Learning Processing | DeepFilterNet 3, MossFormer2 SE 48K and Spleeter 2 and 4 stems as whole-pass processors in the same chain, commands, history, preview and render as every processor; detectors and assistants that recommend and never apply; model identity and versions in the instance; inference on the device through the pinned port, never a remote fallback. | `packages/processors/src/ml/**/*.test.ts`, `packages/ml-runtime/src/**/*.test.ts`, `detection/*.test.ts`, `ml-locality.test.ts`, `tests/architecture/dependency-rules.test.ts`, `ml-golden.spec.ts`. |
| `REQ-AUDIO-139` ML Model Packs and Storage | Manifest with name, purpose, version, sizes, hashes, licence, compatibility and tier; download with progress, pause, cancel, retry and resume; import from a folder; integrity before use; removal and cleanup through the installer; pinned versions kept unless removed knowingly; update availability; no download on opening a project; the five conditions named as the requirement names them. | `manifest-reading.test.ts`, `install-state.test.ts`, `pack-installer.test.ts`, `http-pack-source.test.ts`, `integrity.test.ts`, `availability.test.ts`, `pack-conditions.test.ts`, `pack-folder.test.ts`, `pack-pins.test.ts`, `pack-cleanup.test.ts`, `pack-commands.test.ts`, `pack-manager-panel.test.tsx`, `ml-locality.test.ts`. |
| `REQ-AUDIO-143` Render Quality Policy | Maximum is the final render's default; the person chooses a named level or custom settings; every inference runs the pinned path, and no platform-native or faster path replaces the canonical render. | `quality-mode.test.ts`, `quality-commands.test.ts`, `processing-modes.test.tsx`, `onnx-runtime.test.ts`, `tests/inference-runtime.test.ts`. |
| `REQ-AUDIO-145` Processor Versioning and Reproducibility | Every instance persists its type, implementation and parameter schema versions and a model's identity; stretch, rate conversion and a converted paste persist the engine's algorithm version; an unknown version is refused; the render version is part of the preview cache's key. | `processor-version.test.ts`, `algorithm-versions.test.ts`, `edit-json.test.ts`, `chain-validation.test.ts`, `cached-stream-key.test.ts`. |
| `REQ-AUDIO-146` DSP Architecture Review Requirements | The review pass covered every listed concern (`reviews/phase-06-review.md`); the property harness, the allocation tests, the latency tests and the goldens hold them, exact where determinism permits. | `reviews/phase-06-review.md`, the `*.properties.test.ts`, `*-allocation.test.ts`, `*.golden.test.ts` and `rack-latency.test.ts` files. |
| `REQ-PROD-039` Third-Party Plugins (`DEFERRED`) | No third-party code is loaded; a processor is one `ProcessorType` in the build's catalogue, a boundary that admits a later sandboxed plugin without being one. | `tests/architecture/dependency-rules.test.ts`, `catalogue.test.ts`. |

The requirements this phase consumes from other phases are met as the packet
names them: `REQ-EDIT-014` (shared chains), `REQ-EDIT-012` (a chain on a
selection or the whole target), `REQ-EDIT-072` (the Inspector's processor
controls), `REQ-ARCH-004` (chains as project state), `REQ-ARCH-081` (canonical
renders, pinned inference), `REQ-ARCH-140` (a rack as a graph), `REQ-ARCH-141`
(Rust kernels behind the ABI), `REQ-ARCH-144` (latency and delay
compensation), `REQ-ARCH-157` (declared layouts), `REQ-ARCH-085` (a rate
changes only by conversion), `REQ-ARCH-088` (no remote processing),
`REQ-ARCH-153` (the install state machine), `REQ-REPO-187` (processor and
pack versions), `REQ-REPO-191` (no weights in Git), `REQ-STOR-166` (versions
in provenance), `REQ-STOR-195` (chains compared between states) and
`REQ-PRIV-161` (processor and model versions a bundle may name).

## Commits

Oldest first, on `phase-06-effect-rack`, from `563d5a4`:

- `62e0a53` Add canonical primitives and the FFT (DSP ABI 4)
- `bfcfdee` Model effect racks in the domain, format and commands
- `05ebe70` Run racks in the engine, its workers and the peaks
- `a3e334a` Let people choose render and preview quality
- `c6e0134` Run allocation tests apart and budget the wiring tests
- `03bad7e` Add the Phase 06 resume note
- `5aba08c` Add the core processors and the analysis crate
- `f25200b` Add repair, spectral, level and pitch processors
- `e97b8da` Add the detectors and the assistants
- `c1869a0` Add the local inference runtime
- `4177400` Add model packs: manifest, install, integrity and download
- `d0d46e2` Generate the third-party notices from the lockfiles
- `fe99c73` Let a whole pass wait, fail and carry audio
- `6330add` Add ML processors, DeepFilterNet 3 and the pack build
- `4c3676c` Add MossFormer2 and Spleeter, and start runs in time
- `0bed688` Count model packs in storage and bound downloads
- `53e559e` Analyse audio and apply what the assistants advise
- `cac8fc3` Take reads of a stateful source in turn
- `1783288` Cache preview renders and keep a chain library
- `fb3c512` Run model processors in the app; bound chain depth
- `4fd5a88` Amend ADR-0061 and ADR-0062 to the build
- `6089321` Add the rack, library and model-pack views
- `f958967` Add the DSP property and ML locality checks
- `a04b24f` Fix the rack commands, lead-in and DSP defects
- `51a0fbe` Bound the preview cache; guard workers and packs
- `823b008` Trim silence; hold ML goldens in every browser
- `fbc3eff` Keep rack sliders wide enough to use
- `7c891d1` Insert silence; stretch and convert a range
- `92b1a23` Check every TSDoc link resolves
- `84f9e1b` Start where no collator can be made
- `956f2f5` Bring the smoke and editing browser tests up to date

The commit that records this package, the review and the handoff follows, and
the integration commit is the merge into `main`.

## Reviewer findings and remediation

`reviews/phase-06-review.md` records the seven lenses, run by five reviewers
over `563d5a4..f958967`, their forty findings, and the disposition of each
with its commit. All eight `HIGH`, twenty-one `MEDIUM` and ten `LOW` findings
and the `NOTE` are fixed, in `a04b24f`, `51a0fbe` and `823b008`, each with a
test its author saw fail against the code it replaced unless the entry says
why none can. What the phase leaves to later phases is accepted with tracking
in the handoff capsule.
