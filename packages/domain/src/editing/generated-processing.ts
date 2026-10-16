/**
 * What only a game preview's plan holds (ADR-0104): a stream played at a
 * ratio, and a chain's parameters moved along its stream. Whether each is
 * whole, checked by `validatePlan` with the rest of a plan, and whether a plan
 * holds either, which a project never keeps.
 */

import { layoutsMatch } from '../audio/channel-layout.js';
import { processorsOf, type EffectChain } from '../processing/effect-chain.js';
import {
  VARISPEED_NUMERATORS,
  type EditPlan,
  type ParameterAutomation,
  type PlanStream,
  type StreamProcessing,
} from './plan.js';

/** Whether `value` is a whole number of frames from zero. */
function isFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Why a chain's automation does not hold, or `undefined` where it does: each
 * lane moves a processor the chain has, by points at whole frames from 0, each
 * after the one before, of finite values, and no parameter is moved by two
 * lanes. Whether the parameter is numeric, may move while the chain runs and
 * takes the values given is the processor's to say, and the rack that runs the
 * chain checks it against the processor's descriptor.
 */
export function automationProblem(
  automation: readonly ParameterAutomation[],
  chain: EffectChain,
): string | undefined {
  const processors = new Set<string>();
  for (const processor of processorsOf(chain.slots)) processors.add(processor.id);
  const moved = new Set<string>();
  for (const lane of automation) {
    if (!processors.has(lane.processor)) {
      return 'An automation lane moves a processor its chain does not have.';
    }
    const name = `${lane.processor} ${lane.parameter}`;
    if (moved.has(name)) return 'Two automation lanes move one parameter.';
    moved.add(name);
    if (lane.points.length === 0) return 'An automation lane has no points.';
    let last = -1;
    for (const { frame, value } of lane.points) {
      if (!isFrame(frame) || frame <= last) {
        return 'An automation lane’s points are at whole frames from 0, each after the one before.';
      }
      if (!Number.isFinite(value)) return 'An automation lane’s value is not a finite number.';
      last = frame;
    }
  }
  return undefined;
}

/**
 * Why a varispeed stream does not hold, or `undefined` where it does: its
 * ratio is a whole number of 4,096ths within two octaves either way, and it
 * plays one segment that reads a later stream of its own rate and layout.
 */
export function varispeedProblem(
  plan: EditPlan,
  stream: PlanStream,
  processing: Extract<StreamProcessing, { readonly kind: 'varispeed' }>,
): string | undefined {
  // The denominator is fixed by the type, and a message's reader refuses another.
  const { numerator } = processing;
  if (
    !Number.isInteger(numerator) ||
    numerator < VARISPEED_NUMERATORS.least ||
    numerator > VARISPEED_NUMERATORS.most
  ) {
    return 'A varispeed’s ratio is a whole number of 4,096ths from 1,024 to 16,384.';
  }
  const [segment, ...rest] = stream.segments;
  const read = segment?.source.kind === 'stream' ? plan.streams[segment.source.stream] : undefined;
  if (
    rest.length > 0 ||
    read?.sampleRate !== stream.sampleRate ||
    !layoutsMatch(read.layout, stream.layout)
  ) {
    return 'A varispeed plays one segment of a later stream of its own rate and layout.';
  }
  return undefined;
}

/**
 * What `plan` holds that a project never keeps, or `undefined` where it holds
 * none: a varispeed stream, or a chain's automation, which only a plan made
 * for hearing a game's preview has (ADR-0104). An insertion's payload is kept
 * in the project's history and document, so it is refused either.
 */
export function generatedProcessing(plan: EditPlan): 'varispeed' | 'automation' | undefined {
  for (const { processing } of plan.streams) {
    if (processing?.kind === 'varispeed') return 'varispeed';
    if (processing?.kind === 'chain' && processing.automation !== undefined) return 'automation';
  }
  return undefined;
}
