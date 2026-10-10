/**
 * What each edit means, written the plainest way: applied straight to arrays
 * of samples, one operation after another.
 *
 * The oracle the edit plan is checked against. Nothing here shares code with
 * the plan's fold or its stage arithmetic, so a property test comparing the
 * two finds a fault in either. Its arithmetic is the plan's stated rule
 * (`stage-arithmetic.ts`): each result rounded to a 32-bit float, each fade
 * position `k / (n − 1)` through its range.
 *
 * What a chain of processors, a stretch or a conversion of rate does to audio
 * is not the plan's to decide, so the oracle is given each as a function
 * (`OracleWorld`): the property tests check where the plan puts processing,
 * in what order and from what start, with any rule for the processing itself.
 *
 * A spectral edit's change is the engine's too, given as `spectral`, with its
 * mask relative to the range and its channels; the oracle replaces the range
 * by what it makes of it (ADR-0081).
 *
 * A punch is stated here whole (ADR-0072): the chosen take's recording, read
 * from the end of its pre-roll shifted by its compensation, converted where
 * its rate differs, and crossed into at each boundary by the stack's fades.
 */

import type { FadeShape } from '../editing/fades.js';
import type { EditOperation, LevelEdit } from '../editing/operations.js';
import type { AssetId, EffectChainId, TakeStackId } from '../identity/branded-id.js';
import type { TakeStack } from '../project/take-stack.js';
import type { SpectralEdit } from '../spectral/spectral-edit.js';
import { convertedFrameCount } from '../editing/plan.js';

/** Audio as one array per channel. */
export type Samples = readonly Float32Array[];

/** What the oracle is told of what it cannot know itself. */
export interface OracleWorld {
  /** What an insertion inserts: what was copied. */
  readonly inserted?: Samples;
  /** What a chain makes of audio, the same length. */
  readonly chain?: (chain: EffectChainId, samples: Samples) => Samples;
  /**
   * What a spectral edit makes of the range it processes, every channel
   * given, the same length; `channels` are those it acts on, every one where
   * absent.
   */
  readonly spectral?: (
    edit: Omit<SpectralEdit, 'kind'>,
    channels: readonly number[] | undefined,
    samples: Samples,
  ) => Samples;
  /** What a stretch makes of audio, `length` frames long. */
  readonly stretch?: (samples: Samples, length: number) => Samples;
  /** What a conversion makes of audio at `from`, at `to`. */
  readonly convert?: (samples: Samples, from: number, to: number, length: number) => Samples;
  /** The take stacks a punch names, and each recording a take is, at its rate. */
  readonly takes?: {
    readonly stacks: ReadonlyMap<TakeStackId, TakeStack>;
    readonly recordings: ReadonlyMap<AssetId, { readonly samples: Samples; readonly rate: number }>;
  };
}

/** The world's answer for `what`, or a fault naming what the test did not give. */
function given<T>(answer: T | undefined, what: string): T {
  if (answer === undefined) throw new Error(`The oracle was not told what ${what} does.`);
  return answer;
}

/** The samples with `[start, end)` replaced by `made` of `[start, end)`. */
function replaced(
  samples: Samples,
  start: number,
  end: number,
  make: (range: Samples) => Samples,
): Samples {
  return spliced(samples, start, end, make(samples.map((channel) => channel.slice(start, end))));
}

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
    // Copied as bytes, so a −0 and a NaN's payload pass as they are.
    const out = (samples[output] ?? new Float32Array(length)).slice();
    const used = row.flatMap((factor, input) => (factor === 0 ? [] : [{ factor, input }]));
    const [only] = used;
    if (used.length === 1 && only?.factor === 1) {
      const from = samples[only.input] ?? new Float32Array(length);
      out.set(from.subarray(start, end), start);
      return out;
    }
    for (let frame: number = start; frame < end; frame += 1) {
      const products = used.map(({ factor, input }) => factor * (samples[input]?.[frame] ?? 0));
      const [first = 0, ...rest] = products;
      out[frame] = Math.fround(rest.reduce((sum, product) => sum + product, first));
    }
    return out;
  });
}

/**
 * The audio at `rate` after `operation`, with what the oracle cannot know
 * itself taken from `world`.
 */
