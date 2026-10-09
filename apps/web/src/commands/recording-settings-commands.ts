/**
 * The person's recording settings (`ADR-0070`, `REQ-REC-092`, `REQ-REC-095`):
 * the capture profile in use, their Custom profiles and which are for
 * headphones, the retrospective buffer, the count-in, where monitoring starts
 * by itself, and the latency calibration's manual offset.
 *
 * Each is a command, so the Audio settings' input section, the palette and a
 * macro reach one route (REQ-EDIT-073), and each refuses with the recording
 * package's own reason, having changed nothing. An armed input follows a new
 * profile or buffer at once (`input-control.ts`).
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
  type UnchangedOutcome,
} from '@audiogubbins/commands';
import {
  PROCESSING_CONTROLS,
  RAW_STUDIO_PROFILE,
  RETROSPECTIVE_OFF,
  VOICE_PROFILE,
  customProfile,
  retrospectiveOn,
  type CalibrationPath,
  type ProcessingChoice,
} from '@audiogubbins/recording';

import {
  chooseProfile,
  forgetCalibration,
  keepCustomProfile,
  markHeadphones,
  preferMonitoring,
  removeCustomProfile,
  setCountIn,
  setManualOffset,
  setRetrospective,
  type RecordingRevision,
} from '../state/recording-settings.js';
import { availableUnless, namingCommand, shellCommand, textArgument } from './shell-command.js';
import { calibrationPath } from '../recording/calibration-path.js';
import type { ShellContext } from './shell-context.js';

/** The command that chooses a capture profile, named by its `profile` argument. */
export const CHOOSE_PROFILE = 'recording.choose-profile';

/** The command that saves a Custom profile from its arguments. */
export const SAVE_CUSTOM_PROFILE = 'recording.save-custom-profile';

/** The command that removes the Custom profile its `profile` argument names. */
export const REMOVE_CUSTOM_PROFILE = 'recording.remove-custom-profile';

/** The command that marks the profile its `profile` argument names as for headphones, or not. */
export const MARK_HEADPHONES = 'recording.mark-headphones';

/** The command that keeps a retrospective buffer of its `seconds` argument. */
export const SET_RETROSPECTIVE = 'recording.set-retrospective';

/** The command that keeps no retrospective buffer. */
export const RETROSPECTIVE_OFF_COMMAND = 'recording.retrospective-off';

/** The command that sets the count-in to its `seconds` argument. */
export const SET_COUNT_IN = 'recording.set-count-in';

/** The command that starts monitoring by itself, or not, with this input and profile. */
export const MONITOR_AUTOMATICALLY = 'recording.monitor-automatically';

/** The command that sets the manual offset to its `milliseconds` argument. */
export const SET_MANUAL_OFFSET = 'recording.set-manual-offset';

/** The command that forgets the calibration of the path in use. */
export const FORGET_CALIBRATION = 'recording.forget-calibration';

/** A number argument, where the invocation gives one. */
function numberArgument(invocation: CommandInvocation, name: string): number | undefined {
  const value = invocation.arguments?.[name];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Applies `revise` to the settings, saying `success`; answers its refusal, or
 * that the settings were so already.
 */
export function revised(
  context: ShellContext,
  revise: RecordingRevision,
  success: string,
): string | UnchangedOutcome | undefined {
  const before = context.audioSettings.get().recording;
  const result = context.audioSettings.reviseRecording(revise);
  if (!result.ok) return result.failures[0].summary;
  if (result.value === before) {
    return unchanged('recording-settings.unchanged', 'The recording settings are so already.');
  }
  context.interaction.announce(success);
  return undefined;
}

/** The processing an invocation sets, every control a boolean, or why it does not. */
function processingArgument(invocation: CommandInvocation): ProcessingChoice | string {
  const given = invocation.arguments ?? {};
  const choice = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    voiceIsolation: false,
  };
  for (const control of PROCESSING_CONTROLS) {
    const value = given[control];
    if (typeof value !== 'boolean') return 'Say whether each kind of processing is on or off.';
    choice[control] = value;
  }
  return choice;
}

