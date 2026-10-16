/**
 * The processors a workflow adds, made as an applied treatment is
 * (`treatmentChain`): from a type and its values by parameter key, checked
 * against the catalogue the plan is given, so a value out of a processor's
 * range is refused with the reason, never moved into it. A level is a
 * loudness normalisation to a target or a peak normalisation to a stated
 * peak; the processing library's built-in game chains are matched to a
 * loudness target by the target their own normalisation sets.
 */

import {
  copyChain,
  mapResult,
  treatmentChain,
  type DomainResult,
  type EffectChain,
  type IdGenerator,
  type ProcessorCatalogue,
  type ProcessorInstance,
  type ProcessorState,
  type TreatmentStep,
} from '@audiogubbins/domain';
import type { LoudnessTarget } from '@audiogubbins/game-audio';
import { BUILT_IN_LIBRARY } from '@audiogubbins/processors';

const LOUDNESS_NORMALISATION = 'loudness-normalisation';
const PEAK_NORMALISATION = 'peak-normalisation';

/** A step and the state its processor learned, where it reads one. */
export interface LearnedStep {
  readonly step: TreatmentStep;
  readonly state: ProcessorState | undefined;
}

/** A loudness normalisation to `target`, its true peak held where the target sets a ceiling. */
export function loudnessStep(target: LoudnessTarget): TreatmentStep {
  const ceiling = target.truePeakCeilingDbtp;
  return {
    typeKey: LOUDNESS_NORMALISATION,
    values: {
      target: target.integratedLufs,
      'limit-true-peak': ceiling !== undefined,
      ...(ceiling === undefined ? {} : { ceiling }),
    },
  };
}

/** A peak normalisation of the true peak to `peakDbtp`. */
export function peakStep(peakDbtp: number): TreatmentStep {
  return { typeKey: PEAK_NORMALISATION, values: { target: peakDbtp, detection: 'true-peak' } };
}

/** The processors `steps` make, in order, or every reason one cannot be made. */
export function processorsOf(
  steps: readonly LearnedStep[],
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): DomainResult<readonly ProcessorInstance[]> {
  const made = treatmentChain(
    steps.map((one) => one.step),
    steps.map((one) => one.state),
    catalogue,
    ids,
  );
  return mapResult(made, (chain) =>
    chain.slots.flatMap((slot) => (slot.kind === 'processor' ? [slot] : [])),
  );
}

/** The value of `processor`'s parameter keyed `key`, read through its type's descriptor. */
function valueOf(
  processor: ProcessorInstance,
  key: string,
  catalogue: ProcessorCatalogue,
): unknown {
  const parameter = catalogue.get(processor.typeKey)?.parameters.find((one) => one.key === key);
  return parameter === undefined ? undefined : processor.values.get(parameter.id);
}

/**
 * A copy of the built-in game chain that ends by normalising to `lufs`, under
 * identifiers from `ids`, or `undefined` where none does.
 */
export function builtInChainFor(
  lufs: number,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): EffectChain | undefined {
  const entry = BUILT_IN_LIBRARY.find((one) => {
    if (one.content.kind !== 'chain') return false;
    const last = one.content.chain.slots.at(-1);
    return (
      last?.kind === 'processor' &&
      last.typeKey === LOUDNESS_NORMALISATION &&
      valueOf(last, 'target', catalogue) === lufs
    );
  });
  return entry?.content.kind === 'chain' ? copyChain(entry.content.chain, ids) : undefined;
}
