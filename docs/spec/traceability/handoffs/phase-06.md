# Phase Handoff Capsule — Phase 06

## Capability Delivered

AudioGubbins processes a project's audio through effect racks. A chain of
processors, in series and in parallel groups, each with its own bypass, solo
and mix, is applied to a selected range, or given to an asset or a region as
its rack over the whole target, and the edit plan runs it, so the plan is still
the only description of an edited sound (`ADR-0060`). Chains are shared between
targets or made independent, copied and pasted, saved with presets to the
person's library and applied to several targets in one history step, and every
change is a project command with its inverse. Twenty-two canonical processors
cover level, equalisation and filtering, dynamics, delay, reverb, pitch,
ambisonics and restoration, each the same bits from the WebAssembly DSP as from
the reference (`ADR-0061`); time stretching, rate conversion and inserted
silence are edit commands. Preview is live where a chain allows and from a cached render where
it does not, at a preview quality chosen apart from the render quality, and the
person hears the processed or the original sound and either side of an A/B
comparison. Optional model packs, downloaded or imported, verified and
removable, run DeepFilterNet 3, MossFormer2 SE 48K and Spleeter on the device
through a pinned inference runtime, with no remote fallback (`ADR-0062`).
Detectors and assistants analyse a target and recommend a chain, or silence to
remove, which the person applies.

## Requirements Satisfied

Each owned requirement is mapped to its implementation and its evidence in
`reviews/phase-06-evidence.md`, under "Requirement-to-evidence mapping". Parts
of `REQ-AUDIO-017` and `REQ-AUDIO-018` come with later phases, as recorded
below.

- `REQ-AUDIO-017`
- `REQ-AUDIO-018`
- `REQ-AUDIO-019`
- `REQ-AUDIO-080`
- `REQ-AUDIO-086`
- `REQ-AUDIO-138`
- `REQ-AUDIO-139`
- `REQ-AUDIO-143`
- `REQ-AUDIO-145`
- `REQ-AUDIO-146`
- `REQ-PROD-039` (`DEFERRED`): no third-party code is loaded, and the boundary
  a later phase would extend is the processor type.

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them; two differ in name:

- The packet's `EffectRack` is `chainProcessing(types)` in
  `@audiogubbins/effect-rack` (`packages/effect-rack`), which implements the
  engine's `ChainProcessing` port
  (`packages/audio-engine/src/pcm/chain-processing.ts`): `prepare` answers a
  `ChainRun` (latency, layout, process, `setParameter`, release), and
  `listening` how the chain is heard, live or rendered with the reason, with
  its lead-in and frame grid.
- The packet's `MLProcessorCapability` is `LocalInferenceCapabilities`,
  answered by `localInferenceCapabilities`, with the `LOCAL_INFERENCE`
  requirement, in `@audiogubbins/capabilities`.

And by package:

- `@audiogubbins/domain`: `EffectChain` with slots (`ProcessorInstance`,
  `ParallelGroup`), `ProcessorDescriptor`, `ParameterDescriptor`,
  `ProcessorStateVersion`, `ProcessorCatalogue`, `QualityMode`, `RackEdit`,
  `Asset.rack` and `Region.rack`, the `stretch` and `convert-rate` operations,
  the plan's silence source (`silencePlan`, `planIsSilence`),
  `PlanStream.processing`, `LibraryEntry`, the detection data, the treatment
  chain, chain listening, and the one structured-clone field reader.
- `@audiogubbins/effect-rack` (new): `chainProcessing`.
- `@audiogubbins/processors` (new): `ProcessorType`, the catalogue
  (`PROCESSOR_TYPES_BY_KEY`, `processorTypesWith` for the ML types),
  `AudioDetector`, the detectors and `CANONICAL_ASSISTANTS`, the `ModelLibrary`
  port.
- `@audiogubbins/ml-runtime` (new): `InferencePort`, `InferenceOptions`, the
  inference worker, its host and the model channel.
- `@audiogubbins/model-packs` (new): `ModelPackManifest`, the install state
  machine, the `PackSource`, `PackStore` and `Sha256` ports, the installer and
  availability.
- `@audiogubbins/detection-runtime` (new): the detection worker.
- `@audiogubbins/audio-engine`: `ChainProcessing`, `ChainRequest`, `ChainRun`,
  the processed and stretched sources, the preview producer and its cache.
- `@audiogubbins/project-format`: the chain's one persisted form and the
  library entry; `@audiogubbins/project-commands`: the rack, slot, processor and
  shared-chain commands; `@audiogubbins/storage`: `ModelPackStore`, pack pins
  and the processing library; `@audiogubbins/clipboard`: the chain payload;
  `@audiogubbins/text`: `quoted` and `timeOfDay`.

## Persisted / Interchange Formats

- The project document, `projectDocument` version 6, and project storage,
  `projectStorage` version 10: chains in their one form, rack edits, the racks
  of assets and regions, stretch and rate conversion with the engine's
  algorithm versions, a converted paste's resampler version, and generated
  silence.
