# Phase 09 — Import, Export, and Codec System — Review Record

## The owner's decision

On 2026-10-07 the owner decided that in-depth reviews, audits and their fix
rounds happen once, after the whole specification is implemented, and not
during any phase; a lens a phase packet requires is to be recorded as
deferred to the post-implementation review instead. Phase 09 therefore ran no
independent review lens. In their place two read-only scope checks, by agents
that had not built what they read, compared the code with the packet; the
build found fourteen more defects, the fix round of the second check found
two, and the closing run of the packet's commands one.

The slices of the build and of the fix rounds ran the tests of what they
changed, the type checks and lint; one full `pnpm run verify:commit` runs
over the integrated branch, recorded in the evidence
(`reviews/phase-09-evidence.md`).

Severity follows `contracts/review-gates.md`. `BLOCKER`, `CRITICAL` and `HIGH`
prevent `PASS`. `MEDIUM` must be fixed or explicitly accepted with
justification and tracking. `LOW` and `NOTE` may remain if tracked.

**Status** `CONFIRMED` means established by reading the code against the
packet, or, for a finding the build made, reproduced by a failing test or
browser run. No finding was rejected. Findings are numbered for this phase
alone: the scope checks' from F-01, the build's from B-01.

## Lenses deferred

Each lens `phases/phase-09-import-export-and-codec-system.md` requires is
deferred to the review after the whole specification is implemented:

| Lens | Disposition |
| --- | --- |
| Codec / Interchange Correctness | Deferred to the post-specification review. |
| Audio / DSP Correctness | Deferred to the post-specification review. |
| Security / Malformed Input | Deferred to the post-specification review. |
| Performance / Scalability | Deferred to the post-specification review. |
| Testing / Regression | Deferred to the post-specification review. |
| Architecture | Deferred to the post-specification review. |
| Adversarial Agent-Quality | Deferred to the post-specification review. |

## The scope checks

Each check read the code against every In Scope item, acceptance criterion,
architectural invariant, cross-package rule, failure and recovery behaviour,
forbidden shortcut, inherited debt and required public contract of the
packet, and against `ADR-0090` to `ADR-0093`, and edited nothing.

