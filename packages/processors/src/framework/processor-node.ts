/**
 * A processor instance as a node of the processing graph, and back.
 *
 * The rack realises a chain as a graph (ADR-0060, REQ-ARCH-140), and a graph
 * node carries only settings of plain values, so an instance's parameters,
 * the quality settings its type reads and its non-parameter state are written
 * into the node's settings here, and read back here when the node's kernel is
 * made. One module does both, so the rack and the kernel cannot disagree
 * about what a node holds. A parameter is named by its key, so a node read in
 * a diagnostic says which setting is wrong in the person's words.
 */

import {
  validateParameterValue,
  type ParameterId,
  type ParameterValue,
  type ParameterValues,
  type ProcessorDescriptor,
  type ProcessorInstance,
  type ProcessorState,
  type QualitySettings,
} from '@audiogubbins/domain';
import type { SettingValue } from '@audiogubbins/audio-graph';

/** The settings a parameter, a quality setting, the state and a measurement are written under. */
const PARAMETER = 'parameter.';
const QUALITY = 'quality.';
const STATE_VALUES = 'state.values';
const STATE_KIND = 'state.kind';
const MEASURED = 'measured';

/**
 * The settings of the node that runs `processor` at `quality`, with what a
 * whole pass over its input measured, where it needs one and it was made.
 */
export function processorNodeSettings(
  processor: ProcessorInstance,
  descriptor: ProcessorDescriptor,
  quality: QualitySettings,
  measured?: readonly number[],
): Readonly<Record<string, SettingValue>> {
  const settings: Record<string, SettingValue> = {};
  for (const parameter of descriptor.parameters) {
    const value = processor.values.get(parameter.id);
    if (value !== undefined) settings[`${PARAMETER}${parameter.key}`] = value;
  }
  for (const key of descriptor.qualitySettings) settings[`${QUALITY}${key}`] = quality[key];
  if (processor.state !== undefined) {
    settings[STATE_KIND] = processor.state.kind;
    settings[STATE_VALUES] = processor.state.values;
  }
  if (measured !== undefined) settings[MEASURED] = measured;
  return settings;
}

/** What a node holds for its processor, read back and checked. */
export interface ProcessorNodeReading {
  readonly values: ParameterValues;
  readonly quality: QualitySettings;
  readonly state?: ProcessorState;
  /** What a whole pass over the node's input measured, where one was made. */
  readonly measured?: readonly number[];
}

/** Every setting a node of `descriptor` may hold. */
function settingNames(descriptor: ProcessorDescriptor): ReadonlySet<string> {
  return new Set([
    ...descriptor.parameters.map((parameter) => `${PARAMETER}${parameter.key}`),
    ...descriptor.qualitySettings.map((key) => `${QUALITY}${key}`),
    STATE_KIND,
    STATE_VALUES,
    ...(descriptor.wholePass ? [MEASURED] : []),
  ]);
}

function isParameterValue(value: SettingValue | undefined): value is ParameterValue {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

/**
 * The parameters, quality and state a node of `descriptor` holds, or every
 * problem with them, each a sentence naming the setting. `defaults` gives the
 * quality settings a node does not state.
 */
export function readProcessorNode(
  descriptor: ProcessorDescriptor,
  settings: Readonly<Record<string, SettingValue>>,
  defaults: QualitySettings,
): { readonly reading?: ProcessorNodeReading; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const allowed = settingNames(descriptor);
  for (const name of Object.keys(settings)) {
    if (!allowed.has(name)) problems.push(`it has a setting "${name}" its type does not take`);
  }
  const values = new Map<ParameterId, ParameterValue>();
  for (const parameter of descriptor.parameters) {
    const value = settings[`${PARAMETER}${parameter.key}`];
    if (!isParameterValue(value)) {
      problems.push(`it has no value for the parameter "${parameter.key}"`);
      continue;
    }
    const valid = validateParameterValue(parameter, value);
    if (valid.ok) values.set(parameter.id, valid.value);
    else problems.push(...valid.failures.map((problem) => problem.summary));
  }
  const quality: Record<string, unknown> = { ...defaults };
  for (const key of descriptor.qualitySettings) {
    const value = settings[`${QUALITY}${key}`];
    if (value !== undefined) quality[key] = value;
  }
  const checked = qualityOf(quality, defaults, problems);
  const kind = settings[STATE_KIND];
  const stateValues = settings[STATE_VALUES];
  let state: ProcessorState | undefined;
  if (typeof kind === 'string' && typeof stateValues === 'object') {
    state = { kind, values: stateValues };
  } else if (kind !== undefined || stateValues !== undefined) {
    problems.push('its state needs both a kind and its values');
  }
  const measured = settings[MEASURED];
  if (measured !== undefined && typeof measured !== 'object') {
    problems.push('its measurement is not a list of numbers');
  }
  return problems.length > 0
    ? { problems }
    : {
        reading: {
          values,
          quality: checked,
          ...(state === undefined ? {} : { state }),
          ...(typeof measured === 'object' ? { measured } : {}),
        },
        problems,
      };
}

/** The quality settings `read` holds where each is one a level offers, the defaults where not. */
function qualityOf(
  read: Readonly<Record<string, unknown>>,
  defaults: QualitySettings,
  problems: string[],
): QualitySettings {
  const pick = <K extends keyof QualitySettings>(
    key: K,
    allowed: readonly QualitySettings[K][],
  ): QualitySettings[K] => {
    const value = read[key];
    const found = allowed.find((option) => option === value);
    if (found !== undefined) return found;
    problems.push(`its quality setting "${key}" is not one a quality level offers`);
    return defaults[key];
  };
  return {
    resampling: pick('resampling', ['draft', 'high', 'maximum']),
    oversampling: pick('oversampling', [1, 2, 4, 8]),
    spectralOverlap: pick('spectralOverlap', [2, 4, 8]),
    inference: pick('inference', ['pinned', 'accelerated']),
  };
}
