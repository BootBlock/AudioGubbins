/**
 * A looping region's plan against the domain's oracle (ADR-0103, ADR-0107),
 * over random regions of random edited assets, each with a loop placed at a
 * random point of its asset's history, so later edits move it and its
 * crossfade is shortened to fit; with or without a stateful rack on the asset
 * and on the region, each processing or applying nothing; and with the loop
 * rendering its processing wrapped or from the region's start.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import { instantiateProcessor, type EffectChain } from '../processing/effect-chain.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { ProcessingAcrossLoop, type LoopDefinition, type Region } from '../project/timeline.js';
import { derivedSampleCount, sampleRate } from '../time/sample-time.js';
import { applyEdit, type OracleWorld, type Samples } from '../testing/edit-oracle.js';
import { editingEntities } from '../testing/editing-fixtures.js';
import {
  loopCrossfaded,
  rackedFromStart,
  rackedWrapped,
  type LoopRacks,
} from '../testing/loop-oracle.js';
import { TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE, TEST_FILTER } from '../testing/test-processors.js';
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

/** A filter whose lead-in the plan reads: `TEST_FILTER`'s 64 frames. */
const FILTER = instantiateProcessor(
  unsafeBrandId<'ProcessorId'>('44444444-loop-filter'),
  TEST_FILTER,
);
const LEAD_IN = 64;

/** For each place a rack may be, one that processes and one that applies nothing. */
const RACKS = {
  asset: {
    processing: unsafeBrandId<'EffectChainId'>('33333333-asset-filter'),
    empty: unsafeBrandId<'EffectChainId'>('33333333-asset-empty'),
  },
  region: {
    processing: unsafeBrandId<'EffectChainId'>('33333333-region-filter'),
    empty: unsafeBrandId<'EffectChainId'>('33333333-region-empty'),
  },
} as const;

type RackPlace = (typeof RACKS)[keyof typeof RACKS];

const CONTEXT: PlanContext = {
  chains: new Map<EffectChainId, EffectChain>(
    [RACKS.asset, RACKS.region].flatMap((place) => [
      [place.processing, { id: place.processing, slots: [FILTER] }] as const,
      [place.empty, { id: place.empty, slots: [] }] as const,
    ]),
  ),
  takeStacks: new Map(),
  assets: new Map(),
  catalogue: TEST_CATALOGUE,
  engine: TEST_ENGINE,
};

/**
 * A recursive filter, so what it makes of a frame depends on where its run
 * began and on every cycle of a loop it has heard: it never settles, so a
 * wrong count of warm-up cycles shows.
 */
function recursive(weight: number): (samples: Samples) => Samples {
  return (samples) =>
    samples.map((channel) => {
      let last = 0;
      return channel.map((sample) => (last = Math.fround(sample * weight + last * (1 - weight))));
    });
}

const passed = (samples: Samples): Samples => samples;

/** What each rack does: the asset's filter and the region's differ, so their order shows. */
const DOES = new Map<EffectChainId, (samples: Samples) => Samples>([
  [RACKS.asset.processing, recursive(0.5)],
  [RACKS.region.processing, recursive(0.25)],
  [RACKS.asset.empty, passed],
  [RACKS.region.empty, passed],
]);

const WORLD: OracleWorld = {
  chain: (id, samples) => {
    const does = DOES.get(id);
    if (does === undefined) throw new Error(`No rack ${id}.`);
    return does(samples);
  },
};

const SHAPES = Object.values(FadeShape);
const PROCESSINGS = Object.values(ProcessingAcrossLoop);
const LAYOUTS: readonly ChannelLayout[] = [StandardLayouts.mono, StandardLayouts.stereo];

function whole(next: () => number, below: number): number {
  return Math.floor(next() * below);
}

