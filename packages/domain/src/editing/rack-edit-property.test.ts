import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import {
  unsafeBrandId,
  type AssetId,
  type EditOperationId,
  type EffectChainId,
} from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import type { Region } from '../project/timeline.js';
import { derivedSampleCount, sampleRate, type SampleRate } from '../time/sample-time.js';
import { applyEdit, type OracleWorld, type Samples } from '../testing/edit-oracle.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE } from '../testing/test-processors.js';
import { expectSuccess } from '../testing/unwrap.js';
import { anchorResolver } from './anchors.js';
import { shapesOf } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { bypassedRegionPlan, regionPlan, unrackedRegionPlan } from './placement.js';
import { validateRegion } from './placement-validation.js';
import {
  assetPlan,
  bypassedAssetPlan,
  unrackedAssetPlan,
  type PlanContext,
} from './plan-building.js';
import { slicePlan } from './plan-slicing.js';
import { validatePlan } from './plan-validation.js';
import { TEST_ENGINE } from '../testing/plan-context.js';

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

const RATES: readonly SampleRate[] = [32_000, 44_100, 48_000, 96_000].map((rate) =>
  expectSuccess(sampleRate(rate)),
);
const LAYOUTS: readonly ChannelLayout[] = [StandardLayouts.mono, StandardLayouts.stereo];

const CHAINS: readonly EffectChainId[] = ['a', 'b', 'c'].map((name) =>
  unsafeBrandId<'EffectChainId'>(`33333333-chain-${name}`),
);

/** Every chain of the test, empty, so each keeps its layout. */
const CONTEXT: PlanContext = {
  chains: new Map(CHAINS.map((id): [EffectChainId, EffectChain] => [id, { id, slots: [] }])),
  catalogue: TEST_CATALOGUE,
  engine: TEST_ENGINE,
};

/**
 * What the test says each kind of processing does. A chain is a recursive
 * filter, so its output depends on where its run began: rendered from
 * anywhere but its own start, a processed stream would differ.
 */
const WORLD: OracleWorld = {
  chain: (chain, samples) => {
    const gain = 0.25 + CHAINS.indexOf(chain) * 0.25;
    return samples.map((channel) => {
      const out = new Float32Array(channel.length);
      let last = 0;
      for (let frame = 0; frame < channel.length; frame += 1) {
        last = Math.fround((channel[frame] ?? 0) * gain + last * 0.5);
        out[frame] = last;
      }
      return out;
    });
  },
  stretch: (samples, length) =>
    samples.map((channel) =>
      Float32Array.from(
        { length },
        (_, frame) => channel[Math.floor((frame * channel.length) / length)] ?? 0,
      ),
    ),
  convert: (samples, from, to, length) =>
    samples.map((channel) =>
      Float32Array.from(
        { length },
        (_, frame) => channel[Math.min(channel.length - 1, Math.floor((frame * from) / to))] ?? 0,
      ),
    ),
};

function sourceOf(next: () => number, id: AssetId): { asset: Asset; samples: Samples } {
  const layout = LAYOUTS[Math.floor(next() * LAYOUTS.length)] ?? StandardLayouts.mono;
  const length = 40 + Math.floor(next() * 120);
  return {
    asset: {
      id,
      displayName: 'Source',
      origin: AssetOrigin.Imported,
      sampleRate: RATES[2] ?? expectSuccess(sampleRate(48_000)),
      channelLayout: layout,
      length: derivedSampleCount(length),
      storageKey: `content:${id}`,
      edits: [],
    },
    samples: layout.roles.map(() =>
      Float32Array.from({ length }, () => Math.fround(next() * 2 - 1)),
    ),
  };
}

function rangeIn(next: () => number, length: number): { start: number; end: number } {
  const start = Math.floor(next() * length);
  return { start, end: start + 1 + Math.floor(next() * (length - start)) };
}

function chainOf(next: () => number): EffectChainId {
  return CHAINS[Math.floor(next() * CHAINS.length)] ?? CHAINS[0] ?? unsafeBrandId('33333333-none');
}

