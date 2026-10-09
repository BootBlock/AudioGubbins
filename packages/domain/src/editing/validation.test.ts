import { PLAN_WITHOUT_CHAINS, TEST_ENGINE } from '../testing/plan-context.js';
import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { SummingLaw } from '../processing/effect-chain.js';
import type { Marker, Region } from '../project/timeline.js';
import {
  assetOf,
  editingEntities,
  frames,
  operationId,
  OTHER_RATE,
  range,
} from '../testing/editing-fixtures.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { sourceShape } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation, RegionOperation } from './operations.js';
import { validateMarker, validateRegion } from './placement-validation.js';
import { assetPlan } from './plan-building.js';
import { MAXIMUM_STRETCH_RATIO, validatePlan } from './plan-validation.js';
import { slicePlan } from './plan-slicing.js';
import type { EditPlan, StreamProcessing } from './plan.js';

const ASSET = assetOf('source', 1_000);
const ASSETS = new Map([[ASSET.id, ASSET]]);
const SHAPE = sourceShape(ASSET);
const id = operationId('one');

function refusedFor(operation: EditOperation): string {
  const result = validateOperation(operation, SHAPE, editingEntities(ASSETS));
  if (result.ok) throw new Error('Expected a refusal.');
  return result.failures[0].summary;
}

