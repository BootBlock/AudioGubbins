/**
 * The solution of `(A + δI) g = b` for a Hermitian positive semi-definite `A`
 * and a loading `δ` above zero, by the Cholesky factor `A + δI = L Lᴴ`, `L`
 * lower triangular with a real, positive diagonal, in f64: the solve of the
 * dereverberation's prediction filter at each bin of each frame.
 *
 * `A` is given as its upper triangle packed by rows, `A_ij` for `i ≤ j` at
 * `rowStart[i] + j − i` from a base, and `A_ij` below it is `conj(A_ji)`.
 *
 * - Column `j` of `L`, in turn from the first:
 *   `d = A_jj + δ − Σ_(p<j) |L_jp|²` and `L_jj = √d`, then for each `i > j`,
 *   `L_ij = (A_ij − Σ_(p<j) L_ip · conj(L_jp)) / L_jj`, each sum from `p = 0`
 *   up.
 * - Then `L y = b` forward, `y_i = (b_i − Σ_(p<i) L_ip · y_p) / L_ii`, the sum
 *   from `p = 0` up, and `Lᴴ g = y` back,
 *   `g_i = (y_i − Σ_(p>i) conj(L_pi) · g_p) / L_ii`, the sum from
 *   `p = size − 1` down.
 *
 * The loading keeps every pivot above zero in exact arithmetic; a pivot that
 * rounding leaves at zero or below, or that is not a number, is reported, and
 * the caller solves nothing with that factor. Every double comes and goes
 * through an array, since V8 boxes one passed to or returned from a call it
 * does not inline, an allocation on the audio thread.
 */

/** A solver of systems of one size, its factor and scratch made once. */
export class HermitianSolver {
  readonly size: number;
  /** Where row `i` of a packed upper triangle starts. */
  readonly rowStart: Int32Array;
  /** The values a packed upper triangle of this size holds. */
  readonly packed: number;
  /** `δ`, written by the caller before {@link factorise}. */
  readonly loading = new Float64Array(1);
  /** `L`, row-major, its upper part unused. */
  readonly #factorRe: Float64Array;
  readonly #factorIm: Float64Array;
  readonly #forwardRe: Float64Array;
  readonly #forwardIm: Float64Array;

  constructor(size: number) {
    this.size = size;
    this.rowStart = new Int32Array(size);
    for (let row = 1; row < size; row += 1) {
      this.rowStart[row] = (this.rowStart[row - 1] ?? 0) + size - (row - 1);
    }
    this.packed = (size * (size + 1)) / 2;
    this.#factorRe = new Float64Array(size * size);
    this.#factorIm = new Float64Array(size * size);
    this.#forwardRe = new Float64Array(size);
    this.#forwardIm = new Float64Array(size);
  }

  /**
   * Factorises `A + δI`, `A` packed from `base` of `re` and `im`, and answers
   * whether every pivot was above zero.
   */
  factorise(re: Float64Array, im: Float64Array, base: number): boolean {
    const size = this.size;
    const lRe = this.#factorRe;
    const lIm = this.#factorIm;
    const loading = this.loading[0] ?? 0;
    for (let j = 0; j < size; j += 1) {
      const rowJ = j * size;
      const diagonal = base + (this.rowStart[j] ?? 0);
      let pivot = (re[diagonal] ?? 0) + loading;
      for (let p = 0; p < j; p += 1) {
        const a = lRe[rowJ + p] ?? 0;
        const b = lIm[rowJ + p] ?? 0;
        pivot -= a * a + b * b;
      }
      if (!(pivot > 0)) return false;
      const root = Math.sqrt(pivot);
      lRe[rowJ + j] = root;
      lIm[rowJ + j] = 0;
      for (let i = j + 1; i < size; i += 1) {
        const rowI = i * size;
        // `A_ij` below the diagonal is the conjugate of `A_ji`, which is packed.
        let sumRe = re[diagonal + i - j] ?? 0;
        let sumIm = -(im[diagonal + i - j] ?? 0);
        for (let p = 0; p < j; p += 1) {
          const a = lRe[rowI + p] ?? 0;
          const b = lIm[rowI + p] ?? 0;
          const c = lRe[rowJ + p] ?? 0;
          const d = lIm[rowJ + p] ?? 0;
          sumRe -= a * c + b * d;
          sumIm -= b * c - a * d;
        }
        lRe[rowI + j] = sumRe / root;
        lIm[rowI + j] = sumIm / root;
      }
    }
    return true;
  }

  /**
   * Writes `g`, `size` long, solving the system last factorised for `b`. The
   * back substitution runs by rows of `L`, the last first: `g_p = y_p / L_pp`,
   * then `y_i −= conj(L_pi) · g_p` for every `i < p`, reading `L` along its
   * rows as it is stored.
   */
  solve(bRe: Float64Array, bIm: Float64Array, gRe: Float64Array, gIm: Float64Array): void {
    this.#forward(bRe, bIm);
    const size = this.size;
    const lRe = this.#factorRe;
    const lIm = this.#factorIm;
    const yRe = this.#forwardRe;
    const yIm = this.#forwardIm;
    for (let p = size - 1; p >= 0; p -= 1) {
      const row = p * size;
      const root = lRe[row + p] ?? 1;
      const c = (yRe[p] ?? 0) / root;
      const d = (yIm[p] ?? 0) / root;
      gRe[p] = c;
      gIm[p] = d;
      for (let i = 0; i < p; i += 1) {
        // conj(L_pi) · g_p
        const a = lRe[row + i] ?? 0;
        const b = lIm[row + i] ?? 0;
        yRe[i] = (yRe[i] ?? 0) - (a * c + b * d);
        yIm[i] = (yIm[i] ?? 0) - (a * d - b * c);
      }
    }
  }

  /** `y` of `L y = b` into the forward scratch. */
  #forward(bRe: Float64Array, bIm: Float64Array): void {
    const size = this.size;
    const lRe = this.#factorRe;
    const lIm = this.#factorIm;
    const yRe = this.#forwardRe;
    const yIm = this.#forwardIm;
    for (let i = 0; i < size; i += 1) {
      const row = i * size;
      let sumRe = bRe[i] ?? 0;
      let sumIm = bIm[i] ?? 0;
      for (let p = 0; p < i; p += 1) {
        // L_ip · y_p
        const a = lRe[row + p] ?? 0;
        const b = lIm[row + p] ?? 0;
        const c = yRe[p] ?? 0;
        const d = yIm[p] ?? 0;
        sumRe -= a * c - b * d;
        sumIm -= a * d + b * c;
      }
      const root = lRe[row + i] ?? 1;
      yRe[i] = sumRe / root;
      yIm[i] = sumIm / root;
    }
  }
}