- The person's library, `processingLibrary` version 1: one directory per entry
  (`library/<id>/`), each an `audiogubbins.library-entry` document holding a
  chain or a preset in the chain's one form.
- Audio settings, `audioSettings` version 2: render and preview quality.
- Model packs: a manifest per pack version and its files, kept only through
  storage (`ModelPackStore`), never committed (`REQ-REPO-191`).
- The DSP ABI, version 6.
- Before 1.0 nothing migrates (`REQ-STOR-052`): an earlier version, or a chain,
  processor or state version this build does not know, is refused with the
  reason.

## Invariants Downstream Agents Must Preserve

- The edit plan is the only description of an edited sound. A rack is realised
  in it as a processed stream, never rendered beside it; a range rack edit, an
  asset's rack and a region's rack apply in `ADR-0060`'s order, and a region's
  rack reads exactly its span of its asset's processed audio.
- A chain has one model, the domain's `EffectChain`, and one persisted form
  (`chain-writing.ts`, `chain-reading.ts`), for a project, a plan, the library
  and the clipboard. A chain enters the project with what first names it and
  leaves with what last names it, in the same command, whose inverse gives it
  back; a chain something names cannot be removed.
- Every rack change is a typed project command with an inverse; the interface
  invokes commands only and stores no processor parameter of its own.
- Commands check a chain's shape, not the catalogue: a plan the catalogue
  refuses is an unavailable entry with its reason, so every command stays
  undoable.
- A processor is one `ProcessorType` in the build's catalogue, stating its
  descriptor (layouts, latency, lead-in, frame grid, determinism, whole pass,
  real time, state) and making its kernel. A new processor is a new type, never
  another arm of a switch, and no code is loaded from elsewhere.
- A chain of unknown latency is refused. The lead-in is summed along a series
  path and the largest across a group's branches, over the one walk
  `chainLatency` shares.
- Every canonical kernel has its reference TypeScript implementation, run by
  the same golden test, and no platform transcendental function or
  browser-native node is in a canonical path. On a per-sample path a double
  crosses a call only through a typed-array slot or a function small enough to
  be inlined.
- A whole-pass processor is measured in signal order, one pass each; a failed
  or refused pass refuses the chain with its reason, and a stale measurement is
  refused, never passed through.
- A model's output that is not finite refuses the render. Every inference, a
  preview's included, runs the pinned WebAssembly path, one thread, with no
  fallback; a faster path is built only when a processor can choose it through
  `QualityMode`, and the interface then says it is a preview.
- Only two modules reach the network: the pack download
  (`model-packs/src/adapter/http-pack-source.ts`) and the read of the
  runtime's WebAssembly from the application's origin
  (`ml-runtime/src/adapter/origin-runtime-files.ts`). Opening a project
  downloads nothing. Every worker starts from a same-origin `blob:` module, so
  the page's Content-Security-Policy governs it.
- A model's identity hashes every file of its pack version, and a project's
  pinned pack versions are kept unless the person removes one knowingly;
  removal goes through the installer.
- The preview cache's key holds everything a render depends on, each stream
  written once; a render that cannot fit is declined before it takes memory,
  and a read past a render's progress waits, never answering silence.
- A plan segment reads one of three sources: media, a stream, or silence,
  which reads no asset. Every plan reader, the oracle, the preview cache key
  and the project format read all three, and an insertion lands where the one
  `insertionPlace` says, so a paste and inserted silence are refused alike.
- A detector or assistant recommends; it never applies. A treatment names
  processor types and values by key, so nothing holds an identifier until the
  person applies it.
- The effect rack, the processors and the model channel are reached only from
  thread entries and test support (`ADR-0030`, `ADR-0040` amended); the engine
  is given the rack as a port.

## ADRs

- `ADR-0060` — effect racks in the edit model.
- `ADR-0061` — processors, quality and reproducibility; amended 2026-10-07 (the
  preview worker makes the cached render) and 2026-10-09
  (`packages/detection-runtime`).
