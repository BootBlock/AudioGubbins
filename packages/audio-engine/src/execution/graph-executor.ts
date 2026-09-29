/**
 * The executor: runs an execution plan, a block at a time.
 *
 * The plan decided everything (ADR-0030): the order of the steps, the buffer
 * slot each port reads and writes, and the delay that keeps each input
 * aligned. The executor makes each step's kernel and a delay line for each
 * compensated input once, sizes every slot once for the largest block, and
 * then only runs: a block allocates nothing, so the same executor runs on an
 * AudioWorklet's thread, in a render worker and in a test (REQ-ARCH-036).
 *
 * Every kernel and delay line processes frame by frame in a stated order, so
 * a stream cut into blocks of any sizes gives the same bits as one cut into
 * others (REQ-ARCH-049).
 */

import {
  failure,
  FailureKind,
  fail,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ExecutionPlan, NodeId, PlanStep } from '@audiogubbins/audio-graph';

import type {
  KernelContext,
  NodeImplementations,
  NodeKernel,
} from '../nodes/node-implementation.js';
import { DelayLine } from '../pcm/delay-line.js';
import { blockView, type AudioFrameBlock } from '../pcm/frame-block.js';

/** A plan, ready to run block by block. */
export interface GraphExecutor {
  readonly plan: ExecutionPlan;

  /** The most frames one call of {@link process} runs. */
  readonly blockFrames: number;

  /**
   * Runs every step over the next `frames` frames, at most
   * {@link blockFrames}. Feeds are read and sinks delivered to on the way.
   */
  process(frames: number): void;

  /** Changes a running parameter of one node, or says why it cannot. */
  setParameter(node: NodeId, name: string, value: number): DomainResult<void>;

  /** Releases every kernel. The executor runs nothing after. */
  release(): void;
}

/** One compensated input: the slot it reads, its delay, and which input it is. */
interface Alignment {
  readonly input: number;
  readonly line: DelayLine;
  readonly slot: AudioFrameBlock;
}

/** One step, bound to its kernel and its buffers. */
interface BoundStep {
  readonly kernel: NodeKernel;

  /** What the kernel reads: a slot, or the block a compensated input is delayed into. */
  readonly inputs: readonly AudioFrameBlock[];
  readonly outputs: readonly AudioFrameBlock[];

  readonly alignments: readonly Alignment[];
}

