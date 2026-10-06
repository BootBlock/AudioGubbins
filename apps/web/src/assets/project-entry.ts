/**
 * One asset or region of the project as an editor view opens it (ADR-0051,
 * ADR-0052): its plan over the files the plan reads, opened only once the page
 * holds every one of them, and until then why it cannot open; the identities a
 * view names each by; and the sentence the list of an empty view gives each.
 * Which entries are made again for a state of the project is
 * `project-assets.ts`'s to decide.
 */

import {
  channelCount,
  derivedSampleCount,
  markersInRegion,
  placeRegion,
  regionPlan,
  streamLength,
  type AnchorResolver,
  type Asset,
  type AssetId,
  type EditPlan,
  type PlacedMarker,
  type PlanContext,
  type Region,
  type RegionId,
} from '@audiogubbins/domain';
import { PcmDescriptionKind, type MediaEntry } from '@audiogubbins/audio-engine';
import { canonicalJson, writeEditPlan, type AssetSource } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

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

/** The assets an entry reads the media of, where each is kept, and the file the page holds of each. */
export interface Reads {
  readonly read: readonly Asset[];
  readonly sources: readonly (AssetSource | undefined)[];
  readonly files: readonly MediaAvailability[];
}

/** The identity a view names an asset of the project by. */
export function assetEntryId(asset: AssetId): string {
  return `asset:${asset}`;
}

/** The identity a view names a region of the project by. */
export function regionEntryId(region: RegionId): string {
  return `region:${region}`;
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
export function assetSentence(asset: Asset, plan: EditPlan): string {
  const [stream] = plan.streams;
  const shape = `${counted(channelCount(stream.layout), 'channel', 'channels')} at ${String(stream.sampleRate / 1000)} kHz`;
  return asset.edits.length === 0
    ? `Audio of the project: ${shape}.`
    : `Audio of the project: ${shape}, with ${counted(asset.edits.length, 'edit', 'edits')}.`;
}

/** The view of `plan`, named `id`, of the asset `owner` holds, once every file `reads` names is held. */
export function openedEntry(
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
  // The edited sound's rate, which a conversion in its chain may have changed
  // from its source's.
  const { sampleRate } = stream;
  const sources = reads.sources.map((source) => source?.media);
  // Written as the project writes a plan, so every value in it counts, the
  // parameter values of its chains among them.
  const content = `${canonicalJson(writeEditPlan(plan))}${JSON.stringify(sources)}`;
  return {
    kind: 'open',
    asset: {
      id: made.id,
      name: made.name,
      description: made.description,
      sampleRate,
      layout: stream.layout,
      length: derivedSampleCount(streamLength(stream)),
      content,
      revision: revisionOf(content),
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

/** Why a region whose audio every later edit removed cannot be shown. */
const GONE = 'Nothing of it is left: the edits made since it was placed removed all of its audio.';

/**
 * The view of `region`: the slice of its asset it covers, with its own
 * processing, or why there is none, where the edits since removed all of it.
 */
export function regionEntry(
  parts: {
    readonly asset: Asset;
    readonly region: Region;
    readonly markers: readonly PlacedMarker[];
    readonly resolver: AnchorResolver;
    readonly context: PlanContext;
  },
  reads: Reads,
): ProjectEntry {
  const { asset, region, markers, resolver, context } = parts;
  const id = regionEntryId(region.id);
  const placed = placeRegion(resolver, region);
  if (placed === undefined || placed.length === 0) {
    return { kind: 'unavailable', id, name: region.displayName, reason: GONE };
  }
  const plan = regionPlan(asset, region, context, resolver);
  if (!plan.ok) {
    return { kind: 'unavailable', id, name: region.displayName, reason: plan.failures[0].summary };
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
        plan: plan.value,
        offset: placed.start,
      },
      markers: markersInRegion(markers, placed),
      regions: [],
    },
    reads,
  );
}
