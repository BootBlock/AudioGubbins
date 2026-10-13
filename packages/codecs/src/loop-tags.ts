/**
 * Loops as the text tags game engines and their tools read: `LOOPSTART` and
 * `LOOPLENGTH`, in frames of the file (ADR-0093).
 *
 * Vorbis comments, ID3v2 `TXXX` frames and MP4 free-form atoms all carry the
 * same two tags, so one rule writes and reads them. The convention holds one
 * forward loop that repeats without end; a map with more loops, or a loop that
 * plays otherwise or has a name, is written as its first loop and reported, so
 * the person learns what the format kept.
 *
 * On reading, the variants other tools write are accepted as well, matched
 * without regard to case: `LOOP_START` for the start, `LOOP_LENGTH` for the
 * length, and `LOOPEND` or `LOOP_END` for the end, which is read as the first
 * frame after the loop (the loop's start plus its length), as vgmstream reads
 * it.
 */

import type { MetadataLoop } from './metadata-map.js';

/** The tag a loop's first frame is written under. */
export const LOOP_START_TAG = 'LOOPSTART';

/** The tag a loop's length in frames is written under. */
export const LOOP_LENGTH_TAG = 'LOOPLENGTH';

/** Which part of a loop a tag states. */
export type LoopTagPart = 'start' | 'length' | 'end';

const LOOP_TAG_PARTS: ReadonlyMap<string, LoopTagPart> = new Map([
  ['LOOPSTART', 'start'],
  ['LOOP_START', 'start'],
  ['LOOPLENGTH', 'length'],
  ['LOOP_LENGTH', 'length'],
  ['LOOPEND', 'end'],
  ['LOOP_END', 'end'],
]);

/** The loop part a tag's key states, or `undefined` for any other key. */
export function loopTagPart(key: string): LoopTagPart | undefined {
  return LOOP_TAG_PARTS.get(key.toUpperCase());
}

/** A decimal count of frames, as a tag holds one: digits alone, at most an exact whole number. */
const FRAME_COUNT = /^\s*(\d{1,16})\s*$/;

/** The count of frames a tag's value states, or `undefined` where it states none. */
export function frameCountTag(value: string): number | undefined {
  const match = FRAME_COUNT.exec(value);
  if (match === null) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : undefined;
}

/** The loop the convention writes from a map's loops, and whether it holds less than they say. */
export interface TaggedLoop {
  readonly loop: MetadataLoop | undefined;
  readonly partial: boolean;
}

/** The first loop, and whether the map says more than one plain forward loop the tags can hold. */
export function taggedLoop(loops: readonly MetadataLoop[] | undefined): TaggedLoop {
  const [loop] = loops ?? [];
  if (loop === undefined) return { loop: undefined, partial: false };
  const plain =
    loop.direction === 'forward' && loop.playCount === 'endless' && loop.name === undefined;
  return { loop, partial: !plain || (loops?.length ?? 0) > 1 };
}