- `ADR-0062` — local inference and model packs; amended 2026-10-07 and
  2026-10-09 (the `queued` state, the runtime read from the origin, the
  `PackStore` port, no faster preview path, workers under the page's policy,
  shared sessions, a pack's tier).
- `ADR-0018`, `ADR-0030` and `ADR-0040` — amended, as the evidence records.

## Verification Baselines

- The processor properties, `pnpm run test:dsp-property`: silence, impulses,
  full scale, subnormals, NaN and infinity, programme material, block-size
  independence, the WebAssembly DSP against the reference, every quality level,
  declared latency and decaying tails, for every catalogue type.
- The goldens, `pnpm run test:audio-golden`: the canonical primitives, the FFT,
  the analysis, every processor and the offline render, Rust and TypeScript
  equal; with `AUDIOGUBBINS_PACK_CACHE` set, the four ML packs' pinned hashes,
  also `pnpm run test:ml-golden`, and in Chromium, Firefox and WebKit
  `pnpm run test:e2e:ml-golden`.
- `pnpm run test:ml-locality`, `pnpm run test:audio-latency`,
  `pnpm run test:editing-property`, `pnpm run test:project-roundtrip`,
  `pnpm run test:architecture` (which holds every TSDoc link to something its
  reader can reach), and `pnpm run test:e2e:effect-rack` in
  Chromium, which applies a chain to a selection, racks a region, reloads and
  hears the same samples.
- `cargo test --workspace`.
- The final counts, over `956f2f5`: `verify:commit` 643 test files and 10,313
  tests; `cargo test` 121; the goldens 195 tests in 30 files; every browser
  test the evidence lists passed, but for one intermittent smoke test that
  passed when run again (the evidence has each count).

## Intentionally Deferred Items

Only items explicitly authorised by the specification:

- Track, bus and master racks: their `effectChainId` fields stay, and a later
  phase runs them as `ADR-0060` says (packet, Out of Scope).
- Spectral painting and spectral selection editing: Phase 08, which reads
  `crates/analysis` and the ML processors.
- Export and every audio writer: Phase 09, which renders through these chains.
- Monitoring through effects while recording: Phase 07.
- Loudness matching across groups and variation sets: Phases 10 and 13, which
  read the loudness measurement.
- Batch workflows beyond applying a saved chain to several targets: Phase 13.
- ML packs whose weights are not licensed for redistribution (`ADR-0062`).
- Third-party plugins (`REQ-PROD-039`, `DEFERRED`).

## Accepted Non-Blocking Debt

- No history mechanism joins a drag's changes into one step, so a dragged
  parameter is heard at release; a range's position shows at the asset's
  current rate; a processor selection replaces a region selection; after a
  reload no editor is in use until clicked.
- A parameter change of an ML processor while playing is refused; a running
  change is heard after the feeder's read-ahead; nothing measures live cost, so
  a too-costly live chain never moves to a render. Preview renders are held in
  memory, not on disk, and the preview worker uses the reference DSP. Owed to
  Phase 14's performance hardening.
- No interface yet makes a whole-pass rack, so the cached preview mode has no
  browser test, and the Library panel has none. Owed to Phase 14.
- The pack manager names the version a project needs, not the project; no pack
  serves a detector, so "optional enhancement unavailable" is never shown;
  `updatePack` has no command; the download bound is per installer, not across
  tabs, and an import waits in the same slot; storage-pressure relief does not
  take partial downloads; `PackStore.transferring` is not in the store contract
  tests.
- A refused setup or malformed message ends the inference worker for every
  thread on it; the runtime's failures are sorted by message text; whether the
  PWA precache takes the runtime's `.wasm` and copied packs is unchecked. Owed
  to Phase 12.
- `SHALLOW_RECORD_DEPTH` (32) is a hand-picked floor;
  `apps/web/src/commands/clipboard-commands.ts` has no test of its own.
- `vitest list` shows no tests in the `*.properties.test.ts` files, though
  they run.
- The known limits of the ML packs (Spleeter's segment seams, DeepFilterNet 3's
  chunk joins, one channel at a time), of the processors (de-click and de-pop
  edge cases, a surviving numerical mutation in `autoregressive.ts`, pitch
  shift's Draft ripple and untested frame grid) and of `crates/analysis`'s
  hum, clipping, noise-floor and transient extractors, each recorded in the
  evidence; a change to an extractor is a change to its reference and the ABI.
- Three tests fail now and then and pass when run again: the dereverberation
  allocation tests under the whole suite's load, `integrity.test.ts`'s
  hand-over test under four packages' suites at once, and the smoke test of a
  panel's minimum height below a dragged splitter, where Transport sometimes
  starts as a tab beside Editor. Each is recorded in the evidence. Owed to
  Phase 14's hardening.
- Safari is not run, and WebKit runs only the ML goldens. Owed to Phase 14.
- Phase 05's debt owed to this phase is closed: F-07's remnants (`5aba08c`),
  the shared chains of `REQ-EDIT-014` (`bfcfdee`, `a04b24f`), and the tests
  that timed out under load in this phase's gates (`c6e0134`); Phase 03's F-38
  (`5aba08c`) and cached preview producer (`1783288`) are delivered.

## Downstream Readiness

- Phase 07 — Recording (Phases 02, 03, 05 and 06), Phase 08 — Spectral Editing
  (Phases 03, 04, 05 and 06) and Phase 09 — Import, Export, and Codec System
  (Phases 02, 03, 05 and 06): every hard dependency of each has reached `PASS`,
  so each is eligible for `READY`. Each one's readiness review decides it.
- Phase 10 still waits on Phase 09; Phase 11 on Phases 09 and 10; Phase 12 on
  Phase 09; Phase 13 on Phases 09, 10 and 11; Phase 14 on Phases 07 to 13.
