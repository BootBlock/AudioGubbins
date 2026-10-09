import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type EditOperationId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { TakeState } from '../project/take-stack.js';
import { derivedSampleCount, sampleRate, type SampleRate } from '../time/sample-time.js';
import { applyEdit, type Samples } from '../testing/edit-oracle.js';
import { editingEntities } from '../testing/editing-fixtures.js';
import { TEST_ENGINE } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { PunchWorld, noise, pick } from '../testing/punch-world.js';
import { expectSuccess } from '../testing/unwrap.js';
import { shapesOf } from './edit-shape.js';
import { FadeShape } from './fades.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { assetPlan } from './plan-building.js';
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

const RATES: readonly SampleRate[] = [32_000, 44_100, 48_000, 96_000].map((rate) =>
  expectSuccess(sampleRate(rate)),
);
const LAYOUTS: readonly ChannelLayout[] = [StandardLayouts.mono, StandardLayouts.stereo];
const SHAPES: readonly FadeShape[] = Object.values(FadeShape);

function rangeIn(next: () => number, length: number): { start: number; end: number } {
  const start = Math.floor(next() * length);
  return { start, end: start + 1 + Math.floor(next() * (length - start)) };
}

/** One random step: a punch, mostly, or an edit that cuts, turns, pastes or converts around one. */
function step(
  next: () => number,
  world: PunchWorld,
  asset: Asset,
  samples: Samples,
  id: EditOperationId,
): { operation: EditOperation; inserted: Samples } {
  const length = samples[0]?.length ?? 0;
  const range = rangeIn(next, length);
  const edges = { start: derivedSampleCount(range.start), end: derivedSampleCount(range.end) };
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) throw new Error('A chain always has a shape.');
  const choice = next();
  if (choice < 0.4) {
    const stack = world.stack(shape, range.end - range.start);
    return {
      operation: { id, kind: 'process', range: edges, edit: { kind: 'punch', stack } },
      inserted: [],
    };
  }
  if (choice < 0.5 && length * 4 < 2_000) {
    const to = pick(
      next,
      RATES.filter((rate) => rate !== shape.sampleRate),
    );
    return {
      operation: { id, kind: 'convert-rate', sampleRate: to, version: TEST_ENGINE.resampler },
      inserted: [],
    };
  }
  if (choice < 0.65) {
    const plan = expectSuccess(assetPlan(asset, world.context));
    const at = derivedSampleCount(Math.floor(next() * (length + 1)));
    return {
      operation: {
        id,
        kind: 'insert',
        at,
        payload: expectSuccess(slicePlan(plan, range.start, range.end)),
      },
      inserted: samples.map((channel) => channel.slice(range.start, range.end)),
    };
  }
  if (choice < 0.75) return { operation: { id, kind: 'delete', range: edges }, inserted: [] };
  if (choice < 0.87) return { operation: { id, kind: 'reverse', range: edges }, inserted: [] };
  return {
    operation: {
      id,
      kind: 'process',
      range: edges,
      edit: { kind: 'fade', direction: 'in', shape: pick(next, SHAPES) },
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

/** A random chain of punches and edits over a fresh source. */
function randomChain(seed: number, steps: number) {
  const next = random(seed);
  const world = new PunchWorld(next, RATES);
  const id = unsafeBrandId<'AssetId'>(`00000000-asset-${seed.toString(16).padStart(6, '0')}`);
  const layout = pick(next, LAYOUTS);
  const frames = 40 + Math.floor(next() * 120);
  let asset: Asset = {
    id,
    displayName: 'Target',
    origin: AssetOrigin.Imported,
    sampleRate: RATES[2] ?? expectSuccess(sampleRate(48_000)),
    channelLayout: layout,
    length: derivedSampleCount(frames),
    storageKey: `content:${id}`,
    edits: [],
  };
  const source = noise(next, layout.roles.length, frames);
  world.sources.set(id, source);
  let sound = source;
  const made: { operation: EditOperation; inserted: Samples }[] = [];
  for (let index = 0; index < steps && (sound[0]?.length ?? 0) >= 2; index += 1) {
    world.assets.set(asset.id, asset);
    const operationId = unsafeBrandId<'EditOperationId'>(
      `0000${index.toString(16).padStart(4, '0')}-edit`,
    );
    const one = step(next, world, asset, sound, operationId);
    const shape = shapesOf(asset).at(-1);
    if (shape === undefined) throw new Error('A chain always has a shape.');
    expectSuccess(
      validateOperation(
        one.operation,
        shape,
        editingEntities(world.assets, new Map(), world.stacks),
      ),
    );
    sound = applyEdit(sound, one.operation, world.oracle(one.inserted), shape.sampleRate);
    asset = { ...asset, edits: [...asset.edits, one.operation] };
    made.push(one);
  }
  world.assets.set(asset.id, asset);
  return { next, world, asset, source, sound, made };
}

/** The source with `made` applied in turn by the oracle, the stacks as `world` holds them now. */
function replayed(
  world: PunchWorld,
  asset: Asset,
  source: Samples,
  made: ReturnType<typeof randomChain>['made'],
): Samples {
  const shapes = shapesOf(asset);
  let sound = source;
  for (const [basis, one] of made.entries()) {
    sound = applyEdit(sound, one.operation, world.oracle(one.inserted), shapes[basis]?.sampleRate);
  }
  return sound;
}

describe('the edit plan with punches, against the same applied in order', () => {
  it('renders every random chain of punches to the bits of each edit applied to the samples in turn', () => {
    for (let run = 0; run < 150; run += 1) {
      const { world, asset, sound } = randomChain(run + 1, 10);
      expectSuccess(validateChain(asset, editingEntities(world.assets, new Map(), world.stacks)));
      const plan = expectSuccess(assetPlan(asset, world.context));
      if ((sound[0]?.length ?? 0) > 0) expectSuccess(validatePlan(plan, world.assets));
      expect(sameBits(renderPlan(plan, world.sources, world.oracle([])), sound)).toBe(true);
    }
  });

  it('plays another take, or the earlier audio, as soon as a stack chooses otherwise', () => {
    for (let run = 0; run < 100; run += 1) {
      const { next, world, asset, source, made } = randomChain(run + 1_000, 8);
      for (const stack of [...world.stacks.values()]) {
        const kept = stack.takes.filter((take) => take.state === TakeState.Kept);
        const other = kept.length === 0 || next() < 0.3 ? undefined : pick(next, kept).id;
        const { chosen: _chosen, ...unchosen } = stack;
        world.stacks.set(stack.id, other === undefined ? unchosen : { ...unchosen, chosen: other });
      }
      const plan = expectSuccess(assetPlan(asset, world.context));
      expect(
        sameBits(
          renderPlan(plan, world.sources, world.oracle([])),
          replayed(world, asset, source, made),
        ),
      ).toBe(true);
    }
  });

  it('leaves the range as it was where its stack has no chosen take', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const { world, asset, source, made } = randomChain(seed, 1);
      const [only] = made;
      if (only?.operation.kind !== 'process' || only.operation.edit.kind !== 'punch') continue;
      const stack = world.stacks.get(only.operation.edit.stack);
      if (stack === undefined) throw new Error('The punch names its stack.');
      const { chosen: _chosen, ...unchosen } = stack;
      world.stacks.set(stack.id, unchosen);
      const plan = expectSuccess(assetPlan(asset, world.context));
      expect(sameBits(renderPlan(plan, world.sources, world.oracle([])), source)).toBe(true);
    }
  });
});
