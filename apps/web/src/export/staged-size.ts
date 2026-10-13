/**
 * The most bytes an export's file can take in the staging area, worked out
 * before anything renders, so the storage estimate is checked against it and
 * an export the storage cannot hold is refused before it starts (ADR-0092).
 *
 * An upper bound, never a guess: where an encoder could write more than its
 * setting asks, the bound is what the format cannot exceed. Uncompressed PCM
 * is its samples at their width; FLAC is never larger than its samples stored
 * verbatim, one bit wider for a stereo side channel, with each frame's header;
 * MP3 is never more than its largest frame (320 kbit/s, or 160 kbit/s at the
 * lower rates, of 1,441 bytes) for each frame of its length; Vorbis, Opus and
 * AAC, whose rate a quality setting or a variable rate may exceed, are bounded
 * by the same audio as 16-bit PCM, which none of them comes near, with their
 * container's pages or tables. Every file has room for its head and the
 * metadata it carries, the text counted at three bytes a character, the most
 * UTF-8 takes for one UTF-16 unit.
 */

import { containerBytes, type MetadataMap } from '@audiogubbins/codecs';
import { channelCount, type ChannelLayout } from '@audiogubbins/domain';
import type { ExportSettings } from '@audiogubbins/import-export';

/** What a file's head may take besides its metadata: every chunk, box or page header a format writes. */
const HEAD_BYTES = 64 * 1024;

/** The most bytes a UTF-8 character takes for each UTF-16 unit of the text it came from. */
const BYTES_PER_UNIT = 3;

/** What each cue, loop or field may add besides its text: positions, lengths and headers. */
const ITEM_BYTES = 128;

/** The bytes of an MP3 frame at its largest, at either family of rates. */
const MP3_LARGEST_FRAME = 1_441;

/** The lowest rate of MPEG-1's frames; below it, MPEG-2's and 2.5's carry half the audio. */
const MP3_FULL_RATE = 32_000;

/** The frames of audio in an MP3 frame at 32 kHz and above, and below. */
const MP3_FRAME_SAMPLES = { full: 1_152, lower: 576 } as const;

/** The frames FLAC's smallest blocks hold, at the lowest compression levels. */
const FLAC_SMALLEST_BLOCK = 1_152;

/** A FLAC frame's header and footer at their largest, and each subframe's header. */
const FLAC_FRAME_HEAD = 18;

/** What an Ogg page or an MP4 sample table adds to a lossy codec's packets, at most, as a share. */
const LOSSY_CONTAINER_SHARE = 1.05;

/** The rate Opus always codes at, whatever the export's. */
const OPUS_RATE = 48_000;

/** The bytes of `text` in UTF-8 at most. */
function textBytes(text: string | undefined): number {
  return (text?.length ?? 0) * BYTES_PER_UNIT;
}

/** The most the metadata `map` may add to a file. */
function metadataBytes(map: MetadataMap): number {
  const text = Object.values(map.text ?? {}).reduce((sum, value) => sum + textBytes(value), 0);
  const foreign = (map.foreign ?? []).reduce(
    (sum, field) =>
      sum + ITEM_BYTES + textBytes(field.scheme) + textBytes(field.key) + textBytes(field.value),
    0,
  );
  const { broadcast } = map;
  const broadcastBytes =
    broadcast === undefined
      ? 0
      : ITEM_BYTES +
        textBytes(broadcast.description) +
        textBytes(broadcast.originator) +
        textBytes(broadcast.originatorReference) +
        textBytes(broadcast.originationDate) +
        textBytes(broadcast.originationTime) +
        textBytes(broadcast.codingHistory);
  const cues = (map.cues ?? []).reduce((sum, cue) => sum + ITEM_BYTES + textBytes(cue.name), 0);
  const loops = (map.loops ?? []).reduce((sum, loop) => sum + ITEM_BYTES + textBytes(loop.name), 0);
  const art =
    map.coverArt === undefined
      ? 0
      : ITEM_BYTES +
        textBytes(map.coverArt.mediaType) +
        textBytes(map.coverArt.description) +
        map.coverArt.bytes.length;
  return (
    text +
    foreign +
    broadcastBytes +
    cues +
    loops +
    art +
    (map.tuning === undefined ? 0 : ITEM_BYTES)
  );
}

/** The bits each sample of an uncompressed or companded encoding takes in the file. */
function pcmBits(settings: Extract<ExportSettings, { format: 'wav' | 'aiff' | 'aifc' }>): number {
  const { encoding } = settings;
  switch (encoding.kind) {
    // An integer sample fills the whole bytes its depth needs, a 20-bit one three.
    case 'integer':
      return containerBytes(encoding.bits) * 8;
    case 'float':
      return encoding.bits;
    // Companded and ADPCM samples take a byte or less, with their block headers.
    case 'a-law':
    case 'mu-law':
    case 'ima-adpcm':
    case 'ms-adpcm':
      return 8;
  }
}

/** The bytes of `frames` frames of `channels` channels at `bits` bits a sample. */
function sampleBytes(frames: number, channels: number, bits: number): number {
  return Math.ceil((frames * channels * bits) / 8);
}

/** The bytes the audio of a file takes at most, beside its head and metadata. */
function audioBytes(settings: ExportSettings, frames: number, channels: number): number {
  switch (settings.format) {
    case 'wav':
    case 'aiff':
    case 'aifc':
      return sampleBytes(frames, channels, pcmBits(settings));
    case 'flac': {
      const blocks = Math.ceil(frames / FLAC_SMALLEST_BLOCK);
      return (
        sampleBytes(frames, channels, settings.encoding.bits + 1) +
        blocks * (FLAC_FRAME_HEAD + channels)
      );
    }
    case 'mp3': {
      const samples =
        settings.sampleRate >= MP3_FULL_RATE ? MP3_FRAME_SAMPLES.full : MP3_FRAME_SAMPLES.lower;
      // The encoder's delay and padding, and the information frame, are a few frames more.
      return (Math.ceil(frames / samples) + 4) * MP3_LARGEST_FRAME;
    }
    case 'opus':
      return Math.ceil(
        sampleBytes(Math.ceil((frames * OPUS_RATE) / settings.sampleRate), channels, 16) *
          LOSSY_CONTAINER_SHARE,
      );
    case 'ogg-vorbis':
    case 'aac':
      return Math.ceil(sampleBytes(frames, channels, 16) * LOSSY_CONTAINER_SHARE);
  }
}

/**
 * The most bytes the staged file of an export as `settings` set it can take:
 * `frames` frames rendered in `layout`, carrying `metadata`.
 */
export function stagedSizeBound(
  settings: ExportSettings,
  frames: number,
  layout: ChannelLayout,
  metadata: MetadataMap,
): number {
  return HEAD_BYTES + metadataBytes(metadata) + audioBytes(settings, frames, channelCount(layout));
}
