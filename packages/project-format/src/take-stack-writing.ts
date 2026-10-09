/**
 * Writing take stacks as `take-stack-reading.ts` reads them (ADR-0072): every
 * member, an optional one left out where it is absent, so a stack a command
 * carries and a stack a document holds are written alike.
 */

import type { PunchRange, Take, TakeStack } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { presentMembers } from './document-writing.js';

/** Writes one take. */
export function writeTake(take: Take): JsonObject {
  return {
    id: take.id,
    asset: take.asset,
    name: take.name,
    note: take.note,
    state: take.state,
    compensation: take.compensation,
  };
}

/** Writes a punch stack's range. */
export function writePunchRange(punch: PunchRange): JsonObject {
  return {
    length: punch.length,
    preRoll: punch.preRoll,
    postRoll: punch.postRoll,
    crossfade: { length: punch.crossfade.length, shape: punch.crossfade.shape },
    resampler: punch.resampler,
  };
}

/** Writes one take stack, its takes in the order they were made. */
export function writeTakeStack(stack: TakeStack): JsonObject {
  return presentMembers({
    id: stack.id,
    name: stack.name,
    takes: stack.takes.map(writeTake),
    chosen: stack.chosen,
    punch: stack.punch === undefined ? undefined : writePunchRange(stack.punch),
  });
}
