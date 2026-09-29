/**
 * The structural difference between two project states: what was added, removed
 * and changed in each kind of entity, which fields changed, and, for effect
 * chains, each processor's placement, switches and parameter values
 * (REQ-STOR-195).
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
  EffectChain,
  EffectChainId,
  Marker,
  MarkerId,
  ParameterId,
  ParameterValue,
  ProcessorId,
  ProcessorInstance,
  Region,
  RegionId,
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
  TRACK_FIELDS,
  changedFields,
  sameLayout,
  sameList,
  type FieldComparisons,
  type FieldOf,
} from './entity-fields.js';
import { unmovedPositions } from './order-changes.js';

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

/** A parameter whose value differs; a side is absent where it had no value. */
export interface ParameterChange {
  readonly id: ParameterId;
  readonly before?: ParameterValue;
  readonly after?: ParameterValue;
}

/** How one processor differs between the two versions of its chain. */
export interface ProcessorDifference {
  readonly id: ProcessorId;
  readonly change: 'added' | 'removed' | 'changed';
  readonly typeKey: string;

  /** Its place in the chain before and after, from 0, where it had one. */
  readonly before?: number;
  readonly after?: number;

  /**
   * Whether it moved relative to the processors around it. A processor that
   * only shifted because another was added or removed has not moved.
   */
  readonly moved: boolean;
  readonly fields: readonly ('typeKey' | 'enabled' | 'soloed')[];
  readonly parameters: readonly ParameterChange[];
}

/** How one effect chain differs. */
export interface ChainDifference {
  readonly id: EffectChainId;
  readonly change: 'added' | 'removed' | 'changed';

  /** In the chain's order after, then those removed in the order before. */
  readonly processors: readonly ProcessorDifference[];
}

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

function chainDifferences(
  before: ReadonlyMap<EffectChainId, EffectChain>,
  after: ReadonlyMap<EffectChainId, EffectChain>,
): readonly ChainDifference[] {
  if (before === after) return [];
  const differences: ChainDifference[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of [...ids].sort(compareCodeUnits)) {
    const was = before.get(id);
    const is = after.get(id);
    if (was === is) continue;
    const processors = processorDifferences(was?.processors ?? [], is?.processors ?? []);
    if (was !== undefined && is !== undefined && processors.length === 0) continue;
    const change = was === undefined ? 'added' : is === undefined ? 'removed' : 'changed';
    differences.push({ id, change, processors });
  }
  return differences;
}

function processorDifferences(
  before: readonly ProcessorInstance[],
  after: readonly ProcessorInstance[],
): readonly ProcessorDifference[] {
  const placeBefore = new Map(before.map((processor, index) => [processor.id, index]));
  const kept = after.filter((processor) => placeBefore.has(processor.id));
  const unmoved = unmovedPositions(kept.map((processor) => placeBefore.get(processor.id) ?? 0));

  const differences: ProcessorDifference[] = [];
  let keptIndex = 0;
  for (const [index, processor] of after.entries()) {
    const place = placeBefore.get(processor.id);
    const previous = place === undefined ? undefined : before[place];
    if (place === undefined || previous === undefined) {
      differences.push(alone(processor, 'added', index));
      continue;
    }
    const moved = !unmoved.has(keptIndex);
    keptIndex += 1;
    const fields = processorFields(previous, processor);
    const parameters = parameterChanges(previous.values, processor.values);
    if (!moved && fields.length === 0 && parameters.length === 0) continue;
    differences.push({
      id: processor.id,
      change: 'changed',
      typeKey: processor.typeKey,
      before: place,
      after: index,
      moved,
      fields,
      parameters,
    });
  }

  const present = new Set(after.map((processor) => processor.id));
  for (const [index, processor] of before.entries()) {
    if (!present.has(processor.id)) differences.push(alone(processor, 'removed', index));
  }
  return differences;
}

/**
 * A processor only one version of the chain holds, with every parameter value
 * it had or has.
 */
function alone(
  processor: ProcessorInstance,
  change: 'added' | 'removed',
  place: number,
): ProcessorDifference {
  const none = new Map<ParameterId, ParameterValue>();
  return {
    id: processor.id,
    change,
    typeKey: processor.typeKey,
    ...(change === 'added' ? { after: place } : { before: place }),
    moved: false,
    fields: [],
    parameters:
      change === 'added'
        ? parameterChanges(none, processor.values)
        : parameterChanges(processor.values, none),
  };
}

function processorFields(
  before: ProcessorInstance,
  after: ProcessorInstance,
): ProcessorDifference['fields'] {
  const fields: ('typeKey' | 'enabled' | 'soloed')[] = [];
  if (before.typeKey !== after.typeKey) fields.push('typeKey');
  if (before.enabled !== after.enabled) fields.push('enabled');
  if (before.soloed !== after.soloed) fields.push('soloed');
  return fields;
}

function parameterChanges(
  before: ReadonlyMap<ParameterId, ParameterValue>,
  after: ReadonlyMap<ParameterId, ParameterValue>,
): readonly ParameterChange[] {
  if (before === after) return [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes: ParameterChange[] = [];
  for (const id of [...ids].sort(compareCodeUnits)) {
    const was = before.get(id);
    const is = after.get(id);
    if (Object.is(was, is)) continue;
    changes.push({
      id,
      ...(was === undefined ? {} : { before: was }),
      ...(is === undefined ? {} : { after: is }),
    });
  }
  return changes;
}
