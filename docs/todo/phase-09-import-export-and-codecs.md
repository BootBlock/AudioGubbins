> **Status:** In progress. 2026-10-10: the phase is `READY` (`ADR-0090` to
> `ADR-0093`); slices S1 to S7 are built and merged on `phase-09-codecs`, where
> `verify:commit` is green; S8 (the application) and the close are left.

# Phase 09 — Import, Export, and Codec System

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-09-import-export-and-codec-system.md`, and the
decisions that shape the work are `ADR-0090`, `ADR-0091`, `ADR-0092` and
`ADR-0093`.

## Where the work is

|        |                                                         |
| ------ | ------------------------------------------------------- |
| Branch | `phase-09-codecs`, in `../AudioGubbins-phase-09-codecs` |
| Base   | `main` at `1c357d0e`                                    |
| Head   | see `git log`, not pushed                               |

Phase 08 is built at the same time on `phase-08-spectral`, not merged. It raises
`projectDocument` 7 to 8, `userPreferences` 1 to 2 and `editorViews` 1 to 2.
Whichever phase lands second merges `main` in, raises the versions it needs above
what `main` then holds, reruns `pnpm version:sync` and `pnpm contracts:update`,
and runs `verify:commit`. `packages/domain/src/index.ts` is over its cohesion
threshold on Phase 08's branch: add nothing to it that a consumer does not need.

## Gates

Light gates (owner decision, 2026-10-07): `pnpm run verify:commit` for every
change, `pnpm run spec:verify` after an edit under `docs/spec/`, and the packet's
commands at the phase's end. The review lenses the packet names are deferred to
the review after the whole specification is built. The author of a new test sees
it fail once against the code it guards, with the file copied aside first. Every
full `verify:commit` holds the Gambit resource `build:audiogubbins-verify`.

## Slices

Each slice works in its own worktree branched from `phase-09-codecs`. The shared
lists (`version.json`, `tests/architecture/*`, `.dependency-cruiser.cjs`,
`eslint.config.js`, `tools/sync-workspace-graph.mjs`, the third-party notices)
are edited line by line by whichever slice needs a line, and
`tests/architecture/public-contracts.txt` is regenerated after each merge.

| Slice | Work                                                                                                                          | Needs  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| S1    | `packages/codecs`: registry, in-place G.711 and ADPCM readers, WAV, AIFF and AIFF-C writers, WAV and AIFF metadata, layouts   | —      |
| S2    | `crates/codecs`, `crates/codec-bindings`, the codec module's build, `packages/codec-runtime`'s typed module, Opus conformance | —      |
| S3    | `packages/codecs`: Ogg, FLAC, MP4 and MP3 framing; Vorbis comment, ID3v2 and `ilst` metadata                                  | —      |
| S4    | `packages/import-export`: settings, presets, validation, dither, naming, collision rules, job state machines                  | —      |
| S5    | Debt: the diagnostics path rules (F-192, F-618)                                                                               | —      |
| S6    | `packages/codec-runtime`: the codec worker, decode to rendition, every encoder, the WebCodecs adapters, the probes            | S1–S3  |
| S7    | Storage: renditions, analysis, batch import, staging, delivery, folders, trusted folders, provenance, export records, F-51    | S1, S4 |
| S8    | `apps/web`: commands, the Export dialog, the collision prompt, batch import, settings, the reference picture's channels, e2e  | all    |

## Decisions taken in the build

These settle what the ADRs leave to the implementation.

1. **Contracts.** `CodecDescriptor`, `CodecCapability`, `CodecId`, `ContainerId`,
   `MetadataMap`, `SyncAudioBytes` and `AudioFileWriter` (the streaming write
   contract: body bytes per block, then a head and a tail) are in
   `packages/codecs` (`codec-descriptor.ts`, `metadata-map.ts`,
   `sync-audio-bytes.ts`, `audio-file-writer.ts`).
2. **S1 (merged `74d7428b`).** `CodecDescriptor` gains `codes` (WAV tags,
   AIFF-C types), from which recognition and the readers derive their maps. The
   application's own codecs need no WebAssembly. Alternatives: same lossiness
   first, then the rest, in registry order. Browser implementations carry the
   licence `NOASSERTION`. `RecognisedFormat` is `{kind:'audio', container,
codec}` or `{kind:'unknown'}`; `importRoute` answers read in place, decode or
   refuse. G.711 follows ITU-T G.191; IMA follows the IMA reference (`ima4`
   restarts from its 9-bit predictor); MS ADPCM truncates its prediction and caps
   its delta as FFmpeg does, choosing the best standard coefficient pair per
   block. ADPCM blocks are 256 bytes per channel, doubling with rate to 1,024
   from 44.1 kHz; the last block is padded and `fact` holds the true length.
   WAV writes the mask's speakers in bit order, then the rest; what no mask
   states goes in the `iXML` element `AUDIOGUBBINS_CHANNEL_LAYOUT`, honoured only
   where it agrees with the mask. The plain form serves only up to two channels
   in their default layout at 16-bit integer or less. AIFF refuses a stream past
   4 GiB. `recordedWavHeader` keeps its refusals. Metadata text is read as UTF-8
   where valid, else Latin-1; `bext` is written as version 1; RIFF `ISRC` is not
   mapped (it means "source"); a carried `iXML` is dropped on write; bounds of 1
   MiB per chunk, 8 MiB per file, 4,096 cues, 1,024 loops, 4,096 markers.
   `importAudio` refuses G.711 and ADPCM files (`storage.source-codec-unrecorded`)
   until S7 records a codec in provenance: S7 removes that refusal.
3. **S2 (merged `2f694400`).** The codec module's ABI is version 1, with one
   import, `ag_codec_read(source, offset: f64, dest, len)`; the handle table is
   `crates/handle-table`, shared with the DSP module, whose ABI is unchanged.
   Opus is `ropus` (all 24 RFC 8251 vectors pass); its input is rounded to 16
   bits ties-to-even inside the module and it decodes to 16 bits, as the
   fixed-point reference does. Channels leave every decoder in speaker-mask
   order (mono as front centre), and Opus input above two channels is given in
   that order and reordered to Vorbis order inside. The session applies Opus
   pre-skip and length, and reads MP4 priming from the edit list or `iTunSMPB`.
   Implicit HE-AAC is detected when at least 6 of the first 8 packets carry SBR.
   A stated bit rate is the file's average; an MP3 length counts as stated only
   with a LAME tag. The ABI also reads undecoded packets and the codec
   configuration, so the browser's HE-AAC decoder is fed by this demultiplexer.
   FLAC compression levels 0–8 follow `libFLAC`'s choices. The module is 2.56 MB.
   Left to S2b: 32-bit FLAC encoding, and Matroska `DiscardPadding`/`CodecDelay`.
   Left to S6: real-audio fixtures for MP3, Vorbis and AAC decoding, made with
   the prebuilt encoders and the browser.
4. **S5 (merged `62ebed2f`).** A slashed word after a path is prose only if it
   is digits joined by slashes or one of `and/or`, `either/or`, `n/a`, `w/o`,
   `i/o`, `on/off`, `yes/no`, `read/write`; a path ends before it. Text is
   redacted as written, then each of up to three percent-encoding layers is
   decoded and redacted again; a word still encoded becomes `<data>`. Invalid
   bytes decode to U+FFFD. `data :` is treated as `data:`.
5. **S4 (merged `d59b7689`).** Defaults and presets take `{ source, codecs }`;
   the default rate is the project's if the codec writes it, else the lowest
   written above it, else the highest. Defaults: WAV and AIFF-C float 32; AIFF
   and FLAC the shallowest depth holding the source (32 for float); FLAC level
   5; MP3 the highest CBR; Vorbis q10; Opus 255 kbit/s per channel, audio, 20
   ms, complexity 10; AAC 128 kbit/s per channel. Default dither: triangular,
   one step, unshaped, seed 0, for integer depths of 16 bits or less (G.711 and
   ADPCM count as 16). The dither key is the CRC-32 of the settings as canonical
   text; the generator is lowbias32 over key, channel and draw. Noise shaping is
   `first-order` or the 9-tap `lipshitz-e-weighted` (44.1 kHz only). Channel
   conversion is `keep`, `fold`, `matrix` or `map`. Names: tokens `{project}`,
   `{region}`, `{index}`, `{date}`, `{format}`; NFC, Windows-forbidden and
   control characters to `_`, device names prefixed `_`, 255 UTF-8 bytes.
   Collisions compare NFC lower case; trusted overwrite needs the last record of
   the name to match size and hash; rename from ` (2)`. The render graph is
   `export-source` → `export-conversion` → `export-output`; the integrator binds
   the span's `PcmSource` and the encoder's sink and quantises before an integer
   encoder. Left to S6: `AudioFileWriter.write` must take `Float64Array` for a
   dithered 32-bit integer export, since a float32 cannot hold every k/2^31; and
   the check that a layout can be stated by the format, against the writers.
6. **S3 (merged through `p09-s3i`).** Framers take encoded units and read each
   unit's duration from the unit; lossy framers are told `inputFrames` at the
   end, which sets end trimming. Opus serial `0x41474f70`, MP4 times 0, so
   output is reproducible. The Vorbis comment rewriter keeps the encoder's
   vendor string and refuses chained or multiplexed streams. Loop tags read
   `LOOPSTART`/`LOOPLENGTH`, `LOOP_START`/`LOOP_LENGTH`, and `LOOPEND`/`LOOP_END`
   as the first frame after the loop; one forward endless loop is written, the
   rest reported dropped. A foreign field is written in the target's free-form
   field. FLAC writes loops as comments and, kept, a `smpl` in `riff` blocks
   framed by the WAV writer's own code; `smpl` wins on read. MP4 uses `co64` only
   past 4 GiB and accepts only AAC-LC with a stated channel configuration. One
   text module (`metadata-text.ts`: end at NUL, decode by the format's stated
   coding, RIFF/IFF UTF-8 else Latin-1, strip C0/C1/DEL, bound) and one limits
   module (`metadata-limits.ts`: 1 MiB per item, 32 MiB per picture, 8 MiB of
   RIFF/IFF chunks, 64 MiB per tagged file, 4,096 fields). Tuning is whole
   cents (AIFF holds no more); a fractional tuning is reported dropped. Writers
   drop and report a value that would not read back unchanged.
   `METADATA_READERS` maps wav, rf64, bw64, aiff, aifc, flac, ogg, mp4, mp3 and
   adts; WebM and Matroska have none. Left to S6: Ogg FLAC metadata, which the
   Ogg reader refuses.
7. **S2b (merged).** The codec module encodes FLAC at every depth from 4 to 32:
   `flacenc` at 8, 12, 16, 20 and 24 bits, its own encoder (`flac_native`,
   libFLAC's LPC method and levels) at the rest; at 32 bits stereo
   decorrelation is off, since the side channel would need 33 bits. The ABI
   stays at version 1. Matroska and WebM blocks are read by the module after
   Symphonia reads the tracks; `CodecDelay` applies to every codec and wins over
   Opus's pre-skip; `DiscardPadding` trims a block's end (positive) or start
   (negative); `SeekPreRoll` is not read, since a session never seeks. A shift
   overflow on eight-byte EBML sizes in s2's `leading_bytes.rs` was fixed.
8. **S6a (merged `091b2ba4`).** `packages/capabilities` probes WebAssembly and
   WebCodecs (`readCodecPlatform`, `probeCodecs`); HE-AAC counts as decodable
   only where both `mp4a.40.5` and `mp4a.40.29` probe. The codec worker
   (`codec-runtime/src/threads/codec-worker.ts`) takes `configure` with compiled
   modules (codec module, LAME, Vorbis, each compiled or unavailable; it never
   fetches) and `connect` ports; requests are `analyse`, `decode`, `encode`,
   `cancel`; replies are read with `readFromCodecWorker`. Analyses run one at a
   time and streams one at a time beside them. Every stream message, the end
   included, waits for credit. Decoded blocks hold at most 65,536 frames and 1
   MiB. An ADTS stream's AudioSpecificConfig comes from its first header. Module
   ambisonics map to AmbiX; an unstated layout gets the WAV default. Metadata a
   reader refuses is `unread` and does not refuse the file. Ogg FLAC metadata
   is read. Decoder identities: Symphonia 0.6.1 and ropus 0.12.18 (a test holds
   them to the Cargo pins), or `WebCodecs (<family>)` with its major version.
9. **S6b (merged).** `openExportEncoder` serves every format through the codec
   worker; integer targets pass one `Quantiser` per file. `SamplePlane`
   (`Float32Array | Float64Array`) makes a dithered 32-bit export exact.
   `writtenChannelOrder` is the statable-layout rule `validateExportSettings`
   uses; coded formats take speaker-mask order; MP3 states mono and stereo only,
   Vorbis at most two channels (the prebuilt build's limit), AAC configurations
   1–7. FLAC re-blocks to 1152 frames up to level 2 and 4096 above; prebuilt
   encoders take fixed 4096-frame blocks so output does not depend on render
   chunking. Vendor `AudioGubbins`; Vorbis serial `0x4147566f`. The render
   worker's `ChannelSink` posts `RenderedStreamMessage` under credit. LAME 3.100
   and libvorbis 1.3.7 come from `wasm-media-encoders` 0.7.0's separate `.wasm`
   files, driven directly (its script inlines them, randomises the Ogg serial and
   refuses 56 and 144 kbit/s). Hashes of nine local encodings are held.
   **Open:** the prebuilt builds cannot express MP3 average bit rate or Vorbis
   nominal bit rate, which ADR-0092's settings name; they are refused when the
   encoder opens (`codec-runtime.setting-unexpressible`). Decide the correct
   fix: build LAME and libvorbis to WebAssembly from source with their full API
   (a C toolchain such as `zig cc` targets wasm32 without emscripten), which also
   lifts the two-channel Vorbis limit and the stale package; or amend ADR-0092.
   Either way, validation must refuse before rendering, never at encode. Also
   open: check in a real browser that Chromium's AAC timestamps carry the
   priming; `apps/web` must import the two `.wasm` URLs and pass them to
   `configure`, and declare `wasm-media-encoders` so its notice appears.
10. **S7 (merged `eb5555ee`).** `AssetProvenance` gains `rendition` (container,
    codec, rate, layout, frames decoded and stated, bit rate, leading frames,
    decoder, and how the source is kept) and `metadata`; the source encoding is
    one record per kind (PCM, G.711, ADPCM). `ProjectState.exportSettings` is set
    by the undoable `project.set-export-settings`. `ExportRecord.file` holds
    settings, name, size, SHA-256, codec and version and reproducibility; new
    destination kinds `file` and `trusted-directory`. `projectDocument` 7 → 8.
    `project-format` depends on `codecs` and `import-export`, so `import-export`
    never depends on `project-format` (ADR-0092's constraint and the packet's
    dependency rule must say so). `DecoderIdentity` is one type in codecs. An
    asset frame is the file position minus the leading frames. Each loop becomes
    a region over the whole asset with a forward endless loop; play count and
    direction stay in provenance. Cover art is described in provenance, not
    stored. Room needed is the copied source plus the rendition's WAV length;
    with no estimate the import proceeds. New cache category `staging` after
    `temporary`, cleared at start only when no other window holds the storage
    lock. A dismissed collision prompt counts as skipped and keeps the staged
    file. Trusted folders live in the IndexedDB handle database
    (`TrustedFolders`, last record per name, 1,024 per folder), not in
    preferences, so `userPreferences` is not raised yet. Protocol: storage
    `imports.connectCodecWorker`, `imports.run`, `exports.stage`,
    `exports.deliver`, `exports.discard`; streams `import:<name>`,
    `staging:<name>`; page-served `collision.ask`.

## Left to do

S1 to S7 are merged into `phase-09-codecs`; the integrated `verify:commit` is
green there (757 files, 11,704 tests). In order:

1. Settle the open item of decision 9: build LAME and libvorbis from source to
   WebAssembly with their full API (MP3 average bit rate, Vorbis nominal bit
   rate, Vorbis above two channels), or amend ADR-0092; either way validation
   refuses before rendering, never at encode.
2. S8, `apps/web`: start the codec worker (compile the codec module, LAME and
   Vorbis `.wasm`, post `configure`, feed `environment` into the capabilities),
   connect it to the storage worker (`connect` + `imports.connectCodecWorker`),
   the import commands (one file, many, a folder) with analysis, staged progress
   and per-file outcomes, the Export dialog (presets with progressive disclosure
   of every setting, ranges: project, region, every region, selection; Quick
   Edit's, the region list's and the File menu's entry points), the export
   pipeline (render worker `channels` → codec worker `encode` →
   `exports.stage` → `exports.deliver`, `exports.discard` after a download), the
   collision prompt (`collision.ask`), trusted folders, `project.set-export-
settings`, the person's own presets (raising `userPreferences`), the
   reference picture's real channel count (Phase 04 debt, read by the codec
   module's demultiplexer), keyboard forms for every action, and
   `test:e2e:import-export` (a Chromium project that imports a compressed file
   and a folder, exports a region to a folder with a collision, and reloads;
   also checks that Chromium's AAC timestamps carry the priming).
3. Amend ADR-0092's dependency constraint (decision 10) and record every
   decision above that changes an ADR's wording; regenerate the spec and run
   `spec:verify`.
4. Run the packet's commands: `test:codecs`, `cargo test --workspace`,
   `test:codec-fixtures`, `test:roundtrip-audio`, `test:malformed-media`,
   `test:opus-conformance`, `test:project-roundtrip`, `test:architecture`, and
   `pnpm run build` then `test:e2e:import-export`. Check every In Scope box and
   acceptance criterion against the code.
5. Write the evidence and the review record (lenses deferred), the handoff, the
   ledger `PASS`, the README's readiness line; run `spec:verify`.
6. Move this note to `docs/todo/done/`, merge `main` in (Phase 08 may have
   landed: raise `projectDocument`, `userPreferences` and any other version
   above `main`'s, rerun `pnpm version:sync` and `pnpm contracts:update`), run
   `verify:commit`, merge into `main` with `--no-ff` from the primary checkout,
   push, remove the worktree, and delete the merged slice branches with
   `git branch -d` (`p09-s1`, `p09-s2`, `p09-s2b`, `p09-s3`, `p09-s3i`,
   `p09-s4`, `p09-s5`, `p09-s6a`, `p09-s6b`, `p09-s7`, `phase-09-codecs`).
