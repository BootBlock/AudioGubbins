/**
 * What a node type is to the engine: its contract with the graph, and the
 * kernel that runs it.
 *
 * ADR-0030 makes a node type one object, so the rules the graph checks a node
 * against and the code that processes it cannot disagree: a
 * {@link NodeImplementation} states the graph's {@link NodeContract} and makes
 * the node's kernel from the step of a plan.
 *
 * A kernel runs on whichever thread runs the executor, an AudioWorklet among
 * them, so everything it touches while processing is made when it is created:
 * processing allocates nothing and awaits nothing. What reaches a kernel from
 * outside the graph, the audio a graph input reads, the place a sink delivers
 * to and the reader of a meter, is bound by the host that runs the graph and
 * given to the kernel through the {@link KernelContext}.
 */

import type { ChannelLayout, DomainResult, SampleRate } from '@audiogubbins/domain';
import type { NodeContract, NodeId, PlanStep } from '@audiogubbins/audio-graph';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { Accelerator } from './accelerator.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';

/**
 * Audio a graph input reads, a block at a time, without waiting.
 *
 * The host fills it ahead of the executor: the offline renderer from a
 * source it reads before each block, and the worklet from the feed that
 * crosses from the main thread.
 */
export interface InputFeed {
  /** The layout of the audio it has, which the graph input's port must match. */
  readonly layout: ChannelLayout;

  /**
   * Writes the next `into.frames` frames into `into`, which has the layout
   * of the graph input's port, and answers how many it had. The input
   * silences the rest: a feed that runs short is an underrun or the end.
   */
  fill(into: AudioFrameBlock): number;
}

/** Where a sink delivers the graph's audio, a block at a time. */
export interface SinkTarget {
  /**
   * Takes the block a sink received. The block is the executor's and is
   * overwritten by the next one, so a target that keeps audio copies it.
   */
  receive(block: AudioFrameBlock): void;
}

/** What a meter measured over one block, per channel in its layout's order. */
export interface MeterReading {
  readonly frames: number;
  /** The largest magnitude on each channel. */
  readonly peak: readonly number[];
  /** The root mean square of each channel. */
  readonly rms: readonly number[];
  /**
   * The phase correlation of each pair the meter's `correlate` setting
   * names, in its order, from -1 to 1; empty when it names none.
   */
  readonly correlation: readonly number[];
}

/** Where a meter reports what it measured. */
export interface MeterTarget {
  /** Takes one block's reading, whose arrays the meter reuses for the next. */
  receive(reading: MeterReading): void;
}

/** What a kernel may use, bound once for the executor's life. */
export interface KernelContext {
  readonly sampleRate: SampleRate;

  /** The most frames one call of {@link NodeKernel.process} is given. */
  readonly blockFrames: number;
  readonly dsp: CanonicalDsp;

  /** The feed bound to a graph input node, if the host bound one. */
  feedFor(node: NodeId): InputFeed | undefined;

  /** The target bound to a sink node, if the host bound one. */
  sinkFor(node: NodeId): SinkTarget | undefined;

  /** The target bound to a meter node, if the host bound one. */
  meterFor(node: NodeId): MeterTarget | undefined;
}

/** The running form of one node. */
export interface NodeKernel {
  /**
   * Processes one block. `inputs` and `outputs` are in the step's port order,
   * each `frames` long, and the inputs are already aligned by the executor.
   * The kernel writes every frame of every output: an output's buffer is
   * reused and holds another port's audio until it does.
   */
  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void;

  /**
   * Changes a parameter while running, smoothed where a jump would click, or
   * says why the kernel has no such parameter or refuses the value.
   */
  setParameter(name: string, value: number): DomainResult<void>;

  /** Releases what the kernel holds, such as memory in the DSP module. */
  release(): void;
}

/** A node type: its contract with the graph, and the kernel that runs it. */
export interface NodeImplementation extends NodeContract {
  /**
   * The accelerators this type has a path for beside its canonical kernel, in
   * the order it prefers them; none where the kernel is its only path, as for
   * every built-in type. Which path runs is `selectNodePaths`'s choice.
   */
  readonly accelerators?: readonly Accelerator[];

  /**
   * The kernel for one step of a plan, or why it cannot run in this context,
   * such as a graph input with no feed bound to it.
   */
  createKernel(step: PlanStep, context: KernelContext): DomainResult<NodeKernel>;
}

/** The node types an executor runs, by type; also the catalogue the graph checks against. */
export type NodeImplementations = ReadonlyMap<string, NodeImplementation>;
