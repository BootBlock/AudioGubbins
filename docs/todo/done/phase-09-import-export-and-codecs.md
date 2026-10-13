> **Status:** Done. 2026-10-13: every slice is built and merged, the scope
> checks' and the build's findings are fixed and written into
> `docs/spec/reviews/phase-09-review.md`, with the review lenses deferred by
> the owner's decision of 2026-10-07. Phase 09 is closed at `PASS` in the
> implementation ledger.

# Phase 09 — Import, Export, and Codec System

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-09-import-export-and-codec-system.md`, and the
decisions that shape the work are `ADR-0090`, `ADR-0091`, `ADR-0092` and
`ADR-0093`.

## Where the work is

|        |                           |
| ------ | ------------------------- |
| Branch | `phase-09-codecs`         |
| Base   | `main` at `1c357d0e`      |
| Head   | see `git log`, not pushed |

Phase 08 landed on `main` at `063c0494`, raising `projectDocument` 7 to 8,
`userPreferences` 1 to 2 and `editorViews` 1 to 2, and `main` is merged into this
branch. Phase 09 takes the next versions: `projectDocument` 8 to 9 (a document of
7 or 8 is refused as older, since nothing migrates before 1.0) and
`userPreferences` 2 to 3, where a record of any other version is refused
and starts from the defaults (decision 12). `packages/domain/src/index.ts` is over its
cohesion threshold: add nothing to it that a consumer does not need.

## Gates

Light gates (owner decision, 2026-10-07): `pnpm run verify:commit` for every
change, `pnpm run spec:verify` after an edit under `docs/spec/`, and the packet's
commands at the phase's end. The review lenses the packet names are deferred to
the review after the whole specification is built. The author of a new test sees
it fail once against the code it guards, with the file copied aside first. Every
full `verify:commit` holds the Gambit resource `build:audiogubbins-verify`.

## Slices

Each slice is a branch from `phase-09-codecs`. The shared
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
   **Settled** by decision 11: the encoders are built from source. Chromium's
   AAC priming is checked by `test:e2e:import-export` where the browser encodes
   AAC.
10. **S7 (merged `eb5555ee`).** `AssetProvenance` gains `rendition` (container,
    codec, rate, layout, frames decoded and stated, bit rate, leading frames,
    decoder, and how the source is kept) and `metadata`; the source encoding is
    one record per kind (PCM, G.711, ADPCM). `ProjectState.exportSettings` is set
    by the undoable `project.set-export-settings`. `ExportRecord.file` holds
    settings, name, size, SHA-256, codec and version and reproducibility; new
    destination kinds `file` and `trusted-directory`. `projectDocument` 8 → 9
    (7 → 8 before Phase 08 took 8).
    `project-format` depends on `codecs` and `import-export`, so `import-export`
    never depends on `project-format`. `DecoderIdentity` is one type in codecs.
    An asset frame is the file position minus the leading frames. Each loop
    becomes a region over the whole asset with a forward endless loop; play
    count and direction stay in provenance. Cover art is described in
    provenance, not stored. Room needed is the copied source plus the
    rendition's WAV length; with no estimate the import proceeds. New cache
    category `staging` after `temporary`, cleared at start only when no other
    window holds the storage lock. A dismissed collision prompt counts as
    skipped and keeps the staged file. Trusted folders live in the IndexedDB
    handle database (`TrustedFolders`, last record per name, 1,024 per folder),
    not in preferences. Protocol: storage `imports.connectCodecWorker`,
    `imports.run`, `exports.stage`, `exports.deliver`, `exports.discard`;
    streams `import:<name>`, `staging:<name>`; page-served `collision.ask`.
11. **S6c (merged).** LAME 3.100, libvorbis 1.3.7 and libogg 1.3.6 are vendored
    unmodified under `third_party/` and built by `zig cc` (Zig 0.17.0, pinned
    by version and SHA-256 per host, fetched once into `target/toolchains`) for
    wasm32-wasi as reactors, on the Rust modules' feature floor, into
    `target/wasm/audiogubbins-mp3.wasm` and `audiogubbins-vorbis.wasm`, each a
    separate replaceable file with an ABI version 1 interface (`native/`). The
    host stubs WASI and refuses I/O. MP3: joint stereo, LAME's default quality,
    variable is `vbr_mtrh` 0–9, average is LAME's ABR. A Vorbis nominal bit
    rate is held by libvorbis's bit-rate manager. Ogg pages for Vorbis and Opus
    come from one TypeScript writer. Descriptors carry `bitRates` bands, and
    `encodingProblems` refuses in validation (and by the same rule in the
    worker) what LAME and libvorbis would change or reject; Vorbis takes 1–8
    channels up to 200 kHz. Symphonia's Vorbis decoder (0.6.1) is vendored
    under `third_party/symphonia-codec-vorbis` with two fixes (residue
    classifications bounded per channel, inverse coupling in reverse) and
    patched in by `[patch.crates-io]`; a Vorbis rendition's decoder is
    `Symphonia 0.6.1+patched`. ADR-0091 and ADR-0092 are amended.
12. **S8 (merged as s8c, s8a, s8b, s8x and s8d).** Contracts:
    `apps/web/src/codecs/codec-services.ts`, `apps/web/src/export/export-types.ts`,
    the ids in `commands/import-export-ids.ts` and the words in
    `import-export-words.ts`. The codec module and both encoders reach the page
    as bundled base64 modules built by the Vite plugin, never fetched; a module
    that will not compile makes its formats unavailable with the reason. The
    `encoded` answer names its encoder; the encoder is recorded at delivery.
    Every import (one file, many, a folder, Quick Edit's) is one batch through
    `imports.importFiles` after `codecs.ready()`; each file's format arrives as
    the job's `recognised` event. An export renders through the playback
    render host at maximum quality, from the edited description; `{project}` is
    the project's name; the room for the whole batch is checked before
    rendering; a refused delivery holds the file for retry or another
    destination without a new render; a download's staging is kept until the
    next export. `userPreferences` 2 → 3 (1 → 2 before Phase 08 took 2) adds
    the person's presets (`own:<name>`, at most 256). S8 first read a
    version-1 record into the new version, keeping its appearance; that
    departed from the spec (ADR-0082, ADR-0092 and both phase packets: no
    migration before 1.0, `REQ-STOR-052`) and was corrected at the merge with
    `main`: a record of any other version is refused and starts from the
    defaults, as Phase 08 refuses it. The Export dialog resolves
    every path through the package's presets and defaults and keeps edits as
    "Your edited settings". The reference picture's sound is weighed at the
    channels the codec worker reads. There is no multitrack mixdown in this
    phase, so the range "the project" is the asset in the editor.
13. **S8e, S6e and S8f (merged).** `test:e2e:import-export` imports a FLAC
    file, refuses a folder's text file with its reason, exports a region with
    "Keep both", checks the History record after a reload, and exports AAC and
    reads it back at the source's length in bundled Chromium. Ten AAC-LC
    fixtures made by FFmpeg's native `aac` encoder hold the decoder to each
    channel's tone, the priming and the length; Symphonia 0.6.1 refuses AAC-LC
    above two channels, so `third_party/symphonia-codec-aac` is vendored and
    patched to decode configurations 3 to 7 to the right speakers (identity
    `0.6.1+patched`; ADR-0091 amended). Metadata and loops round-trip through
    every real encoder that holds them, with each format's dropped fields
    checked; FLAC gains `keepRiffChunks` (default off; ADR-0092 amended). The
    storage each import needs (`known` bytes or `unknown`) is reported before
    storing and shown for every file. The Inspector describes an export
    (REQ-EDIT-072) only when asked, by `export.inspect` (the page's batch) or
    `export.inspect-record` (one History record, also in a read-only tab); it
    gives way when an editor is brought into use or recording claims the
    Inspector (recording's focus counts each claim); the batch is one subject,
    listing every file under the name it was written as. An encoder's version
    names the encoder, so History reads "FLAC by flacenc 0.5.1 in the codec
    module".
14. **S6f (merged).** The bit rates the browser's AAC encoder takes are
    probed: `AudioEncoder.isConfigSupported` for each stream AAC-LC states
    (configurations 1 to 7 at its twelve rates), then every multiple of 8
    kbit/s up to 6,144 bits a channel a frame for each stream accepted, at
    most four questions open, cancellable, once per worker start, kept by the
    page for the session. Chromium's answer matched its encoder exactly, so
    the probe never encodes. Bundled Chromium on Windows takes exactly 96,
    128, 160 and 192 kbit/s, for one, two and six channels at 44.1 and 48 kHz,
    and nothing for three, four, five or eight channels. Each accepted stream
    is one band of exact rates; AAC-LC is encodable only where a band was
    found. Validation and the worker refuse a stream with no band
    (`import-export.stream-not-encoded`) and a rate outside it
    (`import-export.encoding-invalid`), before rendering. The AAC default is
    the highest accepted rate, else 128 kbit/s a channel capped at AAC's
    ceiling. The built-in preset "Distribution, AAC 256 kbit/s" is kept and
    reported as not exportable where the browser refuses it. ADR-0092 amended.

15. **The scope-check gaps (S9d, S9e, S9f, merged).** WAV, AIFF and AIFF-C
    write every integer depth from 8 to 32 bits and FLAC every depth from 4
    to 32 (`PCM_INTEGER_DEPTHS`, `FLAC_DEPTHS` in the codecs): a depth is a
    number, typed in the Export dialog's "Bit depth" field and refused with
    its run named, never rounded; a sample is stored in the next whole byte,
    left-justified; WAV is extensible for an integer depth above 16 bits or
    short of its container; AIFF's and FLAC's default is the source's own
    depth, raised to the format's shallowest. A dither the person never set
    follows the depth; one they set is kept. Nine more byte pins hold
    Microsoft ADPCM, AIFF-C `ima4`, 32-bit FLAC and the new depths. The
    reference picture's sound is a session sound: the storage worker has the
    codec worker analyse and decode it into the staging
    (`cache/staging/session/sound-<token>`, a 32-bit float WAV) after the
    import's room check, and the editor reads it through a plan over that
    file, so no sample passes through the page; a browser that keeps no
    storage cannot open it and says why. Only `packages/capabilities` probes
    the browser's codecs and only `packages/codec-runtime` calls them,
    enforced in `dependency-rules.test.ts`. A codec module's load failure
    reaches the person with its redacted reason (`codec-runtime` depends on
    the diagnostics). Whoever uses a staged file shares the storage lock, and
    the staging is given up, by pressure, cleanup or start, only with that
    lock held alone (`evictUnused`, `cleanAtStart`, which runs media recovery
    then removes staging under one hold). The storage's stream credit counts
    messages asked for and not yet read. `file.import-audio` defaults to
    Ctrl/Cmd+K, Ctrl/Cmd+I. Long files are held to the block caps at the
    injected ports. The AAC browser test takes its branch from the browser
    encoder's own answer; bundled Chromium here encodes AAC at 128 kbit/s.

## Left to do

Nothing. The packet's commands passed on the merged tree, the scope checks'
findings are fixed, and Phase 09 closed at `PASS` on 2026-10-13: the evidence
is `docs/spec/reviews/phase-09-evidence.md`, the review record
`docs/spec/reviews/phase-09-review.md` and the handoff
`docs/spec/traceability/handoffs/phase-09.md`.
