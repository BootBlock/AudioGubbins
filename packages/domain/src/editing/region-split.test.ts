import { PLAN_WITHOUT_CHAINS } from '../testing/plan-context.js';
import { expectSuccess } from '../testing/unwrap.js';
import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '../identity/branded-id.js';
import { createDeterministicIdGenerator } from '../identity/id-generator.js';
import type { Region } from '../project/timeline.js';
import { assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { renderPlan } from '../testing/plan-render.js';
import type { RegionOperation } from './operations.js';
import { regionPlan } from './placement.js';
import { splitRegion, splitWholeAsset } from './region-split.js';

const edited = assetOf('edited', 1_000, [
  { id: operationId('cut'), kind: 'delete', range: range(100, 200) },
]);

function louder(name: string, start: number, end: number): RegionOperation {
  return {
    id: operationId(name),
    basis: 1,
    range: range(start, end),
    edit: { kind: 'gain', gain: 2 },
  };
}

/** A region of `edited` from 300 to 700, stated before the deletion, so its anchors are carried. */
function regionWith(operations: readonly RegionOperation[], extra: Partial<Region> = {}): Region {
  return {
    id: unsafeBrandId('0000dddd-body'),
    assetId: edited.id,
    displayName: 'Body',
    basis: 0,
    start: frames(400),
    end: frames(800),
    tags: ['pad'],
    operations,
    ...extra,
  };
}

function split(region: Region, at: number) {
  const parts = splitRegion(edited, region, frames(at), createDeterministicIdGenerator(1));
  if (parts === undefined) throw new Error('The split is inside the region.');
  return parts;
}

describe('splitting a region', () => {
  it('makes two regions meeting at the split, restated at the chain as it stands', () => {
    const [first, second] = split(regionWith([]), 500);

    expect(first).toMatchObject({ id: '0000dddd-body', displayName: 'Body', basis: 1 });
    expect([first.start, first.end, second.start, second.end]).toEqual([300, 500, 500, 700]);
    expect(second).toMatchObject({ displayName: 'Body (2)', basis: 1, tags: ['pad'] });
    expect(second.id).not.toBe(first.id);
  });

  it.each([
    ['before the split', 300, 400, [true, false]],
    ['after the split', 600, 700, [false, true]],
    ['over the split', 450, 550, [true, true]],
  ] as const)('keeps processing %s on the part it covers alone', (_case, start, end, kept) => {
    const processing = louder('gain', start, end);
    const parts = split(regionWith([processing]), 500);

    expect(
      parts.map((part) => part.operations.some((one) => one.range === processing.range)),
    ).toEqual(kept);
  });

  it('gives the second part’s processing new identities and keeps the order it was made in', () => {
    const operations = [
      louder('one', 450, 550),
      louder('two', 600, 650),
      louder('three', 300, 700),
    ];
    const [first, second] = split(regionWith(operations), 500);

    expect(first.operations).toEqual([operations[0], operations[2]]);
    expect(second.operations.map((operation) => operation.range)).toEqual([
      range(450, 550),
      range(600, 650),
      range(300, 700),
    ]);
    const firstIds = new Set(first.operations.map((operation) => operation.id));
    expect(second.operations.some((operation) => firstIds.has(operation.id))).toBe(false);
  });

  it('keeps the loop on the part it lies wholly within, and on neither where it crosses the split', () => {
    const loop = { basis: 1, start: frames(550), end: frames(650), crossfadeLength: frames(10) };
    const [first, second] = split(regionWith([], { loop }), 500);
    expect([first.loop, second.loop]).toEqual([undefined, loop]);

    const [one, other] = split(regionWith([], { loop }), 600);
    expect([one.loop, other.loop]).toEqual([undefined, undefined]);
  });

  it('sounds as the region did, part for part, with a fade over the split', () => {
    const ones = new Map([
      [edited.id, [new Float32Array(1_000).fill(1), new Float32Array(1_000).fill(1)]],
    ]);
    const fade: RegionOperation = {
      id: operationId('fade'),
      basis: 1,
      range: range(450, 550),
      edit: { kind: 'fade', direction: 'in', shape: 'linear' },
    };
    const region = regionWith([fade]);
    const [first, second] = split(region, 500);
    const heard = (one: Region) => [
      ...(renderPlan(expectSuccess(regionPlan(edited, one, PLAN_WITHOUT_CHAINS)), ones)[0] ?? []),
    ];

    expect([...heard(first), ...heard(second)]).toEqual(heard(region));
    expect(heard(region).some((sample) => sample > 0 && sample < 1)).toBe(true);
  });

  it('refuses a split at either end of the region or outside it', () => {
    const ids = createDeterministicIdGenerator(1);
    for (const at of [250, 300, 700, 900]) {
      expect(splitRegion(edited, regionWith([]), frames(at), ids)).toBeUndefined();
    }
  });
});

describe('splitting where no region is', () => {
  it('makes two regions over the whole of the edited asset', () => {
    const parts = splitWholeAsset(
      edited,
      frames(400),
      'Region 1',
      createDeterministicIdGenerator(1),
    );

    expect(parts?.map((part) => [part.displayName, part.basis, part.start, part.end])).toEqual([
      ['Region 1', 1, 0, 400],
      ['Region 1 (2)', 1, 400, 900],
    ]);
  });

  it('refuses a split at the start, at the end or past the edited audio', () => {
    const ids = createDeterministicIdGenerator(1);
    for (const at of [0, 900, 950]) {
      expect(splitWholeAsset(edited, frames(at), 'Region 1', ids)).toBeUndefined();
    }
  });
});
