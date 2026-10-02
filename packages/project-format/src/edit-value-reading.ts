/**
 * The converters for the numbers an edit states, which operations, region
 * processing and plans share: channels, gains, channel matrices and the basis
 * an anchored position is stated at (ADR-0051, REQ-EXEC-136.12).
 *
 * Each is bounded by the domain's own limits, so a hostile document cannot
 * make a stage's arithmetic overflow or the reader hold more than a layout can
 * have. Whether a value fits the asset it acts on (a channel the layout has, a
 * matrix as wide as its input) needs the chain it stands in, and is decided by
 * the domain's validation once the value is read, never here.
 */

import { FadeShape, MAXIMUM_CHANNEL_COUNT, MAXIMUM_EDIT_GAIN } from '@audiogubbins/domain';

import { listConverter } from './document-reading.js';
import { integerConverter, numberConverter, oneOfConverter } from './scalar-reading.js';
import { MAXIMUM_ENTITIES } from './value-reading.js';

/**
 * The most operations one chain holds, an asset's or a region's, and so the
 * highest basis a position is stated at. A chain grows by one operation per
 * edit a person makes, and an entity list's bound is far past that already.
 */
export const MAXIMUM_CHAIN_LENGTH = MAXIMUM_ENTITIES;

/** A channel of a layout, counted from zero. */
export const asChannel = integerConverter(0, MAXIMUM_CHANNEL_COUNT - 1);

/** The channels an edit or a stage acts on, which the domain holds ascending once read. */
export const asChannelScope = listConverter(MAXIMUM_CHANNEL_COUNT, asChannel);

/**
 * A gain that scales a level: never negative, since inverting polarity is an
 * edit of its own, and never past the bound an edit allows.
 */
export const asLevelGain = numberConverter(0, MAXIMUM_EDIT_GAIN);

/**
 * A factor of a stage or a matrix, either sign: a plan inverts polarity by a
 * negative gain, and a conversion may subtract one channel from another.
 */
export const asSignedGain = numberConverter(-MAXIMUM_EDIT_GAIN, MAXIMUM_EDIT_GAIN);

/** One gain for each channel of a layout. */
export const asChannelGains = listConverter(MAXIMUM_CHANNEL_COUNT, asLevelGain);

/** A channel matrix: a row for each output channel, a column for each input. */
export const asChannelMatrix = listConverter(
  MAXIMUM_CHANNEL_COUNT,
  listConverter(MAXIMUM_CHANNEL_COUNT, asSignedGain),
);

/** How many of an asset's operations existed when a position was placed. */
export const asBasis = integerConverter(0, MAXIMUM_CHAIN_LENGTH);

/** How a fade's gain moves, for a fade an operation makes and a fade a stage applies. */
export const asFadeShape = oneOfConverter(Object.values(FadeShape));
