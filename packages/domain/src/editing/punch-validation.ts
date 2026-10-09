/**
 * Whether a punch edit may stand where it is made, and whether a take may be
 * the one it plays (ADR-0072).
 *
 * A punch replaces its range, on every channel, with the chosen take of the
 * stack it names, read from the end of the pre-roll shifted by the take's
 * compensation. The range must be the length the stack was recorded for, and
 * the chosen take must hold that much audio from there, at the channel count
 * of what it replaces; a take at another rate is converted, so it must hold
 * as many of its own frames as become the range. Anything else is refused
 * with the reason, by the one rule a command and the document reader share.
 */

import { channelCount } from '../audio/channel-layout.js';
import type { AssetId } from '../identity/branded-id.js';
import type { Project } from '../project/project.js';
import { chosenTake, type PunchRange, type Take } from '../project/take-stack.js';
import type { EditShape } from './edit-shape.js';
import type { EditRange, PunchEdit } from './operations.js';
import { convertedFrameCount } from './plan.js';
import type { MediaShape } from './plan-validation.js';

/** How many of a take's own frames at `takeRate` become `length` frames at `targetRate`. */
export function punchTakeFrames(length: number, targetRate: number, takeRate: number): number {
  return takeRate === targetRate ? length : convertedFrameCount(length, targetRate, takeRate);
}

/**
 * Why `take` cannot be played by a punch of `punch` into audio of `target`'s
 * rate and layout, or `undefined` where it can.
 */
export function punchTakeProblem(
  take: Take,
  punch: PunchRange,
  target: Pick<EditShape, 'sampleRate' | 'layout'>,
  assets: ReadonlyMap<AssetId, MediaShape>,
): string | undefined {
  const recorded = assets.get(take.asset);
  if (recorded === undefined) return 'The take names a recording the project does not have.';
  if (channelCount(recorded.channelLayout) !== channelCount(target.layout)) {
    return 'The take has another number of channels than the audio it would replace.';
  }
  const from = punch.preRoll + take.compensation;
  if (from < 0) return 'The take’s latency compensation reaches before its recording starts.';
  const needed = punchTakeFrames(punch.length, target.sampleRate, recorded.sampleRate);
  return from + needed <= recorded.length
    ? undefined
    : 'The take is shorter than the range it would replace.';
}

/**
 * Why a punch `edit` over `range`, on `channels`, cannot stand on a timeline
 * of `shape` in a project of `entities`, or `undefined` where it can.
 */
export function punchProblem(
  edit: PunchEdit,
  range: EditRange,
  channels: readonly number[] | undefined,
  shape: EditShape,
  entities: Pick<Project, 'assets' | 'takeStacks'>,
): string | undefined {
  if (channels !== undefined) return 'A punch replaces every channel.';
  const stack = entities.takeStacks.get(edit.stack);
  if (stack === undefined) return 'The punch names a take stack the project does not have.';
  const { punch } = stack;
  if (punch === undefined) return 'The punch names a take stack that was not recorded for one.';
  if (range.end - range.start !== punch.length) {
    return 'The punch’s range is not the length its take stack was recorded for.';
  }
  const take = chosenTake(stack);
  return take === undefined ? undefined : punchTakeProblem(take, punch, shape, entities.assets);
}
