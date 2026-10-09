/**
 * The project aggregate: the authoritative state of what the user is editing.
 *
 * REQ-ARCH-153 gives authoritative domain state one owner. This is it. A
 * `Project` is an immutable value, so a command produces a new project rather
 * than mutating the one a renderer, a worker or an undo entry is still holding.
 * That is what makes a history journal possible without snapshotting by copying
 * everything, and what stops a half-applied mutation from being observable.
 *
 * REQ-ARCH-004.3 keeps derived data out: no waveform peaks, no spectrogram
 * tiles, no rendered audio. Those are disposable caches owned elsewhere and
 * rebuilt from this.
 */

import type {
  AssetId,
  BusId,
  ClipId,
  EditOperationId,
  EffectChainId,
  MarkerId,
  ProjectId,
  RegionId,
  TakeStackId,
  TrackId,
} from '../identity/branded-id.js';
import type { SampleRate } from '../time/sample-time.js';
import type { ChannelLayout } from '../audio/channel-layout.js';
import type { EditRange, RangeEdit } from '../editing/operations.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { Asset } from './asset.js';
import type { Clip, Marker, Region } from './timeline.js';
import { clipEnd } from './timeline.js';
import { planReadsAsset } from '../editing/plan.js';
import type { Bus, Track } from './routing.js';
import type { TakeStack } from './take-stack.js';

/**
 * Project-wide settings that are not themselves edits.
 *
 * The sample rate and channel layout here are the project's, which an asset
 * need not share. REQ-EXEC-216 prohibits assuming sample rates match, so
 * material at another rate is converted on its way in rather than assumed to
 * agree.
 */
export interface ProjectSettings {
  readonly sampleRate: SampleRate;
  readonly channelLayout: ChannelLayout;
}

/**
 * The authoritative project.
 *
 * Entities are held in maps keyed by identifier because every lookup the editor
 * performs is by identifier, and because a map makes "this clip is present
 * exactly once" true by construction rather than by validation.
 */
export interface Project {
  readonly id: ProjectId;

  /** User-facing project name. Never an identifier (REQ-PROD-056). */
  readonly displayName: string;

  readonly settings: ProjectSettings;

  readonly assets: ReadonlyMap<AssetId, Asset>;
  readonly tracks: ReadonlyMap<TrackId, Track>;
  readonly buses: ReadonlyMap<BusId, Bus>;
  readonly clips: ReadonlyMap<ClipId, Clip>;
  readonly regions: ReadonlyMap<RegionId, Region>;
  readonly markers: ReadonlyMap<MarkerId, Marker>;
  readonly effectChains: ReadonlyMap<EffectChainId, EffectChain>;

  /** The take stacks, each grouping the recorded takes of one piece of material (ADR-0072). */
  readonly takeStacks: ReadonlyMap<TakeStackId, TakeStack>;

  /**
   * The order tracks appear in, which a map cannot express.
   *
   * Held separately rather than as a field on `Track` so that reordering is one
   * change to one array instead of renumbering every track, and so two tracks
   * can never claim the same position.
   */
  readonly trackOrder: readonly TrackId[];
}

/** Creates an empty project. */
export function createProject(
  id: ProjectId,
  displayName: string,
  settings: ProjectSettings,
): Project {
  return {
    id,
    displayName,
    settings,
    assets: new Map(),
    tracks: new Map(),
    buses: new Map(),
    clips: new Map(),
    regions: new Map(),
    markers: new Map(),
    effectChains: new Map(),
    takeStacks: new Map(),
    trackOrder: [],
  };
}

/** The tracks in the order the user arranged them. */
export function tracksInOrder(project: Project): readonly Track[] {
  const ordered: Track[] = [];
  for (const trackId of project.trackOrder) {
    const track = project.tracks.get(trackId);
    if (track !== undefined) ordered.push(track);
  }
  return ordered;
}

/** Every clip on a track, in timeline order. */
export function clipsOnTrack(project: Project, trackId: TrackId): readonly Clip[] {
  return [...project.clips.values()]
    .filter((clip) => clip.trackId === trackId)
    .sort((left, right) => left.timelineStart - right.timelineStart);
}

/**
 * The first timeline frame after every clip in the project, or zero for a
 * project with none. Regions and markers belong to assets, at their own rates
 * (ADR-0051), so they place nothing on the project timeline.
 */
export function projectLength(project: Project): number {
  let end = 0;
  for (const clip of project.clips.values()) end = Math.max(end, clipEnd(clip));
  return end;
}

/** What still names an asset, so it cannot be removed before they are. */
export interface AssetUsers {
  readonly clips: number;
  readonly regions: number;
  readonly markers: number;

  /** Other assets whose pasted audio reads it. */
  readonly pastes: number;

  /** Takes, in any stack and of any state, whose recording it is (ADR-0072). */
  readonly takes: number;
}

/**
 * What names the asset: clips that read it, its regions and markers, pastes
 * of it elsewhere, and takes that are its recording.
 */
