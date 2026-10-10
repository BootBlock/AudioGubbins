# symphonia-codec-vorbis 0.6.1, vendored and modified

The codec module (`crates/codecs`) decodes Vorbis through Symphonia's Vorbis
decoder. The workspace's `Cargo.toml` patches this copy in, in `crate/`, in
place of the crate from crates.io, because the published crate decodes some
valid multichannel Vorbis streams wrongly, and nothing may repair a decoder's
output after it (ADR-0091). The crate is licensed under the Mozilla Public
License 2.0 (`crate/LICENSE`); the files changed are shipped as they are here.

| Crate            | <https://crates.io/crates/symphonia-codec-vorbis/0.6.1>                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| Version          | 0.6.1, the version `Cargo.lock` pinned                                               |
| `.crate` SHA-256 | `73d90b4fcf796137cc683c538282804ff9629f8ad9dbfd881fcbba331ac4e986`                   |
| Checked against  | the checksum `Cargo.lock` recorded for the registry's crate before it was patched in |

Every file is as the `.crate` archive holds it but the two changes below, each
marked in the source by a comment beginning `AudioGubbins:`.

## Changes

1. **The residue classifications of each channel are its own**
   (`src/residue.rs`, in `read_residue_inner_type_0_1`). Formats 0 and 1 keep
   every channel's partition classifications in one array, each channel's run
   `parts_to_read` long, and the slice given to `decode_classes` ran to the end
   of the array. Where a residue's partitions are not a whole number of
   classwords, the last classword of a channel wrote past its run into the next
   channel's first classifications, which the passes after the first then read,
   so the rest of the packet was decoded from the wrong codebooks. The slice now
   ends at the channel's own run, where `decode_classes` drops a classword's
   excess as it does for the last channel (Vorbis I, section 8.6.2). libvorbis
   writes such residues for three or more uncoupled channels whenever its
   bandwidth limit ends the residue short of the block, as 7.1 at quality 5 and
   48 kHz does.
2. **Inverse coupling runs from the last step to the first** (`src/lib.rs`, in
   the packet decode). Vorbis I inverts the coupling steps in descending order
   (sections 1.3.2 and 4.3.5); the crate inverted them in ascending order, which
   is the same only for a mapping of one step. libvorbis's 5.1 setup, which it
   uses for six channels from 40 to 70 kHz, couples in four steps.

Upstream had fixed neither at 0.6.1. The codec module's decoder identity names
this build `0.6.1+patched`, so an asset's provenance records which decoder made
its rendition.
