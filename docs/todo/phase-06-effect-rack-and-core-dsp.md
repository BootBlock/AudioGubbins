> **Status:** In progress. 2026-10-07: the sixth session committed the
> chain depth bounds and the ML wiring in the application; each slice is
> committed with `verify:commit` green. Next is the views (see "Next").

# Phase 06 — Effect Rack and Core DSP

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-06-effect-rack-and-core-dsp.md`, and the
decisions that shape the work are `ADR-0060`, `ADR-0061` and `ADR-0062`.

## Where the work is

|        |                           |
| ------ | ------------------------- |
| Branch | `phase-06-effect-rack`    |
| Base   | `main` at `563d5a4`       |
| Head   | see `git log`, not pushed |

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
6. **Network.** Two modules fetch, each an adapter behind a port that sends
   nothing but its request: the model-pack download
   (`model-packs/src/adapter/http-pack-source.ts`) and the read of the
   inference runtime's WebAssembly from the application's own origin
   (`ml-runtime/src/adapter/origin-runtime-files.ts`). The network rule
   (ESLint and `tests/architecture`) names exactly these two.
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
    `state.values`, `measured` for a whole-pass processor, and `start`, the
    run's first stream frame, required on every node
    (`packages/processors/src/framework/processor-node.ts`).
11. **Whole-pass processors.** The rack measures each in signal order, one
    pass over the stream each, at a second sink tapped at its input; the
    measurement reaches the kernel as the `measured` setting; unmeasured, the
    kernel passes its input through.
12. **The engine's port.** `ChainProcessing.prepare(request, read)` in
    `packages/audio-engine/src/pcm/chain-processing.ts` answers a `ChainRun`
    (latency, layout, process, setParameter, release) for a run from
    `ChainRequest.start`; `partWayStart(request)` answers the lead-in and
    frame grid before it; the effect rack implements both
    (`chainProcessing(types)`). A chain of unknown latency is refused.
13. **App caches.** An app entry is rebuilt when a chain its plans name
    changes (`chainsNamed`), its rate is its plan's first stream's, and its
    peak revision is the plan's canonical JSON, so parameter values count.
14. **Part-way starts.** A descriptor states its `frameGrid`: the frames its
    kernel counts analysis frames or blocks in from its first frame (noise
    reduction, dereverberation and pitch shift their hop, de-click its
    detector block; 1 elsewhere, since a count that only decides when a sum
    is remade or a design taken changes nothing beyond rounding). A
    `partWayStart` answers the least common multiple over what a chain runs,
    and a preview starts at the grid point at or before its frame less the
    lead-in. A kernel learns its own stream frame as the run's start less
    its input's arrival (`PlanStep.inputArrival`), so a pass played back
    behind a late processor stays in time.
15. **State and measurement.** A processor's `state?: StateRequirement`
    is checked by `chainOutputLayout` at the stream's rate, by the check its
    kernel reads the state with. A `Measurer` is released on every path of a
    measuring pass, finished, refused, cancelled or failed; a failed
    measurement refuses the chain with its reason.
16. **Detectors and assistants.** The domain holds the data
    (`processing/audio-detection.ts`): a finding is a kind, an `EditRange`,
    its channels, a measure and a treatment; a treatment names processor
    types and values by key (and, for state, the range it is learned
    from), never instances, so nothing holds an identifier until a person
    applies it. `packages/processors/src/detection/` holds `AudioDetector`
    (open, and a `Detection` that is a `WholePass`: add, result, release), the six canonical
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
    one of the two network modules (credentials omitted, `Range` on resume; an
    ESLint rule refuses a local `declare const fetch` anywhere else), the
    installer (pins kept unless removed knowingly) and `availabilityOf`.
    It defines a `PackStore` port that the storage package implements
    (`ModelPackStore`, under `packs/`), so the dependency runs from
    storage to model-packs, the port inverted as G1 asks, rather than
    model-packs calling storage as ADR-0062 words it.
19. **ML processors are whole-pass processors** (2026-10-06): their pass is
    their inference, and their result is their output over the whole
    stream, which their kernel plays back. So a whole pass may wait and may
    carry audio, for every processor: `Measurer.add` answers a promise the
    rack awaits (backpressure, not a queue), `result` answers a
    `DomainResult` (a refused inference refuses the chain with its reason),
    and a `Measurement` is `readonly number[]` or a `Float32Array`, which a
    graph setting may carry in memory (`framework/whole-pass.ts`;
    descriptor reading refuses samples, `graph.setting-in-memory`, and a
    kernel refuses the other kind, `processor.measurement-kind`). An ML
    type is made with its
    inference port and a `ModelLibrary`; its descriptor is a constant. A
    model's identity hashes the listing of the files it runs, and the
    instance's version check compares it: `modelHashOf` (the domain, the
    hash given) over every file of the pack version, so availability checks
    it from a manifest (`AvailabilityContext.sha256`). Every quality runs
    pinned for now.
20. **Hashing.** The browser's streaming SHA-256 is `@noble/hashes`, as an
    adapter of model-packs' `Sha256` port (not the DSP module: hashing is
    not DSP). The runtime's WebAssembly is fetched from the application's
    origin by a second named network exception, verified, and handed to the
    runtime as bytes.
21. **Detection in the application** (2026-10-06): `packages/detection-runtime`
    runs the chosen detectors over a target's processed audio (the render and
    peaks reader, final quality, from the stream's start) in a worker, one
    detection at a time, a new request for a target superseding its old one,
    then the assistants; the page keeps 64 results by the asset's full
    content, the render settings, channels, range and assistants. The
    Analysis panel shows findings and recommendations; "Apply" makes the
    treatment chain (`treatmentChain`) in one history step through existing
    commands: a rack edit over the analysed range, or the target's rack for
    the whole target (an existing rack kept, the treatment after a copy of
    it). A processor type learns its state through `learner`. Findings are
    made from the audio heard; a learned state from the audio its processor
    receives: a range recommendation's from the target before its racks
    (`unrackedAssetPlan`, `unrackedRegionPlan`, the request's second
    description), a whole-target one's from the audio heard.
22. **Concurrent reads.** A source that keeps state between reads takes its
    reads in turn (`pcm/read-turns.ts`); the edited and resampled sources do,
    so every reader of a processed stream is covered. A read that fails or is
    cancelled part way leaves no half-caught-up run, half-added stretch frame
    or stale resampler position.
23. **The library** is per person: one storage directory per entry
    (`library/<id>/`, a rewritten pair of checked records), each the entry
    document (`audiogubbins.library-entry`, `processingLibrary` schema 1) in
    the chain's one form; an entry this build cannot use is listed with the
    reason; names are unique per kind as a reader hears them; every change
    holds the `lockLibrary` lock. `project.set-processor` changes one
    processor's settings (a preset). Applying a saved chain copies it per
    target, or shares one where asked, in one history step, and replaces a
    target's rack. Usage and cleanup leave the library out (REQ-STOR-200 and
    106 name no category for it).
24. **The preview worker** (`audio-engine/src/preview/`,
    `audio-runtime/src/preview/`) holds the cached preview producer; the
    feeder, the peak worker and the detection worker each read renders
    through their own channel to it. ADR-0061 says the render worker makes
    the cached render: to amend, since the render worker is a pool thread
    per job and the cache outlives jobs and serves three workers.
25. **The cache key and bound.** The key is a canonical text of the render
    version, the quality settings, the stream with each later stream it
    reads written in place, the chain without identifiers (values, state,
    versions, model identity), and each file by `MediaEntry.identity`, rate,
    channels and length. Renders are kept in memory, 512 MiB, least recently
    used first, two made at once; a held render is never evicted; a render
    that cannot fit is declined before it takes memory and the reader runs
    the chain itself. The storage cache client cannot serve it (no ranged
    read, no append, no per-key eviction or recency). A read past a render's
    progress waits; it never answers silence.
26. **Listening.** `ChainProcessing.listening()` answers "live" or
    "rendered, because ..." (a whole-pass or non-real-time processor), with
    the lead-in and frame grid: one rule shared with running changes. Peaks
    and detection read every processed stream from a render. A parameter
    change is a project command; playback follows the catalogue
    (`runningChanges` reach `ChainRun.setParameter`); a rendered chain
    refuses it and playback reloads where it plays, remaking the render.

27. **ML in the application** (2026-10-07). One inference worker per runtime
    configuration for the whole page (`InferenceHost`), started on its first
    connection. Every thread that runs chains (preview, render, feeder, peak,
    detection) is started by `ModelServices.startChainWorker`, which gives it
    a `ModelChannel`; per configuration the thread opens a `MessageChannel`
    straight to the inference worker, so a tensor crosses once. A worker
    serves at most 32 channels (`MOST_CONNECTIONS`); terminating a thread
    lets go of its channel. Model files are read thread to page to storage
    worker by `installedModelFiles`, the hash taken while reading. The build
    serves onnxruntime-web's two `.wasm` files under
    `inference/onnxruntime-web-<version>/` and states their SHA-256 from the
    shipped bytes (`apps/web/inference-runtime.ts`); the build-output check
    hashes them again. COOP/COEP stay development-only: an unisolated page
    offers one thread, and a threaded preview is refused with its reason.
    Packs are served under `<base>packs/` in development from
    `AUDIOGUBBINS_PACK_CACHE`, and copied into a build only with
    `AUDIOGUBBINS_PACKS_IN_BUILD=1`; the output check refuses a file under
    `packs/` that no defined pack holds. The page's `AvailabilityContext`
    (`nobleTextSha256`, the build's runtime, the device) makes the model gate
    every entry is made with (`ShellContext.modelGate`, the A/B audition
    included): a processor that cannot run leaves its entry unopened with
    REQ-AUDIO-139's condition, and the project stays valid. A browser with no
    pack storage, or a device that runs no pack, is "device unavailable".
    `projectPackPins` reads current state, history, journal, checkpoints and
    every backup generation one file at a time, over the walk the media
    search shares (`project-roots.ts`), and fails safe (every pack kept).
    Pack removal goes through the installer (REQ-ARCH-153); cleanup handles
    its busy and pinned refusals by code and fails on any other.

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

Fifth session, 2026-10-06, committed as "Let a whole pass wait, fail and
carry audio" (`fe99c73`, decisions 19 and 20) and then the ML processor
framework, DeepFilterNet 3 and the pack build tool, each with
`verify:commit` green:

- `packages/processors/src/ml/`: the `ModelLibrary` port (bytes with the
  SHA-256 taken while reading), `openModel` (one pinned session per graph
  per pass, released on every path), the model pass (fixed chunks, the
  canonical resampler in and out, version 1), the playback kernel, and a
  bound of 2^26 output samples (`processor.model-output-too-long`).
- DeepFilterNet 3 (`ml/deepfilternet/`): libDF's STFT (960 through a
  Bluestein DFT on the canonical FFT), features, three graphs (opset 12,
  stateless), ERB gains, deep filter, post-filter and attenuation limit;
  chunks of 1,000 frames each heard after a 400-frame warm-up, normalisation
  restarted per run, cut at the chunk edge; graph optimisation `extended`
  (every level gave the same bits). Against a numpy port on Python
  onnxruntime: 1.2e-7; against DeepFilterNet's own whole-stream output:
  55 dB, the difference being the chunk joins. Pinned golden
  `81fdbd5f…` (`pnpm test:ml-golden`, not in `verify:commit`).
- `tools/model-packs/`: pack definitions (sources pinned by commit and
  hash, every made file's hash), the export scripts with a hash-pinned
  Python environment (CPU torch 2.9.1), and `build-packs.mjs`
  (`pnpm packs:build`, `pnpm packs:check`), writing outside the repository.
  All three exports reproduced the research hashes byte for byte. Each pack
  carries its licence texts and a NOTICE. The tool's download is the build
  tooling's one network exception.
- The start frame reaches every kernel (decisions 10, 12, 14), which also
  fixed a pass played back behind a late processor; the identity covers
  every file of a pack (decision 19).
- MossFormer2 SE 48K (`ml/mossformer2/`): the Kaldi fbank with deltas, the
  mask on the 1,920-point STFT, ClearerVoice's 4 s window and 3 s stride
  with 0.5 s edges dropped, fixed for every length; graph optimisation
  `basic`; no dither (the original's dither of 1.0 is random per run).
  Against ClearerVoice's own decode on Python onnxruntime: 85 dB, the
  difference being the runtime. Golden `1c5ee7d0…`; about 0.7 times real
  time per channel on one thread.
- Spleeter 2 and 4 stems (`ml/spleeter/`): STFT 4096/1024, ratio masks,
  zero above bin 1024 (`mask_extension: zeros`), one frame of leading
  silence as Spleeter 1.5.4 and later pad, its own butted 512-frame
  segments, a `stem` choice; mono fed to both channels and averaged.
  Against Spleeter's TensorFlow graph: 4.2e-7 (2 stems), 1.4e-5 (4 stems).
  Goldens `08287bb3…` and `2dcfafa8…`.
- One mechanism each across the packs: `ChunkSchedule` (`chunk`, `before`,
  `after`, `firstChunk`) holds every model's runs, `scheduled-input.ts`
  gathers the sample-based ones, `real-dft.ts` and `spectrum.ts` are in
  `ml/`, `modelDescriptor()` states what every ML descriptor shares, and
  the goldens share `testing/pack-cache.ts` and `golden-render.ts`. All four
  goldens were unchanged by it.

Sixth session, 2026-10-07, committed the chain depth bounds and the ML
wiring together (the media search's walk, which the depth bound changed, moved
into `project-roots.ts` for the pack pins, so the files did not allow two
commits), with `verify:commit` green:

- Decision 27, and the depth bounds in the open points below.
- `tools/local-traces.mjs` holds the traces of the machine that the
  build-output check and the notices tool both look for, and
  `ml-runtime/src/channel-worker-port.ts` the channel's adapter to an
  `InferenceWorkerPort`: each broke an import cycle.
- The project catalogue takes an `Observable<ModelGate>` (`modelGates`),
  so the state part does not import the ML part.
- A detector's findings, the pack pins' walk and the media search's walk
  add one value at a time (`storage/src/nested-values.ts`): a spread of an
  unbounded list overflowed the stack. Each was proved by a test of a
  million values against the old code.
- The contract test's path pattern no longer takes a URL's scheme for a
  drive.
- Every test the wiring added was seen to fail against a mutation.

Open points from `ml-runtime`:

- Closed (decision 20): the adapter reads the runtime's WebAssembly through
  a `RuntimeFiles` port, checks it against the setup's digest
  (`inference.runtime-file-mismatch`), and gives it as `wasmBinary`; a run
  in Node and in Chromium showed the runtime then requests nothing itself
  (`onnxruntime-web/wasm` is the bundle with its glue; a threaded preview's
  workers load that bundle again). Closed (decision 27): the build states
  both files' digests and serves them; COOP/COEP stay development-only.
- A refused setup or a malformed page message reaches the inference
  worker's `reportError`, which the host takes as the worker failing, so it
  ends the worker for every thread on it. Not checked: whether the PWA
  precache takes the runtime's `.wasm` files and copied packs; a threaded
  preview refused on a host without COOP/COEP has no test.
- The runtime sorts a failure into "runtime unavailable" or "model
  refused" by its message text, the only signal it gives.
- A WebGPU preview may run some operators on the CPU and still report
  WebGPU; it is a preview, so it is disclosed as one.
- Closed: `THIRD-PARTY-NOTICES.md` is generated from the committed
  lockfiles (`tools/sync-third-party-notices.mjs`, the production closure
  of `apps/web` and the crates linked into the WebAssembly) and checked by
  `pnpm run lint`, which refuses a shipped licence off its allow-list.

Open points from `model-packs`:

- Closed (decision 27): the thread entries build the ML types
  (`processorTypesWith`) over a `ModelChannel` and the installed packs.
- The resampler's version (`CANONICAL_RESAMPLER_VERSION = 1`) is stated in
  processors; it belongs to the engine.
- A parameter change of an ML processor while playing is refused: it needs
  a new pass.
- Closed: ported source is credited from `tools/ported-code-notices.json`
  (DeepFilterNet, ClearerVoice-Studio, torchaudio, Kaldi, PyTorch,
  Spleeter), rendered into `THIRD-PARTY-NOTICES.md` and checked by
  `notices:check` (paths exist, licences on the allow-list).
- Closed (decision 27): the built packs are served from the application's
  origin. Left for the pack-manager view: no command installs a pack yet,
  so `virtual:audiogubbins/model-packs` (`PACK_CATALOGUE`) has no consumer,
  and the browser run with a request log waits for it.
- Closed (decisions 24–26): a whole pass runs once per preview render, and
  waveforms of racked audio read a render.
- Closed (decision 27): the page builds its `AvailabilityContext`.
- Closed: every JSON depth bound a chain passes through derives from
  `WRITTEN_CHAIN_DEPTH` plus what holds it (plan +4, operation +1, asset
  +2, asset record +1): command arguments 45, the project document and tree
  files 47; the media search uses the record reader's bound; each reader is
  pinned by a test building the deepest chain. `addChain` and `removeChain`
  say what they do. Left: `SHALLOW_RECORD_DEPTH` (32) is a hand-picked
  floor for records that hold no chain; `clipboard-commands.ts` has no test.
- Other tabs are not told when the library changes; the library view must
  re-read on focus or listen on a broadcast channel.
- Preview renders are in memory, not on disk; the preview worker uses the
  reference DSP; a running change is heard after the feeder's read-ahead;
  nothing measures live cost, so a too-costly live chain never moves to a
  render. No interface yet makes a whole-pass rack, so the cached mode has
  no browser test.
- The range-or-whole choice of a recommendation is made in two files
  (`detection-control.ts`, `analysis-commands.ts`); it should have one
  authority.
- Closed: `nobleSha256` (`@noble/hashes` 2.4.0, MIT; Cure53 audited 1.0.0
  only) implements the `Sha256` port; `LOCAL_INFERENCE` and
  `localInferenceCapabilities` are exported from `packages/capabilities`.
- Closed: storage usage counts installed packs and partial downloads
  apart (manifests and seal records only, never a model file); cleanup
  offers partial downloads as safe, lists installed packs, and removes one
  only when the person names it, never a pinned one, saying why. One pack
  download at a time per installer (`DownloadSlot`), waiting in an explicit
  `queued` install state that can be paused or cancelled;
  `PackStore.transferring` shares the storage-wide lock while a transfer
  writes. The worker composes `ModelPackStore`.
- Closed (decision 27): a project needs every pack version a processor
  instance names in its current state, its history, its snapshots or its
  backups (`projectPackPins`), and cleanup removes a pack through the
  installer.
- The download bound is per installer, not across tabs; an import from a
  file waits in the same slot; storage-pressure relief does not yet take
  partial downloads; `PackStore.transferring` is not in the store contract
  tests.
- The dereverberation allocation tests failed once under the whole
  suite's load and passed on the next run; watch for a repeat.

Next, in order (2026-10-06):

1. The views, through project commands only: rack and processor views in
   the editor and the Inspector (which also lets the cached preview mode be
   tested in a browser), the library view (re-read on focus or a broadcast
   channel), applying a saved chain to several targets, A/B and
   processed/original comparison, and the model-pack manager view with the
   commands that install, pause, resume and remove a pack (the consumer of
   `PACK_CATALOGUE`). Then the ML browser run: `pnpm build` with
   `AUDIOGUBBINS_PACKS_IN_BUILD=1`, install DeepFilterNet 3 from the
   application's own origin, hear a chain holding it, and save screenshots
   and every request the page makes (only the app's and the pack's files).
2. Amend ADR-0061 (decision 24: the preview worker makes the cached
   render) and ADR-0062 (the `queued` install state, the runtime's
   WebAssembly read and checked as bytes), with `spec:verify` and
   `CHECKSUMS.sha256`.
3. Scripts `test:dsp-property` and `test:ml-locality` (no request carrying
   audio, project data or derived content); the phase's browser test
   (apply a chain to a selection, give a region a rack, reload, hear the
   same project); gates; ONE review pass with the packet's seven lenses
   after committing; evidence, review, ledger PASS, handoff
   `traceability/handoffs/phase-06.md`, README readiness; land (merge main
   into the branch, `verify:commit`, `merge --no-ff` from the primary
   checkout, push, remove the worktree, `git branch -d`, delete the briefs
   folder); `gambit_record_change` for the user-visible changes (quality
   settings and the transport's quality lines, the Analysis panel, the
   storage panel's pack rows and cleanup, the cached preview in the
   processing modes, and the views).

Known limits of the ML packs: Spleeter's butted segments leave a
measurable seam at each join (RMS difference 0.016 near joins against
0.0095 elsewhere on a 0.13 signal), as Spleeter's own pipeline does;
DeepFilterNet 3's chunk joins restart its recurrent state (55 dB against a
whole-stream run); each channel runs the model in turn, so stereo costs
twice mono.

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
