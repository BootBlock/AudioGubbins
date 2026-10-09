/**
 * What the history and the undo menu call each change to a take stack: a
 * short sentence naming what was done, to which take and in which stack.
 */

import type { Take, TakeStack } from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

/** The words for a change of `take`'s place in `stack`. */
export const TakeWords = {
  choose: (stack: TakeStack, take: Take) =>
    `Choose take ${quoted(take.name)} in ${quoted(stack.name)}`,
  reject: (stack: TakeStack, take: Take) =>
    `Reject take ${quoted(take.name)} in ${quoted(stack.name)}`,
  keep: (stack: TakeStack, take: Take) =>
    `Keep take ${quoted(take.name)} in ${quoted(stack.name)} again`,
  remove: (stack: TakeStack, take: Take) =>
    `Remove take ${quoted(take.name)} from ${quoted(stack.name)}`,
  restore: (stack: TakeStack, take: Take) =>
    `Restore take ${quoted(take.name)} to ${quoted(stack.name)}`,
  add: (stack: TakeStack, take: Take) => `Add take ${quoted(take.name)} to ${quoted(stack.name)}`,
  withdraw: (stack: TakeStack, take: Take) =>
    `Withdraw take ${quoted(take.name)} from ${quoted(stack.name)}`,
  duplicate: (take: Take, copy: Take) =>
    `Duplicate take ${quoted(take.name)} as ${quoted(copy.name)}`,
  rename: (take: Take, name: string) => `Rename take ${quoted(take.name)} to ${quoted(name)}`,
  note: (take: Take) => `Change the note of take ${quoted(take.name)}`,
  compensation: (take: Take) => `Set the latency compensation of take ${quoted(take.name)}`,
} as const;

/** The words for a change to a whole stack. */
export const StackWords = {
  create: (stack: TakeStack) => `Create take stack ${quoted(stack.name)}`,
  remove: (stack: TakeStack) => `Remove take stack ${quoted(stack.name)}`,
  rename: (stack: TakeStack, name: string) =>
    `Rename take stack ${quoted(stack.name)} to ${quoted(name)}`,
  set: (stack: TakeStack) => `Change take stack ${quoted(stack.name)}`,
  branch: (branch: TakeStack, take: Take) =>
    `Branch take stack ${quoted(branch.name)} from take ${quoted(take.name)}`,
  consolidate: (stack: TakeStack, take: Take) =>
    `Keep only take ${quoted(take.name)} in ${quoted(stack.name)}`,
  punch: (stack: TakeStack, asset: string) =>
    `Punch in on ${quoted(asset)} from ${quoted(stack.name)}`,
  unpunch: (stack: TakeStack, asset: string) =>
    `Withdraw the punch on ${quoted(asset)} from ${quoted(stack.name)}`,
} as const;
