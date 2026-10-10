/**
 * A WAV's `smpl` chunk: the sampler's unity note and pitch fraction, and its
 * loops, each an id, a type, a start, an inclusive end, a fraction and a play
 * count. The manufacturer, product, sample period, SMPTE fields and sampler
 * data mean nothing to the map and are not read.
 *
 * The pitch fraction is the part of a semitone above the unity note. It is
 * read in whole cents rounded to the nearest (half a cent up), the unit AIFF
 * and every sampler use. A fraction of more than 50 cents is the next note's
 * unity less the rest, so the fine tune stays within -50 to 50; exactly 50
 * stays +50 on the stated note. A loop of a manufacturer's own type plays in a
 * way the map cannot state, so it is left out rather than refused; a loop that
 * ends before it starts breaks the chunk's rules and is refused.
 */

import { fail, succeed, type DomainResult, type SampleCount } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import type { LoopDirection, SamplerTuning } from './metadata-map.js';
import { countRefusal, statedFrames } from './metadata-reading.js';

/** The most loops a `smpl` chunk may list. */
export const MAXIMUM_LOOPS = 1_024;

/** The fields before the loops and where they lie, and each loop's bytes and fields. */
export const SAMPLER_HEADER_BYTES = 36;
export const SAMPLER_FIELDS = {
  period: 8,
  unityNote: 12,
  pitchFraction: 16,
  loopCount: 28,
} as const;
export const SAMPLER_LOOP_BYTES = 24;
export const LOOP_FIELDS = { id: 0, type: 4, start: 8, end: 12, playCount: 20 } as const;

/** The loop types `smpl` defines; 32 and above are a manufacturer's own. */
export const SAMPLER_LOOP_TYPES: ReadonlyMap<number, LoopDirection> = new Map([
  [0, 'forward'],
  [1, 'alternating'],
  [2, 'backward'],
]);

/** The highest MIDI note, a semitone's cents, and the pitch fraction's whole. */
export const HIGHEST_NOTE = 127;
export const CENTS_PER_SEMITONE = 100;
export const PITCH_FRACTION_WHOLE = 2 ** 32;

/** A loop before its label is found. */
export interface ListedLoop {
  readonly id: number;
  readonly start: SampleCount;
  readonly length: SampleCount;
  readonly playCount: number | 'endless';
  readonly direction: LoopDirection;
}

/** What a `smpl` chunk states. */
export interface SamplerReading {
  readonly tuning: SamplerTuning;
  readonly loops: readonly ListedLoop[];
}

/** The tuning the chunk's unity note and pitch fraction state. */
function samplerTuning(view: DataView): DomainResult<SamplerTuning> {
  const note = view.getUint32(SAMPLER_FIELDS.unityNote, true);
  const fraction = view.getUint32(SAMPLER_FIELDS.pitchFraction, true);
  const cents = Math.round((fraction * CENTS_PER_SEMITONE) / PITCH_FRACTION_WHOLE);
  const above = cents > CENTS_PER_SEMITONE / 2;
  const unityNote = above ? note + 1 : note;
  if (unityNote > HIGHEST_NOTE) {
    return fail(
      malformed(
        `The 'smpl' chunk states a unity pitch above MIDI note ${String(HIGHEST_NOTE)}, past the notes MIDI has.`,
      ),
    );
  }
  return succeed({ unityNote, fineTuneCents: above ? cents - CENTS_PER_SEMITONE : cents });
}

/**
 * One loop, or `undefined` for a manufacturer's own type. Its end is the last
 * frame it plays, so its length is one more than end less start, and a play
 * count of 0 is endless.
 */
function samplerLoop(view: DataView, at: number): DomainResult<ListedLoop | undefined> {
  const start = view.getUint32(at + LOOP_FIELDS.start, true);
  const end = view.getUint32(at + LOOP_FIELDS.end, true);
  if (end < start) {
    return fail(
      malformed(
        `A loop in the 'smpl' chunk ends at frame ${String(end)}, before it starts at frame ${String(start)}.`,
      ),
    );
  }
  const direction = SAMPLER_LOOP_TYPES.get(view.getUint32(at + LOOP_FIELDS.type, true));
  if (direction === undefined) return succeed(undefined);
  const first = statedFrames(start, "'smpl' loop's start");
  const length = statedFrames(end - start + 1, "'smpl' loop's end");
  if (!first.ok) return first;
  if (!length.ok) return length;
  const count = view.getUint32(at + LOOP_FIELDS.playCount, true);
  return succeed({
    id: view.getUint32(at + LOOP_FIELDS.id, true),
    start: first.value,
    length: length.value,
    playCount: count === 0 ? 'endless' : count,
    direction,
  });
}

/** Reads a `smpl` chunk's tuning and loops. */
export function readSampler(body: Uint8Array): DomainResult<SamplerReading> {
  if (body.length < SAMPLER_HEADER_BYTES) {
    return fail(
      malformed(
        `The 'smpl' chunk is shorter than the ${String(SAMPLER_HEADER_BYTES)} bytes of its fields.`,
      ),
    );
  }
  const view = viewOf(body);
  const tuning = samplerTuning(view);
  if (!tuning.ok) return tuning;
  const count = view.getUint32(SAMPLER_FIELDS.loopCount, true);
  const needed = SAMPLER_HEADER_BYTES + count * SAMPLER_LOOP_BYTES;
  const refusal = countRefusal('smpl', count, MAXIMUM_LOOPS, needed, body.length, 'loops');
  if (!refusal.ok) return refusal;
  const loops: ListedLoop[] = [];
  for (let index = 0; index < count; index += 1) {
    const loop = samplerLoop(view, SAMPLER_HEADER_BYTES + index * SAMPLER_LOOP_BYTES);
    if (!loop.ok) return loop;
    if (loop.value !== undefined) loops.push(loop.value);
  }
  return succeed({ tuning: tuning.value, loops });
}
