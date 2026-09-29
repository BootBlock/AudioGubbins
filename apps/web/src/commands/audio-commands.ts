/**
 * The transport, the offline renderer and the performance profiles, acting on
 * the test signal.
 *
 * Each is a command, so the Transport panel's buttons, the palette, a shortcut
 * and a macro reach one route (REQ-EDIT-073). A command whose feature this
 * browser cannot run stays in the palette, unavailable, with the reason the
 * Capabilities panel gives (WU-03.E): hidden, it would leave a person looking
 * for a feature the product has. A profile needs no capability, since a profile
 * changes buffering and scheduling and never what can be done.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import {
  AUDIO_PLAYBACK,
  FeatureStatus,
  OFFLINE_RENDERING,
  type FeatureRequirement,
} from '@audiogubbins/capabilities';
import { PerformanceProfile, TransportMode, type PresetProfile } from '@audiogubbins/audio-engine';

import { rendering } from '../audio/render-control.js';
import { report, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What each preset is called, standing alone as it does in a list. */
export const PROFILE_NAMES: Readonly<Record<PresetProfile, string>> = {
  [PerformanceProfile.LowLatency]: 'Low latency',
  [PerformanceProfile.Balanced]: 'Balanced',
  [PerformanceProfile.MaximumStability]: 'Maximum stability',
};

/** The presets, from least margin to most, as the panel offers them. */
export const PRESET_PROFILES: readonly PresetProfile[] = [
  PerformanceProfile.LowLatency,
  PerformanceProfile.Balanced,
  PerformanceProfile.MaximumStability,
];

/** The command that chooses a preset, for the panel to run. */
export function profileCommandId(profile: PresetProfile): string {
  return `transport.profile-${profile}`;
}

/**
 * Why the feature a command needs cannot run in this browser, in the words
 * the Capabilities panel lists it with, or `undefined` where it can.
 */
function missing(context: ShellContext, requirement: FeatureRequirement): string | undefined {
  const feature = context.capabilities.featureAvailability(requirement);
  return feature.status === FeatureStatus.Unavailable ? feature.explanation : undefined;
}

/** Available where `requirement` can run and `problem` finds nothing in the way. */
function needing(
  requirement: FeatureRequirement,
  problem: (context: ShellContext) => string | undefined,
): (context: ShellContext) => CommandAvailability {
  return (context) => {
    const reason = missing(context, requirement) ?? problem(context);
    return reason === undefined ? AVAILABLE : unavailable(reason);
  };
}

/** What the transport is doing, where a session has said. */
function modeOf(context: ShellContext): TransportMode | undefined {
  return context.audio.get().playback?.transport.mode;
}

const NOTHING_PLAYING = 'Nothing is playing.';

function playCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.play-test-signal',
    'Play the test signal',
    CommandCategory.Transport,
    (context) => {
      // Said by the playback once the audio is heard, or its reason if it is
      // not: the context, the module and the graph are still on their way.
      context.playback.play();
    },
    {
      keywords: ['play', 'start', 'tone', 'test', 'sine', 'listen'],
      description:
        'Plays a 440 Hz test tone through the audio engine and its processing graph. Nothing plays until you ask.',
      availability: needing(AUDIO_PLAYBACK, (context) => {
        if (context.audio.get().starting) return 'The test signal is starting.';
        return modeOf(context) === TransportMode.Playing
          ? 'The test signal is already playing.'
          : undefined;
      }),
    },
  );
}

function pauseCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.pause',
    'Pause',
    CommandCategory.Transport,
    (context) => report(context, context.playback.pause(), 'Playback is paused.'),
    {
      keywords: ['pause', 'hold', 'transport'],
      availability: needing(AUDIO_PLAYBACK, (context) => {
        const mode = modeOf(context);
        return mode === TransportMode.Playing || mode === TransportMode.Suspended
          ? undefined
          : NOTHING_PLAYING;
      }),
    },
  );
}

function stopCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.stop',
    'Stop',
    CommandCategory.Transport,
    (context) => report(context, context.playback.stop(), 'Playback is stopped.'),
    {
      keywords: ['stop', 'halt', 'transport'],
      description: 'Stops playback and returns to where it last started.',
      availability: needing(AUDIO_PLAYBACK, (context) => {
        const mode = modeOf(context);
        return mode === undefined || mode === TransportMode.Stopped ? NOTHING_PLAYING : undefined;
      }),
    },
  );
}

function renderCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.render-test-signal',
    'Render the test signal offline',
    CommandCategory.Transport,
    (context) => report(context, context.rendering.render(), 'Rendering the test signal offline.'),
    {
      keywords: ['render', 'offline', 'bounce', 'export', 'test', 'fingerprint'],
      description:
        'Renders the test tone at 48 kHz and maximum quality in a background thread, and shows its fingerprint, which is the same on every machine.',
      availability: needing(OFFLINE_RENDERING, (context) =>
        rendering(context.audio.get()) ? 'The test signal is already rendering.' : undefined,
      ),
    },
  );
}

function profileCommands(): readonly Command<ShellContext>[] {
  return PRESET_PROFILES.map((profile) => {
    const name = PROFILE_NAMES[profile];
    return shellCommand(
      profileCommandId(profile),
      `Use the ${name} performance profile`,
      CommandCategory.Transport,
      (context) => {
        context.playback.useProfile(profile);
        context.interaction.announce(`The performance profile is ${name}.`);
      },
      {
        keywords: ['profile', 'performance', 'latency', 'stability', 'buffer', 'underrun'],
        description:
          'Trades how soon a change is heard against how much margin the audio has before it runs dry. It never changes what AudioGubbins can do, or a rendered sample.',
        availability: (context) =>
          context.audio.get().profile === profile
            ? unavailable(`${name} is already the performance profile.`)
            : AVAILABLE,
      },
    );
  });
}

/** Every command that plays, renders or tunes the audio engine. */
export function audioCommands(): readonly Command<ShellContext>[] {
  return [playCommand(), pauseCommand(), stopCommand(), renderCommand(), ...profileCommands()];
}
