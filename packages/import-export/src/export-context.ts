/**
 * What an export's settings are checked and completed against: the audio it
 * renders from, and the codecs the registry describes.
 *
 * The audio is described, never read: its rate, its layout and the precision
 * it needs, for the project and for each region, since a region's asset may
 * have a rate and a layout of its own. The registry is reached through a
 * lookup the application injects, so this package depends on the descriptor
 * contract and never on the registry's own value.
 */

import type { ChannelLayout, RegionId, SampleCount, SampleRate } from '@audiogubbins/domain';
import type { CodecDescriptor, CodecId } from '@audiogubbins/codecs';

/**
 * The precision audio needs to be kept whole: integer samples of `bits`
 * bits, or floating point, which any processing makes of it.
 */
export type SourcePrecision =
  { readonly kind: 'integer'; readonly bits: number } | { readonly kind: 'float' };

/** Audio an export renders from, described. */
export interface ExportableAudio {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly precision: SourcePrecision;
}

/** A region, in the frames of the audio it is rendered from. */
export interface ExportableRegion extends ExportableAudio {
  readonly id: RegionId;
  readonly name: string;
  readonly start: SampleCount;
  readonly length: SampleCount;
}

/** The project an export is made from: its own audio and its regions, in timeline order. */
export interface ExportSource extends ExportableAudio {
  readonly name: string;
  readonly length: SampleCount;
  readonly regions: readonly ExportableRegion[];
}

/** The registry, as a lookup: a codec's descriptor, or `undefined` where none is registered. */
export type CodecLookup = (codec: CodecId) => CodecDescriptor | undefined;

/** What settings are checked and completed against. */
export interface ExportContext {
  readonly source: ExportSource;
  readonly codecs: CodecLookup;
}
