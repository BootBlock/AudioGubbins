/**
 * A second-order section designed against the magnitude of its analogue
 * prototype, for a section the cookbook cannot place: one whose frequency is
 * above `HIGHEST_DESIGN_FRACTION` of the rate, where the cookbook's bilinear
 * design runs out of spectrum (a frequency a person set above half a low rate,
 * 20 kHz at 32 kHz, has no place in its band).
 *
 * The squared magnitude of a biquad is a ratio of two quadratics in x, the
 * cosine of the angle of a frequency. Each is fitted over a grid of the band
 * from DC to half the rate to the asked-for analogue magnitude there, the
 * prototype's own of the shape, at the true frequency rather than a warped one:
 * first the analogue numerator and denominator apart by least squares, then the
 * ratio by Levenberg-Marquardt, the residual at each point `s − 1/s` with `s`
 * the root of the fitted over the asked-for squared magnitude, which is the
 * error in nepers near a fit and grows without bound as either quadratic nears
 * zero, so no fit cancels a pole against a zero. Each quadratic is held
 * positive over the whole band, and is then factored into a stable,
 * minimum-phase section: its zeros inside or on the unit circle, its poles
 * strictly inside. A zero the prototype holds at DC, as a high-pass and a
 * band-pass do, is kept there exactly, and a notch inside the band is fitted
 * with its zero on the circle at its frequency and without, the closer taken.
 * An all-pass takes the poles of the low-pass fitted to its frequency and Q,
 * with its magnitude exactly one.
 *
 * Every digital section's magnitude is flat at half the rate, where the
 * analogue response still slopes, so the fit is closest well below half the
 * rate and least close at it, most so for a narrow resonance just above it.
 *
 * What is asked for is `analogue-prototype.ts`'s, the solves are
 * `damped-solve.ts`'s and the factoring is `quadratic-factors.ts`'s. Only
 * arithmetic, the square root and the canonical cosine and decibel
 * conversion: a design is the same bits on every machine (ADR-0032). It runs
 * whenever a section's parameters move, as a cookbook design does, never per
 * sample, and allocates nothing: it works in arrays made once, and every
 * double crosses a call through one of them.
 */

import {
  ASKED,
  DENOMINATOR,
  GRID,
  GRID_X,
  NUMERATOR,
  NUMERATOR_FLOOR,
  PROTOTYPE,
  USED,
  ZERO_TERMS,
  type Zero,
  askFor,
  numeratorTerms,
  sampleGrid,
  zeroTerms,
} from './analogue-prototype.js';
import { BiquadShape } from './biquad-shape.js';
import { MOST_UNKNOWNS, solveDamped } from './damped-solve.js';
import { factorQuadratic, liftQuadratic } from './quadratic-factors.js';

/**
 * The most Levenberg-Marquardt steps a fit takes, and tries at one step: a
 * fit cut short leaves the design where it stopped, which moved by decibels
 * between frequencies a hair apart; a fit that runs to its end, as nearly
 * every one does well within these, is continuous in its frequency.
 */
const MOST_STEPS = 400;
const MOST_TRIES = 30;

/** The normal equations, by rows of {@link MOST_UNKNOWNS}, their right side, and their solution. */
const NORMAL = new Float64Array(MOST_UNKNOWNS * MOST_UNKNOWNS);
const RIGHT = new Float64Array(MOST_UNKNOWNS);
const SOLUTION = new Float64Array(MOST_UNKNOWNS);

/**
 * The fit's parameters: the numerator's coefficients in `x` after its kept
 * zeros (one to three), then the denominator's of `x` and `x²`; and the step
 * tried. The denominator's constant term is held at {@link SCALARS} `[D0]`.
 */
const PARAMETERS = new Float64Array(MOST_UNKNOWNS);
const TRIAL = new Float64Array(MOST_UNKNOWNS);

/** Polynomials in `x`, three coefficients each: a numerator and a denominator. */
const POLYNOMIALS = new Float64Array(6);
const NUMERATOR_AT = 0;
const DENOMINATOR_AT = 3;

/** The factors `g`, `s` and `t` of `g(1 − s·z⁻¹ + t·z⁻²)`: the numerator's, then the denominator's. */
const FACTORS = new Float64Array(6);

/** Scalars handed between the steps. */
const SCALARS = new Float64Array(4);
const D0 = 0;
const COST = 1;
const DAMPING = 2;
const FLOOR = 3;

/**
 * Fits a polynomial in `x` of `size` coefficients to `values` over the used
 * points by least squares, each point's error relative to `scale`, into
 * {@link POLYNOMIALS} from `at` (the rest zero).
 */
