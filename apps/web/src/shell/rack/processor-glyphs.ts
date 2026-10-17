/**
 * The glyph each type of processor is drawn with where the icon vocabulary
 * has one: in the menu that adds a processor, so a type is found by its shape
 * as well as its name. A type the vocabulary draws no glyph for is listed
 * without one, its label in the same column as the rest.
 */

import type { IconName } from '@audiogubbins/design-system';

/** Each type's glyph, by its type key. */
export const PROCESSOR_GLYPHS: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ['gain', 'gain'],
  ['peak-normalisation', 'peak-normalisation'],
  ['loudness-normalisation', 'loudness-normalisation'],
  ['parametric-equaliser', 'equaliser'],
  ['filter', 'filter'],
  ['compressor', 'compressor'],
  ['limiter', 'limiter'],
  ['gate', 'gate'],
  ['expander', 'expander'],
  ['de-esser', 'de-esser'],
]);
