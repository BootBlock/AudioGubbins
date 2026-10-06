/**
 * The frames a de-pop works in at a rate, a pop frequency and a longest pop,
 * the one authority its descriptor's latency and its kernel's rings are read
 * from.
 *
 * The low band arrives `Δ = 2(K − 1)` frames late, the delay of the
 * moving-average split (`moving-average.ts`), and every later step works on
 * the frames it is aligned to. Its power at frame `t` is its mean square over
 * the `W = 2h + 1` frames centred on `t`, `h = ⌈rate / 2f⌉`: one period of
 * the pop frequency `f`, so a partial near it adds little ripple. A run is
 * judged over the `H = Δ + M + 2W` frames from its start, `M` the longest
 * pop: the split rings for up to `Δ` frames before a pop, its core may be
 * `M + W` frames, the window having widened it, and the core must be seen to
 * end `W` frames before the horizon does. The floor at `t` is the least power
 * over the `2R + 1` frames centred on it, `R = Δ + M + 3W`: wider either side
 * than all of a pop's run, so the floor under a pop is the level beside it,
 * and wide enough that a note that starts out of silence and holds stays
 * above its floor past the horizon of the run it starts. A repair is
 * crossfaded over `h` frames either side, and a frame's floor is known
 * `h + R` frames after the frame, so a repair is decided `H + h + R` frames
 * after its run starts and reaches back `h` frames before it. The latency is
 * so `Δ + H + h + R + h = 3Δ + 2M + 12h + 5` frames. The rings hold it, and
 * the `W` frames before a run whose level a repair is made to.
 */

import type { SampleRate } from '@audiogubbins/domain';

import { framesOf } from '../dynamics/envelope.js';
import { averageDelay, averageLength } from './moving-average.js';

/** The frames a de-pop works in. */
export interface PopGeometry {
  /** `K`, each moving average's length. */
  readonly split: number;
  /** `Δ = 2(K − 1)`, the low band's delay. */
  readonly alignment: number;
  /** `h`, half the power's window. */
  readonly half: number;
  /** `W = 2h + 1`, the power's window: one period of the frequency. */
  readonly period: number;
  /** `M`, the longest pop. */
  readonly longest: number;
  /** `R = Δ + M + 3W`, the floor's reach either side. */
  readonly reach: number;
  /** `H = Δ + M + 2W`, the frames a run is judged over. */
  readonly horizon: number;
  /** `3Δ + 2M + 12h + 5`. */
  readonly latency: number;
  readonly ringFrames: number;
}

/** The geometry at `rate` for pops below `frequency` Hz and up to `milliseconds` long. */
export function popGeometry(
  rate: SampleRate,
  frequency: number,
  milliseconds: number,
): PopGeometry {
  const split = averageLength(rate, frequency);
  const alignment = averageDelay(split);
  const half = Math.ceil(rate / (2 * frequency));
  const period = 2 * half + 1;
  const longest = Math.max(1, framesOf(milliseconds, rate));
  const reach = alignment + longest + 3 * period;
  const horizon = alignment + longest + 2 * period;
  const latency = alignment + horizon + half + reach + half;
  return {
    split,
    alignment,
    half,
    period,
    longest,
    reach,
    horizon,
    latency,
    ringFrames: latency + period + 1,
  };
}
