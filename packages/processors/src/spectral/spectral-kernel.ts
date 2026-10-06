/**
 * The kernels of the spectral processors: a stream through the short-time
 * Fourier transform and a processor's change to each frame (`overlap-add.ts`),
 * and, for a processor with nothing to change, the same delay without the
 * transform, so its output lines up with what it would have written.
 *
 * Either takes its moving parameters by key, ramped a sample at a time, so a
 * frame reads them where it ends whatever the blocks.
 */

import {
  DelayLine,
  allocateBlock,
  channelAt,
  portAt,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';
import type { DomainResult } from '@audiogubbins/domain';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';
import type { RampedParameters } from '../dynamics/ramped-parameters.js';
import type { FrameAnalysis } from './frame-analysis.js';
import { OverlapAdd, type SpectralTransform } from './overlap-add.js';

/** A stream through a spectral transform, `N − 1` frames late. */
export class SpectralKernel implements NodeKernel {
  readonly #overlap: OverlapAdd;
  readonly #transform: SpectralTransform;
  readonly #ramps: RampedParameters;

  constructor(analysis: FrameAnalysis, transform: SpectralTransform, ramps: RampedParameters) {
    this.#overlap = new OverlapAdd(analysis);
    this.#transform = transform;
    this.#ramps = ramps;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    this.#ramps.advance(frames);
    this.#overlap.process(portAt(inputs, 0), portAt(outputs, 0), frames, this.#transform);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#ramps.set(name, value);
  }

  release(): void {
    this.#overlap.analysis.release();
  }
}

/**
 * The input, every sample read through `finiteSample`, delayed by `delay`
 * frames. Its parameters are checked and taken as the transform's would be,
 * and change nothing.
 */
export class SpectralDelayKernel implements NodeKernel {
  readonly #finite: AudioFrameBlock;
  readonly #line: DelayLine;
  readonly #ramps: RampedParameters;

  constructor(run: ProcessorRun, delay: number, ramps: RampedParameters) {
    this.#finite = allocateBlock(run.input, run.sampleRate, run.blockFrames);
    this.#line = new DelayLine(run.input.roles.map(() => delay));
    this.#ramps = ramps;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const finite = this.#finite;
    for (let channel = 0; channel < finite.channels.length; channel += 1) {
      const from = channelAt(input, channel);
      const into = channelAt(finite, channel);
      for (let frame = 0; frame < frames; frame += 1) into[frame] = finiteSample(from[frame] ?? 0);
    }
    this.#line.process(finite, portAt(outputs, 0), frames);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#ramps.set(name, value);
  }

  release(): void {
    // Holds only its own history and copy, which are collected with it.
  }
}
