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
import type { DetectionResult } from '@audiogubbins/detection-runtime';
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
};

/** What a finding of `kind` is called at the head of a list of them. */
export function kindHeading(kind: FindingKind): string {
  const { many } = KIND_WORDS[kind];
  return `${many.charAt(0).toUpperCase()}${many.slice(1)}`;
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
 * treatment sets, the stretch it learns from in `position`'s words, and the
 * findings of `findings` it treats.
 */
export function stepWords(
  step: TreatmentStep,
  findings: readonly DetectorFinding[],
  position: (frames: number) => string,
): string {
  const descriptor = PROCESSOR_CATALOGUE.get(step.typeKey);
  const settings = Object.entries(step.values).flatMap(([key, value]) => {
    const parameter = descriptor?.parameters.find((one) => one.key === key);
    return parameter === undefined
      ? []
      : [`${parameter.label.toLowerCase()} ${valueWords(parameter, value)}`];
  });
  const treated = new Map<FindingKind, number>();
  for (const finding of findings) {
    if (finding.treatment.kind !== 'steps') continue;
    if (!finding.treatment.steps.some((one) => one.typeKey === step.typeKey)) continue;
    treated.set(finding.kind, (treated.get(finding.kind) ?? 0) + 1);
  }
  const parts = [
    `A ${stepName(step).toLowerCase()}`,
    settings.length === 0 ? 'at its defaults' : `at ${LIST.format(settings)}`,
  ];
  const learns =
    step.learnFrom === undefined
      ? ''
      : `, learning from the audio between ${position(step.learnFrom.start)} and ${position(step.learnFrom.end)}`;
  const counts = [...treated].map(([kind, count]) => kindCount(kind, count));
  const purpose = counts.length === 0 ? '' : `, for the ${LIST.format(counts)} found`;
  return `${parts.join(' ')}${learns}${purpose}.`;
}

/**
 * The findings of every report of `result`, each once: two assistants may run
 * one detector, as the noise floor is run for restoration and classification.
 */
function distinctFindings(result: DetectionResult): readonly DetectorFinding[] {
  const seen = new Set<string>();
  const found: DetectorFinding[] = [];
  for (const report of result.reports) {
    for (const finding of report.recommendation.findings) {
      const key = `${finding.kind}:${String(finding.range.start)}:${String(finding.range.end)}:${finding.channels.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(finding);
    }
  }
  return found;
}

/** What is said once `result` is in, of the audio called `name`. */
export function detectionSummary(result: DetectionResult, name: string): string {
  const counts = new Map<FindingKind, number>();
  for (const finding of distinctFindings(result)) {
    counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  }
  const steps = result.reports.reduce(
    (total, report) => total + report.recommendation.steps.length,
    0,
  );
  const found =
    counts.size === 0
      ? `Found nothing to report in ${name}.`
      : `Found ${LIST.format([...counts].map(([kind, count]) => kindCount(kind, count)))} in ${name}.`;
  return steps === 0
    ? `${found} Nothing is recommended.`
    : `${found} ${counted(steps, 'step is', 'steps are')} recommended in the Analysis panel.`;
}
