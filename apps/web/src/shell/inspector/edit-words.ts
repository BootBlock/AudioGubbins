/**
 * An edit as the Inspector lists it: an asset's operation or a region's
 * processing, in a phrase (REQ-EDIT-014, REQ-EDIT-015).
 *
 * A range is stated at the operation's own place in the chain, where the person
 * made it, and its channels are named by the layout there, so a later edit, a
 * layout conversion among them, never rewrites what an earlier one says. A gain
 * is kept as a linear factor (ADR-0032) and shown in decibels, to one place, as
 * the person typed it. A spectral edit is described by its area: its span of
 * time and its band, the shapes it is made of, and the frames it is analysed
 * in, and one whose chain cannot run says why it is not heard (ADR-0081).
 */

import {
  FadeShape,
  channelCount,
  planIsSilence,
  shapesOf,
  type Asset,
  type EffectChain,
  type SampleRate,
  streamLength,
  type EditOperation,
  type EditRange,
  type EffectChainId,
  type LevelEdit,
  type RangeEdit,
  type RegionOperation,
  type SpectralEdit,
  maskOutline,
} from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';
import { formatPosition, type TimeFormat } from '@audiogubbins/timeline';

import { channelNames } from '../../assets/channel-names.js';
import { chainModelRefusal, type ModelGate } from '../../assets/model-gate.js';
import { chainWords } from '../../commands/rack-words.js';
import { maskShapesWords } from '../../commands/spectral-words.js';
import { frequencyWords, sampleRateWords } from '../../wording.js';

/** What each fade shape is called, in the order a person is offered them. */
export const FADE_SHAPE_NAMES: ReadonlyMap<FadeShape, string> = new Map([
  [FadeShape.Linear, 'Linear'],
  [FadeShape.EqualPower, 'Equal power'],
  [FadeShape.SCurve, 'S-curve'],
  [FadeShape.Square, 'Square'],
]);

const DECIBELS = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/**
 * A factor in decibels, `−6 dB`, with the typographic minus, which a screen
 * reader says as "minus" rather than reading a hyphen as a dash.
 */
function decibelsOf(factor: number): string {
  return `${DECIBELS.format(20 * Math.log10(factor)).replace('-', '−')} dB`;
}

/** How the phrases state positions and channels, as the view in use speaks them. */
export interface EditWording {
  /** A boundary, as the view writes a position. */
  readonly position: (frames: number) => string;
  /** The names of the asset's channels on its timeline at `basis`, by index. */
  readonly channelsAt: (basis: number) => readonly string[];
  /** The chain `chain` names, by what it runs, as "Gain, then Compressor". */
  readonly chain: (chain: EffectChainId) => string;
  /** Why the chain `chain` names cannot run, for want of a model, or nothing where it can. */
  readonly chainRefusal: (chain: EffectChainId) => string | undefined;
}

/**
 * How the edits of `asset` are worded in a view at `sampleRate` writing
 * positions in `format`, its chains read from `chains` and asked of `gate`.
 * Each edit is worded by the layout its place in the chain had, a conversion
 * before it included, so the names are read once for the whole chain.
 */
export function editWording(
  asset: Asset,
  view: { readonly sampleRate: SampleRate; readonly format: TimeFormat },
  chains: ReadonlyMap<EffectChainId, EffectChain> | undefined,
  gate: ModelGate,
): EditWording {
  const names = shapesOf(asset).map((shape) => channelNames(shape.layout));
  return {
    position: (frames) => formatPosition(frames, view.sampleRate, view.format),
    channelsAt: (basis) => names[basis] ?? [],
    chain: (id) => {
      const chain = chains?.get(id);
      return chain === undefined ? 'a chain the project does not hold' : chainWords(chain);
    },
    chainRefusal: (id) => {
      const chain = chains?.get(id);
      return chain === undefined ? undefined : chainModelRefusal(chain, gate);
    },
  };
}

/** A count of samples, grouped as British English groups it. */
const SAMPLES = new Intl.NumberFormat('en-GB');

/** A range, as "from 0:01.000 to 0:02.000". */
function rangeWords(range: EditRange, words: EditWording): string {
  return `from ${words.position(range.start)} to ${words.position(range.end)}`;
}

/** The channels a level edit acts on, or nothing where it acts on all of them. */
function scopeWords(channels: readonly number[] | undefined, names: readonly string[]): string {
  if (channels === undefined) return '';
  const named = channels.map((index) => names[index] ?? String(index + 1));
  return ` on ${named.join(' and ')}`;
}

