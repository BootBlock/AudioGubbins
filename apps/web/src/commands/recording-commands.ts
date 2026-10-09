/**
 * The input's commands (`ADR-0070`): disarming it, saying its levels, choosing
 * it, monitoring it, choosing the chain it is monitored through, calibrating
 * its latency, and restarting the audio engine at its own rate, as the
 * recording diagnostics offer. Arming it for a take is
 * `take-recording-commands.ts`'s.
 *
 * Each is a command, so the Recording panel, the menus, the palette and a
 * shortcut reach one route (REQ-EDIT-073). Monitoring has one command to turn
 * it on or off, and arming never turns it on (`REQ-REC-091`).
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { RECORDING } from '@audiogubbins/capabilities';

import { calibrating } from '../recording/calibration-control.js';
import { monitoringText } from '../recording/recording-words.js';
import { needing } from './audio-commands.js';
import { idArgument } from './project-access.js';
import { availableUnless, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The command that turns monitoring on or off, which a default shortcut runs. */
export const TOGGLE_MONITORING = 'recording.toggle-monitoring';

/** The command that monitors through an asset's rack, named by its `asset` argument. */
export const MONITOR_THROUGH = 'recording.monitor-through';

/** The command that chooses the input, named by its `device` argument. */
export const CHOOSE_INPUT = 'recording.choose-input';

/** The command that restarts the audio engine at the open input's own rate. */
export const RESTART_AT_INPUT_RATE = 'recording.restart-at-input-rate';

function inputCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'recording.disarm',
      'Disarm the input',
      CommandCategory.Transport,
      (context) => {
        // Said by the status bar, which says the input closed.
        const disarmed = context.recording.input.disarm();
        return disarmed.ok ? undefined : disarmed.failures[0].summary;
      },
      {
        keywords: ['disarm', 'close', 'input', 'microphone', 'stop listening'],
        description:
          'Closes the input. Whatever the retrospective buffer held is overwritten and let go.',
        availability: (context) => {
          const { session } = context.recording.input.view.get();
          return availableUnless(
            session.kind === 'armed' || session.kind === 'counting-in'
              ? undefined
              : 'No input is armed.',
          );
        },
      },
    ),
    shellCommand(
      'recording.say-levels',
      'Say the input levels',
      CommandCategory.Transport,
      (context) => {
        const said = context.recording.input.sayLevels();
        if (!said.ok) return said.failures[0].summary;
        context.interaction.announce(said.value);
        return undefined;
      },
      {
        keywords: ['levels', 'meter', 'peak', 'gain', 'input', 'loud', 'clip', 'say'],
        description:
          'Says the input level now and the highest it reached since last said. Levels are said by themselves when the input goes quiet after a passage.',
        availability: (context) =>
          availableUnless(
            context.recording.input.view.get().opened === undefined
              ? 'No input is open, so there are no levels to say.'
              : undefined,
          ),
      },
    ),
    shellCommand(
      CHOOSE_INPUT,
      'Choose the input',
      CommandCategory.Transport,
      (context, invocation) => {
        const id = textArgument(invocation, 'device');
        const device = context.recording.input.view
          .get()
          .devices.find((one) => one.deviceId !== undefined && one.deviceId === id);
        if (device?.deviceId === undefined) return 'There is no such input.';
        const { session } = context.recording.input.view.get();
        const inSession = 'device' in session ? session.device.id : undefined;
        if (
          context.audioSettings.get().recording.input?.id === device.deviceId &&
          (inSession === undefined || inSession === device.deviceId)
        ) {
          return unchanged(
            'recording.input-chosen',
            `${device.label ?? 'That input'} is chosen already.`,
          );
        }
        const chosen = context.recording.input.chooseDevice({
          id: device.deviceId,
          ...(device.groupId === undefined ? {} : { group: device.groupId }),
          ...(device.label === undefined ? {} : { label: device.label }),
        });
        if (!chosen.ok) return chosen.failures[0].summary;
        context.interaction.announce(`${device.label ?? 'The input'} is chosen.`);
        return undefined;
      },
      {
        keywords: ['input', 'device', 'microphone', 'interface', 'choose'],
        description: 'Chooses the input recordings are taken from, and remembers it.',
        // Only a list of the inputs can name one.
        discoverable: false,
        availability: (context) =>
          availableUnless(
            context.recording.input.view.get().session.kind === 'recording'
              ? 'The input cannot change while recording.'
              : undefined,
          ),
      },
    ),
  ];
}

function monitoringCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      TOGGLE_MONITORING,
      'Turn input monitoring on or off',
      CommandCategory.Transport,
      (context) => {
        const { monitoring } = context.recording;
        const toggled = monitoring.toggle();
        if (!toggled.ok) return toggled.failures[0].summary;
        // Monitoring on or off is said by the status bar, as every change of
        // the input's state is; a warning waiting for confirmation is not a
        // change of state, so it is said here.
        const now = monitoring.view.get();
        if (now.monitoring.kind === 'confirming') context.interaction.announce(monitoringText(now));
        return undefined;
      },
      {
        keywords: ['monitor', 'monitoring', 'hear', 'listen', 'input', 'headphones', 'foldback'],
        description:
          'Plays the input to the output as it is recorded, or stops. Off until you turn it on; arming never turns it on.',
        availability: (context) =>
          availableUnless(
            context.recording.monitoring.view.get().monitoring.kind === 'unavailable'
              ? 'No input is open, so there is nothing to monitor.'
              : undefined,
          ),
      },
    ),
    shellCommand(
      'recording.confirm-monitoring',
      'Monitor despite the risk of feedback',
      CommandCategory.Transport,
      (context) => {
        const { monitoring } = context.recording;
        // Said by the status bar, which says monitoring once it is on.
        const confirmed = monitoring.confirm();
        return confirmed.ok ? undefined : confirmed.failures[0].summary;
      },
      {
        keywords: ['monitor', 'feedback', 'confirm', 'speakers'],
        description:
          'Starts monitoring the person asked for once they accept that it may feed back.',
        availability: (context) =>
          availableUnless(
            context.recording.monitoring.view.get().monitoring.kind === 'confirming'
              ? undefined
              : 'No feedback warning is waiting to be confirmed.',
          ),
      },
    ),
    shellCommand(
      MONITOR_THROUGH,
      "Monitor through an asset's rack",
      CommandCategory.Transport,
      (context, invocation) => {
        const named = idArgument<'AssetId'>(invocation, 'asset', 'asset');
        if ('refused' in named) return named.refused;
        const open = context.projects?.project.get();
        const project = open?.kind === 'open' ? open.snapshot.model.state.project : undefined;
        const asset = project?.assets.get(named.id);
        const chain = asset?.rack === undefined ? undefined : project?.effectChains.get(asset.rack);
        if (asset === undefined || chain === undefined)
          return 'That asset has no rack to monitor through.';
        const chosen = context.recording.monitoring.monitorThrough({
          asset: named.id,
          name: asset.displayName,
          chain,
        });
        if (!chosen.ok) return chosen.failures[0].summary;
        context.interaction.announce(`Monitoring through the rack of ${asset.displayName}.`);
        return undefined;
      },
      {
        keywords: ['monitor', 'rack', 'chain', 'effects', 'through'],
        description:
          'Monitors the input through the rack of an asset, run live. The recording stays dry.',
        // Only a list of the assets can name one.
        discoverable: false,
      },
    ),
    shellCommand(
      'recording.monitor-dry',
      'Monitor the dry input',
      CommandCategory.Transport,
      (context) => {
        const chosen = context.recording.monitoring.monitorThrough(undefined);
        if (!chosen.ok) return chosen.failures[0].summary;
        context.interaction.announce('Monitoring the dry input.');
        return undefined;
      },
      {
        keywords: ['monitor', 'dry', 'rack', 'chain', 'effects'],
        description: 'Monitors the input as it is captured, through no rack.',
        availability: (context) =>
          availableUnless(
            context.recording.monitoring.view.get().chain === undefined
              ? 'The input is monitored dry already.'
              : undefined,
          ),
      },
    ),
  ];
}

function calibrationCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'recording.calibrate',
      'Calibrate the recording latency',
      CommandCategory.Transport,
      (context) => {
        const started = context.recording.calibration.calibrate();
        if (!started.ok) return started.failures[0].summary;
        context.interaction.announce(
          'Calibrating: a short burst of noise plays and is listened for.',
        );
        return undefined;
      },
      {
        keywords: ['calibrate', 'latency', 'loopback', 'round trip', 'delay', 'offset'],
        description:
          'Plays a short burst through the output and listens for it at the input, to measure how late takes arrive. Place the microphone near the speaker, or connect the output to the input.',
        availability: needing(RECORDING, (context) => context.recording.calibration.refusal()),
      },
    ),
    shellCommand(
      'recording.cancel-calibration',
      'Cancel the latency calibration',
      CommandCategory.Transport,
      (context) => {
        const cancelled = context.recording.calibration.cancel();
        return cancelled.ok ? undefined : cancelled.failures[0].summary;
      },
      {
        keywords: ['cancel', 'calibration', 'latency'],
        availability: (context) =>
          availableUnless(
            calibrating(context.recording.calibration.stage.get())
              ? undefined
              : 'No calibration is running.',
          ),
      },
    ),
  ];
}

function engineCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      RESTART_AT_INPUT_RATE,
      "Restart the audio engine at the input's rate",
      CommandCategory.Transport,
      (context) => {
        // Said by the input control, which tells the person the input closed
        // with the engine, and why.
        const restarted = context.recording.engineRate.restart();
        return restarted.ok ? undefined : restarted.failures[0].summary;
      },
      {
        keywords: ['sample rate', 'rate', 'resample', 'restart', 'engine', 'input', 'hertz'],
        description:
          "Makes the audio engine again at the open input's own sample rate, so the browser stops resampling the input. The input closes, to be armed again at that rate. Playing audio at another rate makes the engine again at that audio's rate.",
        availability: needing(RECORDING, (context) => context.recording.engineRate.refusal()),
      },
    ),
  ];
}

/** Every command of the input, monitoring, the latency calibration and the engine's rate. */
export function recordingCommands(): readonly Command<ShellContext>[] {
  return [
    ...inputCommands(),
    ...monitoringCommands(),
    ...calibrationCommands(),
    ...engineCommands(),
  ];
}
