/**
 * The repair of a short gap by least-squares autoregressive interpolation
 * (Janssen, Veldhuis and Vries, 1986; Godsill and Rayner, "Digital Audio
 * Restoration", 1998, chapter 5): an all-pole model fitted to the samples
 * either side of the gap, and the gap's samples that the model predicts
 * best.
 *
 * The model is a prediction-error filter `a`, `a[0] = 1`, of order `P`,
 * fitted by Burg's method to the two context segments, the one before the
 * gap and the one after it, with their sums pooled: each reflection
 * coefficient is `−2 · Σ f[i] · b[i − 1] / Σ (f[i]² + b[i − 1]²)` over both
 * segments, or 0 unless that denominator is above zero, each segment's
 * errors running within it alone. So the gap's corrupt samples never enter
 * the fit, and the junction of the two segments is not read as a signal.
 *
 * The gap's `L` samples `u` are those that minimise the sum of the squared
 * errors `e[n] = Σ a[i] · x[n − i]` over the `L + P` frames `n` whose error
 * reads one of them, from the gap's first sample to `P` after its last:
 * `‖A · u + k‖²`, where `A[r][j] = a[r − j]` is the filter's banded
 * convolution matrix and `k` the errors of the known samples alone. A model
 * of steady partials puts its zeros on the unit circle, which leaves `AᵀA`
 * singular to within rounding over a long gap, so the problem is solved as
 * it stands, by Householder reflections that reduce `A` to a triangle of
 * bandwidth `P`, column by column over the `P + 1` rows each reaches, and
 * back substitution: `O(L · P²)`, and as well conditioned as `A` itself.
 * Every sum runs in f64 in index order.
 */

/** The fit and the interpolation of gaps of up to a longest length, with their scratch. */
export class GapInterpolator {
  /** `P`, the model's order. */
  readonly order: number;
  /** Each context segment's length. */
  readonly contextLength: number;
  /**
   * The two context segments the caller fills before {@link fit}: the
   * `contextLength` samples before the gap, then as many after it.
   */
  readonly context: Float64Array;
  /**
   * The samples the caller fills before {@link interpolate}: `P` before the
   * gap, the gap's `L`, whose values are not read, and `P` after it.
   */
  readonly surround: Float64Array;
  /** The gap's samples {@link interpolate} found, the first `L` of them. */
  readonly solution: Float64Array;
  readonly #coefficients: Float64Array;
  readonly #previous: Float64Array;
  readonly #forward: Float64Array;
  readonly #backward: Float64Array;
  /** `−k`, then the reflections applied to it. */
  readonly #right: Float64Array;
  /** `A` and then its triangle, row `r`'s column `c` at `r · (2P + 1) + c − r + P`. */
  readonly #band: Float64Array;
  /** The reflection of the column being reduced, over the rows it reaches. */
  readonly #reflection: Float64Array;

  constructor(order: number, contextLength: number, longest: number) {
    this.order = order;
    this.contextLength = contextLength;
    this.context = new Float64Array(2 * contextLength);
    this.surround = new Float64Array(longest + 2 * order);
    this.solution = new Float64Array(longest);
    this.#coefficients = new Float64Array(order + 1);
    this.#previous = new Float64Array(order + 1);
    this.#forward = new Float64Array(2 * contextLength);
    this.#backward = new Float64Array(2 * contextLength);
    this.#right = new Float64Array(longest + order);
    this.#band = new Float64Array((longest + order) * (2 * order + 1));
    this.#reflection = new Float64Array(order + 1);
  }

  /** Fits the model to {@link context} by Burg's method, the two segments pooled. */
  fit(): void {
    const order = this.order;
    const length = this.contextLength;
    const forward = this.#forward;
    const backward = this.#backward;
    const coefficients = this.#coefficients;
    const previous = this.#previous;
    forward.set(this.context);
    backward.set(this.context);
    coefficients.fill(0);
    coefficients[0] = 1;
    const orders = Math.min(order, length - 1);
    for (let m = 0; m < orders; m += 1) {
      let numerator = 0;
      let denominator = 0;
      for (let start = 0; start <= length; start += length) {
        for (let i = start + m + 1; i < start + length; i += 1) {
          const f = forward[i] ?? 0;
          const b = backward[i - 1] ?? 0;
          numerator += f * b;
          denominator += f * f + b * b;
        }
      }
      const reflection = denominator > 0 ? (-2 * numerator) / denominator : 0;
      for (let i = 0; i <= m; i += 1) previous[i] = coefficients[i] ?? 0;
      for (let i = 1; i <= m; i += 1) {
        coefficients[i] = (previous[i] ?? 0) + reflection * (previous[m + 1 - i] ?? 0);
      }
      coefficients[m + 1] = reflection;
      // Each segment's errors from its end down, so `b[i − 1]` is still the last order's.
      for (let start = 0; start <= length; start += length) {
        for (let i = start + length - 1; i > start + m; i -= 1) {
          const f = forward[i] ?? 0;
          const b = backward[i - 1] ?? 0;
          forward[i] = f + reflection * b;
          backward[i] = b + reflection * f;
        }
      }
    }
  }

