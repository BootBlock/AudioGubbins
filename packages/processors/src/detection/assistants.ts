/**
 * The assistants (ADR-0062): each runs some of the canonical detectors and
 * recommends one chain from what they found, which a person applies or not.
 *
 * A recommendation gives each treatment once, the first finding's where two
 * name the same processor, as one DC offset removal or one de-click serves
 * every finding of its kind and a noise reduction learns from one stretch.
 * Its steps are in `TREATMENT_ORDER`; a step of a processor the order does
 * not name, which a model pack's detector may recommend, follows them in the
 * order it was found. The frames its findings would have taken out of the
 * timeline, a silence's, it gives apart, made from every finding as its steps
 * are, for the person to apply as trim and delete edits.
 */

import type {
  DetectorFinding,
  EditRange,
  Recommendation,
  TreatmentStep,
} from '@audiogubbins/domain';

import type { Assistant, AudioDetector } from './audio-detector.js';
import { CLICK_DETECTOR } from './click-detector.js';
import { CLIPPING_DETECTOR } from './clipping-detector.js';
import { DC_OFFSET_DETECTOR } from './dc-offset-detector.js';
import { HUM_DETECTOR } from './hum-detector.js';
import { NOISE_FLOOR_DETECTOR } from './noise-floor-detector.js';
import { SILENCE_DETECTOR } from './silence-detector.js';
import { TRANSIENT_DETECTOR } from './transient-detector.js';
import { TREATMENT_ORDER } from './treatments.js';

/** Where a step of `typeKey` comes in a chain: past every listed one where it is not listed. */
function placeOf(typeKey: string): number {
  const place = TREATMENT_ORDER.indexOf(typeKey);
  return place < 0 ? TREATMENT_ORDER.length : place;
}

/**
 * The chain the treatments of `findings` make, of those `detectors` find:
 * each processor once, in the treatments' order.
 */
function chainOf(
  detectors: readonly AudioDetector[],
  findings: readonly DetectorFinding[],
): readonly TreatmentStep[] {
  const kinds = new Set(detectors.flatMap((detector) => detector.finds));
  const steps = new Map<string, TreatmentStep>();
  for (const finding of findings) {
    if (!kinds.has(finding.kind) || finding.treatment.kind !== 'steps') continue;
    for (const step of finding.treatment.steps) {
      if (!steps.has(step.typeKey)) steps.set(step.typeKey, step);
    }
  }
  // A stable sort: steps of unlisted processors keep the order they were found in.
  return [...steps.values()].toSorted(
    (one, other) => placeOf(one.typeKey) - placeOf(other.typeKey),
  );
}

/** The assistant of `key` and `label`, running `detectors` and recommending their treatments. */
function treatingAssistant(
  key: string,
  label: string,
  detectors: readonly AudioDetector[],
): Assistant {
  return {
    key,
    label,
    detectors,
    recommend: (findings) => chainOf(detectors, findings),
  };
}

/**
 * Classification: what the audio is made of, its onsets and its noise floor.
 * It reports, and recommends nothing.
 */
const CLASSIFICATION_ASSISTANT: Assistant = {
  key: 'classification',
  label: 'Classification',
  detectors: [TRANSIENT_DETECTOR, NOISE_FLOOR_DETECTOR],
  recommend: () => [],
};

/** Restoration: the steady faults of a recording, an offset, hum and noise. */
const RESTORATION_ASSISTANT = treatingAssistant('restoration', 'Restoration', [
  DC_OFFSET_DETECTOR,
  HUM_DETECTOR,
  NOISE_FLOOR_DETECTOR,
]);

/** Repair: the momentary faults of a recording, clicks and clipping. */
const REPAIR_ASSISTANT = treatingAssistant('repair', 'Repair', [CLICK_DETECTOR, CLIPPING_DETECTOR]);

/**
 * Silence: the quiet at the edges and the long pauses within, which trimming
 * takes out. It recommends no processor; what it would take out is the
 * recommendation's removals.
 */
export const SILENCE_ASSISTANT: Assistant = {
  key: 'silence',
  label: 'Silence',
  detectors: [SILENCE_DETECTOR],
  recommend: () => [],
};

/** Every assistant this build has, as a request names them by key. */
export const CANONICAL_ASSISTANTS: readonly Assistant[] = [
  CLASSIFICATION_ASSISTANT,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
  SILENCE_ASSISTANT,
];

/** The ranges of the findings treated by removing their frames, in order and apart. */
function removalsOf(findings: readonly DetectorFinding[]): readonly EditRange[] {
  const removals: EditRange[] = [];
  const ranges = findings
    .filter((finding) => finding.treatment.kind === 'removal')
    .map((finding) => finding.range)
    .toSorted((one, other) => one.start - other.start);
  for (const range of ranges) {
    const last = removals.at(-1);
    // Two that meet or overlap are one span, so the edits made of them are apart.
    if (last !== undefined && range.start <= last.end) {
      removals[removals.length - 1] = {
        start: last.start,
        end: range.end > last.end ? range.end : last.end,
      };
    } else {
      removals.push(range);
    }
  }
  return removals;
}

/**
 * What `assistant` recommends from `findings`, its detectors' findings over
 * some audio. It holds only the findings of kinds its detectors find, the ones
 * its steps were made from, so a record of it never shows a finding it did not
 * weigh.
 */
export function recommendation(
  assistant: Assistant,
  findings: readonly DetectorFinding[],
): Recommendation {
  const kinds = new Set(assistant.detectors.flatMap((detector) => detector.finds));
  const own = findings.filter((finding) => kinds.has(finding.kind));
  return {
    assistant: assistant.key,
    detectors: assistant.detectors.map((detector) => detector.identity),
    findings: own,
    steps: assistant.recommend(own),
    removals: removalsOf(own),
  };
}
