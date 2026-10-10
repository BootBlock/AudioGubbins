# libogg 1.3.6, vendored

The Vorbis encoder module (`target/wasm/audiogubbins-vorbis.wasm`) is built
with libogg's bit packer (`src/bitwise.c`), which libvorbis writes its packets
with, by `tools/build-encoder-modules.mjs`. The application's own Ogg writer
makes the pages, so libogg's framing is not built. libogg is licensed under the
BSD-3-Clause licence in `COPYING`.

| Release archive | <https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.xz>         |
| --------------- | --------------------------------------------------------------------- |
| Version         | 1.3.6                                                                 |
| SHA-256         | `5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061`    |
| Checked against | <https://downloads.xiph.org/releases/ogg/SHA256SUMS>, which states it |

Only `src/`, `include/` and `COPYING` are kept, byte for byte as the archive
holds them, and nothing here is modified: the integer types its configure
script would write are `native/vorbis-encoder/config/ogg/config_types.h`.
