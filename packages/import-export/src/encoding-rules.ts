/**
 * The rules each format's own encoding values are held to, beyond what its
 * codec's descriptor says of rates and channels.
 *
 * Each bound is the codec's: MP3's bit rates are the table of its MPEG
 * version, which the sample rate decides (ISO/IEC 11172-3 and 13818-3, with
 * MPEG-2.5's rates taking MPEG-2's table, as LAME does); AAC's ceiling is
 * 6144 bits a channel for each frame of 1024 samples (ISO/IEC 14496-3); Opus
 * codes 6 kbit/s and up, to 255 kbit/s a channel, 510 for a stereo pair
 * (RFC 6716); libvorbis's managed bit rates run from 16 to 250 kbit/s a
 * channel, its quality from -1 to 10; LAME's variable quality runs from 0 to
 * 9 and FLAC's compression levels from 0 to 8. A value outside is refused.
 */

import type { DomainFailure, SampleRate } from '@audiogubbins/domain';

import type {
  AacEncoding,
  ExportFormat,
  ExportSettings,
  ExportSettingsOf,
  FlacEncoding,
  FormatEncodings,
  Mp3Encoding,
  OpusEncoding,
  VorbisEncoding,
} from './export-settings.js';
import { refusal } from './refusal.js';

/** What a rule is told beside the encoding. */
interface EncodingFacts {
  readonly sampleRate: SampleRate;
  readonly channels: number;
}

type EncodingRule<F extends ExportFormat> = (
  encoding: FormatEncodings[F],
  facts: EncodingFacts,
) => readonly DomainFailure[];

/** MPEG-1 Layer III's bit rates, for 32, 44.1 and 48 kHz. */
const MPEG1_BIT_RATES: readonly number[] = [
  32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];

/** MPEG-2 Layer III's bit rates, for 16, 22.05 and 24 kHz and MPEG-2.5's 8, 11.025 and 12 kHz. */
const MPEG2_BIT_RATES: readonly number[] = [
  8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];

const MPEG1_RATES: ReadonlySet<number> = new Set([32_000, 44_100, 48_000]);

const AAC_BITS_PER_CHANNEL_FRAME = 6144;
const AAC_FRAME_SAMPLES = 1024;
const AAC_LOWEST_BIT_RATE = 8;
const OPUS_LOWEST_BIT_RATE = 6;
const OPUS_HIGHEST_BIT_RATE_PER_CHANNEL = 255;
const VORBIS_LOWEST_PER_CHANNEL = 16;
const VORBIS_HIGHEST_PER_CHANNEL = 250;

/** A refusal of one encoding value, naming it. */
function invalid(field: string, sentence: string): DomainFailure {
  return refusal('encoding-invalid', sentence, { field });
}

/** Whether `value` is a whole number from `lowest` to `highest`. */
function wholeWithin(value: number, lowest: number, highest: number): boolean {
  return Number.isInteger(value) && value >= lowest && value <= highest;
}

/** The bit rates MP3 codes at a sample rate. */
export function mp3BitRates(sampleRate: SampleRate): readonly number[] {
  return MPEG1_RATES.has(sampleRate) ? MPEG1_BIT_RATES : MPEG2_BIT_RATES;
}

function mp3Rule(encoding: Mp3Encoding, { sampleRate }: EncodingFacts): readonly DomainFailure[] {
  const rates = mp3BitRates(sampleRate);
  const listed = `${rates.join(', ')} kbit/s`;
  if (encoding.mode === 'variable') {
    return wholeWithin(encoding.quality, 0, 9)
      ? []
      : [invalid('quality', 'An MP3 of variable bit rate takes a quality from 0, the best, to 9.')];
  }
  if (encoding.mode === 'constant') {
    return rates.includes(encoding.bitRate)
      ? []
      : [invalid('bitRate', `An MP3 at ${String(sampleRate)} Hz codes at one of ${listed}.`)];
  }
  const lowest = rates[0] ?? 0;
  const highest = rates.at(-1) ?? 0;
  return wholeWithin(encoding.bitRate, lowest, highest)
    ? []
    : [
        invalid(
          'bitRate',
          `An MP3 of average bit rate at ${String(sampleRate)} Hz takes a whole number of kbit/s from ${String(lowest)} to ${String(highest)}.`,
        ),
      ];
}

function flacRule(encoding: FlacEncoding): readonly DomainFailure[] {
  return wholeWithin(encoding.compressionLevel, 0, 8)
    ? []
    : [invalid('compressionLevel', 'FLAC takes a compression level from 0 to 8.')];
}

function vorbisRule(
  encoding: VorbisEncoding,
  { channels }: EncodingFacts,
): readonly DomainFailure[] {
  if (encoding.mode === 'quality') {
    const { quality } = encoding;
    return Number.isFinite(quality) && quality >= -1 && quality <= 10
      ? []
      : [invalid('quality', 'Ogg Vorbis takes a quality from -1 to 10.')];
  }
  const lowest = VORBIS_LOWEST_PER_CHANNEL * channels;
  const highest = VORBIS_HIGHEST_PER_CHANNEL * channels;
  return wholeWithin(encoding.nominalBitRate, lowest, highest)
    ? []
    : [
        invalid(
          'nominalBitRate',
          `Ogg Vorbis of ${String(channels)} channels takes a whole number of kbit/s from ${String(lowest)} to ${String(highest)}.`,
        ),
      ];
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

function aacRule(encoding: AacEncoding, facts: EncodingFacts): readonly DomainFailure[] {
  const highest = Math.floor(
    (facts.channels * AAC_BITS_PER_CHANNEL_FRAME * facts.sampleRate) / AAC_FRAME_SAMPLES / 1000,
  );
  return wholeWithin(encoding.bitRate, AAC_LOWEST_BIT_RATE, highest)
    ? []
    : [
        invalid(
          'bitRate',
          `AAC of ${String(facts.channels)} channels at ${String(facts.sampleRate)} Hz takes a whole number of kbit/s from ${String(AAC_LOWEST_BIT_RATE)} to ${String(highest)}.`,
        ),
      ];
}

/** PCM's encodings are whole by their type; the descriptor decides their rates and channels. */
const NO_RULE = (): readonly DomainFailure[] => [];

const RULES: { readonly [F in ExportFormat]: EncodingRule<F> } = {
  wav: NO_RULE,
  aiff: NO_RULE,
  aifc: NO_RULE,
  flac: flacRule,
  mp3: mp3Rule,
  'ogg-vorbis': vorbisRule,
  opus: opusRule,
  aac: aacRule,
};

function problemsOfFormat<F extends ExportFormat>(
  settings: ExportSettingsOf<F>,
  channels: number,
): readonly DomainFailure[] {
  const rule: EncodingRule<F> = RULES[settings.format];
  return rule(settings.encoding, { sampleRate: settings.sampleRate, channels });
}

/** Every problem with an export's encoding values, for a file of `channels` channels. */
export function encodingProblems(
  settings: ExportSettings,
  channels: number,
): readonly DomainFailure[] {
  return problemsOfFormat(settings, channels);
}