function fitPolynomial(values: Float64Array, scale: Float64Array, size: number, at: number): void {
  NORMAL.fill(0);
  RIGHT.fill(0);
  for (let k = 0; k < GRID; k += 1) {
    if (USED[k] !== 1) continue;
    const weight = 1 / Math.max(scale[k] ?? 0, PROTOTYPE[NUMERATOR_FLOOR] ?? 0);
    const x = GRID_X[k] ?? 0;
    let row = weight;
    for (let i = 0; i < size; i += 1) {
      let column = weight;
      for (let j = 0; j < size; j += 1) {
        NORMAL[i * 5 + j] = (NORMAL[i * 5 + j] ?? 0) + row * column;
        column *= x;
      }
      RIGHT[i] = (RIGHT[i] ?? 0) + row * weight * (values[k] ?? 0);
      row *= x;
    }
  }
  SCALARS[DAMPING] = 0;
  const solved = solveDamped(NORMAL, RIGHT, size, SCALARS, DAMPING, SOLUTION);
  for (let i = 0; i < 3; i += 1) POLYNOMIALS[at + i] = solved && i < size ? (SOLUTION[i] ?? 0) : 0;
  // A singular fit (it is not, over this grid) starts from a constant.
  if (!solved) POLYNOMIALS[at] = 1;
}

/**
 * The fit's cost for `parameters`, the sum of the residuals' squares, into
 * {@link SCALARS} `[COST]`: infinite where either quadratic is not positive
 * at a used point.
 */
function costOf(parameters: Float64Array, terms: number): void {
  const d0 = SCALARS[D0] ?? 1;
  let sum = 0;
  for (let k = 0; k < GRID; k += 1) {
    if (USED[k] !== 1) continue;
    const x = GRID_X[k] ?? 0;
    let numerator = 0;
    for (let i = terms - 1; i >= 0; i -= 1) numerator = numerator * x + (parameters[i] ?? 0);
    const denominator = d0 + x * ((parameters[terms] ?? 0) + x * (parameters[terms + 1] ?? 0));
    if (!(numerator > 0 && denominator > 0)) {
      SCALARS[COST] = Number.POSITIVE_INFINITY;
      return;
    }
    const root = Math.sqrt(numerator / (denominator * (ASKED[k] ?? 1)));
    const residual = root - 1 / root;
    sum += residual * residual;
  }
  SCALARS[COST] = sum;
}

/**
 * The normal equations of a Gauss-Newton step from {@link PARAMETERS}, `terms`
 * of them the numerator's, into {@link NORMAL} and {@link RIGHT}.
 */
function stepEquations(terms: number): void {
  const size = terms + 2;
  const d0 = SCALARS[D0] ?? 1;
  NORMAL.fill(0);
  RIGHT.fill(0);
  for (let k = 0; k < GRID; k += 1) {
    if (USED[k] !== 1) continue;
    const x = GRID_X[k] ?? 0;
    let numerator = 0;
    for (let i = terms - 1; i >= 0; i -= 1) numerator = numerator * x + (PARAMETERS[i] ?? 0);
    const denominator = d0 + x * ((PARAMETERS[terms] ?? 0) + x * (PARAMETERS[terms + 1] ?? 0));
    const root = Math.sqrt(numerator / (denominator * (ASKED[k] ?? 1)));
    const residual = root - 1 / root;
    const slope = (root + 1 / root) / 2;
    // The Jacobian's row, kept in SOLUTION while it is summed.
    let power = slope / numerator;
    for (let i = 0; i < terms; i += 1) {
      SOLUTION[i] = power;
      power *= x;
    }
    SOLUTION[terms] = (-slope * x) / denominator;
    SOLUTION[terms + 1] = (-slope * x * x) / denominator;
    for (let i = 0; i < size; i += 1) {
      const value = SOLUTION[i] ?? 0;
      RIGHT[i] = (RIGHT[i] ?? 0) - value * residual;
      for (let j = 0; j < size; j += 1) {
        NORMAL[i * 5 + j] = (NORMAL[i * 5 + j] ?? 0) + value * (SOLUTION[j] ?? 0);
      }
    }
  }
}

/**
 * Levenberg-Marquardt over {@link PARAMETERS}, `terms` of them the
 * numerator's, leaving the cost of the fit it ends at in {@link SCALARS}
 * `[COST]`. Each step is taken only where it lowers the cost, so every step
 * keeps both quadratics positive at every used point.
 */
function refine(terms: number): void {
  const size = terms + 2;
  costOf(PARAMETERS, terms);
  let cost = SCALARS[COST] ?? 0;
  let damping = 1e-3;
  for (let step = 0; step < MOST_STEPS; step += 1) {
    stepEquations(terms);
    let lowered = false;
    for (let attempt = 0; attempt < MOST_TRIES; attempt += 1) {
      SCALARS[DAMPING] = damping;
      if (solveDamped(NORMAL, RIGHT, size, SCALARS, DAMPING, SOLUTION)) {
        for (let i = 0; i < size; i += 1) TRIAL[i] = (PARAMETERS[i] ?? 0) + (SOLUTION[i] ?? 0);
        costOf(TRIAL, terms);
        const tried = SCALARS[COST] ?? 0;
        if (tried < cost) {
          const gain = cost - tried;
          for (let i = 0; i < size; i += 1) PARAMETERS[i] = TRIAL[i] ?? 0;
          cost = tried;
          damping = Math.max(damping / 10, 1e-15);
          lowered = gain > 1e-14 * (1 + cost);
          break;
        }
      }
      damping *= 10;
    }
    if (!lowered) break;
  }
  SCALARS[COST] = cost;
}