/** A rack for `place`, or none, at random. */
function rackOf(next: () => number, place: RackPlace): { readonly rack?: EffectChainId } {
  const pick = whole(next, 3);
  return pick === 0 ? {} : { rack: pick === 1 ? place.empty : place.processing };
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

/** A random asset with a few edits and perhaps a rack, and its source's samples. */
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
    ...rackOf(next, RACKS.asset),
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
  // A loop at its region's start a sixth of the time, which has no intro.
  const atStart = next() < 1 / 6 && span !== undefined;
  const loop = atStart
    ? { start: span.start, end: span.start + 1 + whole(next, span.end - span.start) }
    : spanIn(next, shapes[loopBasis]?.length ?? 0, 1);
  if (span === undefined || loop === undefined) return undefined;
  return {
    id: unsafeBrandId<'RegionId'>('0000eeee-loop'),
    assetId: asset.id,
    displayName: 'Loop',
    basis,
    start: derivedSampleCount(span.start),
    end: derivedSampleCount(span.end),
    loop: {
      basis: atStart ? basis : loopBasis,
      start: derivedSampleCount(loop.start),
      end: derivedSampleCount(loop.end),
      crossfadeLength: derivedSampleCount(Math.min(whole(next, 48), loop.end - loop.start)),
      crossfadeShape: SHAPES[whole(next, SHAPES.length)] ?? FadeShape.Linear,
      processingAcrossLoop:
        PROCESSINGS[whole(next, PROCESSINGS.length)] ?? ProcessingAcrossLoop.Wrapped,
    },
    tags: [],
    operations: [],
    ...rackOf(next, RACKS.region),
  };
}

/** Whether `rack` runs a processor. */
function processes(rack: EffectChainId | undefined): boolean {
  return rack === RACKS.asset.processing || rack === RACKS.region.processing;
}

/** What `asset`'s rack and `region`'s do, as the oracle runs them. */
function racksOf(asset: Asset, region: Region): LoopRacks {
  const assetRack = asset.rack === undefined ? undefined : DOES.get(asset.rack);
  const regionRack = region.rack === undefined ? undefined : DOES.get(region.rack);
  return {
    ...(assetRack === undefined ? {} : { asset: assetRack }),
    ...(regionRack === undefined ? {} : { region: regionRack }),
  };
}

/**
 * The region's sound before its crossfade, by the oracle: wrapped where its
 * loop chooses it and a rack upstream processes, from the region's start
 * otherwise. The warm-up is the fewest whole cycles that cover the filters'
 * lead-ins, added, and the splice; the splice is the crossfade where there is
 * one and 10 ms otherwise (480 frames here), never more than the intro.
 */
function expectedBeforeCrossfade(
  asset: Asset,
  region: Region,
  edited: Samples,
  span: { readonly start: number; readonly end: number },
  loop: LoopDefinition | undefined,
): Samples {
  const racks = racksOf(asset, region);
  const leadIn = [asset.rack, region.rack].filter(processes).length * LEAD_IN;
  if (loop?.processingAcrossLoop !== ProcessingAcrossLoop.Wrapped || leadIn === 0) {
    return rackedFromStart(edited, span, racks);
  }
  const splice = Math.min(loop.loopStart, loop.crossfadeLength > 0 ? loop.crossfadeLength : 480);
  const body = loop.loopEnd - loop.loopStart;
  const cycles = Math.max(1, Math.ceil(Math.max(leadIn, splice) / body));
  return rackedWrapped(edited, span, racks, loop, cycles, splice);
}

describe('a looping region’s plan, against the oracle', () => {
  it('sounds as the oracle runs its racks and crossfades its loop, wherever later edits moved the loop', () => {
    let crossed = 0;
    let shortened = 0;
    let wrapped = 0;
    let fromStart = 0;
    let atRegionStart = 0;
    let severalCycles = 0;
    for (let run = 0; run < 600; run += 1) {
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
      if (placed !== undefined) {
        const edited = asset.edits.reduce<Samples>(
          (sound, edit) => applyEdit(sound, edit),
          samples,
        );
        const span = { start: placed.start, end: placed.start + placed.length };
        expect(plain, `run ${String(run)}`).toEqual(
          expectedBeforeCrossfade(asset, region, edited, span, loop),
        );
      }
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
      if (processes(asset.rack) || processes(region.rack)) {
        if (loop.processingAcrossLoop === ProcessingAcrossLoop.FromStart) fromStart += 1;
        else {
          wrapped += 1;
          if (loop.loopStart === 0) atRegionStart += 1;
          if (loop.loopEnd - loop.loopStart < LEAD_IN) severalCycles += 1;
        }
      }
    }
    // The runs cover a crossfade heard and one shortened to fit, and both
    // renderings under a rack that processes: among the wrapped, loops at
    // the region's start and loops short enough to warm up over several
    // cycles.
    expect(crossed).toBeGreaterThan(50);
    expect(shortened).toBeGreaterThan(50);
    expect(wrapped).toBeGreaterThan(50);
    expect(fromStart).toBeGreaterThan(50);
    expect(atRegionStart).toBeGreaterThan(5);
    expect(severalCycles).toBeGreaterThan(20);
  });
});
