> **Status:** In progress. 2026-10-10: the readiness review is done and the
> phase is `READY` (`ADR-0090` to `ADR-0093`); the shared codec contracts are
> in `packages/codecs`; the build's slices are under way.

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

## Left to do

1. Build S1 to S5 in parallel, then S6 and S7, then S8.
2. Run the packet's commands, check every In Scope box and acceptance criterion
   against the code.
3. Write the evidence, the review record with the lenses deferred, the handoff,
   the ledger `PASS`, the README's readiness line; run `spec:verify`.
4. Move this note to `docs/todo/done/`, merge `main` in, raise the versions above
   `main`'s, run `verify:commit`, merge into `main` with `--no-ff`, push, and
   remove every worktree made for the phase.
