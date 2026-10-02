/**
 * Which fields of an entity differ between two versions of it, field by field
 * with a comparison fit for each (REQ-STOR-195).
 *
 * Each entity kind has a table naming a comparison for every one of its fields.
 * The table's type demands every field, so a field added to a domain entity
 * fails to compile here until the difference of two states says how it is
 * compared, rather than being silently left out of what a person is shown.
 */

import {
  layoutsMatch,
  type Asset,
  type AssetRange,
  type Bus,
  type ChannelLayout,
  type Clip,
  type LoopDefinition,
  type Marker,
  type Region,
  type RoutingTarget,
  type Track,
} from '@audiogubbins/domain';
import type {
  AssetProvenance,
  AssetSource,
  ExternalSourceIdentity,
  MediaSource,
} from '@audiogubbins/project-format';

/** Whether two values of a field are the same. */
type Comparison<TValue> = (before: TValue, after: TValue) => boolean;

/** A comparison for every field of an entity. */
export type FieldComparisons<TEntity> = {
  readonly [TField in keyof TEntity]-?: Comparison<TEntity[TField]>;
};

/** A field of an entity, by name. */
export type FieldOf<TEntity> = keyof TEntity & string;

function isFieldOf<TEntity>(
  comparisons: FieldComparisons<TEntity>,
  name: string,
): name is FieldOf<TEntity> {
  return Object.hasOwn(comparisons, name);
}

/** The fields whose values differ, in the order the table names them. */
export function changedFields<TEntity>(
  comparisons: FieldComparisons<TEntity>,
  before: TEntity,
  after: TEntity,
): readonly FieldOf<TEntity>[] {
  const changed: FieldOf<TEntity>[] = [];
  for (const name of Object.keys(comparisons)) {
    if (!isFieldOf(comparisons, name)) continue;
    const compare: Comparison<TEntity[FieldOf<TEntity>]> = comparisons[name];
    if (!compare(before[name], after[name])) changed.push(name);
  }
  return changed;
}

const same = <TValue>(before: TValue, after: TValue): boolean => Object.is(before, after);

/** Equal lists of values compared with `same`. */
export function sameList<TValue>(before: readonly TValue[], after: readonly TValue[]): boolean {
  return (
    before === after ||
    (before.length === after.length && before.every((value, index) => same(value, after[index])))
  );
}

/** A comparison of an optional value that compares present values with `compare`. */
function optionally<TValue>(compare: Comparison<TValue>): Comparison<TValue | undefined> {
  return (before, after) =>
    before === undefined || after === undefined ? before === after : compare(before, after);
}

/** A comparison of whole values by every field, with the table given. */
function whole<TValue>(comparisons: FieldComparisons<TValue>): Comparison<TValue> {
  return (before, after) =>
    before === after || changedFields(comparisons, before, after).length === 0;
}

export const sameLayout: Comparison<ChannelLayout> = layoutsMatch;

const sameTarget: Comparison<RoutingTarget> = (before, after) =>
  before.kind === 'bus'
    ? after.kind === 'bus' && before.busId === after.busId
    : after.kind === before.kind;

const sameRange = whole<AssetRange>({ assetId: same, start: same, length: same });

const sameLoop = whole<LoopDefinition>({ loopStart: same, loopEnd: same, crossfadeLength: same });

const sameIdentity = whole<ExternalSourceIdentity>({
  handleKey: same,
  fileName: same,
  relativePath: same,
  byteLength: same,
  lastModified: same,
  mediaType: same,
  signature: same,
  fastFingerprint: same,
  contentId: same,
});

const sameMedia: Comparison<MediaSource> = (before, after) => {
  if (before.kind === 'managed') {
    return (
      after.kind === 'managed' &&
      before.contentId === after.contentId &&
      before.byteLength === after.byteLength &&
      before.mediaType === after.mediaType
    );
  }
  return (
    after.kind === 'external' &&
    sameIdentity(before.identity, after.identity) &&
    before.policy === after.policy &&
    before.retainedCopy === after.retainedCopy
  );
};

const sameProvenance = whole<AssetProvenance>({
  originalFileName: same,
  importedAt: same,
  sourceContentId: same,
  sourceFingerprint: same,
  byteLength: same,
  mediaType: same,
  originProjectId: same,
  bitDepth: same,
});

export const ASSET_FIELDS: FieldComparisons<Asset> = {
  id: same,
  displayName: same,
  origin: same,
  sampleRate: same,
  channelLayout: sameLayout,
  length: same,
  storageKey: same,
};

export const SOURCE_FIELDS: FieldComparisons<AssetSource> = {
  media: sameMedia,
  provenance: optionally(sameProvenance),
};

export const TRACK_FIELDS: FieldComparisons<Track> = {
  id: same,
  displayName: same,
  channelLayout: sameLayout,
  gain: same,
  pan: same,
  muted: same,
  soloed: same,
  output: sameTarget,
  effectChainId: same,
  paletteKey: same,
};

export const BUS_FIELDS: FieldComparisons<Bus> = {
  id: same,
  displayName: same,
  channelLayout: sameLayout,
  gain: same,
  muted: same,
  output: optionally(sameTarget),
  effectChainId: same,
};

export const CLIP_FIELDS: FieldComparisons<Clip> = {
  id: same,
  trackId: same,
  displayName: same,
  source: sameRange,
  timelineStart: same,
  timelineLength: same,
  gain: same,
  fadeInLength: same,
  fadeOutLength: same,
  muted: same,
};

export const REGION_FIELDS: FieldComparisons<Region> = {
  id: same,
  displayName: same,
  start: same,
  length: same,
  loop: optionally(sameLoop),
  tags: sameList,
};

export const MARKER_FIELDS: FieldComparisons<Marker> = {
  id: same,
  displayName: same,
  position: same,
  paletteKey: same,
};
