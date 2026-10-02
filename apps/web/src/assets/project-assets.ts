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
 * so a view of an asset nothing changed redraws nothing. The project crosses
 * from the storage worker whole with each change, so its values are compared by
 * what they hold; the files the page holds are compared by identity, since each
 * is held once.
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
  type Asset,
  type AssetId,
  type EditPlan,
  type PlacedMarker,
  type Region,
  type RegionId,
} from '@audiogubbins/domain';
import { PcmDescriptionKind, type MediaEntry } from '@audiogubbins/audio-engine';
import type { ProjectState } from '@audiogubbins/project-format';

import { counted, quoted } from '../wording.js';
import { revisionOf, type EditorAsset } from './editor-asset.js';

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

/** An entry, and what it was made from: the project's values as text, and the files held. */
export interface MadeEntry {
  readonly from: readonly unknown[];
  readonly entry: ProjectEntry;
}

/** The identity a view names an asset of the project by. */
export function assetEntryId(asset: AssetId): string {
  return `asset:${asset}`;
}

/** The identity a view names a region of the project by. */
export function regionEntryId(region: RegionId): string {
  return `region:${region}`;
}

/** Whether two lists hold the same values in the same order, by identity. */
function sameValues(one: readonly unknown[], other: readonly unknown[]): boolean {
  return one.length === other.length && one.every((value, index) => value === other[index]);
}

/** The assets of `state` whose media `plan` reads, in the project's order. */
function assetsRead(state: ProjectState, plan: EditPlan): readonly Asset[] {
  return [...state.project.assets.values()].filter((asset) => planReadsAsset(plan, asset.id));
}

/** The files `read` is kept in, or why one is not held. */
function mediaOf(
  read: readonly Asset[],
  media: (asset: AssetId) => MediaAvailability,
):
  | { readonly kind: 'held'; readonly entries: readonly MediaEntry[] }
  | { readonly kind: 'finding' | 'unavailable'; readonly reason: string } {
  const entries: MediaEntry[] = [];
  for (const asset of read) {
    const found = media(asset.id);
    if (found.kind === 'finding') {
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

/** What an asset of the project is, in a sentence, for the list an empty view offers. */
function assetSentence(asset: Asset): string {
  const shape = `${counted(channelCount(asset.channelLayout), 'channel', 'channels')} at ${String(asset.sampleRate / 1000)} kHz`;
  return asset.edits.length === 0
    ? `Audio of the project: ${shape}.`
    : `Audio of the project: ${shape}, with ${counted(asset.edits.length, 'edit', 'edits')}.`;
}

/** The view of `plan`, named `id`, of the asset `owner` holds, once every file is held. */
function openedEntry(
  state: ProjectState,
  made: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly owner: Extract<EditorAsset['owner'], { readonly kind: 'project' }>;
    readonly markers: readonly PlacedMarker[];
    readonly regions: EditorAsset['regions'];
  },
  media: (asset: AssetId) => MediaAvailability,
): ProjectEntry {
  const { plan } = made.owner;
  const read = assetsRead(state, plan);
  const files = mediaOf(read, media);
  if (files.kind !== 'held') {
    return { kind: files.kind, id: made.id, name: made.name, reason: files.reason };
  }
  const [stream] = plan.streams;
  const sampleRate = made.owner.asset.sampleRate;
  const sources = read.map((asset) => state.sources.get(asset.id)?.media);
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
  previous: ReadonlyMap<string, MadeEntry> = new Map(),
): { readonly entries: ProjectEntries; readonly made: ReadonlyMap<string, MadeEntry> } {
  const made = new Map<string, MadeEntry>();
  const keep = (id: string, from: readonly unknown[], make: () => ProjectEntry): void => {
    const before = previous.get(id);
    made.set(
      id,
      before !== undefined && sameValues(before.from, from) ? before : { from, entry: make() },
    );
  };
  const { project } = state;
  for (const asset of project.assets.values()) {
    const resolver = anchorResolver(asset);
    const plan = assetPlan(asset);
    const read = assetsRead(state, plan);
    const ownMarkers = [...project.markers.values()].filter((one) => one.assetId === asset.id);
    const ownRegions = [...project.regions.values()].filter((one) => one.assetId === asset.id);
    // What the entries are made from: a file found, or a source relinked, makes them again.
    const sources = JSON.stringify(read.map((each) => state.sources.get(each.id)));
    const files = read.map((each) => media(each.id));
    const values = JSON.stringify([asset, ownMarkers, sources]);
    // A stable sort, so markers at one position keep the project's order.
    const markers = placeMarkers(asset, ownMarkers, resolver).toSorted(
      (one, other) => one.position - other.position,
    );
    const id = assetEntryId(asset.id);
    keep(id, [values, JSON.stringify(ownRegions), ...files], () =>
      openedEntry(
        state,
        {
          id,
          name: asset.displayName,
          description: assetSentence(asset),
          owner: { kind: 'project', asset, plan, offset: derivedSampleCount(0) },
          markers,
          regions: placeRegions(asset, ownRegions, resolver),
        },
        media,
      ),
    );
    for (const region of ownRegions) {
      keep(regionEntryId(region.id), [values, JSON.stringify(region), ...files], () =>
        regionEntry(state, { asset, region, markers, resolver }, media),
      );
    }
  }
  const entries = new Map([...made].map(([id, one]) => [id, one.entry] as const));
  return { entries, made };
}

/** Why a region whose audio every later edit removed cannot be shown. */
const GONE = 'Nothing of it is left: the edits made since it was placed removed all of its audio.';

/**
 * The view of `region`: the slice of its asset it covers, with its own
 * processing, or why there is none, where the edits since removed all of it.
 */
function regionEntry(
  state: ProjectState,
  parts: {
    readonly asset: Asset;
    readonly region: Region;
    readonly markers: readonly PlacedMarker[];
    readonly resolver: ReturnType<typeof anchorResolver>;
  },
  media: (asset: AssetId) => MediaAvailability,
): ProjectEntry {
  const { asset, region, markers, resolver } = parts;
  const id = regionEntryId(region.id);
  const placed = placeRegion(resolver, region);
  if (placed === undefined || placed.length === 0) {
    return { kind: 'unavailable', id, name: region.displayName, reason: GONE };
  }
  return openedEntry(
    state,
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
    media,
  );
}
