import { PLAN_WITHOUT_CHAINS } from '../testing/plan-context.js';
import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import type { Asset } from '../project/asset.js';
import type { Marker, Region } from '../project/timeline.js';
import { assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { renderPlan } from '../testing/plan-render.js';
import { expectSuccess } from '../testing/unwrap.js';
import { conversionMatrix } from './channel-matrices.js';
import { markersInRegion, placeMarkers, placeRegions, regionPlan } from './placement.js';
import type { EditOperation, RegionOperation } from './operations.js';
import { validateRegion } from './placement-validation.js';
import { assetPlan } from './plan-building.js';
import { slicePlan } from './plan-slicing.js';

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
    const loud = renderPlan(
      expectSuccess(regionPlan(edited, untouched, PLAN_WITHOUT_CHAINS)),
      ones,
    );
    const soft = renderPlan(expectSuccess(regionPlan(edited, quieter, PLAN_WITHOUT_CHAINS)), ones);
    expect(loud[0]?.length).toBe(400);
    expect([...(loud[0] ?? [])].every((sample) => sample === 1)).toBe(true);
    expect([...(soft[1] ?? [])].every((sample) => sample === 0.5)).toBe(true);
    expect(
      renderPlan(expectSuccess(assetPlan(edited, PLAN_WITHOUT_CHAINS)), ones)[0]?.every(
        (sample) => sample === 1,
      ),
    ).toBe(true);
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
    const rendered = renderPlan(
      expectSuccess(regionPlan(edited, fading, PLAN_WITHOUT_CHAINS)),
      ones,
    )[0];
    expect([...(rendered ?? [])]).toEqual(
      Array.from({ length: 10 }, (_, index) => Math.fround((50 + index) / 100)),
    );
  });

  describe('keeps its processing on the content it was put on through later asset edits', () => {
    const fadeIn = {
      id: operationId('fade'),
      basis: 0,
      range: range(0, 5),
      edit: { kind: 'fade', direction: 'in', shape: 'linear' },
    } as const;
    const halved = {
      id: operationId('half'),
      basis: 0,
      range: range(0, 10),
      edit: { kind: 'gain', gain: 0.5 },
    } as const;
    const material = assetOf('material', 10, [], StandardLayouts.mono);
    const pasted = expectSuccess(
      slicePlan(expectSuccess(assetPlan(material, PLAN_WITHOUT_CHAINS)), 0, 3),
    );
    const later: readonly (readonly [string, EditOperation])[] = [
      ['a reversal', { id: operationId('turn'), kind: 'reverse', range: range(0, 10) }],
      ['a deletion inside it', { id: operationId('cut'), kind: 'delete', range: range(1, 3) }],
      [
        'a paste inside it',
        {
          id: operationId('paste'),
          kind: 'insert',
          at: frames(4),
          payload: pasted,
        },
      ],
    ];

    it.each(later)('sounding as the asset’s own processing would after %s', (_, operation) => {
      for (const processing of [fadeIn, halved]) {
        const asset = assetOf('material', 10, [operation], StandardLayouts.mono);
        const region = {
          ...regionOf('whole', 0, 10),
          assetId: asset.id,
          basis: 0,
          operations: [processing],
        };
        const processedFirst = assetOf(
          'material',
          10,
          [{ ...processing, kind: 'process' }, operation],
          StandardLayouts.mono,
        );
        const sources = new Map([[asset.id, [Float32Array.from({ length: 10 }, () => 1)]]]);
        expect(
          renderPlan(expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS)), sources),
        ).toEqual(
          renderPlan(expectSuccess(assetPlan(processedFirst, PLAN_WITHOUT_CHAINS)), sources),
        );
      }
    });

    it('so a fade reversed after it ends silent rather than starts silent', () => {
      const asset = assetOf(
        'material',
        10,
        [{ id: operationId('turn'), kind: 'reverse', range: range(0, 10) }],
        StandardLayouts.mono,
      );
      const region = {
        ...regionOf('whole', 0, 10),
        assetId: asset.id,
        basis: 0,
        operations: [fadeIn],
      };
      const sources = new Map([[asset.id, [Float32Array.from({ length: 10 }, () => 1)]]]);
      expect([
        ...(renderPlan(expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS)), sources)[0] ??
          []),
      ]).toEqual([1, 1, 1, 1, 1, 1, 0.75, 0.5, 0.25, 0]);
    });
  });

  describe('keeps processing that names channels on them through a later conversion', () => {
    const left = Float32Array.from({ length: 10 }, () => 1);
    const right = Float32Array.from({ length: 10 }, () => 0.25);

    /** The region over the whole of `asset`, its `processing` placed before any edit. */
    function wholeRegion(asset: Asset, processing: RegionOperation): Region {
      return {
        ...regionOf('whole', 0, 10),
        assetId: asset.id,
        basis: 0,
        operations: [processing],
      };
    }

    it('folds a stereo region quieter on its left alone into mono as that stereo', () => {
      const matrix = expectSuccess(conversionMatrix(StandardLayouts.stereo, StandardLayouts.mono));
      const asset = assetOf('folded', 10, [
        { id: operationId('mono'), kind: 'convert-layout', layout: StandardLayouts.mono, matrix },
      ]);
      const region = wholeRegion(asset, {
        id: operationId('left'),
        basis: 0,
        range: range(0, 10),
        channels: [0],
        edit: { kind: 'gain', gain: 0.5 },
      });
      const [[fromLeft = 0, fromRight = 0] = []] = matrix;
      const sources = new Map([[asset.id, [left, right]]]);

      const rendered = renderPlan(
        expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS)),
        sources,
      );

      expect(rendered).toHaveLength(1);
      expect([...(rendered[0] ?? [])]).toEqual(
        Array.from({ length: 10 }, () => Math.fround(fromLeft * 0.5 + fromRight * 0.25)),
      );
      expect(validateRegion(asset, region, PLAN_WITHOUT_CHAINS.chains).ok).toBe(true);
    });

    it('swaps a region’s channels before a later remap takes them where it says', () => {
      const asset = assetOf('remapped', 10, [
        {
          id: operationId('remap'),
          kind: 'convert-layout',
          layout: StandardLayouts.stereo,
          matrix: [
            [0, 1],
            [0, 0],
          ],
        },
      ]);
      const region = wholeRegion(asset, {
        id: operationId('swap'),
        basis: 0,
        range: range(2, 6),
        edit: { kind: 'swap-channels', first: 0, second: 1 },
      });
      const sources = new Map([[asset.id, [left, right]]]);

      const [first, second] = renderPlan(
        expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS)),
        sources,
      );

      // The remap's left takes the right as it stood after the swap: the
      // source's left inside the swapped range, and its right outside it.
      expect([...(first ?? [])]).toEqual([0.25, 0.25, 1, 1, 1, 1, 0.25, 0.25, 0.25, 0.25]);
      expect([...(second ?? [])].every((sample) => sample === 0)).toBe(true);
      expect(validateRegion(asset, region, PLAN_WITHOUT_CHAINS.chains).ok).toBe(true);
    });
  });

  it('applies the asset’s layout conversion to a region of it', () => {
    const matrix = expectSuccess(conversionMatrix(StandardLayouts.stereo, StandardLayouts.mono));
    const asset = assetOf('mono', 100, [
      { id: operationId('mono'), kind: 'convert-layout', layout: StandardLayouts.mono, matrix },
    ]);
    const plan = expectSuccess(
      regionPlan(
        asset,
        { ...regionOf('all', 0, 100), assetId: asset.id, basis: 0 },
        PLAN_WITHOUT_CHAINS,
      ),
    );
    expect(plan.streams[0].layout).toEqual(StandardLayouts.mono);
  });
});
