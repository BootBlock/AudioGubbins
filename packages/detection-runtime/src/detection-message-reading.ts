/**
 * Reading a detection message that crossed a thread, field by field
 * (REQ-EXEC-136.12): the page's request, and the worker's answer down to each
 * finding, step and learned state, so the page never shows or applies a value
 * it has not checked. A reader throws at the first wrong field, which `read`
 * turns into a failure naming it.
 */

import {
  FailureKind,
  FindingKind,
  MeasureUnit,
  derivedSampleCount,
  fail,
  failure,
  qualityModeFrom,
  succeed,
  type DetectorFinding,
  type DetectorIdentity,
  type DomainResult,
  type EditRange,
  type FindingMeasure,
  type ParameterValue,
  type ProcessorState,
  type QualityMode,
  type Recommendation,
  type Treatment,
  type TreatmentStep,
} from '@audiogubbins/domain';
import { isMessagePortLike, pcmDescription, type PcmDescription } from '@audiogubbins/audio-engine';

import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type FromDetectionWorker,
  type DescribedAudio,
  type ToDetectionWorker,
} from './detection-messages.js';
import type { AssistantReport, DetectionResult, LearnedState } from './detection-result.js';

/** A field of a received message that is not what the protocol says. */
class Malformed extends Error {
  readonly field: string;

  constructor(field: string, expected: string) {
    super(`The message's ${field} is not ${expected}.`);
    this.name = 'Malformed';
    this.field = field;
  }
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsOf(value: unknown, field: string): Fields {
  if (!isFields(value)) throw new Malformed(field, 'an object with named fields');
  return value;
}

function textOf(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Malformed(field, 'text');
  return value;
}

function finiteOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Malformed(field, 'a finite number');
  }
  return value;
}

function textAt(fields: Fields, field: string): string {
  return textOf(fields[field], field);
}

function countAt(fields: Fields, field: string): number {
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Malformed(field, 'a whole number, zero or more');
  }
  return value;
}

function finiteAt(fields: Fields, field: string): number {
  return finiteOf(fields[field], field);
}

function listAt<T>(fields: Fields, field: string, item: (value: unknown, name: string) => T): T[] {
  const value = fields[field];
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((one: unknown, index) => item(one, `${field}[${String(index)}]`));
}

function oneOf<T extends string>(fields: Fields, field: string, kinds: Record<string, T>): T {
  const value = fields[field];
  const found = Object.values(kinds).find((kind) => kind === value);
  if (found === undefined) throw new Malformed(field, `one of ${Object.values(kinds).join(', ')}`);
  return found;
}

function rangeOf(value: unknown, field: string): EditRange {
  const range = fieldsOf(value, field);
  const start = countAt(range, 'start');
  const end = countAt(range, 'end');
  if (end < start) throw new Malformed(field, 'a range that ends at or after its start');
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

function channelsAt(fields: Fields, field: string): readonly number[] {
  return listAt(fields, field, (value, name) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Malformed(name, 'a channel index');
    }
    return value;
  });
}

function descriptionAt(fields: Fields, field: string): PcmDescription {
  const read = pcmDescription(fields[field]);
  if (!read.ok) throw new Malformed(field, `a description of audio (${read.failures[0].summary})`);
  return read.value;
}

/** A quality mode, its level taken from its settings as the domain reads them. */
function qualityAt(fields: Fields, field: string): QualityMode {
  const mode = fieldsOf(fields[field], field);
  const read = qualityModeFrom(mode['settings']);
  if (!read.ok) throw new Malformed(field, 'a quality mode');
  return read.value;
}

function parameterValueOf(value: unknown, field: string): ParameterValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return finiteOf(value, field);
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
      return { kind: 'steps', steps: listAt(treatment, 'steps', stepOf) };
    case 'none':
      return { kind: 'none', reason: textAt(treatment, 'reason') };
    default:
      throw new Malformed(`${field}.kind`, 'steps or none');
  }
}

function measureOf(value: unknown, field: string): FindingMeasure {
  const measure = fieldsOf(value, field);
  return { value: finiteAt(measure, 'value'), unit: oneOf(measure, 'unit', MeasureUnit) };
}

function findingOf(value: unknown, field: string): DetectorFinding {
  const finding = fieldsOf(value, field);
  return {
    kind: oneOf(finding, 'kind', FindingKind),
    range: rangeOf(finding['range'], `${field}.range`),
    channels: channelsAt(finding, 'channels'),
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
    detectors: listAt(recommendation, 'detectors', identityOf),
    findings: listAt(recommendation, 'findings', findingOf),
    steps: listAt(recommendation, 'steps', stepOf),
  };
}

function stateOf(value: unknown, field: string): ProcessorState {
  const state = fieldsOf(value, field);
  return {
    kind: textAt(state, 'kind'),
    values: listAt(state, 'values', finiteOf),
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

function reportOf(value: unknown, field: string): AssistantReport {
  const report = fieldsOf(value, field);
  const recommendation = recommendationOf(report['recommendation'], `${field}.recommendation`);
  const learned = listAt(report, 'learned', learnedOf);
  if (learned.length !== recommendation.steps.length) {
    throw new Malformed(`${field}.learned`, 'one state for each step of the recommendation');
  }
  return { label: textAt(report, 'label'), recommendation, learned };
}

function resultOf(value: unknown, field: string): DetectionResult {
  const result = fieldsOf(value, field);
  return { frames: countAt(result, 'frames'), reports: listAt(result, 'reports', reportOf) };
}

function learningOf(value: unknown): DescribedAudio {
  const learning = fieldsOf(value, 'learning');
  return {
    channels: countAt(learning, 'channels'),
    description: descriptionAt(learning, 'description'),
  };
}

function readToWorker(fields: Fields): ToDetectionWorker {
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
    quality: qualityAt(fields, 'quality'),
    range: rangeOf(fields['range'], 'range'),
    assistants: listAt(fields, 'assistants', textOf),
  };
}

function readFromWorker(fields: Fields): FromDetectionWorker {
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

function read<T>(value: unknown, code: string, reader: (fields: Fields) => T): DomainResult<T> {
  try {
    return succeed(reader(fieldsOf(value, 'body')));
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    return fail(
      failure(code, FailureKind.Rejected, error.message, { details: { field: error.field } }),
    );
  }
}

/** A message to the worker, read from its structured clone. */
export function readToDetectionWorker(value: unknown): DomainResult<ToDetectionWorker> {
  return read(value, 'detection.message-to-worker-malformed', readToWorker);
}

/** A message from the worker, read from its structured clone. */
export function readFromDetectionWorker(value: unknown): DomainResult<FromDetectionWorker> {
  return read(value, 'detection.message-from-worker-malformed', readFromWorker);
}
