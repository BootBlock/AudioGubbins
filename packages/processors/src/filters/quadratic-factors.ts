/**
 * A quadratic in `x`, the cosine of a frequency's angle, non-negative over
 * the band from DC to half the rate, as the magnitude squared on the unit
 * circle of a second-order polynomial in `z⁻¹`: the spectral factorisation
 * that makes a fitted magnitude a section (`magnitude-fit.ts`).
 *
 * The polynomial taken is the minimum-phase one: each root `xᵢ` of the
 * quadratic is a zero `ρᵢ` of the polynomial with `(ρᵢ + 1/ρᵢ)/2 = xᵢ` and
 * `|ρᵢ| ≤ 1`, since `(1 − ρz⁻¹)(1 − ρz)` is `−2ρ(x − xᵢ)` on the circle, so a
 * denominator positive over the band gives poles strictly inside it. The
 * roots are taken by the forms that lose no precision when one is far larger
 * than the other. Only arithmetic and the square root, so a factorisation is
 * the same bits on every machine, and every double crosses a call through an
 * array, as a design on the audio thread needs.
 */

/** The least value of the quadratic last measured by {@link leastOnBand}. */
const LEAST = new Float64Array(1);

/** Writes the least value over `[−1, 1]` of `a + b·x + c·x²`, at `at` of `polynomial`, to {@link LEAST}. */
function leastOnBand(polynomial: Float64Array, at: number): void {
  const a = polynomial[at] ?? 0;
  const b = polynomial[at + 1] ?? 0;
  const c = polynomial[at + 2] ?? 0;
  let least = Math.min(a - b + c, a + b + c);
  if (c > 0) {
    const vertex = -b / (2 * c);
    if (vertex > -1 && vertex < 1) least = Math.min(least, a + vertex * (b + vertex * c));
  }
  LEAST[0] = least;
}

/**
 * Raises the quadratic at `at` of `polynomial` by a constant, where it needs
 * to be, so its least value over the band is `floors[floorAt]` at least.
 */
export function liftQuadratic(
  polynomial: Float64Array,
  at: number,
  floors: Float64Array,
  floorAt: number,
): void {
  const floor = floors[floorAt] ?? 0;
  leastOnBand(polynomial, at);
  const least = LEAST[0] ?? 0;
  if (least < floor) polynomial[at] = (polynomial[at] ?? 0) + floor - least;
}

/** `a + b·x`, its root of magnitude 1 or more, as one zero `ρ`, `|ρ| ≤ 1`. */
function factorLinear(
  polynomial: Float64Array,
  at: number,
  into: Float64Array,
  intoAt: number,
): void {
  const a = polynomial[at] ?? 0;
  const b = polynomial[at + 1] ?? 0;
  // a + b·x is b(x − x₁), and (1 − ρz⁻¹)(1 − ρz) is −2ρ(x − x₁).
  const root = -a / b;
  const rho = 1 / (root + (root < 0 ? -1 : 1) * Math.sqrt(Math.max(root * root - 1, 0)));
  into[intoAt] = Math.sqrt(-b / (2 * rho));
  into[intoAt + 1] = rho;
  into[intoAt + 2] = 0;
}

/** Two real roots, `q/c` and `a/q`, each of magnitude 1 or more. */
function factorRealRoots(
  polynomial: Float64Array,
  at: number,
  into: Float64Array,
  intoAt: number,
): void {
  const a = polynomial[at] ?? 0;
  const b = polynomial[at + 1] ?? 0;
  const c = polynomial[at + 2] ?? 0;
  const discriminant = b * b - 4 * a * c;
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant)) / 2;
  const first = c / (q + (q < 0 ? -1 : 1) * Math.sqrt(Math.max(q * q - c * c, 0)));
  const second = q / (a + (a < 0 ? -1 : 1) * Math.sqrt(Math.max(a * a - q * q, 0)));
  into[intoAt] = Math.sqrt(c / (4 * first * second));
  into[intoAt + 1] = first + second;
  into[intoAt + 2] = first * second;
}

/**
 * A conjugate pair of roots `x = v ± iy`, whose zeros are a conjugate pair
 * too: `ρ = 1/(x + w)`, `w = √(x² − 1)` taken so that `|x + w| ≥ 1`.
 */
function factorComplexRoots(
  polynomial: Float64Array,
  at: number,
  into: Float64Array,
  intoAt: number,
): void {
  const a = polynomial[at] ?? 0;
  const b = polynomial[at + 1] ?? 0;
  const c = polynomial[at + 2] ?? 0;
  const vertex = -b / (2 * c);
  const imaginary = Math.sqrt(4 * a * c - b * b) / (2 * Math.abs(c));
  const re = vertex * vertex - imaginary * imaginary - 1;
  const im = 2 * vertex * imaginary;
  const modulus = Math.sqrt(re * re + im * im);
  let wRe: number;
  let wIm: number;
  if (re >= 0) {
    wRe = Math.sqrt((modulus + re) / 2);
    wIm = wRe === 0 ? 0 : im / (2 * wRe);
  } else {
    wIm = (im < 0 ? -1 : 1) * Math.sqrt((modulus - re) / 2);
    wRe = im / (2 * wIm);
  }
  let sumRe = vertex + wRe;
  let sumIm = imaginary + wIm;
  const otherRe = vertex - wRe;
  const otherIm = imaginary - wIm;
  if (sumRe * sumRe + sumIm * sumIm < otherRe * otherRe + otherIm * otherIm) {
    sumRe = otherRe;
    sumIm = otherIm;
  }
  const size = sumRe * sumRe + sumIm * sumIm;
  const rhoRe = sumRe / size;
  const rhoIm = -sumIm / size;
  const product = rhoRe * rhoRe + rhoIm * rhoIm;
  into[intoAt] = Math.sqrt(c / (4 * product));
  into[intoAt + 1] = 2 * rhoRe;
  into[intoAt + 2] = product;
}

/**
 * Factors the quadratic at `at` of `polynomial`, `a + b·x + c·x²` and
 * non-negative over the band, into the `g`, `s` and `t` of a polynomial
 * `g(1 − s·z⁻¹ + t·z⁻²)` whose magnitude squared on the unit circle it is,
 * its zeros inside or on the circle, written to `into` from `intoAt`.
 */
export function factorQuadratic(
  polynomial: Float64Array,
  at: number,
  into: Float64Array,
  intoAt: number,
): void {
  const a = polynomial[at] ?? 0;
  const b = polynomial[at + 1] ?? 0;
  const c = polynomial[at + 2] ?? 0;
  if (c === 0) {
    if (b === 0) {
      into[intoAt] = Math.sqrt(a);
      into[intoAt + 1] = 0;
      into[intoAt + 2] = 0;
      return;
    }
    factorLinear(polynomial, at, into, intoAt);
    return;
  }
  const discriminant = b * b - 4 * a * c;
  const vertex = -b / (2 * c);
  if (discriminant >= 0 && c > 0 && vertex > -1 && vertex < 1) {
    // A double root on the band, which a non-negative quadratic has only
    // there: two zeros on the circle at the angle whose cosine it is.
    into[intoAt] = Math.sqrt(c / 4);
    into[intoAt + 1] = 2 * vertex;
    into[intoAt + 2] = 1;
    return;
  }
  if (discriminant >= 0) factorRealRoots(polynomial, at, into, intoAt);
  else factorComplexRoots(polynomial, at, into, intoAt);
}
