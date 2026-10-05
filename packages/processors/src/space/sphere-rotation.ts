/**
 * The rotation of an ACN, SN3D ambisonic set, for every degree to the third,
 * by the recursion of Ivanic and Ruedenberg.
 *
 * J. Ivanic and K. Ruedenberg, "Rotation Matrices for Real Spherical
 * Harmonics. Direct Determination by Recursion", J. Phys. Chem. 100 (15),
 * 6342–6347 (1996), with the corrections of J. Phys. Chem. A 102 (45), 9099
 * (1998). The matrix of degree 1 is the Cartesian rotation read in the
 * order of its harmonics, y, z, x for m = −1, 0, 1; the matrix of each
 * degree `l` above is made from it and the matrix of degree `l − 1` by the
 * paper's `u·U + v·V + w·W` (its table 2, corrected). A rotation mixes the
 * harmonics of one degree only, and SN3D differs from the orthonormal
 * weights the recursion is written for by one factor per degree, so the
 * matrices are SN3D's as they stand.
 *
 * The turn is the Cartesian `R = Rz(yaw) · Ry(−pitch) · Rx(roll)`, each a
 * right-handed turn about its axis: a source is turned first by the roll
 * about the front axis (a positive roll lifts the left), then by the pitch
 * about the left axis (a positive pitch lifts the front), then by the yaw
 * about the vertical axis (a positive yaw turns the front to the left), so
 * a source at a direction `d` is heard at `R · d`.
 *
 * Every entry is basic arithmetic over the cosines and sines of the angles
 * from the canonical trigonometry (ADR-0032); the recursion's coefficients,
 * square roots of ratios of whole numbers, are worked out once when a
 * rotation is made, so a new design costs no square root.
 */

import { cosineOfTurns, sineOfTurns } from '@audiogubbins/audio-engine';

/** Where degree `l`'s matrix starts among them all: the sum of `(2k + 1)²` below it. */
const OFFSETS: readonly number[] = [0, 1, 10, 35, 84];

const ROOT_2 = Math.SQRT2;

/**
 * Where entry `(m, n)` of degree `l`'s matrix is, each of `m` and `n` from
 * `−l` to `l`. The helpers below return whole numbers and write their real
 * results into arrays: a double returned from a call the optimiser does not
 * inline is a heap number, and these run while the audio plays.
 */
function place(degree: number, m: number, n: number): number {
  return (OFFSETS[degree] ?? 0) + (m + degree) * (2 * degree + 1) + n + degree;
}

/** The axis, x 0, y 1, z 2, that the harmonic of degree 1 and index `m` follows. */
const AXIS_OF_INDEX: readonly number[] = [1, 2, 0];

/**
 * Writes the paper's `P(i, l, a, b)`, degree 1's row `i` against degree
 * `l − 1`'s row `a`, into `terms[slot]`.
 */
function p(
  matrices: Float64Array,
  terms: Float64Array,
  slot: number,
  i: number,
  l: number,
  a: number,
  b: number,
): void {
  const previous = l - 1;
  const plus = matrices[place(1, i, 1)] ?? 0;
  const minus = matrices[place(1, i, -1)] ?? 0;
  const high = matrices[place(previous, a, previous)] ?? 0;
  const low = matrices[place(previous, a, -previous)] ?? 0;
  if (b === l) terms[slot] = plus * high - minus * low;
  else if (b === -l) terms[slot] = plus * low + minus * high;
  else terms[slot] = (matrices[place(1, i, 0)] ?? 0) * (matrices[place(previous, a, b)] ?? 0);
}

