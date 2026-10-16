/**
 * Going on from the programme playing into one that continues it (ADR-0104),
 * as the playback control asks the session to: a game preview's next stretch
 * going on from the one playing, without pausing or starting again.
 *
 * The request is made at the preview quality what plays was loaded at, which a
 * continuation keeps. The feeder takes it at the first frame it has not read;
 * where it had already read past the frame the programme may first differ at,
 * the programme is made again from a later frame, the one the feeder had
 * reached or the one it may have reached by now, and tried once more. Each try
 * after the first starts from a fresh bound on where the feeder can have read,
 * so one more is enough unless the page was held up between the answer and the
 * try; past a few, the page cannot keep ahead of the feeder, which is said
 * rather than tried for ever. A refusal is said once.
 */

import { flatMapResult, type QualityMode, type SampleCount } from '@audiogubbins/domain';

import { reasonsOf, type Reasons } from '../state/reasons.js';
import type { Opened, PlaybackSessionPort } from './playback-parts.js';
import type { Programme } from './programme.js';

/** How many times a continuation is tried (see the module comment). */
const CONTINUATION_TRIES = 4;

/** How a continuation came out: gone on into from `frame`, or refused for `reasons`. */
export type ContinuationOutcome =
  | { readonly kind: 'continued'; readonly frame: SampleCount }
  | { readonly kind: 'refused'; readonly reasons: Reasons };

/** One try's answer: an outcome, or too late, the feeder having read to `frame`. */
type Try = ContinuationOutcome | { readonly kind: 'too-late'; readonly frame: SampleCount };

/** Makes a continuation again from a later frame, `from`. */
export type Again = (from: SampleCount) => Programme;

/** What plays, which a continuation goes on from, as the playback control holds it. */
export interface Playing {
  /** The parts and what was made with them now, where anything is. */
  readonly current: () => Opened | undefined;
  /** The preview quality in force, which what plays was loaded at unless it says otherwise. */
  readonly quality: () => QualityMode;
  readonly announce: (text: string) => void;
}

/** What plays, made, with its session. */
interface Made {
  readonly opened: Opened;
  readonly session: PlaybackSessionPort;
  readonly quality: QualityMode;
  readonly still: () => boolean;
}

/** One try at going on into `programme`. */
async function tryContinuing(made: Made, programme: Programme): Promise<Try> {
  const { opened, session, quality } = made;
  const { continues } = programme;
  if (continues === undefined || opened.loaded?.key !== continues.key) {
    return { kind: 'refused', reasons: ['What it goes on from is no longer playing.'] };
  }
  const request = flatMapResult(opened.parts.contextRate(), (rate) =>
    programme.request(rate, quality),
  );
  if (!request.ok) return { kind: 'refused', reasons: reasonsOf(request.failures) };
  const answer = await session.continueWith(request.value, continues.from);
  if (!made.still()) {
    return { kind: 'refused', reasons: ['Playback was started again meanwhile.'] };
  }
  if (!answer.ok) return { kind: 'refused', reasons: reasonsOf(answer.failures) };
  if (answer.value.kind === 'continued') {
    // The transport holds it now, as loaded, so a change after it is worked out from it.
    opened.loaded = programme;
    opened.stale = false;
  }
  return answer.value;
}

/** Where the feeder can have read by now, or `undefined` where nothing is loaded to say. */
export function readFrameOf(opened: Opened | undefined): SampleCount | undefined {
  const read = opened?.session?.readFrame();
  return read?.ok === true ? read.value : undefined;
}

/**
 * Goes on from what plays into `programme`, which continues it, making it
 * again with `again` from a later frame where the feeder had read past it;
 * with no `again`, an answer that came too late is a refusal. Settles with the
 * frame it went on from, or why it did not, which is also said.
 */
export async function continueProgramme(
  playing: Playing,
  programme: Programme,
  again?: Again,
): Promise<ContinuationOutcome> {
  const refused = (reasons: Reasons): ContinuationOutcome => {
    playing.announce(reasons.join(' '));
    return { kind: 'refused', reasons };
  };
  const opened = playing.current();
  const session = opened?.session;
  if (opened === undefined || session === undefined) return refused(['Nothing is playing.']);
  const quality = opened.quality ?? playing.quality();
  const made: Made = { opened, session, quality, still: () => playing.current() === opened };
  let attempt = programme;
  for (let tries = 1; ; tries += 1) {
    const answer = await tryContinuing(made, attempt);
    if (answer.kind === 'continued') return answer;
    if (answer.kind === 'refused') return refused(answer.reasons);
    if (again === undefined) return refused(['Playback had already passed where it changes.']);
    if (tries === CONTINUATION_TRIES) {
      return refused(['The new sound could not be prepared before playback reached it.']);
    }
    const reached = readFrameOf(opened);
    attempt = again(reached === undefined || reached < answer.frame ? answer.frame : reached);
  }
}
