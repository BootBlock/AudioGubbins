/**
 * What an export makes, as one typed record per format (ADR-0092).
 *
 * The record is the whole of the person's choice: a preset resolves to it,
 * the expert controls edit it, and the job renders, dithers, encodes and
 * names the file from it and from nothing else, so the same record makes the
 * same file. Each format has its own encoding; everything else is common to
 * every format. A record says what was asked, and `validateExportSettings`
 * says whether it can be made, refusing what cannot rather than adjusting it.
 *
 * The form a WAV file takes, plain, extensible or RF64, is not a setting: the
 * writer takes the plainest form that holds the layout and the length.
 */

import type { ChannelLayout, RegionId, SampleCount, SampleRate } from '@audiogubbins/domain';
import type { FixedNamedMatrix } from '@audiogubbins/audio-engine';
import type { MetadataTextKey } from '@audiogubbins/codecs';

/** The formats AudioGubbins exports. */
export type ExportFormat = 'wav' | 'aiff' | 'aifc' | 'flac' | 'mp3' | 'ogg-vorbis' | 'opus' | 'aac';

/**
 * Integer PCM of `bits` bits, any whole depth from 8 to 32, each sample in the
 * next whole byte (`PCM_INTEGER_DEPTHS` in the codecs). A depth outside is
 * kept as asked and refused by validation, never rounded to one.
 */
export interface IntegerPcm {
  readonly kind: 'integer';
  readonly bits: number;
}

/** IEEE-754 floating-point PCM. */
export interface FloatPcm {
  readonly kind: 'float';
  readonly bits: 32 | 64;
}

/** G.711's companded codes and the ADPCM codes, each made from 16-bit samples. */
export interface CodedPcm {
  readonly kind: 'a-law' | 'mu-law' | 'ima-adpcm' | 'ms-adpcm';
}

/** WAV's encodings. */
export type WavEncoding = IntegerPcm | FloatPcm | CodedPcm;

/** AIFF holds integer PCM alone. */
export type AiffEncoding = IntegerPcm;

/** AIFF-C's encodings: its codes `NONE`, `fl32`, `fl64`, `alaw`, `ulaw` and `ima4`. */
export type AifcEncoding =
  IntegerPcm | FloatPcm | { readonly kind: 'a-law' | 'mu-law' | 'ima-adpcm' };

/**
 * FLAC: the depth of its integer samples, any whole depth from 4 to 32
 * (`FLAC_DEPTHS` in the codecs), how hard the encoder works, 0 to 8,
 * and whether the WAV chunks of the file's loops, cues and tuning (`smpl` and
 * `cue `) are kept in `APPLICATION` `riff` blocks beside the Vorbis comments,
 * which hold the first loop alone and no cue or tuning (ADR-0093).
 */
export interface FlacEncoding {
  readonly bits: number;
  readonly compressionLevel: number;
  readonly keepRiffChunks: boolean;
}

/**
 * MP3: a constant or average bit rate in kbit/s, or a variable rate by LAME's
 * quality, 0 the best to 9.
 */
export type Mp3Encoding =
  | { readonly mode: 'constant' | 'average'; readonly bitRate: number }
  | { readonly mode: 'variable'; readonly quality: number };

/** Ogg Vorbis: libvorbis's quality, -1 to 10, or a nominal bit rate in kbit/s. */
export type VorbisEncoding =
  | { readonly mode: 'quality'; readonly quality: number }
  | { readonly mode: 'bit-rate'; readonly nominalBitRate: number };

/** What the Opus encoder is tuned for (RFC 6716's applications). */
export type OpusApplication = 'audio' | 'voip' | 'restricted-low-delay';

/** The frame durations Opus codes, in milliseconds. */
export type OpusFrameDuration = 2.5 | 5 | 10 | 20 | 40 | 60;

/** Opus in Ogg: the bit rate in kbit/s, the application, the frame duration and the complexity, 0 to 10. */
export interface OpusEncoding {
  readonly bitRate: number;
  readonly application: OpusApplication;
  readonly frameDuration: OpusFrameDuration;
  readonly complexity: number;
}

/** AAC-LC in M4A: the bit rate in kbit/s. */
export interface AacEncoding {
  readonly bitRate: number;
}

