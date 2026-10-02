/**
 * What each edit means, written the plainest way: applied straight to arrays
 * of samples, one operation after another.
 *
 * The oracle the edit plan is checked against. Nothing here shares code with
 * the plan's fold or its stage arithmetic, so a property test comparing the
 * two finds a fault in either. Its arithmetic is the plan's stated rule
 * (`stage-arithmetic.ts`): each result rounded to a 32-bit float, each fade
 * position `k / (n − 1)` through its range.
 */

import type { EditOperation, FadeShape, LevelEdit } from '../editing/operations.js';

/** Audio as one array per channel. */
export type Samples = readonly Float32Array[];

function shape(kind: FadeShape, t: number): number {
  if (kind === 'linear') return t;
  if (kind === 'equal-power') return Math.sqrt(t);
  if (kind === 's-curve') return t * t * (3 - 2 * t);
  return t * t;
}

function levelFactor(edit: LevelEdit, k: number, n: number): number {
  switch (edit.kind) {
    case 'gain':
      return edit.gain;
    case 'silence':
      return 0;
    case 'invert':
      return -1;
    case 'fade': {
      const t = n > 1 ? k / (n - 1) : 1;
      return shape(edit.shape, edit.direction === 'in' ? t : 1 - t);
    }
  }
}

function spliced(samples: Samples, start: number, end: number, inserted: Samples): Samples {
  return samples.map((channel, index) => {
    const extra = inserted[index] ?? new Float32Array(0);
    const out = new Float32Array(channel.length - (end - start) + extra.length);
    out.set(channel.subarray(0, start), 0);
    out.set(extra, start);
    out.set(channel.subarray(end), start + extra.length);
    return out;
  });
}

function mixed(
  samples: Samples,
  matrix: readonly (readonly number[])[],
  start: number,
  end: number,
): Samples {
  const length = samples[0]?.length ?? 0;
  return matrix.map((row, output) => {
    const out = Float32Array.from(samples[output] ?? new Float32Array(length));
    for (let frame: number = start; frame < end; frame += 1) {
      let sum = 0;
      row.forEach((factor, input) => (sum += factor * (samples[input]?.[frame] ?? 0)));
      out[frame] = Math.fround(sum);
    }
    return out;
  });
}

/**
 * The audio after `operation`. An insertion takes the samples it inserts as
 * `inserted`, since what a payload sounds like is what was copied.
 */
export function applyEdit(
  samples: Samples,
  operation: EditOperation,
  inserted: Samples = [],
): Samples {
  switch (operation.kind) {
    case 'delete':
      return spliced(samples, operation.range.start, operation.range.end, []);
    case 'trim':
      return samples.map((channel) => channel.slice(operation.range.start, operation.range.end));
    case 'insert':
      return spliced(samples, operation.at, operation.at, inserted);
    case 'reverse':
      return samples.map((channel) => {
        const out = Float32Array.from(channel);
        out.subarray(operation.range.start, operation.range.end).reverse();
        return out;
      });
    case 'convert-layout':
      return mixed(samples, operation.matrix, 0, samples[0]?.length ?? 0);
    case 'process':
      return processed(samples, operation);
  }
}

function processed(
  samples: Samples,
  operation: Extract<EditOperation, { readonly kind: 'process' }>,
): Samples {
  const { start, end } = operation.range;
  const edit = operation.edit;
  const count = samples.length;
  switch (edit.kind) {
    case 'swap-channels':
    case 'copy-channel':
    case 'channel-gains': {
      const matrix = samples.map((_, output) =>
        samples.map((__, input) => {
          if (edit.kind === 'swap-channels') {
            const source =
              output === edit.first ? edit.second : output === edit.second ? edit.first : output;
            return input === source ? 1 : 0;
          }
          if (edit.kind === 'copy-channel')
            return input === (output === edit.to ? edit.from : output) ? 1 : 0;
          return input === output ? (edit.gains[output] ?? 1) : 0;
        }),
      );
      return mixed(samples, matrix, start, end);
    }
    default: {
      const scope = new Set(operation.channels ?? samples.map((_, index) => index));
      return samples.map((channel, index) => {
        const out = Float32Array.from(channel);
        if (!scope.has(index) || index >= count) return out;
        for (let frame: number = start; frame < end; frame += 1) {
          out[frame] = Math.fround(
            (out[frame] ?? 0) * levelFactor(edit, frame - start, end - start),
          );
        }
        return out;
      });
    }
  }
}
