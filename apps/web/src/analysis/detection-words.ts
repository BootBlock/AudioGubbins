/**
 * The words a detection is shown and said in (ADR-0062): what each finding
 * is, how large it is in a person's words rather than a detector's unit, what
 * each recommended step would add, and the sentence said once a detection has
 * found what it found. The Analysis panel and the announcement both read
 * them, so a finding is called one thing wherever it is named.
 */

import {
  FindingKind,
  type DetectorFinding,
  type ParameterDescriptor,
  type ParameterValue,
  type TreatmentStep,
} from '@audiogubbins/domain';
import type { DetectionResult, KindCount } from '@audiogubbins/detection-runtime';
import { gainToDecibels } from '@audiogubbins/audio-engine';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';

const TENTHS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const OFFSET = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
  signDisplay: 'exceptZero',
});

const VALUE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

const LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** A number with the typographic minus, which a screen reader says as "minus". */
function signed(text: string): string {
  return text.replace('-', '−');
}

/** What a finding of each kind is called, alone and counted. */
const KIND_WORDS: Readonly<Record<FindingKind, { readonly one: string; readonly many: string }>> = {
  [FindingKind.Click]: { one: 'click', many: 'clicks' },
  [FindingKind.Hum]: { one: 'mains hum', many: 'mains hums' },
  [FindingKind.Noise]: { one: 'stretch of noise alone', many: 'stretches of noise alone' },
  [FindingKind.Clipping]: { one: 'clipped stretch', many: 'clipped stretches' },
  [FindingKind.DcOffset]: { one: 'DC offset', many: 'DC offsets' },
  [FindingKind.Transient]: { one: 'onset', many: 'onsets' },
  [FindingKind.Silence]: { one: 'silent stretch', many: 'silent stretches' },
};

/** `text` with its first letter a capital. */
function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** What a finding of `kind` is called at the head of a list of them. */
export function kindHeading(kind: FindingKind): string {
  return capitalised(KIND_WORDS[kind].many);
}

/** How many findings of `kind` there are, in words: `3 clicks`. */
function kindCount(kind: FindingKind, count: number): string {
  const { one, many } = KIND_WORDS[kind];
  return counted(count, one, many);
}

/** A level in decibels to a tenth: `30.5 dB`. */
function decibels(value: number, unit: string): string {
  return `${signed(TENTHS.format(value))} ${unit}`;
}

/** How large `finding` is, in a person's words. */
export function measureWords(finding: DetectorFinding): string {
  const { value } = finding.measure;
  switch (finding.kind) {
    case FindingKind.Click:
      return `${decibels(value, 'dB')} above the music around it`;
    case FindingKind.Hum:
      return `${decibels(value, 'dB')} above the spectrum beside it`;
    case FindingKind.Noise:
      return `a floor of ${decibels(value, 'dBFS')}`;
    case FindingKind.Clipping:
      return `held at ${decibels(value, 'dBFS')}`;
    case FindingKind.DcOffset:
      return `the mean is ${signed(OFFSET.format(value))} of full scale`;
    case FindingKind.Transient:
      return `${decibels(value, 'dB')} above the threshold`;
    case FindingKind.Silence:
      return value === 0
        ? 'digital silence'
        : `its loudest sample at ${decibels(gainToDecibels(value), 'dBFS')}`;
  }
}

/** A value of `parameter`, as its descriptor names it. */
function valueWords(parameter: ParameterDescriptor, value: ParameterValue): string {
  switch (parameter.kind) {
    case 'choice':
      return parameter.options.find((option) => option.key === value)?.label ?? String(value);
    case 'toggle':
      return value === true ? 'on' : 'off';
    case 'numeric':
      return typeof value === 'number'
        ? `${signed(VALUE.format(value))}${parameter.unit === undefined ? '' : ` ${parameter.unit}`}`
        : String(value);
  }
}

/** What a recommended step is called: its processor's label, as the catalogue gives it. */
export function stepName(step: TreatmentStep): string {
  return PROCESSOR_CATALOGUE.get(step.typeKey)?.label ?? step.typeKey;
}

/**
 * What `step` would add, in a sentence: its processor with the values the
 * treatment sets, the stretch it learns from in `position`'s words, and how
 * many findings of each kind it treats, `treated`.
 */
export function stepWords(
  step: TreatmentStep,
  treated: readonly KindCount[],
  position: (frames: number) => string,
): string {
  const descriptor = PROCESSOR_CATALOGUE.get(step.typeKey);
  const settings = Object.entries(step.values).flatMap(([key, value]) => {
    const parameter = descriptor?.parameters.find((one) => one.key === key);
    return parameter === undefined
      ? []
      : [`${parameter.label.toLowerCase()} ${valueWords(parameter, value)}`];
  });
  const parts = [
    `A ${stepName(step).toLowerCase()}`,
    settings.length === 0 ? 'at its defaults' : `at ${LIST.format(settings)}`,
  ];
  const learns =
    step.learnFrom === undefined
      ? ''
      : `, learning from the audio between ${position(step.learnFrom.start)} and ${position(step.learnFrom.end)}`;
  const counts = treated.map(({ kind, count }) => kindCount(kind, count));
  const purpose = counts.length === 0 ? '' : `, for the ${LIST.format(counts)} found`;
  return `${parts.join(' ')}${learns}${purpose}.`;
}

/** What is said once `result` is in, of the audio called `name`. */
export function detectionSummary(result: DetectionResult, name: string): string {
  // A kind is found by one detector, which two assistants may run, as the
  // noise floor is run for restoration and classification, so each report
  // that weighs a kind counts the same findings of it: counted once.
  const counts = new Map<FindingKind, number>();
  for (const report of result.reports) {
    for (const { kind, count } of report.found) {
      counts.set(kind, Math.max(counts.get(kind) ?? 0, count));
    }
  }
  const steps = result.reports.reduce(
    (total, report) => total + report.recommendation.steps.length,
    0,
  );
  const removals = result.reports.reduce(
    (total, report) => total + report.recommendation.removals.length,
    0,
  );
  const found =
    counts.size === 0
      ? `Found nothing to report in ${name}.`
      : `Found ${LIST.format([...counts].map(([kind, count]) => kindCount(kind, count)))} in ${name}.`;
  const offered = [
    ...(steps === 0 ? [] : [`${counted(steps, 'step is', 'steps are')} recommended`]),
    ...(removals === 0
      ? []
      : [`${counted(removals, 'silent stretch', 'silent stretches')} can be taken out`]),
  ];
  return offered.length === 0
    ? `${found} Nothing is recommended.`
    : `${found} ${capitalised(LIST.format(offered))} in the Analysis panel.`;
}
