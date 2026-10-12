import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
  type PlanStream,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { runningChanges } from './running-changes.js';

const RATE = expectSuccess(sampleRate(48_000));
const LAYOUT = StandardLayouts.mono;
const ASSET = unsafeBrandId<'AssetId'>('00000000-a55e');
const PROCESSOR = unsafeBrandId<'ProcessorId'>('00000000-9a1e');
const LEVEL = unsafeBrandId<'ParameterId'>('9a1e0001-0001');

function gainChain(decibels: number): EffectChain {
  return {
    id: unsafeBrandId<'EffectChainId'>('00000000-c4a1'),
    slots: [
      {
        kind: 'processor',
        id: PROCESSOR,
        typeKey: 'gain',
        enabled: true,
        soloed: false,
        mix: 1,
        version: { implementation: 1, parameters: 1 },
        values: new Map([[LEVEL, decibels]]),
      },
    ],
  };
}

const WHOLE = {
  start: derivedSampleCount(0),
  length: derivedSampleCount(1_000),
  reversed: false,
  stages: [],
};

function racked(chain: EffectChain): PlanStream {
  return {
    sampleRate: RATE,
    layout: LAYOUT,
    segments: [{ ...WHOLE, source: { kind: 'media', asset: ASSET } }],
    processing: { kind: 'chain', chain, input: LAYOUT },
  };
}

/**
 * The asset's racked audio at place 1 and, at place 2, a paste of it made
 * before its gain changed, whose chain keeps the processor's identifier.
 */
function withPaste(live: number, pasted: number): EditPlan {
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: LAYOUT,
        segments: [
          { ...WHOLE, source: { kind: 'stream', stream: 1 } },
          { ...WHOLE, source: { kind: 'stream', stream: 2 } },
        ],
      },
      racked(gainChain(live)),
      racked(gainChain(pasted)),
    ],
  };
}

describe('the changes playback takes running (REQ-AUDIO-019)', () => {
  it('names the stream whose chain changed, a pasted copy of it sharing its processor kept as it was', () => {
    expect(runningChanges(withPaste(-6, -6), withPaste(-3, -6))).toEqual([
      { stream: 1, processor: PROCESSOR, parameter: LEVEL, value: -3 },
    ]);
    expect(runningChanges(withPaste(-6, -6), withPaste(-6, -3))).toEqual([
      { stream: 2, processor: PROCESSOR, parameter: LEVEL, value: -3 },
    ]);
  });

  it('gives a change for each stream a shared chain is heard in, and none where only a value is the same', () => {
    expect(runningChanges(withPaste(-6, -6), withPaste(-3, -3))).toEqual([
      { stream: 1, processor: PROCESSOR, parameter: LEVEL, value: -3 },
      { stream: 2, processor: PROCESSOR, parameter: LEVEL, value: -3 },
    ]);
    expect(runningChanges(withPaste(-6, -6), withPaste(-6, -6))).toEqual([]);
  });

  it('takes none from a spectral edit’s chain, which runs inside its frames and is read again', () => {
    const cleaned = (decibels: number): EditPlan => ({
      streams: [
        {
          sampleRate: RATE,
          layout: LAYOUT,
          segments: [{ ...WHOLE, source: { kind: 'media', asset: ASSET } }],
          processing: {
            kind: 'spectral',
            edit: {
              mask: {
                shapes: [
                  {
                    kind: 'rectangle',
                    effect: MaskEffect.Add,
                    range: { start: derivedSampleCount(100), end: derivedSampleCount(900) },
                    band: { low: 100, high: 400 },
                  },
                ],
                feather: NO_FEATHER,
              },
              resolution: 256,
              operation: { kind: 'process', chain: gainChain(decibels), input: LAYOUT },
            },
          },
        },
      ],
    });

    expect(runningChanges(cleaned(-6), cleaned(-3))).toBeUndefined();
  });
});