/**
 * One fit with `kind`'s zeros kept: the numerator after them in
 * {@link POLYNOMIALS} at {@link NUMERATOR_AT}, the denominator at
 * {@link DENOMINATOR_AT}, both positive over the band, and its cost in
 * {@link SCALARS} `[COST]`.
 */
function fitWith(kind: Zero): void {
  sampleGrid(kind);
  const terms = numeratorTerms(kind);
  fitPolynomial(NUMERATOR, NUMERATOR, terms, NUMERATOR_AT);
  fitPolynomial(DENOMINATOR, DENOMINATOR, 3, DENOMINATOR_AT);
  SCALARS[FLOOR] = PROTOTYPE[NUMERATOR_FLOOR] ?? 0;
  liftQuadratic(POLYNOMIALS, NUMERATOR_AT, SCALARS, FLOOR);
  SCALARS[FLOOR] = (POLYNOMIALS[DENOMINATOR_AT] ?? 1) * 1e-9;
  liftQuadratic(POLYNOMIALS, DENOMINATOR_AT, SCALARS, FLOOR);
  SCALARS[D0] = POLYNOMIALS[DENOMINATOR_AT] ?? 1;
  for (let i = 0; i < terms; i += 1) PARAMETERS[i] = POLYNOMIALS[NUMERATOR_AT + i] ?? 0;
  PARAMETERS[terms] = POLYNOMIALS[DENOMINATOR_AT + 1] ?? 0;
  PARAMETERS[terms + 1] = POLYNOMIALS[DENOMINATOR_AT + 2] ?? 0;
  refine(terms);
  const cost = SCALARS[COST] ?? 0;
  for (let i = 0; i < 3; i += 1)
    POLYNOMIALS[NUMERATOR_AT + i] = i < terms ? (PARAMETERS[i] ?? 0) : 0;
  POLYNOMIALS[DENOMINATOR_AT] = SCALARS[D0];
  POLYNOMIALS[DENOMINATOR_AT + 1] = PARAMETERS[terms] ?? 0;
  POLYNOMIALS[DENOMINATOR_AT + 2] = PARAMETERS[terms + 1] ?? 0;
  // Positive over the whole band, not only at the grid's points: a zero may
  // touch the circle, a pole never.
  SCALARS[FLOOR] = 0;
  liftQuadratic(POLYNOMIALS, NUMERATOR_AT, SCALARS, FLOOR);
  SCALARS[FLOOR] = POLYNOMIALS[DENOMINATOR_AT] * 1e-12;
  liftQuadratic(POLYNOMIALS, DENOMINATOR_AT, SCALARS, FLOOR);
  SCALARS[COST] = cost;
}

/**
 * Writes the coefficients of `shape` at `rate`, from the frequency, gain and Q
 * in `settings`, its frequency above `HIGHEST_DESIGN_FRACTION` of the rate,
 * into `into` from `at`: b0, b1, b2, a1 and a2, a0 being 1.
 */
export function designFitted(
  shape: BiquadShape,
  rate: number,
  settings: Float64Array,
  into: Float64Array,
  at: number,
): void {
  const kind = askFor(shape === BiquadShape.AllPass ? BiquadShape.LowPass : shape, rate, settings);
  fitWith(kind);

  factorQuadratic(POLYNOMIALS, DENOMINATOR_AT, FACTORS, 3);
  const scale = FACTORS[3] ?? 1;
  const s = FACTORS[4] ?? 0;
  const t = FACTORS[5] ?? 0;
  if (shape === BiquadShape.AllPass) {
    into[at] = t;
    into[at + 1] = -s;
    into[at + 2] = 1;
    into[at + 3] = -s;
    into[at + 4] = t;
    return;
  }
  factorQuadratic(POLYNOMIALS, NUMERATOR_AT, FACTORS, 0);
  zeroTerms(kind);
  const g = (FACTORS[0] ?? 0) / scale;
  const m1 = -g * (FACTORS[1] ?? 0);
  const m2 = g * (FACTORS[2] ?? 0);
  // The kept zeros times the fitted rest, of degree two together.
  const z0 = ZERO_TERMS[0] ?? 0;
  const z1 = ZERO_TERMS[1] ?? 0;
  const z2 = ZERO_TERMS[2] ?? 0;
  into[at] = z0 * g;
  into[at + 1] = z0 * m1 + z1 * g;
  into[at + 2] = z0 * m2 + z1 * m1 + z2 * g;
  into[at + 3] = -s;
  into[at + 4] = t;
}
