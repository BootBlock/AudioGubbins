/**
 * Where a peak sits along a level meter in AudioGubbins: the printed levels of
 * the design language's meters (section 10, "LED meters"), each an equal share
 * of the meter, so the levels a person works at, near full scale, take as much
 * of it as the quiet ones. Every level meter the application draws reads this
 * one scale, so a peak sits at the same place on each.
 */

import type { MeterScale } from '@audiogubbins/design-system';

/** The levels printed along a meter, in decibels of full scale, quietest first. */
const PRINTED = [-60, -36, -24, -12, -6, -3, 0] as const;

/** Where `decibels` sits along the meter, from 0 at the floor to 1 at full scale. */
function positionOf(decibels: number): number {
  const last = PRINTED.length - 1;
  if (decibels <= PRINTED[0]) return 0;
  for (let index = 1; index <= last; index += 1) {
    const to = PRINTED[index] ?? 0;
    const from = PRINTED[index - 1] ?? 0;
    if (decibels <= to) return (index - 1 + (decibels - from) / (to - from)) / last;
  }
  return 1;
}

/** The scale of a peak meter. */
export const PEAK_METER_SCALE: MeterScale = {
  floor: PRINTED[0],
  positionOf,
  // The typographic minus, as every level the application writes has it.
  marks: PRINTED.map((decibels) => ({
    decibels,
    label: decibels === 0 ? '0' : `−${String(-decibels)}`,
  })),
};
