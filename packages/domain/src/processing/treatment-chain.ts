/**
 * The chain a recommended treatment becomes once a person applies it
 * (ADR-0062): each step's processor made under a new identifier, its values
 * set by parameter key over its defaults, and the state it learned where its
 * processor reads one.
 *
 * A treatment names types and keys, never instances, so it is checked here
 * against the catalogue it is applied with: a key, a value or a type this
 * build does not have is refused with the reason, as is a step whose
 * processor needs state it was not given, since a chain holding it would
 * pass its input on unchanged and sound like success.
 */

import type { IdGenerator } from '../identity/id-generator.js';
import { combine, fail, failure, FailureKind, mapResult, type DomainResult } from '../result.js';
import type { TreatmentStep } from './audio-detection.js';
import type { ProcessorCatalogue } from './chain-validation.js';
import type { EffectChain, ProcessorInstance } from './effect-chain.js';
import { defaultParameterValue, validateParameterValue, type ParameterValue } from './parameter.js';
import type { ParameterValues, ProcessorDescriptor } from './processor-descriptor.js';
import type { ProcessorState } from './processor-version.js';

function refused(code: string, summary: string, typeKey: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary, { details: { typeKey } }));
}

/**
 * The values of a processor of `descriptor` that `step` sets, by parameter
 * identifier, every parameter it does not name at its default; or every key
 * and value the processor does not have.
 */
export function treatmentValues(
  descriptor: ProcessorDescriptor,
  step: TreatmentStep,
): DomainResult<ParameterValues> {
  const values = new Map(
    descriptor.parameters.map((parameter) => [parameter.id, defaultParameterValue(parameter)]),
  );
  const checks: DomainResult<ParameterValue>[] = [];
  for (const [key, value] of Object.entries(step.values)) {
    const parameter = descriptor.parameters.find((one) => one.key === key);
    if (parameter === undefined) {
      checks.push(
        refused(
          'treatment.parameter-unknown',
          `A ${descriptor.label} has no setting "${key}", so the treatment cannot be made.`,
          descriptor.typeKey,
        ),
      );
      continue;
    }
    const checked = validateParameterValue(parameter, value);
    checks.push(checked);
    if (checked.ok) values.set(parameter.id, checked.value);
  }
  return mapResult(combine(checks), () => values);
}

/**
 * The processor `step` makes under `id`, holding `state` where its processor
 * reads state; or why it cannot be made.
 */
function treatmentProcessor(
  id: ProcessorInstance['id'],
  step: TreatmentStep,
  catalogue: ProcessorCatalogue,
  state: ProcessorState | undefined,
): DomainResult<ProcessorInstance> {
  const descriptor = catalogue.get(step.typeKey);
  if (descriptor === undefined) {
    return refused(
      'treatment.processor-unknown',
      `This build has no processor "${step.typeKey}", so the treatment cannot be made.`,
      step.typeKey,
    );
  }
  if (descriptor.state === undefined && (state !== undefined || step.learnFrom !== undefined)) {
    return refused(
      'treatment.state-unexpected',
      `A ${descriptor.label} learns nothing, so the treatment cannot give it what it learned.`,
      step.typeKey,
    );
  }
  if (descriptor.state !== undefined && state === undefined) {
    return refused('treatment.state-missing', descriptor.state.missing, step.typeKey);
  }
  return mapResult(treatmentValues(descriptor, step), (values): ProcessorInstance => ({
    kind: 'processor',
    id,
    typeKey: descriptor.typeKey,
    enabled: true,
    soloed: false,
    mix: 1,
    version: descriptor.version,
    values,
    ...(state === undefined ? {} : { state }),
  }));
}

/**
 * The chain `steps` make, in their order, under identifiers from `ids`, step
 * `n` holding `states[n]`; or every reason one of them cannot be made.
 */
export function treatmentChain(
  steps: readonly TreatmentStep[],
  states: readonly (ProcessorState | undefined)[],
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): DomainResult<EffectChain> {
  const made = steps.map((step, index) =>
    treatmentProcessor(ids.next<'ProcessorId'>(), step, catalogue, states[index]),
  );
  return mapResult(combine(made), (slots): EffectChain => ({
    id: ids.next<'EffectChainId'>(),
    slots,
  }));
}