/** One random step that names a chain, stretches, converts, or cuts and pastes around them. */
function step(
  next: () => number,
  asset: Asset,
  samples: Samples,
  id: EditOperationId,
): { operation: EditOperation; inserted: Samples } {
  const length = samples[0]?.length ?? 0;
  const range = rangeIn(next, length);
  const edges = { start: derivedSampleCount(range.start), end: derivedSampleCount(range.end) };
  const pick = next();
  if (pick < 0.3) {
    return {
      operation: {
        id,
        kind: 'process',
        range: edges,
        edit: { kind: 'rack', chain: chainOf(next) },
      },
      inserted: [],
    };
  }
  if (pick < 0.45) {
    const before = range.end - range.start;
    const made = Math.max(1, Math.round(before * (0.5 + next() * 1.5)));
    return {
      operation: {
        id,
        kind: 'stretch',
        range: edges,
        length: derivedSampleCount(made),
        version: TEST_ENGINE.stretch,
      },
      inserted: [],
    };
  }
  if (pick < 0.55) {
    const current = shapesOf(asset).at(-1)?.sampleRate;
    const others = RATES.filter((rate) => rate !== current);
    const to = others[Math.floor(next() * others.length)] ?? RATES[0];
    if (to !== undefined && length * 4 < 2_000) {
      return {
        operation: { id, kind: 'convert-rate', sampleRate: to, version: TEST_ENGINE.resampler },
        inserted: [],
      };
    }
  }
  if (pick < 0.7) {
    const plan = expectSuccess(assetPlan(asset, CONTEXT));
    const at = derivedSampleCount(Math.floor(next() * (length + 1)));
    const payload = expectSuccess(slicePlan(plan, range.start, range.end));
    return {
      operation: { id, kind: 'insert', at, payload, convertRate: false },
      inserted: samples.map((channel) => channel.slice(range.start, range.end)),
    };
  }
  if (pick < 0.85) return { operation: { id, kind: 'delete', range: edges }, inserted: [] };
  if (pick < 0.92) return { operation: { id, kind: 'reverse', range: edges }, inserted: [] };
  return {
    operation: {
      id,
      kind: 'process',
      range: edges,
      edit: { kind: 'gain', gain: Math.fround(next() * 2) },
    },
    inserted: [],
  };
}

function sameBits(left: Samples, right: Samples): boolean {
  return (
    left.length === right.length &&
    left.every((channel, index) => {
      const other = right[index];
      if (other?.length !== channel.length) return false;
      const a = new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
      const b = new Uint32Array(other.buffer, other.byteOffset, other.length);
      return a.every((bits, frame) => bits === b[frame]);
    })
  );
}

/** A random chain over a fresh source, with the sound after each step and the steps. */
function randomChain(seed: number, steps: number) {
  const next = random(seed);
  const id = unsafeBrandId<'AssetId'>(`00000000-asset-${seed.toString(16).padStart(6, '0')}`);
  const source = sourceOf(next, id);
  let asset = source.asset;
  const sounds: Samples[] = [source.samples];
  const made: { operation: EditOperation; inserted: Samples }[] = [];
  for (let index = 0; index < steps; index += 1) {
    const current = sounds.at(-1) ?? [];
    if ((current[0]?.length ?? 0) < 2) break;
    const operationId = unsafeBrandId<'EditOperationId'>(
      `0000${index.toString(16).padStart(4, '0')}-edit`,
    );
    const one = step(next, asset, current, operationId);
    const shape = shapesOf(asset).at(-1);
    if (shape === undefined) throw new Error('A chain always has a shape.');
    expectSuccess(
      validateOperation(one.operation, shape, new Map([[asset.id, asset]]), CONTEXT.chains),
    );
    sounds.push(
      applyEdit(current, one.operation, { ...WORLD, inserted: one.inserted }, shape.sampleRate),
    );
    asset = { ...asset, edits: [...asset.edits, one.operation] };
    made.push(one);
  }
  return { next, source, asset, sounds, made };
}

