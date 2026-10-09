import { describe, expect, it } from 'vitest';

import { noise } from '@audiogubbins/test-fixtures';

import { HermitianSolver } from './hermitian-solver.js';

/** A Hermitian positive definite `B Bᴴ` of `size`, full and row-major, from seeded noise. */
function hermitian(size: number, seed: number): { re: Float64Array; im: Float64Array } {
  const random = noise(seed, { length: 2 * size * size, amplitude: 1 }).channels[0];
  const at = (index: number) => random?.[index] ?? 0;
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      for (let k = 0; k < size; k += 1) {
        // (B Bᴴ)_ij = Σ_k B_ik · conj(B_jk)
        const [a, b] = [at(2 * (i * size + k)), at(2 * (i * size + k) + 1)];
        const [c, d] = [at(2 * (j * size + k)), at(2 * (j * size + k) + 1)];
        re[i * size + j] = (re[i * size + j] ?? 0) + a * c + b * d;
        im[i * size + j] = (im[i * size + j] ?? 0) + b * c - a * d;
      }
    }
  }
  return { re, im };
}

/** The upper triangle of a full matrix, packed by rows as the solver reads it. */
function packed(full: Float64Array, size: number): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < size; i += 1)
    for (let j = i; j < size; j += 1) out.push(full[i * size + j] ?? 0);
  return Float64Array.from(out);
}

describe('the Hermitian solver', () => {
  it('solves (A + δI) g = b to the rounding of f64, as multiplying back shows', () => {
    for (const [size, loading] of [
      [1, 0],
      [5, 0],
      [24, 0],
      [24, 0.5],
    ] as const) {
      const a = hermitian(size, 31 + size);
      const solver = new HermitianSolver(size);
      solver.loading[0] = loading;
      const right =
        noise(77, { length: 2 * size, amplitude: 1 }).channels[0] ?? new Float32Array(0);
      const bRe = Float64Array.from({ length: size }, (_, index) => right[index] ?? 0);
      const bIm = Float64Array.from({ length: size }, (_, index) => right[size + index] ?? 0);
      const gRe = new Float64Array(size);
      const gIm = new Float64Array(size);
      expect(solver.factorise(packed(a.re, size), packed(a.im, size), 0)).toBe(true);
      solver.solve(bRe, bIm, gRe, gIm);
      let worst = 0;
      for (let i = 0; i < size; i += 1) {
        let [re, im] = [loading * (gRe[i] ?? 0), loading * (gIm[i] ?? 0)];
        for (let j = 0; j < size; j += 1) {
          const [p, q] = [a.re[i * size + j] ?? 0, a.im[i * size + j] ?? 0];
          const [x, y] = [gRe[j] ?? 0, gIm[j] ?? 0];
          re += p * x - q * y;
          im += p * y + q * x;
        }
        worst = Math.max(worst, Math.hypot(re - (bRe[i] ?? 0), im - (bIm[i] ?? 0)));
      }
      expect(worst).toBeLessThan(1e-9);
    }
  });

  it('reports a matrix that is not positive definite, and solves nothing', () => {
    const solver = new HermitianSolver(2);
    solver.loading[0] = 0;
    // [[1, 2], [2, 1]] has the eigenvalue −1.
    expect(solver.factorise(Float64Array.of(1, 2, 1), new Float64Array(3), 0)).toBe(false);
    expect(solver.factorise(Float64Array.of(Number.NaN, 0, 1), new Float64Array(3), 0)).toBe(false);
  });
});
