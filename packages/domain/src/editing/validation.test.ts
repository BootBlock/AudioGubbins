import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import type { Marker, Region } from '../project/timeline.js';
import { OTHER_RATE, assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { sourceShape } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation, RegionOperation } from './operations.js';
import { validateMarker, validateRegion } from './placement-validation.js';
import { assetPlan } from './plan-building.js';
import { validatePlan } from './plan-validation.js';
import { slicePlan } from './plan-slicing.js';
import type { EditPlan } from './plan.js';

const ASSET = assetOf('source', 1_000);
const ASSETS = new Map([[ASSET.id, ASSET]]);
const SHAPE = sourceShape(ASSET);
const id = operationId('one');

function refusedFor(operation: EditOperation): string {
  const result = validateOperation(operation, SHAPE, ASSETS);
  if (result.ok) throw new Error('Expected a refusal.');
  return result.failures[0].summary;
}

describe('validating an edit operation where it stands', () => {
  it('accepts an operation that lies within the audio', () => {
    expectSuccess(validateOperation({ id, kind: 'delete', range: range(0, 1_000) }, SHAPE, ASSETS));
  });

  it('refuses a range past the audio, an empty one and one between frames', () => {
    expect(refusedFor({ id, kind: 'delete', range: range(900, 1_001) })).toMatch(/past the audio/);
    expect(refusedFor({ id, kind: 'reverse', range: range(10, 10) })).toMatch(/covers no audio/);
    expect(refusedFor({ id, kind: 'trim', range: range(0.5, 10) })).toMatch(/whole number/);
  });

  it('refuses a channel scope on a change between channels, and channels the audio lacks', () => {
    const swap = { kind: 'swap-channels', first: 0, second: 1 } as const;
    expect(
      refusedFor({ id, kind: 'process', range: range(0, 10), channels: [0], edit: swap }),
    ).toMatch(/names its own channels/);
    expect(
      refusedFor({
        id,
        kind: 'process',
        range: range(0, 10),
        channels: [2],
        edit: { kind: 'silence' },
      }),
    ).toMatch(/not channels of this audio/);
    expect(
      refusedFor({
        id,
        kind: 'process',
        range: range(0, 10),
        edit: { kind: 'swap-channels', first: 1, second: 1 },
      }),
    ).toMatch(/two different channels/);
  });

  it('refuses a gain below zero or past sixty decibels', () => {
    expect(
      refusedFor({ id, kind: 'process', range: range(0, 10), edit: { kind: 'gain', gain: -1 } }),
    ).toMatch(/gain/);
    expect(
      refusedFor({ id, kind: 'process', range: range(0, 10), edit: { kind: 'gain', gain: 1_001 } }),
    ).toMatch(/gain/);
  });

  it('refuses a conversion whose matrix does not take these channels to the new layout', () => {
    expect(
      refusedFor({
        id,
        kind: 'convert-layout',
        layout: StandardLayouts.mono,
        matrix: [[0.5, 0.5, 0]],
      }),
    ).toMatch(/does not take/);
  });

  it('refuses a paste at another rate unless converting it was asked for, and converting at the same rate', () => {
    const other = assetOf('other', 441, [], StandardLayouts.stereo, OTHER_RATE);
    const assets = new Map([...ASSETS, [other.id, other]]);
    const payload = expectSuccess(slicePlan(assetPlan(other), 0, 441));
    const paste = { id, kind: 'insert', at: frames(0), payload, convertRate: false } as const;
    expect(expectFailureCode(validateOperation(paste, SHAPE, assets))).toBe('editing.payload-rate');
    expectSuccess(validateOperation({ ...paste, convertRate: true }, SHAPE, assets));
    const same = expectSuccess(slicePlan(assetPlan(ASSET), 0, 10));
    expect(
      expectFailureCode(
        validateOperation({ ...paste, payload: same, convertRate: true }, SHAPE, ASSETS),
      ),
    ).toBe('editing.payload-rate');
  });

  it('refuses a paste with other channels than the audio has', () => {
    const payload = expectSuccess(slicePlan(assetPlan(ASSET), 0, 10, [0]));
    expect(
      expectFailureCode(
        validateOperation(
          { id, kind: 'insert', at: frames(0), payload, convertRate: false },
          SHAPE,
          ASSETS,
        ),
      ),
    ).toBe('editing.payload-layout');
  });

  it('refuses a chain with two operations of one identifier', () => {
    const twice = assetOf('twice', 100, [
      { id, kind: 'reverse', range: range(0, 10) },
      { id, kind: 'reverse', range: range(0, 10) },
    ]);
    expect(expectFailureCode(validateChain(twice, ASSETS))).toBe('editing.duplicate-operation');
  });

  it('checks each operation against the timeline the ones before it left', () => {
    const shortened = assetOf('short', 100, [
      { id: operationId('cut'), kind: 'delete', range: range(0, 50) },
      { id, kind: 'reverse', range: range(40, 60) },
    ]);
    expect(expectFailureCode(validateChain(shortened, ASSETS))).toBe('editing.operation-invalid');
  });
});

