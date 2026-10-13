/**
 * The rules each format's own encoding values are held to, beyond what its
 * codec's descriptor says of rates and channels.
 *
 * The bit rates an encoder module takes are its descriptor's
 * (`CodecDirection.bitRates`): LAME's constant and average bit rates at the
 * stream's rate, and the nominal bit rates libvorbis holds a stream of its rate
 * and channels to; and the bit rates a browser's encoder was probed to code
 * each stream at, as its descriptor in that browser states them
 * (`codecDescriptorIn`). The other bounds are the codec's: AAC's lowest is 8
 * kbit/s and its ceiling 6144 bits a channel for each frame of 1024 samples
 * (ISO/IEC 14496-3, `aac-bit-rates.ts` in the codecs); Opus codes 6 kbit/s and
 * up, to 255 kbit/s a channel, 510 for a stereo pair (RFC 6716); libvorbis's
 * quality runs from -1 to 10, LAME's variable quality from 0 to 9 and FLAC's
 * compression levels from 0 to 8; integer PCM in WAV, AIFF and AIFF-C is of
 * every whole depth from 8 to 32 bits, and FLAC of every one from 4 to 32
 * (`integer-depths.ts` in the codecs). A value outside is refused, never
 * replaced by the nearest the encoder would choose.
 */

import {
  AAC_LOWEST_BIT_RATE,
  FLAC_DEPTHS,
  PCM_INTEGER_DEPTHS,
  aacHighestBitRate,
  averageBitRateRanges,
  constantBitRates,
  holdsDepth,
  takesAverageBitRate,
  type BitRateBand,
  type CodecDirection,
  type IntegerDepths,
} from '@audiogubbins/codecs';
import type { DomainFailure, SampleRate } from '@audiogubbins/domain';

import type {
  AacEncoding,
  AifcEncoding,
  ExportFormat,
  FlacEncoding,
  FormatEncoding,
  FormatEncodingOf,
  FormatEncodings,
  Mp3Encoding,
  OpusEncoding,
  VorbisEncoding,
  WavEncoding,
} from './export-settings.js';
import { bitRatesWords, either } from './bit-rate-words.js';
import { refusal } from './refusal.js';

/** What a rule is told beside the encoding: the stream, and the direction that writes it, where one does. */
export interface EncodingFacts {
  readonly sampleRate: SampleRate;
  readonly channels: number;
  readonly write: CodecDirection | undefined;
}

type EncodingRule<F extends ExportFormat> = (
  encoding: FormatEncodings[F],
  facts: EncodingFacts,
) => readonly DomainFailure[];

const OPUS_LOWEST_BIT_RATE = 6;
const OPUS_HIGHEST_BIT_RATE_PER_CHANNEL = 255;

/** A refusal of one encoding value, naming it. */
function invalid(field: string, sentence: string): DomainFailure {
  return refusal('encoding-invalid', sentence, { field });
}

/** Whether `value` is a whole number from `lowest` to `highest`. */
function wholeWithin(value: number, lowest: number, highest: number): boolean {
  return Number.isInteger(value) && value >= lowest && value <= highest;
}

/** Ranges of whole kbit/s, as a sentence gives them. */
function rangesSentence(
  ranges: readonly { readonly minimum: number; readonly maximum: number }[],
): string {
  return ranges
    .map((range) => `${String(range.minimum)} to ${String(range.maximum)}`)
    .join(', or ');
}

/**
 * Why an average bit rate is refused, naming what the encoder holds the
 * stream to, or nothing; `field` is the setting's name, `what` the stream's.
 */
