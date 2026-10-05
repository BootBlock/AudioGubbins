/**
 * What a reader found in a file's header, and the checks every form shares
 * before it is believed.
 *
 * The descriptor is the read contract's account of a file (ADR-0052): what an
 * import records in an asset's provenance (REQ-STOR-166), and what a reader
 * reads the samples by. Each container parses its own header into the facts
 * below, and this module is the one place those facts become a descriptor, so a
 * rule such as a frame being whole channels of whole samples holds for every
 * form alike.
 */

import {
  MAXIMUM_CHANNEL_COUNT,
  StandardLayouts,
  discreteLayout,
  fail,
  flatMapResult,
  sampleCount,
  sampleRate,
  succeed,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { malformed, unsupportedSampleRate } from './codec-failures.js';
import type { ReadableContainer, ReadableFormat, RecognisedFormat } from './recognised-format.js';

/** The order of a sample's bytes. */
export type ByteOrder = 'little' | 'big';

/**
 * Integer PCM: `bits` valid bits, left-justified in `bytes` container bytes.
 * `signed` is false only for offset-binary samples, WAV's and AIFF-C `raw `'s
 * eight-bit form.
 */
export interface IntegerSampleEncoding {
  readonly kind: 'integer';
  readonly bits: number;
  readonly bytes: number;
  readonly byteOrder: ByteOrder;
  readonly signed: boolean;
}

/** IEEE-754 floating-point PCM. */
export interface FloatSampleEncoding {
  readonly kind: 'float';
  readonly bits: 32 | 64;
  readonly bytes: 4 | 8;
  readonly byteOrder: ByteOrder;
}

/** How each sample is stored. */
export type SampleEncoding = IntegerSampleEncoding | FloatSampleEncoding;

/** What a reader found in a file's header. */
export interface AudioFormatDescriptor {
  readonly container: ReadableContainer;
  readonly sampleRate: SampleRate;
  readonly encoding: SampleEncoding;
  readonly channelCount: number;

  /** The layout the header states, or `undefined` where it states none it can name. */
  readonly statedLayout: ChannelLayout | undefined;

  /** The stated layout, or the format's default where the header states none. */
  readonly layout: ChannelLayout;

  /** The whole frames whose bytes are present in the file. */
  readonly frames: SampleCount;

  /** The frames the header declared, more than `frames` where the file was cut short. */
  readonly declaredFrames: SampleCount;

  /** The offset in the file of the first frame's first byte. */
  readonly dataOffset: number;

  /** The bytes of one frame: one sample of each channel. */
  readonly blockAlign: number;
}

/**
 * What the first stage of a parse found: the format, and, for one this package
 * reads, the rest of the parse.
 */
export type FormatStage =
  | { readonly readable: false; readonly format: Exclude<RecognisedFormat, ReadableFormat> }
  | {
      readonly readable: true;
      readonly format: ReadableFormat;
      readonly describe: (
        signal: CancellationSignal | undefined,
      ) => Promise<DomainResult<AudioFormatDescriptor>>;
    };

/** The facts a container's header gives, before they are checked. */
export interface HeaderFacts {
  readonly container: ReadableContainer;
  readonly sampleRate: number;
  readonly encoding: SampleEncoding;
  readonly channelCount: number;
  readonly blockAlign: number;
  readonly dataOffset: number;

  /** The frames the header declares, whole frames only. */
  readonly declaredFrames: number;

  /** The bytes of sample data the file holds from `dataOffset`, up to what was declared. */
  readonly presentBytes: number;
}

/**
 * The integer encoding of `bits` valid bits in `bytes` container bytes, or why
 * no integer PCM can be that.
 */
export function integerEncoding(
  bits: number,
  bytes: number,
  byteOrder: ByteOrder,
  signed: boolean,
): DomainResult<IntegerSampleEncoding> {
  if (bits < 8 || bits > 32) {
    return fail(
      malformed(
        `The header states ${String(bits)}-bit samples, outside the 8 to 32 bits integer PCM is read at.`,
      ),
    );
  }
  if (bytes < 1 || bytes > 4 || bits > bytes * 8) {
    return fail(
      malformed(
        `The header states ${String(bits)}-bit samples in ${String(bytes)}-byte containers, which cannot hold them.`,
      ),
    );
  }
  return succeed({ kind: 'integer', bits, bytes, byteOrder, signed });
}

/** The floating-point encoding of `bits` bits, or why no IEEE-754 PCM can be that. */
export function floatEncoding(
  bits: number,
  byteOrder: ByteOrder,
): DomainResult<FloatSampleEncoding> {
  if (bits === 32) return succeed({ kind: 'float', bits, bytes: 4, byteOrder });
  if (bits === 64) return succeed({ kind: 'float', bits, bytes: 8, byteOrder });
  return fail(
    malformed(
      `The header states ${String(bits)}-bit floating-point samples, where only 32 and 64 bits exist.`,
    ),
  );
}

/** Why a frame of these channels and samples cannot be, or `undefined` where it can. */
function shapeProblem(facts: HeaderFacts): string | undefined {
  const { channelCount, blockAlign, encoding } = facts;
  if (channelCount < 1) return 'The header states that the file has no channels.';
  if (channelCount > MAXIMUM_CHANNEL_COUNT) {
    return `The header states ${String(channelCount)} channels, more than the ${String(MAXIMUM_CHANNEL_COUNT)} AudioGubbins can hold.`;
  }
  if (blockAlign === 0) return 'The header states that each frame takes no bytes.';
  if (blockAlign !== channelCount * encoding.bytes) {
    return `The header states ${String(blockAlign)} bytes per frame, but ${String(channelCount)} channels of ${String(encoding.bytes)}-byte samples take ${String(channelCount * encoding.bytes)}.`;
  }
  return undefined;
}

/**
 * The layout a format assumes where its header states none: mono for one
 * channel and left then right for two, the order both the WAV and the AIFF
 * specifications give, and otherwise channels with no stated meaning.
 */
function defaultLayout(channelCount: number): DomainResult<ChannelLayout> {
  if (channelCount === 1) return succeed(StandardLayouts.mono);
  if (channelCount === 2) return succeed(StandardLayouts.stereo);
  return discreteLayout(channelCount);
}

/**
 * Checks a header's facts and makes them a descriptor. `statedLayout` is asked
 * only once the channel count is known to be one a layout can have.
 */
export function describeAudio(
  facts: HeaderFacts,
  statedLayout: (channelCount: number) => ChannelLayout | undefined,
): DomainResult<AudioFormatDescriptor> {
  const problem = shapeProblem(facts);
  if (problem !== undefined) return fail(malformed(problem));
  const rate = sampleRate(facts.sampleRate);
  if (!rate.ok) return fail(unsupportedSampleRate(String(facts.sampleRate), rate.failures[0]));
  const stated = statedLayout(facts.channelCount);
  const present = Math.min(facts.declaredFrames, Math.floor(facts.presentBytes / facts.blockAlign));
  return flatMapResult(
    stated === undefined ? defaultLayout(facts.channelCount) : succeed(stated),
    (layout) =>
      flatMapResult(sampleCount(present), (frames) =>
        flatMapResult(sampleCount(facts.declaredFrames), (declaredFrames) =>
          succeed({
            container: facts.container,
            sampleRate: rate.value,
            encoding: facts.encoding,
            channelCount: facts.channelCount,
            statedLayout: stated,
            layout,
            frames,
            declaredFrames,
            dataOffset: facts.dataOffset,
            blockAlign: facts.blockAlign,
          }),
        ),
      ),
  );
}
