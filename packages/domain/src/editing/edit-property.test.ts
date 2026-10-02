import { describe, expect, it } from 'vitest';

import { StandardLayouts, layoutsMatch, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type AssetId, type EditOperationId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { derivedSampleCount, sampleRate } from '../time/sample-time.js';
import { applyEdit, type Samples } from '../testing/edit-oracle.js';
import { renderPlan } from '../testing/plan-render.js';
import { expectSuccess } from '../testing/unwrap.js';
import { Affinity, anchorResolver } from './anchors.js';
import { conversionMatrix } from './channel-matrices.js';
import { shapesOf } from './edit-shape.js';
import { validateChain, validateOperation } from './operation-validation.js';
import { FadeShape, type EditOperation, type LevelEdit, type RangeEdit } from './operations.js';
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
    const plan = assetPlan(asset);
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
        expectSuccess(validateOperation(operation, shape, new Map([[asset.id, asset]])));
        asset = { ...asset, edits: [...asset.edits, operation] };
        expected = applyEdit(expected, operation, inserted);
        const rendered = renderPlan(assetPlan(asset), new Map([[asset.id, source.samples]]));
        expect(
          sameBits(rendered, expected),
          `run ${String(run)}, edit ${String(index)} (${operation.kind})`,
        ).toBe(true);
      }
      expectSuccess(validateChain(asset, new Map([[asset.id, asset]])));
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
        const plan = assetPlan(asset);
        const edited: Asset = { ...asset, edits: [...asset.edits, operation] };
        const withdrawn: Asset = { ...edited, edits: edited.edits.slice(0, -1) };
        expect(assetPlan(withdrawn)).toEqual(plan);
        expect(
          anchorResolver(withdrawn).position(asset.edits.length, position, Affinity.After),
        ).toBe(before);
        asset = edited;
        expected = applyEdit(expected, operation, inserted);
      }
    }
  });
});