function averageProblems(
  field: string,
  what: string,
  kbps: number,
  facts: EncodingFacts,
): readonly DomainFailure[] {
  const stream = { sampleRate: facts.sampleRate, channels: facts.channels };
  const taken =
    facts.write === undefined ? undefined : takesAverageBitRate(facts.write, stream, kbps);
  if (Number.isInteger(kbps) && kbps > 0 && taken !== false) return [];
  const ranges = facts.write === undefined ? [] : averageBitRateRanges(facts.write, stream);
  return [
    invalid(
      field,
      ranges.length === 0
        ? `${what} takes no average bit rate; choose a quality.`
        : `${what} takes a whole number of kbit/s from ${rangesSentence(ranges)}.`,
    ),
  ];
}

function mp3Rule(encoding: Mp3Encoding, facts: EncodingFacts): readonly DomainFailure[] {
  const what = `An MP3 at ${String(facts.sampleRate)} Hz`;
  if (encoding.mode === 'variable') {
    return wholeWithin(encoding.quality, 0, 9)
      ? []
      : [invalid('quality', 'An MP3 of variable bit rate takes a quality from 0, the best, to 9.')];
  }
  if (encoding.mode === 'average') {
    return averageProblems('bitRate', `${what} of average bit rate`, encoding.bitRate, facts);
  }
  const stream = { sampleRate: facts.sampleRate, channels: facts.channels };
  const rates = facts.write === undefined ? undefined : constantBitRates(facts.write, stream);
  return rates === undefined || rates.includes(encoding.bitRate)
    ? []
    : [invalid('bitRate', `${what} codes at one of ${rates.join(', ')} kbit/s.`)];
}

/** Why `bits` is refused as the depth of `format`'s integer samples, or nothing. */
function depthProblems(
  format: string,
  depths: IntegerDepths,
  bits: number,
): readonly DomainFailure[] {
  return holdsDepth(depths, bits)
    ? []
    : [
        invalid(
          'bits',
          `${format} takes integer samples of a whole number of bits from ${String(depths.lowest)} to ${String(depths.highest)}.`,
        ),
      ];
}

/** The rule of a WAV, AIFF or AIFF-C encoding: an integer depth it holds; its other kinds are whole by their type. */
function pcmRule(
  format: string,
): (encoding: WavEncoding | AifcEncoding) => readonly DomainFailure[] {
  return (encoding) =>
    encoding.kind === 'integer' ? depthProblems(format, PCM_INTEGER_DEPTHS, encoding.bits) : [];
}

function flacRule(encoding: FlacEncoding): readonly DomainFailure[] {
  return [
    ...depthProblems('FLAC', FLAC_DEPTHS, encoding.bits),
    ...(wholeWithin(encoding.compressionLevel, 0, 8)
      ? []
      : [invalid('compressionLevel', 'FLAC takes a compression level from 0 to 8.')]),
  ];
}

function vorbisRule(encoding: VorbisEncoding, facts: EncodingFacts): readonly DomainFailure[] {
  if (encoding.mode === 'quality') {
    const { quality } = encoding;
    return Number.isFinite(quality) && quality >= -1 && quality <= 10
      ? []
      : [invalid('quality', 'Ogg Vorbis takes a quality from -1 to 10.')];
  }
  return averageProblems(
    'nominalBitRate',
    `Ogg Vorbis of ${String(facts.channels)} channels at ${String(facts.sampleRate)} Hz`,
    encoding.nominalBitRate,
    facts,
  );
}

function opusRule(encoding: OpusEncoding, { channels }: EncodingFacts): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  const highest = OPUS_HIGHEST_BIT_RATE_PER_CHANNEL * channels;
  if (!wholeWithin(encoding.bitRate, OPUS_LOWEST_BIT_RATE, highest)) {
    problems.push(
      invalid(
        'bitRate',
        `Opus of ${String(channels)} channels takes a whole number of kbit/s from ${String(OPUS_LOWEST_BIT_RATE)} to ${String(highest)}.`,
      ),
    );
  }
  if (!wholeWithin(encoding.complexity, 0, 10)) {
    problems.push(invalid('complexity', 'Opus takes a complexity from 0 to 10.'));
  }
  return problems;
}

