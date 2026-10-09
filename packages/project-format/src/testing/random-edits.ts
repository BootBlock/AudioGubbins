/**
 * Random valid edits from a seed, for the property tests: small chains on
 * assets, and regions and markers anchored on them (ADR-0051).
 *
 * Every value is proposed at random and kept only where the domain's own
 * validation accepts it, so what is generated is exactly what a command could
 * have made, and the round trips exercise every kind of operation, every kind
 * of range edit, inserted silence, pastes whose plans carry fades, matrices,
 * reversed segments, generated silence, converted, stretched and processed
 * streams, rack edits naming the project's chains, and positions stated at
 * every basis of a chain.
 */

import {
  FadeDirection,
  FadeShape,
  MAXIMUM_EDIT_GAIN,
  assetPlan,
  channelCount,
  conversionMatrix,
  sampleCount,
  sampleRate,
  shapeAfter,
  shapesOf,
  silencePlan,
  slicePlan,
  streamLength,
  validateMarker,
  validateOperation,
  validateRegion,
  type AnchoredLoop,
  type Asset,
  type AssetId,
  type EditOperation,
  type EditRange,
  type EditShape,
  type IdGenerator,
  type Marker,
  type PlanContext,
  type RangeEdit,
  type Region,
  type RegionOperation,
} from '@audiogubbins/domain';
import { expectSuccess, sourceShape } from '@audiogubbins/domain/testing';

import {
  RATES,
  maybe,
  randomCount,
  randomLayout,
  randomName,
  type Random,
} from './random-values.js';

/** Gains from silence to the bound an edit allows, with an awkward fraction. */
const GAINS = [0, 1e-7, 0.5, 1, 2, 0.1 + 0.2, MAXIMUM_EDIT_GAIN];

/** Factors a matrix holds, either sign. */
const FACTORS = [-MAXIMUM_EDIT_GAIN, -1, -0.5, 0, 0.25, 1, MAXIMUM_EDIT_GAIN];

/** How many proposals a chain or a region's processing is given. */
const PROPOSALS = 4;

/** Each asset given a small random chain, pastes reading any asset of `assets`. */
export function withRandomEdits(
  random: Random,
  ids: IdGenerator,
  assets: ReadonlyMap<AssetId, Asset>,
  context: PlanContext,
): Map<AssetId, Asset> {
  const edited = new Map(assets);
  for (const asset of assets.values()) {
    const edits: EditOperation[] = [];
    let shape = sourceShape(asset);
    for (let proposal = 0; proposal < PROPOSALS; proposal += 1) {
      const current = { ...asset, edits: [...edits] };
      edited.set(asset.id, current);
      const operation = proposeOperation(random, ids, shape, current, edited, context);
      if (
        operation === undefined ||
        !validateOperation(operation, shape, edited, context.chains).ok
      ) {
        continue;
      }
      edits.push(operation);
      shape = shapeAfter(shape, operation);
    }
    const rack = randomRack(random, context);
    edited.set(asset.id, { ...asset, edits, ...(rack === undefined ? {} : { rack }) });
  }
  return edited;
}

/**
 * A random edit for the end of `asset`'s chain, pastes reading any asset of
 * `assets`, or `undefined` where the one proposed is not valid there.
 */
export function randomOperation(
  random: Random,
  ids: IdGenerator,
  asset: Asset,
  assets: ReadonlyMap<AssetId, Asset>,
  context: PlanContext,
): EditOperation | undefined {
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) return undefined;
  const operation = proposeOperation(random, ids, shape, asset, assets, context);
  return operation !== undefined && validateOperation(operation, shape, assets, context.chains).ok
    ? operation
    : undefined;
}

/** One of the project's chains, now and then, as a target's rack. */
function randomRack(random: Random, context: PlanContext): Asset['rack'] {
  const chains = [...context.chains.keys()];
  return chains.length > 0 && random.chance(0.3) ? random.pick(chains) : undefined;
}

/**
 * Random processing for the end of `region`'s chain, or `undefined` where the
 * one proposed is not valid there.
 */
export function randomRegionOperation(
  random: Random,
  ids: IdGenerator,
  asset: Asset,
  region: Region,
  context: PlanContext,
): RegionOperation | undefined {
  const operation = proposeRegionOperation(random, ids, shapesOf(asset), context);
  if (operation === undefined) return undefined;
  const proposed = { ...region, operations: [...region.operations, operation] };
  return validateRegion(asset, proposed, context.chains).ok ? operation : undefined;
}

