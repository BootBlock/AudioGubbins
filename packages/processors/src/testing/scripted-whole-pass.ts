/**
 * A whole-pass processor type made for tests of what runs one, as the rack
 * does: its kernel passes its input on and its measurer hears nothing,
 * answering as each test scripts it, as a model's measurer may be slow,
 * refused or cancelled. What the test needs to see of a run is counted.
 */

import {
  DeterminismClass,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import { processorType, type ProcessorType } from '../framework/processor-type.js';
import type { Measurement, Measurer } from '../framework/whole-pass.js';

/** What a test scripts of its measurer: how it hears and how it answers. */
export interface PassScript {
  add?(signal: CancellationSignal | undefined): Promise<void>;
  result(signal: CancellationSignal | undefined): Promise<DomainResult<Measurement>>;
}

/** What a test sees of the runs of the type: its measurers and its kernels. */
export interface PassCounts {
  /** Measurers released. */
  released: number;
  /** Kernels made and not yet released, those of every pass's executor. */
  live: number;
  /** What each kernel was made with, in the order they were made. */
  readonly measured: (Measurement | undefined)[];
}

/** A measurer that hears nothing and answers as its script says. */
class ScriptedMeasurer implements Measurer {
  readonly #script: PassScript;
  readonly #counts: PassCounts;

  constructor(script: PassScript, counts: PassCounts) {
    this.#script = script;
    this.#counts = counts;
  }

  add(_input: readonly Float32Array[], _frames: number, signal?: CancellationSignal) {
    return this.#script.add?.(signal) ?? Promise.resolve();
  }

  result(signal?: CancellationSignal) {
    return this.#script.result(signal);
  }

  release(): void {
    this.#counts.released += 1;
  }
}

/** A whole-pass type whose measurer follows `script`, its runs counted in `counts`. */
export function scriptedWholePass(script: PassScript, counts: PassCounts): ProcessorType {
  return processorType({
    descriptor: {
      typeKey: 'scripted-whole-pass',
      label: 'Scripted whole pass',
      category: ProcessorCategory.Level,
      version: { implementation: 1, parameters: 1 },
      parameters: [],
      qualitySettings: [],
      determinism: DeterminismClass.Canonical,
      wholePass: true,
      realTime: false,
      outputLayout: (input) => succeed(input),
      latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
      leadIn: () => 0,
      frameGrid: () => 1,
    },
    kernel: (run) => {
      counts.live += 1;
      counts.measured.push(run.measured);
      return succeed({
        process: (inputs, outputs, frames) => {
          outputs[0]?.channels.forEach((channel, index) => {
            channel.set(inputs[0]?.channels[index]?.subarray(0, frames) ?? []);
          });
        },
        setParameter: () => succeed(undefined),
        release: () => {
          counts.live -= 1;
        },
      });
    },
    measure: () => new ScriptedMeasurer(script, counts),
  });
}
