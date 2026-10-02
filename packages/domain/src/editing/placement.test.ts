import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import type { Marker, Region } from '../project/timeline.js';
import { assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { renderPlan } from '../testing/plan-render.js';
import { expectSuccess } from '../testing/unwrap.js';
import { conversionMatrix } from './channel-matrices.js';
import { markersInRegion, placeMarkers, placeRegions, regionPlan } from './placement.js';
import { assetPlan } from './plan-building.js';

const edited = assetOf('edited', 1_000, [
  { id: operationId('cut'), kind: 'delete', range: range(100, 200) },
]);

function markerAt(name: string, basis: number, position: number, asset = edited): Marker {
  return {
    id: unsafeBrandId(`0000cccc-${name}`),
    assetId: asset.id,
    displayName: name,
    basis,
    position: frames(position),
  };
}

function regionOf(name: string, start: number, end: number, extra: Partial<Region> = {}): Region {
  return {
    id: unsafeBrandId(`0000dddd-${name}`),
    assetId: edited.id,
    displayName: name,
    basis: 1,
    start: frames(start),
    end: frames(end),
    tags: [],
    operations: [],
    ...extra,
  };
}

describe('placing markers', () => {
  it('places each of the asset’s markers where its anchor resolves now, in position order', () => {
    const placed = placeMarkers(edited, [
      markerAt('late', 0, 500),
      markerAt('early', 1, 50),
      markerAt('gone', 0, 150),
    ]);
    expect(placed.map((marker) => [marker.displayName, marker.position])).toEqual([
      ['early', 50],
      ['gone', 100],
      ['late', 400],
    ]);
  });

  it('places no marker of another asset', () => {
    const other = assetOf('other', 10);
    expect(placeMarkers(edited, [markerAt('elsewhere', 0, 5, other)])).toEqual([]);
  });

  it('shifts the markers inside a region to the region’s own timeline', () => {
    const placed = placeMarkers(edited, [markerAt('in', 1, 350), markerAt('out', 1, 10)]);
    const [region] = placeRegions(edited, [regionOf('step', 300, 400)]);
    if (region === undefined) throw new Error('The region places.');
    expect(markersInRegion(placed, region).map((marker) => marker.position)).toEqual([50]);
  });
});

describe('placing regions', () => {
  it('cuts a loop to its region and its crossfade to its loop', () => {
    const [region] = placeRegions(edited, [
      regionOf('loop', 300, 400, {
        loop: { basis: 1, start: frames(350), end: frames(450), crossfadeLength: frames(80) },
      }),
    ]);
    expect(region?.loop).toEqual({ loopStart: 50, loopEnd: 100, crossfadeLength: 50 });
  });

  it('drops a loop a later deletion closed up', () => {
    const asset = assetOf('closed', 1_000, [
      { id: operationId('cut'), kind: 'delete', range: range(300, 400) },
    ]);
    const [region] = placeRegions(asset, [
      {
        ...regionOf('loop', 200, 600),
        assetId: asset.id,
        basis: 0,
        loop: { basis: 0, start: frames(310), end: frames(390), crossfadeLength: frames(0) },
      },
    ]);
    expect(region?.loop).toBeUndefined();
    expect(region?.length).toBe(300);
  });
});

describe('what a region sounds like', () => {
  const ones = new Map([
    [edited.id, [new Float32Array(1_000).fill(1), new Float32Array(1_000).fill(1)]],
  ]);

  it('is the asset’s edited audio between its boundaries, through its own processing alone', () => {
    const quieter = regionOf('quieter', 0, 400, {
      operations: [
        {
          id: operationId('gain'),
          basis: 1,
          range: range(0, 900),
          edit: { kind: 'gain', gain: 0.5 },
        },
      ],
    });
    const untouched = regionOf('untouched', 0, 400);
    const loud = renderPlan(regionPlan(edited, untouched), ones);
    const soft = renderPlan(regionPlan(edited, quieter), ones);
    expect(loud[0]?.length).toBe(400);
    expect([...(loud[0] ?? [])].every((sample) => sample === 1)).toBe(true);
    expect([...(soft[1] ?? [])].every((sample) => sample === 0.5)).toBe(true);
    expect(renderPlan(assetPlan(edited), ones)[0]?.every((sample) => sample === 1)).toBe(true);
  });

  it('keeps a fade begun before the region a continuous ramp inside it', () => {
    const fading = regionOf('fading', 50, 60, {
      operations: [
        {
          id: operationId('fade'),
          basis: 1,
          range: range(0, 101),
          edit: { kind: 'fade', direction: 'in', shape: 'linear' },
        },
      ],
    });
    const rendered = renderPlan(regionPlan(edited, fading), ones)[0];
    expect([...(rendered ?? [])]).toEqual(
      Array.from({ length: 10 }, (_, index) => Math.fround((50 + index) / 100)),
    );
  });

  it('applies the asset’s layout conversion to a region of it', () => {
    const matrix = expectSuccess(conversionMatrix(StandardLayouts.stereo, StandardLayouts.mono));
    const asset = assetOf('mono', 100, [
      { id: operationId('mono'), kind: 'convert-layout', layout: StandardLayouts.mono, matrix },
    ]);
    const plan = regionPlan(asset, { ...regionOf('all', 0, 100), assetId: asset.id, basis: 0 });
    expect(plan.streams[0].layout).toEqual(StandardLayouts.mono);
  });
});
