/**
 * The audio settings a person may change beyond choosing a profile: the
 * Custom profile's buffering and scheduling (REQ-ARCH-083), how background
 * work shares the machine with playback and editing (REQ-ARCH-084), and the
 * processing mode renders use over the automatic choice (REQ-ARCH-079).
 *
 * Each is a command, so the settings dialogue, the palette and a shortcut
 * reach one route (REQ-EDIT-073). None needs a capability: each changes how
 * work is buffered, queued or ordered, never whether it can be done.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  PerformanceProfile,
  ProcessingMode,
  SchedulingPolicy,
  isLatencyHint,
  type PerformanceSettings,
} from '@audiogubbins/audio-engine';

import type { Reasons } from '../state/reasons.js';
import { report, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The command that replaces the Custom profile's settings. */
export const SET_CUSTOM_PROFILE = 'transport.set-custom-profile';

/** What each priority policy is called, standing alone as it does in a list. */
export const POLICY_NAMES: Readonly<Record<SchedulingPolicy, string>> = {
  [SchedulingPolicy.InteractiveFirst]: 'Playback and editing first',
  [SchedulingPolicy.Throughput]: 'Background work as fast as possible',
};

/** The policies, the default first, as the settings offer them. */
export const POLICIES: readonly SchedulingPolicy[] = [
  SchedulingPolicy.InteractiveFirst,
  SchedulingPolicy.Throughput,
];

/** The command that chooses a priority policy. */
export function policyCommandId(policy: SchedulingPolicy): string {
  return `transport.priority-${policy}`;
}

/** A render mode the person may set, or the automatic choice. */
export type RenderModeSetting =
  typeof ProcessingMode.FinalOffline | typeof ProcessingMode.BackgroundOffline | 'automatic';

/** What each render mode setting is called, standing alone as it does in a list. */
export const RENDER_MODE_NAMES: Readonly<Record<RenderModeSetting, string>> = {
  automatic: 'Automatic',
  [ProcessingMode.FinalOffline]: 'Final offline rendering',
  [ProcessingMode.BackgroundOffline]: 'Background rendering',
};

/** The render mode settings, automatic first, as the panel and the settings offer them. */
export const RENDER_MODE_SETTINGS: readonly RenderModeSetting[] = [
  'automatic',
  ProcessingMode.FinalOffline,
  ProcessingMode.BackgroundOffline,
];

/** The command that sets the render mode. */
export function renderModeCommandId(setting: RenderModeSetting): string {
  return `transport.render-mode-${setting}`;
}

/** The render mode setting a stored mode stands for. */
export function renderModeSetting(mode: ProcessingMode | undefined): RenderModeSetting {
  return mode === ProcessingMode.FinalOffline || mode === ProcessingMode.BackgroundOffline
    ? mode
    : 'automatic';
}

/** The Custom settings given as numbers, with what the person calls each. */
const NUMBER_FIELDS = [
  ['feedAheadMilliseconds', 'The feed-ahead time'],
  ['backgroundConcurrencyWhileInteractive', 'The background work while playing'],
  ['renderChunkMilliseconds', 'The render chunk length'],
] as const;

/** A number argument, where the invocation gives one. */
function numberArgument(invocation: CommandInvocation, name: string): number | undefined {
  const value = invocation.arguments?.[name];
  return typeof value === 'number' ? value : undefined;
}

/**
 * The Custom settings an invocation asks for: each field it names, in the form
 * the field takes, over the settings as they are. A field in the wrong form is
 * a reason to refuse, not one to skip, so nobody believes a value was kept
 * that was not.
 */
function requestedCustom(
  invocation: CommandInvocation,
  current: PerformanceSettings,
): { readonly settings: PerformanceSettings } | { readonly refused: Reasons } {
  const given = invocation.arguments ?? {};
  const problems: string[] = [];
  const hint = given['latencyHint'];
  if (hint !== undefined && !isLatencyHint(hint)) {
    problems.push('A latency hint is interactive, balanced, playback, or a number of seconds.');
  }
  for (const [name, meaning] of NUMBER_FIELDS) {
    if (given[name] !== undefined && numberArgument(invocation, name) === undefined) {
      problems.push(`${meaning} must be a number.`);
    }
  }
  const [first, ...rest] = problems;
  if (first !== undefined) return { refused: [first, ...rest] };
  return {
    settings: {
      latencyHint: isLatencyHint(hint) ? hint : current.latencyHint,
      feedAheadMilliseconds:
        numberArgument(invocation, 'feedAheadMilliseconds') ?? current.feedAheadMilliseconds,
      backgroundConcurrencyWhileInteractive:
        numberArgument(invocation, 'backgroundConcurrencyWhileInteractive') ??
        current.backgroundConcurrencyWhileInteractive,
      renderChunkMilliseconds:
        numberArgument(invocation, 'renderChunkMilliseconds') ?? current.renderChunkMilliseconds,
    },
  };
}