export function assetUsers(project: Project, assetId: AssetId): AssetUsers {
  const count = <T>(values: Iterable<T>, uses: (value: T) => boolean): number => {
    let total = 0;
    for (const value of values) if (uses(value)) total += 1;
    return total;
  };
  return {
    clips: count(project.clips.values(), (clip) => clip.source.assetId === assetId),
    regions: count(project.regions.values(), (region) => region.assetId === assetId),
    markers: count(project.markers.values(), (marker) => marker.assetId === assetId),
    pastes: count(
      project.assets.values(),
      (asset) =>
        asset.id !== assetId &&
        asset.edits.some(
          (operation) => operation.kind === 'insert' && planReadsAsset(operation.payload, assetId),
        ),
    ),
    takes: [...project.takeStacks.values()].reduce(
      (total, stack) => total + count(stack.takes, (take) => take.asset === assetId),
      0,
    ),
  };
}

/** Whether anything names the asset (`assetUsers`). */
export function isAssetInUse(project: Project, assetId: AssetId): boolean {
  const users = assetUsers(project, assetId);
  return users.clips + users.regions + users.markers + users.pastes + users.takes > 0;
}

/** What names a chain (ADR-0060): every rack edit and every rack, of an asset, a region, a track or a bus. */
export interface ChainUsers {
  /** The assets whose own edits apply it to a range. */
  readonly assetEdits: readonly AssetId[];
  /** The regions whose own processing applies it to a range. */
  readonly regionEdits: readonly RegionId[];
  readonly assetRacks: readonly AssetId[];
  readonly regionRacks: readonly RegionId[];
  readonly tracks: readonly TrackId[];
  readonly buses: readonly BusId[];
}

/** A range of an asset or a region processed by a chain: one of its rack edits. */
export interface RangeRack {
  readonly operation: EditOperationId;
  /** Where it lies on the asset's timeline at the place it was made. */
  readonly range: EditRange;
  readonly chain: EffectChainId;
}

/** Every chain an asset or a region names: its rack, and each range of it a chain processes. */
export interface TargetChains {
  readonly rack: EffectChainId | undefined;
  /** In the order its edits were made. */
  readonly ranges: readonly RangeRack[];
}

/** The rack edit `edit` makes as operation `operation` over `range`, where it is one. */
function rangeRack(operation: EditOperationId, range: EditRange, edit: RangeEdit): RangeRack[] {
  return edit.kind === 'rack' ? [{ operation, range, chain: edit.chain }] : [];
}

/**
 * The chains `asset` names (ADR-0060). With {@link regionChains}, the one
 * account of where an asset or a region names a chain, which
 * {@link chainUsers} reads in the other direction.
 */
export function assetChains(asset: Asset): TargetChains {
  return {
    rack: asset.rack,
    ranges: asset.edits.flatMap((operation) =>
      operation.kind === 'process' ? rangeRack(operation.id, operation.range, operation.edit) : [],
    ),
  };
}

/** The chains `region` names (see {@link assetChains}). */
export function regionChains(region: Region): TargetChains {
  return {
    rack: region.rack,
    ranges: region.operations.flatMap((operation) =>
      rangeRack(operation.id, operation.range, operation.edit),
    ),
  };
}

/** Every chain `named` holds, the rack first, one named twice given twice. */
export function chainIdsOf(named: TargetChains): readonly EffectChainId[] {
  const ranges = named.ranges.map((range) => range.chain);
  return named.rack === undefined ? ranges : [named.rack, ...ranges];
}

/** What names the chain `chain`, so a change to it is known to reach each of them. */
export function chainUsers(project: Project, chain: EffectChainId): ChainUsers {
  const assets = [...project.assets.values()];
  const regions = [...project.regions.values()];
  const inRange = (named: TargetChains): boolean =>
    named.ranges.some((range) => range.chain === chain);
  return {
    assetEdits: assets.filter((asset) => inRange(assetChains(asset))).map((asset) => asset.id),
    regionEdits: regions
      .filter((region) => inRange(regionChains(region)))
      .map((region) => region.id),
    assetRacks: assets.filter((asset) => asset.rack === chain).map((asset) => asset.id),
    regionRacks: regions.filter((region) => region.rack === chain).map((region) => region.id),
    tracks: [...project.tracks.values()]
      .filter((track) => track.effectChainId === chain)
      .map((track) => track.id),
    buses: [...project.buses.values()]
      .filter((bus) => bus.effectChainId === chain)
      .map((bus) => bus.id),
  };
}

/** How many operations and targets name the chain (`chainUsers`). */
export function chainUseCount(users: ChainUsers): number {
  return (
    users.assetEdits.length +
    users.regionEdits.length +
    users.assetRacks.length +
    users.regionRacks.length +
    users.tracks.length +
    users.buses.length
  );
}

/**
 * Every chain the project runs or may run: its own, and each that audio pasted
 * into an asset carries in the plan it was pasted as (ADR-0053), which holds
 * its chains whole rather than naming the project's. A pasted plan's streams
 * hold every chain it reads, anything pasted into what was copied folded in
 * with them, so one level of streams is all of them.
 */
export function* projectChains(project: Project): Generator<EffectChain, void, undefined> {
  yield* project.effectChains.values();
  for (const asset of project.assets.values()) {
    for (const operation of asset.edits) {
      if (operation.kind !== 'insert') continue;
      for (const stream of operation.payload.streams) {
        if (stream.processing?.kind === 'chain') yield stream.processing.chain;
      }
    }
  }
}
