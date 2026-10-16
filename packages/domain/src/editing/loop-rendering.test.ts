import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import { instantiateProcessor, type EffectChain } from '../processing/effect-chain.js';
import type { ProcessorCatalogue } from '../processing/chain-validation.js';
import type { ProcessorDescriptor } from '../processing/processor-descriptor.js';
import type { Asset } from '../project/asset.js';
import { ProcessingAcrossLoop, type Region } from '../project/timeline.js';
import { expectSuccess } from '../testing/unwrap.js';
import type { Samples } from '../testing/edit-oracle.js';
import { assetOf, frames } from '../testing/editing-fixtures.js';
import { loopCrossfaded, rackedWrapped } from '../testing/loop-oracle.js';
import { TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE, TEST_FILTER } from '../testing/test-processors.js';
import { anchorResolver } from './anchors.js';
import { FadeShape } from './fades.js';
import { loopRendering, warmUpCycles } from './loop-rendering.js';
import { placeRegion, regionPlan } from './placement.js';
import type { PlanContext } from './plan-context.js';
import { validatePlan } from './plan-validation.js';

const RATE = assetOf('rate', 1, []).sampleRate;

/** A normaliser, which measures its whole input before it plays. */
const NORMALISER: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'normaliser',
  label: 'Normaliser',
  wholePass: true,
  leadIn: () => 0,
};

/** A processor whose lead-in grows with its oversampling, as a limiter's latency does. */
const OVERSAMPLED: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'oversampled',
  label: 'Oversampled',
  leadIn: ({ quality }) => 100 * quality.oversampling,
};

/** A processor with a long memory, a reverb's. */
const LONG_TAIL: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'long-tail',
  label: 'Long tail',
  leadIn: () => 100_000,
};

const CATALOGUE: ProcessorCatalogue = new Map([
  ...TEST_CATALOGUE,
  ...[NORMALISER, OVERSAMPLED, LONG_TAIL].map((one) => [one.typeKey, one] as const),
]);

function chainOf(
  name: string,
  ...descriptors: readonly ProcessorDescriptor[]
): EffectChain & { readonly id: EffectChainId } {
  return {
    id: unsafeBrandId<'EffectChainId'>(`55555555-${name}`),
    slots: descriptors.map((descriptor, index) =>
      instantiateProcessor(
        unsafeBrandId<'ProcessorId'>(`66666666-${name}-${String(index)}`),
        descriptor,
      ),
    ),
  };
}

const FILTERING = chainOf('filter', TEST_FILTER);
const MEASURING = chainOf('measuring', TEST_FILTER, NORMALISER);
const EMPTY = chainOf('empty');
const BYPASSED: EffectChain = {
  id: unsafeBrandId<'EffectChainId'>('55555555-bypassed'),
  slots: [
    {
      ...instantiateProcessor(unsafeBrandId<'ProcessorId'>('66666666-bypassed'), TEST_FILTER),
      enabled: false,
    },
  ],
};
const TAIL = chainOf('tail', LONG_TAIL);

const CONTEXT: PlanContext = {
  chains: new Map(
    [FILTERING, MEASURING, EMPTY, BYPASSED, TAIL].map((chain) => [chain.id, chain] as const),
  ),
  takeStacks: new Map(),
  assets: new Map(),
  catalogue: CATALOGUE,
  engine: TEST_ENGINE,
};

const asset = assetOf('drone', 400, [], StandardLayouts.mono);

function regionOf(
  options: {
    readonly rack?: EffectChainId;
    readonly processing?: ProcessingAcrossLoop;
    readonly loop?: readonly [number, number];
  } = {},
): Region {
  const [start, end] = options.loop ?? [150, 250];
  return {
    id: unsafeBrandId<'RegionId'>('0000dddd-loop'),
    assetId: asset.id,
    displayName: 'Loop',
    basis: 0,
    start: frames(50),
    end: frames(350),
    loop: {
      basis: 0,
      start: frames(start),
      end: frames(end),
      crossfadeLength: frames(0),
      crossfadeShape: FadeShape.EqualPower,
      processingAcrossLoop: options.processing ?? ProcessingAcrossLoop.Wrapped,
    },
    tags: [],
    operations: [],
    ...(options.rack === undefined ? {} : { rack: options.rack }),
  };
}

