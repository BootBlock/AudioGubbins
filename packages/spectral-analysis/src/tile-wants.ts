/**
 * The wants a worker's job holds: which place is made next, nearest the job's
 * focus, and each want's tile in the cache's format once the place is made.
 *
 * Every channel wanted at one place is made in one pass (ADR-0080), so a place
 * is taken from the waiting wants whole: the want nearest the focus names it,
 * and every other want there goes with it.
 */

import type { SpectralTileKey } from './spectral-tile.js';
import type { ToSpectrogramWorker, ToSpectrogramWorkerKind } from './spectrogram-messages.js';
import { encodeTile } from './tile-codec.js';
import {
  tileCentre,
  tileSpan,
  type LevelGeometry,
  type SpectrogramGeometry,
} from './tile-geometry.js';

export type Want = Extract<ToSpectrogramWorker, { kind: typeof ToSpectrogramWorkerKind.Want }>;

/** A want waiting to be made, with what it is made at. */
export interface Waiting {
  readonly want: Want;
  readonly geometry: SpectrogramGeometry;
  readonly level: LevelGeometry;
  /** Where its tile lies, every channel's alike: the wants made in one pass. */
  readonly place: string;
  /** Why the cached bytes it carried were refused, where it carried some. */
  readonly refusedCache: string | undefined;
}

/** The key of the tile `want` names, of a sound's identity and revision. */
export function wantedKey(identity: string, revision: string, want: Want): SpectralTileKey {
  const { channel, config, level, index } = want;
  return { identity, revision, channel, config, level, index };
}

/**
 * The wants at the place nearest `focus`, by request, taken out of `waiting`,
 * or `undefined` where none waits.
 */
export function takeNearestPlace(
  waiting: Map<number, Waiting>,
  focus: number,
): Map<number, Waiting> | undefined {
  let nearest: Waiting | undefined;
  let distance = Infinity;
  for (const one of waiting.values()) {
    const from = Math.abs(tileCentre(one.level, one.want.index) - focus);
    if (from < distance) {
      nearest = one;
      distance = from;
    }
  }
  if (nearest === undefined) return undefined;
  const taken = new Map<number, Waiting>();
  for (const [request, one] of waiting) {
    if (one.place !== nearest.place) continue;
    taken.set(request, one);
    waiting.delete(request);
  }
  return taken;
}

/** A want's answer: its tile's bytes, and why the cache it carried was refused. */
export interface Answer {
  readonly request: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly refusedCache: string | undefined;
}

/**
 * Each want of one place answered from the tiles made there, `tiles[i]` of
 * the channel `channels[i]`, in the cache's format.
 */
export function answers(
  wants: ReadonlyMap<number, Waiting>,
  made: {
    readonly channels: readonly number[];
    readonly tiles: readonly Uint8Array<ArrayBuffer>[];
  },
  sound: { readonly identity: string; readonly revision: string },
): readonly Answer[] {
  return [...wants].flatMap(([request, waiting]) => {
    const values = made.tiles[made.channels.indexOf(waiting.want.channel)];
    if (values === undefined) return [];
    const bytes = encodeTile({
      key: wantedKey(sound.identity, sound.revision, waiting.want),
      columns: tileSpan(waiting.level, waiting.want.index).columns,
      bins: waiting.geometry.bins,
      values,
    });
    return [{ request, bytes, refusedCache: waiting.refusedCache }];
  });
}
