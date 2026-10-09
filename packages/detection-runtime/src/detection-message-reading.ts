/**
 * Reading a detection message that crossed a thread, field by field
 * (REQ-EXEC-136.12): the page's request, and the worker's answer down to each
 * finding, step and learned state, so the page never shows or applies a value
 * it has not checked. A reader throws at the first wrong field, which `read`
 * turns into a failure naming it.
 */

import {
  FindingKind,
  Malformed,
  MeasureUnit,
  countAt,
  countsAt,
  derivedSampleCount,
  fieldsAt,
  fieldsOf,
  itemsAt,
  itemsOf,
  numberAt,
  numberOf,
  numbersAt,
  oneOf,
  qualityModeAt,
  readMessage,
  textAt,
  textsAt,
  type DetectorFinding,
  type DetectorIdentity,
  type DetectorValues,
  type DomainResult,
  type EditRange,
  type FindingMeasure,
  type MessageFields,
  type ParameterValue,
  type ProcessorState,
  type Recommendation,
  type Treatment,
  type TreatmentStep,
} from '@audiogubbins/domain';
import {
  isMessagePortLike,
  pcmDescriptionOf,
  type PcmDescription,
} from '@audiogubbins/audio-engine';

import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type FromDetectionWorker,
  type DescribedAudio,
  type ToDetectionWorker,
} from './detection-messages.js';
import type {
  AssistantReport,
  DetectionResult,
  KindCount,
  LearnedState,
} from './detection-result.js';

/** A range of the source's frames, named `field`. */
function rangeOf(value: unknown, field: string): EditRange {
  const range = fieldsOf(value, field);
  const start = countAt(range, 'start');
  const end = countAt(range, 'end');
  if (end < start) throw new Malformed(field, 'a range that ends at or after its start');
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

function descriptionAt(fields: MessageFields, field: string): PcmDescription {
  return pcmDescriptionOf(fields[field], field);
}

/** A quality mode, its level taken from its settings as the domain reads them. */
function parameterValueOf(value: unknown, field: string): ParameterValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return numberOf(value, field);
}

function valuesOf(value: unknown, field: string): Readonly<Record<string, ParameterValue>> {
  const read: Record<string, ParameterValue> = {};
  for (const [key, one] of Object.entries(fieldsOf(value, field))) {
    read[key] = parameterValueOf(one, `${field}.${key}`);
  }
  return read;
}

function stepOf(value: unknown, field: string): TreatmentStep {
  const step = fieldsOf(value, field);
  const learnFrom = step['learnFrom'];
  return {
    typeKey: textAt(step, 'typeKey'),
    values: valuesOf(step['values'], `${field}.values`),
    ...(learnFrom === undefined ? {} : { learnFrom: rangeOf(learnFrom, `${field}.learnFrom`) }),
  };
}

function treatmentOf(value: unknown, field: string): Treatment {
  const treatment = fieldsOf(value, field);
  switch (treatment['kind']) {
    case 'steps':
      return { kind: 'steps', steps: itemsAt(treatment, 'steps', stepOf) };
    case 'removal':
      return { kind: 'removal' };
    case 'none':
      return { kind: 'none', reason: textAt(treatment, 'reason') };
    default:
      throw new Malformed(`${field}.kind`, 'steps, removal or none');
  }
}

function measureOf(value: unknown, field: string): FindingMeasure {
  const measure = fieldsOf(value, field);
  return { value: numberAt(measure, 'value'), unit: oneOf(measure, 'unit', MeasureUnit) };
}

function findingOf(value: unknown, field: string): DetectorFinding {
  const finding = fieldsOf(value, field);
  return {
    kind: oneOf(finding, 'kind', FindingKind),
    range: rangeOf(finding['range'], `${field}.range`),
    channels: countsAt(finding, 'channels'),
    measure: measureOf(finding['measure'], `${field}.measure`),
    treatment: treatmentOf(finding['treatment'], `${field}.treatment`),
  };
}

function identityOf(value: unknown, field: string): DetectorIdentity {
  const identity = fieldsOf(value, field);
  return {
    key: textAt(identity, 'key'),
    label: textAt(identity, 'label'),
    version: countAt(identity, 'version'),
  };
}

function recommendationOf(value: unknown, field: string): Recommendation {
  const recommendation = fieldsOf(value, field);
  return {
    assistant: textAt(recommendation, 'assistant'),
    detectors: itemsAt(recommendation, 'detectors', identityOf),
    findings: itemsAt(recommendation, 'findings', findingOf),
    steps: itemsAt(recommendation, 'steps', stepOf),
    removals: itemsAt(recommendation, 'removals', rangeOf),
  };
}

function stateOf(value: unknown, field: string): ProcessorState {
  const state = fieldsOf(value, field);
  return {
    kind: textAt(state, 'kind'),
    values: numbersAt(state, 'values'),
  };
}