/** A level edit, as "Gain of −6 dB". */
function levelWords(edit: LevelEdit): string {
  switch (edit.kind) {
    case 'gain':
      return `Gain of ${decibelsOf(edit.gain)}`;
    case 'fade':
      return `${edit.direction === 'in' ? 'Fade in' : 'Fade out'}, ${(FADE_SHAPE_NAMES.get(edit.shape) ?? edit.shape).toLowerCase()}`;
    case 'silence':
      return 'Silence';
    case 'invert':
      return 'Inverted polarity';
  }
}

/** What a spectral edit does, as "Attenuated an area by −12 dB". */
function spectralDoing(edit: SpectralEdit, words: EditWording): string {
  const { operation } = edit;
  switch (operation.kind) {
    case 'attenuate':
      return operation.gain === 0
        ? 'Removed an area'
        : `Attenuated an area by ${decibelsOf(operation.gain)}`;
    case 'isolate':
      return operation.gain === 0
        ? 'Isolated an area'
        : `Isolated an area, the rest by ${decibelsOf(operation.gain)}`;
    case 'heal':
      return 'Healed an area';
    case 'process': {
      const refusal = words.chainRefusal(operation.chain);
      const through = `Cleaned up an area through ${words.chain(operation.chain)}`;
      return refusal === undefined ? through : `${through} (not heard: ${refusal})`;
    }
  }
}

/**
 * A spectral edit over a range starting at `start`, as "Attenuated an area
 * by −12 dB, 0:01.000 to 0:02.000, 100 Hz to 2 kHz, a rectangle, in frames
 * of 2,048 samples": its mask is stated from the range's start.
 */
function spectralWords(edit: SpectralEdit, start: number, words: EditWording): string {
  const outline = maskOutline(edit.mask);
  const span = `${words.position(start + outline.start)} to ${words.position(start + outline.end)}`;
  const band = `${frequencyWords(outline.low)} to ${frequencyWords(outline.high)}`;
  return `${spectralDoing(edit, words)}, ${span}, ${band}, ${maskShapesWords(edit.mask)}, in frames of ${SAMPLES.format(edit.resolution)} samples`;
}

/**
 * A change within a range from `start`, on the channels it names, called by
 * `names`, its chain by `words`.
 */
function rangeEditWords(
  edit: RangeEdit,
  start: number,
  channels: readonly number[] | undefined,
  names: readonly string[],
  words: EditWording,
): string {
  const name = (index: number): string => names[index] ?? String(index + 1);
  switch (edit.kind) {
    case 'swap-channels':
      return `Swapped ${name(edit.first)} and ${name(edit.second)}`;
    case 'copy-channel':
      return `Copied ${name(edit.from)} to ${name(edit.to)}`;
    case 'channel-gains':
      return `Channel gains of ${edit.gains.map(decibelsOf).join(', ')}`;
    case 'rack':
      return `Processed through ${words.chain(edit.chain)}`;
    case 'punch':
      return 'Punched in from the chosen take of a take stack';
    case 'spectral':
      return `${spectralWords(edit, start, words)}${scopeWords(channels, names)}`;
    default:
      return `${levelWords(edit)}${scopeWords(channels, names)}`;
  }
}

/** The operation of an asset's chain at `basis`, in a phrase. */
export function operationWords(
  operation: EditOperation,
  basis: number,
  words: EditWording,
): string {
  switch (operation.kind) {
    case 'delete':
      return `Deleted ${rangeWords(operation.range, words)}`;
    case 'trim':
      return `Trimmed to ${rangeWords(operation.range, words)}`;
    case 'reverse':
      return `Reversed ${rangeWords(operation.range, words)}`;
    case 'insert': {
      const [stream] = operation.payload.streams;
      const frames = counted(streamLength(stream), 'frame', 'frames');
      return planIsSilence(operation.payload)
        ? `Inserted ${frames} of silence at ${words.position(operation.at)}`
        : `Pasted ${frames} at ${words.position(operation.at)}`;
    }
    case 'process':
      return `${rangeEditWords(operation.edit, operation.range.start, operation.channels, words.channelsAt(basis), words)}, ${rangeWords(operation.range, words)}`;
    case 'convert-layout': {
      const names = channelNames(operation.layout);
      return `Converted to ${counted(channelCount(operation.layout), 'channel', 'channels')}: ${names.join(', ')}`;
    }
    case 'stretch':
      return `Stretched ${rangeWords(operation.range, words)} to ${counted(operation.length, 'frame', 'frames')}`;
    case 'convert-rate':
      return `Converted to ${sampleRateWords(operation.sampleRate)}`;
  }
}

/** One operation of a region's own processing, in a phrase. */
export function regionOperationWords(operation: RegionOperation, words: EditWording): string {
  return `${rangeEditWords(operation.edit, operation.range.start, operation.channels, words.channelsAt(operation.basis), words)}, ${rangeWords(operation.range, words)}`;
}
