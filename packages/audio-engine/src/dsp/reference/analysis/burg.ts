/**
 * A linear predictor fitted to a block by Burg's method, as `burg.rs` fits
 * it, operation for operation: each reflection coefficient
 * `(−2 · Σ f[i] · b[i − 1]) / Σ (f[i]² + b[i − 1]²)`, or 0 unless the
 * denominator is above zero, the coefficients updated from their values
 * before, and the errors updated from the end down (ADR-0032).
 */

/** The scratch of fits to blocks of one length. */
export class ReferenceBurg {
  readonly #forward: Float64Array;
  readonly #backward: Float64Array;
  readonly #previous: Float64Array;

  constructor(order: number, length: number) {
    this.#forward = new Float64Array(length);
    this.#backward = new Float64Array(length);
    this.#previous = new Float64Array(order + 1);
  }

  /** Writes `block`'s prediction-error filter to `coefficients`, the first 1; `Burg::fit`. */
  fit(block: Float64Array, coefficients: Float64Array): void {
    const length = Math.min(block.length, this.#forward.length);
    const order = coefficients.length - 1;
    const forward = this.#forward;
    const backward = this.#backward;
    const previous = this.#previous;
    forward.set(block);
    backward.set(block);
    coefficients.fill(0);
    coefficients[0] = 1;
    const orders = Math.min(order, Math.max(length - 1, 0));
    for (let m = 0; m < orders; m += 1) {
      let numerator = 0;
      let denominator = 0;
      for (let i = m + 1; i < length; i += 1) {
        const f = forward[i] ?? 0;
        const b = backward[i - 1] ?? 0;
        numerator += f * b;
        denominator += f * f + b * b;
      }
      const reflection = denominator > 0 ? (-2 * numerator) / denominator : 0;
      for (let i = 0; i <= m; i += 1) previous[i] = coefficients[i] ?? 0;
      for (let i = 1; i <= m; i += 1) {
        coefficients[i] = (previous[i] ?? 0) + reflection * (previous[m + 1 - i] ?? 0);
      }
      coefficients[m + 1] = reflection;
      for (let i = length - 1; i > m; i -= 1) {
        const f = forward[i] ?? 0;
        const b = backward[i - 1] ?? 0;
        forward[i] = f + reflection * b;
        backward[i] = b + reflection * f;
      }
    }
  }
}