/** A random span of a timeline of `length`, or none where it holds no audio. */
function randomRange(random: Random, length: number): EditRange | undefined {
  if (length < 1) return undefined;
  const start = random.below(length);
  return {
    start: expectSuccess(sampleCount(start)),
    end: expectSuccess(sampleCount(start + 1 + random.below(length - start))),
  };
}

/** A random ascending, non-empty set of `count` channels. */
function randomScope(random: Random, count: number): readonly number[] {
  const scope = Array.from({ length: count }, (_, channel) => channel).filter(() =>
    random.chance(0.5),
  );
  return scope.length > 0 ? scope : [random.below(count)];
}

/** Two different channels of `count`, where it has two. */
function channelPair(random: Random, count: number): readonly [number, number] | undefined {
  if (count < 2) return undefined;
  const first = random.below(count);
  return [first, (first + 1 + random.below(count - 1)) % count];
}

/** A random range edit for `count` channels, with a channel scope where it takes one. */
function randomRangeEdit(
  random: Random,
  count: number,
  context: PlanContext,
): { readonly edit: RangeEdit; readonly channels?: readonly number[] } | undefined {
  const scope = (edit: RangeEdit) => {
    const channels = maybe(random, () => randomScope(random, count));
    return { edit, ...(channels === undefined ? {} : { channels }) };
  };
  switch (random.below(8)) {
    case 7: {
      const chains = [...context.chains.keys()];
      return chains.length === 0
        ? undefined
        : { edit: { kind: 'rack', chain: random.pick(chains) } };
    }
    case 0:
      return scope({ kind: 'gain', gain: random.pick(GAINS) });
    case 1:
      return scope({
        kind: 'fade',
        direction: random.pick(Object.values(FadeDirection)),
        shape: random.pick(Object.values(FadeShape)),
      });
    case 2:
      return scope({ kind: 'silence' });
    case 3:
      return scope({ kind: 'invert' });
    case 4: {
      const pair = channelPair(random, count);
      return pair === undefined
        ? undefined
        : { edit: { kind: 'swap-channels', first: pair[0], second: pair[1] } };
    }
    case 5: {
      const pair = channelPair(random, count);
      return pair === undefined
        ? undefined
        : { edit: { kind: 'copy-channel', from: pair[0], to: pair[1] } };
    }
    default:
      return {
        edit: {
          kind: 'channel-gains',
          gains: Array.from({ length: count }, () => random.pick(GAINS)),
        },
      };
  }
}

/** A random operation for a timeline of `shape`, which may not be valid there. */
function proposeOperation(
  random: Random,
  ids: IdGenerator,
  shape: EditShape,
  asset: Asset,
  assets: ReadonlyMap<AssetId, Asset>,
  context: PlanContext,
): EditOperation | undefined {
  const id = ids.next<'EditOperationId'>();
  const count = channelCount(shape.layout);
  switch (random.below(8)) {
    case 0:
    case 1: {
      const range = randomRange(random, shape.length);
      const kind = random.pick(['delete', 'trim', 'reverse'] as const);
      return range === undefined ? undefined : { id, kind, range };
    }
    case 2: {
      const range = randomRange(random, shape.length);
      const edit = randomRangeEdit(random, count, context);
      return range === undefined || edit === undefined
        ? undefined
        : { id, kind: 'process', range, ...edit };
    }
    case 3:
    case 4:
      return proposePaste(random, id, shape, asset, assets, context);
    case 5: {
      const range = randomRange(random, shape.length);
      if (range === undefined) return undefined;
      const before = range.end - range.start;
      const length = Math.max(1, Math.round(before * random.pick([0.25, 0.5, 1.5, 2, 4])));
      return {
        id,
        kind: 'stretch',
        range,
        length: expectSuccess(sampleCount(length)),
        version: context.engine.stretch,
      };
    }
    case 6: {
      const rates = RATES.filter((rate) => rate !== shape.sampleRate);
      return {
        id,
        kind: 'convert-rate',
        sampleRate: expectSuccess(sampleRate(random.pick(rates))),
        version: context.engine.resampler,
      };
    }
    default: {
      const layout = randomLayout(random);
      const stated = conversionMatrix(shape.layout, layout);
      const matrix =
        stated.ok && random.chance(0.5)
          ? stated.value
          : Array.from({ length: channelCount(layout) }, () =>
              Array.from({ length: count }, () => random.pick(FACTORS)),
            );
      return { id, kind: 'convert-layout', layout, matrix };
    }
  }
}