/** Writes the paper's `V(l, m, n)` into `terms[2]`, by way of `terms[0]` and `terms[1]`. */
function vTerm(matrices: Float64Array, terms: Float64Array, l: number, m: number, n: number): void {
  if (m === 0) {
    p(matrices, terms, 0, 1, l, 1, n);
    p(matrices, terms, 1, -1, l, -1, n);
    terms[2] = (terms[0] ?? 0) + (terms[1] ?? 0);
  } else if (m > 0) {
    p(matrices, terms, 0, 1, l, m - 1, n);
    p(matrices, terms, 1, -1, l, -m + 1, n);
    // `P₀·√(1 + δ) − P₁·(1 − δ)`, with δ one only where m is 1.
    terms[2] = m === 1 ? (terms[0] ?? 0) * ROOT_2 : (terms[0] ?? 0) - (terms[1] ?? 0);
  } else {
    p(matrices, terms, 0, 1, l, m + 1, n);
    p(matrices, terms, 1, -1, l, -m - 1, n);
    // `P₀·(1 − δ) + P₁·√(1 + δ)`, with δ one only where m is −1.
    terms[2] = m === -1 ? (terms[1] ?? 0) * ROOT_2 : (terms[0] ?? 0) + (terms[1] ?? 0);
  }
}

/**
 * Writes the paper's `W(l, m, n)`, for `m ≠ 0` where its coefficient is not
 * zero, into `terms[3]`, by way of `terms[0]` and `terms[1]`.
 */
function wTerm(matrices: Float64Array, terms: Float64Array, l: number, m: number, n: number): void {
  if (m > 0) {
    p(matrices, terms, 0, 1, l, m + 1, n);
    p(matrices, terms, 1, -1, l, -m - 1, n);
    terms[3] = (terms[0] ?? 0) + (terms[1] ?? 0);
  } else {
    p(matrices, terms, 0, 1, l, m - 1, n);
    p(matrices, terms, 1, -1, l, -m + 1, n);
    terms[3] = (terms[0] ?? 0) - (terms[1] ?? 0);
  }
}

/** The recursion's coefficients `u`, `v` and `w` for `(l, m, n)`, into `into` at `place`. */
function coefficients(l: number, m: number, n: number, into: Float64Array, place: number): void {
  const zero = m === 0 ? 1 : 0;
  const size = Math.abs(m);
  const denominator = Math.abs(n) === l ? 2 * l * (2 * l - 1) : (l + n) * (l - n);
  into[place] = Math.sqrt(((l + m) * (l - m)) / denominator);
  into[place + 1] =
    0.5 * Math.sqrt(((1 + zero) * (l + size - 1) * (l + size)) / denominator) * (1 - 2 * zero);
  into[place + 2] = -0.5 * Math.sqrt(((l - size - 1) * (l - size)) / denominator) * (1 - zero);
}

/** The rotation matrices of every degree of a set, designed again as its angles move. */
export class SphereRotation {
  readonly #order: number;
  /** Each degree's matrix in turn, row-major, `(2l + 1)²` entries for degree `l`. */
  readonly #matrices: Float64Array;
  /** `u`, `v` and `w` for each entry of each degree from 2, where its matrix is. */
  readonly #coefficients: Float64Array;
  /** One frame of the set as it is turned, before it is stored. */
  readonly #turned: Float64Array;
  /** The Cartesian turn, row-major by x, y, z. */
  readonly #cartesian = new Float64Array(9);
  /** The recursion's `P`, `V` and `W` as each entry is worked out. */
  readonly #terms = new Float64Array(4);
  /**
   * The yaw, pitch and roll in degrees that {@link redesign} designs the
   * matrices of. A rotation on the audio thread writes them here rather than
   * handing them to a call, which would box each one wherever the call was
   * not inlined.
   */
  readonly angles = new Float64Array(3);