function executionFailure(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** A block of `layout` over the arrays of a slot. */
function over(
  slot: readonly Float32Array[],
  layout: ChannelLayout,
  context: KernelContext,
): AudioFrameBlock {
  return { layout, sampleRate: context.sampleRate, frames: context.blockFrames, channels: slot };
}

function newSlot(channels: number, frames: number): readonly Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

function slotArrays(
  slots: readonly (readonly Float32Array[])[],
  index: number,
): readonly Float32Array[] {
  const slot = slots[index];
  if (slot === undefined) throw new Error('A plan names a slot it does not size.');
  return slot;
}

function bind(
  step: PlanStep,
  kernel: NodeKernel,
  slots: readonly (readonly Float32Array[])[],
  context: KernelContext,
): BoundStep {
  const alignments: Alignment[] = [];
  const inputs = step.inputs.map((input, index) => {
    const slot = over(slotArrays(slots, input.slot), input.layout, context);
    if (input.delay === 0) return slot;
    const delayed = over(newSlot(slot.channels.length, context.blockFrames), input.layout, context);
    alignments.push({
      input: index,
      line: new DelayLine(slot.channels.map(() => input.delay)),
      slot,
    });
    return delayed;
  });
  const outputs = step.outputs.map((output) =>
    over(slotArrays(slots, output.slot), output.layout, context),
  );
  return { kernel, inputs, outputs, alignments };
}

/**
 * The blocks cut to `frames`. A whole block, which is every block the worklet
 * runs, is the blocks themselves, so the audio thread allocates nothing.
 */
function cut(
  blocks: readonly AudioFrameBlock[],
  frames: number,
  whole: boolean,
): readonly AudioFrameBlock[] {
  return whole ? blocks : blocks.map((block) => blockView(block, 0, frames));
}

/** Makes every kernel, or releases those made and says why one could not be. */
function makeKernels(
  plan: ExecutionPlan,
  implementations: NodeImplementations,
  context: KernelContext,
): DomainResult<readonly NodeKernel[]> {
  const kernels: NodeKernel[] = [];
  for (const step of plan.steps) {
    const implementation = implementations.get(step.type);
    const kernel =
      implementation === undefined
        ? executionFailure(
            'execution.node-type-unknown',
            `Node ${step.node} has the type "${step.type}", which this engine does not run.`,
          )
        : implementation.createKernel(step, context);
    if (!kernel.ok) {
      for (const made of kernels) made.release();
      return kernel;
    }
    kernels.push(kernel.value);
  }
  return succeed(kernels);
}

/** A plan's steps, bound to their kernels and buffers, run a block at a time. */
class PlanExecutor implements GraphExecutor {
  readonly plan: ExecutionPlan;
  readonly blockFrames: number;
  readonly #steps: readonly BoundStep[];
  readonly #byNode: ReadonlyMap<NodeId, BoundStep>;

  constructor(plan: ExecutionPlan, steps: readonly BoundStep[], blockFrames: number) {
    this.plan = plan;
    this.blockFrames = blockFrames;
    this.#steps = steps;
    this.#byNode = new Map(
      plan.steps.flatMap((step, index) => {
        const bound = steps[index];
        return bound === undefined ? [] : [[step.node, bound] as const];
      }),
    );
  }

  process(frames: number): void {
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > this.blockFrames) {
      // The host sizes every block it asks for, so this is a fault in the host.
      throw new Error(
        `An executor of ${String(this.blockFrames)}-frame blocks was asked for ${String(frames)}.`,
      );
    }
    const whole = frames === this.blockFrames;
    for (const step of this.#steps) {
      const inputs = cut(step.inputs, frames, whole);
      for (const alignment of step.alignments) {
        const into = inputs[alignment.input];
        if (into !== undefined) alignment.line.process(alignment.slot, into, frames);
      }
      step.kernel.process(inputs, cut(step.outputs, frames, whole), frames);
    }
  }

  setParameter(node: NodeId, name: string, value: number): DomainResult<void> {
    const step = this.#byNode.get(node);
    return step === undefined
      ? executionFailure(
          'execution.node-unknown',
          `The graph has no node ${node}, so none of its parameters can change.`,
        )
      : step.kernel.setParameter(name, value);
  }

  release(): void {
    for (const step of this.#steps) step.kernel.release();
  }
}

/**
 * An executor for a plan, with each step's kernel made in `context`, or why
 * one of them cannot run there.
 */
export function createExecutor(
  plan: ExecutionPlan,
  implementations: NodeImplementations,
  context: KernelContext,
): DomainResult<GraphExecutor> {
  if (plan.sampleRate !== context.sampleRate) {
    // A plan's latencies and compensation are in frames at its own rate.
    return executionFailure(
      'execution.rate-mismatch',
      'A plan runs at the rate it was made for; compile the graph again at this rate.',
    );
  }
  if (!Number.isSafeInteger(context.blockFrames) || context.blockFrames < 1) {
    return executionFailure(
      'execution.block-frames-invalid',
      'An executor runs blocks of at least one whole frame.',
    );
  }
  const made = makeKernels(plan, implementations, context);
  if (!made.ok) return made;
  const slots = plan.slots.map((slot) => newSlot(slot.channels, context.blockFrames));
  const steps = plan.steps.map((step, index) => {
    const kernel = made.value[index];
    if (kernel === undefined) throw new Error('A kernel was made for every step.');
    return bind(step, kernel, slots, context);
  });
  return succeed(new PlanExecutor(plan, steps, context.blockFrames));
}
