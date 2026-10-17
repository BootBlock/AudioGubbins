/**
 * The keys that move a dial the design system draws itself, the knob, as the
 * slider's keys move it: an arrow a step, a Page key or a Shift arrow ten,
 * Home and End to the ends (the ARIA slider pattern, as Radix's slider keeps
 * it), so a person who has learned one control has learned them all.
 */

import { snappedPlace, type Travel } from './value-travel.js';

/** How many steps a Page key, or an arrow with Shift, moves. */
const BIG_STEP = 10;

/** The keys that raise the value, and those that lower it. */
const RAISE = new Set(['ArrowUp', 'ArrowRight']);
const LOWER = new Set(['ArrowDown', 'ArrowLeft']);

/** What a key asks of a dial: the key pressed and whether Shift was held. */
export interface DialKey {
  readonly key: string;
  readonly shiftKey: boolean;
}

/** The place a key moves the dial to, or `undefined` for a key that does not move it. */
export function placeAfterKey(travel: Travel, press: DialKey): number | undefined {
  const { key } = press;
  if (key === 'Home') return travel.min;
  if (key === 'End') return travel.max;
  const big = press.shiftKey ? BIG_STEP : 1;
  if (key === 'PageUp') return snappedPlace(travel, travel.at + travel.step * BIG_STEP);
  if (key === 'PageDown') return snappedPlace(travel, travel.at - travel.step * BIG_STEP);
  if (RAISE.has(key)) return snappedPlace(travel, travel.at + travel.step * big);
  if (LOWER.has(key)) return snappedPlace(travel, travel.at - travel.step * big);
  return undefined;
}
