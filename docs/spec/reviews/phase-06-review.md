# Phase 06 — Effect Rack and Core DSP — Review Record

The seven lenses `phases/phase-06-effect-rack-and-core-dsp.md` requires, run as
five independent read-only reviewers over `git diff 563d5a4..f958967`, the
phase as it stood when its implementation and its gate run were complete,
against the packet, `contracts/review-gates.md`, the owned requirements and
`ADR-0060` to `ADR-0062` with their amendments. Helper reviews looked for
half-applied fields, unsupported requirement claims, phantom references and
the ML passes. No reviewer was told to preserve the implementation, and none
edited the tree.

Under the owner's decision of 2026-09-28 the phase has one review pass, whose
verified findings are all fixed, or stopped with the reasoning and tracked, and
no looped rounds and no mutation harness. Each fix carries a test that its
author saw fail against the code it replaced, unless the entry says why none
can. The owner's later decision of 2026-10-07 moves in-depth reviews to after
the whole specification is implemented; this pass had already run.

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

Every finding was verified by its reviewer before it was reported, by a run or
a reading of the code against the rule it breaks, and again in triage, which
merged findings two reviewers raised. **Status** records that verification:
`CONFIRMED` means reproduced, or established by reading the code against the
requirement. No finding was rejected.

Findings are numbered for this phase alone, from F-01, in triage order.

## Lenses run

| Reviewer | Lenses |
| --- | --- |
| 1 | Architecture; Code Quality / Maintainability |
| 2 | Audio / DSP Correctness |
| 3 | Performance / Scalability; Security / Privacy |
| 4 | Testing / Golden Regression |
| 5 | Adversarial Agent-Quality |

Triage kept one list and did not record which reviewer raised each finding,
except that F-01 was raised by reviewers 2 and 5, F-18 by reviewer 4, and F-34
to F-40 by reviewer 1. The forty are eight `HIGH`, twenty-one `MEDIUM`, ten
`LOW` and one `NOTE`.

## Blocking findings

| Id | Severity | Finding |
| --- | --- | --- |
| F-01 | HIGH | A chain's lead-in was the largest of its processors' lead-ins, not their sum along a series path, so two 500 ms delays in series previewed part way differed from the render (`domain/src/processing/chain-listening.ts`). |
| F-02 | HIGH | The reverb summed every channel of an ambisonic input into its network, so a source behind or beside the listener got no tail (`space/reverb-network.ts`). |
| F-03 | HIGH | The preview cache key wrote a stream once for every segment that read it, so it grew exponentially with nested racks and twenty pairs threw a `RangeError` (`preview/cached-stream-key.ts`). |
| F-04 | HIGH | The development pack server's containment check passed another drive, a `\\?\` path and a UNC path on Windows (`apps/web/model-pack-serving.ts`). |
| F-05 | HIGH | Pasted processed audio kept its processors' identifiers, and running changes were keyed by identifier alone, so a live parameter change was lost or applied to the pasted copy (`pcm/running-changes.ts`, `plan-readers.ts`). |
| F-06 | HIGH | Pack pins and pack needs read only the project's own chains, not the chains carried in pasted audio (`storage/src/pack-pins.ts`, `ml/pack-needs.ts`). |
| F-07 | HIGH | The ML property tests never ran a model, and a model's NaN or infinite output reached the rendered audio (`ml/model-playback.ts`). |
| F-08 | HIGH | The ML goldens ran only in Node and no packet gate ran them, while `ADR-0062` asks for one hash per pack in every browser the tests run. |

## Non-blocking findings