/**
 * An insertion at a random place: of generated silence at the timeline's rate
 * and layout, or a paste of a slice of an asset's edited sound, this asset's
 * own or another's, which may be at another rate and is then converted, and
 * may itself hold silence an earlier insertion made.
 */
function proposePaste(
  random: Random,
  id: EditOperation['id'],
  shape: EditShape,
  asset: Asset,
  assets: ReadonlyMap<AssetId, Asset>,
  context: PlanContext,
): EditOperation | undefined {
  if (random.chance(0.25)) {
    return {
      id,
      kind: 'insert',
      at: randomCount(random, shape.length),
      payload: silencePlan(
        shape.sampleRate,
        shape.layout,
        expectSuccess(sampleCount(1 + random.below(2_000))),
      ),
    };
  }
  const from = random.chance(0.5) ? asset : random.pick([...assets.values()]);
  const made = assetPlan(from, context);
  if (!made.ok) return undefined;
  const plan = made.value;
  const range = randomRange(random, streamLength(plan.streams[0]));
  if (range === undefined) return undefined;
  const payload = slicePlan(plan, range.start, range.end);
  if (!payload.ok) return undefined;
  return {
    id,
    kind: 'insert',
    at: randomCount(random, shape.length),
    payload: payload.value,
    ...(payload.value.streams[0].sampleRate === shape.sampleRate
      ? {}
      : { resampler: context.engine.resampler }),
  };
}

/** A random region on `asset`, where some point of its chain holds audio. */
export function randomRegion(
  random: Random,
  ids: IdGenerator,
  asset: Asset,
  context: PlanContext,
): Region | undefined {
  const shapes = shapesOf(asset);
  const basis = random.below(shapes.length);
  const bounds = randomRange(random, shapes[basis]?.length ?? 0);
  if (bounds === undefined) return undefined;
  const loop = maybe(random, () => randomLoop(random, shapes));
  const tags = [
    ...new Set(Array.from({ length: random.below(4) }, () => randomName(random))),
  ].sort();
  let region: Region = {
    id: ids.next<'RegionId'>(),
    assetId: asset.id,
    displayName: randomName(random),
    basis,
    start: bounds.start,
    end: bounds.end,
    ...(loop === undefined ? {} : { loop }),
    tags,
    operations: [],
  };
  for (let proposal = 0; proposal < PROPOSALS; proposal += 1) {
    const operation = proposeRegionOperation(random, ids, shapes, context);
    if (operation === undefined) continue;
    const proposed = { ...region, operations: [...region.operations, operation] };
    if (validateRegion(asset, proposed, context.chains).ok) region = proposed;
  }
  const rack = randomRack(random, context);
  if (rack !== undefined) region = { ...region, rack };
  return validateRegion(asset, region, context.chains).ok ? region : undefined;
}

function randomLoop(random: Random, shapes: readonly EditShape[]): AnchoredLoop | undefined {
  const basis = random.below(shapes.length);
  const span = randomRange(random, shapes[basis]?.length ?? 0);
  return span === undefined
    ? undefined
    : { basis, ...span, crossfadeLength: randomCount(random, span.end - span.start) };
}

function proposeRegionOperation(
  random: Random,
  ids: IdGenerator,
  shapes: readonly EditShape[],
  context: PlanContext,
): RegionOperation | undefined {
  const basis = random.below(shapes.length);
  const shape = shapes[basis];
  if (shape === undefined) return undefined;
  const range = randomRange(random, shape.length);
  const edit = randomRangeEdit(random, channelCount(shape.layout), context);
  return range === undefined || edit === undefined
    ? undefined
    : { id: ids.next<'EditOperationId'>(), basis, range, ...edit };
}

/** A random marker on `asset`, at any basis of its chain. */
export function randomMarker(random: Random, ids: IdGenerator, asset: Asset): Marker {
  const shapes = shapesOf(asset);
  const basis = random.below(shapes.length);
  const paletteKey = maybe(random, () => 'rose');
  const marker: Marker = {
    id: ids.next<'MarkerId'>(),
    assetId: asset.id,
    displayName: randomName(random),
    basis,
    position: randomCount(random, shapes[basis]?.length ?? 0),
    ...(paletteKey === undefined ? {} : { paletteKey }),
  };
  return expectSuccess(validateMarker(asset, marker));
}
