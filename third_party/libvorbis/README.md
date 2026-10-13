# libvorbis 1.3.7, vendored

The Vorbis encoder module (`target/wasm/audiogubbins-vorbis.wasm`) is built
from this source by `tools/build-encoder-modules.mjs`, with libogg's bit packer
(`third_party/libogg/`) and the interface in `native/vorbis-encoder/`.
libvorbis is licensed under the BSD-3-Clause licence in `COPYING`.

| Release archive | <https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz>      |
| --------------- | ------------------------------------------------------------------------ |
| Version         | 1.3.7                                                                    |
| SHA-256         | `b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b`       |
| Checked against | <https://downloads.xiph.org/releases/vorbis/SHA256SUMS>, which states it |

Only `lib/`, `include/` and `COPYING` are kept, byte for byte as the archive
holds them, and nothing here is modified.
