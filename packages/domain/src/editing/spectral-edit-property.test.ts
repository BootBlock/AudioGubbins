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
import { MaskWeights } from '../spectral/mask-weight.js';
import type { SpectralEdit, SpectralEditOperation } from '../spectral/spectral-edit.js';
import { MaskEffect, type SpectralMask } from '../spectral/spectral-mask.js';
import { derivedSampleCount, sampleRate } from '../time/sample-time.js';
import { applyEdit, type OracleWorld, type Samples } from '../testing/edit-oracle.js';
import { editingEntities } from '../testing/editing-fixtures.js';
import { TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { TEST_CATALOGUE } from '../testing/test-processors.js';
import { expectSuccess } from '../testing/unwrap.js';
import { anchorResolver } from './anchors.js';
import { shapesOf } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { regionPlan } from './placement.js';
import { validateRegion } from './placement-validation.js';
import { assetPlan, bypassedAssetPlan } from './plan-building.js';
import type { PlanContext } from './plan-context.js';
import { slicePlan } from './plan-slicing.js';
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

const RATE = expectSuccess(sampleRate(48_000));
const LAYOUTS: readonly ChannelLayout[] = [StandardLayouts.mono, StandardLayouts.stereo];

const CHAINS: readonly EffectChainId[] = ['a', 'b'].map((name) =>
  unsafeBrandId<'EffectChainId'>(`33333333-chain-${name}`),
);

const CONTEXT: PlanContext = {
  chains: new Map(CHAINS.map((id): [EffectChainId, EffectChain] => [id, { id, slots: [] }])),
  takeStacks: new Map(),
  assets: new Map(),
  catalogue: TEST_CATALOGUE,
  engine: TEST_ENGINE,
};

/** A chain: a recursive filter, so where its run begins changes what it makes. */
function chained(chain: EffectChainId, samples: Samples): Samples {
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
}

/**
 * What the test says a spectral edit makes of its range: a change weighted by
 * the mask at each frame's position, reading the frame before, so a mask
 * placed anywhere but where its range starts, or a range read from anywhere
 * but its start, makes other bits.
 */
function spectral(
  edit: Omit<SpectralEdit, 'kind'>,
  channels: readonly number[] | undefined,
  samples: Samples,
): Samples {
  const weights = new MaskWeights(edit.mask);
  const scope = new Set(channels ?? samples.map((_, index) => index));
  const { operation } = edit;
  const wet = operation.kind === 'process' ? chained(operation.chain, samples) : samples;
  return samples.map((channel, index) => {
    if (!scope.has(index)) return Float32Array.from(channel);
    const out = new Float32Array(channel.length);
    for (let frame = 0; frame < channel.length; frame += 1) {
      const w = weights.at(frame, 1_000);
      const x = channel[frame] ?? 0;
      const before = channel[Math.max(frame - 1, 0)] ?? 0;
      switch (operation.kind) {
        case 'attenuate':
          out[frame] = Math.fround(x * (1 - w * (1 - operation.gain)));
          break;
        case 'isolate':
          out[frame] = Math.fround(x * (w + (1 - w) * operation.gain));
          break;
        case 'heal':
          out[frame] = Math.fround(x + w * (before - x) * 0.5);
          break;
        case 'process':
          out[frame] = Math.fround(x + w * ((wet[index]?.[frame] ?? 0) - x));
          break;
      }
    }
    return out;
  });
}

const WORLD: OracleWorld = { chain: chained, spectral };

/**
 * Spectral edits leave their ranges as they were: the sound with its
 * processing bypassed. A paste keeps what it copied, processed as it was
 * when copied, since a payload is an edit of its own, so a bypassed plan is
 * still rendered by `WORLD`.
 */
const BYPASSED: OracleWorld = {
  chain: (_, heard) => heard,
  spectral: (_, __, heard) => heard,
};

function sourceOf(next: () => number, id: AssetId): { asset: Asset; samples: Samples } {
  const layout = LAYOUTS[Math.floor(next() * LAYOUTS.length)] ?? StandardLayouts.mono;
  const length = 60 + Math.floor(next() * 140);
  return {
    asset: {
      id,
      displayName: 'Source',
      origin: AssetOrigin.Imported,
      sampleRate: RATE,
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

/** A mask within a range of `length`: a rectangle, with a polygon or a stroke beside it. */
function maskIn(next: () => number, length: number): SpectralMask {
  const at = (value: number) => derivedSampleCount(Math.min(length, Math.floor(value)));
  const span = rangeIn(next, length);
  const pick = next();
  const second =
    pick < 0.4
      ? {
          kind: 'polygon' as const,
          effect: next() < 0.7 ? MaskEffect.Add : MaskEffect.Subtract,
          points: [
            { position: at(next() * length), frequency: next() * 2_000 },
            { position: at(next() * length), frequency: next() * 2_000 },
            { position: at(next() * length), frequency: next() * 2_000 },
          ] as const,
        }
      : {
          kind: 'stroke' as const,
          effect: MaskEffect.Add,
          hardness: next() * 0.9,
          points: [
            {
              position: at(next() * length),
              frequency: next() * 2_000,
              strength: 0.1 + next() * 0.9,
              radius: { time: 1 + next() * Math.min(10, length), frequency: 50 + next() * 500 },
            },
            {
              position: at(next() * length),
              frequency: next() * 2_000,
              strength: 0.1 + next() * 0.9,
              radius: { time: 1 + next() * Math.min(10, length), frequency: 50 + next() * 500 },
            },
          ] as const,
        };
  return {
    shapes: [
      {
        kind: 'rectangle',
        effect: MaskEffect.Add,
        range: { start: at(span.start), end: at(span.end) },
        band: { low: next() * 900, high: 1_000 + next() * 1_000 },
      },
      second,
    ],
    feather:
      next() < 0.5
        ? { time: 0, frequency: 0 }
        : { time: 1 + next() * Math.min(8, length), frequency: 100 },
  };
}

function operationOf(next: () => number): SpectralEditOperation {
  const pick = next();
  if (pick < 0.3) return { kind: 'attenuate', gain: Math.fround(next() * 0.9) };
  if (pick < 0.5) return { kind: 'isolate', gain: Math.fround(next() * 0.9) };
  if (pick < 0.75) return { kind: 'heal' };
  return {
    kind: 'process',
    chain: CHAINS[Math.floor(next() * CHAINS.length)] ?? CHAINS[0] ?? unsafeBrandId('x'),
  };
}

function spectralEditIn(next: () => number, length: number): SpectralEdit {
  return {
    kind: 'spectral',
    mask: maskIn(next, length),
    resolution: 256,
    operation: operationOf(next),
  };
}

/** One random step: a spectral edit, or a cut, paste, reversal or gain around one. */
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
  if (pick < 0.45) {
    const channels = samples.length > 1 && next() < 0.4 ? { channels: [1] } : {};
    return {
      operation: {
        id,
        kind: 'process',
        range: edges,
        ...channels,
        edit: spectralEditIn(next, range.end - range.start),
      },
      inserted: [],
    };
  }
  if (pick < 0.6) {
    const plan = expectSuccess(assetPlan(asset, CONTEXT));
    const at = derivedSampleCount(Math.floor(next() * (length + 1)));
    const payload = expectSuccess(slicePlan(plan, range.start, range.end));
    return {
      operation: { id, kind: 'insert', at, payload },
      inserted: samples.map((channel) => channel.slice(range.start, range.end)),
    };
  }
  if (pick < 0.75) return { operation: { id, kind: 'delete', range: edges }, inserted: [] };
  if (pick < 0.88) return { operation: { id, kind: 'reverse', range: edges }, inserted: [] };
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

function randomChain(seed: number, steps: number) {
  const next = random(seed);
  const id = unsafeBrandId<'AssetId'>(`00000000-asset-${seed.toString(16).padStart(6, '0')}`);
  const source = sourceOf(next, id);
  let asset = source.asset;
  const sounds: Samples[] = [source.samples];
  const bypassed: Samples[] = [source.samples];
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
      validateOperation(
        one.operation,
        shape,
        editingEntities(new Map([[asset.id, asset]]), CONTEXT.chains),
      ),
    );
    sounds.push(applyEdit(current, one.operation, { ...WORLD, inserted: one.inserted }, RATE));
    bypassed.push(
      applyEdit(
        bypassed.at(-1) ?? [],
        one.operation,
        { ...BYPASSED, inserted: one.inserted },
        RATE,
      ),
    );
    asset = { ...asset, edits: [...asset.edits, one.operation] };
  }
  return { next, source, asset, sounds, bypassed };
}

describe('the edit plan with spectral edits, against the same applied in order', () => {
  it('renders every random chain to the bits of each edit applied to the samples in turn', () => {
    for (let run = 0; run < 150; run += 1) {
      const { source, asset, sounds } = randomChain(run + 1, 12);
      expectSuccess(
        validateChain(asset, editingEntities(new Map([[asset.id, asset]]), CONTEXT.chains)),
      );
      const plan = expectSuccess(assetPlan(asset, CONTEXT));
      if ((sounds.at(-1)?.[0]?.length ?? 0) > 0) {
        expectSuccess(validatePlan(plan, new Map([[asset.id, source.asset]])));
      }
      const rendered = renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD);
      expect(sameBits(rendered, sounds.at(-1) ?? []), `run ${String(run)}`).toBe(true);
    }
  });

  it('leaves every spectral edit’s range as it was when its processing is bypassed', () => {
    for (let run = 0; run < 80; run += 1) {
      const { source, asset, bypassed } = randomChain(20_000 + run, 10);
      const plan = expectSuccess(bypassedAssetPlan(asset, CONTEXT));
      expect(
        sameBits(
          renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD),
          bypassed.at(-1) ?? [],
        ),
        `run ${String(run)}`,
      ).toBe(true);
    }
  });

  it('applies a region’s spectral edit to the content it was placed on', () => {
    for (let run = 0; run < 60; run += 1) {
      const { source, asset, sounds, next } = randomChain(40_000 + run, 6);
      const current = sounds.at(-1) ?? [];
      const length = current[0]?.length ?? 0;
      if (length < 2) continue;
      const span = rangeIn(next, length);
      const processing = rangeIn(next, length);
      const operation = {
        id: unsafeBrandId<'EditOperationId'>('0000ffff-region'),
        basis: asset.edits.length,
        range: {
          start: derivedSampleCount(processing.start),
          end: derivedSampleCount(processing.end),
        },
        edit: spectralEditIn(next, processing.end - processing.start),
      };
      const region: Region = {
        id: unsafeBrandId<'RegionId'>('0000eeee-region'),
        assetId: asset.id,
        displayName: 'Region',
        basis: asset.edits.length,
        start: derivedSampleCount(span.start),
        end: derivedSampleCount(span.end),
        tags: [],
        operations: [operation],
      };
      expectSuccess(validateRegion(asset, region, CONTEXT.chains));
      const placed = applyEdit(current, { ...operation, kind: 'process' }, WORLD);
      const plan = expectSuccess(regionPlan(asset, region, CONTEXT, anchorResolver(asset)));
      expect(
        sameBits(
          renderPlan(plan, new Map([[asset.id, source.samples]]), WORLD),
          placed.map((channel) => channel.slice(span.start, span.end)),
        ),
        `run ${String(run)}`,
      ).toBe(true);
    }
  });

  it('refuses a spectral edit whose mask reaches past its range, and one whose chain is missing', () => {
    const next = random(3);
    const { asset } = sourceOf(next, unsafeBrandId<'AssetId'>('00000000-asset-refused'));
    const shape = shapesOf(asset).at(-1);
    if (shape === undefined) throw new Error('A chain always has a shape.');
    const entities = editingEntities(new Map([[asset.id, asset]]), CONTEXT.chains);
    const range = { start: derivedSampleCount(10), end: derivedSampleCount(30) };
    const tooWide: EditOperation = {
      id: unsafeBrandId<'EditOperationId'>('0000aaaa-edit'),
      kind: 'process',
      range,
      edit: {
        kind: 'spectral',
        resolution: 256,
        operation: { kind: 'heal' },
        mask: {
          shapes: [
            {
              kind: 'rectangle',
              effect: MaskEffect.Add,
              range: { start: derivedSampleCount(0), end: derivedSampleCount(21) },
              band: { low: 0, high: 1_000 },
            },
          ],
          feather: { time: 0, frequency: 0 },
        },
      },
    };
    expect(validateOperation(tooWide, shape, entities).ok).toBe(false);
    const missing: EditOperation = {
      ...tooWide,
      edit: {
        ...spectralEditIn(next, 20),
        operation: { kind: 'process', chain: unsafeBrandId<'EffectChainId'>('33333333-chain-z') },
      },
    };
    expect(validateOperation(missing, shape, entities).ok).toBe(false);
  });
});
