/**
 * What an export's channel conversion does to audio of one layout: nothing,
 * a matrix, or a map, and the layout it gives.
 *
 * The one reading of a `ChannelConversion`, which validation asks for the
 * layout the file will have and the render plan turns into a graph node, so
 * the two can never disagree about what a conversion means (ADR-0060,
 * ADR-0092). A conversion the audio's layout does not fit is refused, never
 * bent to fit: a fold between layouts with no stated conversion, a named
 * matrix written for other layouts, or a map naming a channel the audio lacks.
 */

import {
  channelCount,
  conversionMatrix,
  layoutsMatch,
  succeed,
  fail,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import { fixedMatrixLayouts, type FixedNamedMatrix } from '@audiogubbins/audio-engine';

import type { ChannelConversion } from './export-settings.js';
import { refusal } from './refusal.js';

/** A conversion read against one layout. */
export type LayoutConversion =
  | { readonly kind: 'none'; readonly to: ChannelLayout }
  | {
      readonly kind: 'matrix';
      readonly weights:
        | { readonly kind: 'coefficients'; readonly rows: readonly (readonly number[])[] }
        | { readonly kind: 'named'; readonly matrix: FixedNamedMatrix };
      readonly to: ChannelLayout;
    }
  | { readonly kind: 'map'; readonly channels: readonly number[]; readonly to: ChannelLayout };

function unconvertible(sentence: string): DomainResult<never> {
  return fail(refusal('layout-unconvertible', sentence));
}

function folded(from: ChannelLayout, to: ChannelLayout): DomainResult<LayoutConversion> {
  if (layoutsMatch(from, to)) return succeed({ kind: 'none', to });
  const matrix = conversionMatrix(from, to);
  if (!matrix.ok) {
    return unconvertible(
      `This audio's channels cannot be folded into the layout asked for: ${matrix.failures[0].summary}`,
    );
  }
  return succeed({ kind: 'matrix', weights: { kind: 'coefficients', rows: matrix.value }, to });
}

function named(from: ChannelLayout, matrix: FixedNamedMatrix): DomainResult<LayoutConversion> {
  const { input, output } = fixedMatrixLayouts(matrix);
  if (!layoutsMatch(from, input)) {
    return unconvertible(
      `The matrix "${matrix}" converts audio of ${String(channelCount(input))} channels in its own layout, which this audio is not.`,
    );
  }
  return succeed({ kind: 'matrix', weights: { kind: 'named', matrix }, to: output });
}

function mapped(
  from: ChannelLayout,
  channels: readonly number[],
  to: ChannelLayout,
): DomainResult<LayoutConversion> {
  const available = channelCount(from);
  if (channels.length !== channelCount(to)) {
    return unconvertible(
      `A channel map names one source channel for each of the ${String(channelCount(to))} channels it makes, but names ${String(channels.length)}.`,
    );
  }
  const outside = channels.find(
    (index) => !Number.isInteger(index) || index < 0 || index >= available,
  );
  if (outside !== undefined) {
    return unconvertible(
      `A channel map names channel ${String(outside)}, but this audio has channels 0 to ${String(available - 1)}.`,
    );
  }
  return succeed({ kind: 'map', channels, to });
}

/** What `conversion` does to audio of layout `from`, or why it cannot. */
export function layoutConversion(
  from: ChannelLayout,
  conversion: ChannelConversion,
): DomainResult<LayoutConversion> {
  switch (conversion.kind) {
    case 'keep':
      return succeed({ kind: 'none', to: from });
    case 'fold':
      return folded(from, conversion.to);
    case 'matrix':
      return named(from, conversion.matrix);
    case 'map':
      return mapped(from, conversion.channels, conversion.to);
  }
}
