/**
 * The small linear systems the magnitude fit solves (`magnitude-fit.ts`):
 * normal equations of at most {@link MOST_UNKNOWNS} unknowns, by rows of that
 * many, their diagonal damped as a Levenberg-Marquardt step damps it, solved
 * by elimination with partial pivoting. Arithmetic alone, so a solution is
 * the same bits on every machine, in a copy made once, so a solve on the
 * audio thread allocates nothing.
 */

/** The most unknowns a system has, and so the length of a row. */
export const MOST_UNKNOWNS = 5;

/** The system being eliminated, a copy of the one given, its diagonal damped. */
const SYSTEM = new Float64Array(MOST_UNKNOWNS * MOST_UNKNOWNS);

/** The length of a row of {@link SYSTEM}. */
const WIDTH = MOST_UNKNOWNS;

/**
 * Brings the row of the largest magnitude in `column`, at or below it, up to
 * it, in {@link SYSTEM} and `solution`; false where every one is zero, so the
 * system is singular.
 */
function pivotOn(column: number, size: number, solution: Float64Array): boolean {
  let pivot = column;
  for (let row = column + 1; row < size; row += 1) {
    if (
      Math.abs(SYSTEM[row * WIDTH + column] ?? 0) > Math.abs(SYSTEM[pivot * WIDTH + column] ?? 0)
    ) {
      pivot = row;
    }
  }
  if ((SYSTEM[pivot * WIDTH + column] ?? 0) === 0) return false;
  if (pivot === column) return true;
  for (let k = 0; k < size; k += 1) {
    const held = SYSTEM[column * WIDTH + k] ?? 0;
    SYSTEM[column * WIDTH + k] = SYSTEM[pivot * WIDTH + k] ?? 0;
    SYSTEM[pivot * WIDTH + k] = held;
  }
  const held = solution[column] ?? 0;
  solution[column] = solution[pivot] ?? 0;
  solution[pivot] = held;
  return true;
}

/** Takes `column` out of every row below it, in {@link SYSTEM} and `solution`. */
function eliminate(column: number, size: number, solution: Float64Array): void {
  const lead = SYSTEM[column * WIDTH + column] ?? 1;
  for (let row = column + 1; row < size; row += 1) {
    const factor = (SYSTEM[row * WIDTH + column] ?? 0) / lead;
    if (factor === 0) continue;
    for (let k = column; k < size; k += 1) {
      SYSTEM[row * WIDTH + k] =
        (SYSTEM[row * WIDTH + k] ?? 0) - factor * (SYSTEM[column * WIDTH + k] ?? 0);
    }
    solution[row] = (solution[row] ?? 0) - factor * (solution[column] ?? 0);
  }
}

/**
 * Solves the `size` by `size` system `normal`, rows of {@link MOST_UNKNOWNS},
 * with the right side `right`, its diagonal multiplied by one more than
 * `damping[dampingAt]`, into `solution`; false where it is singular, and
 * `normal` and `right` are left as they were.
 */
export function solveDamped(
  normal: Float64Array,
  right: Float64Array,
  size: number,
  damping: Float64Array,
  dampingAt: number,
  solution: Float64Array,
): boolean {
  const scale = 1 + (damping[dampingAt] ?? 0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = normal[row * WIDTH + column] ?? 0;
      SYSTEM[row * WIDTH + column] = row === column ? value * scale : value;
    }
    solution[row] = right[row] ?? 0;
  }
  for (let column = 0; column < size; column += 1) {
    if (!pivotOn(column, size, solution)) return false;
    eliminate(column, size, solution);
  }
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = solution[row] ?? 0;
    for (let k = row + 1; k < size; k += 1)
      sum -= (SYSTEM[row * WIDTH + k] ?? 0) * (solution[k] ?? 0);
    solution[row] = sum / (SYSTEM[row * WIDTH + row] ?? 1);
  }
  return true;
}
