/**
 * Where an asset's spectral edits are outlined: each mask carried through the
 * operations after its edit, as a marker is, so its outline follows the sound
 * it changed through a deletion before it and a reversal over it, and placed
 * on the timeline of the view, a region's from its own start.
 */

import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  MaskEffect,
  NO_FEATHER,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type Asset,
  type EditOperation,
  type SpectralMask,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { spectralEditOutlines } from './spectral-edit-outlines.js';

const at = derivedSampleCount;

function assetWith(edits: readonly EditOperation[]): Asset {
  return {
    id: unsafeBrandId<'AssetId'>('0000bbbb-0000-4000-8000-000000000001'),
    displayName: 'Hum',
    origin: AssetOrigin.Imported,
    sampleRate: expectSuccess(sampleRate(48_000)),
    channelLayout: StandardLayouts.stereo,
    length: at(100_000),
    storageKey: 'content:hum',
    edits,
  };
}

function operation(name: string): EditOperation['id'] {
  return unsafeBrandId<'EditOperationId'>(`0000eeee-0000-4000-8000-00000000000${name}`);
}

/** A mask relative to its edit's range: a rectangle and a lasso. */
const MASK: SpectralMask = {
  shapes: [
    {
      kind: 'rectangle',
      effect: MaskEffect.Add,
      range: { start: at(1_000), end: at(3_000) },
      band: { low: 100, high: 900 },
    },
    {
      kind: 'polygon',
      effect: MaskEffect.Subtract,
      points: [
        { position: at(500), frequency: 200 },
        { position: at(4_000), frequency: 300 },
        { position: at(2_000), frequency: 800 },
      ],
    },
  ],
  feather: NO_FEATHER,
};

const ATTENUATE: EditOperation = {
  id: operation('1'),
  kind: 'process',
  range: { start: at(20_000), end: at(25_000) },
  channels: [1],
  edit: { kind: 'spectral', mask: MASK, resolution: 2_048, operation: { kind: 'heal' } },
};

describe('the outlines of spectral edits', () => {
  it('place each edit’s mask where its range begins, on the channels it acts on', () => {
    expect(spectralEditOutlines({ asset: assetWith([ATTENUATE]), offset: at(0) })).toEqual([
      { mask: MASK, from: 20_000, channels: [1] },
    ]);
  });

  it('follow the sound an edit changed when a deletion before it moves it', () => {
    const deletion: EditOperation = {
      id: operation('2'),
      kind: 'delete',
      range: { start: at(0), end: at(5_000) },
    };
    const [outline] = spectralEditOutlines({
      asset: assetWith([ATTENUATE, deletion]),
      offset: at(0),
    });
    expect(outline?.from).toBe(15_000);
    expect(outline?.mask).toEqual(MASK);
  });

  it('turn round with the sound where a reversal over the edit turns it round', () => {
    const reversal: EditOperation = {
      id: operation('3'),
      kind: 'reverse',
      range: { start: at(20_000), end: at(25_000) },
    };
    const [outline] = spectralEditOutlines({
      asset: assetWith([ATTENUATE, reversal]),
      offset: at(0),
    });
    expect(outline?.from).toBe(20_000);
    const [rectangle, lasso] = outline?.mask.shapes ?? [];
    expect(rectangle?.kind === 'rectangle' && rectangle.range).toEqual({
      start: 2_000,
      end: 4_000,
    });
    expect(lasso?.kind === 'polygon' && lasso.points.map((point) => point.position)).toEqual([
      4_500, 1_000, 3_000,
    ]);
  });

  it('are placed from the start of a region’s view', () => {
    const [outline] = spectralEditOutlines({ asset: assetWith([ATTENUATE]), offset: at(24_000) });
    expect(outline?.from).toBe(-4_000);
  });

  it('are none for an asset with no spectral edit', () => {
    const gain: EditOperation = {
      id: operation('4'),
      kind: 'process',
      range: { start: at(0), end: at(10) },
      edit: { kind: 'gain', gain: 0.5 },
    };
    expect(spectralEditOutlines({ asset: assetWith([gain]), offset: at(0) })).toEqual([]);
  });

  it('are worked out once for each state of the asset', () => {
    const viewed = { asset: assetWith([ATTENUATE]), offset: at(0) };
    expect(spectralEditOutlines(viewed)).toBe(spectralEditOutlines(viewed));
  });
});
