/**
 * What the capture processor plays: the monitored input, a path apart from
 * the capture (ADR-0070).
 *
 * Silent unless monitoring is on, which it is not until the page turns it on,
 * and nothing else turns it on: arming and recording never touch it
 * (REQ-REC-091). On, it plays the input dry, or through a chain run live by
 * the effect rack's live form, given to the processor as the engine's
 * `ChainProcessing` port, so this module imports no processor. The chain
 * reads the input and writes the output alone: the capture has already taken
 * its copy of the quantum, and nothing here can reach it. A chain the rack
 * refuses, or whose output is not the input's channels, which the node's
 * output is made with, leaves monitoring as it was, with the reason.
 */

import {
  channelCount,
  FailureKind,
  fail,
  failure,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type EffectChain,
  type ParameterId,
  type ProcessorId,
  type QualityMode,
  type SampleRate,
} from '@audiogubbins/domain';
import type { CanonicalDsp, ChainProcessing, ChainRun } from '@audiogubbins/audio-engine';

/** What a monitoring chain is run with, fixed for the input's life. */
export interface MonitoringSettings {
  readonly processing: ChainProcessing;
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly blockFrames: number;
  readonly dsp: CanonicalDsp;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`capture.${code}`, FailureKind.Rejected, summary));
}

/** The monitored path: off, dry or through a live chain. */
export class MonitoringPath {
  readonly #settings: MonitoringSettings;
  #on = false;
  #run: ChainRun | undefined;

  constructor(settings: MonitoringSettings) {
    this.#settings = settings;
  }

  get on(): boolean {
    return this.#on;
  }

  /** Whether it plays through a chain rather than dry. */
  get chained(): boolean {
    return this.#run !== undefined;
  }

  /** Frames the chain makes the monitored signal late by; none dry. */
  get latency(): number {
    return this.#run?.latency ?? 0;
  }

  turn(on: boolean): void {
    this.#on = on;
  }

  /**
   * Monitors through `chain` at `quality` from the next quantum, or dry where
   * there is none, or says why the chain cannot monitor, leaving the path as
   * it was. Made on a message, never in a quantum, since a run allocates.
   */
  choose(chain: EffectChain | undefined, quality: QualityMode): DomainResult<void> {
    if (chain === undefined) {
      this.#replace(undefined);
      return succeed(undefined);
    }
    const { processing, layout, sampleRate, blockFrames, dsp } = this.#settings;
    const made = processing.prepareLive({
      chain,
      input: layout,
      sampleRate,
      quality: quality.settings,
      blockFrames,
      dsp,
    });
    if (!made.ok) return made;
    const channels = channelCount(layout);
    if (channelCount(made.value.layout) !== channels) {
      made.value.release();
      return refused(
        'monitoring-channels-changed',
        `The chain makes ${String(channelCount(made.value.layout))} channels of an input of ${String(channels)}, and monitoring plays the input's own channels.`,
      );
    }
    this.#replace(made.value);
    return succeed(undefined);
  }

  /** Changes a parameter of the running chain, or says why it cannot. */
  setParameter(processor: ProcessorId, parameter: ParameterId, value: number): DomainResult<void> {
    const run = this.#run;
    if (run === undefined) {
      return refused(
        'monitoring-not-chained',
        'Monitoring runs no chain, so it has no parameter to change.',
      );
    }
    return run.setParameter(processor, parameter, value);
  }

  /** Writes the monitored quantum of `input` into `output`: silence unless monitoring is on. */
  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
    if (!this.#on) {
      for (const channel of output) channel.fill(0);
      return;
    }
    const run = this.#run;
    if (run !== undefined) {
      run.process(input, output, frames);
      return;
    }
    for (let channel = 0; channel < output.length; channel += 1) {
      const from = input[channel];
      const to = output[channel];
      if (to === undefined) continue;
      // Sample by sample: a view of the input would be an object made each quantum.
      for (let frame = 0; frame < frames; frame += 1) to[frame] = from?.[frame] ?? 0;
    }
  }

  /** Lets the chain go and turns monitoring off. */
  release(): void {
    this.#replace(undefined);
    this.#on = false;
  }

  #replace(run: ChainRun | undefined): void {
    this.#run?.release();
    this.#run = run;
  }
}
