import { PLAN_WITHOUT_CHAINS } from '../testing/plan-context.js';
import { describe, expect, it } from 'vitest';

import { StandardLayouts, layoutsMatch, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type AssetId, type EditOperationId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import type { Region } from '../project/timeline.js';
import { derivedSampleCount, sampleRate } from '../time/sample-time.js';
import { applyEdit, type Samples } from '../testing/edit-oracle.js';
import { renderPlan } from '../testing/plan-render.js';
import { expectSuccess } from '../testing/unwrap.js';
import { Affinity, anchorResolver } from './anchors.js';
import { conversionMatrix } from './channel-matrices.js';
import { shapesOf } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import { FadeShape } from './fades.js';
import { regionPlan } from './placement.js';
import { validateRegion } from './placement-validation.js';
import type { EditOperation, LevelEdit, RangeEdit } from './operations.js';
import { assetPlan } from './plan-building.js';
import { slicePlan } from './plan-slicing.js';

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
const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.lcr,
];
const SHAPES = Object.values(FadeShape);

function sourceOf(next: () => number, id: AssetId): { asset: Asset; samples: Samples } {
  const layout = LAYOUTS[Math.floor(next() * LAYOUTS.length)] ?? StandardLayouts.mono;
  const length = 20 + Math.floor(next() * 120);
  const samples = layout.roles.map(() =>
    Float32Array.from({ length }, () => Math.fround(next() * 2 - 1)),
  );
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
    samples,
  };
}

function rangeIn(next: () => number, length: number): { start: number; end: number } {
  const start = Math.floor(next() * length);
  const end = start + 1 + Math.floor(next() * (length - start));
  return { start, end };
}

function levelEdit(next: () => number): LevelEdit {
  const pick = Math.floor(next() * 4);
  if (pick === 0) return { kind: 'gain', gain: Math.fround(next() * 2) };
  if (pick === 1) return { kind: 'silence' };
  if (pick === 2) return { kind: 'invert' };
  return {
    kind: 'fade',
    direction: next() < 0.5 ? 'in' : 'out',
    shape: SHAPES[Math.floor(next() * SHAPES.length)] ?? 'linear',
  };
}

function rangeEdit(
  next: () => number,
  count: number,
): { edit: RangeEdit; channels?: readonly number[] } {
  const pick = next();
  if (pick < 0.6 || count < 2) {
    const scoped = count > 1 && next() < 0.4;
    return { edit: levelEdit(next), ...(scoped ? { channels: [Math.floor(next() * count)] } : {}) };
  }
  const first = Math.floor(next() * count);
  const second = (first + 1 + Math.floor(next() * (count - 1))) % count;
  if (pick < 0.75) return { edit: { kind: 'swap-channels', first, second } };
  if (pick < 0.9) return { edit: { kind: 'copy-channel', from: first, to: second } };
  return {
    edit: {
      kind: 'channel-gains',
      gains: Array.from({ length: count }, () => Math.fround(next() * 2)),
    },
  };
}

/** One random step: an operation, and for an insertion the samples it was copied as. */
function step(
  next: () => number,
  asset: Asset,
  samples: Samples,
  id: EditOperationId,
): { operation: EditOperation; inserted: Samples } {
  const length = samples[0]?.length ?? 0;
  const count = samples.length;
  const pick = next();
  if (length < 4 || pick < 0.2) {
    const plan = expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS));
    const copied = length === 0 ? { start: 0, end: 0 } : rangeIn(next, length);
    const at = Math.floor(next() * (length + 1));
    if (copied.end > copied.start) {
      const payload = expectSuccess(slicePlan(plan, copied.start, copied.end));
      return {
        operation: { id, kind: 'insert', at: derivedSampleCount(at), payload, convertRate: false },
        inserted: samples.map((channel) => channel.slice(copied.start, copied.end)),
      };
    }
  }
  const range = rangeIn(next, length);
  const edges = { start: derivedSampleCount(range.start), end: derivedSampleCount(range.end) };
  if (pick < 0.35) return { operation: { id, kind: 'delete', range: edges }, inserted: [] };
  if (pick < 0.4) return { operation: { id, kind: 'trim', range: edges }, inserted: [] };
  if (pick < 0.55) return { operation: { id, kind: 'reverse', range: edges }, inserted: [] };
  if (pick < 0.62) {
    const layout = LAYOUTS[Math.floor(next() * LAYOUTS.length)] ?? StandardLayouts.mono;
    const current = shapesOf(asset).at(-1)?.layout ?? asset.channelLayout;
    const matrix = conversionMatrix(current, layout);
    if (matrix.ok && !layoutsMatch(current, layout)) {
      return {
        operation: { id, kind: 'convert-layout', layout, matrix: matrix.value },
        inserted: [],
      };
    }
  }
  return {
    operation: { id, kind: 'process', range: edges, ...rangeEdit(next, count) },
    inserted: [],
  };
}

/** Whether two renders hold the same bits. */
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

