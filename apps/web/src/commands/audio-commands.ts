/**
 * The transport, the offline renderer and the performance profiles, acting on
 * the test signal. How renders are planned and how background work shares the
 * machine are the audio settings' commands (`audio-settings-commands.ts`).
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
import {
  JobPriority,
  PerformanceProfile,
  TransportMode,
  type RenderStrategy,
} from '@audiogubbins/audio-engine';

import { RenderDecision, rendering, type RenderStart } from '../audio/render-control.js';
import { TEST_SIGNAL_PROGRAMME } from '../audio/test-signal.js';
import type { Reasons } from '../state/reasons.js';
import { awaitingDecision } from '../state/render-strategy-store.js';
import { parkHeld } from './editor-target.js';
import { report, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What each profile is called, standing alone as it does in a list. */
export const PROFILE_NAMES: Readonly<Record<PerformanceProfile, string>> = {
  [PerformanceProfile.LowLatency]: 'Low latency',
  [PerformanceProfile.Balanced]: 'Balanced',
  [PerformanceProfile.MaximumStability]: 'Maximum stability',
  [PerformanceProfile.Custom]: 'Custom',
};

/**
 * The profiles, the presets from least margin to most and then the person's
 * own, as the panel and the settings offer them.
 */
export const PROFILES: readonly PerformanceProfile[] = [
  PerformanceProfile.LowLatency,
  PerformanceProfile.Balanced,
  PerformanceProfile.MaximumStability,
  PerformanceProfile.Custom,
];

/** The command that chooses a profile, for the panel and the settings to run. */
export function profileCommandId(profile: PerformanceProfile): string {
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
export function needing(
  requirement: FeatureRequirement,
  problem: (context: ShellContext) => string | undefined,
): (context: ShellContext) => CommandAvailability {
  return (context) => {
    const reason = missing(context, requirement) ?? problem(context);
    return reason === undefined ? AVAILABLE : unavailable(reason);
  };
}

/** What the transport is doing, where a session has said. */
export function modeOf(context: ShellContext): TransportMode | undefined {
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
      context.playback.play(TEST_SIGNAL_PROGRAMME);
    },
    {
      keywords: ['play', 'start', 'tone', 'test', 'sine', 'listen'],
      description:
        'Plays a 440 Hz test tone through the audio engine and its processing graph. Nothing plays until you ask.',
      availability: needing(AUDIO_PLAYBACK, (context) => {
        if (context.audio.get().starting) return 'Playback is starting.';
        return modeOf(context) === TransportMode.Playing &&
          context.playback.programme() === TEST_SIGNAL_PROGRAMME.key
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
    (context) => {
      const refused = context.playback.pause();
      // Kept for the asset, so its views and its next Play find it there.
      if (refused === undefined) parkHeld(context);
      return report(context, refused, 'Playback is paused.');
    },
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
    (context) => {
      const refused = context.playback.stop();
      if (refused === undefined) parkHeld(context);
      return report(context, refused, 'Playback is stopped.');
    },
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

/** What starting a render says: where it runs. */
function startSaid(strategy: RenderStrategy): string {
  return strategy.priority === JobPriority.Background
    ? 'Rendering the test signal offline, in the background.'
    : 'Rendering the test signal offline.';
}

/**
 * A render's start as a command's answer: its reasons where it was refused,
 * and nothing once what happened is said.
 */
function reportStart(context: ShellContext, start: RenderStart): Reasons | undefined {
  switch (start.kind) {
    case 'refused':
      return start.reasons;
    case 'awaiting-decision':
      context.interaction.announce(start.told);
      return undefined;
    case 'started':
      context.interaction.announce(startSaid(start.strategy));
      return undefined;
  }
}

function renderCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.render-test-signal',
    'Render the test signal offline',
    CommandCategory.Transport,
    (context) => reportStart(context, context.rendering.render()),
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

/** The two answers to a render waiting on a warning: the safer strategy, or the one chosen. */
function decisionCommands(): readonly Command<ShellContext>[] {
  return (
    [
      [
        RenderDecision.Safer,
        'transport.render-safer',
        'Render in the background, as the warning offers',
        'Starts the render waiting on a warning in the background, so playback and editing keep the processor first. The output is the same either way.',
      ],
      [
        RenderDecision.AsChosen,
        'transport.render-as-chosen',
        'Render as chosen, over the warning',
        'Starts the render waiting on a warning as you set it up, knowing what the warning says it risks.',
      ],
    ] as const
  ).map(([decision, id, label, description]) =>
    shellCommand(
      id,
      label,
      CommandCategory.Transport,
      (context) => reportStart(context, context.rendering.proceed(decision)),
      {
        keywords: ['render', 'warning', 'background', 'proceed', 'anyway', 'safer'],
        description,
        availability: needing(OFFLINE_RENDERING, (context) =>
          awaitingDecision(context.renderStrategy.get()) === undefined
            ? 'No render is waiting for a decision.'
            : undefined,
        ),
      },
    ),
  );
}

function profileCommands(): readonly Command<ShellContext>[] {
  return PROFILES.map((profile) => {
    const name = PROFILE_NAMES[profile];
    return shellCommand(
      profileCommandId(profile),
      `Use the ${name} performance profile`,
      CommandCategory.Transport,
      (context) => {
        context.audioSettings.chooseProfile(profile);
        context.playback.useProfile(context.audioSettings.get().chosen);
        context.interaction.announce(`The performance profile is ${name}.`);
      },
      {
        keywords: ['profile', 'performance', 'latency', 'stability', 'buffer', 'underrun'],
        description:
          profile === PerformanceProfile.Custom
            ? 'Plays and renders with the buffering and scheduling you set in the Audio settings. It never changes what AudioGubbins can do, or a rendered sample.'
            : 'Trades how soon a change is heard against how much margin the audio has before it runs dry. It never changes what AudioGubbins can do, or a rendered sample.',
        availability: (context) =>
          context.audioSettings.get().chosen.profile === profile
            ? unavailable(`${name} is already the performance profile.`)
            : AVAILABLE,
      },
    );
  });
}

/** Every command that plays, renders or chooses a profile for the audio engine. */
export function audioCommands(): readonly Command<ShellContext>[] {
  return [
    playCommand(),
    pauseCommand(),
    stopCommand(),
    renderCommand(),
    ...decisionCommands(),
    ...profileCommands(),
  ];
}
