/**
 * A punch's take placed on the one media clock (`ADR-0070`, `REQ-REC-093`,
 * `REQ-AUDIO-156`): the audio punched into plays from a little before its
 * pre-roll, so the performer hears the context, and once playback says on which
 * context frame it started, the take's first and last frames follow from it
 * exactly.
 *
 * Playback starts a short lead before the pre-roll, where the audio has that
 * much before it, so the frame the take begins on is still to come when the
 * page hears where playback started: the capture waits for it on the audio
 * thread, and the take holds the pre-roll whole. Where the pre-roll begins too
 * near the audio's start for a lead, the take begins as soon as it can, and its
 * placement says how much pre-roll it holds (`take-set-up.ts`).
 */

import { TransportMode } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type { PlaybackControl } from '../audio/playback-control.js';
import type { Programme } from '../audio/programme.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { PunchPlace } from './take-target.js';

/**
 * How far before the pre-roll playback starts: longer than the page takes to
 * hear where playback started, so the take's first frame is still to come.
 */
const PUNCH_LEAD_SECONDS = 0.5;

/** The context frames a punch's take begins on and stops before. */
export interface PunchFrames {
  readonly recordAt: SampleCount;
  readonly stopAt: SampleCount;
}

/** Where playback of a punch's audio starts: a lead before its pre-roll, or the audio's start. */
export function punchPlayFrom(place: PunchPlace, rate: SampleRate): SampleCount {
  const lead = Math.round(PUNCH_LEAD_SECONDS * rate);
  return derivedSampleCount(Math.max(0, place.start - place.preRoll - lead));
}

/**
 * Plays `programme`, the audio `place` punches, from before its pre-roll, and
 * settles with the context frames its take begins on and stops before, or with
 * why playback did not start. The context runs at the audio's rate
 * (`take-target.ts` refuses another), so a timeline frame is a context frame.
 * Called off by `signal`, it settles with nothing more to do.
 */
export function startPunch(
  playback: Pick<PlaybackControl, 'play'>,
  audio: Observable<AudioView>,
  programme: Programme,
  place: PunchPlace,
  rate: SampleRate,
  signal: AbortSignal,
): Promise<DomainResult<PunchFrames>> {
  const from = punchPlayFrom(place, rate);
  return new Promise((resolve) => {
    const settle = (result: DomainResult<PunchFrames>): void => {
      stopHearing();
      signal.removeEventListener('abort', abandoned);
      resolve(result);
    };
    const heard = (): void => {
      const view = audio.get();
      const transport = view.playback?.transport;
      if (
        !view.starting &&
        transport?.mode === TransportMode.Playing &&
        transport.anchor.timelineFrame === from
      ) {
        const started = transport.anchor.contextFrame - from;
        settle(
          succeed({
            recordAt: derivedSampleCount(Math.max(0, started + place.start - place.preRoll)),
            stopAt: derivedSampleCount(started + place.start + place.length + place.postRoll),
          }),
        );
      } else if (!view.starting && view.problems.length > 0) {
        settle(
          fail(
            failure(
              'recording.punch-playback',
              FailureKind.Rejected,
              `The punch could not play its pre-roll, so nothing was recorded. ${view.problems.join(' ')}`,
            ),
          ),
        );
      }
    };
    const abandoned = (): void => {
      settle(
        fail(failure('recording.punch-stopped', FailureKind.Rejected, 'The punch was stopped.')),
      );
    };
    const stopHearing = audio.subscribe(heard);
    signal.addEventListener('abort', abandoned, { once: true });
    playback.play(programme, from);
  });
}
