import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { OTHER_RATE, assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { expectSuccess } from '../testing/unwrap.js';
import { Affinity, anchorResolver, carryPosition, carrySpan } from './anchors.js';
import { sourceShape } from './edit-shape.js';
import type { EditOperation } from './operations.js';
import { assetPlan } from './plan-building.js';
import { slicePlan } from './plan-slicing.js';

const SOURCE = assetOf('source', 1_000);
const SHAPE = sourceShape(SOURCE);
const TEN_FRAMES = expectSuccess(slicePlan(assetPlan(SOURCE), 0, 10));

const deletion: EditOperation = {
  id: operationId('delete'),
  kind: 'delete',
  range: range(100, 200),
};
const insertion: EditOperation = {
  id: operationId('insert'),
  kind: 'insert',
  at: frames(300),
  payload: TEN_FRAMES,
  convertRate: false,
};
const reversal: EditOperation = {
  id: operationId('reverse'),
  kind: 'reverse',
  range: range(400, 500),
};
const trim: EditOperation = { id: operationId('trim'), kind: 'trim', range: range(100, 900) };
const gain: EditOperation = {
  id: operationId('gain'),
  kind: 'process',
  range: range(0, 1_000),
  edit: { kind: 'gain', gain: 0.5 },
};

describe('carrying a position through one edit', () => {
  it('closes a deletion over what it removed, and moves what follows back by its length', () => {
    expect(carryPosition(deletion, SHAPE, 100, Affinity.After)).toBe(100);
    expect(carryPosition(deletion, SHAPE, 150, Affinity.After)).toBe(100);
    expect(carryPosition(deletion, SHAPE, 200, Affinity.After)).toBe(100);
    expect(carryPosition(deletion, SHAPE, 250, Affinity.After)).toBe(150);
    expect(carryPosition(deletion, SHAPE, 99, Affinity.After)).toBe(99);
  });

  it('pushes what follows an insertion on, and decides one exactly at it by its affinity', () => {
    expect(carryPosition(insertion, SHAPE, 299, Affinity.After)).toBe(299);
    expect(carryPosition(insertion, SHAPE, 301, Affinity.Before)).toBe(311);
    expect(carryPosition(insertion, SHAPE, 300, Affinity.After)).toBe(310);
    expect(carryPosition(insertion, SHAPE, 300, Affinity.Before)).toBe(300);
  });

  it('reflects a boundary inside a reversal and leaves its edges where they are', () => {
    expect(carryPosition(reversal, SHAPE, 410, Affinity.After)).toBe(490);
    expect(carryPosition(reversal, SHAPE, 400, Affinity.After)).toBe(400);
    expect(carryPosition(reversal, SHAPE, 500, Affinity.After)).toBe(500);
  });

  it('keeps a trim’s range and closes both ends', () => {
    expect(carryPosition(trim, SHAPE, 50, Affinity.After)).toBe(0);
    expect(carryPosition(trim, SHAPE, 500, Affinity.After)).toBe(400);
    expect(carryPosition(trim, SHAPE, 950, Affinity.After)).toBe(800);
  });

  it('carries every position through processing unchanged', () => {
    expect(carryPosition(gain, SHAPE, 777, Affinity.Before)).toBe(777);
  });
});

describe('carrying a span through one edit', () => {
  it('never widens a region pasted against at either edge', () => {
    expect(carrySpan(insertion, SHAPE, { start: 300, end: 400 })).toEqual({ start: 310, end: 410 });
    expect(carrySpan(insertion, SHAPE, { start: 200, end: 300 })).toEqual({ start: 200, end: 300 });
  });

  it('turns a span inside a reversal round, start before end', () => {
    expect(carrySpan(reversal, SHAPE, { start: 410, end: 450 })).toEqual({ start: 450, end: 490 });
  });

  it('closes a span a deletion swallowed to nothing', () => {
    expect(carrySpan(deletion, SHAPE, { start: 120, end: 180 })).toEqual({ start: 100, end: 100 });
  });
});

describe('resolving a position stated at a basis', () => {
  const asset = assetOf('edited', 1_000, [deletion, insertion, reversal]);

  it('carries a position through only the edits made after it was placed', () => {
    const resolver = anchorResolver(asset);
    expect(resolver.position(0, 250, Affinity.After)).toBe(150);
    expect(resolver.position(1, 250, Affinity.After)).toBe(250);
    expect(resolver.position(3, 250, Affinity.After)).toBe(250);
  });

  it('refuses a basis the chain does not have', () => {
    const resolver = anchorResolver(asset);
    expect(resolver.position(4, 0, Affinity.After)).toBeUndefined();
    expect(resolver.position(-1, 0, Affinity.After)).toBeUndefined();
    expect(resolver.span(1.5, { start: 0, end: 1 })).toBeUndefined();
  });

  it('measures an insertion at another rate by its converted length', () => {
    const source = assetOf('at-44', 441, [], StandardLayouts.stereo, OTHER_RATE);
    const payload = expectSuccess(slicePlan(assetPlan(source), 0, 441));
    const converted = assetOf('converted', 1_000, [{ ...insertion, payload, convertRate: true }]);
    expect(anchorResolver(converted).position(0, 500, Affinity.After)).toBe(980);
  });
});
