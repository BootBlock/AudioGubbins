# LAME 3.100, vendored

The MP3 encoder module (`target/wasm/audiogubbins-mp3.wasm`) is built from this
source by `tools/build-encoder-modules.mjs`, with the interface in
`native/mp3-encoder/`. LAME is licensed under the GNU Library General Public
License, version 2 or later (`COPYING`); this folder is the corresponding source
of the module, which is a separate file a person can replace with a build of
the same interface.

| Release archive | <https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz>         |
| --------------- | ------------------------------------------------------------------------------------- |
| Version         | 3.100                                                                                 |
| SHA-256         | `ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`                    |
| Checked against | Debian's `lame_3.100-6.dsc`, which records the same hash for `lame_3.100.orig.tar.gz` |

Only `libmp3lame/`, `include/lame.h`, `COPYING`, `LICENSE` and `README` are
kept, byte for byte as the archive holds them. Nothing here is modified: the
build configuration is `native/mp3-encoder/config.h`, and LAME's reports are
silenced through its own interface.