/**
 * The source with `made` applied in turn, every chain passing its audio on
 * unchanged: what the asset sounds like with its processing bypassed. A
 * paste keeps what it copied, processed as it was when copied, since a
 * payload is an edit of its own.
 */
function replayedBypassed(
  samples: Samples,
  asset: Asset,
  made: readonly { readonly operation: EditOperation; readonly inserted: Samples }[],
): Samples {
  const shapes = shapesOf(asset);
  let sound = samples;
  for (const [basis, one] of made.entries()) {
    const rate = shapes[basis]?.sampleRate;
    sound = applyEdit(
      sound,
      one.operation,
      { ...WORLD, chain: (_, heard) => heard, inserted: one.inserted },
      rate,
    );
  }
  return sound;
}

describe('the edit plan with racks, stretches and conversions, against the same applied in order', () => {
  it('renders every random chain to the bits of each edit applied to the samples in turn', () => {
    for (let run = 0; run < 120; run += 1) {
      const { source, asset, sounds } = randomChain(run + 1, 14);
      expectSuccess(validateChain(asset, new Map([[asset.id, asset]]), CONTEXT.chains));
      const plan = expectSuccess(assetPlan(asset, CONTEXT));
      // A chain that deleted everything leaves a plan of no audio, which no
      // reader is given.
      if ((sounds.at(-1)?.[0]?.length ?? 0) > 0) {
        expectSuccess(validatePlan(plan, new Map([[asset.id, source.asset]])));
      }
      const rendered = renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD);
      expect(sameBits(rendered, sounds.at(-1) ?? []), `run ${String(run)}`).toBe(true);
    }
  });

  it('runs an asset’s rack over the whole of the asset as its edits leave it', () => {
    for (let run = 0; run < 60; run += 1) {
      const { source, asset, sounds, next } = randomChain(5_000 + run, 10);
      const rack = chainOf(next);
      const racked = expectSuccess(assetPlan({ ...asset, rack }, CONTEXT));
      const expected = WORLD.chain?.(rack, sounds.at(-1) ?? []) ?? [];
      expect(
        sameBits(renderPlan(racked, new Map([[asset.id, source.samples]]), WORLD), expected),
        `run ${String(run)}`,
      ).toBe(true);
      // What a rack edit over a range of it reads: the edits, not the rack.
      const unracked = expectSuccess(unrackedAssetPlan({ ...asset, rack }, CONTEXT));
      expect(
        sameBits(
          renderPlan(unracked, new Map([[asset.id, source.samples]]), WORLD),
          sounds.at(-1) ?? [],
        ),
        `run ${String(run)}, unracked`,
      ).toBe(true);
    }
  });

  it('gives a region exactly its span of its asset’s processed audio, then its own rack', () => {
    for (let run = 0; run < 60; run += 1) {
      const { source, asset, sounds, next } = randomChain(9_000 + run, 10);
      const current = sounds.at(-1) ?? [];
      const length = current[0]?.length ?? 0;
      if (length < 2) continue;
      const assetRack = chainOf(next);
      const regionRack = chainOf(next);
      const processingRange = rangeIn(next, length);
      const span = rangeIn(next, length);
      const region: Region = {
        id: unsafeBrandId<'RegionId'>('0000eeee-region'),
        assetId: asset.id,
        displayName: 'Region',
        basis: asset.edits.length,
        start: derivedSampleCount(span.start),
        end: derivedSampleCount(span.end),
        tags: [],
        operations: [
          {
            id: unsafeBrandId<'EditOperationId'>('0000ffff-region'),
            basis: asset.edits.length,
            range: {
              start: derivedSampleCount(processingRange.start),
              end: derivedSampleCount(processingRange.end),
            },
            edit: { kind: 'rack', chain: chainOf(next) },
          },
        ],
        rack: regionRack,
      };
      const withRack = { ...asset, rack: assetRack };
      expectSuccess(validateRegion(withRack, region, CONTEXT.chains));
      const [processing] = region.operations;
      if (processing === undefined) throw new Error('The region has its processing.');
      const placed = applyEdit(current, { ...processing, kind: 'process' }, WORLD);
      const assetHeard = WORLD.chain?.(assetRack, placed) ?? [];
      const expected =
        WORLD.chain?.(
          regionRack,
          assetHeard.map((channel) => channel.slice(span.start, span.end)),
        ) ?? [];
      const plan = expectSuccess(regionPlan(withRack, region, CONTEXT, anchorResolver(withRack)));
      expect(
        sameBits(renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD), expected),
        `run ${String(run)}`,
      ).toBe(true);
      // What a rack edit over a range of the region reads: its processing,
      // neither rack.
      const unracked = expectSuccess(
        unrackedRegionPlan(withRack, region, CONTEXT, anchorResolver(withRack)),
      );
      expect(
        sameBits(
          renderPlan(unracked, new Map([[asset.id, source.samples]]), WORLD),
          placed.map((channel) => channel.slice(span.start, span.end)),
        ),
        `run ${String(run)}, unracked`,
      ).toBe(true);
    }
  });

  it('bypasses every chain of an asset and keeps every other edit, its rack edits and its rack', () => {
    for (let run = 0; run < 80; run += 1) {
      const { source, asset, made, next } = randomChain(13_000 + run, 12);
      const rack = chainOf(next);
      const expected = replayedBypassed(source.samples, asset, made);
      const plan = expectSuccess(bypassedAssetPlan({ ...asset, rack }, CONTEXT));
      expect(
        sameBits(renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD), expected),
        `run ${String(run)}`,
      ).toBe(true);
    }
  });

  it('bypasses a region’s rack edits and both racks, its span of its asset kept', () => {
    for (let run = 0; run < 60; run += 1) {
      const { source, asset, made, next } = randomChain(17_000 + run, 10);
      const bypassed = replayedBypassed(source.samples, asset, made);
      const length = bypassed[0]?.length ?? 0;
      if (length < 2) continue;
      const span = rangeIn(next, length);
      const processingRange = rangeIn(next, length);
      const region: Region = {
        id: unsafeBrandId<'RegionId'>('0000eeee-region'),
        assetId: asset.id,
        displayName: 'Region',
        basis: asset.edits.length,
        start: derivedSampleCount(span.start),
        end: derivedSampleCount(span.end),
        tags: [],
        operations: [
          {
            id: unsafeBrandId<'EditOperationId'>('0000ffff-region'),
            basis: asset.edits.length,
            range: {
              start: derivedSampleCount(processingRange.start),
              end: derivedSampleCount(processingRange.end),
            },
            edit: { kind: 'rack', chain: chainOf(next) },
          },
        ],
        rack: chainOf(next),
      };
      const withRack = { ...asset, rack: chainOf(next) };
      const plan = expectSuccess(
        bypassedRegionPlan(withRack, region, CONTEXT, anchorResolver(withRack)),
      );
      expect(
        sameBits(
          renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD),
          bypassed.map((channel) => channel.slice(span.start, span.end)),
        ),
        `run ${String(run)}`,
      ).toBe(true);
    }
  });

  it('refuses a rack edit, a rack or a region’s rack naming a chain the project does not have', () => {
    const { asset } = randomChain(77, 0);
    const missing = unsafeBrandId<'EffectChainId'>('33333333-missing');
    const shape = shapesOf(asset).at(-1);
    if (shape === undefined) throw new Error('A chain always has a shape.');
    const edit: EditOperation = {
      id: unsafeBrandId<'EditOperationId'>('00000001-edit'),
      kind: 'process',
      range: { start: derivedSampleCount(0), end: derivedSampleCount(1) },
      edit: { kind: 'rack', chain: missing },
    };
    const assets = new Map([[asset.id, asset]]);
    expect(validateOperation(edit, shape, assets, CONTEXT.chains).ok).toBe(false);
    expect(validateChain({ ...asset, rack: missing }, assets, CONTEXT.chains).ok).toBe(false);
    expect(assetPlan({ ...asset, rack: missing }, CONTEXT).ok).toBe(false);
  });
});