describe('the edit plan, against each edit applied to the samples one at a time', () => {
  it('renders every random chain to the same bits as the edits applied in order', () => {
    for (let run = 0; run < 150; run += 1) {
      const next = random(run + 1);
      const id = unsafeBrandId<'AssetId'>(`00000000-asset-${run.toString(16).padStart(4, '0')}`);
      const source = sourceOf(next, id);
      let asset = source.asset;
      let expected = source.samples;
      for (let index = 0; index < 25; index += 1) {
        // Audio deleted to nothing has nothing left to copy or edit.
        if ((expected[0]?.length ?? 0) === 0) break;
        const operationId = unsafeBrandId<'EditOperationId'>(
          `0000${index.toString(16).padStart(4, '0')}-edit`,
        );
        const { operation, inserted } = step(next, asset, expected, operationId);
        const shape = shapesOf(asset).at(-1);
        if (shape === undefined) throw new Error('A chain always has a shape.');
        expectSuccess(
          validateOperation(
            operation,
            shape,
            new Map([[asset.id, asset]]),
            PLAN_WITHOUT_CHAINS.chains,
          ),
        );
        asset = { ...asset, edits: [...asset.edits, operation] };
        expected = applyEdit(expected, operation, { inserted: inserted });
        const rendered = renderPlan(
          expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS)),
          new Map([[asset.id, source.samples]]),
        );
        expect(
          sameBits(rendered, expected),
          `run ${String(run)}, edit ${String(index)} (${operation.kind})`,
        ).toBe(true);
      }
      expectSuccess(validateChain(asset, new Map([[asset.id, asset]]), PLAN_WITHOUT_CHAINS.chains));
    }
  });

  it('gives back the earlier sound and the earlier positions when the last edit is withdrawn', () => {
    for (let run = 0; run < 60; run += 1) {
      const next = random(10_000 + run);
      const id = unsafeBrandId<'AssetId'>(`00000000-asset-${run.toString(16).padStart(4, '0')}`);
      const source = sourceOf(next, id);
      let asset = source.asset;
      let expected = source.samples;
      for (let index = 0; index < 12; index += 1) {
        if ((expected[0]?.length ?? 0) === 0) break;
        const operationId = unsafeBrandId<'EditOperationId'>(
          `0000${index.toString(16).padStart(4, '0')}-edit`,
        );
        const { operation, inserted } = step(next, asset, expected, operationId);
        const position = Math.floor(next() * ((expected[0]?.length ?? 0) + 1));
        const before = anchorResolver(asset).position(asset.edits.length, position, Affinity.After);
        const plan = expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS));
        const edited: Asset = { ...asset, edits: [...asset.edits, operation] };
        const withdrawn: Asset = { ...edited, edits: edited.edits.slice(0, -1) };
        expect(expectSuccess(assetPlan(withdrawn, PLAN_WITHOUT_CHAINS))).toEqual(plan);
        expect(
          anchorResolver(withdrawn).position(asset.edits.length, position, Affinity.After),
        ).toBe(before);
        asset = edited;
        expected = applyEdit(expected, operation, { inserted: inserted });
      }
    }
  });
});

describe('a region’s processing, against the same processing applied at its basis', () => {
  it('renders every region over a random chain as its processing applied where it was placed', () => {
    for (let run = 0; run < 100; run += 1) {
      const next = random(20_000 + run);
      const id = unsafeBrandId<'AssetId'>(`00000000-asset-${run.toString(16).padStart(4, '0')}`);
      const source = sourceOf(next, id);
      let asset = source.asset;
      const sounds: Samples[] = [source.samples];
      const steps: { operation: EditOperation; inserted: Samples }[] = [];
      for (let index = 0; index < 12; index += 1) {
        const current = sounds.at(-1) ?? [];
        if ((current[0]?.length ?? 0) === 0) break;
        const operationId = unsafeBrandId<'EditOperationId'>(
          `0000${index.toString(16).padStart(4, '0')}-edit`,
        );
        const made = step(next, asset, current, operationId);
        steps.push(made);
        asset = { ...asset, edits: [...asset.edits, made.operation] };
        sounds.push(applyEdit(current, made.operation, { inserted: made.inserted }));
      }

      const basis = Math.floor(next() * sounds.length);
      const placedOn = sounds[basis] ?? [];
      const length = placedOn[0]?.length ?? 0;
      if (length === 0) continue;
      const made = rangeEdit(next, placedOn.length);
      const edges = rangeIn(next, length);
      const processing = {
        id: unsafeBrandId<'EditOperationId'>('0000ffff-region'),
        basis,
        range: { start: derivedSampleCount(edges.start), end: derivedSampleCount(edges.end) },
        ...made,
      };
      const region: Region = {
        id: unsafeBrandId<'RegionId'>('0000eeee-region'),
        assetId: asset.id,
        displayName: 'Region',
        basis: 0,
        start: derivedSampleCount(0),
        end: source.asset.length,
        tags: [],
        operations: [processing],
      };
      expectSuccess(validateRegion(asset, region, PLAN_WITHOUT_CHAINS.chains));

      let expected = applyEdit(placedOn, { ...processing, kind: 'process' }, { inserted: [] });
      for (const later of steps.slice(basis)) {
        expected = applyEdit(expected, later.operation, { inserted: later.inserted });
      }
      const span = anchorResolver(asset).span(0, { start: 0, end: source.asset.length });
      if (span === undefined) throw new Error('A region at the first basis resolves.');
      const rendered = renderPlan(
        expectSuccess(regionPlan(asset, region, PLAN_WITHOUT_CHAINS)),
        new Map([[id, source.samples]]),
      );
      expect(
        sameBits(
          rendered,
          expected.map((channel) => channel.slice(span.start, span.end)),
        ),
        `run ${String(run)}, processing at ${String(basis)} of ${String(asset.edits.length)}`,
      ).toBe(true);
    }
  });
});
