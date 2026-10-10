/**
 * Random spectral edits from a seed, for the property tests (ADR-0081): masks
 * of rectangles, polygons and strokes, each adding or taking away, hard or
 * feathered, and every operation at every resolution a build analyses with.
 *
 * Each value is made within the bounds the domain's validation sets, so the
 * caller's check that keeps only what a command could have made keeps nearly
 * all of them, and numbers sit at those bounds and at awkward fractions, where
 * a writer or a reader that rounds would be found.
 */

import {
  HIGHEST_MASK_FREQUENCY,
  LARGEST_SPECTRAL_RESOLUTION,
  MaskEffect,
  NO_FEATHER,
  SMALLEST_SPECTRAL_RESOLUTION,
  sampleCount,
  type EffectChainId,
  type SpectralEdit,
  type SpectralEditOperation,
  type SpectralFeather,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { randomCount, type Random } from './random-values.js';

/** The largest number below 1, which a reduction and a hardness may be. */
const JUST_BELOW_ONE = 1 - Number.EPSILON / 2;

/** Every resolution a spectral edit may have: the powers of two between the bounds. */
const RESOLUTIONS: readonly number[] = Array.from(
  { length: Math.log2(LARGEST_SPECTRAL_RESOLUTION / SMALLEST_SPECTRAL_RESOLUTION) + 1 },
  (_, index) => SMALLEST_SPECTRAL_RESOLUTION * 2 ** index,
);

/** Frequencies from nothing to the highest a mask may name. */
const FREQUENCIES = [0, 0.1 + 0.2, 440, 1_234.567_8, 12_000, HIGHEST_MASK_FREQUENCY];

/** Factors an `attenuate` or an `isolate` may apply, from removing to just below none. */
const REDUCTIONS = [0, 1e-7, 0.5, 0.1 + 0.2, JUST_BELOW_ONE];

const HARDNESSES = [0, 0.5, 0.1 + 0.2, JUST_BELOW_ONE];
const STRENGTHS = [Number.MIN_VALUE, 1e-7, 0.5, 1];

/** Half-widths in hertz a brush or a feather may have: above nothing, within the spectrum. */
const FREQUENCY_SPANS = [Number.MIN_VALUE, 0.5, 150.5, HIGHEST_MASK_FREQUENCY];

/** A span in samples above nothing and at most one past a range of `length`. */
function timeSpan(random: Random, length: number): number {
  return random.pick([0.5, 1, 7.25, length + 1].filter((span) => span <= length + 1));
}

function randomPoint(random: Random, length: number): SpectralPoint {
  return { position: randomCount(random, length), frequency: random.pick(FREQUENCIES) };
}

function randomStrokePoint(random: Random, length: number): StrokePoint {
  return {
    ...randomPoint(random, length),
    strength: random.pick(STRENGTHS),
    radius: { time: timeSpan(random, length), frequency: random.pick(FREQUENCY_SPANS) },
  };
}

/** A random shape within a range of `length`, which holds at least one frame. */
function randomShape(random: Random, effect: MaskEffect, length: number): SpectralShape {
  switch (random.below(3)) {
    case 0: {
      const start = random.below(length);
      const low = random.pick(FREQUENCIES.slice(0, -1));
      return {
        kind: 'rectangle',
        effect,
        range: {
          start: expectSuccess(sampleCount(start)),
          end: expectSuccess(sampleCount(start + 1 + random.below(length - start))),
        },
        band: { low, high: random.pick(FREQUENCIES.filter((frequency) => frequency > low)) },
      };
    }
    case 1: {
      const rest = Array.from({ length: random.below(4) }, () => randomPoint(random, length));
      return {
        kind: 'polygon',
        effect,
        points: [
          randomPoint(random, length),
          randomPoint(random, length),
          randomPoint(random, length),
          ...rest,
        ],
      };
    }
    default: {
      const rest = Array.from({ length: random.below(4) }, () => randomStrokePoint(random, length));
      return {
        kind: 'stroke',
        effect,
        hardness: random.pick(HARDNESSES),
        points: [randomStrokePoint(random, length), ...rest],
      };
    }
  }
}

function randomFeather(random: Random, length: number): SpectralFeather {
  return random.chance(0.5)
    ? NO_FEATHER
    : { time: timeSpan(random, length), frequency: random.pick(FREQUENCY_SPANS) };
}

/**
 * A random mask within a range of `length`: up to four shapes, the first
 * adding, since a mask with nothing adding to it selects nothing.
 */
export function randomMask(random: Random, length: number): SpectralMask {
  const rest = Array.from({ length: random.below(4) }, () =>
    randomShape(random, random.pick(Object.values(MaskEffect)), length),
  );
  return {
    shapes: [randomShape(random, MaskEffect.Add, length), ...rest],
    feather: randomFeather(random, length),
  };
}

/** A random operation, a `process` naming one of `chains` where there are any. */
function randomSpectralOperation(
  random: Random,
  chains: readonly EffectChainId[],
): SpectralEditOperation {
  switch (random.below(chains.length > 0 ? 4 : 3)) {
    case 0:
      return { kind: 'attenuate', gain: random.pick(REDUCTIONS) };
    case 1:
      return { kind: 'isolate', gain: random.pick(REDUCTIONS) };
    case 2:
      return { kind: 'heal' };
    default:
      return { kind: 'process', chain: random.pick(chains) };
  }
}

/** A random spectral edit over a range of `length`, at least one frame, naming one of `chains`. */
export function randomSpectralEdit(
  random: Random,
  length: number,
  chains: readonly EffectChainId[],
): SpectralEdit {
  return {
    kind: 'spectral',
    mask: randomMask(random, length),
    resolution: random.pick(RESOLUTIONS),
    operation: randomSpectralOperation(random, chains),
  };
}