The first read the branch once slices S1 to S8 were merged (`19c43426`). It
found four parts carried out in part or untested: F-01 to F-04. The second
read it once every slice and `main` were merged (`bfb35b65`). It found two
defects that prevent `PASS`, F-05 and F-06, and seven smaller items, F-07 to
F-13. Each was confirmed by reading the code again.

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-01 | MEDIUM | CONFIRMED | Metadata and loops were round-tripped through the writers alone, not through the real encoders of every format that holds them, and no test named what each format drops (`ADR-0093`, the packet's `pnpm test:roundtrip-audio`). |
| F-02 | MEDIUM | CONFIRMED | The storage an import needs was weighed but not reported before storing, so the import views could not show it for each file (In Scope: "the storage needed stated before storing"). |
| F-03 | MEDIUM | CONFIRMED | The Inspector described an asset's source but not an export job (`REQ-EDIT-072`). |
| F-04 | MEDIUM | CONFIRMED | The codec module's AAC decoding was tested only on streams the module made itself; no real AAC-LC file held it to each channel's tone, the priming and the length. Real files then showed it refused AAC-LC above two channels (B-03). |
| F-05 | HIGH | CONFIRMED | A reference picture's sound was read whole into the page's memory and decoded there by the browser's `decodeAudioData`, a browser decoder for formats the codec module serves; and nothing enforced that only `packages/codec-runtime` calls the browser's codecs (the packet's cross-package rules, invariants and forbidden shortcuts). |
| F-06 | MEDIUM | CONFIRMED | Every local export is to be held by hashes (In Scope; `ADR-0091`'s deterministic path), but no byte pin held WAV Microsoft ADPCM, AIFF-C `ima4` or 32-bit FLAC, the codec module's own encoder. And WAV, AIFF and AIFF-C wrote only 8, 16, 24 and 32 bits, FLAC only 16, 24 and 32, where the packet and `ADR-0091` say every integer depth from 8 to 32 bits. |
| F-07 | LOW | CONFIRMED | A codec module or encoder that failed to load made its formats unavailable with a fixed sentence; why it failed reached only the log (failure behaviour: "makes its formats unavailable with the reason"). |
| F-08 | LOW | CONFIRMED | The third acceptance criterion, no long file held whole or twice, had structural evidence alone: no test drove a long file through the codec worker or the storage. |
| F-09 | LOW | CONFIRMED | No test showed the storage worker clearing the staging at start; only the function that clears it was tested. Testing it found that it never ran (B-15). |
| F-10 | LOW | CONFIRMED | Only exporting audio had a default shortcut, and no palette test named an import or export command (`REQ-UX-005`). |
| F-11 | LOW | CONFIRMED | The WAV matrix and the WAV writer's form test printed "undefined" for every coded format, and the form test printed each case's index where its title said the format tag. |
| F-12 | NOTE | CONFIRMED | The AAC browser test did not say which of its two branches ran, so a page that wrongly called AAC unwritable passed down the other. |
| F-13 | NOTE | CONFIRMED | The resume note's list of what was left named slices already merged. |

## Found by the build

The slices found B-01 to B-14 while building, while running the codec
fixtures and the browser suite, and at the merge of `main`; the fix round of
the second scope check found B-15 and B-16, and the closing run of the
packet's commands B-17.

| Id | Severity | Status | Finding |
| --- | --- | --- | --- |
| B-01 | MEDIUM | CONFIRMED | The codec module's EBML reader overflowed a shift on a size of eight bytes, the size muxers reserve before they know it: a debug build panicked and a release build misread a valid Matroska or WebM file. |
| B-02 | HIGH | CONFIRMED | Symphonia 0.6.1's Vorbis decoder garbled two kinds of valid multichannel stream libvorbis writes: a channel's residue classifications overwrote the next channel's where the partitions are not whole classwords, and the coupling steps were inverted first to last (Vorbis I, sections 8.6.2, 1.3.2 and 4.3.5). |
| B-03 | HIGH | CONFIRMED | Symphonia 0.6.1's AAC decoder refused every AAC-LC stream above two channels, so a 5.1 file, which AudioGubbins itself exports, could not be imported; and it wrote an element's channels in the order the elements came, not to their speakers. |
| B-04 | MEDIUM | CONFIRMED | The AAC default, 128 kbit/s a channel, is refused by Chromium's encoder on Windows, which takes 96 to 192 kbit/s for stereo, so a default AAC export rendered and then failed at encode. |
| B-05 | MEDIUM | CONFIRMED | An AAC export the browser's encoder closed on failed with `InvalidStateError` for a closed codec, not the browser's reason, and a block waiting for the queue could wait for ever. |
| B-06 | MEDIUM | CONFIRMED | A codec job that met a fault closed its ports and left the render worker and the storage worker waiting, so the page's export stayed at its render's progress, saying nothing. |
| B-07 | LOW | CONFIRMED | On a fresh checkout the MP3 and Vorbis encoder modules' builds ran at once, and the second download of the pinned Zig failed with `EPERM`, failing the application's first build. |
| B-08 | LOW | CONFIRMED | A second asset opened in an editor panel was left at no width, showing nothing and selecting nothing until the panel was resized. |
| B-09 | LOW | CONFIRMED | The export named its file after the asset where `{project}` is the project's name (`ADR-0092`). |
| B-10 | MEDIUM | CONFIRMED | The person's preferences of an earlier version were read into the new one, a migration the specification forbids before 1.0 (`REQ-STOR-052`, `ADR-0092`); found at the merge of `main`. |
| B-11 | LOW | CONFIRMED | The evidence-commands test refused Phase 08's crate-scoped Rust test once `main` was merged, since its list of commands outside the manifest named only the workspace's. |
| B-12 | LOW | CONFIRMED | The browser suite made its FLAC files with settings written before FLAC gained `keepRiffChunks`, so its requests lacked a setting every FLAC request now states. |
| B-13 | MEDIUM | CONFIRMED | The Export dialog took a format's default dither only when the format was chosen, so a depth changed afterwards to 16 or 8 bits from a float default was quantised undithered though the person never set the dither (`ADR-0092`). |
| B-14 | MEDIUM | CONFIRMED | Storage pressure and the person's cleanup gave up the whole staging category, so a held sound, an export kept for a retry or another destination, a download's file or a rendition being decoded could vanish while in use. |
| B-15 | MEDIUM | CONFIRMED | The storage worker started the media store's recovery and the clearing of the staging at once, each asking for the storage lock alone; the recovery always won, so the staging was never cleared at start. |
| B-16 | MEDIUM | CONFIRMED | The storage worker's end of a codec worker's stream gave credit back counting only the messages still to come, not those arrived and unread, so a slow storage let most of a window more cross at each read: 82 bodies of 1 MiB were waiting at once where the window is 8. |
| B-17 | LOW | CONFIRMED | `pnpm run test:e2e:import-export` failed at `ec6945cf`: the suite chose the bit depth from a list, which the field a depth is typed into had replaced (F-06), so it waited out its time. |

## Disposition

Every finding is fixed: the first scope check's by slices S8e, S6e, S8f and
S6f, merged by `d23a18e1`, `0b4313a3`, `29ab149b` and `1b48d775`; the
second's by slices S9d, S9e and S9f, merged by `6170ded0`, `b1711fc2`,
`44b6c067`, `578b8fdb` and `e8c28ee2`, and by `5ee025a2`; the build's in the
slices that found them, and B-17 on the phase branch.

| Id | Disposition |
| --- | --- |
| F-01 | **Fixed** in `e538130b`. Metadata, loops and cues go through the real encoders of WAV, AIFF, AIFF-C, FLAC, Ogg Vorbis, Opus, MP3 and AAC in M4A, and each format's dropped fields are named; FLAC gains `keepRiffChunks` (`1e04ae06`; `ADR-0092` amended). Held by "WAV holds what it can, and reports exactly what it dropped", "FLAC, its loops as comments holds what it can, and reports exactly what it dropped", "Ogg Vorbis holds what it can, and reports exactly what it dropped", "Opus holds what it can, and reports exactly what it dropped", "MP3 holds what it can, and reports exactly what it dropped" and "AAC in M4A holds what it can, and reports exactly what it dropped" (`packages/codec-runtime/src/encoding/export-roundtrip-metadata.test.ts`). |
| F-02 | **Fixed** in `ba1335ac`. Each import's entry keeps the storage it needs, known bytes or unknown, reported before anything is stored and shown for every file. Held by "keeps the storage a file needs on its entry, known or not, whatever the file comes to" (`packages/import-export/src/import-job.test.ts`) and "lists each file with its size, format, storage needed and stage, and a named bar for a measured stage" (`apps/web/src/shell/import/import-list.test.tsx`). |
| F-03 | **Fixed** in `fb326925`, `3b63c09c`, `58d71fb7` and `a3cb1948`. `export.inspect` and `export.inspect-record` describe the page's export or one History record in the Inspector. Held by "describes the last export, its settings and each file with where it went", "describes an export the history records, opened from the History panel" and "gives the Inspector back to the editor once one is brought into use" (`apps/web/src/shell/inspector/export-description.test.tsx`), and "names the region, the point it was made from, where it went and what it was" (`apps/web/src/shell/inspector/export-facts.test.ts`). |
| F-04 | **Fixed** in `5d15fd13`, `29afd854` and `f6637f7d`: ten AAC-LC files made by FFmpeg's own `aac` encoder (`packages/codec-runtime/fixtures/aac-lc/`) hold the decoder to each channel's tone, the priming and the length, and found B-03. Held by "decodes aac-lc-stereo.m4a to its tones, in speaker-mask order", "decodes aac-lc-5.1.m4a to its tones, in speaker-mask order" and "decodes aac-lc-7.1.aac to its tones, in speaker-mask order" (`packages/codec-runtime/src/decoding/aac-lc-fixtures.test.ts`). |
| F-05 | **Fixed** in `a72760a0`, `486b9142`, `a55971f2` and `dcf909af`. A reference picture's sound takes an import's path into the storage's staging: the storage worker has the codec worker analyse it and decode it, at its own rate and in its own channels, into a 32-bit float WAV it holds for the session, and the editor reads it through a plan over that file, so no sample passes through the page and nothing of it is held whole; Phase 04's channel bound is retired (`ADR-0050` amended). An architecture rule reads every production source for a probe of the browser's codecs outside `packages/capabilities` and a call outside `packages/codec-runtime`. Held by "probes the browser’s codecs only from the capabilities package" and "calls the browser’s codecs only from the codec runtime" (`tests/architecture/dependency-rules.test.ts`), which fails on the page decoder this fix removed; "decodes the file into the staging, as a WAV file of the stream read back whole", "shares the storage-wide lock while it holds a sound, and removes it once let go" and "refuses a file the codecs here cannot decode with the reason an import gives, decoding nothing" (`packages/storage/src/session-sounds.test.ts`); "opens the sound when asked, decoded into the storage and read from the file it holds" (`apps/web/src/commands/editor-commands.test.ts`); and "becomes an asset at the rate the file holds it, read from the file the storage holds" (`apps/web/src/picture/reference-picture.test.ts`). |
| F-06 | **Fixed** in `e0eea3b0` and `3dd942c5`. WAV, AIFF and AIFF-C write every integer depth from 8 to 32 bits and FLAC every depth from 4 to 32, the runs stated once (`PCM_INTEGER_DEPTHS`, `FLAC_DEPTHS`); nine more byte pins hold WAV Microsoft ADPCM, AIFF-C `ima4`, FLAC at 32 and 13 bits (the module's own encoder), FLAC at 20 and 12, WAV at 20 and 12 and AIFF at 20 (`ADR-0092` amended). Held by "gives the same bytes for the same blocks and settings, however they are blocked" (`packages/codec-runtime/src/encoding/export-roundtrip-lossless.test.ts`), whose hashes now include the nine; "writes 20 bits left-justified in whole bytes, stating its valid bits, and reads back exactly" (`packages/codecs/src/wav-writer.test.ts`) and "states 20 bits in COMM, left-justifies each sample in whole bytes, and reads back exactly" (`packages/codecs/src/aiff-writer.test.ts`), one for every depth; "give back every depth bit for bit, in FLAC’s own channel order"; "takes every whole integer depth WAV, AIFF and AIFF-C hold, 8 to 32 bits, and FLAC, 4 to 32" (`packages/import-export/src/settings-validation.test.ts`); and "takes any integer depth typed, and says why one no format holds cannot be exported" (`apps/web/src/shell/export/export-dialog.test.tsx`). |
| F-07 | **Fixed** in `218123b8`. A module's load carries its reason, redacted by the diagnostics' rules, to the person. Held by "says why the module failed, redacted, where the page could not load it" and "says why the module failed where it would not instantiate, refusing its formats with it" (`packages/codec-runtime/src/worker/codec-worker-analyse.test.ts`), and "make the formats of a module they could not compile or load unavailable, with the reason, and keep the rest" (`apps/web/src/codecs/codec-thread.test.ts`). |
| F-08 | **Fixed** in `83f45d37` and `9ebdf1ac`. Files made as they are read, and a render made as it is sent, go through the codec worker and the storage, every read, write and message measured at the ports. Held by "analyses an RF64 file past four gibibytes from its head and the chunk after its data, reading none of the data", "decodes a long 5.1 FLAC file in blocks within the caps, reading it about once, never past credit" and "encodes a render past four gibibytes to RF64 a block at a time, the credit of both channels bounding what is between them" (`packages/codec-runtime/src/worker/codec-worker-long-files.test.ts`), and "writes a 5.1 rendition a block at a time and stores it in reads and writes of at most a block" and "stages an export past four gibibytes a body at a time, reads it back once for its hash and once to deliver it, a chunk at a time" (`packages/storage/src/long-files.test.ts`). |
| F-09 | **Fixed** in `48adf195`, which also fixes B-15. Held by "removes everything staged, and nothing else, where no window holds the storage lock" and "keeps what is staged where another window shares the storage lock" (`packages/storage-runtime/src/host/storage-host.staging.test.ts`). |
| F-10 | **Fixed** in `5b56c3dd`. Importing audio files defaults to Ctrl+K, Ctrl+I (Command on Apple), beside exporting's Ctrl+K, Ctrl+E. Held by "reaches importing and exporting from the keyboard, each of the pair on its own chord" (`apps/web/src/shell/command-palette.test.tsx`) and "offers import and export in the File menu, each of the pair opening on a chord" (`apps/web/src/shell/menus.test.ts`). |
| F-11 | **Fixed** in `5ee025a2`. Each case carries the name and tag its title prints; no assertion changed. Held by "writes stereo G.711 A-law with format tag 6, and a fact chunk where it is not integer PCM" (`packages/codecs/src/wav-writer.test.ts`) and "reads back at every rate and channel count as the format says it must", now under each format's name, Microsoft ADPCM among them (`packages/codecs/src/wav-matrix.test.ts`). |
| F-12 | **Fixed** in `24725635`. The browser's encoder is asked directly, apart from the page's probe, and the Format list must name AAC as it answered before either branch runs. Held by "exports AAC and reads back the source’s frames where the browser encodes it, and offers it as unavailable with what can be written where it does not" (`tests/e2e/import-export.spec.ts`), which took the encoding branch in bundled Chromium. |
| F-13 | **Fixed** in `397fad21` and `ec6945cf`. |
| B-01 | **Fixed** in `5ff6ac18`. The shift is checked, so an eight-byte size reads as its later bytes. Held by the Rust test `reads_a_header_whose_size_takes_eight_bytes` in `crates/codecs`. |
| B-02 | **Fixed** in `63b5e420`. Symphonia's Vorbis decoder is vendored at its pinned release under `third_party/symphonia-codec-vorbis` with the two fixes, patched in by the workspace and noticed as modified (`ADR-0091` amended). Held by "decodes a residue whose partitions are not whole classwords in every channel" and "inverts a coupling of several steps last first, as libvorbis’s 5.1 setup needs" (`packages/codec-runtime/src/decoding/vorbis-multichannel.test.ts`). |
| B-03 | **Fixed** in `29afd854` and `f6637f7d`. Symphonia's AAC decoder is vendored under `third_party/symphonia-codec-aac`, patched to decode configurations 3 to 7, each channel to its speaker (`ADR-0091` amended). Held by "decodes aac-lc-5.1.aac to its tones, in speaker-mask order" and "refuses a stream whose elements are not the ones its channel configuration places" (`packages/codec-runtime/src/decoding/aac-lc-fixtures.test.ts`). |
| B-04 | **Fixed** in `4a4f57de` and `d6559fe2`. The bit rates the browser's AAC encoder takes are probed into the capability; validation and the codec worker refuse a stream or rate outside them before rendering, and the default is the highest accepted (`ADR-0092` amended). Held by "finds the bit rates Media Foundation's encoder takes, one band for each stream it takes" and "holds at most four questions open at once" (`packages/capabilities/src/aac-bit-rate-probe.test.ts`), and "defaults to the highest bit rate the encoder codes the stream at" and "refuses a bit rate the encoder does not code, naming those it does, before rendering" (`packages/import-export/src/aac-bit-rates.test.ts`). |
| B-05 | **Fixed** in `364176de`. Held by "fails the export with the browser’s reason where it refuses the configuration after taking it" and "fails a block waiting for the queue to drain where the encoder fails instead" (`packages/codec-runtime/src/encoding/export-roundtrip-aac.test.ts`). |
| B-06 | **Fixed** in `f69b4bcb`. A job ends its streams with the codec worker's fault before the worker answers. Held by "ends the stream with a fault the decode meets, so the storage worker does not wait on it" (`codec-worker-decode.test.ts`) and "ends both streams with a fault the encoder throws, so neither worker waits on a stream that will never come" (`codec-worker-protocol.test.ts`). |
| B-07 | **Fixed** in `2936067a`. A caller that asks while a build with the same flags runs joins it. Held by "is joined, not started again, by a caller that asks while it runs" (`tests/encoder-module-build.test.ts`). |
| B-08 | **Fixed** in `85b91e97`. Held by "fits an asset opened in a view already laid out to its width, as it fitted the first" (`apps/web/src/shell/editor-panel.test.tsx`). |
| B-09 | **Fixed** in `1a7899bb`. Held by the export commands' and the page export's tests, whose files now carry the project's name (`apps/web/src/commands/export-commands.test.ts`, `apps/web/src/export/export-control.test.ts`). |
| B-10 | **Fixed** in `bfb35b65`. A record of any other version is refused and starts from the defaults, as Phase 08 refuses it. Held by "are refused, not migrated, and say so: the second version’s start from the defaults" and "refuses a record of a later version, saying so, and starts from the defaults" (`apps/web/src/state/preferences-store.test.ts`). |
| B-11 | **Fixed** in `f0d07fd5`. The list names `cargo test -p audiogubbins-analysis` beside the workspace's. Held by `tests/evidence-commands.test.ts`. |
| B-12 | **Fixed** in `c6d67caf`. Held by the full type check and `pnpm run test:e2e:import-export`. |
| B-13 | **Fixed** in `ad079dc2`. A dither the person never set follows the depth; one they set is kept (`ADR-0092` amended). Held by "takes the dither a new depth defaults to, until the person sets the dither themselves" (`apps/web/src/state/export-dialog-store.test.ts`). |
| B-14 | **Fixed** in `b3c00dca`. Whoever uses a staged file shares the storage lock, and the staging is given up only with that lock held alone (`ADR-0092` amended). Held by "keeps a held sound under storage pressure, giving up every other cache", "keeps the staging while another window shares the lock, as one staging an export does" and "says a cleanup of the staging removed nothing while a sound is held" (`packages/storage/src/cache-eviction.test.ts`). |
| B-15 | **Fixed** in `48adf195`. `cleanAtStart` runs the recovery and then removes the staging under one hold of the lock alone. Held by "recovers the media store and removes everything staged, and nothing else, where no window holds the lock" and "still recovers the media store where the storage refuses to remove the staging" (`packages/storage/src/start-up-cleaning.test.ts`). |
| B-16 | **Fixed** in `4cf38986`. Credit counts the messages asked for and not yet read. Held by "holds what has crossed and is not yet read to its window of credit, however slowly it reads" (`packages/storage-runtime/src/host/credited-stream-port.test.ts`). |
| B-17 | **Fixed** in `35f924f9`. The suite types the depth, as it types a bit rate. Held by "imports a FLAC file and a folder, exports a region beside a file of its name, and finds the export in the History after a reload" (`tests/e2e/import-export.spec.ts`), which passed after it. |
