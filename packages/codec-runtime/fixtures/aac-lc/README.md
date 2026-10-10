# AAC-LC decoding fixtures

Real AAC-LC files, which the codec module's decoding tests
(`src/decoding/aac-lc-fixtures.test.ts`) decode and check channel by channel.
Nothing in the repository encodes AAC (an AAC export is the browser's), so
these are the only fixtures here not generated as a test runs (REQ-REPO-191).
Each holds generated content alone: in each channel a sine of its own
frequency and level, starting at phase 0, so a decoded channel can be compared
with exactly what it was made from. There is no recorded audio and nothing of
another's to license.

They were made by FFmpeg's own AAC encoder (`aac`, not `libfdk_aac`), with
bit-exact flags so they carry no encoder version string, and FFmpeg's default
muxers: ADTS (`-f adts`) and MP4 (`.m4a`), whose edit list states the
encoder's priming of 1,024 frames and the stream's length.

| FFmpeg | `ffmpeg version 5.1.2-essentials_build-www.gyan.dev` |
| ------ | ---------------------------------------------------- |

## Files

| File                | Channels (FFmpeg's layout) | Frames | Bytes  | SHA-256                                                            |
| ------------------- | -------------------------- | ------ | ------ | ------------------------------------------------------------------ |
| `aac-lc-mono.aac`   | 1                          | 44,100 | 15,255 | `2cc2a0d8b5c6264790d967d0ba4feec3b030ee2e9ea6793ff8950c50852e267e` |
| `aac-lc-mono.m4a`   | 1                          | 44,100 | 15,890 | `ec5fd58066df4f131c7ddad28c986fc136ccd41b13330a742fc1c6971486f0f1` |
| `aac-lc-stereo.aac` | 2                          | 44,100 | 24,969 | `7c325c928d374f061345c73bc3581a4774262240895e85bf2b67bd661de999bc` |
| `aac-lc-stereo.m4a` | 2                          | 44,100 | 25,604 | `b925b0f5f020a256235b0caf2a5513f73205285a9dcd0da60d5b5110150e2a25` |

## Commands

Run in a POSIX shell in this folder. Every sine starts at phase 0 at frame 0.

```sh
OUT='-c:a aac -fflags +bitexact -flags:a +bitexact -map_metadata -1'
make() { ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc=exprs=$1:s=44100:d=$2:c=$3" $OUT -b:a "$4" "$5"; }
MONO='0.5*sin(2*PI*440*t)'
STEREO='0.5*sin(2*PI*440*t)|0.25*sin(2*PI*1000*t)'
make "$MONO" 1 mono 128k aac-lc-mono.aac
make "$MONO" 1 mono 128k aac-lc-mono.m4a
make "$STEREO" 1 stereo 192k aac-lc-stereo.aac
make "$STEREO" 1 stereo 192k aac-lc-stereo.m4a
```

The same FFmpeg build makes the same bytes from these commands; another build
of the encoder may not, so a fixture is changed only by a deliberate change
that records the new hashes here.
