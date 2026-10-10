/**
 * A WAV's `cue ` chunk: a count, then 24-byte points of an id, a playlist
 * position, the id of the chunk the point lies in, that chunk's start, the
 * block's start and the sample offset within the block.
 *
 * A point's frame is its sample offset: for PCM in one data chunk, which every
 * form here is, that is the frame of the file. The position field counts in a
 * playlist's order, which writers fill inconsistently, so it is not read.
 */

import { fail, succeed, type DomainResult, type SampleCount } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { countRefusal, statedFrames } from './metadata-reading.js';

/** The most cue points a `cue ` chunk may list. */
export const MAXIMUM_CUE_POINTS = 4_096;

/** The count, each point's bytes, and where its fields lie. */
export const CUE_COUNT_BYTES = 4;
export const CUE_POINT_BYTES = 24;
export const CUE_FIELDS = { id: 0, position: 4, chunk: 8, sampleOffset: 20 } as const;

/** A cue point before its label is found, which may lie in a list before or after it. */
export interface ListedCue {
  readonly id: number;
  readonly position: SampleCount;
}

/** Reads a `cue ` chunk's points. */
export function readCues(body: Uint8Array): DomainResult<readonly ListedCue[]> {
  if (body.length < CUE_COUNT_BYTES) {
    return fail(malformed("The 'cue ' chunk is too short to hold its count of points."));
  }
  const view = viewOf(body);
  const count = view.getUint32(0, true);
  const needed = CUE_COUNT_BYTES + count * CUE_POINT_BYTES;
  const refusal = countRefusal(
    'cue ',
    count,
    MAXIMUM_CUE_POINTS,
    needed,
    body.length,
    'cue points',
  );
  if (!refusal.ok) return refusal;
  const cues: ListedCue[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = CUE_COUNT_BYTES + index * CUE_POINT_BYTES;
    const position = statedFrames(view.getUint32(at + CUE_FIELDS.sampleOffset, true), 'cue point');
    if (!position.ok) return position;
    cues.push({ id: view.getUint32(at + CUE_FIELDS.id, true), position: position.value });
  }
  return succeed(cues);
}
