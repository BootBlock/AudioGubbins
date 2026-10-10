# symphonia-codec-aac 0.6.1, vendored and modified

The codec module (`crates/codecs`) decodes AAC-LC through Symphonia's AAC
decoder. The workspace's `Cargo.toml` patches this copy in, in `crate/`, in
place of the crate from crates.io, because the published crate refuses every
AAC-LC stream of more than two channels, so a 5.1 file, which AudioGubbins
itself exports, could not be imported, and nothing may repair a decoder's
output after it (ADR-0091). The crate is licensed under the Mozilla Public
License 2.0 (`crate/LICENSE`); the files changed are shipped as they are here.

| Crate            | <https://crates.io/crates/symphonia-codec-aac/0.6.1>                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| Version          | 0.6.1, the version `Cargo.lock` pinned                                               |
| `.crate` SHA-256 | `f5bf8e39552d34a3c4c98333370e62f48c92456d2e814f273b5c3ad7c4a5f45c`                   |
| Checked against  | the checksum `Cargo.lock` recorded for the registry's crate before it was patched in |

Every file is as the `.crate` archive holds it but the change below, marked in
the source by comments beginning `AudioGubbins:`.

## Change

**Channel configurations 3 to 7 are decoded, each channel to its speaker**
(`src/aac/mod.rs`, `src/aac/cpe.rs`). The decoder refused any stream of more
than two channels as too complex, although nothing in its element decoding is
limited to two, and it wrote each element's channels to the output planes in
the order the elements came, where the planes are in the order of the
layout's speaker positions: lifting the refusal alone would put configuration
6's centre at the front left. The decoder now takes, for each of channel
configurations 3 to 7, the elements ISO/IEC 14496-3 (Table 1.19) places in a
raw data block and the speaker of each channel they hold, and writes each
channel to its speaker's plane; an element other than the one the
configuration places next is refused as invalid data, since its channels
would reach the wrong speaker. Configuration 7's first channel pair is the
centre-front pair and its second the outside-front pair, as the standard and
Apple's `AAC_7_1` layout read it, and as the crate's own layout for the
configuration, `CHANNEL_LAYOUT_AAC_7P1`, states. (FFmpeg 5.1 reads it as 7.1
with side speakers instead, its encoder and decoder agreeing with each other
and not with the standard.) One and two
channels are decoded as the published crate decodes them. A program
configuration element (configuration 0) and a coupling channel element are
still refused as unsupported, as before.

Upstream had not lifted the limit at 0.6.1. The codec module's decoder
identity names this build `0.6.1+patched`, so an asset's provenance records
which decoder made its rendition. The codec runtime's
`src/decoding/aac-lc-fixtures.test.ts` decodes FFmpeg-encoded files of every
configuration from 1 to 7 and holds each channel to the tone its speaker was
given.
