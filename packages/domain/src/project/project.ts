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
  EffectChainId,
  MarkerId,
  ProjectId,
  RegionId,
  TrackId,
} from '../identity/branded-id.js';
import type { SampleRate } from '../time/sample-time.js';
import type { ChannelLayout } from '../audio/channel-layout.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { Asset } from './asset.js';
import type { Clip, Marker, Region } from './timeline.js';
import { clipEnd, regionEnd } from './timeline.js';
import type { Bus, Track } from './routing.js';

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
 * The first timeline frame after everything in the project.
 *
 * Zero for an empty project. Markers extend the length so that a marker placed
 * past the last clip stays reachable rather than falling outside the timeline
 * the moment the clip it referred to is shortened.
 */
export function projectLength(project: Project): number {
  let end = 0;
  for (const clip of project.clips.values()) end = Math.max(end, clipEnd(clip));
  for (const region of project.regions.values()) end = Math.max(end, regionEnd(region));
  for (const marker of project.markers.values()) end = Math.max(end, marker.position);
  return end;
}

/** Whether any clip reads from the asset. */
export function isAssetInUse(project: Project, assetId: AssetId): boolean {
  for (const clip of project.clips.values()) {
    if (clip.source.assetId === assetId) return true;
  }
  return false;
}