  /**
   * Writes the gap of `gap` samples that {@link surround} surrounds to
   * {@link solution}, by the model {@link fit} made; false, and the solution
   * not to be used, where a sample came out not finite, as one does over a
   * zero on the triangle's diagonal.
   */
  interpolate(gap: number): boolean {
    this.#build(gap);
    for (let column = 0; column < gap; column += 1) this.#reduce(column, gap);
    return this.#substitute(gap);
  }

  /** Writes `A` to the band and `−k` to the right-hand side for a gap of `gap`. */
  #build(gap: number): void {
    const order = this.order;
    const width = 2 * order + 1;
    const a = this.#coefficients;
    const surround = this.surround;
    const band = this.#band;
    const right = this.#right;
    const rows = gap + order;
    surround.fill(0, order, order + gap);
    band.fill(0, 0, rows * width);
    for (let row = 0; row < rows; row += 1) {
      let error = 0;
      for (let i = 0; i <= order; i += 1) error += (a[i] ?? 0) * (surround[row + order - i] ?? 0);
      right[row] = -error;
      for (let column = Math.max(0, row - order); column <= Math.min(gap - 1, row); column += 1) {
        band[row * width + column - row + order] = a[row - column] ?? 0;
      }
    }
  }

  /**
   * Reflects rows `column` to `column + P` so that `column` is zero below
   * its diagonal, applying the reflection to every column it reaches and to
   * the right-hand side.
   */
  #reduce(column: number, gap: number): void {
    const order = this.order;
    const width = 2 * order + 1;
    const band = this.#band;
    const v = this.#reflection;
    const last = Math.min(column + order, gap + order - 1);
    let norm = 0;
    for (let row = column; row <= last; row += 1) {
      const entry = band[row * width + column - row + order] ?? 0;
      v[row - column] = entry;
      norm += entry * entry;
    }
    const lead = v[0] ?? 0;
    // The reflection's sign is the one that adds to the lead, so no
    // cancellation shortens it.
    const alpha = lead > 0 ? -Math.sqrt(norm) : Math.sqrt(norm);
    const head = lead - alpha;
    v[0] = head;
    const length = norm - lead * lead + head * head;
    if (!(length > 0)) return;
    const reach = Math.min(column + order, gap - 1);
    for (let target = column; target <= reach; target += 1) {
      let dot = 0;
      for (let row = column; row <= last; row += 1) {
        dot += (v[row - column] ?? 0) * (band[row * width + target - row + order] ?? 0);
      }
      const scale = (2 * dot) / length;
      for (let row = column; row <= last; row += 1) {
        const at = row * width + target - row + order;
        band[at] = (band[at] ?? 0) - scale * (v[row - column] ?? 0);
      }
    }
    this.#reflectRight(column, last, length);
  }

  /** Applies the reflection over rows `column` to `last`, of `length`, to the right-hand side. */
  #reflectRight(column: number, last: number, length: number): void {
    const right = this.#right;
    const v = this.#reflection;
    let dot = 0;
    for (let row = column; row <= last; row += 1) dot += (v[row - column] ?? 0) * (right[row] ?? 0);
    const scale = (2 * dot) / length;
    for (let row = column; row <= last; row += 1) {
      right[row] = (right[row] ?? 0) - scale * (v[row - column] ?? 0);
    }
  }

  /** Solves the triangle into {@link solution}; false where a sample is not finite. */
  #substitute(gap: number): boolean {
    const order = this.order;
    const width = 2 * order + 1;
    const band = this.#band;
    const right = this.#right;
    const solution = this.solution;
    for (let row = gap - 1; row >= 0; row -= 1) {
      let sum = right[row] ?? 0;
      for (let column = row + 1; column <= Math.min(gap - 1, row + order); column += 1) {
        sum -= (band[row * width + column - row + order] ?? 0) * (solution[column] ?? 0);
      }
      const value = sum / (band[row * width + order] ?? 0);
      if (value - value !== 0) return false;
      solution[row] = value;
    }
    return true;
  }
}
