import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { allocateBlock } from './frame-block.js';
import {
  PcmDescriptionKind,
  describedBuffers,
  describedLength,
  describedSource,
  pcmDescription,
  type PcmDescription,
} from './pcm-description.js';
import { toneRecipe } from './signal-recipe.js';

const RATE = expectSuccess(sampleRate(48_000));

function partOf(value: unknown): unknown {
  const read = pcmDescription(value);
  return read.ok ? undefined : read.failures[0].details?.['part'];
}

describe('reading a description', () => {
  it('reads audio in memory and a recipe back from their structured clones', () => {
    const pcm: PcmDescription = {
      kind: PcmDescriptionKind.Pcm,
      sampleRate: RATE,
      channels: [new Float32Array([0.5, -0.5]), new Float32Array([0.25, 1])],
    };
    const signal: PcmDescription = {
      kind: PcmDescriptionKind.Signal,
      sampleRate: RATE,
      recipe: expectSuccess(toneRecipe(2, 100, 440, 0.5)),
    };
    expect(expectSuccess(pcmDescription(structuredClone(pcm)))).toEqual(pcm);
    expect(expectSuccess(pcmDescription(structuredClone(signal)))).toEqual(signal);
  });

  it('names the part that is wrong', () => {
    expect(partOf('audio')).toBe('description');
    expect(partOf({ kind: 'pcm', sampleRate: 12.5, channels: [] })).toBe('sampleRate');
    expect(partOf({ kind: 'file', sampleRate: 48_000 })).toBe('kind');
    expect(partOf({ kind: 'pcm', sampleRate: 48_000, channels: [[1]] })).toBe('channels');
    expect(
      partOf({
        kind: 'pcm',
        sampleRate: 48_000,
        channels: [new Float32Array(2), new Float32Array(3)],
      }),
    ).toBe('channels');
    expect(partOf({ kind: 'signal', sampleRate: 48_000, recipe: { length: 1 } })).toBe('recipe');
  });
});

describe('what a description makes', () => {
  it('makes the source it describes, in the layout the reader knows', async () => {
    const description: PcmDescription = {
      kind: PcmDescriptionKind.Pcm,
      sampleRate: RATE,
      channels: [new Float32Array([0.5, -0.5, 0.25])],
    };
    const source = expectSuccess(describedSource(description, StandardLayouts.mono, REFERENCE_DSP));
    const block = allocateBlock(StandardLayouts.mono, RATE, 3);
    expect(expectSuccess(describedLength(description))).toBe(3);
    expect(await source.read(ZERO_SAMPLES, block)).toBe(3);
    expect([...(block.channels[0] ?? [])]).toEqual([0.5, -0.5, 0.25]);
  });

  it('refuses a description whose channels do not fit the layout', () => {
    expect(
      expectFailureCode(
        describedSource(
          { kind: PcmDescriptionKind.Pcm, sampleRate: RATE, channels: [new Float32Array(4)] },
          StandardLayouts.stereo,
          REFERENCE_DSP,
        ),
      ),
    ).toBe('pcm.block-channel-count-mismatch');
    expect(
      expectFailureCode(
        describedSource(
          {
            kind: PcmDescriptionKind.Signal,
            sampleRate: RATE,
            recipe: expectSuccess(toneRecipe(1, 10, 440, 0.5)),
          },
          StandardLayouts.stereo,
          REFERENCE_DSP,
        ),
      ),
    ).toBe('pcm.signal-channels-mismatched');
  });

  it('lists each buffer behind the arrays once, for a transfer', () => {
    const shared = new Float32Array(8);
    const buffers = describedBuffers([
      {
        kind: PcmDescriptionKind.Pcm,
        sampleRate: RATE,
        channels: [shared.subarray(0, 4), shared.subarray(4)],
      },
      {
        kind: PcmDescriptionKind.Signal,
        sampleRate: RATE,
        recipe: expectSuccess(toneRecipe(1, 10, 440, 0.5)),
      },
    ]);
    expect(buffers).toEqual([shared.buffer]);
  });
});
