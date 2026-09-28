/**
 * Processors and effect chains.
 *
 * REQ-ARCH-004.3 makes processing parametric: a chain records which processors
 * are present, in what order, with what settings. It never records audio.
 *
 * REQ-ARCH-144 requires processor latency to be explicit and compensable, so a
 * processor declares its latency rather than leaving the engine to discover it.
 * A chain that does not know its own latency cannot be delay-compensated, and
 * material processed through it arrives late against material that was not.
 */

import type { EffectChainId, ParameterId, ProcessorId } from '../identity/branded-id.js';
import { sampleCount, type SampleCount } from '../time/sample-time.js';
import {
  defaultParameterValue,
  type ParameterDescriptor,
  type ParameterValue,
  validateParameterValue,
} from './parameter.js';
import { combine, failure, FailureKind, type DomainResult, fail } from '../result.js';

/**
 * Describes a kind of processor, independently of any instance of it.
 *
 * The implementation lives in the DSP layer. This is the contract the project
 * model, the Inspector and the command layer work against, so that adding a
 * processor does not mean editing the project model.
 */
export interface ProcessorDescriptor {
  /** Stable machine-readable type key, for example `parametric-eq`. */
  readonly typeKey: string;

  /** British-English label for menus and the Inspector. */
  readonly label: string;

  /**
   * Implementation version.
   *
   * REQ-REPO-187 requires processor implementation versions to be independent
   * of the product version. A project records which version processed it, so
   * that a later correction to the algorithm does not silently change an
   * existing mix.
   */
  readonly implementationVersion: number;

  readonly parameters: readonly ParameterDescriptor[];

  /**
   * Frames of delay the processor introduces at its declared rate.
   *
   * Zero for a processor that is genuinely instantaneous. REQ-EXEC-216 names
   * "a processor is zero-latency" as an assumption that must not be made
   * silently, so this is required rather than optional.
   */
  readonly latency: SampleCount;
}

/** One processor placed in a chain, with its settings. */
export interface ProcessorInstance {
  readonly id: ProcessorId;
  readonly typeKey: string;

  /** Whether the processor is currently applied. */
  readonly enabled: boolean;

  /**
   * Whether the processor is heard alone.
   *
   * Auditioning one processor of a chain is a listening aid. Like track solo,
   * it is a chain-wide question, answered by {@link processorsInSignalOrder}.
   */
  readonly soloed: boolean;

  /** Current value of each parameter, keyed by parameter identifier. */
  readonly values: ReadonlyMap<ParameterId, ParameterValue>;
}

/**
 * An ordered series of processors.
 *
 * Order is signal order, first to last. It is significant: a filter before a
 * compressor is a different sound from a compressor before a filter, so the
 * order is stored rather than derived from anything.
 */
export interface EffectChain {
  readonly id: EffectChainId;
  readonly processors: readonly ProcessorInstance[];
}

/**
 * The processors that will actually be applied, in signal order.
 *
 * Solo wins over enabled, matching how every processor rack behaves: soloing
 * one band to hear it does not require disabling the rest by hand.
 */
export function processorsInSignalOrder(chain: EffectChain): readonly ProcessorInstance[] {
  const soloed = chain.processors.filter((processor) => processor.soloed);
  return soloed.length > 0 ? soloed : chain.processors.filter((processor) => processor.enabled);
}

/**
 * Total latency the chain introduces.
 *
 * Only the processors that will be applied contribute, because a bypassed
 * processor delays nothing. REQ-ARCH-144 requires this to be computable, since
 * the engine compensates by exactly this many frames.
 */
export function chainLatency(
  chain: EffectChain,
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
): DomainResult<SampleCount> {
  let total = 0;

  for (const processor of processorsInSignalOrder(chain)) {
    const descriptor = descriptors.get(processor.typeKey);
    if (descriptor === undefined) {
      return fail(
        failure(
          'effect-chain.unknown-processor-type',
          FailureKind.IntegrityViolation,
          `The chain holds a processor of unknown type "${processor.typeKey}".`,
          {
            details: { typeKey: processor.typeKey, processorId: processor.id },
          },
        ),
      );
    }
    total += descriptor.latency;
  }

  // Checked like any other count: a sum of latencies can leave the range where
  // every integer is exact, and a total asserted into the type could not say
  // so.
  return sampleCount(total);
}

/** Builds a processor instance with every parameter at its default. */
export function instantiateProcessor(
  id: ProcessorId,
  descriptor: ProcessorDescriptor,
): ProcessorInstance {
  return {
    id,
    typeKey: descriptor.typeKey,
    enabled: true,
    soloed: false,
    values: new Map(
      descriptor.parameters.map((parameter) => [parameter.id, defaultParameterValue(parameter)]),
    ),
  };
}

/**
 * Checks that a processor instance matches its descriptor.
 *
 * Reports every problem rather than the first, so a project opened after a
 * processor gained a parameter tells the user everything that has changed.
 */
export function validateProcessorInstance(
  processor: ProcessorInstance,
  descriptor: ProcessorDescriptor,
): DomainResult<readonly ParameterValue[]> {
  if (processor.typeKey !== descriptor.typeKey) {
    return fail(
      failure(
        'effect-chain.descriptor-mismatch',
        FailureKind.IntegrityViolation,
        'The processor was checked against a descriptor for a different type.',
        {
          details: { processorType: processor.typeKey, descriptorType: descriptor.typeKey },
        },
      ),
    );
  }

  const checks = descriptor.parameters.map((parameter) => {
    const value = processor.values.get(parameter.id);
    if (value === undefined) {
      return fail(
        failure(
          'effect-chain.missing-parameter-value',
          FailureKind.IntegrityViolation,
          `Processor "${descriptor.typeKey}" has no value for parameter "${parameter.key}".`,
          {
            details: { typeKey: descriptor.typeKey, parameter: parameter.key },
          },
        ),
      );
    }
    return validateParameterValue(parameter, value);
  });

  const known = new Set(descriptor.parameters.map((parameter) => parameter.id));
  const unexpected = [...processor.values.keys()].filter((id) => !known.has(id));
  if (unexpected.length > 0) {
    checks.push(
      fail(
        failure(
          'effect-chain.unexpected-parameter-value',
          FailureKind.IntegrityViolation,
          `Processor "${descriptor.typeKey}" holds values for parameters it does not declare.`,
          {
            details: { typeKey: descriptor.typeKey, unexpected: unexpected.join(', ') },
          },
        ),
      ),
    );
  }

  return combine(checks);
}
