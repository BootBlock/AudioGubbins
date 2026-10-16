/**
 * Assistants' answers written by hand for the workflows' tests: a silence
 * found at stated spans, an offset, noise and clicks, each recommended as the
 * canonical assistants recommend them, so a planner reads them as it reads a
 * detection's.
 */

import type { AssistantReport, LearnedState } from '@audiogubbins/detection-runtime';
import {
  FindingKind,
  MeasureUnit,
  derivedSampleCount,
  type DetectorFinding,
  type DetectorValues,
  type EditRange,
  type ProcessorState,
  type TreatmentStep,
} from '@audiogubbins/domain';
import {
  CANONICAL_ASSISTANTS,
  CLICK_DETECTOR,
  DC_OFFSET_DETECTOR,
  SILENCE_ASSISTANT,
} from '@audiogubbins/processors';

import type { AssistantAnalysis } from '../assistant-analyses.js';

/** A range of frames. */
export function frames(start: number, end: number): EditRange {
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

function finding(kind: FindingKind, range: EditRange, treatment: DetectorFinding['treatment']) {
  return {
    kind,
    range,
    channels: [0],
    measure: { value: 0.01, unit: MeasureUnit.Linear },
    treatment,
  };
}

function report(
  key: string,
  findings: readonly DetectorFinding[],
  steps: readonly TreatmentStep[],
  learned: readonly LearnedState[],
  removals: readonly EditRange[] = [],
): AssistantReport {
  const assistant = CANONICAL_ASSISTANTS.find((one) => one.key === key);
  if (assistant === undefined) throw new Error(`No assistant is keyed ${key}.`);
  return {
    label: assistant.label,
    recommendation: {
      assistant: key,
      detectors: assistant.detectors.map((detector) => detector.identity),
      findings,
      steps,
      removals,
    },
    learned,
    found: [],
    treated: steps.map(() => []),
  };
}

/** The Silence assistant's answer: `removals` to take out, or quiet throughout of `length` frames. */
export function silenceReport(
  removals: readonly EditRange[],
  quietThroughoutLength?: number,
): AssistantReport {
  const findings =
    quietThroughoutLength === undefined
      ? removals.map((range) => finding(FindingKind.Silence, range, { kind: 'removal' }))
      : [
          finding(FindingKind.Silence, frames(0, quietThroughoutLength), {
            kind: 'none',
            reason: 'It is quiet throughout.',
          }),
        ];
  return report(SILENCE_ASSISTANT.key, findings, [], [], removals);
}

/** The key of the assistant running `detector`. */
function keyOf(detector: typeof DC_OFFSET_DETECTOR): string {
  const assistant = CANONICAL_ASSISTANTS.find((one) => one.detectors.includes(detector));
  if (assistant === undefined) throw new Error('No assistant runs the detector.');
  return assistant.key;
}

export const RESTORATION_KEY = keyOf(DC_OFFSET_DETECTOR);
export const REPAIR_KEY = keyOf(CLICK_DETECTOR);

const DC_STEP: TreatmentStep = { typeKey: 'dc-offset-removal', values: {} };

/** The restoration assistant's answer: an offset, and noise learned into `noise`, where given. */
export function restorationReport(found: {
  readonly dcOffset: boolean;
  readonly noise?: { readonly stretch: EditRange; readonly state: ProcessorState };
}): AssistantReport {
  const noiseStep: TreatmentStep | undefined =
    found.noise === undefined
      ? undefined
      : { typeKey: 'noise-reduction', values: {}, learnFrom: found.noise.stretch };
  const findings = [
    ...(found.dcOffset
      ? [finding(FindingKind.DcOffset, frames(0, 100), { kind: 'steps', steps: [DC_STEP] })]
      : []),
    ...(noiseStep === undefined || found.noise === undefined
      ? []
      : [finding(FindingKind.Noise, found.noise.stretch, { kind: 'steps', steps: [noiseStep] })]),
  ];
  const steps = [
    ...(found.dcOffset ? [DC_STEP] : []),
    ...(noiseStep === undefined ? [] : [noiseStep]),
  ];
  const learned: LearnedState[] = [
    ...(found.dcOffset ? [{ kind: 'none' } as const] : []),
    ...(found.noise === undefined ? [] : [{ kind: 'learned', state: found.noise.state } as const]),
  ];
  return report(RESTORATION_KEY, findings, steps, learned);
}

/** The repair assistant's answer: clicks, de-clicked at the default, where `clicks`. */
export function repairReport(clicks: boolean): AssistantReport {
  const step: TreatmentStep = { typeKey: 'de-click', values: {} };
  return clicks
    ? report(
        REPAIR_KEY,
        [finding(FindingKind.Click, frames(10, 12), { kind: 'steps', steps: [step] })],
        [step],
        [{ kind: 'none' }],
      )
    : report(REPAIR_KEY, [], [], []);
}

/** An analysis of a member's whole `length` frames by `assistants` judging by `detectors`. */
export function wholeAnalysis(
  length: number,
  assistants: readonly string[],
  detectors: DetectorValues,
  reports: readonly AssistantReport[],
): AssistantAnalysis {
  return { scope: { range: frames(0, length), whole: true }, assistants, detectors, reports };
}