describe('validating an edit operation where it stands', () => {
  it('accepts an operation that lies within the audio', () => {
    expectSuccess(
      validateOperation(
        { id, kind: 'delete', range: range(0, 1_000) },
        SHAPE,
        editingEntities(ASSETS),
      ),
    );
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
    const payload = expectSuccess(
      slicePlan(expectSuccess(assetPlan(other, PLAN_WITHOUT_CHAINS)), 0, 441),
    );
    const paste = { id, kind: 'insert', at: frames(0), payload } as const;
    expect(expectFailureCode(validateOperation(paste, SHAPE, editingEntities(assets)))).toBe(
      'editing.payload-rate',
    );
    expectSuccess(
      validateOperation(
        { ...paste, resampler: TEST_ENGINE.resampler },
        SHAPE,
        editingEntities(assets),
      ),
    );
    const same = expectSuccess(
      slicePlan(expectSuccess(assetPlan(ASSET, PLAN_WITHOUT_CHAINS)), 0, 10),
    );
    expect(
      expectFailureCode(
        validateOperation(
          { ...paste, payload: same, resampler: TEST_ENGINE.resampler },
          SHAPE,
          editingEntities(ASSETS),
        ),
      ),
    ).toBe('editing.payload-rate');
    for (const resampler of [0, 1.5, -1]) {
      expect(
        expectFailureCode(
          validateOperation({ ...paste, resampler }, SHAPE, editingEntities(assets)),
        ),
      ).toBe('editing.conversion-version');
    }
  });

  it('refuses a paste with other channels than the audio has', () => {
    const payload = expectSuccess(
      slicePlan(expectSuccess(assetPlan(ASSET, PLAN_WITHOUT_CHAINS)), 0, 10, [0]),
    );
    expect(
      expectFailureCode(
        validateOperation(
          { id, kind: 'insert', at: frames(0), payload },
          SHAPE,
          editingEntities(ASSETS),
        ),
      ),
    ).toBe('editing.payload-layout');
  });

  it('accepts a stretch up to the bound either way and refuses one past it, or of no whole length', () => {
    const stretchTo = (length: number): EditOperation => ({
      id,
      kind: 'stretch',
      range: range(100, 200),
      length: frames(length),
      version: TEST_ENGINE.stretch,
    });
    expect(MAXIMUM_STRETCH_RATIO).toBe(8);
    for (const length of [13, 100, 800]) {
      expectSuccess(validateOperation(stretchTo(length), SHAPE, editingEntities(ASSETS)));
    }
    expect(refusedFor(stretchTo(801))).toMatch(/at most 8 times/);
    expect(refusedFor(stretchTo(12))).toMatch(/at most 8 times/);
    expect(refusedFor(stretchTo(0))).toMatch(/whole number of frames/);
    expect(refusedFor(stretchTo(50.5))).toMatch(/whole number of frames/);
    expect(
      refusedFor({
        id,
        kind: 'stretch',
        range: range(900, 1_001),
        length: frames(100),
        version: TEST_ENGINE.stretch,
      }),
    ).toMatch(/past the audio/);
  });

  it('refuses a conversion to the rate the audio already has, or to no rate audio can have', () => {
    expectSuccess(
      validateOperation(
        { id, kind: 'convert-rate', sampleRate: OTHER_RATE, version: TEST_ENGINE.resampler },
        SHAPE,
        editingEntities(ASSETS),
      ),
    );
    expect(
      refusedFor({
        id,
        kind: 'convert-rate',
        sampleRate: SHAPE.sampleRate,
        version: TEST_ENGINE.resampler,
      }),
    ).toMatch(/already at that rate/);
    for (const rate of [0, 44_100.5, -48_000]) {
      expect(
        refusedFor({
          id,
          kind: 'convert-rate',
          sampleRate: rate as typeof OTHER_RATE,
          version: TEST_ENGINE.resampler,
        }),
      ).toMatch(/not a sample rate/);
    }
  });

  it('refuses a rack edit scoped to channels, since a chain acts on every channel, or naming a chain the project lacks', () => {
    const chainId: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');
    const chains = new Map<EffectChainId, EffectChain>([[chainId, { id: chainId, slots: [] }]]);
    const rack = { kind: 'rack', chain: chainId } as const;
    expectSuccess(
      validateOperation(
        { id, kind: 'process', range: range(0, 10), edit: rack },
        SHAPE,
        editingEntities(ASSETS, chains),
      ),
    );
    const scoped = validateOperation(
      { id, kind: 'process', range: range(0, 10), channels: [0], edit: rack },
      SHAPE,
      editingEntities(ASSETS, chains),
    );
    expect(scoped.ok ? '' : scoped.failures[0].summary).toMatch(/acts on every channel/);
    expect(refusedFor({ id, kind: 'process', range: range(0, 10), edit: rack })).toMatch(
      /chain the project does not have/,
    );
  });

  it('refuses a chain with two operations of one identifier', () => {
    const twice = assetOf('twice', 100, [
      { id, kind: 'reverse', range: range(0, 10) },
      { id, kind: 'reverse', range: range(0, 10) },
    ]);
    expect(expectFailureCode(validateChain(twice, editingEntities(ASSETS)))).toBe(
      'editing.duplicate-operation',
    );
  });

  it('checks each operation against the timeline the ones before it left', () => {
    const shortened = assetOf('short', 100, [
      { id: operationId('cut'), kind: 'delete', range: range(0, 50) },
      { id, kind: 'reverse', range: range(40, 60) },
    ]);
    expect(expectFailureCode(validateChain(shortened, editingEntities(ASSETS)))).toBe(
      'editing.operation-invalid',
    );
  });
});

