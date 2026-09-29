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

/** `2³²`: one carry from the low half of the phase into the high. */
const TWO_32 = 4_294_967_296;

/** `2⁻³²` and `2⁻⁶⁴`: a unit of the high and of the low half of the phase, in turns. */
const HIGH_TURNS = 1 / TWO_32;
const LOW_TURNS = 1 / 18_446_744_073_709_551_616;

/** `2⁶⁴`, to scale a fraction of a turn to units. */
const UNITS_PER_TURN = 18_446_744_073_709_551_616;

const LOW_MASK = 0xffff_ffffn;
const WORD_MASK = 0xffff_ffff_ffff_ffffn;

/**
 * `frequency / rate` in units of 2⁻⁶⁴ turn, rounded to the nearest, a half
 * up, from the frequency's significand and exponent: `increment_of` in
 * `oscillator.rs`, in `bigint`s.
 */
function incrementOf(frequency: number, rate: number): bigint {
  const bits = new BigUint64Array(Float64Array.of(frequency).buffer)[0] ?? 0n;
  const biased = (bits >> 52n) & 0x7ffn;
  const fraction = bits & ((1n << 52n) - 1n);
  const significand = biased === 0n ? fraction : fraction | (1n << 52n);
  const shift = (biased === 0n ? -1074n : biased - 1075n) + 64n;
  let numerator: bigint;
  let denominator: bigint;
  if (shift >= 0n) {
    numerator = significand << shift;
    denominator = BigInt(rate);
  } else if (shift >= -96n) {
    numerator = significand;
    denominator = BigInt(rate) << -shift;
  } else {
    return 0n;
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder >= denominator - remainder ? quotient + 1n : quotient;
  return rounded > WORD_MASK ? WORD_MASK : rounded;
}

/** Where each value of an oscillator's state sits in its {@link ReferenceOscillator} array. */
const PHASE_HIGH = 0;
const PHASE_LOW = 1;
const INCREMENT_HIGH = 2;
const INCREMENT_LOW = 3;
const AMPLITUDE = 4;

/**
 * A sine oscillator whose phase is a 64-bit fixed-point count of turns, as
 * `oscillator.rs`: frame `n`'s phase is `(start + n · increment) mod 2⁶⁴`.
 *
 * The phase is held as two 32-bit halves in doubles, each exact, added with
 * a carry. The turns a sample is the sine of are `hi · 2⁻³² + lo · 2⁻⁶⁴`: two
 * exact products and one correctly rounded sum, which is the phase rounded to
 * the nearest double, the number the crate's `phase as f64 · 2⁻⁶⁴` gives.
 */
export class ReferenceOscillator {
  /**
   * The phase and increment halves and the amplitude, in one f64 array
   * rather than fields: V8 boxes a double it writes to an object field, which
   * on the fallback path of the audio thread was a heap number every sample.
   */
  readonly #state = new Float64Array(5);
  readonly #start: bigint;
  readonly #increment: bigint;

  /** Settings already checked by `checkOscillator`. */
  constructor(frequency: number, sampleRate: number, startPhase: number, amplitude: number) {
    const fraction = startPhase - Math.floor(startPhase);
    this.#start = BigInt(Math.floor(fraction * UNITS_PER_TURN));
    this.#increment = incrementOf(frequency, sampleRate);
    this.#state[INCREMENT_HIGH] = Number(this.#increment >> 32n);
    this.#state[INCREMENT_LOW] = Number(this.#increment & LOW_MASK);
    this.#state[AMPLITUDE] = amplitude;
    this.seek(0);
  }

  /** Moves to frame `frame` of the run, a whole number `assertSeekFrame` has checked. */
  seek(frame: number): void {
    const phase = (this.#start + BigInt(frame) * this.#increment) & WORD_MASK;
    this.#state[PHASE_HIGH] = Number(phase >> 32n);
    this.#state[PHASE_LOW] = Number(phase & LOW_MASK);
  }

  /** Writes the next samples; storing into the array rounds each once to f32. */
  render(into: Float32Array): void {
    const state = this.#state;
    const incrementHigh = state[INCREMENT_HIGH] ?? 0;
    const incrementLow = state[INCREMENT_LOW] ?? 0;
    const amplitude = state[AMPLITUDE] ?? 0;
    let high = state[PHASE_HIGH] ?? 0;
    let low = state[PHASE_LOW] ?? 0;
    for (let index = 0; index < into.length; index += 1) {
      into[index] = amplitude * sineOfTurns(high * HIGH_TURNS + low * LOW_TURNS);
      low += incrementLow;
      let carry = 0;
      if (low >= TWO_32) {
        low -= TWO_32;
        carry = 1;
      }
      high += incrementHigh + carry;
      if (high >= TWO_32) high -= TWO_32;
    }
    state[PHASE_HIGH] = high;
    state[PHASE_LOW] = low;
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
