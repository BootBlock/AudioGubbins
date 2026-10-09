/**
 * What the storage worker is told of a take as it begins (`ADR-0071`,
 * `ADR-0072`): the manifest's set-up, with the take's name and placement, which
 * the manifest keeps so a recording recovered after a crash is named and placed
 * as a stopped one is.
 *
 * The take's first frame is the one the capture says it began on, which a
 * retrospective buffer puts before Record and a take begun ahead of a punch's
 * range puts before it, and its place on the transport is that frame's. A punch
 * reads its take from the stack's pre-roll plus the take's own placement, so a
 * take whose first frame lies more or less far before the range than the
 * stack's pre-roll is placed by the difference as well as by the latency of the
 * path it was recorded on: every take of a stack then plays from the same
 * moment of the performance, and none is moved or cut.
 */

import { ENGINE_VERSIONS } from '@audiogubbins/audio-engine';
import { defaultPunchCrossfade, derivedSampleCount, type SampleRate } from '@audiogubbins/domain';
import type { RecordingPurpose, RecordingStart } from '@audiogubbins/project-format';
import type { RecordingSetUp } from '@audiogubbins/storage';

import type { PunchPlace, TakeTarget } from './take-target.js';

/** Where a take's first frame was captured, and the latency of the path it came by. */
export interface TakeTiming {
  /**
   * The transport frame the take's first frame was captured at, which is before
   * the transport's start where the take began before the transport reached it.
   */
  readonly transportFrame: number;

  /** The frames the path's latency moves the take earlier by, at its rate. */
  readonly latency: number;
}

/**
 * The frames a take whose first frame was captured at `transportFrame` holds
 * before `place`'s range, less the stack's pre-roll: what its placement adds to
 * the latency's.
 */
function preRollShift(place: PunchPlace, transportFrame: number): number {
  return place.start - transportFrame - place.preRoll;
}

/** What storage keeps of what the take is for. */
function purposeOf(target: TakeTarget, rate: SampleRate): RecordingPurpose {
  switch (target.kind) {
    case 'new-stack':
      return { kind: 'stack' };
    case 'take':
      return { kind: 'take', stack: target.stack.id };
    case 'punch': {
      const { place } = target;
      return {
        kind: 'punch',
        asset: place.asset.id,
        basis: target.basis,
        range: { start: place.start, end: derivedSampleCount(place.start + place.length) },
        punch: {
          length: place.length,
          preRoll: place.preRoll,
          postRoll: place.postRoll,
          crossfade: defaultPunchCrossfade(rate, place.length),
          resampler: ENGINE_VERSIONS.resampler,
        },
      };
    }
  }
}

/** The set-up of a recording for `target` that began as `timing` says, with its take. */
export function takeSetUp(
  target: TakeTarget,
  start: RecordingStart,
  timing: TakeTiming,
): RecordingSetUp {
  const place =
    target.kind === 'punch' ? target.place : target.kind === 'take' ? target.punch : undefined;
  const shift = place === undefined ? 0 : preRollShift(place, timing.transportFrame);
  return {
    start,
    // A frame before the transport's start is placed at it: what the
    // take holds before the range is its placement's, stated above.
    transportFrame: derivedSampleCount(Math.max(0, Math.round(timing.transportFrame))),
    purpose: purposeOf(target, start.sampleRate),
    take: {
      name: target.takeName,
      ...(target.kind === 'take' ? {} : { stackName: target.stackName }),
      compensation: Math.round(timing.latency + shift),
    },
  };
}