| Id | Severity | Finding |
| --- | --- | --- |
| F-09 | MEDIUM | History named a rack's chain as "no longer in the project", because chain owners were only tracks and buses. |
| F-10 | MEDIUM | Stretch and rate conversion persisted no algorithm version (`REQ-AUDIO-145`). |
| F-11 | MEDIUM | Silence trimming (`REQ-AUDIO-018`, WU-06.B) was missing. |
| F-12 | MEDIUM | A pack's quality tier was shown but meant nothing, and the levels were a hand-kept copy. |
| F-13 | MEDIUM | The ML preview tier, its WebGPU build and a 26.8 MB runtime file shipped though no processor could reach them. |
| F-14 | MEDIUM | Workers ran outside the page's Content-Security-Policy, the two network modules' workers included. |
| F-15 | MEDIUM | The preview cache's bound did not count a whole pass's memory. |
| F-16 | MEDIUM | Model bytes were copied, not transferred, and read and hashed again on every pass. |
| F-17 | MEDIUM | A detection's findings were unbounded and all drawn on the UI thread. |
| F-18 | MEDIUM | A normalisation measurement of another rate, layout or length passed the input through rather than being refused. |
| F-19 | MEDIUM | The subnormal property could not fail, and the full-scale bounds were loose. |
| F-20 | MEDIUM | The locality tests never opened a project that already names a pack. |
| F-21 | MEDIUM | The browser test's region check could not tell the wrong span. |
| F-22 | MEDIUM | A stretch faded in over its first half window (−4.1 dB at Maximum). |
| F-23 | MEDIUM | True peak could read under the sample peak (a 0 dBFS impulse read −0.245 dBTP). |
| F-24 | MEDIUM | The limiter passed its dBTP ceiling as the canonical meter reads it, at 4× and 8×. |
| F-25 | MEDIUM | The click detector reported clicks its de-click would not repair, the two joining clicks by different gaps. |
| F-26 | LOW | Pack verification could not be cancelled and took no signal. |
| F-27 | LOW | The WebAssembly-against-reference property ran identical code for types that never read the DSP port. |
| F-28 | LOW | No rack-level test of delay compensation around a latent slot, and the latency gate selected no Phase 06 test. |
| F-29 | LOW | A filter or EQ frequency at or above 0.49 × rate was moved to 0.49 × rate at full gain. |
| F-30 | LOW | `findPeaks` returned a peak at bin 0 for silence and flat spectra. |
| F-31 | LOW | The preview service turned every error into a read failure. |
| F-32 | LOW | The Library panel's words dropped solo and mix. |
| F-33 | NOTE | A TSDoc link named `length` where it meant `ChainRequest.length`. |
| F-34 | MEDIUM | Removing a region with a rack left its chain with nothing naming it, and the rule was written three times in the application. |
| F-35 | MEDIUM | The rack commands were written in the application, not in `packages/project-commands`, against `ADR-0061`. |
| F-36 | MEDIUM | Package and dependency changes were in no ADR. |
| F-37 | MEDIUM | The thread-message field readers existed five times, and the quality mode crossed threads in two shapes. |
| F-38 | LOW | The domain's `chainLatency` was rewritten for groups but unused in production. |
| F-39 | LOW | `packsToFetch` implemented an automatic-download policy nothing called. |
| F-40 | LOW | `chain-reading.ts` said project opening and commands ran the catalogue check, which only plan building runs. |

## What the reviewers found sound

The plan order (`ADR-0060`); the rack graph (mix, summing laws, layout
refusals, delay compensation); latency trimming, whole passes and frame grids;
the cache key's coverage; quality defaults and their disclosure; the canonical
primitives and the FFT (within 1 ulp, the Rust and the reference equal); the
analysis (K-weighting, gating, the BS.1770 table); the other processors and the
detectors' range mapping; the ML passes (lengths, alignment, chunk joins,
resampling, pinned settings; the runtime binary has no relaxed SIMD and matches
its pinned digest); the network adapters (GET only, no credentials, referrer or
redirects); integrity checked before use; the manifest's path rules; no
personal data committed; bounded concurrency; casts, catch sites and markers;
chain writing and reading, differences, descriptions, the clipboard's
re-minting, the library's apply, and every switch over operation kinds.

## Disposition

