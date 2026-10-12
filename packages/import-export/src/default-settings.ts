/**
 * The default settings of each format: the highest-quality path
 * (REQ-AUDIO-143, ADR-0092).
 *
 * The project's own rate and layout, with no conversion the person did not
 * ask for; 32-bit float for WAV and AIFF-C; for AIFF and FLAC, the shallowest
 * of their depths that holds the source's integer samples whole, and their
 * deepest for floating-point audio; and the best a lossy format codes: MP3's
 * highest constant bit rate at the rate, Vorbis's quality 10, Opus at its
 * highest bit rate for the channels with the encoder's full complexity, and
 * AAC at the highest bit rate its encoder codes the stream at, which a
 * browser's encoder was probed for (`codecDescriptorIn`). An AAC encoder that
 * states no bit rates, or none for the stream, is given 128 kbit/s a channel,
 * the rate AAC's encoders give as transparent, within what AAC holds; where
 * the encoder codes none, validation says so.
 *
 * Where a format cannot code the project's rate, as Opus at 44.1 kHz, the
 * default is the lowest rate it codes above the project's, so nothing is
 * lost, or its highest where none is above. Dither is triangular, one step
 * wide, unshaped, for an integer depth of 16 bits or fewer, and none deeper
 * or in floating point, where a 24- or 32-bit export dithers only if asked.
 */

import { aacHighestBitRate, constantBitRates, type CodecDirection } from '@audiogubbins/codecs';
import { channelCount, sampleRate, type SampleRate } from '@audiogubbins/domain';

import { acceptsRate } from './codec-checks.js';
import type { ExportContext, SourcePrecision } from './export-context.js';
import { exportTarget } from './export-formats.js';
import type {
  ChannelConversion,
  CommonExportSettings,
  DitherSettings,
  ExportFormat,
  FlacEncoding,
  IntegerPcm,
  SettingsByFormat,
} from './export-settings.js';
import { layoutConversion } from './layout-conversion.js';

/** What a format's default encoding is chosen from: the source, the stream, and the direction that writes it. */
interface EncodingFacts {
  readonly precision: SourcePrecision;
  readonly sampleRate: SampleRate;
  readonly channels: number;
  readonly write: CodecDirection | undefined;
}

const OPUS_HIGHEST_PER_CHANNEL = 255;
const AAC_TRANSPARENT_PER_CHANNEL = 128;
const FLAC_DEFAULT_LEVEL = 5;
const DITHERED_UP_TO = 16;

/** The shallowest of `depths` that holds the precision whole, or the deepest. */
function depthFor<D extends number>(precision: SourcePrecision, depths: readonly [D, ...D[]]): D {
  const deepest = depths.at(-1) ?? depths[0];
  if (precision.kind === 'float') return deepest;
  return depths.find((depth) => depth >= precision.bits) ?? deepest;
}

/** AAC's bit rate: the highest its encoder codes the stream at, or a transparent one (see the module comment). */
function aacBitRate(facts: EncodingFacts): number {
  const coded = facts.write === undefined ? undefined : constantBitRates(facts.write, facts);
  return (
    coded?.at(-1) ??
    Math.min(
      AAC_TRANSPARENT_PER_CHANNEL * facts.channels,
      aacHighestBitRate(facts.channels, facts.sampleRate),
    )
  );
}

type Defaults = {
  readonly [F in ExportFormat]: (
    common: CommonExportSettings,
    facts: EncodingFacts,
  ) => SettingsByFormat[F];
};

const AIFF_DEPTHS: readonly [IntegerPcm['bits'], ...IntegerPcm['bits'][]] = [8, 16, 24, 32];
const FLAC_DEPTHS: readonly [FlacEncoding['bits'], ...FlacEncoding['bits'][]] = [16, 24, 32];

