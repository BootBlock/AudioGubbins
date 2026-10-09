/**
 * Reading what is placed on an asset: regions, their loops, and markers
 * (ADR-0051, REQ-EDIT-014, REQ-EXEC-136.12).
 *
 * Each value is read alone by its shape, which is how a command reads one it
 * carries. In a project each is checked against the asset it belongs to as it
 * is read, by the domain's own validation, so every position lies on the
 * asset's timeline at the basis it states and a region's processing fits the
 * channels it names there.
 */

import {
  validateMarker,
  validateRegion,
  type AnchoredLoop,
  type Asset,
  type AssetId,
  type DomainResult,
  type Marker,
  type Region,
  type ProjectChains,
} from '@audiogubbins/domain';

import { compareCodeUnits } from './canonical-json.js';
import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type ProblemDetails,
  type Reading,
} from './document-reading.js';
import { asBasis } from './edit-value-reading.js';
import { asRegionChain } from './edit-reading.js';
import { asId, textConverter } from './scalar-reading.js';
import { MAXIMUM_NESTED_ITEMS, asKey, asName, asSampleCount } from './value-reading.js';

const REGION_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'assetId',
  'displayName',
  'basis',
  'start',
  'end',
  'loop',
  'tags',
  'operations',
  'rack',
]);
const LOOP_MEMBERS: ReadonlySet<string> = new Set(['basis', 'start', 'end', 'crossfadeLength']);
const MARKER_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'assetId',
  'displayName',
  'basis',
  'position',
  'paletteKey',
]);

const asTags = listConverter(MAXIMUM_NESTED_ITEMS, textConverter({ maximumLength: 256 }));

/** Reads a region's loop. */
export const readAnchoredLoop: Converter<AnchoredLoop> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LOOP_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const basis = required(reading, object, at, 'basis', asBasis);
  const start = required(reading, object, at, 'start', asSampleCount);
  const end = required(reading, object, at, 'end', asSampleCount);
  const crossfadeLength = required(reading, object, at, 'crossfadeLength', asSampleCount);
  return basis === undefined ||
    start === undefined ||
    end === undefined ||
    crossfadeLength === undefined
    ? undefined
    : { basis, start, end, crossfadeLength };
};

/**
 * Whether a region's tags are held sorted and without repeats, so equal sets
 * compare equal, refusing them where they are not.
 */
function canonicalTags(reading: Reading, tags: readonly string[], at: string): boolean {
  const sorted = tags.every(
    (tag, index) => index === 0 || compareCodeUnits(tags[index - 1] ?? '', tag) < 0,
  );
  if (!sorted) {
    reading.refuse(
      'project.region-tags-not-canonical',
      'A region holds its tags sorted and without repeats.',
      pathOf(at, 'tags'),
    );
  }
  return sorted;
}

/** Reads one region. */
export const readRegion: Converter<Region> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, REGION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'RegionId'>);
  const assetId = required(reading, object, at, 'assetId', asId<'AssetId'>);
  const displayName = required(reading, object, at, 'displayName', asName);
  const basis = required(reading, object, at, 'basis', asBasis);
  const start = required(reading, object, at, 'start', asSampleCount);
  const end = required(reading, object, at, 'end', asSampleCount);
  const loop = optional(reading, object, at, 'loop', readAnchoredLoop);
  const tags = required(reading, object, at, 'tags', asTags);
  const operations = required(reading, object, at, 'operations', asRegionChain);
  const rack = optional(reading, object, at, 'rack', asId<'EffectChainId'>);

  if (tags !== undefined && !canonicalTags(reading, tags, at)) return undefined;
  if (
    id === undefined ||
    assetId === undefined ||
    displayName === undefined ||
    basis === undefined ||
    start === undefined ||
    end === undefined ||
    tags === undefined ||
    operations === undefined
  ) {
    return undefined;
  }
  return {
    id,
    assetId,
    displayName,
    basis,
    start,
    end,
    ...(loop === undefined ? {} : { loop }),
    tags,
    operations,
    ...(rack === undefined ? {} : { rack }),
  };
};

/** Reads one marker. */
export const readMarker: Converter<Marker> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, MARKER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'MarkerId'>);
  const assetId = required(reading, object, at, 'assetId', asId<'AssetId'>);
  const displayName = required(reading, object, at, 'displayName', asName);
  const basis = required(reading, object, at, 'basis', asBasis);
  const position = required(reading, object, at, 'position', asSampleCount);
  const paletteKey = optional(reading, object, at, 'paletteKey', asKey);

  if (
    id === undefined ||
    assetId === undefined ||
    displayName === undefined ||
    basis === undefined ||
    position === undefined
  ) {
    return undefined;
  }
  return {
    id,
    assetId,
    displayName,
    basis,
    position,
    ...(paletteKey === undefined ? {} : { paletteKey }),
  };
};

/**
 * The assets a project's placed values are checked against: every asset read,
 * to find the one a value names, and those whose chains hold, the only ones a
 * position can be resolved on. A value on an asset whose chain was refused is
 * not refused again for it.
 */
export interface PlacementAssets {
  readonly all: ReadonlyMap<AssetId, Asset>;
  readonly sound: ReadonlyMap<AssetId, Asset>;
  /** The project's chains, which a region's processing and rack may name. */
  readonly chains: ProjectChains;
}

/** A converter reading what `read` reads, checked against the asset it names. */
function placedConverter<TValue extends { readonly assetId: AssetId }>(
  read: Converter<TValue>,
  assets: PlacementAssets | undefined,
  validate: (asset: Asset, value: TValue, chains: ProjectChains) => DomainResult<TValue>,
  code: string,
): Converter<TValue> {
  return (reading, value, parent, key) => {
    const placed = read(reading, value, parent, key);
    if (placed === undefined || assets === undefined) return placed;
    const at = pathOf(parent, key);
    if (!assets.all.has(placed.assetId)) {
      reading.refuse(
        'project.unknown-asset',
        'It belongs to an asset the project does not have.',
        pathOf(at, 'assetId'),
      );
      return placed;
    }
    const asset = assets.sound.get(placed.assetId);
    if (asset !== undefined) {
      refuseFailed(reading, validate(asset, placed, assets.chains), code, at);
    }
    return placed;
  };
}

/**
 * Records a refusal of the domain's validation under `code`, with the
 * domain's own sentence and its code as the cause, so the document's codes
 * stay the format's while the reason stays the one a command gives.
 */
export function refuseFailed(
  reading: Reading,
  result: DomainResult<unknown>,
  code: string,
  at: string,
  details: ProblemDetails = {},
): void {
  if (result.ok) return;
  for (const problem of result.failures) {
    reading.refuse(code, problem.summary, at, { ...details, cause: problem.code });
  }
}

/** A converter reading a project's region, checked against its asset. */
export function regionConverter(assets: PlacementAssets | undefined): Converter<Region> {
  return placedConverter(readRegion, assets, validateRegion, 'project.region-off-asset');
}

/** A converter reading a project's marker, checked against its asset. */
export function markerConverter(assets: PlacementAssets | undefined): Converter<Marker> {
  return placedConverter(readMarker, assets, validateMarker, 'project.marker-off-asset');
}
