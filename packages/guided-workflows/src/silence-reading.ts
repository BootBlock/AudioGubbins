/**
 * What the workflows that cut and trim read of the Silence assistant
 * (REQ-AUDIO-018): the settings they ask its detector to judge by, whether it
 * found the audio quiet throughout, and the sounds its silence leaves, each
 * widened by a lead-in and a tail. The stretches it would take out are read
 * by `silenceRemovals`, the rule the Analysis panel and its command follow.
 */

import type { AssistantReport } from '@audiogubbins/detection-runtime';
import { FindingKind, type DetectorValues, type Span } from '@audiogubbins/domain';
import { SILENCE_ASSISTANT } from '@audiogubbins/processors';

/** The Silence assistant's key. */
export const SILENCE = SILENCE_ASSISTANT.key;

/** The key of the detector the Silence assistant runs, whose settings a workflow states. */
function silenceDetectorKey(): string {
  const [detector] = SILENCE_ASSISTANT.detectors;
  if (detector === undefined) throw new Error('The Silence assistant runs no detector.');
  return detector.identity.key;
}

/** What a workflow sets of how silence is judged; a value left out is the detector's default. */
export interface SilenceSettings {
  /** The loudest sample a quiet frame holds, in dBFS. */
  readonly threshold?: number | undefined;
  /** The shortest pause within taken out, in seconds. */
  readonly shortestPause?: number | undefined;
  /** What is left of a pause, in seconds. */
  readonly pauseKept?: number | undefined;
}

/** `settings` as the values a detection request carries. */
export function silenceDetectors(settings: SilenceSettings): DetectorValues {
  const values: Record<string, number> = {};
  if (settings.threshold !== undefined) values['threshold'] = settings.threshold;
  if (settings.shortestPause !== undefined) values['shortest-pause'] = settings.shortestPause;
  if (settings.pauseKept !== undefined) values['pause-kept'] = settings.pauseKept;
  return Object.keys(values).length === 0 ? {} : { [silenceDetectorKey()]: values };
}

/** Whether `report` found its audio quiet throughout, which nothing treats. */
export function quietThroughout(report: AssistantReport): boolean {
  return report.recommendation.findings.some(
    (finding) => finding.kind === FindingKind.Silence && finding.treatment.kind === 'none',
  );
}

/**
 * The sounds `removals` leave of `length` frames, in order, each widened by
 * `leadIn` frames before and `tail` after: never past either end, and never
 * past the middle of the silence between it and the next, so no two overlap.
 */
export function soundsLeft(
  removals: readonly Span[],
  length: number,
  leadIn: number,
  tail: number,
): readonly Span[] {
  const sounds: Span[] = [];
  let from = 0;
  for (const removal of removals) {
    if (removal.start > from) sounds.push({ start: from, end: removal.start });
    from = Math.max(from, removal.end);
  }
  if (from < length) sounds.push({ start: from, end: length });
  return sounds.map((sound, index) => {
    const before = sounds[index - 1];
    const after = sounds[index + 1];
    const earliest =
      before === undefined ? 0 : before.end + Math.floor((sound.start - before.end) / 2);
    const latest =
      after === undefined ? length : sound.end + Math.floor((after.start - sound.end) / 2);
    return {
      start: Math.max(earliest, sound.start - leadIn),
      end: Math.min(latest, sound.end + tail),
    };
  });
}
