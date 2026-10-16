/**
 * A loop's crossfade in its region's plan against the domain's oracle
 * (ADR-0103), over random regions of random edited assets, each with a loop
 * placed at a random point of its asset's history, so later edits move it and
 * its crossfade is shortened to fit, and with or without a stateful rack.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { ProcessingAcrossLoop, type Region } from '../project/timeline.js';
import { derivedSampleCount, sampleRate } from '../time/sample-time.js';
import type { OracleWorld, Samples } from '../testing/edit-oracle.js';
import { editingEntities } from '../testing/editing-fixtures.js';
import { loopCrossfaded } from '../testing/loop-oracle.js';
import { TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE } from '../testing/test-processors.js';
import { expectSuccess } from '../testing/unwrap.js';
import { anchorResolver } from './anchors.js';
import { shapesOf } from './edit-shape.js';
import { FadeShape } from './fades.js';
import { validateOperation } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { placeRegion, regionPlan } from './placement.js';
import { validateRegion } from './placement-validation.js';
import type { PlanContext } from './plan-context.js';
import { validatePlan } from './plan-validation.js';

/** A small, seeded generator, so each run is the same run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const RACK = unsafeBrandId<'EffectChainId'>('33333333-loop-rack');
const CONTEXT: PlanContext = {
  chains: new Map<EffectChainId, EffectChain>([[RACK, { id: RACK, slots: [] }]]),
  takeStacks: new Map(),
  assets: new Map(),
  catalogue: TEST_CATALOGUE,
  engine: TEST_ENGINE,
};

/** A recursive filter, so what it makes of a frame depends on where its run began. */
const WORLD: OracleWorld = {
  chain: (_, samples) =>
    samples.map((channel) => {
      let last = 0;
      return channel.map((sample) => (last = Math.fround(sample * 0.5 + last * 0.5)));
    }),
};

const SHAPES = Object.values(FadeShape);
const LAYOUTS: readonly ChannelLayout[] = [StandardLayouts.mono, StandardLayouts.stereo];

function whole(next: () => number, below: number): number {
  return Math.floor(next() * below);
}

/** A span `[start, end)` of at least `least` frames inside `length`, or `undefined`. */
function spanIn(next: () => number, length: number, least: number) {
  if (length < least) return undefined;
  const start = whole(next, length - least + 1);
  return { start, end: start + least + whole(next, length - start - least + 1) };
}

/** One random edit that moves or changes audio, over a timeline of `length`. */
function editOf(next: () => number, length: number, index: number): EditOperation {
  const id = unsafeBrandId<'EditOperationId'>(`0000${index.toString(16).padStart(4, '0')}-loop`);
  const span = spanIn(next, length, 1) ?? { start: 0, end: 1 };
  const range = { start: derivedSampleCount(span.start), end: derivedSampleCount(span.end) };
  const pick = next();
  if (pick < 0.4) return { id, kind: 'delete', range };
  if (pick < 0.7) return { id, kind: 'reverse', range };
  return { id, kind: 'process', range, edit: { kind: 'gain', gain: Math.fround(next() * 2) } };
}

/** A random asset with a few edits, and its source's samples. */
function editedAsset(next: () => number, seed: number): { asset: Asset; samples: Samples } {
  const layout = LAYOUTS[whole(next, LAYOUTS.length)] ?? StandardLayouts.mono;
  const length = 80 + whole(next, 240);
  const id = unsafeBrandId<'AssetId'>(`00000000-loop-${seed.toString(16).padStart(6, '0')}`);
  let asset: Asset = {
    id,
    displayName: 'Source',
    origin: AssetOrigin.Imported,
    sampleRate: expectSuccess(sampleRate(48_000)),
    channelLayout: layout,
    length: derivedSampleCount(length),
    storageKey: `content:${id}`,
    edits: [],
  };
  for (let index = whole(next, 4); index > 0; index -= 1) {
    const shape = shapesOf(asset).at(-1);
    if (shape === undefined || shape.length < 40) break;
    const edit = editOf(next, shape.length, asset.edits.length);
    expectSuccess(validateOperation(edit, shape, editingEntities(new Map([[id, asset]]))));
    asset = { ...asset, edits: [...asset.edits, edit] };
  }
  return {
    asset,
    samples: layout.roles.map(() =>
      Float32Array.from({ length }, () => Math.fround(next() * 2 - 1)),
    ),
  };
}

/** A random region of `asset` with a loop, each placed at a random point of its history, or `undefined`. */
function loopingRegion(next: () => number, asset: Asset): Region | undefined {
  const shapes = shapesOf(asset);
  const basis = whole(next, shapes.length);
  const loopBasis = whole(next, shapes.length);
  const span = spanIn(next, shapes[basis]?.length ?? 0, 4);
  const loop = spanIn(next, shapes[loopBasis]?.length ?? 0, 1);
  if (span === undefined || loop === undefined) return undefined;
  return {
    id: unsafeBrandId<'RegionId'>('0000eeee-loop'),
    assetId: asset.id,
    displayName: 'Loop',
    basis,
    start: derivedSampleCount(span.start),
    end: derivedSampleCount(span.end),
    loop: {
      basis: loopBasis,
      start: derivedSampleCount(loop.start),
      end: derivedSampleCount(loop.end),
      crossfadeLength: derivedSampleCount(Math.min(whole(next, 48), loop.end - loop.start)),
      crossfadeShape: SHAPES[whole(next, SHAPES.length)] ?? FadeShape.Linear,
      processingAcrossLoop: ProcessingAcrossLoop.Wrapped,
    },
    tags: [],
    operations: [],
    ...(next() < 0.5 ? { rack: RACK } : {}),
  };
}

describe('a loop’s crossfade in its region’s plan, against the oracle', () => {
  it('sounds as the oracle crossfades the region without it, wherever later edits moved the loop', () => {
    let crossed = 0;
    let shortened = 0;
    for (let run = 0; run < 400; run += 1) {
      const next = random(run + 1);
      const { asset, samples } = editedAsset(next, run);
      const region = loopingRegion(next, asset);
      if (region === undefined) continue;
      expectSuccess(validateRegion(asset, region, CONTEXT.chains));
      const resolver = anchorResolver(asset);
      const placed = placeRegion(resolver, region);
      const sources = new Map([[asset.id, samples]]);

      const plan = expectSuccess(regionPlan(asset, region, CONTEXT, resolver));
      const without = expectSuccess(
        regionPlan(asset, region, CONTEXT, resolver, { loopCrossfade: false }),
      );

      const loop = placed?.loop;
      const plain = renderPlan(without, sources, WORLD);
      const expected = loop === undefined ? plain : loopCrossfaded(plain, loop);
      expect(renderPlan(plan, sources, WORLD), `run ${String(run)}`).toEqual(expected);
      if ((placed?.length ?? 0) > 0) {
        expectSuccess(validatePlan(plan, new Map([[asset.id, asset]])));
      }
      if (loop === undefined) continue;
      const kept = region.loop?.crossfadeLength ?? 0;
      expect(loop.crossfadeLength).toBeLessThanOrEqual(
        Math.min(kept, loop.loopStart, loop.loopEnd - loop.loopStart),
      );
      expect(loop.crossfadeClampedFrom, `run ${String(run)}`).toBe(
        loop.crossfadeLength < kept ? kept : undefined,
      );
      if (loop.crossfadeLength > 0) crossed += 1;
      if (loop.crossfadeClampedFrom !== undefined) shortened += 1;
    }
    // The runs cover both a crossfade heard and one shortened to fit.
    expect(crossed).toBeGreaterThan(50);
    expect(shortened).toBeGreaterThan(50);
  });
});
