/**
 * What is said of a take once it has come to something (`ADR-0071`,
 * `REQ-REC-096`): recorded, with its length, and why it ended where it ended
 * unexpectedly, which may need review; kept for recovery, with the reason it
 * could not be finished; or refused, with the reason nothing was recorded.
 */

import { endedUnexpectedly } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import type { TakeOutcome } from './take-recording.js';
import { endingText, recordedText } from './take-words.js';

/** What is said of `outcome`, or nothing where nothing was recorded. */
export function saidOfOutcome(outcome: TakeOutcome): string | undefined {
  switch (outcome.kind) {
    case 'finished': {
      const { take, recording } = outcome.recording;
      const length = recordedText(recording.length / recording.sampleRate);
      const recorded = `${quoted(take.name)} is recorded: ${length}.`;
      return endedUnexpectedly(recording.ending)
        ? `${recorded} It ended because ${endingText(recording.ending)}, so it may need review.`
        : recorded;
    }
    case 'kept':
      return `The take could not be finished. ${outcome.failure.summary} What was recorded is kept, and offered for recovery when the project is opened.`;
    case 'refused':
      return `Nothing was recorded. ${outcome.failure.summary}`;
    case 'unbegun':
      return undefined;
  }
}
