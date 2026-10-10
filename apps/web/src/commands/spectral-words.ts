/**
 * A spectral selection in words (REQ-UX-005, ADR-0082): what a screen reader
 * is told of an area a pointer drew, and what the Spectral panel shows beside
 * it, so a person who cannot see the overlay knows what an edit would act on.
 *
 * It says the area's span of time and its band, the channels it covers, the
 * shapes it is made of and those taken from it, its softness, and whether it
 * is the facet a command acts on now.
 */

import {
  MaskEffect,
  channelCount,
  derivedSampleCount,
  maskOutline,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';
import {
  SelectionFacet,
  activeFacet,
  formatPosition,
  type SelectionSet,
  type TimeFormat,
} from '@audiogubbins/timeline';

import { channelNames } from '../assets/channel-names.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { frequencyWords } from '../wording.js';
import { softnessWords } from './spectral-tool-commands.js';

/** What each kind of shape is called, one and many. */
const SHAPE_NOUNS: Readonly<Record<SpectralShape['kind'], readonly [string, string]>> = {
  rectangle: ['rectangle', 'rectangles'],
  polygon: ['lasso shape', 'lasso shapes'],
  stroke: ['brush stroke', 'brush strokes'],
};

const SHAPE_ORDER: readonly SpectralShape['kind'][] = ['rectangle', 'polygon', 'stroke'];

/** A list in words: `a, b and c`. */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/** The shapes of `effect`, counted by kind, as `a rectangle and 2 brush strokes`. */
function shapesWords(shapes: readonly SpectralShape[], effect: MaskEffect): string {
  const chosen = shapes.filter((shape) => shape.effect === effect);
  return listed(
    SHAPE_ORDER.flatMap((kind) => {
      const count = chosen.filter((shape) => shape.kind === kind).length;
      if (count === 0) return [];
      const [one, many] = SHAPE_NOUNS[kind];
      return [count === 1 ? `a ${one}` : counted(count, one, many)];
    }),
  );
}

/**
 * The shapes of `mask` in words: those adding to it, and those taken away,
 * as `a rectangle and 2 brush strokes, with a lasso shape taken away`.
 */
export function maskShapesWords(mask: SpectralMask): string {
  const taken = shapesWords(mask.shapes, MaskEffect.Subtract);
  const made = shapesWords(mask.shapes, MaskEffect.Add);
  return taken === '' ? made : `${made}, with ${taken} taken away`;
}

/** The channels a selection covers, by name. */
function channelsWords(set: SelectionSet, asset: EditorAsset): string {
  const { channels } = set;
  if (channels === undefined || channels.length === channelCount(asset.layout)) {
    return 'every channel';
  }
  const names = channelNames(asset.layout);
  const named = channels.map((index) => names[index] ?? String(index + 1));
  return `${named.length === 1 ? 'channel' : 'channels'} ${listed(named)}`;
}

/**
 * The spectral selection of `set`, an asset's, in sentences, positions
 * written in `format`; or that there is none.
 */
export function spectralSelectionWords(
  set: SelectionSet,
  asset: EditorAsset,
  format: TimeFormat,
): string {
  const mask = set.spectral;
  if (mask === undefined) return 'No area of time and frequency is selected.';
  const { start, end, low, high } = maskOutline(mask);
  const at = (frames: number): string =>
    formatPosition(derivedSampleCount(frames), asset.sampleRate, format);
  const softness = softnessWords(mask.feather, asset.sampleRate);
  const sentences = [
    `An area from ${at(start)} to ${at(end)}, ${frequencyWords(low)} to ${frequencyWords(high)}, on ${channelsWords(set, asset)}.`,
    `It is made of ${maskShapesWords(mask)}.`,
    softness === 'none'
      ? 'Its rectangles and lasso shapes have hard edges.'
      : `Its rectangles and lasso shapes fade out over ${softness}.`,
    activeFacet(set) === SelectionFacet.Spectral
      ? 'It is what an edit acts on now.'
      : 'Another selection was made since, which an edit acts on instead.',
  ];
  return sentences.join(' ');
}
