/**
 * A rack's processing made for the tests of what reads processed streams
 * without the effect rack: every chain it runs scales its input by a factor,
 * which a running change of any parameter sets, and is heard live or from a
 * render as the test says. Each run it prepares is counted, with the frame
 * it starts at and the signal it was given, and its preparing waits for the
 * gate a test may give it.
 */

import { StandardLayouts, succeed, type CancellationSignal } from '@audiogubbins/domain';

import type { ChainProcessing, ChainRun } from '../pcm/chain-processing.js';

/** What a test sees of a scaling chain's runs. */
export interface ScalingRuns {
  readonly processing: ChainProcessing;
  /** The frame each run prepared starts at, in order. */
  readonly starts: number[];
  /** The signal each run was prepared with, in order. */
  readonly signals: (CancellationSignal | undefined)[];
}

/** Why a chain that cannot run live is heard from a render, as the rack would word it. */
export const SCALING_REASON = 'It measures the whole of its input before it plays anything.';

/**
 * Mono chains that scale by `factor`, heard live, or from a render where
 * `rendered`, each prepared once `gate` settles.
 */
export function scalingChain(
  options: {
    readonly factor?: number;
    readonly rendered?: boolean;
    readonly gate?: Promise<void>;
  } = {},
): ScalingRuns {
  const starts: number[] = [];
  const signals: (CancellationSignal | undefined)[] = [];
  const partWay = { leadIn: 0, frameGrid: 1 };
  const processing: ChainProcessing = {
    listening: () =>
      succeed(
        options.rendered === true
          ? { kind: 'rendered', partWay, reason: SCALING_REASON }
          : { kind: 'live', partWay },
      ),
    prepare: async (request, _read, signal) => {
      starts.push(request.start);
      signals.push(signal);
      await options.gate;
      let factor = options.factor ?? 2;
      const run: ChainRun = {
        latency: 0,
        layout: StandardLayouts.mono,
        process: (input, output, frames) => {
          const from = input[0];
          const into = output[0];
          for (let frame = 0; frame < frames; frame += 1) {
            if (into !== undefined) into[frame] = factor * (from?.[frame] ?? 0);
          }
        },
        setParameter: (_processor, _parameter, value) => {
          factor = value;
          return succeed(undefined);
        },
        release: () => undefined,
      };
      return succeed(run);
    },
  };
  return { processing, starts, signals };
}
