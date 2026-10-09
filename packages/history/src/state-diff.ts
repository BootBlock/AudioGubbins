/**
 * The structural difference between two project states: what was added, removed
 * and changed in each kind of entity, which fields changed, and, for effect
 * chains, each slot's placement, switches and parameter values
 * (`chain-differences.ts`, REQ-STOR-195).
 *
 * A take stack's takes are compared as a list, so naming, choosing, rejecting
 * or removing a take is a difference of its stack.
 *
 * A difference is a value the History panel and the A/B comparison show, and
 * the source of the entities a change affects. Everything is in a fixed order,
 * identifiers by code unit, so the same two states always give the same
 * difference. A map or an entity the two states share is skipped by identity
 * before anything in it is compared, which is what keeps the difference of two
 * neighbouring states cheap in a large project.
 */

import type {
  AssetId,
  Asset,
  Bus,
  BusId,
  Clip,
  ClipId,
  Marker,
  MarkerId,
  Region,
  RegionId,
  TakeStack,
  TakeStackId,
  Track,
  TrackId,
} from '@audiogubbins/domain';
import {
  compareCodeUnits,
  type AssetSource,
  type ProjectState,
} from '@audiogubbins/project-format';

import {
  ASSET_FIELDS,
  BUS_FIELDS,
  CLIP_FIELDS,
  MARKER_FIELDS,
  REGION_FIELDS,
  SOURCE_FIELDS,
  TAKE_STACK_FIELDS,
  TRACK_FIELDS,
  changedFields,
  sameLayout,
  sameList,
  type FieldComparisons,
  type FieldOf,
} from './entity-fields.js';
import { chainDifferences, type ChainDifference } from './chain-differences.js';

/** An entity present in both states whose fields differ. */
export interface EntityChange<TId extends string, TEntity> {
  readonly id: TId;
  readonly fields: readonly FieldOf<TEntity>[];
}

/** How the entities of one kind differ, each list sorted by identifier. */
export interface EntityDifferences<TId extends string, TEntity> {
  readonly added: readonly TId[];
  readonly removed: readonly TId[];
  readonly changed: readonly EntityChange<TId, TEntity>[];
}

/** A field of the project itself. */
export type ProjectField = 'displayName' | 'sampleRate' | 'channelLayout' | 'trackOrder';

/** How two project states differ. */
export interface StateDifference {
  readonly project: readonly ProjectField[];
  readonly assets: EntityDifferences<AssetId, Asset>;

  /** Where each asset's bytes come from, and how it was imported. */
  readonly sources: EntityDifferences<AssetId, AssetSource>;
  readonly tracks: EntityDifferences<TrackId, Track>;
  readonly buses: EntityDifferences<BusId, Bus>;
  readonly clips: EntityDifferences<ClipId, Clip>;
  readonly regions: EntityDifferences<RegionId, Region>;
  readonly markers: EntityDifferences<MarkerId, Marker>;
  readonly effectChains: readonly ChainDifference[];

  /** The stacks of recorded takes, and the punch of each that has one. */
  readonly takeStacks: EntityDifferences<TakeStackId, TakeStack>;
}

/** The difference from state `before` to state `after`. */
export function diffStates(before: ProjectState, after: ProjectState): StateDifference {
  const was = before.project;
  const is = after.project;
  return {
    project: projectFields(before, after),
    assets: entityDifferences(was.assets, is.assets, ASSET_FIELDS),
    sources: entityDifferences(before.sources, after.sources, SOURCE_FIELDS),
    tracks: entityDifferences(was.tracks, is.tracks, TRACK_FIELDS),
    buses: entityDifferences(was.buses, is.buses, BUS_FIELDS),
    clips: entityDifferences(was.clips, is.clips, CLIP_FIELDS),
    regions: entityDifferences(was.regions, is.regions, REGION_FIELDS),
    markers: entityDifferences(was.markers, is.markers, MARKER_FIELDS),
    effectChains: chainDifferences(was.effectChains, is.effectChains),
    takeStacks: entityDifferences(was.takeStacks, is.takeStacks, TAKE_STACK_FIELDS),
  };
}

function projectFields(before: ProjectState, after: ProjectState): readonly ProjectField[] {
  const was = before.project;
  const is = after.project;
  const fields: ProjectField[] = [];
  if (was.displayName !== is.displayName) fields.push('displayName');
  if (was.settings.sampleRate !== is.settings.sampleRate) fields.push('sampleRate');
  if (!sameLayout(was.settings.channelLayout, is.settings.channelLayout)) {
    fields.push('channelLayout');
  }
  if (!sameList(was.trackOrder, is.trackOrder)) fields.push('trackOrder');
  return fields;
}

const NO_DIFFERENCES = { added: [], removed: [], changed: [] } as const;

function entityDifferences<TId extends string, TEntity>(
  before: ReadonlyMap<TId, TEntity>,
  after: ReadonlyMap<TId, TEntity>,
  comparisons: FieldComparisons<TEntity>,
): EntityDifferences<TId, TEntity> {
  if (before === after) return NO_DIFFERENCES;
  const added: TId[] = [];
  const removed: TId[] = [];
  const changed: EntityChange<TId, TEntity>[] = [];
  for (const [id, entity] of after) {
    const previous = before.get(id);
    if (previous === undefined) {
      added.push(id);
    } else if (previous !== entity) {
      const fields = changedFields(comparisons, previous, entity);
      if (fields.length > 0) changed.push({ id, fields });
    }
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  return {
    added: added.sort(compareCodeUnits),
    removed: removed.sort(compareCodeUnits),
    changed: changed.sort((left, right) => compareCodeUnits(left.id, right.id)),
  };
}