/** Who encodes a direction, as a sentence begins. */
function encoderWords(write: CodecDirection): string {
  return write.implementation === 'browser' ? "This browser's encoder" : 'The encoder';
}

/** The streams `bands` serve, as a sentence gives them: the channel counts coded at each set of rates. */
function streamsWords(bands: readonly BitRateBand[]): string {
  const ratesOfCounts = new Map<string, string[]>();
  for (const band of bands) {
    const count = band.channels === undefined ? 'any number of' : String(band.channels);
    const { minimum, maximum } = band.sampleRates;
    const rates =
      minimum === maximum ? String(minimum) : `${String(minimum)} to ${String(maximum)}`;
    const known = ratesOfCounts.get(count) ?? [];
    if (!known.includes(rates)) ratesOfCounts.set(count, [...known, rates]);
  }
  const countsOfRates = new Map<string, string[]>();
  for (const [count, rates] of ratesOfCounts) {
    const said = either(rates);
    countsOfRates.set(said, [...(countsOfRates.get(said) ?? []), count]);
  }
  return [...countsOfRates]
    .map(([rates, counts]) => `${either(counts)} channels at ${rates} Hz`)
    .join('; ');
}

/**
 * AAC's own bounds (ISO/IEC 14496-3), then, where its encoder states the bit
 * rates it codes, that it codes the stream at all and at this bit rate: a
 * browser's encoder takes only what its platform's does, as Chromium's on
 * Windows codes mono, stereo and 5.1 at 44.1 and 48 kHz at 96, 128, 160 or
 * 192 kbit/s alone, and would otherwise fail once the audio is rendered.
 */
function aacRule(encoding: AacEncoding, facts: EncodingFacts): readonly DomainFailure[] {
  const { channels, sampleRate, write } = facts;
  const what = `AAC of ${String(channels)} channels at ${String(sampleRate)} Hz`;
  const highest = aacHighestBitRate(channels, sampleRate);
  if (!wholeWithin(encoding.bitRate, AAC_LOWEST_BIT_RATE, highest)) {
    return [
      invalid(
        'bitRate',
        `${what} takes a whole number of kbit/s from ${String(AAC_LOWEST_BIT_RATE)} to ${String(highest)}.`,
      ),
    ];
  }
  const rates = write === undefined ? undefined : constantBitRates(write, { sampleRate, channels });
  if (write === undefined || rates === undefined || rates.includes(encoding.bitRate)) return [];
  if (rates.length === 0) {
    return [
      refusal(
        'stream-not-encoded',
        `${encoderWords(write)} codes no ${what}; it codes AAC of ${streamsWords(write.bitRates ?? [])}.`,
        { channels, rate: sampleRate },
      ),
    ];
  }
  return [
    invalid(
      'bitRate',
      `${encoderWords(write)} codes ${what} at ${bitRatesWords(rates)} kbit/s, not at ${String(encoding.bitRate)}.`,
    ),
  ];
}

const RULES: { readonly [F in ExportFormat]: EncodingRule<F> } = {
  wav: pcmRule('WAV'),
  aiff: pcmRule('AIFF'),
  aifc: pcmRule('AIFF-C'),
  flac: flacRule,
  mp3: mp3Rule,
  'ogg-vorbis': vorbisRule,
  opus: opusRule,
  aac: aacRule,
};

/**
 * Every problem with an encoding's values, for a stream of these facts: what
 * validation refuses before rendering, and the codec worker refuses again
 * should a request reach it unvalidated.
 */
export function encodingProblems(
  encoding: FormatEncoding,
  facts: EncodingFacts,
): readonly DomainFailure[] {
  return problemsOfFormat(encoding, facts);
}

function problemsOfFormat<F extends ExportFormat>(
  encoding: FormatEncodingOf<F>,
  facts: EncodingFacts,
): readonly DomainFailure[] {
  const rule: EncodingRule<F> = RULES[encoding.format];
  return rule(encoding.encoding, facts);
}
