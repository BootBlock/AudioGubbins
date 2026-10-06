> **Status:** In progress. 2026-10-05: the branch is made and the work is
> sliced; the slices below are built in order, each with `verify:commit`
> green before it is committed.

# Phase 06 — Effect Rack and Core DSP

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-06-effect-rack-and-core-dsp.md`, and the
decisions that shape the work are `ADR-0060`, `ADR-0061` and `ADR-0062`.

## Where the work is

|        |                        |
| ------ | ---------------------- |
| Branch | `phase-06-effect-rack` |
| Base   | `main` at `563d5a4`    |

## Gates

Light gates (owner decision, 2026-09-28): whole Vitest, both tsc, lint
(`pnpm run verify:commit`), one review pass with every lens the packet names,
fix its findings, land. The packet's commands are root scripts; this phase adds
`test:dsp-property` and `test:ml-locality`.

## Decisions taken in the build

These settle what the ADRs leave to the implementation. None changes an ADR.

1. **The chain.** `EffectChain` holds `slots`, each a `ProcessorInstance` or a
   `ParallelGroup` (`kind`), each with its own `enabled`, `soloed` and `mix`
   (the wet share, 0 to 1, linear). A group's branches are lists of slots,
   summed by its law: `sum`, `mean` or `equal-power` (1/√n). Solo is decided
   within the list that holds the slot. A processor instance carries its
   `ProcessorStateVersion` (implementation, parameter schema, and a model's
   identity or a resampler's version where one applies) and, where it has
   any, its non-parameter state, versioned with it.
2. **The plan.** A `PlanStream` may state `processing`: a chain, rendered over
   the stream from its own start with its latency compensated and its tail
   cut, or a stretch to a stated length. A segment reads a stream's processed
   output, converted where the rates differ, as before. A rack edit over a
   range moves that range's segments into a new stream at place 1, renumbering
   the rest, so a segment still reads only a later stream. The asset's rack
   wraps the whole first stream the same way; a region's plan reads its span
   of that and its rack wraps the result (`ADR-0060`'s order).
3. **Operations.** A rack edit is `{ kind: 'rack', chain }`, a `RangeEdit` of a
   `process` operation or of a region's processing; it acts on every channel.
   `stretch` changes a range to a stated length, and `convert-rate` converts
   the whole asset; both carry positions by their exact ratio.
4. **Running a chain.** `packages/effect-rack` realises a chain as a graph of
   the engine (`audio-graph`), its processors as node types, wet and dry as
   gain and mix nodes, so the graph's latency analysis and delay compensation
   align every path. The engine reads a processed stream through a port it
   is given, so it depends on no processor.
5. **Canonical arithmetic.** The new primitives and the FFT are in
   `crates/dsp-core` and the reference path; processor kernels are TypeScript,
   calling the reference primitives directly and the FFT through
   `CanonicalDsp`; `crates/analysis` holds the STFT, measurement and detectors.
6. **Network.** The model-pack download is the one place that fetches; it is
   an adapter behind a port, and the rule that forbids network calls names it
   as its one exception.
7. **Plans can fail.** `assetPlan(asset, context, processing)` and
   `regionPlan(asset, region, context, resolver)` take a `PlanContext`
   (`chains`, `catalogue`) and answer a `DomainResult`: a rack whose chain the
   catalogue refuses makes the entry unavailable with the reason. A range
   rack edit must keep the layout; a target's rack may change it.
8. **Validation names chains.** `validateOperation`, `validateChain` and
   `validateRegion` take the project's chains; a rack edit, an asset's rack
   and a region's rack must name one. The catalogue check (types, versions
   and layouts) is `chainOutputLayout`, run by plan building only; the project
   document checks shape only (`validateChainShape`). Commands do not refuse
   what the catalogue refuses (changed 2026-10-05): such a plan is an
   unavailable entry with its reason, a state a document from another build
   may hold, and a command that refused it could not be undone (the random
   command walk found this).
9. **Persisted form.** A chain is written by `chain-writing.ts` and read by
   `chain-reading.ts` (project-format), the one form for a project, a plan's
   processed stream, the library and the clipboard. Schema versions:
   `projectDocument` 3, `projectStorage` 7.
10. **Processor node encoding.** A processor runs as node type
    `processor.<typeKey>` with ports `input`, optional `side-chain`, and
    `output`; settings `parameter.<key>`, `quality.<setting>`, `state.kind`,
    `state.values`, and `measured` for a whole-pass processor
    (`packages/processors/src/framework/processor-node.ts`).
11. **Whole-pass processors.** The rack measures each in signal order, one
    pass over the stream each, at a second sink tapped at its input; the
    measurement reaches the kernel as the `measured` setting; unmeasured, the
    kernel passes its input through.
12. **The engine's port.** `ChainProcessing.prepare(request, read)` in
    `packages/audio-engine/src/pcm/chain-processing.ts` answers a `ChainRun`
    (latency, layout, leadIn, process, setParameter, release); the effect
    rack implements it (`chainProcessing(types)`). A chain of unknown latency
    is refused.
13. **App caches.** An app entry is rebuilt when a chain its plans name
    changes (`chainsNamed`), its rate is its plan's first stream's, and its
    peak revision is the plan's canonical JSON, so parameter values count.
14. **Part-way starts.** A descriptor states its `frameGrid`: the frames its
    kernel counts analysis frames or blocks in from its first frame (noise
    reduction, dereverberation and pitch shift their hop, de-click its
    detector block; 1 elsewhere, since a count that only decides when a sum
    is remade or a design taken changes nothing beyond rounding). A
    `ChainRun` answers the least common multiple over what it runs, and a
    preview starts at the grid point at or before its frame less the lead-in.
15. **State and measurement.** A processor's `state?: StateRequirement`
    is checked by `chainOutputLayout` at the stream's rate, by the check its
    kernel reads the state with. A `Measurer` is released on every path of a
    measuring pass, finished, refused or failed.
16. **Detectors and assistants.** The domain holds the data
    (`processing/audio-detection.ts`): a finding is a kind, an `EditRange`,
    its channels, a measure and a treatment; a treatment names processor
    types and values by key (and, for state, the range it is learned
    from), never instances, so nothing holds an identifier until a person
    applies it. `packages/processors/src/detection/` holds `AudioDetector`
    (open, add, findings, release, as a `Measurer`), the six canonical
    detectors on `crates/analysis`'s features and the three assistants
    (classification, restoration, repair), which recommend steps in one
    order and apply nothing. Running a detection over a stream is the
    application's, in a worker.
17. **Local inference.** `packages/ml-runtime` holds the inference port
    (no browser global), `InferenceOptions` (pinned: WebAssembly, fixed
    SIMD, one thread, full precision, a stated optimisation level, never a
    fallback; or preview, which says so), the adapter over
    `onnxruntime-web` 1.30.0, imported only by `import()` and only in the
    adapter (cruise rules), and the inference worker with its client, one
    worker per runtime configuration. `packages/capabilities` probes
    fixed-width WebAssembly SIMD and states `LOCAL_INFERENCE`.
18. **Model packs.** `packages/model-packs` holds the manifest and its one
    validating reader, the pure install state machine (update available
    and incompatible are availability, not states), integrity through a
    streaming `Sha256` port, the `PackSource` port and its HTTP adapter,
    the only network module (credentials omitted, `Range` on resume; an
    ESLint rule refuses a local `declare const fetch` anywhere else), the
    installer (pins kept unless removed knowingly) and `availabilityOf`.
    It defines a `PackStore` port that the storage package implements
    (`ModelPackStore`, under `packs/`), so the dependency runs from
    storage to model-packs, the port inverted as G1 asks, rather than
    model-packs calling storage as ADR-0062 words it.

## The first model packs' sources (researched 2026-10-05)

None is blocked. Every graph below loaded and ran in onnxruntime-web 1.30
on WebAssembly, one thread, fixed-width SIMD, with standard `ai.onnx`
operators only.

- **DeepFilterNet 3** (MIT or Apache-2.0, repository `LICENSE` and README):
  the ONNX is in `models/DeepFilterNet3_onnx.tar.gz` of
  `github.com/Rikorose/DeepFilterNet` at `d375b2d8`; `enc.onnx`,
  `erb_dec.onnx`, `df_dec.onnx` (opset 12, stateless, about 8.6 MB). The
  48 kHz STFT (960, hop 480, Vorbis window), the ERB and spectral features,
  their running normalisation, the two-frame feature shift and the deep
  filter are outside the graph, ported from `libDF`. Chunked offline with a
  warm-up overlap; about 0.11× real time.
- **MossFormer2 SE 48K** (Apache-2.0, model card and repository):
  `last_best_checkpoint.pt` from `huggingface.co/alibabasglab/MossFormer2_SE_48K`
  at `eff8c979`, exported with ClearerVoice-Studio's code at `6b3774dc`
  (opset 17; the rotary cache must be off before export); 228.6 MB,
  `fbanks [1,T,180]` to `mask [1,T,961]`; Kaldi fbank with deltas outside the
  graph; about 1.3× real time on one thread.
- **Spleeter 2 and 4 stems** (MIT; Deezer's release post says the models are
  MIT-licensed): v1.4.0 TF checkpoints, exported to one ONNX per pack (78.6
  and 157.3 MB), `x [2,S,512,1024]` magnitudes to one magnitude per stem;
  44.1 kHz STFT 4096/1024, ratio masks, above 11 kHz dropped as the models
  do; checked against TensorFlow to 7e-8 on the waveform.
- The export scripts, checks and the files are in the scratchpad
  (`C:/Users/<user>/AppData/Local/Temp/ag6/ml/`), not in the repository
  (`REQ-REPO-191`); a pack build tool fetches and checks them by hash.

## Slices

1. Canonical primitives and the FFT (Rust, reference, ABI 4).
2. Domain: the chain, descriptors, versions, the rack edit, target racks,
   stretch and rate conversion, the processed stream, validation, the oracle.
3. Project format and history: chains, racks, operations, the library format.
4. Project commands: rack and processor commands, shared chains, applying a
   saved chain to several targets.
5. `crates/analysis` and its reference: STFT, peak, loudness, detectors.
6. `packages/processors`: the framework and every processor of WU-06.B and
   WU-06.C.
7. `packages/effect-rack` and the engine's processed stream; `QualityMode`;
   the cached preview producer; preview with lead-in.
8. `packages/ml-runtime` and `packages/model-packs`; the first packs.
9. Assistants on the detectors; the clipboard's chain payload.
10. The application: rack and processor views, the library, A/B and
    processed/original comparison, quality disclosure, the pack manager.
11. Inherited debt (F-07's remnants, the timed-out tests).
12. Scripts, the browser test, gates, the review, evidence, ledger, handoff,
    landing.

## Progress

| Slice      | Commit    | What                                                   |
| ---------- | --------- | ------------------------------------------------------ |
| 1          | `62e0a53` | Add canonical primitives and the FFT (DSP ABI 4)       |
| 2–4        | `bfcfdee` | Model effect racks in the domain, format and commands  |
| 6–7 (part) | `05ebe70` | Run racks in the engine, its workers and the peaks     |
| 7 (app)    | `a3e334a` | Let people choose render and preview quality           |
| 11 (part)  | `c6e0134` | Run allocation tests apart and budget the wiring tests |

Second session, 2026-10-05 (16:00 to 18:00), committed as above with
`verify:commit` green (6,753 tests):

- `pcm/stretched-content.ts` on the engine's new `dsp/phase-vocoder.ts`
  (identity phase locking, canonical FFT and trigonometry), which a pitch
  shift reuses; the stretch's tests and a plan-level test.
- `QualityMode` replaces `RenderQualityProfile` end to end: render request
  and message, the feeder's `sources` message and the peak worker's `open`
  message carry a mode, read by the domain's `qualityModeFrom`; render and
  peaks run at `finalRenderSettings` from the stream's start, the feeder at
  the preview mode from part way. The thread entries make
  `chainProcessing(PROCESSOR_TYPES_BY_KEY)`; a cruise rule keeps the rack to
  `src/threads/`. The app: audio settings schema 2 (render and preview
  quality), quality commands, the settings controls, the processing-modes
  view, playback reloading at a new preview quality, peaks revised by the
  render quality.
- The random command walk covers the chain and rack commands; commands no
  longer check plans against the catalogue (decision 8).
- Inherited debt, part: the walk, the golden render and the lint exclusion
  test (and the keyboard wiring tests the new commands slowed) have time
  budgets; the allocation tests run as their own project in a later group,
  since under the whole suite's load V8 left reference primitives
  unoptimised for 20 s and more.

Third session, 2026-10-05 (18:00 to 23:00). Committed as `5aba08c`
("Add the core processors and the analysis crate"), `verify:commit` green
(8,202 tests):

- Processors of groups A, B and C (filters and equalisation, dynamics,
  time and space), in the catalogue in category order; a node must list
  `input` before `side-chain`; the limiter reads the engine's `besselI0`.
- `crates/analysis` and its reference: STFT, peak (the BS.1770-4 Annex 2
  table, checked against the published Recommendation), loudness, and the
  six detector features; DSP ABI 5.
- F-07's remnants: `quoted` and `timeOfDay` in the text package (ADR-0018
  amended), read by the engine's packages, storage, the clipboard, the
  storage runtime and the application; usage measurement uses
  `projectsIn`. `packages/text` is portable.
- The `processors` test project runs in its own later group, and the
  allocation tests after it.
- V8 boxes a double a function returns to a caller it was not inlined
  into, and under load it sometimes does not inline a mid-sized primitive,
  so a kernel allocated a number a sample. Rule now: on a per-sample path a
  double crosses a call only through a `Float64Array` slot or from a
  function small enough that V8 always inlines it (the reference DSP and
  every kernel follow it).

Fourth session, 2026-10-06, committed as "Add repair, spectral, level and
pitch processors" with `verify:commit` green:

- Groups D1 (de-click, de-pop), D2 (noise reduction with a learned profile,
  dereverberation by online WPE), E (peak and loudness normalisation on
  `level/level-gain.ts`, which the gain processor uses too) and pitch shift
  (`pitch/`, the engine's `dsp/phase-locking.ts`), all in the catalogue;
  `catalogue.test.ts` holds one entry per key and the category order.
- Decisions 14 and 15. The tests: a chain with a noise reduction with no
  profile, or one learned at another rate, is refused; a failed measuring
  pass frees its meters; a preview starts on the grid (`processed-content`
  test); noise reduction and de-click give the canonical bits on their grid
  and not off it, and dereverberation settles on it and not off it. Each
  was seen to fail against a mutation.
- One test runner: `runProcessor` takes `state` and a `Change`
  (`runWithChange`, `runStateful` and `spectral-run.ts` are gone); the
  property harness takes `state` per layout and values and checks the
  state changes the output, so D2's duplicated property checks are gone.
  With a profile, noise reduction is bounded at 4, as the other cut-only
  filters are: a full-scale square losing harmonics rings 4.4 % past full
  scale.
- D2 windows by the engine's `vocoderWindow`; the dereverberation golden
  was re-recorded (its two independent checks hold), the noise reduction
  golden did not change.
- The browser-global rule no longer reads a member called `window` as the
  global.

Then, committed separately with `verify:commit` green: the detectors and
assistants (decision 16), and `packages/ml-runtime` (decision 17).

Open points from `ml-runtime`:

- The runtime's identity hash is the caller's statement; nothing checks it
  against the WebAssembly file the runtime loads. Better: the application
  fetches the file from its own origin, verifies its hash, and gives the
  bytes to the runtime (`wasmBinary`), so the hash is of what runs and the
  runtime makes no request of its own.
- The runtime sorts a failure into "runtime unavailable" or "model
  refused" by its message text, the only signal it gives.
- A WebGPU preview may run some operators on the CPU and still report
  WebGPU; it is a preview, so it is disclosed as one.
- `NOTICE` names `THIRD-PARTY-NOTICES.md`, "generated from the committed
  lockfiles", which neither exists nor has a generator, and no phase owns
  it. This phase is the first to ship third-party runtime files
  (`onnxruntime-web`, MIT, and its MIT, Apache-2.0, ISC and BSD-3-Clause
  dependencies) to the browser, so it adds the generator and the file.

Open points from `model-packs`:

- No browser streaming SHA-256 exists yet: Web Crypto hashes only a whole
  buffer. The application needs one (the `sha2` crate in the existing
  WebAssembly module, or a vetted library).
- `LOCAL_INFERENCE` is not exported from `packages/capabilities`' entry,
  and the application needs it.
- Storage usage and the cleanup plan do not yet count `packs/`.
- Downloads are one file at a time per pack, with no bound across packs.
- The dereverberation allocation tests failed once under the whole
  suite's load and passed on the next run; watch for a repeat.

Next, in order: the three packs, the application's detection worker and
the rest of "Remaining" in the session handover.

Known limits the agents stated: de-click repairs a click whose context
holds another from corrupted context; de-pop lowers music below its
frequency during a pop; a QR sign-flip mutation in `autoregressive.ts`
survived (numerical only); pitch shift's Draft quality (overlap 2) may
ripple up to 3 dB. Pitch shift's frame grid has no sample-level test: a
part-way start gives each partial another constant phase by design.

Limits of `crates/analysis`'s extractors the detectors work around (each a
change to a Rust detector, its reference and the ABI): `hum.rs` leaves out
only 5 bins around a peak, so a loud hum's own side lobes set its floor and
its margin stops near 40 to 50 dB; `clipping.rs` applies its minimum run
within a block, so the detector runs it at 1 and joins runs across block
edges itself; `noise_floor.rs` reports level only, so a steady tone is told
from noise by a −30 dBFS ceiling rather than by spectral flatness;
`transients.rs` sums linear magnitudes, so a loud steady bass dominates its
flux.
