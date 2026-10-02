# Audio Formats, DSP, ML, and Media Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-AUDIO-010` — Format Support — owner Phase 09 — scope `CURRENT`
- `REQ-AUDIO-016` — Spectral Editing — owner Phase 08 — scope `CURRENT`
- `REQ-AUDIO-017` — Effect Rack — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-018` — DSP Scope — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-019` — Preview and Comparison — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-050` — Presets and Advanced Codec Controls — owner Phase 09 — scope `CURRENT`
- `REQ-AUDIO-080` — Preview Quality and Final Render Quality — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-082` — GPU Acceleration Strategy — owner Phase 04 — scope `CURRENT`
- `REQ-AUDIO-086` — Quality Presets and Expert Controls — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-138` — Local Machine-Learning Processing — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-139` — ML Model Packs and Storage — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-143` — Render Quality Policy — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-145` — Processor Versioning and Reproducibility — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-146` — DSP Architecture Review Requirements — owner Phase 06 — scope `CURRENT`
- `REQ-AUDIO-152` — High-Performance Editor Rendering Layer — owner Phase 04 — scope `CURRENT`
- `REQ-AUDIO-156` — Video Reference and Sound-to-Picture Workflows — owner Phase 04 — scope `CURRENT`
- `REQ-AUDIO-220` — Native-Rate Reading of Uncompressed Audio — owner Phase 05 — scope `CURRENT`

---

## REQ-AUDIO-010 — Format Support

- **Owner:** Phase 09 — Import, Export, and Codec System
- **Scope:** `CURRENT`
- **Legacy source:** section 10 of the pre-hardening baseline

The codec layer must be abstracted so that format support can evolve independently from the editor core.

Target common formats include:

#### Import

- WAV
- AIFF
- FLAC
- MP3
- Ogg Vorbis
- Opus
- AAC / M4A
- Additional common or game-relevant formats where technically and legally practical

#### Export

Broad export support should be provided where technically, legally, and browser-wise practical.

WAV support should be especially comprehensive.

Target WAV capabilities include:

- Integer PCM
- Floating-point PCM
- Common bit depths
- Broad sample-rate support
- Mono
- Stereo
- Multichannel layouts where supported by the format
- Channel conversion
- Metadata
- Loop metadata where applicable

Codec support must use capability detection and must not assume that all browsers expose identical native codecs.

Fallback implementations may use WebAssembly or other portable mechanisms where beneficial.

Reading WAV and AIFF files that hold uncompressed PCM at their native rate is `REQ-AUDIO-220`, Phase 05's (split from this group by `ADR-0050`). This group keeps every other import format, the compressed encodings WAV and AIFF-C can carry, all export, metadata and loop metadata, and capability detection and fallbacks, and its readers extend the read contract that requirement introduces.

---

## REQ-AUDIO-016 — Spectral Editing

- **Owner:** Phase 08 — Spectral Editing
- **Scope:** `CURRENT`
- **Legacy source:** section 16 of the pre-hardening baseline

Interactive spectral editing is a required long-term feature.

Capabilities should include:

- Spectrogram display
- Time-frequency selection
- Attenuation
- Removal
- Repair/healing
- Noise isolation
- Spectral cleanup
- Selection-sensitive processing

This may be implemented in a later phase than the core waveform editor.

---

## REQ-AUDIO-017 — Effect Rack

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 17 of the pre-hardening baseline

The editor shall provide Audition-style effect-rack functionality.

Processors should support:

- Stacking
- Reordering
- Bypass
- Enable/disable
- Parameter editing
- Presets
- Real-time preview where practical
- A/B comparison
- Copy/paste
- Saving chains
- Batch reuse

Initial architecture should support future:

- Per-clip racks
- Per-track racks
- Bus racks
- Master racks

---

## REQ-AUDIO-018 — DSP Scope

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 18 of the pre-hardening baseline

The application should ultimately support a comprehensive processing toolset, including:

- Gain / amplify
- Peak normalisation
- Loudness normalisation
- Fades
- Invert
- Reverse
- Silence generation
- Silence trimming
- DC-offset removal
- Resampling
- Sample-rate conversion
- Channel conversion
- Equalisation
- Filtering
- Compression
- Limiting
- Expansion
- Gating
- De-essing
- Noise reduction
- De-hum
- De-click
- De-pop
- Pitch shifting
- Time stretching
- Reverb
- Delay
- Spectral processing

Additional processors that materially improve capability should be included without requiring separate approval.

---

## REQ-AUDIO-019 — Preview and Comparison

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 19 of the pre-hardening baseline

Where computationally practical, processors should support:

- Real-time preview
- Bypass
- A/B comparison
- Processed/original comparison
- Safe parameter adjustment during playback

Expensive operations may use cached intermediate renders where appropriate.

---

## REQ-AUDIO-050 — Presets and Advanced Codec Controls

- **Owner:** Phase 09 — Import, Export, and Codec System
- **Scope:** `CURRENT`
- **Legacy source:** section 50 of the pre-hardening baseline

Export workflows shall use progressive disclosure.

Users should be offered high-quality presets for common tasks while retaining access to advanced codec and format controls.

The user must not be forced to choose between simplicity and power.

Presets are convenience layers over fully configurable settings, not separate restricted modes.

---

## REQ-AUDIO-080 — Preview Quality and Final Render Quality

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 80 of the pre-hardening baseline

Processors may expose different quality modes for interactive preview and final output where the underlying algorithm materially benefits from this distinction.

Requirements:

- Preview quality may favour low latency and responsiveness.
- Final render quality may use more expensive algorithms or settings.
- The application must not silently produce materially different results without making the distinction clear.
- Users should be able to inspect and configure quality behaviour where relevant.
- Presets may simplify the normal workflow while advanced settings expose the underlying parameters.

---

## REQ-AUDIO-082 — GPU Acceleration Strategy

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 82 of the pre-hardening baseline

WebGPU should be used opportunistically where it provides meaningful benefit.

Candidate workloads include:

- Spectrogram generation
- Spectrogram rendering
- FFT-heavy analysis
- Visualisation
- Selected parallel DSP workloads where appropriate

AudioGubbins must provide graceful fallbacks, including WebGL2 and CPU/worker implementations where required.

WebGPU must not become a prerequisite for core editing functionality.

---

## REQ-AUDIO-086 — Quality Presets and Expert Controls

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 86 of the pre-hardening baseline

Technical quality controls shall use progressive disclosure.

Where appropriate, AudioGubbins should expose approachable named presets such as:

- Draft
- High
- Maximum

Advanced users must also be able to inspect and configure the underlying parameters when doing so is meaningful and safe.

Named presets must map to explicit parameter values and must not create opaque hidden processing modes.

---

## REQ-AUDIO-138 — Local Machine-Learning Processing

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 138 of the pre-hardening baseline

AudioGubbins shall support machine-learning-assisted audio processing where it materially improves restoration, cleanup, separation, analysis, or creative workflows. ML model packs may be optional for users to install because of their size, but ML infrastructure and the identified ML-assisted processor families are part of the planned AudioGubbins feature scope rather than being deferred solely by release-version labels.

ML functionality must remain local-first. Core ML processors shall not require audio to be uploaded to a remote service.

Candidate ML-assisted capabilities include:

- Advanced broadband noise removal
- Speech/dialogue enhancement
- Dereverberation
- Source separation
- Stem isolation
- Transient/noise classification
- Click/pop/artefact detection
- Intelligent restoration assistance
- Content-aware repair suggestions
- Optional analysis assistants that recommend processing without silently applying it

ML-derived results must remain non-destructive and must integrate with the same parametric edit graph, command architecture, undo/redo model, preview system, and final-render pipeline as conventional DSP.

Where an ML operation cannot be represented entirely by compact parameters, its authoritative inputs, model identity, model version, operation settings, masks/regions, and reproducibility metadata must be retained. Generated previews or intermediate inference outputs may be cached but must not become the sole authoritative project state.

No ML feature may silently transmit audio, project metadata, or derived content off-device.

---

## REQ-AUDIO-139 — ML Model Packs and Storage

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 139 of the pre-hardening baseline

Large ML models shall be distributed and managed as optional capability packs rather than forcing the base PWA bundle to include every model.

Model-pack management must support:

- Explicit model name and purpose
- Model version
- Download size
- Installed size
- Integrity/hash verification
- Licence information
- Compatibility information
- Quality/performance tier where applicable
- Download progress
- Pause/cancel/retry
- Storage-location abstraction where practical
- Removal and cleanup
- Update availability
- Rollback or retention of required historic versions where post-1.0 project reproducibility requires it

Models must not be downloaded merely because a project is opened unless they are required and the user has enabled an appropriate automatic-download policy.

The application shall clearly distinguish:

- Required model unavailable
- Optional enhancement unavailable
- Model update available
- Model incompatible with current runtime
- Model unavailable because of browser/device capability

Resource-heavy models may expose quality tiers such as Draft, High, and Maximum, with advanced users able to inspect the underlying model and inference settings where meaningful.

---

## REQ-AUDIO-143 — Render Quality Policy

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 143 of the pre-hardening baseline

Final rendering and export shall default to the highest-quality practical processing path appropriate to the selected output format and operation.

The final-render path should prioritise:

1. Signal quality
2. Determinism/reproducibility
3. Numerical correctness
4. Preservation of source fidelity
5. Robustness
6. Performance

Performance must not be prioritised over final quality merely to reduce render time.

Users must retain control over quality/performance trade-offs.

Where meaningful, rendering should expose presets such as:

- Draft
- Standard
- High
- Maximum
- Custom

The normal default for final export should favour High or Maximum quality according to the processor/format, while preview workflows may use lower-latency paths.

Advanced settings should expose the actual underlying parameters rather than presenting opaque quality labels only.

Any non-deterministic or platform-native fast-render path must be explicitly identified and must not silently replace the canonical deterministic render path.

---

## REQ-AUDIO-145 — Processor Versioning and Reproducibility

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 145 of the pre-hardening baseline

Processor identity and implementation version shall be persisted as part of authoritative project state where the processor's behaviour can affect rendered output.

At minimum, reproducibility metadata should be capable of identifying:

- Processor type
- Processor implementation version
- Parameter schema version
- Relevant model version for ML processors
- Relevant codec/resampler implementation version where necessary
- Render-engine version or compatibility level where necessary

Before version 1.0.0, the existing pre-1.0 breaking-change policy applies: legacy processor compatibility layers are not required, and incompatible stored data may require backup/export followed by reset.

From version 1.0.0 onward, AudioGubbins must deliberately manage processor evolution so that opening an older project does not silently alter its sound.

Post-1.0 strategies may include:

- Retaining compatible legacy implementations
- Explicit processor migration
- Version-pinned rendering
- User-visible upgrade comparison
- Render-freezing/archive workflows

Silent sonic changes caused solely by an application upgrade are not acceptable after 1.0.0.

---

## REQ-AUDIO-146 — DSP Architecture Review Requirements

- **Owner:** Phase 06 — Effect Rack and Core DSP
- **Scope:** `CURRENT`
- **Legacy source:** section 146 of the pre-hardening baseline

Every implementation phase that introduces or materially changes DSP infrastructure must include review of:

- Deterministic behaviour
- Numerical stability
- Denormal handling where relevant
- Clipping and headroom
- Channel-count correctness
- Sample-rate correctness
- Latency reporting
- Delay compensation
- Parameter smoothing
- Thread/worker safety
- Real-time safety for AudioWorklet code
- Allocation behaviour on real-time paths
- WASM boundary overhead
- Cache invalidation correctness
- Processor versioning
- Offline versus real-time equivalence
- Golden audio regression coverage

Real-time processing code must not perform unbounded allocation, filesystem access, network access, blocking waits, or other operations unsuitable for an audio rendering thread/worklet.

Golden/regression audio tests should compare outputs using both exact checks where determinism permits and perceptually/numerically appropriate tolerances where exact bit identity is not guaranteed.

---

## REQ-AUDIO-152 — High-Performance Editor Rendering Layer

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 152 of the pre-hardening baseline

Waveform, spectrogram, timeline, meter, selection-overlay, and other high-frequency visualisation systems shall use a dedicated renderer abstraction rather than DOM-heavy rendering or React reconciliation for every visual element.

The initial implementation may use **PixiJS 8.x** as a retained-mode GPU-accelerated rendering foundation where it materially accelerates implementation without constraining AudioGubbins' rendering requirements.

AudioGubbins must own the renderer-facing contracts so that rendering backends can evolve independently.

The renderer architecture shall support:

- WebGPU where available, validated, and sufficiently stable for the required feature path
- WebGL2 as a robust production fallback
- Canvas 2D or reduced renderer paths where necessary for graceful degradation
- High-DPI rendering
- Touch/stylus hit testing
- Large timeline coordinate spaces
- Virtualised/offscreen content
- Layered waveform/spectrogram/selection overlays
- GPU resource lifecycle management
- Context/device loss recovery
- Renderer capability diagnostics

No authoritative editor/domain state may be stored only inside the graphics scene graph.

The renderer must be reconstructible from domain/view state after renderer reset, GPU device loss, tab restoration, or capability-path changes.

---

## REQ-AUDIO-156 — Video Reference and Sound-to-Picture Workflows

- **Owner:** Phase 04 — Waveform and Timeline Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 156 of the pre-hardening baseline

AudioGubbins shall support opening video and gameplay-reference media alongside audio for sound-design-to-picture workflows without attempting to become a general-purpose video editor.

The video-reference subsystem should support, where technically available:

- Synchronised audio/video transport
- Frame-accurate or best-available frame-aware scrubbing
- Timecode and frame display
- Configurable frame-rate interpretation
- Timeline markers and regions aligned to picture
- Waveform/spectrogram editing while picture remains synchronised
- Video thumbnails or filmstrip views where useful
- Detachable/dockable video preview panel
- Full-screen or enlarged picture preview
- Offset/calibration controls for externally prepared reference media
- Import of common browser-decodable video formats with capability-based fallback handling
- Extraction or reference of embedded audio tracks where legally and technically practical
- Export of edited audio independently from the reference video

The authoritative AudioGubbins project must treat video as reference media unless a later specification explicitly introduces video-editing capabilities. Video-reference support must not cause the project architecture to become coupled to a non-existent video-editing model.

The transport and timeline abstractions must therefore support a shared media clock suitable for future multitrack, picture sync, recording, and external-reference use.

---

## REQ-AUDIO-220 — Native-Rate Reading of Uncompressed Audio

- **Owner:** Phase 05 — Core Non-Destructive Editing
- **Scope:** `CURRENT`
- **Legacy source:** none; split from `REQ-AUDIO-010` by `ADR-0050`

AudioGubbins must import a WAV or AIFF file that holds uncompressed PCM into the open project as an asset of that project, read by its own readers at the sample rate the file was recorded at. The browser's audio decoder must not read these files, because it resamples to its own rate and does not report the file's.

Reading must cover:

- WAV: integer PCM of 8 to 32 bits and IEEE floating-point PCM of 32 and 64 bits, in the plain and `WAVE_FORMAT_EXTENSIBLE` forms, and RF64 and BW64 for files larger than 4 GiB
- AIFF: integer PCM of 8 to 32 bits
- AIFF-C without compression: integer PCM of 8 to 32 bits in either byte order, and floating-point PCM of 32 and 64 bits
- Any sample rate and any channel count the file declares, with the channel layout its header states, or no stated layout where it states none

The format must be recognised from the file's contents, never from its name alone.

Reading must not resample. Each sample is converted to the engine's representation by one stated rule that gives the same result on every machine.

A file must be read in chunks, on demand and off the UI thread, and never held whole in memory to be imported, played or drawn. Every read must be cancellable.

The asset must record the file's sample rate, bit depth, sample encoding, channel layout and duration in its provenance.

A file in a format this requirement does not cover must be refused before anything is stored, with a message naming its format and the formats that can be read. A malformed file must fail without changing the project. A file whose audio data ends before the length it declares, as a recording cut off by a crash does, must be read to its last whole frame, and the shortfall reported.

The source file's bytes must not change, whether it is copied into the project or linked where it lies.

---