describe('validating a plan read from a paste', () => {
  const plan = expectSuccess(assetPlan(ASSET, PLAN_WITHOUT_CHAINS));

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

describe('validating a plan’s stream processing', () => {
  const [base] = expectSuccess(assetPlan(ASSET, PLAN_WITHOUT_CHAINS)).streams;

  /** A plan whose first stream reads ten frames of a second stream processed by `processing`. */
  function readingProcessed(processing: StreamProcessing): EditPlan {
    return {
      streams: [
        {
          ...base,
          segments: [
            {
              source: { kind: 'stream', stream: 1 },
              start: frames(0),
              length: frames(10),
              reversed: false,
              stages: [],
            },
          ],
        },
        { ...base, processing },
      ],
    };
  }

  const stretched = (length: number): StreamProcessing => ({
    kind: 'stretch',
    length: frames(length),
  });

  it('refuses processing on the first stream, which only a stream it reads may hold', () => {
    expectSuccess(validatePlan(readingProcessed(stretched(1_000)), ASSETS));
    const first: EditPlan = { streams: [{ ...base, processing: stretched(1_000) }] };
    expect(expectFailureCode(validatePlan(first, ASSETS))).toBe('editing.plan-malformed');
  });

  it('refuses a stretched stream past the bound either way, against its segments’ length of 1 000', () => {
    expectSuccess(validatePlan(readingProcessed(stretched(125)), ASSETS));
    expectSuccess(validatePlan(readingProcessed(stretched(8_000)), ASSETS));
    for (const length of [0, 124, 8_001]) {
      expect(expectFailureCode(validatePlan(readingProcessed(stretched(length)), ASSETS))).toBe(
        'editing.plan-malformed',
      );
    }
  });

  it('refuses a stream whose chain is malformed, so no worker runs a chain of the wrong shape', () => {
    const chainId: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');
    const processed = (chain: EffectChain): StreamProcessing => ({
      kind: 'chain',
      chain,
      input: StandardLayouts.stereo,
    });
    expectSuccess(validatePlan(readingProcessed(processed({ id: chainId, slots: [] })), ASSETS));
    const branchless: EffectChain = {
      id: chainId,
      slots: [
        {
          kind: 'group',
          id: unsafeBrandId<'ProcessorGroupId'>('44444444-aaaa'),
          enabled: true,
          soloed: false,
          mix: 1,
          summing: SummingLaw.Sum,
          branches: [],
        },
      ],
    };
    expect(expectFailureCode(validatePlan(readingProcessed(processed(branchless)), ASSETS))).toBe(
      'editing.plan-malformed',
    );
  });

  it('measures a segment reading a stretched stream against the stretched length, not its segments’', () => {
    const plan = readingProcessed(stretched(500));
    const [first, second] = plan.streams;
    const reading = (length: number): EditPlan => ({
      streams: [
        {
          ...first,
          segments: first.segments.map((segment) => ({ ...segment, length: frames(length) })),
        },
        ...(second === undefined ? [] : [second]),
      ],
    });
    expectSuccess(validatePlan(reading(500), ASSETS));
    expect(expectFailureCode(validatePlan(reading(501), ASSETS))).toBe('editing.plan-malformed');
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
    expectSuccess(validateRegion(edited, region, PLAN_WITHOUT_CHAINS.chains));
    expect(
      expectFailureCode(
        validateRegion(edited, { ...region, basis: 1 }, PLAN_WITHOUT_CHAINS.chains),
      ),
    ).toBe('editing.region-outside');
    expect(
      expectFailureCode(
        validateRegion(
          edited,
          {
            ...region,
            loop: { basis: 1, start: frames(10), end: frames(20), crossfadeLength: frames(11) },
          },
          PLAN_WITHOUT_CHAINS.chains,
        ),
      ),
    ).toBe('editing.loop-crossfade');
  });

  it('checks the channels processing names by the layout at its basis, across a later conversion', () => {
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
    const over = (operation: RegionOperation): Region => ({
      ...region,
      assetId: converted.id,
      start: frames(0),
      end: frames(100),
      operations: [operation],
    });
    expectSuccess(validateRegion(converted, over(scoped), PLAN_WITHOUT_CHAINS.chains));
    expect(
      expectFailureCode(
        validateRegion(converted, over({ ...scoped, basis: 1 }), PLAN_WITHOUT_CHAINS.chains),
      ),
    ).toBe('editing.region-operation-invalid');
    expectSuccess(
      validateRegion(
        converted,
        over({ ...scoped, basis: 1, channels: [0] }),
        PLAN_WITHOUT_CHAINS.chains,
      ),
    );
  });
});