function learnedOf(value: unknown, field: string): LearnedState {
  const learned = fieldsOf(value, field);
  switch (learned['kind']) {
    case 'none':
      return { kind: 'none' };
    case 'learned':
      return { kind: 'learned', state: stateOf(learned['state'], `${field}.state`) };
    case 'refused':
      return { kind: 'refused', reason: textAt(learned, 'reason') };
    default:
      throw new Malformed(`${field}.kind`, 'none, learned or refused');
  }
}

function kindCountOf(value: unknown, field: string): KindCount {
  const count = fieldsOf(value, field);
  return { kind: oneOf(count, 'kind', FindingKind), count: countAt(count, 'count') };
}

function kindCountsOf(value: unknown, field: string): readonly KindCount[] {
  return itemsOf(value, field, kindCountOf);
}

function reportOf(value: unknown, field: string): AssistantReport {
  const report = fieldsOf(value, field);
  const recommendation = recommendationOf(report['recommendation'], `${field}.recommendation`);
  const learned = itemsAt(report, 'learned', learnedOf);
  if (learned.length !== recommendation.steps.length) {
    throw new Malformed(`${field}.learned`, 'one state for each step of the recommendation');
  }
  const treated = itemsAt(report, 'treated', kindCountsOf);
  if (treated.length !== recommendation.steps.length) {
    throw new Malformed(`${field}.treated`, 'one count for each step of the recommendation');
  }
  return {
    label: textAt(report, 'label'),
    recommendation,
    learned,
    found: itemsAt(report, 'found', kindCountOf),
    treated,
  };
}

function resultOf(value: unknown, field: string): DetectionResult {
  const result = fieldsOf(value, field);
  return { frames: countAt(result, 'frames'), reports: itemsAt(result, 'reports', reportOf) };
}

/** What a person set of how each detector judges: finite numbers, by detector and parameter key. */
function detectorValuesAt(fields: MessageFields, field: string): DetectorValues {
  const values: Record<string, Readonly<Record<string, number>>> = {};
  for (const [detector, set] of Object.entries(fieldsAt(fields, field))) {
    const name = `${field}.${detector}`;
    const read: Record<string, number> = {};
    for (const [key, one] of Object.entries(fieldsOf(set, name))) {
      read[key] = numberOf(one, `${name}.${key}`);
    }
    values[detector] = read;
  }
  return values;
}

function learningOf(value: unknown): DescribedAudio {
  const learning = fieldsOf(value, 'learning');
  return {
    channels: countAt(learning, 'channels'),
    description: descriptionAt(learning, 'description'),
  };
}

function readToWorker(fields: MessageFields): ToDetectionWorker {
  const kind = oneOf(fields, 'kind', ToDetectionWorkerKind);
  if (kind === ToDetectionWorkerKind.Previews) {
    const port = fields['port'];
    if (!isMessagePortLike(port)) throw new Malformed('port', 'the end of a message channel');
    return { kind, port };
  }
  const job = textAt(fields, 'job');
  if (kind === ToDetectionWorkerKind.Cancel) return { kind, job };
  return {
    kind,
    job,
    target: textAt(fields, 'target'),
    channels: countAt(fields, 'channels'),
    description: descriptionAt(fields, 'description'),
    ...(fields['learning'] === undefined ? {} : { learning: learningOf(fields['learning']) }),
    quality: qualityModeAt(fields, 'quality'),
    range: rangeOf(fields['range'], 'range'),
    assistants: textsAt(fields, 'assistants'),
    detectors: detectorValuesAt(fields, 'detectors'),
  };
}

function readFromWorker(fields: MessageFields): FromDetectionWorker {
  const kind = oneOf(fields, 'kind', FromDetectionWorkerKind);
  if (kind === FromDetectionWorkerKind.Refused) return { kind, reason: textAt(fields, 'reason') };
  const job = textAt(fields, 'job');
  switch (kind) {
    case FromDetectionWorkerKind.Progress:
      return {
        kind,
        job,
        framesRead: countAt(fields, 'framesRead'),
        framesTotal: countAt(fields, 'framesTotal'),
      };
    case FromDetectionWorkerKind.Done:
      return { kind, job, result: resultOf(fields['result'], 'result') };
    case FromDetectionWorkerKind.Failed:
      return { kind, job, reason: textAt(fields, 'reason') };
    case FromDetectionWorkerKind.Cancelled:
      return { kind, job };
  }
}

/** A message to the worker, read from its structured clone. */
export function readToDetectionWorker(value: unknown): DomainResult<ToDetectionWorker> {
  return readMessage(value, 'detection.message-to-worker-malformed', readToWorker);
}

/** A message from the worker, read from its structured clone. */
export function readFromDetectionWorker(value: unknown): DomainResult<FromDetectionWorker> {
  return readMessage(value, 'detection.message-from-worker-malformed', readFromWorker);
}