function customProfileCommand(): Command<ShellContext> {
  return shellCommand(
    SET_CUSTOM_PROFILE,
    'Set the Custom performance profile',
    CommandCategory.Transport,
    (context, invocation) => {
      const before = context.audioSettings.get();
      const requested = requestedCustom(invocation, before.custom);
      if ('refused' in requested) return requested.refused;
      const refused = context.audioSettings.setCustom(requested.settings);
      if (refused !== undefined) return refused;
      const after = context.audioSettings.get();
      if (after === before) {
        return unchanged(
          'audio.custom-unchanged',
          'The Custom profile already has these settings.',
        );
      }
      // In force, the new settings need a context of their own, as a change of
      // profile does; kept for later, they change nothing that plays now.
      const inForce = after.chosen.profile === PerformanceProfile.Custom;
      if (inForce) context.playback.useProfile(after.chosen);
      context.interaction.announce(
        inForce
          ? 'The Custom profile is changed, and in force.'
          : 'The Custom profile is changed. Choose it to use it.',
      );
      return undefined;
    },
    {
      keywords: ['custom', 'profile', 'performance', 'latency', 'buffer', 'chunk', 'feed'],
      description:
        'Sets the buffering and scheduling the Custom profile uses. It never changes what AudioGubbins can do, or a rendered sample.',
      // Only a form can supply the settings, so a palette entry or a key could
      // only refuse.
      discoverable: false,
    },
  );
}

function policyCommands(): readonly Command<ShellContext>[] {
  return POLICIES.map((policy) => {
    const name = POLICY_NAMES[policy];
    return shellCommand(
      policyCommandId(policy),
      `Background priority: ${name}`,
      CommandCategory.Transport,
      (context) => {
        context.audioSettings.choosePriorityPolicy(policy);
        context.interaction.announce(`Background priority: ${name}.`);
      },
      {
        keywords: ['priority', 'background', 'throughput', 'interactive', 'batch', 'queue'],
        description:
          policy === SchedulingPolicy.InteractiveFirst
            ? 'Starts work you are waiting on first, and holds background work to a share of the machine while you play or edit.'
            : 'Starts work in the order it was asked for, and lets background work take the whole machine, for when you are not playing or editing.',
        availability: (context) =>
          context.audioSettings.get().priorityPolicy === policy
            ? unavailable(`${name} is already the background priority.`)
            : AVAILABLE,
      },
    );
  });
}

function renderModeCommands(): readonly Command<ShellContext>[] {
  return RENDER_MODE_SETTINGS.map((setting) => {
    const name = RENDER_MODE_NAMES[setting];
    return shellCommand(
      renderModeCommandId(setting),
      `Render mode: ${name}`,
      CommandCategory.Transport,
      (context) =>
        report(
          context,
          context.audioSettings.chooseRenderMode(setting === 'automatic' ? undefined : setting),
          `Render mode: ${name}.`,
        ),
      {
        keywords: ['render', 'mode', 'background', 'foreground', 'offline', 'automatic'],
        description:
          setting === 'automatic'
            ? 'Renders in the foreground, or in the background where this machine was measured too slow to keep pace with the audio.'
            : setting === ProcessingMode.FinalOffline
              ? 'Renders in the foreground, before background work, however long it takes.'
              : 'Renders in the background, after playback, editing and work you are waiting on.',
        availability: (context) =>
          renderModeSetting(context.audioSettings.get().renderMode) === setting
            ? unavailable(`${name} is already the render mode.`)
            : AVAILABLE,
      },
    );
  });
}

/** Every command that changes the audio settings beyond the profile. */
export function audioSettingsCommands(): readonly Command<ShellContext>[] {
  return [customProfileCommand(), ...policyCommands(), ...renderModeCommands()];
}
