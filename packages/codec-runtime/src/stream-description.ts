/**
 * What a decode session says of the stream it opened, read from the record
 * the module writes (`RECORD_FIELDS` in `codec-bindings`).
 */

import type { CodecId, ContainerId } from '@audiogubbins/codecs';

/** Where a stream's channels belong, where it says. */
export type StatedLayout =
  /**
   * The speakers, as `WAVE_FORMAT_EXTENSIBLE`'s speaker mask names them; the
   * channels are decoded in the mask's bit order. One channel alone is the
   * front centre.
   */
  | { readonly kind: 'speakers'; readonly mask: number }
  /** Ambisonics of this order, in ACN order. */
  | { readonly kind: 'ambisonic'; readonly order: number }
  /** Discrete channels, or a layout no speaker mask holds. */
  | { readonly kind: 'unstated' };

/** What a decode session decodes. */
export interface StreamDescription {
  readonly codec: CodecId;
  readonly container: ContainerId;
  /** Frames a second, as decoded: the stream's own rate, never resampled. */
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly layout: StatedLayout;
  /** The frames the session answers, priming and padding excluded, where stated. */
  readonly totalFrames: number | undefined;
  /** The encoder's leading frames, trimmed, where the file states them. */
  readonly priming: number | undefined;
  /** The encoder's trailing frames, trimmed, where the file states them. */
  readonly padding: number | undefined;
  /** The file's bits a second over the stream's stated duration. */
  readonly bitRate: number | undefined;
  /** The bits of each sample of a lossless stream. */
  readonly bitsPerSample: number | undefined;
  /**
   * Whether the module decodes the stream. HE-AAC is described and its
   * packets read, for the browser's decoder, but never decoded here.
   */
  readonly decodable: boolean;
  /**
   * The codec's configuration as the container carries it: an AAC
   * `AudioSpecificConfig`, an `OpusHead`, Vorbis's headers, FLAC's
   * STREAMINFO or ALAC's magic cookie; empty where it carries none.
   */
  readonly codecConfig: Uint8Array;
}

/** The module's codec codes, by their place: `Codec::code` in `crates/codecs`. */
const CODECS: readonly CodecId[] = ['flac', 'alac', 'mp3', 'vorbis', 'opus', 'aac-lc', 'he-aac'];

/** The module's container codes, by their place: `Container::code`. */
const CONTAINERS: readonly ContainerId[] = [
  'flac',
  'mp3',
  'ogg',
  'mp4',
  'adts',
  'webm',
  'matroska',
];

/** The fields of the record, in order. */
export const RECORD_FIELDS = 13;

/** A record field stated as a number, or `undefined` for the module's NaN. */
function stated(value: number | undefined): number | undefined {
  return value === undefined || Number.isNaN(value) ? undefined : value;
}

/**
 * The description a record states, or `undefined` where it names a code this
 * runtime does not know, which would be a module of another ABI.
 */
export function descriptionOf(
  record: Float64Array,
  codecConfig: Uint8Array,
): StreamDescription | undefined {
  const codec = CODECS[(record[0] ?? 0) - 1];
  const container = CONTAINERS[(record[1] ?? 0) - 1];
  if (codec === undefined || container === undefined) return undefined;
  const value = record[5] ?? Number.NaN;
  const layout: StatedLayout =
    record[4] === 1
      ? { kind: 'speakers', mask: value }
      : record[4] === 2
        ? { kind: 'ambisonic', order: value }
        : { kind: 'unstated' };
  return {
    codec,
    container,
    sampleRate: record[2] ?? 0,
    channelCount: record[3] ?? 0,
    layout,
    totalFrames: stated(record[6]),
    priming: stated(record[7]),
    padding: stated(record[8]),
    bitRate: stated(record[9]),
    bitsPerSample: stated(record[10]),
    decodable: record[11] === 1,
    codecConfig,
  };
}
