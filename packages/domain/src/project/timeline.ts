/**
 * Timeline entities: clips on the project timeline, and the regions, markers
 * and loops placed on an asset.
 *
 * REQ-ARCH-004.4 requires the model to carry these concepts from the first
 * production phase even where the first user interface exposes only some of
 * them, so that multitrack editing is a later feature rather than a rewrite.
 *
 * A clip's position is a sample frame on the *project* timeline at the
 * project's own sample rate. A region's and a marker's are boundaries in one
 * asset's edited timeline at the asset's own rate, anchored to its content
 * (ADR-0051). Conflating the two is the classic source of material that plays
 * at the wrong speed, so the two never share a type without an explicit
 * conversion.
 */

import type { AssetId, ClipId, MarkerId, RegionId, TrackId } from '../identity/branded-id.js';
import type { RegionOperation } from '../editing/operations.js';
import type { SampleCount } from '../time/sample-time.js';
import type { AssetRange } from './asset.js';

/**
 * A placement of part of an asset on a track.
 *
 * A clip owns no audio. It says which part of which asset sounds, where on the
 * timeline, and with what parametric treatment. That is what makes editing
 * non-destructive (REQ-ARCH-004.2) and what lets the same asset appear many
 * times without being copied.
 */
export interface Clip {
  readonly id: ClipId;

  /** The track the clip sounds on. */
  readonly trackId: TrackId;

  /** User-facing name. Defaults to the asset's name but moves independently. */
  readonly displayName: string;

  /** Which part of which asset the clip plays. */
  readonly source: AssetRange;

  /** Where the clip starts on the project timeline. */
  readonly timelineStart: SampleCount;

  /**
   * How long the clip occupies the timeline.
   *
   * Held separately from `source.length` because the two differ once time
   * stretching exists. Until a stretch ratio is applied they are equal, and the
   * domain validates that they agree for an unstretched clip rather than
   * deriving one from the other and losing the distinction.
   */
  readonly timelineLength: SampleCount;

  /** Linear gain applied to the clip, where 1 leaves it unchanged. */
  readonly gain: number;

  /** Length of the fade in, in sample frames. */
  readonly fadeInLength: SampleCount;

  /** Length of the fade out, in sample frames. */
  readonly fadeOutLength: SampleCount;

  /** Whether the clip is silent without losing its parameters. */
  readonly muted: boolean;
}

/** The first timeline sample frame after the clip. */
export function clipEnd(clip: Clip): number {
  return clip.timelineStart + clip.timelineLength;
}

/** Whether two clips occupy any of the same timeline frames. */
export function clipsOverlap(left: Clip, right: Clip): boolean {
  return left.timelineStart < clipEnd(right) && right.timelineStart < clipEnd(left);
}

/**
 * A named span of one asset, which game-audio work exports, loops and names,
 * so it is a project entity rather than a transient selection (REQ-EDIT-014).
 *
 * Its boundaries are stated at `basis`, the number of the asset's edit
 * operations that existed when they were set, and resolved by carrying them
 * through the operations after (ADR-0051). Its own processing changes its
 * audio and no other region's.
 */
export interface Region {
  readonly id: RegionId;
  readonly assetId: AssetId;
  readonly displayName: string;
  readonly basis: number;
  readonly start: SampleCount;
  readonly end: SampleCount;

  /** How the region loops, or `undefined` if it is not a loop. */
  readonly loop?: AnchoredLoop;

  /**
   * Free-form user tags, for example `footstep` or `gravel`.
   *
   * Sorted and de-duplicated on construction so that two regions with the same
   * tags compare equal regardless of the order the user typed them.
   */
  readonly tags: readonly string[];

  /** The region's own processing, in the order it was made. */
  readonly operations: readonly RegionOperation[];
}

/** Which end of a region a command moves. */
export const RegionBoundary = { Start: 'start', End: 'end' } as const;

/** Which end of a region a command moves. */
export type RegionBoundary = (typeof RegionBoundary)[keyof typeof RegionBoundary];

/**
 * A region's loop as it is kept: a span inside the region, anchored like the
 * region's own boundaries, with the length of the crossfade at its join.
 *
 * Distinct from the region's start and end so that a sound can have an attack
 * that plays once followed by a sustaining body that repeats.
 */
export interface AnchoredLoop {
  readonly basis: number;
  readonly start: SampleCount;
  readonly end: SampleCount;

  /** Zero for a hard join, or how many frames cross-fade at it. */
  readonly crossfadeLength: SampleCount;
}

/**
 * A point of interest on one asset, anchored to its content like a region's
 * boundaries (ADR-0051).
 */
export interface Marker {
  readonly id: MarkerId;
  readonly assetId: AssetId;
  readonly displayName: string;
  readonly basis: number;
  readonly position: SampleCount;

  /**
   * Optional colour key from the theme's marker palette.
   *
   * A key, never a literal colour: REQ-UX-070 keeps marker colours in a
   * semantic palette so they stay legible across themes and brightness
   * settings.
   */
  readonly paletteKey?: string;
}

/** A marker where it lies on the timeline a view shows. */
export interface PlacedMarker {
  readonly id: MarkerId;
  readonly displayName: string;
  readonly position: SampleCount;
  readonly paletteKey?: string;
}

/** A region where it lies on the timeline a view shows. */
export interface PlacedRegion {
  readonly id: RegionId;
  readonly displayName: string;
  readonly start: SampleCount;
  readonly length: SampleCount;

  /** Loop behaviour, or `undefined` if the region is not a loop or its loop closed up. */
  readonly loop?: LoopDefinition;
  readonly tags: readonly string[];
}

/** The first boundary after a placed region. */
export function regionEnd(region: PlacedRegion): number {
  return region.start + region.length;
}

/**
 * How a placed region loops.
 *
 * REQ-EXEC-136.11 names loop rules as a domain rule that must have one
 * authoritative home, so the definition lives here and the audio engine, the
 * exporter and the Godot integration all read it rather than each deciding what
 * a loop means.
 */
export interface LoopDefinition {
  /** Where playback returns to, as an offset from the region start. */
  readonly loopStart: SampleCount;

  /** Where playback loops from, as an offset from the region start. */
  readonly loopEnd: SampleCount;

  /** Zero for a hard join, or how many frames cross-fade at it. */
  readonly crossfadeLength: SampleCount;
}

/** Identifies the asset a clip reads from. */
export function clipAssetId(clip: Clip): AssetId {
  return clip.source.assetId;
}
