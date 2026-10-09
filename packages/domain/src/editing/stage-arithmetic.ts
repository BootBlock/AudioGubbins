/**
 * What a segment's stages do to its samples: the one statement of an edit's
 * arithmetic, which the engine renders by and every test checks against.
 *
 * The rule, stated so every machine gives the same bits (ADR-0032): each stage
 * is applied in order, and its result is rounded to a 32-bit float before the
 * next. A gain multiplies a sample by its factor, the factor computed by
 * `gainAt` in 64-bit arithmetic. A matrix row sums, in channel order and in
 * 64-bit arithmetic, each input's sample times its factor over the inputs whose
 * factor is not zero, starting from the first such product; a row with none is
 * +0. A row whose one such factor is 1 copies its input's sample, and a frame
 * outside a stage's range passes it, every bit kept: a channel a swap or a copy
 * leaves alone keeps a −0 and a NaN's payload, and never takes a NaN from an
 * infinity a zero factor multiplied.
 */

import { gainAt, type PlanSegment, type PlanStage } from './plan.js';

/**
 * Where a block lies in its segment's content: frame `index` of the block is
 * content frame `first + index · step`, so a reversed segment's block runs
 * down through its content.
 */
export interface BlockPlace {
  readonly first: number;
  readonly step: 1 | -1;
  readonly frames: number;
}

/** Where the whole of `segment`'s output lies in its content. */
export function placeOf(segment: PlanSegment): BlockPlace {
  return segment.reversed
    ? { first: segment.start + segment.length - 1, step: -1, frames: segment.length }
    : { first: segment.start, step: 1, frames: segment.length };
}

/** The content frame of block frame `index`. */
function contentFrame(place: BlockPlace, index: number): number {
  return place.first + index * place.step;
}

/** Applies a gain stage to the channels it names, in place. */
function applyGain(
  stage: Extract<PlanStage, { readonly kind: 'gain' }>,
  place: BlockPlace,
  channels: readonly Float32Array[],
): void {
  for (let index = 0; index < place.frames; index += 1) {
    const frame = contentFrame(place, index);
    if (frame < stage.from || frame >= stage.to) continue;
    const gain = gainAt(stage.gain, frame);
    if (stage.channels === undefined) {
      for (const channel of channels) channel[index] = Math.fround((channel[index] ?? 0) * gain);
    } else {
      for (const which of stage.channels) {
        const channel = channels[which];
        if (channel !== undefined) channel[index] = Math.fround((channel[index] ?? 0) * gain);
      }
    }
  }
}

/** How a matrix makes one output channel: a copy of one input, or a mix of some. */
type RowRule =
  | { readonly kind: 'copy'; readonly input: number }
  | {
      readonly kind: 'mix';
      readonly terms: readonly { readonly input: number; readonly factor: number }[];
    };

/** The rule of a matrix row: its inputs whose factor is not zero, or the one it copies. */
function rowRule(row: readonly number[]): RowRule {
  const terms: { input: number; factor: number }[] = [];
  row.forEach((factor, input) => {
    if (factor !== 0) terms.push({ input, factor });
  });
  const [only] = terms;
  return terms.length === 1 && only?.factor === 1
    ? { kind: 'copy', input: only.input }
    : { kind: 'mix', terms };
}

/** The bits of a channel, so a sample is moved without passing through a number. */
function bitsOf(channel: Float32Array): Uint32Array {
  return new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
}

/** Applies a matrix stage, answering the channels it leaves. */
function applyMatrix(
  stage: Extract<PlanStage, { readonly kind: 'matrix' }>,
  place: BlockPlace,
  channels: readonly Float32Array[],
): readonly Float32Array[] {
  const rules = stage.matrix.map(rowRule);
  // Outside the stage's range each channel passes as it is.
  const passes = stage.matrix.map((_, output): RowRule => ({ kind: 'copy', input: output }));
  const sourceBits = channels.map(bitsOf);
  const mixed = stage.matrix.map(() => new Float32Array(place.frames));
  const mixedBits = mixed.map(bitsOf);
  for (let index = 0; index < place.frames; index += 1) {
    const frame = contentFrame(place, index);
    const inside =
      stage.range === undefined || (frame >= stage.range.from && frame < stage.range.to);
    (inside ? rules : passes).forEach((rule, output) => {
      const target = mixed[output];
      const targetBits = mixedBits[output];
      if (target === undefined || targetBits === undefined) return;
      if (rule.kind === 'copy') {
        targetBits[index] = sourceBits[rule.input]?.[index] ?? 0;
        return;
      }
      let sum: number | undefined;
      for (const { input, factor } of rule.terms) {
        const product = factor * (channels[input]?.[index] ?? 0);
        sum = sum === undefined ? product : sum + product;
      }
      target[index] = Math.fround(sum ?? 0);
    });
  }
  return mixed;
}

/**
 * The block's samples after `stages`. Gains are applied in place; a matrix
 * answers new channels, since it may change how many there are.
 */
export function applyStages(
  stages: readonly PlanStage[],
  place: BlockPlace,
  channels: readonly Float32Array[],
): readonly Float32Array[] {
  let current = channels;
  for (const stage of stages) {
    if (stage.kind === 'gain') applyGain(stage, place, current);
    else current = applyMatrix(stage, place, current);
  }
  return current;
}

/**
 * Adds `addend` into `sum`, frame by frame over `frames`, in place: the rule
 * a mix source is summed by (`plan.ts`). The streams are added in the order
 * the mix states, starting from the first's samples as they are, each
 * addition made in 64-bit arithmetic and rounded to a 32-bit float, so a mix
 * gives the same bits on every machine (ADR-0032).
 */
export function sumInto(
  sum: readonly Float32Array[],
  addend: readonly Float32Array[],
  frames: number,
): void {
  sum.forEach((channel, which) => {
    const added = addend[which];
    if (added === undefined) return;
    for (let index = 0; index < frames; index += 1) {
      channel[index] = Math.fround((channel[index] ?? 0) + (added[index] ?? 0));
    }
  });
}
