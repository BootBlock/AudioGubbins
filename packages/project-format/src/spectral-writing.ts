/**
 * Writing a spectral edit's mask and operation as `spectral-reading.ts` reads
 * them (ADR-0081): every member of every shape, lists in the mask's own
 * order, which is its meaning.
 */

import type {
  PlannedSpectralOperation,
  SpectralEditOperation,
  SpectralMask,
  SpectralShape,
} from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { writeEffectChain } from './chain-writing.js';
import { writeLayout } from './value-writing.js';

function writeShape(shape: SpectralShape): JsonObject {
  switch (shape.kind) {
    case 'rectangle':
      return {
        kind: shape.kind,
        effect: shape.effect,
        range: { start: shape.range.start, end: shape.range.end },
        band: { low: shape.band.low, high: shape.band.high },
      };
    case 'polygon':
      return {
        kind: shape.kind,
        effect: shape.effect,
        points: shape.points.map((point) => ({
          position: point.position,
          frequency: point.frequency,
        })),
      };
    case 'stroke':
      return {
        kind: shape.kind,
        effect: shape.effect,
        hardness: shape.hardness,
        points: shape.points.map((point) => ({
          position: point.position,
          frequency: point.frequency,
          strength: point.strength,
          radius: { time: point.radius.time, frequency: point.radius.frequency },
        })),
      };
  }
}

/** Writes a spectral mask. */
export function writeSpectralMask(mask: SpectralMask): JsonObject {
  return {
    shapes: mask.shapes.map(writeShape),
    feather: { time: mask.feather.time, frequency: mask.feather.frequency },
  };
}

/** Writes a spectral edit's operation as an edit holds it. */
export function writeSpectralOperation(operation: SpectralEditOperation): JsonObject {
  switch (operation.kind) {
    case 'attenuate':
    case 'isolate':
      return { kind: operation.kind, gain: operation.gain };
    case 'heal':
      return { kind: operation.kind };
    case 'process':
      return { kind: operation.kind, chain: operation.chain };
  }
}

/** Writes a spectral edit's operation as a plan holds it, its chain whole. */
export function writePlannedSpectralOperation(operation: PlannedSpectralOperation): JsonObject {
  return operation.kind === 'process'
    ? {
        kind: operation.kind,
        chain: writeEffectChain(operation.chain),
        input: writeLayout(operation.input),
      }
    : writeSpectralOperation(operation);
}