/** Each format's encoding. */
export interface FormatEncodings {
  readonly wav: WavEncoding;
  readonly aiff: AiffEncoding;
  readonly aifc: AifcEncoding;
  readonly flac: FlacEncoding;
  readonly mp3: Mp3Encoding;
  readonly 'ogg-vorbis': VorbisEncoding;
  readonly opus: OpusEncoding;
  readonly aac: AacEncoding;
}

/**
 * What the rendered channels become: kept as they are; folded by role into
 * another layout by the domain's conversion (ITU-R BS.775's fold for what the
 * destination lacks); mixed by a matrix the engine names, such as BS.775's
 * 5.1 to stereo or mid and side; or mapped, each output channel a copy of the
 * source channel at its index, which extracts or reorders channels.
 */
export type ChannelConversion =
  | { readonly kind: 'keep' }
  | { readonly kind: 'fold'; readonly to: ChannelLayout }
  | { readonly kind: 'matrix'; readonly matrix: FixedNamedMatrix }
  | { readonly kind: 'map'; readonly channels: readonly number[]; readonly to: ChannelLayout };

/**
 * The noise shaping of a dither: none; first-order, the error fed back once
 * so the noise rises toward the top of the band; or the nine-tap E-weighted
 * filter of Lipshitz, Wannamaker and Vanderkooy, written for 44.1 kHz
 * (`noise-shaping.ts` holds the coefficients and their source).
 */
export type NoiseShaping = 'none' | 'first-order' | 'lipshitz-e-weighted';

/**
 * The dither added before integer quantisation. `amplitude` is the width of
 * each rectangular component in steps of the target depth: rectangular noise
 * spans `amplitude`, triangular noise, the sum of two, twice it. `seed`, a
 * whole number below 2³², is mixed with the rest of the settings into the
 * generator's key, so the same export gives the same bits.
 */
export type DitherSettings =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'rectangular' | 'triangular';
      readonly amplitude: number;
      readonly shaping: NoiseShaping;
      readonly seed: number;
    };

/**
 * What is exported: the project, one region, every region, a file each, or
 * the selection, in the project's frames.
 */
export type ExportRange =
  | { readonly kind: 'project' }
  | { readonly kind: 'region'; readonly region: RegionId }
  | { readonly kind: 'every-region' }
  | { readonly kind: 'selection'; readonly start: SampleCount; readonly length: SampleCount };

/** How much of the project's and region's metadata a file carries (ADR-0093). */
export type MetadataPolicy = 'full' | 'minimal' | 'none';

/** One field the person sets or removes over what the policy carries. */
export type MetadataEdit =
  | { readonly kind: 'set'; readonly key: MetadataTextKey; readonly value: string }
  | { readonly kind: 'remove'; readonly key: MetadataTextKey };

/** The metadata a file carries: the policy, then the person's edits in order. */
export interface MetadataSettings {
  readonly policy: MetadataPolicy;
  readonly edits: readonly MetadataEdit[];
}

/** What every format's settings hold. */
export interface CommonExportSettings {
  /** The rate the export renders at, converted by the canonical resampler where it is not the source's. */
  readonly sampleRate: SampleRate;
  readonly channels: ChannelConversion;
  readonly dither: DitherSettings;
  readonly range: ExportRange;
  readonly metadata: MetadataSettings;

  /** The file name's template, without its extension (`file-name-template.ts`). */
  readonly fileName: string;
}

/** Each format's settings: what every format holds, and the format's own encoding. */
export type SettingsByFormat = {
  readonly [F in ExportFormat]: CommonExportSettings & {
    readonly format: F;
    readonly encoding: FormatEncodings[F];
  };
};

/** Each format with its encoding. */
type FormatEncodingByFormat = {
  readonly [F in ExportFormat]: { readonly format: F; readonly encoding: FormatEncodings[F] };
};

/** One format with its encoding. */
export type FormatEncodingOf<F extends ExportFormat> = FormatEncodingByFormat[F];

/** A format and its encoding: all a file's encoder and its target are made from. */
export type FormatEncoding = FormatEncodingByFormat[ExportFormat];

/** The settings of an export in one format. */
export type ExportSettingsOf<F extends ExportFormat> = SettingsByFormat[F];

/** The settings of an export, in whichever format. */
export type ExportSettings = SettingsByFormat[ExportFormat];
