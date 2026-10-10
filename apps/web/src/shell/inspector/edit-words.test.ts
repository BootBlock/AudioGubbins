/**
 * A spectral clean-up in words (ADR-0081): one whose chain cannot run for
 * want of a model says it is not heard, and why. The sound it processes
 * cannot be opened while that holds, so this is said wherever its edits are
 * listed from the project rather than from the opened sound.
 */

import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  sampleCount,
  unsafeBrandId,
  type EditOperation,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { operationWords, type EditWording } from './edit-words.js';

const at = (frames: number) => expectSuccess(sampleCount(frames));

const CHAIN = unsafeBrandId<'EffectChainId'>('chain-1');

const CLEAN_UP: EditOperation = {
  id: unsafeBrandId<'EditOperationId'>('operation-1'),
  kind: 'process',
  range: { start: at(1_000), end: at(5_000) },
  edit: {
    kind: 'spectral',
    mask: {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(1_000), end: at(3_000) },
          band: { low: 300, high: 2_000 },
        },
      ],
      feather: NO_FEATHER,
    },
    resolution: 2_048,
    operation: { kind: 'process', chain: CHAIN },
  },
};

function wording(refusal: string | undefined): EditWording {
  return {
    position: String,
    channelsAt: () => ['Left', 'Right'],
    chain: () => 'DeepFilterNet 3',
    chainRefusal: (chain) => (chain === CHAIN ? refusal : undefined),
  };
}

describe('a spectral clean-up in words', () => {
  it('names the chain it runs, and its area from the start of its range', () => {
    expect(operationWords(CLEAN_UP, 0, wording(undefined))).toBe(
      'Cleaned up an area through DeepFilterNet 3, 2000 to 4000, 300 Hz to 2 kHz, a rectangle, in frames of 2,048 samples, from 1000 to 5000',
    );
  });

  it('says it is not heard, and why, where its chain cannot run', () => {
    expect(operationWords(CLEAN_UP, 0, wording('The model is not available.'))).toMatch(
      /^Cleaned up an area through DeepFilterNet 3 \(not heard: The model is not available\.\), 2000 to /u,
    );
  });
});