Every verified finding is fixed, or stopped with its reasoning and tracked.
Commits are on `phase-06-effect-rack`: `a04b24f` (domain, project commands,
DSP), `51a0fbe` (preview, ML runtime, packs, workers) and `823b008` (browser
goldens, silence trimming, tiers, filter design).

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `a04b24f`, with F-38. The lead-in is summed along a series path and the largest across a group's branches, over the one walk `chainLatency` uses (`measureSlots`). Each processor's lead-in is counted in its own input's frames and holds its own latency, so no further latency term is added. `chain-listening.test.ts` is re-pinned; `effect-rack/src/chain-measures.test.ts` previews a two-stage chain part way through the real rack, which failed against the old rule. |
| F-02 | **Fixed** in `a04b24f`. The network is fed from W alone, and each component gets its own decorrelated tail at the SN3D diffuse-field weight 1/√(2l+1); a layout naming an ambisonic convention without its full set is refused. The fix found the stereo output matrix gave the first channel twice the others' energy; every row now sums to ±1. `reverb.test.ts` (sources at 180°, −90° and overhead, the weights, width 0, a partial set, equal energy) failed against the old network. The stereo golden was re-recorded with RT60 and channel energies checked independently. |
| F-03 | **Fixed** in `51a0fbe`. The key lists each stream's text once and segments name it, so its length grows linearly. `cached-stream-key.test.ts` builds thirty nested levels; the old key threw. |
| F-04 | **Fixed** in `51a0fbe`. One pack path grammar, `model-packs/src/pack-path.ts`, serves the manifest, the download and the development server, and two dependency-cruise rules keep it the only one. `pack-path.test.ts` and the serving tests try every escaping form; the old server served the `\\?\` form. |
| F-05 | **Fixed** in `a04b24f`. A parameter change names its stream place, and running changes compare place by place. `running-changes.test.ts` and `effect-rack/src/pasted-copy-parameters.test.ts` failed against the old files. |
| F-06 | **Fixed** in `a04b24f`. The domain's `projectChains` yields every chain a project state runs, those in pasted plans included, and both pack pins and pack needs read it. Tests in the domain, storage and `pack-needs.test.ts` failed with the old loop. |
| F-07 | **Fixed** in `a04b24f`. A model whose output is not finite refuses the render (`processor.model-output-not-finite`), naming pack, channel and frame, since a render that cleaned the samples would claim a success it did not have. The property harness runs every whole-pass type as the rack does, over stand-in graphs, one of which emits NaN and infinity. The new tests failed against the old pass. The sibling found that peak normalisation raised a subnormal input to its target; the measurer flushes subnormals. |
| F-08 | **Fixed** in `823b008`. Each pack's pinned final render runs through the real inference worker in Chromium, Firefox and WebKit (`tests/e2e/ml-golden.spec.ts`, `pnpm test:e2e:ml-golden`), compared with the hashes the Node goldens read from one table (`processors/src/testing/ml-goldens.ts`); every browser gave the Node hash, so no tolerance is needed. The packs come from `AUDIOGUBBINS_PACK_CACHE`, and the test fails, never skips, without them. `test:audio-golden` now runs the ML goldens too. A browser test of a hash has no old code to fail against; the spec was seen to fail with a wrong constant. |
| F-09 | **Fixed** in `a04b24f`. `chainOwner` is built on `chainUsers`, owners widened to asset and region racks and ranges, and the history words name each. `entity-names.test.ts` failed against the old files. |
| F-10 | **Fixed** in `51a0fbe`. Stretch and rate conversion carry the engine's algorithm version (`audio-engine/src/dsp/algorithm-versions.ts`, where the resampler's version moved from the processors), written and read by the project format and refused when unknown (`edit.algorithm-version-unknown`); `projectDocument` 4, `projectStorage` 8. `algorithm-versions.test.ts` and `edit-json.test.ts` failed against the old code. Batch D gave a converted paste the resampler's version too (`projectDocument` 5, `projectStorage` 9), the one conversion left without one. |
| F-11 | **Fixed** in `823b008`. A silence extractor in `crates/analysis` and its reference (DSP ABI 6), a silence detector and assistant, and `removalEdits`, which turns the findings into the existing deletes and trim in one history step (`analysis.remove-silence`); a person sets the threshold, the shortest edge silence, the shortest pause and the pause kept, values a detection request carries and the detector's own check refuses in the worker and in every command alike. The extractor's goldens, the detector, the edits, the command and the panel each failed against a mutation; `tests/e2e/analysis.spec.ts` removes silence in Chromium. |
| F-12 | **Fixed** in `823b008`. A pack states one tier of its model's own speed against thoroughness, light, balanced or thorough, from one list in `model-packs` that the pack build tool loads, and the Model packs panel says the tier is the same at every render and preview quality; `ADR-0062` is amended. The pack tool's copies of the path, version, capability and size rules are gone with it. The panel and tool tests failed against the old code. |
| F-13 | **Fixed** in `51a0fbe`. The preview variant, the WebGPU build and the second runtime file are removed until a processor can choose a preview path through the quality mode; `ADR-0062` is amended. The build-output check refuses any other runtime file. The build-output, runtime and registry tests failed against the old code. |
| F-14 | **Fixed** in `51a0fbe`. Every worker starts from a same-origin `blob:` module that imports its script, so the page's policy governs it, and an ESLint rule refuses any other start. `tests/e2e/worker-policy.spec.ts` fetches another origin from the storage and inference workers; against a build of the old code both fetches were answered. |
| F-15 | **Fixed** in `51a0fbe`. A render counts its whole passes' memory (`ChainProcessing.measurementBytes`) against the cache's bound before it starts, and is counted again as it finishes. `preview-producer.test.ts` and `measurement-memory.test.ts` failed against the old producer. |
| F-16 | **Fixed** in `51a0fbe`. The inference worker asks for a model's bytes when a session needs them, and they are transferred; one session is shared per model and idle ones are kept up to 256 MiB (`SharedSessions`). `shared-sessions.test.ts` and the protocol tests caught bytes not transferred and sessions not shared. |
| F-17 | **Fixed** in `51a0fbe`. A detection keeps 200 findings per kind and counts the rest, and the Analysis panel draws a kind's rows only when it is opened, saying what was left out. `detection-worker-core.test.ts` and `analysis-panel.test.tsx` failed against the old files. |
| F-18 | **Fixed** in `a04b24f`. A present but stale or mis-shaped measurement is refused (`processor.measurement-stale`); only an absent one passes the input through. Both tests failed against the old code. |
| F-19 | **Fixed** in `a04b24f`. A `fallsSilent` property per recursive kernel, and bounds by physics. It found that a biquad cascade flushed its two states one at a time, so de-hum stuck near 3e-28; both are now zeroed together. Twenty-three of twenty-three cases fail with flushing removed. |
| F-20 | **Fixed** in `a04b24f` and `51a0fbe`. The locality tests close and reopen a project that names a pack, with the pack absent and installed, recorders on from before the open, and cover the feeder and peak workers. A request added on open failed them. |
| F-21 | **Fixed** in `a04b24f`. The region's samples are compared with the original's span times the gain, within one float32 rounding unit, on both channels. The check failed with the span moved by one sample, and passes in the browser. |
| F-22 | **Fixed** in `a04b24f`. A stretch's frames start at 1 − O/2 in both branches, and negative frame centres are floored. The full-level test failed by 1.53 dB against the old code. |
| F-23 | **Fixed** in `a04b24f`. True peak is the larger of the interpolated and the sample peak, in the crate and the reference, with the comments corrected. The impulse test failed against the old code; the peak meter's two golden hashes were re-recorded, the only change being that maximum, and the Rust and TypeScript hashes are equal. |
| F-24 | **Fixed** in `a04b24f`. The limiter detects with the canonical meter's own filter (`truePeakPhases`), so dBTP has one definition, and its latency fell from L + 73 to L + 12. The test reads the output with the canonical meter at 44.1, 48 and 96 kHz, at 4× and 8×; the old limiter read −0.92 dBTP against a −1 dBTP ceiling. |
| F-25 | **Fixed** in `a04b24f`. One click rule (`repair/click-geometry.ts`) serves the detector and the de-click, and a click too long to repair gets no treatment, with its reason. A scripted extractor feeding both failed against the old code. |
| F-26 | **Fixed** in `51a0fbe`. Checking a pack's files takes a signal; pause leaves checking for paused and cancel for removing. Five state and installer tests failed against the old code. |
| F-27 | **Fixed** in `a04b24f`. A property case declares whether it reads the DSP port, checked both ways by a recording port, and only those cases run the WebAssembly comparison. |
| F-28 | **Fixed** in `a04b24f`. `effect-rack/src/rack-latency.test.ts`, which the latency gate selects, covers a latent slot mixed under 1, unequal branches and a bypassed latent slot; it fails with the graph's compensation removed. |
| F-29 | **Fixed** in `823b008`. A section above 0.49 × rate is fitted to its analogue magnitude below Nyquist and factorised into a stable minimum-phase biquad (`magnitude-fit.ts`); between 0.45 and 0.49 × rate each coefficient moves linearly from the cookbook's design to the fit, which keeps it stable, so a frequency swept across the hand-over moves at most 0.017 dB where a hard switch would jump up to 40 dB. A +12 dB bell at 20 kHz at a 32 kHz rate is within 0.2 dB of the asked-for response. The response, stability and hand-over tests failed against the old design; the allocation test holds. |
| F-30 | **Fixed** in `a04b24f`. A peak must be louder than a neighbour the frame has. `phase-locking.test.ts` failed against the old code. |
| F-31 | **Fixed** in `51a0fbe`. The preview service answers a read failure, stays silent for a cancelled read, and answers any other error as a fault it reports. `preview-channel.test.ts` failed against the old service. |
| F-32 | **Fixed** in `a04b24f`. The Library's words say solo, mix and a group's law. `library-words.test.ts` failed against the old file. |
| F-33 | **Fixed** in `51a0fbe` and `92b1a23`. `51a0fbe` corrects the link. `92b1a23` fixes the thirty other broken TSDoc links a later scan found, and adds `tests/architecture/tsdoc-links.test.ts`, which resolves every TSDoc link in the solution's projects; each of its rules was proved by mutation. |
| F-34 | **Fixed** in `a04b24f`, with F-35. A chain enters the project with what first names it and leaves with what last names it, in the same command, whose inverse gives it back (`project-commands/src/processing/chain-naming.ts`); the three application copies are deleted. The review's reproduction is a test, and failed against the old code. |
| F-35 | **Fixed** in `a04b24f`. Every rack edit is a typed project command with an inverse (adding, removing and moving a slot, slot controls, a target's rack, a range's rack, independence, applying to several targets); the shell commands parse arguments and word replies only. The random command walk covers them. The range rack edit's withdrawal, which existed with no caller, is reachable as "Remove this processing". |
| F-36 | **Fixed** in `51a0fbe` and `823b008`. `ADR-0030`, `ADR-0040`, `ADR-0061` and `ADR-0062` carry dated amendments for the packages that start threads, the detection runtime and the pack store's direction, and the cruise rules keep the rack, processors and model channel to the thread entries and test support. A record has no behaviour to fail; the dependency cruise holds the rules. |
| F-37 | **Fixed** in `51a0fbe`. One structured-clone field reader (`domain/src/messages/message-fields.ts`) is below every user, and the quality mode crosses threads in one form. `message-fields.test.ts`; the old preview files failed it. Batch D moved the PCM description, signal recipe, chain and plan readers onto it too. |
| F-38 | **Fixed** in `a04b24f`, with F-01. `chain-measures.test.ts` ties the domain's latency to the graph's for every catalogue type alone, in series and in parallel. |
| F-39 | **Fixed** in `51a0fbe`, by removal. A removal has no behaviour to test. |
| F-40 | **Fixed** in `a04b24f`. The comment is reworded. A comment has no behaviour to test. |

### Quoted text that names no test

| Quoted | In |
| --- | --- |
| Remove this processing | F-35 |

## Re-review

The owner's decision of 2026-09-28 replaces looped review rounds with one pass
whose findings are fixed. No lens was re-run. Each fix was verified by the test
its author saw fail before it and by the gate over the merged tree, and the
browser tests run over the merged tree before it lands.
