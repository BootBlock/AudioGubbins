/**
 * Tracks, buses and routing.
 *
 * REQ-ARCH-004.4 requires the model to carry tracks, buses and routing from the
 * first production phase even though the first release edits a single file. The
 * requirement names the assumption to avoid explicitly: one project is not one
 * waveform. A project with a single track is a project with a single track, not
 * a project without the concept.
 *
 * Nothing here is exposed by the Phase 01 user interface. It exists so that the
 * later multitrack phase adds panels and commands rather than replacing the
 * project model underneath every command already written against it.
 */

import type { BusId, EffectChainId, TrackId } from '../identity/branded-id.js';
import type { ChannelLayout } from '../audio/channel-layout.js';

/**
 * A lane that clips sound on.
 *
 * A track owns placement and mix state. It does not own audio: its sound is
 * whatever its clips produce, through its effect chain, sent to its output.
 */
export interface Track {
  readonly id: TrackId;
  readonly displayName: string;

  /** The channel layout the track's output carries. */
  readonly channelLayout: ChannelLayout;

  /** Linear gain applied to the whole track, where 1 leaves it unchanged. */
  readonly gain: number;

  /**
   * Stereo position from -1 (fully left) to 1 (fully right).
   *
   * How a pan position maps onto a layout with more than two channels is a
   * question for the mixer, not for the project model. The value is stored; the
   * audio engine decides what it means for the layout in hand (REQ-ARCH-157).
   */
  readonly pan: number;

  readonly muted: boolean;

  /**
   * Whether the track is soloed.
   *
   * Solo interacts with mute across the whole project, so whether a given track
   * is actually audible is a project-level question, not a track-level one.
   * {@link isTrackAudible} answers it in one place.
   */
  readonly soloed: boolean;

  /** Where the track's output goes. */
  readonly output: RoutingTarget;

  /** The track's effect chain, or `undefined` if it has none. */
  readonly effectChainId?: EffectChainId;

  /** Colour key from the theme's track palette, never a literal colour. */
  readonly paletteKey?: string;
}

/**
 * A summing point that other tracks and buses feed.
 *
 * Buses exist so that a group of sounds can be processed together. The main
 * output is itself a bus, which removes the special case that an output bus
 * would otherwise be.
 */
export interface Bus {
  readonly id: BusId;
  readonly displayName: string;
  readonly channelLayout: ChannelLayout;
  readonly gain: number;
  readonly muted: boolean;

  /** Where the bus sends its output, or `undefined` if it is the main output. */
  readonly output?: RoutingTarget;

  readonly effectChainId?: EffectChainId;
}

/** What a track or bus sends its output to. */
export type RoutingTarget =
  { readonly kind: 'bus'; readonly busId: BusId } | { readonly kind: 'main-output' };

/** Sends output to the main output. */
export const MAIN_OUTPUT: RoutingTarget = { kind: 'main-output' };

/** Sends output to a bus. */
export function routeToBus(busId: BusId): RoutingTarget {
  return { kind: 'bus', busId };
}

/**
 * Whether a track will be heard, given every track in the project.
 *
 * Solo is a project-wide rule: soloing any track silences every track that is
 * not soloed. REQ-EXEC-136.11 requires a rule like this to have one
 * authoritative home rather than being re-derived by the mixer, the meters, the
 * exporter and the track header, each slightly differently.
 */
export function isTrackAudible(track: Track, allTracks: readonly Track[]): boolean {
  if (track.muted) return false;
  const anySoloed = allTracks.some((candidate) => candidate.soloed);
  return anySoloed ? track.soloed : true;
}

/**
 * Follows routing from a starting point to the main output.
 *
 * Returns the buses passed through in order. Returns `undefined` if the routing
 * does not reach the main output within `buses.length` hops, which means it
 * contains a cycle. A cycle is reported rather than followed, because a mixer
 * that silently broke the loop would produce a project whose sound depended on
 * which bus the traversal happened to start from.
 */
export function routingPathToOutput(
  from: RoutingTarget,
  buses: ReadonlyMap<BusId, Bus>,
): readonly BusId[] | undefined {
  const path: BusId[] = [];
  const visited = new Set<BusId>();
  let current = from;

  while (current.kind === 'bus') {
    if (visited.has(current.busId)) return undefined;
    visited.add(current.busId);
    path.push(current.busId);

    const bus = buses.get(current.busId);
    if (bus === undefined) return undefined;
    current = bus.output ?? MAIN_OUTPUT;
  }

  return path;
}