const DEFAULTS: Defaults = {
  wav: (common) => ({ ...common, format: 'wav', encoding: { kind: 'float', bits: 32 } }),
  aiff: (common, facts) => ({
    ...common,
    format: 'aiff',
    encoding: { kind: 'integer', bits: depthFor(facts.precision, AIFF_DEPTHS) },
  }),
  aifc: (common) => ({ ...common, format: 'aifc', encoding: { kind: 'float', bits: 32 } }),
  flac: (common, facts) => ({
    ...common,
    format: 'flac',
    encoding: {
      bits: depthFor(facts.precision, FLAC_DEPTHS),
      compressionLevel: FLAC_DEFAULT_LEVEL,
      // ADR-0093 keeps the WAV chunks where the person asks for them.
      keepRiffChunks: false,
    },
  }),
  mp3: (common, facts) => ({
    ...common,
    format: 'mp3',
    encoding: {
      mode: 'constant',
      bitRate:
        (facts.write === undefined ? undefined : constantBitRates(facts.write, facts)?.at(-1)) ?? 0,
    },
  }),
  'ogg-vorbis': (common) => ({
    ...common,
    format: 'ogg-vorbis',
    encoding: { mode: 'quality', quality: 10 },
  }),
  opus: (common, facts) => ({
    ...common,
    format: 'opus',
    encoding: {
      bitRate: OPUS_HIGHEST_PER_CHANNEL * facts.channels,
      application: 'audio',
      frameDuration: 20,
      complexity: 10,
    },
  }),
  aac: (common, facts) => ({
    ...common,
    format: 'aac',
    encoding: { bitRate: aacBitRate(facts) },
  }),
};

/** The dither an integer depth takes unless the person chooses another. */
export function defaultDither(depth: number | undefined): DitherSettings {
  return depth !== undefined && depth <= DITHERED_UP_TO
    ? { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 }
    : { kind: 'none' };
}

/** The rate a direction codes nearest above `wanted`, or its highest, or `wanted` where it takes any. */
function rateFor(format: ExportFormat, wanted: SampleRate, context: ExportContext): SampleRate {
  const probe = DEFAULTS[format](commonOf(wanted, { kind: 'keep' }), {
    precision: context.source.precision,
    sampleRate: wanted,
    channels: 1,
    // The probe asks only which codec the format is, which no bit rate changes.
    write: undefined,
  });
  const support = context.codecs(exportTarget(probe).codec)?.write?.sampleRates;
  if (support === undefined || acceptsRate(support, wanted)) return wanted;
  const offered = support.kind === 'any' ? [support.minimum, support.maximum] : support.rates;
  const sorted = [...offered].sort((left, right) => left - right);
  const chosen = sorted.find((rate) => rate >= wanted) ?? sorted.at(-1) ?? wanted;
  const rate = sampleRate(chosen);
  return rate.ok ? rate.value : wanted;
}

function commonOf(rate: SampleRate, channels: ChannelConversion): CommonExportSettings {
  return {
    sampleRate: rate,
    channels,
    dither: { kind: 'none' },
    range: { kind: 'project' },
    metadata: { policy: 'full', edits: [] },
    fileName: '{project}',
  };
}

/** What the defaults are asked to suit: a rate and a conversion the person already chose. */
export interface AskedSettings {
  readonly sampleRate?: SampleRate;
  readonly channels?: ChannelConversion;
}

/** A format's defaults for the context, suiting a rate and a conversion already chosen. */
export function defaultsFor<F extends ExportFormat>(
  format: F,
  context: ExportContext,
  asked: AskedSettings,
): SettingsByFormat[F] {
  const { source } = context;
  const rate = asked.sampleRate ?? rateFor(format, source.sampleRate, context);
  const conversion = asked.channels ?? { kind: 'keep' };
  const converted = layoutConversion(source.layout, conversion);
  const channels = channelCount(converted.ok ? converted.value.to : source.layout);
  const facts = { precision: source.precision, sampleRate: rate, channels };
  const probe = DEFAULTS[format](commonOf(rate, conversion), { ...facts, write: undefined });
  const write = context.codecs(exportTarget(probe).codec)?.write;
  const settings = DEFAULTS[format](commonOf(rate, conversion), { ...facts, write });
  return { ...settings, dither: defaultDither(exportTarget(settings).depth) };
}

/** A format's highest-quality settings for the context's project. */
export function defaultExportSettings<F extends ExportFormat>(
  format: F,
  context: ExportContext,
): SettingsByFormat[F] {
  return defaultsFor(format, context, {});
}
