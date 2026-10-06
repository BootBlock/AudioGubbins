/**
 * The assistants (ADR-0062): each runs some of the canonical detectors and
 * recommends one chain from what they found, which a person applies or not.
 *
 * A recommendation gives each treatment once, the first finding's where two
 * name the same processor, as one DC offset removal or one de-click serves
 * every finding of its kind and a noise reduction learns from one stretch.
 * Its steps are in `TREATMENT_ORDER`; a step of a processor the order does
 * not name, which a model pack's detector may recommend, follows them in the
 * order it was found.
 */

import type { DetectorFinding, Recommendation, TreatmentStep } from '@audiogubbins/domain';

import type { Assistant, AudioDetector } from './audio-detector.js';
import { CLICK_DETECTOR } from './click-detector.js';
import { CLIPPING_DETECTOR } from './clipping-detector.js';
import { DC_OFFSET_DETECTOR } from './dc-offset-detector.js';
import { HUM_DETECTOR } from './hum-detector.js';
import { NOISE_FLOOR_DETECTOR } from './noise-floor-detector.js';
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
export const CLASSIFICATION_ASSISTANT: Assistant = {
  key: 'classification',
  label: 'Classification',
  detectors: [TRANSIENT_DETECTOR, NOISE_FLOOR_DETECTOR],
  recommend: () => [],
};

/** Restoration: the steady faults of a recording, an offset, hum and noise. */
export const RESTORATION_ASSISTANT = treatingAssistant('restoration', 'Restoration', [
  DC_OFFSET_DETECTOR,
  HUM_DETECTOR,
  NOISE_FLOOR_DETECTOR,
]);

/** Repair: the momentary faults of a recording, clicks and clipping. */
export const REPAIR_ASSISTANT = treatingAssistant('repair', 'Repair', [
  CLICK_DETECTOR,
  CLIPPING_DETECTOR,
]);

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
  };
}