  /** A rotation of a set of `order`, at first no turn at all. */
  constructor(order: number) {
    this.#order = order;
    const entries = OFFSETS[order + 1] ?? 0;
    this.#matrices = new Float64Array(entries);
    this.#coefficients = new Float64Array(3 * entries);
    this.#turned = new Float64Array((order + 1) * (order + 1));
    for (let l = 2; l <= order; l += 1) {
      for (let m = -l; m <= l; m += 1) {
        for (let n = -l; n <= l; n += 1) {
          coefficients(l, m, n, this.#coefficients, 3 * place(l, m, n));
        }
      }
    }
    this.redesign();
  }

  /** Entry `(m, n)` of the matrix of `degree`. */
  entry(degree: number, m: number, n: number): number {
    return this.#matrices[place(degree, m, n)] ?? 0;
  }

  /** Designs the matrices of the turn of `yaw`, `pitch` and `roll`, in degrees. */
  design(yaw: number, pitch: number, roll: number): void {
    const angles = this.angles;
    angles[0] = yaw;
    angles[1] = pitch;
    angles[2] = roll;
    this.redesign();
  }

  /** Designs the matrices of the turn in {@link angles}. */
  redesign(): void {
    this.#designFirst();
    for (let l = 2; l <= this.#order; l += 1) this.#designDegree(l);
  }

  /**
   * Turns frame `frame` of `channels`, an ACN set of the rotation's order,
   * and writes it into frame `frame` of `into`, which may be `channels`.
   */
  apply(channels: readonly Float32Array[], into: readonly Float32Array[], frame: number): void {
    const turned = this.#turned;
    const matrices = this.#matrices;
    for (let l = 0; l <= this.#order; l += 1) {
      const centre = l * l + l;
      let row = OFFSETS[l] ?? 0;
      for (let m = -l; m <= l; m += 1) {
        let sum = 0;
        for (let n = -l; n <= l; n += 1) {
          // An explicit test, not `?.[frame]`: the optional read allocates
          // in the optimised code.
          const channel = channels[centre + n];
          if (channel !== undefined) sum += (matrices[row] ?? 0) * (channel[frame] ?? 0);
          row += 1;
        }
        turned[centre + m] = sum;
      }
    }
    for (let acn = 0; acn < turned.length; acn += 1) {
      const to = into[acn];
      if (to !== undefined) to[frame] = turned[acn] ?? 0;
    }
  }

  /** Degree 0's matrix, the one, and degree 1's, the Cartesian turn in harmonic order. */
  #designFirst(): void {
    const yaw = this.angles[0] ?? 0;
    const pitch = this.angles[1] ?? 0;
    const roll = this.angles[2] ?? 0;
    const cy = cosineOfTurns(yaw / 360);
    const sy = sineOfTurns(yaw / 360);
    const cp = cosineOfTurns(pitch / 360);
    const sp = sineOfTurns(pitch / 360);
    const cr = cosineOfTurns(roll / 360);
    const sr = sineOfTurns(roll / 360);
    // Rz(yaw) · Ry(−pitch) · Rx(roll), row by row, x y z.
    const cartesian = this.#cartesian;
    cartesian[0] = cy * cp;
    cartesian[1] = -cy * sp * sr - sy * cr;
    cartesian[2] = -cy * sp * cr + sy * sr;
    cartesian[3] = sy * cp;
    cartesian[4] = -sy * sp * sr + cy * cr;
    cartesian[5] = -sy * sp * cr - cy * sr;
    cartesian[6] = sp;
    cartesian[7] = cp * sr;
    cartesian[8] = cp * cr;
    const matrices = this.#matrices;
    matrices[0] = 1;
    for (let m = -1; m <= 1; m += 1) {
      for (let n = -1; n <= 1; n += 1) {
        const row = AXIS_OF_INDEX[m + 1] ?? 0;
        const column = AXIS_OF_INDEX[n + 1] ?? 0;
        matrices[place(1, m, n)] = cartesian[row * 3 + column] ?? 0;
      }
    }
  }

  /** Degree `l`'s matrix from degree 1's and degree `l − 1`'s. */
  #designDegree(l: number): void {
    const matrices = this.#matrices;
    const recursion = this.#coefficients;
    const terms = this.#terms;
    for (let m = -l; m <= l; m += 1) {
      for (let n = -l; n <= l; n += 1) {
        const at = place(l, m, n);
        const u = recursion[3 * at] ?? 0;
        const v = recursion[3 * at + 1] ?? 0;
        const w = recursion[3 * at + 2] ?? 0;
        // A term whose coefficient is zero is left out: its `P` would read
        // past the matrix of the degree below.
        let entry = 0;
        if (u !== 0) {
          p(matrices, terms, 0, 0, l, m, n);
          entry += u * (terms[0] ?? 0);
        }
        if (v !== 0) {
          vTerm(matrices, terms, l, m, n);
          entry += v * (terms[2] ?? 0);
        }
        if (w !== 0) {
          wTerm(matrices, terms, l, m, n);
          entry += w * (terms[3] ?? 0);
        }
        matrices[at] = entry;
      }
    }
  }
}
