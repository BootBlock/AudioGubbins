/**
 * The canonical primitives in TypeScript: the sine of turns, the oscillator,
 * and the Kaiser window with its Bessel series.
 *
 * Each function repeats `crates/dsp-core` operation for operation, in the same
 * order, with the same constants written as the same text, so both give the
 * same bits (ADR-0032). JavaScript never fuses a multiply into an add, and
 * every operation here is one IEEE-754 requires to be correctly rounded, so
 * nothing about the engine running it can change an answer. A change here
 * without the same change in Rust fails the golden tests of both.
 */

/**
 * The coefficients of `sin(2πt)`, lowest power first; see `turns.rs`.
 *
 * The first is `2π`, which doubling `Math.PI` gives exactly, as Rust's `TAU`.
 */
const SINE_COEFFICIENTS: readonly number[] = [
  2 * Math.PI,
  -41.34170224039976,
  81.60524927607506,
  -76.70585975306139,
  42.058693944897655,
  -15.09464257682299,
  3.819952584848282,
  -0.7181223017785006,
  0.10422916220813984,
  -0.012031585942120627,
  0.0011309237482517963,
  -8.823533599243006e-5,
];

/** `sin(2π · turns)`, identical to `sine_of_turns` in `turns.rs`. */
export function sineOfTurns(turns: number): number {
  const r = turns - Math.floor(turns);
  const t = r < 0.25 ? r : r < 0.75 ? 0.5 - r : r - 1;
  const square = t * t;
  let sum = SINE_COEFFICIENTS[11] ?? 0;
  for (let index = 10; index >= 0; index -= 1) {
    sum = sum * square + (SINE_COEFFICIENTS[index] ?? 0);
  }
  return sum * t;
}

/** Where each value of an oscillator's state sits in its {@link ReferenceOscillator} array. */
const PHASE = 0;
const INCREMENT = 1;
const AMPLITUDE = 2;

/** A sine oscillator whose phase is held in turns, as `oscillator.rs`. */
export class ReferenceOscillator {
  /**
   * The phase, the increment and the amplitude, in one f64 array rather than
   * three fields: V8 boxes a double it writes to an object field, which on
   * the fallback path of the audio thread was a heap number every sample.
   */
  readonly #state = new Float64Array(3);

  /** Settings already checked by `checkOscillator`. */
  constructor(frequency: number, sampleRate: number, startPhase: number, amplitude: number) {
    this.#state[PHASE] = startPhase - Math.floor(startPhase);
    this.#state[INCREMENT] = frequency / sampleRate;
    this.#state[AMPLITUDE] = amplitude;
  }

  /** Writes the next samples; storing into the array rounds each once to f32. */
  render(into: Float32Array): void {
    const state = this.#state;
    const increment = state[INCREMENT] ?? 0;
    const amplitude = state[AMPLITUDE] ?? 0;
    let phase = state[PHASE] ?? 0;
    for (let index = 0; index < into.length; index += 1) {
      into[index] = amplitude * sineOfTurns(phase);
      phase += increment;
      if (phase >= 1) phase -= 1;
    }
    state[PHASE] = phase;
  }
}

/** `2⁻⁶⁰`, past which a term cannot change the Bessel sum; see `window.rs`. */
const SERIES_TOLERANCE = 1 / 1_152_921_504_606_846_976;

/** The most terms the series is summed to. */
const MOST_TERMS = 500;

/** `I₀(x)`, summed from its power series as `bessel_i0` in `window.rs`. */
export function besselI0(x: number): number {
  const quarterSquare = (x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= MOST_TERMS; k += 1) {
    term = (term * quarterSquare) / (k * k);
    sum += term;
    if (term <= sum * SERIES_TOLERANCE) break;
  }
  return sum;
}

/** The Kaiser window at `position` in `[-1, 1]`, as `kaiser` in `window.rs`. */
export function kaiser(position: number, beta: number, besselOfBeta: number): number {
  const inside = 1 - position * position;
  if (inside < 0) return 0;
  return besselI0(beta * Math.sqrt(inside)) / besselOfBeta;
}