describe('how a loop renders its processing (ADR-0107)', () => {
  it('wraps the asset’s rack and then the region’s, each that processes', () => {
    const racked: Asset = { ...asset, rack: FILTERING.id };

    expect(loopRendering(racked, regionOf({ rack: TAIL.id }), CONTEXT)).toEqual({
      kind: 'wrapped',
      racks: [FILTERING, TAIL],
    });
    expect(loopRendering(racked, regionOf({ rack: EMPTY.id }), CONTEXT)).toEqual({
      kind: 'wrapped',
      racks: [FILTERING],
    });
  });

  it('renders from the region’s start where nothing upstream processes, whatever the loop chose', () => {
    for (const rack of [undefined, EMPTY.id, BYPASSED.id]) {
      expect(loopRendering(asset, regionOf(rack === undefined ? {} : { rack }), CONTEXT)).toEqual({
        kind: 'from-start',
        cause: { kind: 'unprocessed' },
      });
    }
  });

  it('renders from the region’s start where the loop chose it', () => {
    const region = regionOf({ rack: FILTERING.id, processing: ProcessingAcrossLoop.FromStart });

    expect(loopRendering(asset, region, CONTEXT)).toEqual({
      kind: 'from-start',
      cause: { kind: 'chosen' },
    });
  });

  it('renders from the region’s start under a processor that measures its whole input, naming it once', () => {
    const racked: Asset = { ...asset, rack: MEASURING.id };
    const region = regionOf({ rack: MEASURING.id });

    expect(loopRendering(racked, region, CONTEXT)).toEqual({
      kind: 'from-start',
      cause: { kind: 'whole-pass', processors: ['Normaliser'] },
    });
    // Its plan is the plan of a loop that chose to render so.
    const chosen = regionOf({ rack: MEASURING.id, processing: ProcessingAcrossLoop.FromStart });
    expect(expectSuccess(regionPlan(racked, region, CONTEXT))).toEqual(
      expectSuccess(regionPlan(racked, chosen, CONTEXT)),
    );
    expect(expectSuccess(regionPlan(racked, region, CONTEXT))).not.toEqual(
      expectSuccess(regionPlan(racked, regionOf({ rack: FILTERING.id }), CONTEXT)),
    );
  });

  it('is nothing for a region that does not loop', () => {
    const { loop: _none, ...unlooped } = regionOf({ rack: FILTERING.id });

    expect(loopRendering(asset, unlooped, CONTEXT)).toBeUndefined();
  });
});

describe('the cycles a wrapped loop warms up over', () => {
  it('covers the lead-ins of every rack, added, with at least one cycle', () => {
    expect(warmUpCycles([FILTERING], CATALOGUE, RATE, 100, 0)).toBe(1);
    expect(warmUpCycles([FILTERING], CATALOGUE, RATE, 64, 0)).toBe(1);
    expect(warmUpCycles([FILTERING], CATALOGUE, RATE, 63, 0)).toBe(2);
    expect(warmUpCycles([FILTERING, FILTERING], CATALOGUE, RATE, 64, 0)).toBe(2);
    expect(warmUpCycles([FILTERING, FILTERING], CATALOGUE, RATE, 10, 0)).toBe(13);
  });

  it('covers the most lead-in any quality gives, since a plan names none', () => {
    // 100 frames for each step of oversampling, up to eightfold.
    expect(warmUpCycles([chainOf('over', OVERSAMPLED)], CATALOGUE, RATE, 100, 0)).toBe(8);
  });

  it('covers the frames the splice into the loop’s start reads', () => {
    expect(warmUpCycles([FILTERING], CATALOGUE, RATE, 10, 480)).toBe(48);
    expect(warmUpCycles([FILTERING], CATALOGUE, RATE, 10, 481)).toBe(49);
  });
});

describe('a short loop under a long lead-in', () => {
  it('warms up over every cycle the lead-in needs, held by a few streams', () => {
    // A 6-frame body under 100,000 frames of lead-in: 16,667 cycles, an odd count.
    const region = regionOf({ rack: TAIL.id, loop: [150, 156] });
    const ramp: Samples = [
      Float32Array.from({ length: 400 }, (_, frame) => Math.fround(frame / 512)),
    ];
    const sum = (samples: Samples): Samples =>
      samples.map((channel) => {
        let total = 0;
        return channel.map((sample) => (total = Math.fround(total * 0.999 + sample)));
      });

    const plan = expectSuccess(regionPlan(asset, region, CONTEXT));

    expectSuccess(validatePlan(plan, new Map([[asset.id, asset]])));
    // Two readings of each power of two up to 2^15, not a segment a cycle.
    expect(plan.streams.length).toBeLessThan(30);
    expect(plan.streams.reduce((total, stream) => total + stream.segments.length, 0)).toBeLessThan(
      80,
    );
    const loop = placeRegion(anchorResolver(asset), region)?.loop;
    if (loop === undefined) throw new Error('The region loops.');
    expect(
      renderPlan(plan, new Map([[asset.id, ramp]]), { chain: (_, samples) => sum(samples) }),
    ).toEqual(
      loopCrossfaded(
        rackedWrapped(ramp, { start: 50, end: 350 }, { region: sum }, loop, 16_667, 100),
        loop,
      ),
    );
  });
});
