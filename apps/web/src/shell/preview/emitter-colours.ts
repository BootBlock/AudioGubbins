/**
 * The category colour each emitter of a scenario is drawn in, by its place in
 * the scenario, so its mark on the pad, its number in the list and the dot of
 * each of its events are one colour. Presentation only: the scenario stores
 * no colour.
 */

/** The category colours in the order emitters take them, the most distinct first. */
const EMITTER_COLOURS = [
  'amber',
  'sky',
  'rose',
  'lime',
  'violet',
  'coral',
  'teal',
  'indigo',
] as const;

/** A category colour an emitter is drawn in, which the stylesheet reads from `data-ag-category`. */
export type EmitterColour = (typeof EMITTER_COLOURS)[number];

/** The colour of the emitter at `place` in its scenario, from the first. */
export function emitterColour(place: number): EmitterColour {
  return EMITTER_COLOURS[place % EMITTER_COLOURS.length] ?? EMITTER_COLOURS[0];
}
