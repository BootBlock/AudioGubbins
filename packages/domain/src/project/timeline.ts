/**
 * Timeline entities: clips, regions, markers and loops.
 *
 * REQ-ARCH-004.4 requires the model to carry these concepts from the first
 * production phase even where the first user interface exposes only some of
 * them, so that multitrack editing is a later feature rather than a rewrite.
 *
 * Every position here is a sample frame on the *project* timeline at the
 * project's own sample rate. An asset's internal positions use the asset's
 * rate. Conflating the two is the classic source of material that plays at the
 * wrong speed, so the two never share a type without an explicit conversion.
 */

import type { AssetId, ClipId, MarkerId, RegionId, TrackId } from '../identity/branded-id.js';
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
 * A named span of the project timeline.
 *
 * Regions are what game-audio work exports, loops and names, so a region is a
 * first-class project entity rather than a transient selection.
 */
export interface Region {
  readonly id: RegionId;
  readonly displayName: string;
  readonly start: SampleCount;
  readonly length: SampleCount;

  /** Loop behaviour, or `undefined` if the region is not a loop. */
  readonly loop?: LoopDefinition;

  /**
   * Free-form user tags, for example `footstep` or `gravel`.
   *
   * Sorted and de-duplicated on construction so that two regions with the same
   * tags compare equal regardless of the order the user typed them.
   */
  readonly tags: readonly string[];
}

/** The first timeline sample frame after the region. */
export function regionEnd(region: Region): number {
  return region.start + region.length;
}

/**
 * How a region loops.
 *
 * REQ-EXEC-136.11 names loop rules as a domain rule that must have one
 * authoritative home, so the definition lives here and the audio engine, the
 * exporter and the Godot integration all read it rather than each deciding what
 * a loop means.
 */
export interface LoopDefinition {
  /**
   * Where playback returns to, as an offset from the region start.
   *
   * Distinct from the region start so that a sound can have an attack that
   * plays once followed by a sustaining body that repeats.
   */
  readonly loopStart: SampleCount;

  /** Where playback loops from, as an offset from the region start. */
  readonly loopEnd: SampleCount;

  /**
   * Whether the loop crossfades at the join.
   *
   * Zero means a hard join. A non-zero length crossfades that many frames.
   */
  readonly crossfadeLength: SampleCount;
}

/** A point of interest on the timeline. */
export interface Marker {
  readonly id: MarkerId;
  readonly displayName: string;
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

/** Every entity that can be placed on the timeline. */
export type TimelineEntity = Clip | Region | Marker;

/** Identifies the asset a clip reads from. */
export function clipAssetId(clip: Clip): AssetId {
  return clip.source.assetId;
}
