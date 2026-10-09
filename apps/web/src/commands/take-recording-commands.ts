/**
 * Recording takes (`ADR-0070`, `ADR-0072`, `REQ-REC-020`, `REQ-REC-093`):
 * arming the input for a new take stack, for the next take of a stack, or for a
 * punch over the range selected in the editor in use; Record, at once, as a
 * controlled recording with its count-in and timed stop, or at a set time;
 * Stop; and the punch's pre-roll, post-roll and the timed stop's length.
 *
 * Each is a command, so the Recording panel, the menus, the palette and a
 * shortcut reach one route (REQ-EDIT-073). Only the tab holding the project's
 * write lease arms or records (`REQ-STOR-098`), and the session's own reason is
 * given to any other.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { RECORDING } from '@audiogubbins/capabilities';
import { derivedSampleCount, isWellFormedId, unsafeBrandId } from '@audiogubbins/domain';
import type { ArmedPurpose } from '@audiogubbins/recording';
import { quoted } from '@audiogubbins/text';

import { calibrating } from '../recording/calibration-control.js';
import { punchPlayFrom } from '../recording/punch-start.js';
import type { RecordingPlan } from '../recording/controlled-run.js';
import { setPunchRolls, setTimedStop } from '../state/recording-settings.js';
import { needing } from './audio-commands.js';
import { RANGE_ONLY, editScope } from './edit-target.js';
import { numberArgument } from './editor-target.js';
import { readyProjects } from './project-access.js';
import { revised } from './recording-settings-commands.js';
import { programmeOf, recordingWhere } from './recording-where.js';
import { availableUnless, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The command that arms the input, for a new stack or the stack its `stack` argument names. */
export const ARM = 'recording.arm';

/** The command that arms a punch over the selected range. */
export const ARM_PUNCH = 'recording.arm-punch';

/** The commands that record and stop. */
export const RECORD = 'recording.record';
export const RECORD_AT = 'recording.record-at';
export const STOP_RECORDING = 'recording.stop';

/** The commands that set a punch's pre-roll and post-roll, and the timed stop. */
export const SET_PUNCH_ROLLS = 'recording.set-punch-rolls';
export const SET_TIMED_STOP = 'recording.set-timed-stop';

/** A time of day written as hours and minutes, and seconds where given. */
const TIME_OF_DAY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;

const MILLISECONDS_A_DAY = 86_400_000;

/** Whether this tab holds the open project for writing, or why no project can be recorded into. */
function leaseOf(context: ShellContext): boolean | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  if (stores.project.get().kind !== 'open') {
    return 'Open a project to record into: a recording becomes one of its assets.';
  }
  return stores.project.session() !== undefined;
}

/** The purpose an arming names: the stack its `stack` argument names, or a new one. */
function purposeOf(invocation: CommandInvocation): ArmedPurpose | string {
  const stack = textArgument(invocation, 'stack');
  if (stack === undefined) return { kind: 'new-stack' };
  return isWellFormedId(stack)
    ? { kind: 'take', stack: unsafeBrandId<'TakeStackId'>(stack) }
    : 'There is no such take stack.';
}

/** Why the input cannot be armed for `purpose` now, or nothing where it can. */
function armProblem(context: ShellContext, purpose: ArmedPurpose): string | undefined {
  const { arming, calibration } = context.recording;
  if (calibrating(calibration.stage.get())) return 'A latency calibration is running.';
  const lease = leaseOf(context);
  if (typeof lease === 'string') return lease;
  return arming.refusal(purpose, lease);
}

/** Arms the input for `purpose`, saying why not where it cannot be. */
function armFor(
  context: ShellContext,
  purpose: ArmedPurpose,
  cue?: Parameters<ShellContext['recording']['arming']['arm']>[0]['cue'],
): string | undefined {
  const lease = leaseOf(context);
  if (typeof lease === 'string') return lease;
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const armed = context.recording.arming.arm({
    purpose,
    holdsWriteLease: lease,
    client: stores.recordings,
    ...(cue === undefined ? {} : { cue }),
  });
  // Said by the status bar once the input opens, or here with its reason.
  return armed.ok ? undefined : armed.failures[0].summary;
}