describe('validating a plan read from a paste', () => {
  const plan = assetPlan(ASSET);

  it('accepts an asset’s own plan', () => {
    expectSuccess(validatePlan(plan, ASSETS));
  });

  it('refuses a segment reading past its source, or an asset the project lacks', () => {
    const [stream] = plan.streams;
    const past: EditPlan = {
      streams: [
        { ...stream, segments: stream.segments.map((s) => ({ ...s, length: frames(1_001) })) },
      ],
    };
    expect(expectFailureCode(validatePlan(past, ASSETS))).toBe('editing.plan-malformed');
    expect(expectFailureCode(validatePlan(plan, new Map()))).toBe('editing.plan-malformed');
  });

  it('refuses a segment that reads a stream before its own, so no plan can loop', () => {
    const [stream] = plan.streams;
    const looping: EditPlan = {
      streams: [
        stream,
        {
          ...stream,
          segments: [
            {
              source: { kind: 'stream', stream: 0 },
              start: frames(0),
              length: frames(1),
              reversed: false,
              stages: [],
            },
          ],
        },
      ],
    };
    expect(expectFailureCode(validatePlan(looping, ASSETS))).toBe('editing.plan-malformed');
  });

  it('refuses a stage that leaves other channels than its stream has', () => {
    const [stream] = plan.streams;
    const narrowed: EditPlan = {
      streams: [
        {
          ...stream,
          segments: stream.segments.map((s) => ({
            ...s,
            stages: [{ kind: 'matrix', matrix: [[1, 0]] }],
          })),
        },
      ],
    };
    expect(expectFailureCode(validatePlan(narrowed, ASSETS))).toBe('editing.plan-malformed');
  });
});

describe('validating what is placed on an asset', () => {
  const edited = assetOf('edited', 1_000, [{ id, kind: 'delete', range: range(0, 500) }]);
  const marker: Marker = {
    id: unsafeBrandId('0000cccc-marker'),
    assetId: edited.id,
    displayName: 'Hit',
    basis: 1,
    position: frames(500),
  };
  const region: Region = {
    id: unsafeBrandId('0000dddd-region'),
    assetId: edited.id,
    displayName: 'Step',
    basis: 0,
    start: frames(600),
    end: frames(900),
    tags: [],
    operations: [],
  };

  it('accepts a marker at the end of the timeline its basis names, and refuses one past it', () => {
    expectSuccess(validateMarker(edited, marker));
    expect(expectFailureCode(validateMarker(edited, { ...marker, position: frames(501) }))).toBe(
      'editing.marker-outside',
    );
    expect(expectFailureCode(validateMarker(edited, { ...marker, basis: 2 }))).toBe(
      'editing.basis-unknown',
    );
  });

  it('checks a region’s boundaries and loop against the timeline each was placed on', () => {
    expectSuccess(validateRegion(edited, region));
    expect(expectFailureCode(validateRegion(edited, { ...region, basis: 1 }))).toBe(
      'editing.region-outside',
    );
    expect(
      expectFailureCode(
        validateRegion(edited, {
          ...region,
          loop: { basis: 1, start: frames(10), end: frames(20), crossfadeLength: frames(11) },
        }),
      ),
    ).toBe('editing.loop-crossfade');
  });

  it('refuses processing that names channels from before the asset’s last layout conversion', () => {
    const converted = assetOf('converted', 1_000, [
      { id, kind: 'convert-layout', layout: StandardLayouts.mono, matrix: [[0.5, 0.5]] },
    ]);
    const scoped: RegionOperation = {
      id: operationId('scoped'),
      basis: 0,
      range: range(0, 10),
      channels: [1],
      edit: { kind: 'silence' },
    };
    expect(
      expectFailureCode(
        validateRegion(converted, {
          ...region,
          assetId: converted.id,
          start: frames(0),
          end: frames(100),
          operations: [scoped],
        }),
      ),
    ).toBe('editing.region-operation-invalid');
    expectSuccess(
      validateRegion(converted, {
        ...region,
        assetId: converted.id,
        start: frames(0),
        end: frames(100),
        operations: [{ ...scoped, basis: 1, channels: [0] }],
      }),
    );
  });
});
