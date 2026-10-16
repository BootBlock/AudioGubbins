/**
 * The places of a game preview plan's own streams (ADR-0104): where a voice's
 * streams, or a lane an emitter takes beyond its first, are put, and how the
 * places of those let go are taken again.
 *
 * A plan keeps every stream at its place from one continuation to the next, so
 * the engine keeps the reader of each (ADR-0104's continued programme); a place
 * let go therefore holds a stream forgotten whole, which nothing reads, until a
 * later voice takes it, and the plan's streams end at the last place held. So a
 * plan that drops what was heard holds as many streams as what is still to be
 * heard needs, however long it plays. A segment reads only later streams, so a
 * voice takes places after the lane that reads it.
 */

import { derivedSampleCount, type PlanStream, type SampleRate } from '@audiogubbins/domain';

import { STEREO } from './plan-layout.js';

/** What a place let go holds: one frame of silence, forgotten whole. */
function forgottenPlace(rate: SampleRate): PlanStream {
  return {
    sampleRate: rate,
    layout: STEREO,
    segments: [
      {
        source: { kind: 'silence', channels: 2 },
        start: derivedSampleCount(0),
        length: derivedSampleCount(1),
        reversed: false,
        stages: [],
      },
    ],
    forgottenBefore: derivedSampleCount(1),
  };
}

/**
 * The first of `count` places in a row after `after` for streams to be put at:
 * the first such run of `free` places, each taken out of it, or the places
 * after the last stream.
 */
export function takePlaces(
  streams: readonly PlanStream[],
  free: number[],
  count: number,
  after: number,
): number {
  for (let index = 0; index + count <= free.length; index += 1) {
    const first = free[index];
    if (first === undefined || first <= after) continue;
    let run = 1;
    while (run < count && free[index + run] === first + run) run += 1;
    if (run === count) {
      free.splice(index, count);
      return first;
    }
  }
  return streams.length;
}

/**
 * Lets go of the `count` places from `first` in `streams`, each then holding a
 * stream forgotten whole and counted in `free`, which stays in order; and ends
 * `streams` at the last place still held. Places let go from the last back
 * cost nothing but the shortening.
 */
export function freePlaces(
  streams: PlanStream[],
  free: number[],
  first: number,
  count: number,
  rate: SampleRate,
): void {
  if (first + count === streams.length) {
    // The last places: the plan's streams end before them, with no stream left to hold them.
    streams.length = first;
  } else {
    holdForgotten(streams, free, first, count, rate);
  }
  while (free.length > 0 && free.at(-1) === streams.length - 1) {
    free.pop();
    streams.pop();
  }
}

/** The `count` places from `first` holding streams forgotten whole, each counted in `free`, in order. */
function holdForgotten(
  streams: PlanStream[],
  free: number[],
  first: number,
  count: number,
  rate: SampleRate,
): void {
  for (let place = first; place < first + count; place += 1) {
    streams[place] = forgottenPlace(rate);
    let at = free.length;
    while (at > 0 && (free[at - 1] ?? 0) > place) at -= 1;
    free.splice(at, 0, place);
  }
}
