/**
 * What a segment's stages do to its samples: the one statement of an edit's
 * arithmetic, which the engine renders by and every test checks against.
 *
 * The rule, stated so every machine gives the same bits (ADR-0032): each stage
 * is applied in order, and its result is rounded to a 32-bit float before the
 * next. A gain multiplies a sample by its factor, the factor computed by
 * `gainAt` in 64-bit arithmetic. A matrix sums each input channel's sample
 * times its factor, in channel order, in 64-bit arithmetic from zero. A frame
 * outside a stage's range passes it unchanged.
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

/** Applies a matrix stage, answering the channels it leaves. */
function applyMatrix(
  stage: Extract<PlanStage, { readonly kind: 'matrix' }>,
  place: BlockPlace,
  channels: readonly Float32Array[],
): readonly Float32Array[] {
  const mixed = stage.matrix.map(() => new Float32Array(place.frames));
  for (let index = 0; index < place.frames; index += 1) {
    const frame = contentFrame(place, index);
    const inside =
      stage.range === undefined || (frame >= stage.range.from && frame < stage.range.to);
    stage.matrix.forEach((row, output) => {
      const target = mixed[output];
      if (target === undefined) return;
      if (!inside) {
        target[index] = channels[output]?.[index] ?? 0;
        return;
      }
      let sum = 0;
      row.forEach((factor, input) => {
        sum += factor * (channels[input]?.[index] ?? 0);
      });
      target[index] = Math.fround(sum);
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
