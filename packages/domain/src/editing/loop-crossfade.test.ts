import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import { instantiateProcessor, type EffectChain } from '../processing/effect-chain.js';
import type { Asset } from '../project/asset.js';
import { ProcessingAcrossLoop, type AnchoredLoop, type Region } from '../project/timeline.js';
import type { OracleWorld, Samples } from '../testing/edit-oracle.js';
import { assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { loopCrossfaded, rackedFromStart, rackedWrapped } from '../testing/loop-oracle.js';
import { PLAN_WITHOUT_CHAINS, TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE, TEST_FILTER } from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { anchorResolver } from './anchors.js';
import { FadeShape } from './fades.js';
import { withLoopCrossfade } from './loop-crossfade.js';
import { bypassedRegionPlan, placeRegion, regionPlan } from './placement.js';
import { validateLoopLead, validateRegion } from './placement-validation.js';
import type { PlanContext } from './plan-context.js';
import { validatePlan } from './plan-validation.js';

const asset = assetOf('drone', 400, [], StandardLayouts.mono);

/** A ramp, every frame its own value, so a frame read from the wrong place shows. */
const RAMP: Samples = [Float32Array.from({ length: 400 }, (_, frame) => Math.fround(frame / 512))];
const SOURCES = new Map([[asset.id, RAMP]]);

function loopOf(
  start: number,
  end: number,
  crossfade: number,
  shape: FadeShape,
  processingAcrossLoop: ProcessingAcrossLoop = ProcessingAcrossLoop.Wrapped,
): AnchoredLoop {
  return {
    basis: 0,
    start: frames(start),
    end: frames(end),
    crossfadeLength: frames(crossfade),
    crossfadeShape: shape,
    processingAcrossLoop,
  };
}

const RACK = unsafeBrandId<'EffectChainId'>('33333333-rack');

/** A context whose one chain, the region's rack, runs a filter of 64 frames' lead-in. */
const RACKED: PlanContext = {
  chains: new Map<EffectChainId, EffectChain>([
    [
      RACK,
      {
        id: RACK,
        slots: [instantiateProcessor(unsafeBrandId<'ProcessorId'>('44444444-filter'), TEST_FILTER)],
      },
    ],
  ]),
  takeStacks: new Map(),
  assets: new Map(),
  catalogue: TEST_CATALOGUE,
  engine: TEST_ENGINE,
};

/** A running sum: every frame it makes carries all it heard before, and it never settles. */
const RUNNING_SUM = (samples: Samples): Samples =>
  samples.map((channel) => {
    let sum = 0;
    return channel.map((sample) => (sum = Math.fround(sum + sample)));
  });

const SUMMING: OracleWorld = { chain: (_, samples) => RUNNING_SUM(samples) };

function regionWith(start: number, end: number, loop: AnchoredLoop | undefined): Region {
  return {
    id: unsafeBrandId<'RegionId'>('0000cccc-loop'),
    assetId: asset.id,
    displayName: 'Loop',
    basis: 0,
    start: frames(start),
    end: frames(end),
    ...(loop === undefined ? {} : { loop }),
    tags: [],
    operations: [],
  };
}

function rendered(region: Region, context: PlanContext = PLAN_WITHOUT_CHAINS, world?: OracleWorld) {
  return renderPlan(expectSuccess(regionPlan(asset, region, context)), SOURCES, world);
}

function plain(region: Region, context: PlanContext = PLAN_WITHOUT_CHAINS, world?: OracleWorld) {
  const plan = regionPlan(asset, region, context, anchorResolver(asset), { loopCrossfade: false });
  return renderPlan(expectSuccess(plan), SOURCES, world);
}

function placedLoop(region: Region) {
  const loop = placeRegion(anchorResolver(asset), region)?.loop;
  if (loop === undefined) throw new Error('The region loops.');
  return loop;
}

describe('a loop’s crossfade in its region’s plan', () => {
  it('fades the loop’s end into the audio before its start, and the audio after its start into its own after it', () => {
    for (const shape of Object.values(FadeShape)) {
      const region = regionWith(50, 350, loopOf(150, 250, 20, shape));

      const heard = rendered(region);

      expect(heard).toEqual(loopCrossfaded(plain(region), placedLoop(region)));
      const ramp = (frame: number) => Math.fround((50 + frame) / 512);
      // The last frame of the loop is all the frame before its start, so the
      // jump back to the start continues it; the frame after the loop's end
      // is all the frame at its start, so a playthrough continues it too.
      expect(heard[0]?.[199]).toBe(ramp(99));
      expect(heard[0]?.[200]).toBe(ramp(100));
      expect(heard[0]?.[180]).toBe(ramp(180));
      expect(heard[0]?.[219]).toBe(ramp(219));
      expect(heard[0]?.slice(220)).toEqual(Float32Array.from(RAMP[0]?.slice(270, 350) ?? []));
    }
  });

  it('has no join after a loop that ends with its region', () => {
    const region = regionWith(50, 350, loopOf(150, 350, 30, FadeShape.EqualPower));

    const plan = expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS));

    expect(plan.streams).toHaveLength(3);
    expect(renderPlan(plan, SOURCES)).toEqual(loopCrossfaded(plain(region), placedLoop(region)));
  });

  it('leaves a region whose loop has no crossfade, and the plan asked for without one, as they were', () => {
    const hard = regionWith(50, 350, loopOf(150, 250, 0, FadeShape.Linear));
    const faded = regionWith(50, 350, loopOf(150, 250, 20, FadeShape.Linear));
    const unlooped = regionWith(50, 350, undefined);

    expect(rendered(hard)).toEqual(rendered(unlooped));
    expect(plain(faded)).toEqual(rendered(unlooped));
    expect(plain(faded)).not.toEqual(rendered(faded));
  });

  it('makes a plan every reader takes', () => {
    const region = regionWith(50, 350, loopOf(150, 250, 20, FadeShape.SCurve));
    const plan = expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS));

    expectSuccess(validatePlan(plan, new Map([[asset.id, asset]])));
    expect(withLoopCrossfade(plan, { ...placedLoop(region), crossfadeLength: frames(0) })).toBe(
      plan,
    );
  });

  it('crosses what the region’s rack made, read from the region’s start, for a loop that renders so', () => {
    const loop = loopOf(150, 250, 20, FadeShape.Linear, ProcessingAcrossLoop.FromStart);
    const region = { ...regionWith(50, 350, loop), rack: RACK };

    const heard = rendered(region, RACKED, SUMMING);

    expect(heard).toEqual(loopCrossfaded(plain(region, RACKED, SUMMING), placedLoop(region)));
    expect(plain(region, RACKED, SUMMING)).toEqual(
      rackedFromStart(RAMP, { start: 50, end: 350 }, { region: RUNNING_SUM }),
    );
  });

  it('crosses what the region’s rack made wrapped across the loop, its intro spliced into the warm-up', () => {
    const region = { ...regionWith(50, 350, loopOf(150, 250, 20, FadeShape.Linear)), rack: RACK };

    const heard = rendered(region, RACKED, SUMMING);

    // The filter's 64 frames of lead-in are covered by one cycle of the
    // 100-frame body, and the splice takes the crossfade's 20 frames.
    const wrapped = rackedWrapped(
      RAMP,
      { start: 50, end: 350 },
      { region: RUNNING_SUM },
      placedLoop(region),
      1,
      20,
    );
    expect(plain(region, RACKED, SUMMING)).toEqual(wrapped);
    expect(heard).toEqual(loopCrossfaded(wrapped, placedLoop(region)));
    // From the loop's start to its crossfade, the region is the run over the
    // body once and then the region from the loop's start, read after the
    // body.
    const ramp = RAMP[0] ?? new Float32Array(0);
    const input = [...ramp.slice(150, 250), ...ramp.slice(150, 350)];
    const run = RUNNING_SUM([Float32Array.from(input)])[0] ?? new Float32Array(0);
    expect(heard[0]?.slice(100, 180)).toEqual(run.slice(100, 180));
  });

  it('renders a loop with nothing upstream that processes the same either way', () => {
    const empty: PlanContext = {
      ...RACKED,
      chains: new Map([[RACK, { id: RACK, slots: [] }]]),
    };
    for (const context of [PLAN_WITHOUT_CHAINS, empty]) {
      const rack = context === empty ? { rack: RACK } : {};
      const wrapped = { ...regionWith(50, 350, loopOf(150, 250, 20, FadeShape.Linear)), ...rack };
      const fromStart = {
        ...regionWith(
          50,
          350,
          loopOf(150, 250, 20, FadeShape.Linear, ProcessingAcrossLoop.FromStart),
        ),
        ...rack,
      };

      expect(expectSuccess(regionPlan(asset, wrapped, context))).toEqual(
        expectSuccess(regionPlan(asset, fromStart, context)),
      );
      expect(rendered(wrapped, context, SUMMING)).toEqual(rendered(fromStart, context, SUMMING));
    }
  });

  it('is kept when every chain is bypassed, since it is no chain', () => {
    const region = regionWith(50, 350, loopOf(150, 250, 20, FadeShape.EqualPower));

    const bypassed = renderPlan(
      expectSuccess(bypassedRegionPlan(asset, region, PLAN_WITHOUT_CHAINS)),
      SOURCES,
    );

    expect(bypassed).toEqual(rendered(region));
  });

  it('is shortened to the audio left before the loop’s start when an edit moves it', () => {
    // Cutting 80 frames before the loop leaves 20 of the region before its start.
    const cut: Asset = {
      ...asset,
      edits: [{ id: operationId('cut'), kind: 'delete', range: range(60, 140) }],
    };
    const region = regionWith(50, 350, loopOf(150, 250, 30, FadeShape.Linear));
    const resolver = anchorResolver(cut);

    const loop = placeRegion(resolver, region)?.loop;
    const plan = expectSuccess(regionPlan(cut, region, PLAN_WITHOUT_CHAINS, resolver));

    expect(loop?.crossfadeLength).toBe(20);
    expect(loop?.crossfadeClampedFrom).toBe(30);
    expectSuccess(validatePlan(plan, new Map([[asset.id, asset]])));
  });
});

describe('a loop’s crossfade made by a command', () => {
  it('needs as many frames of the region before the loop’s start as it crosses', () => {
    const fits = regionWith(100, 350, loopOf(150, 250, 50, FadeShape.Linear));
    const longer = regionWith(100, 350, loopOf(150, 250, 51, FadeShape.Linear));

    expectSuccess(validateLoopLead(asset, fits));
    expectSuccess(validateRegion(asset, longer, PLAN_WITHOUT_CHAINS.chains));
    expect(expectFailureCode(validateLoopLead(asset, longer))).toBe(
      'editing.loop-crossfade-without-lead',
    );
  });
});