/** The calibration path in use, or why there is none yet. */
function currentPath(context: ShellContext): CalibrationPath | string {
  return calibrationPath(context.recording.input.view.get(), context.audioSettings.get().recording);
}

function profileCommands(): readonly Command<ShellContext>[] {
  const builtIn = (id: string, name: string, description: string): Command<ShellContext> =>
    shellCommand(
      id,
      `Capture profile: ${name}`,
      CommandCategory.Transport,
      (context) => revised(context, chooseProfile(name), `The ${name} capture profile is in use.`),
      {
        keywords: ['capture', 'profile', 'processing', 'echo', 'noise', 'gain', name],
        description,
        availability: (context) =>
          availableUnless(
            context.audioSettings.get().recording.chosenProfile === name
              ? `${name} is the capture profile in use already.`
              : undefined,
          ),
      },
    );
  return [
    builtIn(
      'recording.profile-raw-studio',
      RAW_STUDIO_PROFILE.name,
      'Asks the browser for no echo cancellation, noise suppression or automatic gain, so the recording is the source as it sounds.',
    ),
    builtIn(
      'recording.profile-voice',
      VOICE_PROFILE.name,
      "Asks for the browser's voice processing, as a call has it: echo cancellation, noise suppression and automatic gain.",
    ),
    shellCommand(
      CHOOSE_PROFILE,
      'Choose a capture profile',
      CommandCategory.Transport,
      (context, invocation) => {
        const name = textArgument(invocation, 'profile');
        if (name === undefined) return 'Say which capture profile.';
        return revised(context, chooseProfile(name), `The ${name} capture profile is in use.`);
      },
      { keywords: ['capture', 'profile'], discoverable: false },
    ),
    namingCommand(
      SAVE_CUSTOM_PROFILE,
      'Save a Custom capture profile',
      CommandCategory.Transport,
      (context, invocation) => {
        const processing = processingArgument(invocation);
        if (typeof processing === 'string') return processing;
        const made = customProfile(
          invocation.arguments?.['name'],
          processing,
          invocation.arguments?.['headphones'] === true,
        );
        if (!made.ok) return made.failures[0].summary;
        return revised(
          context,
          keepCustomProfile(made.value),
          `The ${made.value.name} capture profile is saved and in use.`,
        );
      },
      {
        keywords: ['capture', 'profile', 'custom', 'save', 'processing'],
        description: 'Saves a profile that sets each kind of browser processing on or off.',
        // Only the settings' form can give its processing.
        discoverable: false,
      },
    ),
    shellCommand(
      REMOVE_CUSTOM_PROFILE,
      'Remove a Custom capture profile',
      CommandCategory.Transport,
      (context, invocation) => {
        const name = textArgument(invocation, 'profile');
        if (name === undefined) return 'Say which capture profile.';
        return revised(
          context,
          removeCustomProfile(name),
          `The ${name} capture profile is removed.`,
        );
      },
      { keywords: ['capture', 'profile', 'remove', 'delete'], discoverable: false },
    ),
    shellCommand(
      MARK_HEADPHONES,
      'Mark a capture profile as used with headphones',
      CommandCategory.Transport,
      (context, invocation) => {
        const name = textArgument(invocation, 'profile');
        const headphones = invocation.arguments?.['headphones'];
        if (name === undefined || typeof headphones !== 'boolean') {
          return 'Say which capture profile, and whether it is used with headphones.';
        }
        return revised(
          context,
          markHeadphones(name, headphones),
          headphones
            ? `${name} is marked as used with headphones, so monitoring may start by itself with it.`
            : `${name} is no longer marked as used with headphones.`,
        );
      },
      { keywords: ['headphones', 'profile', 'monitoring'], discoverable: false },
    ),
  ];
}

function bufferCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      SET_RETROSPECTIVE,
      'Keep the seconds before Record',
      CommandCategory.Transport,
      (context, invocation) => {
        const seconds = numberArgument(invocation, 'seconds');
        if (seconds === undefined) return 'Say how many seconds to keep.';
        const setting = retrospectiveOn(seconds);
        if (!setting.ok) return setting.failures[0].summary;
        return revised(
          context,
          setRetrospective(setting.value),
          `While an input is armed, its last ${String(seconds)} seconds are kept in memory, and nowhere else, until you record.`,
        );
      },
      {
        keywords: ['retrospective', 'buffer', 'pre-record', 'before', 'seconds'],
        description:
          'Keeps the last few seconds of an armed input in memory, so a take can begin before you pressed Record.',
        discoverable: false,
      },
    ),
    shellCommand(
      RETROSPECTIVE_OFF_COMMAND,
      'Keep nothing before Record',
      CommandCategory.Transport,
      (context) =>
        revised(
          context,
          setRetrospective(RETROSPECTIVE_OFF),
          'Nothing is kept before Record; an armed input is not buffered.',
        ),
      {
        keywords: ['retrospective', 'buffer', 'off', 'pre-record'],
        description: 'Stops keeping the seconds before Record; whatever was kept is overwritten.',
        availability: (context) =>
          availableUnless(
            context.audioSettings.get().recording.retrospective.on
              ? undefined
              : 'Nothing is kept before Record already.',
          ),
      },
    ),
    shellCommand(
      SET_COUNT_IN,
      'Set the count-in',
      CommandCategory.Transport,
      (context, invocation) => {
        const seconds = numberArgument(invocation, 'seconds');
        if (seconds === undefined) return 'Say how many seconds to count in.';
        return revised(
          context,
          setCountIn(seconds),
          seconds === 0
            ? 'A controlled recording starts with no count-in.'
            : `A controlled recording counts in for ${String(seconds)} seconds.`,
        );
      },
      { keywords: ['count-in', 'pre-roll', 'count', 'seconds'], discoverable: false },
    ),
  ];
}

function preferenceCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      MONITOR_AUTOMATICALLY,
      'Start monitoring by itself with this input and profile',
      CommandCategory.Transport,
      (context, invocation) => {
        const on = invocation.arguments?.['on'];
        if (typeof on !== 'boolean') return 'Say whether monitoring starts by itself.';
        const { recording } = context.audioSettings.get();
        const device = context.recording.input.view.get().opened?.device ?? recording.input;
        if (device === undefined) return 'Choose an input first.';
        return revised(
          context,
          preferMonitoring(device, recording.chosenProfile, on),
          on
            ? 'Monitoring starts by itself with this input, where the profile is marked as used with headphones.'
            : 'Monitoring stays off when this input opens.',
        );
      },
      { keywords: ['monitoring', 'automatic', 'headphones'], discoverable: false },
    ),
    shellCommand(
      SET_MANUAL_OFFSET,
      'Set the recording latency offset',
      CommandCategory.Transport,
      (context, invocation) => {
        const milliseconds = numberArgument(invocation, 'milliseconds');
        if (milliseconds === undefined || !Number.isFinite(milliseconds)) {
          return 'Say the offset in milliseconds.';
        }
        const path = currentPath(context);
        if (typeof path === 'string') return path;
        const frames = Math.round((milliseconds / 1000) * path.rate);
        return revised(
          context,
          setManualOffset(path, frames),
          `Takes on this input are moved ${String(milliseconds)} milliseconds by hand, beside any measurement.`,
        );
      },
      { keywords: ['latency', 'offset', 'manual', 'calibration'], discoverable: false },
    ),
    shellCommand(
      FORGET_CALIBRATION,
      'Forget the latency calibration of this input',
      CommandCategory.Transport,
      (context) => {
        const path = currentPath(context);
        if (typeof path === 'string') return path;
        return revised(
          context,
          forgetCalibration(path),
          'The calibration is forgotten; takes are placed by the latencies the browser reports.',
        );
      },
      {
        keywords: ['latency', 'calibration', 'forget', 'reset'],
        availability: (context) => {
          const path = currentPath(context);
          return availableUnless(typeof path === 'string' ? path : undefined);
        },
      },
    ),
  ];
}

/** Every command of the person's recording settings. */
export function recordingSettingsCommands(): readonly Command<ShellContext>[] {
  return [...profileCommands(), ...bufferCommands(), ...preferenceCommands()];
}
