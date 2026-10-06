/**
 * A machine-learning processor's kernel: it plays back what its whole pass
 * made, the model's output over the whole stream, frame for frame from the
 * frame of the stream its run starts at (ADR-0062, decision 19 of the phase).
 *
 * The pass has already aligned the output with the input, so the kernel delays
 * nothing, needs no lead-in and counts no frames but its position, which starts
 * at the run's `start`: a preview started part way through plays what a run
 * from the stream's first frame plays there, and a path that reaches the kernel
 * late starts it before frame 0 by as much. Before the stream's first frame and
 * past the end of what was made it writes silence: the rack cuts a chain's
 * latency at the start and its tail at the stream's end, so nothing heard lies
 * there. Unmeasured, it passes its input on through `finiteSample`, so the
 * rack's pass over the stream can be made through it. A list of numbers is
 * another processor's kind of measurement, and samples whose count is not a
 * whole number of frames over its channels are not a pass's output: a node
 * holding either was built wrongly, which no pass over the stream again would
 * mend.
 *
 * Its parameters shaped the inference, so a change to one is heard once the
 * pass is made again, never from a kernel that is playing.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import type { AudioFrameBlock, NodeKernel } from '@audiogubbins/audio-engine';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';

function refused(code: string, summary: string): DomainFailureResult {
  return fail(failure(code, FailureKind.Unrecoverable, summary));
}

/** Plays back a planar measurement, or passes its input on where it has none. */
class PlaybackKernel implements NodeKernel {
  readonly #label: string;
  readonly #samples: Float32Array | undefined;
  /** The frames a channel of `#samples` holds. */
  readonly #frames: number;
  /** The frame of the stream the next frame of input carries. */
  #position: number;

  constructor(label: string, samples: Float32Array | undefined, channels: number, start: number) {
    this.#label = label;
    this.#samples = samples;
    this.#frames = samples === undefined ? 0 : samples.length / channels;
    this.#position = start;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const output = outputs[0];
    if (output === undefined) throw new Error(`A ${this.#label} was given no output.`);
    const samples = this.#samples;
    if (samples === undefined) {
      const input = inputs[0];
      for (const [channel, into] of output.channels.entries()) {
        const from = input?.channels[channel];
        for (let frame = 0; frame < frames; frame += 1) {
          into[frame] = finiteSample(from?.[frame] ?? 0);
        }
      }
      return;
    }
    const start = this.#position;
    // The block's frames that fall within what was made, from `first` to `last`.
    const first = Math.min(frames, Math.max(0, -start));
    const last = Math.max(first, Math.min(frames, this.#frames - start));
    for (const [channel, into] of output.channels.entries()) {
      const base = channel * this.#frames + start;
      into.fill(0, 0, first);
      into.set(samples.subarray(base + first, base + last), first);
      into.fill(0, last, frames);
    }
    this.#position = start + frames;
  }

  setParameter(name: string): DomainResult<void> {
    return fail(
      failure(
        'processor.parameter-needs-pass',
        FailureKind.Rejected,
        `A ${this.#label}'s "${name}" shaped its inference, so a change to it is heard once its pass is made again.`,
        { details: { name } },
      ),
    );
  }

  release(): void {
    // It holds nothing but the measurement, which its node keeps.
  }
}

/** The kernel that plays back `run`'s measurement, for the processor `label` names. */
export function playbackKernel(run: ProcessorRun, label: string): DomainResult<NodeKernel> {
  const { measured } = run;
  const channels = run.output.roles.length;
  if (measured !== undefined && !(measured instanceof Float32Array)) {
    return refused(
      'processor.measurement-kind',
      `A ${label} plays back the samples its pass made, but its node holds a list of numbers.`,
    );
  }
  if (measured !== undefined && measured.length % channels !== 0) {
    return refused(
      'processor.measurement-shape',
      `A ${label}'s node holds ${String(measured.length)} samples, which are not a whole number of frames over its ${String(channels)} channels.`,
    );
  }
  return succeed(new PlaybackKernel(label, measured, channels, run.start));
}
