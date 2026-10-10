/**
 * Random invocations of the take and punch commands (ADR-0072), for the
 * random command walk: mostly ones that apply to the state they are made
 * for, sometimes ones that are refused or change nothing, as a person, a
 * journal or the storage worker might send them.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  AssetOrigin,
  FadeShape,
  TakeState,
  channelCount,
  derivedSampleCount,
  punchStackOf,
  punchTakeFrames,
  shapesOf,
  type Asset,
  type EditOperation,
  type IdGenerator,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { randomAssetRecord, randomName, type Random } from '@audiogubbins/project-format/testing';

import { addAssetInvocation } from '../project-invocations.js';
import {
  addPunchInvocation,
  addTakeInvocation,
  branchTakeStackInvocation,
  chooseTakeInvocation,
  consolidateTakeStackInvocation,
  createTakeStackInvocation,
  duplicateTakeInvocation,
  keepTakeInvocation,
  rejectTakeInvocation,
  removePunchInvocation,
  removeTakeInvocation,
  removeTakeStackInvocation,
  renameTakeInvocation,
  renameTakeStackInvocation,
  restoreTakeInvocation,
  setTakeCompensationInvocation,
  setTakeNoteInvocation,
  setTakeStackInvocation,
  withdrawTakeInvocation,
} from '../takes/take-invocations.js';

/** How many kinds of invocation {@link randomTakeInvocation} chooses among. */
export const TAKE_CHOICES = 19;

/** A new take of `asset`, kept or now and then rejected. */
function freshTake(random: Random, ids: IdGenerator, asset: Asset): Take {
  return {
    id: ids.next<'TakeId'>(),
    asset: asset.id,
    name: randomName(random),
    note: random.chance(0.5) ? '' : randomName(random),
    state: random.chance(0.8) ? TakeState.Kept : TakeState.Rejected,
    compensation: 0,
  };
}

/** A new stack of one or two takes of `recorded`, the first chosen where it is kept. */
function freshStack(random: Random, ids: IdGenerator, recorded: readonly Asset[]): TakeStack {
  const takes = Array.from({ length: 1 + random.below(2) }, () =>
    freshTake(random, ids, random.pick(recorded)),
  );
  const [first] = takes;
  return {
    id: ids.next<'TakeStackId'>(),
    name: randomName(random),
    takes,
    ...(first?.state === TakeState.Kept && random.chance(0.8) ? { chosen: first.id } : {}),
  };
}

/**
 * A punch over a short range at the end of `target`'s chain, its new stack's
 * one take a recording of the same channels long enough for it, where the
 * project has one.
 */
function freshPunch(
  random: Random,
  ids: IdGenerator,
  target: Asset,
  recorded: readonly Asset[],
): CommandInvocation | undefined {
  const shape = shapesOf(target).at(-1);
  if (shape === undefined || shape.length < 2) return undefined;
  const length = 1 + random.below(Math.min(shape.length, 4_000));
  const fitting = recorded.filter(
    (asset) =>
      channelCount(asset.channelLayout) === channelCount(shape.layout) &&
      punchTakeFrames(length, shape.sampleRate, asset.sampleRate) <= asset.length,
  );
  if (fitting.length === 0) return undefined;
  const take = { ...freshTake(random, ids, random.pick(fitting)), state: TakeState.Kept };
  const stack: TakeStack = {
    id: ids.next<'TakeStackId'>(),
    name: randomName(random),
    takes: [take],
    chosen: take.id,
    punch: {
      length: derivedSampleCount(length),
      preRoll: derivedSampleCount(0),
      postRoll: derivedSampleCount(0),
      crossfade: {
        length: derivedSampleCount(random.below(Math.floor(length / 2) + 1)),
        shape: random.pick(Object.values(FadeShape)),
      },
      resampler: 1,
    },
  };
  const start = random.below(shape.length - length + 1);
  const operation: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: derivedSampleCount(start), end: derivedSampleCount(start + length) },
    edit: { kind: 'punch', stack: stack.id },
  };
  return addPunchInvocation(target, operation, stack);
}

/** A recorded asset added to the project, for a take to name later. */
function recordingAdded(random: Random, ids: IdGenerator, state: ProjectState): CommandInvocation {
  const { asset, source } = randomAssetRecord(random, ids, state.project.id);
  return addAssetInvocation({ ...asset, origin: AssetOrigin.Recorded }, source);
}

/** A random invocation of the take command `choice` picks, below {@link TAKE_CHOICES}. */
export function randomTakeInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  choice: number,
): CommandInvocation {
  const assets = [...state.project.assets.values()];
  const recorded = assets.filter((asset) => asset.origin === AssetOrigin.Recorded);
  const stacks = [...state.project.takeStacks.values()];
  if (recorded.length === 0) return recordingAdded(random, ids, state);
  if (choice === 0 || stacks.length === 0) {
    return createTakeStackInvocation(freshStack(random, ids, recorded));
  }
  if (choice === 1) {
    const target = random.pick(assets);
    return freshPunch(random, ids, target, recorded) ?? recordingAdded(random, ids, state);
  }
  const stack = random.pick(stacks);
  const take = stack.takes.length > 0 ? random.pick(stack.takes) : undefined;
  if (take === undefined) {
    return addTakeInvocation(stack, freshTake(random, ids, random.pick(recorded)), false);
  }
  switch (choice) {
    case 2: {
      // Where no chain ends with a punch to remove, one is made, so a later
      // turn can remove it: the walk reaches the removal by its own steps
      // rather than by the seeds' luck in leaving a punch last.
      const punched = assets.filter((asset) => {
        const last = asset.edits.at(-1);
        return last !== undefined && punchStackOf(last) !== undefined;
      });
      const asset = punched.length > 0 ? random.pick(punched) : undefined;
      const last = asset?.edits.at(-1);
      return asset !== undefined && last !== undefined
        ? removePunchInvocation(asset, last)
        : (freshPunch(random, ids, random.pick(assets), recorded) ??
            removeTakeStackInvocation(stack));
    }
    case 3:
      return removeTakeStackInvocation(stack);
    case 4:
      return renameTakeStackInvocation(stack, randomName(random));
    case 5:
      return setTakeStackInvocation({
        ...stack,
        takes: stack.takes.map((each) =>
          random.chance(0.5) ? { ...each, note: randomName(random) } : each,
        ),
      });
    case 6:
      return branchTakeStackInvocation(
        stack,
        take,
        ids.next<'TakeStackId'>(),
        ids.next<'TakeId'>(),
        randomName(random),
      );
    case 7:
      return consolidateTakeStackInvocation(stack);
    case 8:
      return addTakeInvocation(
        stack,
        freshTake(random, ids, random.pick(recorded)),
        random.chance(0.5),
      );
    case 9: {
      const last = stack.takes.at(-1);
      return last === undefined
        ? removeTakeStackInvocation(stack)
        : withdrawTakeInvocation(stack, last, undefined);
    }
    case 10:
      return duplicateTakeInvocation(stack, take, ids.next<'TakeId'>(), randomName(random));
    case 11:
      return renameTakeInvocation(stack, take, randomName(random));
    case 12:
      return setTakeNoteInvocation(stack, take, randomName(random));
    case 13:
      return chooseTakeInvocation(stack, take);
    case 14:
      return rejectTakeInvocation(stack, take);
    case 15:
      return keepTakeInvocation(stack, take);
    case 16:
      return removeTakeInvocation(stack, take);
    case 17:
      return restoreTakeInvocation(stack, take);
    default:
      return setTakeCompensationInvocation(stack, take, random.pick([0, 1, -1, 480]));
  }
}