/**
 * Arms a punch over the range selected in the editor in use, with the pre-roll
 * and post-roll the settings give, the pre-roll shortened where the audio has
 * less before the range; its audio is cued so the input joins the context it
 * plays in.
 */
function armPunch(context: ShellContext, invocation: CommandInvocation): string | undefined {
  const scope = editScope(context, invocation, RANGE_ONLY);
  if (typeof scope === 'string') return scope;
  if (scope.target.channels !== undefined) {
    return 'A punch records over every channel. Select the range on every channel first.';
  }
  const { asset } = scope.project.owner;
  const { start, end } = scope.target.range;
  const settings = context.audioSettings.get().recording;
  const rate = asset.sampleRate;
  const wanted = Math.round(settings.punchPreRollSeconds * rate);
  const preRoll = derivedSampleCount(Math.min(wanted, start));
  const purpose: ArmedPurpose = {
    kind: 'punch',
    asset: asset.id,
    start,
    length: derivedSampleCount(end - start),
    preRoll,
    postRoll: derivedSampleCount(Math.round(settings.punchPostRollSeconds * rate)),
  };
  const programme = programmeOf(context, asset.id);
  if (typeof programme === 'string') return programme;
  const place = { asset, start, length: purpose.length, preRoll, postRoll: purpose.postRoll };
  const refused = armFor(context, purpose, {
    programme,
    from: punchPlayFrom(place, rate),
    rate,
  });
  if (refused !== undefined) return refused;
  if (preRoll < wanted) {
    context.interaction.announce(
      `The pre-roll is shortened to what ${quoted(asset.displayName)} has before the range.`,
    );
  }
  return undefined;
}

/** The controlled recording the settings set, starting at `startAt` where given. */
function planOf(context: ShellContext, startAt?: number): RecordingPlan {
  const { countInSeconds, stopAfterSeconds } = context.audioSettings.get().recording;
  return {
    countInSeconds,
    ...(stopAfterSeconds > 0 ? { stopAfterSeconds } : {}),
    ...(startAt === undefined ? {} : { startAt }),
  };
}

/** Records into the open project as `plan` says, or says why not. */
function recordWith(context: ShellContext, plan: RecordingPlan): string | undefined {
  const where = recordingWhere(context);
  if (typeof where === 'string') return where;
  const recorded = context.recording.takes.record(where, plan);
  return recorded.ok ? undefined : recorded.failures[0].summary;
}

/** The next time of day `text` names after `now`, in milliseconds since the epoch, or why none. */
function nextTimeOfDay(text: string, now: number): number | string {
  const match = TIME_OF_DAY.exec(text.trim());
  const [hours, minutes, seconds] = [match?.[1], match?.[2], match?.[3] ?? '0'].map(Number);
  if (
    match === null ||
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return 'Give the time as hours and minutes, such as 14:30, or with seconds, such as 14:30:15.';
  }
  const at = new Date(now);
  at.setHours(hours, minutes, seconds, 0);
  const time = at.getTime();
  return time > now ? time : time + MILLISECONDS_A_DAY;
}

/** Why Record cannot be pressed now, or nothing where it can. */
function recordProblem(context: ShellContext): string | undefined {
  const where = recordingWhere(context);
  return typeof where === 'string' ? where : context.recording.takes.recordRefusal();
}

function armCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      ARM,
      'Arm the input',
      CommandCategory.Transport,
      (context, invocation) => {
        const purpose = purposeOf(invocation);
        return typeof purpose === 'string' ? purpose : armFor(context, purpose);
      },
      {
        keywords: ['arm', 'record', 'input', 'microphone', 'mic', 'interface', 'open', 'take'],
        description:
          'Opens the chosen input to record a new take stack, or the next take of the stack named, asking for the microphone where it is not allowed yet. Monitoring stays off.',
        availability: needing(RECORDING, (context) => armProblem(context, { kind: 'new-stack' })),
      },
    ),
    shellCommand(ARM_PUNCH, 'Arm a punch over the selection', CommandCategory.Transport, armPunch, {
      keywords: ['punch', 'punch-in', 'replace', 'drop in', 'arm', 'record', 'pre-roll'],
      description:
        'Arms the input to record over the selected range, with a pre-roll before it and a post-roll after it. The take is a new recording, and the audio it replaces is kept.',
      availability: needing(RECORDING, (context) => {
        const lease = leaseOf(context);
        return typeof lease === 'string' ? lease : undefined;
      }),
    }),
  ];
}

function recordCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      RECORD,
      'Record',
      CommandCategory.Transport,
      (context) => recordWith(context, planOf(context)),
      {
        keywords: ['record', 'take', 'capture', 'start recording', 'punch'],
        description:
          'Records a take where the armed input is meant to: a new stack, the next take of a stack, or a punch over its range, with the count-in and timed stop the settings set.',
        availability: needing(RECORDING, recordProblem),
      },
    ),
    shellCommand(
      RECORD_AT,
      'Record at a set time',
      CommandCategory.Transport,
      (context, invocation) => {
        const text = textArgument(invocation, 'time');
        if (text === undefined) return 'Say what time to start recording.';
        const startAt = nextTimeOfDay(text, context.clock.now());
        return typeof startAt === 'string'
          ? startAt
          : recordWith(context, planOf(context, startAt));
      },
      {
        keywords: ['record', 'schedule', 'timer', 'start at', 'time'],
        description:
          'Starts a recording at the time given, while this page stays open, armed and in view.',
        discoverable: false,
        availability: needing(RECORDING, recordProblem),
      },
    ),
    shellCommand(
      STOP_RECORDING,
      'Stop recording',
      CommandCategory.Transport,
      (context) => {
        const stopped = context.recording.takes.stop();
        return stopped.ok ? undefined : stopped.failures[0].summary;
      },
      {
        keywords: ['stop', 'record', 'take', 'end', 'cancel'],
        description:
          'Stops the take being recorded, keeping all of it, or the count-in, pre-roll or scheduled start before one.',
        availability: (context) => {
          const { session } = context.recording.input.view.get();
          const progress = context.recording.takes.progress.get();
          return availableUnless(
            session.kind === 'recording' ||
              session.kind === 'counting-in' ||
              progress.kind === 'scheduled' ||
              progress.kind === 'pre-roll'
              ? undefined
              : 'Nothing is being recorded.',
          );
        },
      },
    ),
  ];
}

function settingCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      SET_PUNCH_ROLLS,
      "Set a punch's pre-roll and post-roll",
      CommandCategory.Transport,
      (context, invocation) => {
        const preRoll = numberArgument(invocation, 'preRoll');
        const postRoll = numberArgument(invocation, 'postRoll');
        if (preRoll === undefined || postRoll === undefined) {
          return 'Say how many seconds of pre-roll and of post-roll.';
        }
        return revised(
          context,
          setPunchRolls(preRoll, postRoll),
          `A punch plays and records ${String(preRoll)} seconds before its range and ${String(postRoll)} after it.`,
        );
      },
      { keywords: ['punch', 'pre-roll', 'post-roll', 'seconds'], discoverable: false },
    ),
    shellCommand(
      SET_TIMED_STOP,
      'Set the timed stop',
      CommandCategory.Transport,
      (context, invocation) => {
        const seconds = numberArgument(invocation, 'seconds');
        if (seconds === undefined) return 'Say after how many seconds a recording stops.';
        return revised(
          context,
          setTimedStop(seconds),
          seconds === 0
            ? 'A recording runs until you stop it.'
            : `A recording stops by itself after ${String(seconds)} seconds.`,
        );
      },
      { keywords: ['timed', 'stop after', 'length', 'timer', 'seconds'], discoverable: false },
    ),
  ];
}

/** Every command that arms, records, stops, and sets how a take is recorded. */
export function takeRecordingCommands(): readonly Command<ShellContext>[] {
  return [...armCommands(), ...recordCommands(), ...settingCommands()];
}
