/**
 * What an encoder's bit-rate bands (`CodecDirection.bitRates`) say of one
 * stream: the constant bit rates it codes, and whether it holds an average
 * bit rate, and from what to what (ADR-0092). Each answer is the union of the
 * bands that serve the stream's rate and channel count, as the encoder itself
 * chooses among them.
 */

import type { BitRateBand, CodecDirection, NumberRange } from './codec-descriptor.js';

/** A stream, as a band serves it. */
export interface BitRateStream {
  readonly sampleRate: number;
  readonly channels: number;
}

/** The bands of `bands` that serve `stream`. */
function serving(bands: readonly BitRateBand[], stream: BitRateStream): readonly BitRateBand[] {
  return bands.filter(
    (band) =>
      (band.channels === undefined || band.channels === stream.channels) &&
      stream.sampleRate >= band.sampleRates.minimum &&
      stream.sampleRate <= band.sampleRates.maximum,
  );
}

/**
 * The constant bit rates, in kbit/s and ascending, the direction's encoder
 * codes for `stream`; `undefined` where it states none, so the format's own
 * rules decide.
 */
export function constantBitRates(
  direction: CodecDirection,
  stream: BitRateStream,
): readonly number[] | undefined {
  if (direction.bitRates === undefined) return undefined;
  const rates = new Set(serving(direction.bitRates, stream).flatMap((band) => band.constant ?? []));
  return [...rates].toSorted((left, right) => left - right);
}

/** Whether a band holds an average of `kbps` kbit/s for `stream`, as its encoder compares it. */
function holds(band: BitRateBand, stream: BitRateStream, kbps: number): boolean {
  if (band.average === undefined) return false;
  const bits = (kbps * 1000) / (band.average.per === 'channel' ? stream.channels : 1);
  return bits >= band.average.minimum && bits <= band.average.maximum;
}

/**
 * Whether the direction's encoder holds `stream` to an average of `kbps`
 * kbit/s; `undefined` where it states no bands, so the format's own rules
 * decide.
 */
export function takesAverageBitRate(
  direction: CodecDirection,
  stream: BitRateStream,
  kbps: number,
): boolean | undefined {
  if (direction.bitRates === undefined) return undefined;
  return serving(direction.bitRates, stream).some((band) => holds(band, stream, kbps));
}

/**
 * The whole numbers of kbit/s a band holds for `stream`, or `undefined` where
 * it holds none.
 */
function wholeRange(band: BitRateBand, stream: BitRateStream): NumberRange | undefined {
  if (band.average === undefined) return undefined;
  const scale = band.average.per === 'channel' ? stream.channels : 1;
  let minimum = Math.ceil((band.average.minimum * scale) / 1000);
  let maximum = Math.floor((band.average.maximum * scale) / 1000);
  // The products are rounded; the encoder's own comparison has the last word.
  while (minimum <= maximum && !holds(band, stream, minimum)) minimum += 1;
  while (maximum >= minimum && !holds(band, stream, maximum)) maximum -= 1;
  return minimum <= maximum ? { minimum, maximum } : undefined;
}

/**
 * The average bit rates, in whole kbit/s, the direction's encoder holds
 * `stream` to, as ascending ranges that neither touch nor overlap; empty where
 * it holds none for the stream.
 */
export function averageBitRateRanges(
  direction: CodecDirection,
  stream: BitRateStream,
): readonly NumberRange[] {
  const ranges = serving(direction.bitRates ?? [], stream)
    .flatMap((band) => wholeRange(band, stream) ?? [])
    .toSorted((left, right) => left.minimum - right.minimum);
  const merged: NumberRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && range.minimum <= last.maximum + 1) {
      merged[merged.length - 1] = {
        minimum: last.minimum,
        maximum: Math.max(last.maximum, range.maximum),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