export function applyEdit(
  samples: Samples,
  operation: EditOperation,
  world: OracleWorld = {},
  rate = 0,
): Samples {
  switch (operation.kind) {
    case 'delete':
      return spliced(samples, operation.range.start, operation.range.end, []);
    case 'trim':
      return samples.map((channel) => channel.slice(operation.range.start, operation.range.end));
    case 'insert':
      return spliced(samples, operation.at, operation.at, world.inserted ?? []);
    case 'stretch': {
      const stretch = given(world.stretch, 'a stretch');
      return replaced(samples, operation.range.start, operation.range.end, (range) =>
        stretch(range, operation.length),
      );
    }
    case 'convert-rate': {
      const length = convertedFrameCount(samples[0]?.length ?? 0, rate, operation.sampleRate);
      return given(world.convert, 'a conversion')(samples, rate, operation.sampleRate, length);
    }
    case 'reverse':
      return samples.map((channel) => {
        const out = Float32Array.from(channel);
        out.subarray(operation.range.start, operation.range.end).reverse();
        return out;
      });
    case 'convert-layout':
      return mixed(samples, operation.matrix, 0, samples[0]?.length ?? 0);
    case 'process':
      return processed(samples, operation, world, rate);
  }
}

/** The take a punch of `length` frames at `rate` plays, from its recording. */
function takeSamples(
  recording: { readonly samples: Samples; readonly rate: number },
  from: number,
  length: number,
  rate: number,
  world: OracleWorld,
): Samples {
  if (recording.rate === rate) {
    return recording.samples.map((channel) => channel.slice(from, from + length));
  }
  const frames = Math.ceil((length * recording.rate) / rate);
  const read = recording.samples.map((channel) => channel.slice(from, from + frames));
  const converted = given(world.convert, 'a conversion')(
    read,
    recording.rate,
    rate,
    convertedFrameCount(frames, recording.rate, rate),
  );
  return converted.map((channel) => channel.slice(0, length));
}

/** The samples with `range` replaced by the chosen take of `stack`, crossed into and out of. */
function punched(
  samples: Samples,
  range: { readonly start: number; readonly end: number },
  stack: TakeStackId,
  world: OracleWorld,
  rate: number,
): Samples {
  const takes = given(world.takes, 'a take stack');
  const named = takes.stacks.get(stack);
  const punch = given(named?.punch, 'the punch of a take stack');
  const chosen = named?.takes.find((take) => take.id === named.chosen);
  if (chosen === undefined) return samples;
  const recording = given(takes.recordings.get(chosen.asset), 'a take’s recording');
  const length = range.end - range.start;
  const take = takeSamples(recording, punch.preRoll + chosen.compensation, length, rate, world);
  const { length: fade, shape: kind } = punch.crossfade;
  const position = (k: number): number => (fade > 1 ? k / (fade - 1) : 1);
  return samples.map((channel, index) => {
    const out = Float32Array.from(channel);
    const own = take[index] ?? new Float32Array(length);
    for (let k = 0; k < length; k += 1) {
      const earlier = out[range.start + k] ?? 0;
      const taken = own[k] ?? 0;
      const tail = k - (length - fade);
      let value = taken;
      if (k < fade) {
        value =
          Math.fround(earlier * shape(kind, 1 - position(k))) +
          Math.fround(taken * shape(kind, position(k)));
      } else if (tail >= 0) {
        value =
          Math.fround(earlier * shape(kind, position(tail))) +
          Math.fround(taken * shape(kind, 1 - position(tail)));
      }
      out[range.start + k] = Math.fround(value);
    }
    return out;
  });
}

function processed(
  samples: Samples,
  operation: Extract<EditOperation, { readonly kind: 'process' }>,
  world: OracleWorld,
  rate: number,
): Samples {
  const { start, end } = operation.range;
  const edit = operation.edit;
  const count = samples.length;
  switch (edit.kind) {
    case 'punch':
      return punched(samples, operation.range, edit.stack, world, rate);
    case 'rack': {
      const chain = given(world.chain, 'a chain');
      return replaced(samples, start, end, (range) => chain(edit.chain, range));
    }
    case 'spectral': {
      const spectral = given(world.spectral, 'a spectral edit');
      return replaced(samples, start, end, (range) => spectral(edit, operation.channels, range));
    }
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
