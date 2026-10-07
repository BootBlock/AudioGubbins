/**
 * The open project's assets and regions as an editor view opens them
 * (ADR-0051, ADR-0052): each its edit plan over the files the plan reads,
 * with its markers and regions placed on its edited timeline.
 *
 * An asset is named `asset:<id>` and a region `region:<id>`, so a view names
 * either across sessions. What a view hears is the plan: the asset's chain as
 * it stands, or the region's slice of it with the region's own processing; its
 * revision is a fingerprint of that plan and of the media it reads, so peaks
 * kept for one state of the chain are never drawn for another. A view opens
 * only once the page holds every file its plan reads, and until then it says
 * why; and one whose chains run a model this page cannot run says why too
 * (`model-gate.ts`), the project kept as it is.
 *
 * Made again from each state of the project, but an entry whose asset, markers,
 * regions, sources and files are the ones it was made from is the entry it was,
 * so a view of an asset nothing changed redraws nothing, and an asset is
 * planned, and its markers and regions placed, only where an entry of it is
 * made again. A record of the project is compared by the values it holds
 * (`record-values.ts`); the files the page holds are compared by identity,
 * since each is held once.
 */

import {
  anchorResolver,
  assetPlan,
  derivedSampleCount,
  unrackedAssetPlan,
  placeMarkers,
  placeRegions,
  planReadsAsset,
  type AnchorResolver,
  type Asset,
  type AssetId,
  type DomainResult,
  type EditPlan,
  type EffectChain,
  type EffectChainId,
  type Marker,
  type PlacedMarker,
  type PlanContext,
  type Project,
  type RangeEdit,
  type Region,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import { planModelRefusal, type ModelGate } from './model-gate.js';
import { sameRecord, sameRecords } from './record-values.js';
import {
  assetEntryId,
  assetSentence,
  openedEntry,
  regionEntry,
  regionEntryId,
  type MediaAvailability,
  type ProjectEntries,
  type ProjectEntry,
  type Reads,
} from './project-entry.js';

/** An asset, with the markers and regions it owns. */
interface Owned {
  readonly asset: Asset;
  readonly markers: readonly Marker[];
  readonly regions: readonly Region[];
}

/**
 * The entries of one asset, and the asset, markers, regions, reads and chains
 * they were made from.
 */
export interface MadeAsset extends Owned, Reads {
  readonly chains: readonly (EffectChain | undefined)[];
  /** The asset's entry, then its regions', by the identity a view names. */
  readonly entries: ReadonlyMap<string, ProjectEntry>;
}

/** What each asset owns of `items`, in the project's order. */
function byAsset<Item extends { readonly assetId: AssetId }>(
  items: Iterable<Item>,
): ReadonlyMap<AssetId, readonly Item[]> {
  const owned = new Map<AssetId, Item[]>();
  for (const item of items) {
    const list = owned.get(item.assetId);
    if (list === undefined) owned.set(item.assetId, [item]);
    else list.push(item);
  }
  return owned;
}

/** Each asset of `project` with what it owns, its markers and regions sorted out once for all. */
function owning(project: Project): (asset: Asset) => Owned {
  const markers = byAsset(project.markers.values());
  const regions = byAsset(project.regions.values());
  return (asset) => ({
    asset,
    markers: markers.get(asset.id) ?? [],
    regions: regions.get(asset.id) ?? [],
  });
}

/** The assets of `state` whose media `plan` reads, in the project's order. */
function assetsRead(state: ProjectState, plan: EditPlan): readonly Asset[] {
  return [...state.project.assets.values()].filter((asset) => planReadsAsset(plan, asset.id));
}

/**
 * The entries of the project in `state`, its media held as `media` says and
 * its models as `models` says, each the entry it was in `previous` where
 * nothing it is made from changed; a caller whose models change passes no
 * `previous`.
 */
export function projectEntries(
  state: ProjectState,
  media: (asset: AssetId) => MediaAvailability,
  models: ModelGate,
  previous: ReadonlyMap<AssetId, MadeAsset> = new Map(),
): { readonly entries: ProjectEntries; readonly made: ReadonlyMap<AssetId, MadeAsset> } {
  const own = owning(state.project);
  const made = new Map<AssetId, MadeAsset>();
  const entries = new Map<string, ProjectEntry>();
  for (const asset of state.project.assets.values()) {
    const one = madeAsset(state, own(asset), media, previous.get(asset.id), models);
    made.set(asset.id, one);
    for (const [id, entry] of one.entries) entries.set(id, entry);
  }
  return { entries, made };
}

/**
 * The entry a view names `id` in the project in `state`, its media held as
 * `media` says and its models as `models` says, or `undefined` where the
 * project has none. Only the asset it is of, or whose region it is, is
 * planned.
 */
export function projectEntry(
  state: ProjectState,
  media: (asset: AssetId) => MediaAvailability,
  models: ModelGate,
  id: string,
): ProjectEntry | undefined {
  const { project } = state;
  const owner =
    [...project.assets.values()].find((asset) => assetEntryId(asset.id) === id)?.id ??
    [...project.regions.values()].find((region) => regionEntryId(region.id) === id)?.assetId;
  const asset = owner === undefined ? undefined : project.assets.get(owner);
  if (asset === undefined) return undefined;
  return madeAsset(state, owning(project)(asset), media, undefined, models).entries.get(id);
}

/**
 * What an asset's entries are placed by, worked out only where one is made:
 * its plan, or why it has none, where a chain it names cannot run.
 */
interface Placed {
  readonly resolver: AnchorResolver;
  readonly plan: DomainResult<EditPlan>;
  /** Its plan before its rack, where it has one, which a rack edit over a range of it reads. */
  readonly unracked: DomainResult<EditPlan> | undefined;
  readonly markers: readonly PlacedMarker[];
}

/** What `own` is placed by, worked out the first time it is asked for and held after. */
function placing(own: Owned, context: PlanContext): () => Placed {
  let placed: Placed | undefined;
  return () => {
    if (placed !== undefined) return placed;
    const resolver = anchorResolver(own.asset);
    // A stable sort, so markers at one position keep the project's order.
    const markers = placeMarkers(own.asset, own.markers, resolver).toSorted(
      (one, other) => one.position - other.position,
    );
    placed = {
      resolver,
      plan: assetPlan(own.asset, context),
      unracked: own.asset.rack === undefined ? undefined : unrackedAssetPlan(own.asset, context),
      markers,
    };
    return placed;
  };
}

/**
 * The chains the asset's plan and its regions' plans read, in a fixed order,
 * so entries made from the same records and the same chains can be kept.
 */
function chainsNamed(
  own: Owned,
  chains: PlanContext['chains'],
): readonly (EffectChain | undefined)[] {
  const named = new Set<EffectChainId>();
  const name = (edit: RangeEdit): void => {
    if (edit.kind === 'rack') named.add(edit.chain);
  };
  if (own.asset.rack !== undefined) named.add(own.asset.rack);
  for (const operation of own.asset.edits) if (operation.kind === 'process') name(operation.edit);
  for (const region of own.regions) {
    if (region.rack !== undefined) named.add(region.rack);
    for (const operation of region.operations) name(operation.edit);
  }
  return [...named].sort().map((id) => chains.get(id));
}

/**
 * The entries of `own.asset`, each the one `before` made where nothing it is
 * made from changed. Which assets the plan reads follows from the asset alone,
 * so where the asset is unchanged they are the ones `before` read, and an asset
 * none of whose entries is made again is neither planned nor placed.
 */
function madeAsset(
  state: ProjectState,
  own: Owned,
  media: (asset: AssetId) => MediaAvailability,
  before: MadeAsset | undefined,
  models: ModelGate,
): MadeAsset {
  const context: PlanContext = {
    chains: state.project.effectChains,
    catalogue: PROCESSOR_CATALOGUE,
  };
  const place = placing(own, context);
  const chains = chainsNamed(own, context.chains);
  const unchanged =
    before !== undefined &&
    sameRecord(before.asset, own.asset) &&
    sameRecords(before.chains, chains);
  const planned = unchanged ? undefined : place().plan;
  const read = unchanged
    ? before.read.flatMap((one) => state.project.assets.get(one.id) ?? [])
    : planned?.ok === true
      ? assetsRead(state, planned.value)
      : [];
  const reads: Reads = {
    read,
    sources: read.map((one) => state.sources.get(one.id)),
    files: read.map((one) => media(one.id)),
  };
  // What every entry of the asset is made from, with a file for each asset
  // read, so the files are as many as before where the assets read are; its
  // regions are compared one by one.
  const kept =
    unchanged &&
    sameRecords(before.markers, own.markers) &&
    sameRecords(before.read, reads.read) &&
    sameRecords(before.sources, reads.sources) &&
    before.files.every((file, index) => file === reads.files[index])
      ? before
      : undefined;
  return {
    ...own,
    ...reads,
    chains,
    entries: entriesOf(own, reads, place, kept, { context, models }),
  };
}

/** The entry of the asset itself, or why it cannot open, where a chain it names cannot run. */
function assetEntry(
  own: Owned,
  reads: Reads,
  place: () => Placed,
  models: ModelGate,
): ProjectEntry {
  const { asset } = own;
  const id = assetEntryId(asset.id);
  const { plan, unracked, markers, resolver } = place();
  if (!plan.ok) {
    return { kind: 'unavailable', id, name: asset.displayName, reason: plan.failures[0].summary };
  }
  if (unracked?.ok === false) {
    return {
      kind: 'unavailable',
      id,
      name: asset.displayName,
      reason: unracked.failures[0].summary,
    };
  }
  const withoutModel = planModelRefusal(plan.value, models);
  if (withoutModel !== undefined) {
    return { kind: 'unavailable', id, name: asset.displayName, reason: withoutModel };
  }
  return openedEntry(
    {
      id,
      name: asset.displayName,
      description: assetSentence(asset, plan.value),
      owner: { kind: 'project', asset, plan: plan.value, offset: derivedSampleCount(0) },
      unracked: unracked?.value,
      markers,
      regions: placeRegions(asset, own.regions, resolver),
    },
    reads,
  );
}

/** The entries of `own.asset`, each the one `kept` holds where its regions are the ones it held. */
function entriesOf(
  own: Owned,
  reads: Reads,
  place: () => Placed,
  kept: MadeAsset | undefined,
  planning: { readonly context: PlanContext; readonly models: ModelGate },
): ReadonlyMap<string, ProjectEntry> {
  const { context, models } = planning;
  const { asset } = own;
  const sameRegions = kept !== undefined && sameRecords(kept.regions, own.regions);
  const entries = new Map<string, ProjectEntry>();
  const id = assetEntryId(asset.id);
  entries.set(
    id,
    (sameRegions ? kept.entries.get(id) : undefined) ?? assetEntry(own, reads, place, models),
  );
  const regionsBefore = new Map(
    sameRegions ? [] : (kept?.regions.map((region) => [region.id, region] as const) ?? []),
  );
  for (const region of own.regions) {
    const regionId = regionEntryId(region.id);
    const same = sameRegions || sameRecord(regionsBefore.get(region.id), region);
    entries.set(
      regionId,
      (same ? kept?.entries.get(regionId) : undefined) ??
        regionEntry(
          {
            asset,
            region,
            markers: place().markers,
            resolver: place().resolver,
            context,
            models,
          },
          reads,
        ),
    );
  }
  return entries;
}
