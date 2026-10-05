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
 * why.
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
  channelCount,
  derivedSampleCount,
  markersInRegion,
  placeMarkers,
  placeRegion,
  placeRegions,
  planReadsAsset,
  regionPlan,
  streamLength,
  type AnchorResolver,
  type Asset,
  type AssetId,
  type EditPlan,
  type Marker,
  type PlacedMarker,
  type Project,
  type Region,
  type RegionId,
} from '@audiogubbins/domain';
import { PcmDescriptionKind, type MediaEntry } from '@audiogubbins/audio-engine';
import type { AssetSource, ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { quoted } from '../wording.js';
import { revisionOf, type EditorAsset } from './editor-asset.js';
import { sameRecord, sameRecords } from './record-values.js';

/** Whether the page holds the file an asset's media is kept in. */
export type MediaAvailability =
  | { readonly kind: 'finding' }
  | { readonly kind: 'found'; readonly file: Blob }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** An asset or region of the project as a view opens it, or why it cannot open yet. */
export type ProjectEntry =
  | { readonly kind: 'open'; readonly asset: EditorAsset }
  | {
      readonly kind: 'finding' | 'unavailable';
      readonly id: string;
      readonly name: string;
      /** Why it cannot be opened, as a reader is told. */
      readonly reason: string;
    };

/** The entries of one state of the project, by the identity a view names. */
export type ProjectEntries = ReadonlyMap<string, ProjectEntry>;

/** The assets an entry reads the media of, where each is kept, and the file the page holds of each. */
interface Reads {
  readonly read: readonly Asset[];
  readonly sources: readonly (AssetSource | undefined)[];
  readonly files: readonly MediaAvailability[];
}

/** An asset, with the markers and regions it owns. */
interface Owned {
  readonly asset: Asset;
  readonly markers: readonly Marker[];
  readonly regions: readonly Region[];
}

/** The entries of one asset, and the asset, markers, regions and reads they were made from. */
export interface MadeAsset extends Owned, Reads {
  /** The asset's entry, then its regions', by the identity a view names. */
  readonly entries: ReadonlyMap<string, ProjectEntry>;
}

/** The identity a view names an asset of the project by. */
export function assetEntryId(asset: AssetId): string {
  return `asset:${asset}`;
}

/** The identity a view names a region of the project by. */
export function regionEntryId(region: RegionId): string {
  return `region:${region}`;
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

/** The files `reads` names, or why one is not held. */
function mediaOf(
  reads: Reads,
):
  | { readonly kind: 'held'; readonly entries: readonly MediaEntry[] }
  | { readonly kind: 'finding' | 'unavailable'; readonly reason: string } {
  const entries: MediaEntry[] = [];
  for (const [index, asset] of reads.read.entries()) {
    const found = reads.files[index];
    if (found === undefined || found.kind === 'finding') {
      return {
        kind: 'finding',
        reason: `The audio of ${quoted(asset.displayName)} is being read.`,
      };
    }
    if (found.kind === 'unavailable') return found;
    entries.push({
      asset: asset.id,
      sampleRate: asset.sampleRate,
      channels: channelCount(asset.channelLayout),
      length: asset.length,
      file: found.file,
    });
  }
  return { kind: 'held', entries };
}

/**
 * What an asset of the project is, in a sentence, for the list an empty view
 * offers: its audio as `plan` makes it, so a conversion of its layout is told.
 */
function assetSentence(asset: Asset, plan: EditPlan): string {
  const [stream] = plan.streams;
  const shape = `${counted(channelCount(stream.layout), 'channel', 'channels')} at ${String(asset.sampleRate / 1000)} kHz`;
  return asset.edits.length === 0
    ? `Audio of the project: ${shape}.`
    : `Audio of the project: ${shape}, with ${counted(asset.edits.length, 'edit', 'edits')}.`;
}

/** The view of `plan`, named `id`, of the asset `owner` holds, once every file `reads` names is held. */
function openedEntry(
  made: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly owner: Extract<EditorAsset['owner'], { readonly kind: 'project' }>;
    readonly markers: readonly PlacedMarker[];
    readonly regions: EditorAsset['regions'];
  },
  reads: Reads,
): ProjectEntry {
  const { plan } = made.owner;
  const files = mediaOf(reads);
  if (files.kind !== 'held') {
    return { kind: files.kind, id: made.id, name: made.name, reason: files.reason };
  }
  const [stream] = plan.streams;
  const sampleRate = made.owner.asset.sampleRate;
  const sources = reads.sources.map((source) => source?.media);
  return {
    kind: 'open',
    asset: {
      id: made.id,
      name: made.name,
      description: made.description,
      sampleRate,
      layout: stream.layout,
      length: derivedSampleCount(streamLength(stream)),
      revision: revisionOf(JSON.stringify({ plan, sources })),
      describe: () => ({
        kind: PcmDescriptionKind.Edited,
        sampleRate,
        plan,
        media: files.entries,
      }),
      owner: made.owner,
      markers: made.markers,
      regions: made.regions,
    },
  };
}

/**
 * The entries of the project in `state`, its media held as `media` says, each
 * the entry it was in `previous` where nothing it is made from changed.
 */
export function projectEntries(
  state: ProjectState,
  media: (asset: AssetId) => MediaAvailability,
  previous: ReadonlyMap<AssetId, MadeAsset> = new Map(),
): { readonly entries: ProjectEntries; readonly made: ReadonlyMap<AssetId, MadeAsset> } {
  const own = owning(state.project);
  const made = new Map<AssetId, MadeAsset>();
  const entries = new Map<string, ProjectEntry>();
  for (const asset of state.project.assets.values()) {
    const one = madeAsset(state, own(asset), media, previous.get(asset.id));
    made.set(asset.id, one);
    for (const [id, entry] of one.entries) entries.set(id, entry);
  }
  return { entries, made };
}

/**
 * The entry a view names `id` in the project in `state`, its media held as
 * `media` says, or `undefined` where the project has none. Only the asset it is
 * of, or whose region it is, is planned.
 */
export function projectEntry(
  state: ProjectState,
  media: (asset: AssetId) => MediaAvailability,
  id: string,
): ProjectEntry | undefined {
  const { project } = state;
  const owner =
    [...project.assets.values()].find((asset) => assetEntryId(asset.id) === id)?.id ??
    [...project.regions.values()].find((region) => regionEntryId(region.id) === id)?.assetId;
  const asset = owner === undefined ? undefined : project.assets.get(owner);
  if (asset === undefined) return undefined;
  return madeAsset(state, owning(project)(asset), media, undefined).entries.get(id);
}

/** What an asset's entries are placed by, worked out only where one is made. */
interface Placed {
  readonly resolver: AnchorResolver;
  readonly plan: EditPlan;
  readonly markers: readonly PlacedMarker[];
}

/** What `own` is placed by, worked out the first time it is asked for and held after. */
function placing(own: Owned): () => Placed {
  let placed: Placed | undefined;
  return () => {
    if (placed !== undefined) return placed;
    const resolver = anchorResolver(own.asset);
    // A stable sort, so markers at one position keep the project's order.
    const markers = placeMarkers(own.asset, own.markers, resolver).toSorted(
      (one, other) => one.position - other.position,
    );
    placed = { resolver, plan: assetPlan(own.asset), markers };
    return placed;
  };
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
): MadeAsset {
  const place = placing(own);
  const unchanged = before !== undefined && sameRecord(before.asset, own.asset);
  const read = unchanged
    ? before.read.flatMap((one) => state.project.assets.get(one.id) ?? [])
    : assetsRead(state, place().plan);
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
  return { ...own, ...reads, entries: entriesOf(own, reads, place, kept) };
}

/** The entries of `own.asset`, each the one `kept` holds where its regions are the ones it held. */
function entriesOf(
  own: Owned,
  reads: Reads,
  place: () => Placed,
  kept: MadeAsset | undefined,
): ReadonlyMap<string, ProjectEntry> {
  const { asset } = own;
  const sameRegions = kept !== undefined && sameRecords(kept.regions, own.regions);
  const entries = new Map<string, ProjectEntry>();
  const id = assetEntryId(asset.id);
  entries.set(
    id,
    (sameRegions ? kept.entries.get(id) : undefined) ??
      openedEntry(
        {
          id,
          name: asset.displayName,
          description: assetSentence(asset, place().plan),
          owner: { kind: 'project', asset, plan: place().plan, offset: derivedSampleCount(0) },
          markers: place().markers,
          regions: placeRegions(asset, own.regions, place().resolver),
        },
        reads,
      ),
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
        regionEntry({ asset, region, markers: place().markers, resolver: place().resolver }, reads),
    );
  }
  return entries;
}

/** Why a region whose audio every later edit removed cannot be shown. */
const GONE = 'Nothing of it is left: the edits made since it was placed removed all of its audio.';

/**
 * The view of `region`: the slice of its asset it covers, with its own
 * processing, or why there is none, where the edits since removed all of it.
 */
function regionEntry(
  parts: {
    readonly asset: Asset;
    readonly region: Region;
    readonly markers: readonly PlacedMarker[];
    readonly resolver: AnchorResolver;
  },
  reads: Reads,
): ProjectEntry {
  const { asset, region, markers, resolver } = parts;
  const id = regionEntryId(region.id);
  const placed = placeRegion(resolver, region);
  if (placed === undefined || placed.length === 0) {
    return { kind: 'unavailable', id, name: region.displayName, reason: GONE };
  }
  return openedEntry(
    {
      id,
      name: region.displayName,
      description: `A region of ${quoted(asset.displayName)}, ${counted(placed.length, 'frame', 'frames')} long.`,
      owner: {
        kind: 'project',
        asset,
        region,
        plan: regionPlan(asset, region, resolver),
        offset: placed.start,
      },
      markers: markersInRegion(markers, placed),
      regions: [],
    },
    reads,
  );
}
