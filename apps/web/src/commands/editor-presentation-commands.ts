/**
 * How a view presents its asset: its tool (REQ-EDIT-065), its display mode
 * (REQ-EDIT-062), its channels and its amplitude. Each is the view's own
 * (REQ-EDIT-061): a change here leaves every other view of the asset, and the
 * asset, as they were. Its overlays, snapping, time format and following are
 * the options of `editor-option-commands.ts`, built the same way.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { channelCount } from '@audiogubbins/domain';
import {
  DisplayMode,
  ToolId,
  withAmplitudeStep,
  withChannelShown,
  type EditorViewState,
} from '@audiogubbins/editor-view';

import { editorTarget, needsEditor, numberArgument, type EditorTarget } from './editor-target.js';
import { shellCommand, type ShellCommandOptions } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

type Presentation = (
  state: EditorViewState,
  target: EditorTarget,
  invocation: CommandInvocation,
  context: ShellContext,
) => EditorViewState | string;

/** A command that changes a view's presentation, saying `said` of the view it leaves. */
export function presentationCommand(
  id: string,
  label: string,
  category: CommandCategory,
  change: Presentation,
  said: (state: EditorViewState) => string | undefined,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    category,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const next = change(target.state, target, invocation, context);
      if (typeof next === 'string') return next;
      if (next === target.state) {
        return unchanged('editor.presentation-unchanged', 'The view is already so.');
      }
      context.editorViews.change(target.panel, () => next);
      const sentence = said(next);
      if (sentence !== undefined) context.interaction.announce(sentence);
      return undefined;
    },
    { availability: needsEditor, ...extra },
  );
}

/** What each tool is called, and what it does, as the toolbar and the palette say. */
export const TOOLS: Readonly<Record<ToolId, { readonly name: string; readonly does: string }>> = {
  [ToolId.Select]: {
    name: 'Selection',
    does: 'Selects time across the lanes it is dragged over, and moves markers and selection edges.',
  },
  [ToolId.TimeSelect]: {
    name: 'Time selection',
    does: 'Selects time across every channel.',
  },
  [ToolId.Hand]: { name: 'Hand', does: 'Drags the view along the timeline.' },
  [ToolId.Zoom]: {
    name: 'Zoom',
    does: 'Zooms in where it is clicked, out with Alt, and to a range where it is dragged.',
  },
  [ToolId.Razor]: {
    name: 'Razor',
    does: 'Places the playhead exactly where a split would go; splitting itself arrives with clip editing.',
  },
  [ToolId.Marker]: { name: 'Marker', does: 'Adds a marker where it is clicked.' },
};

/** What each display mode is called. */
export const DISPLAY_MODES: Readonly<Record<DisplayMode, string>> = {
  [DisplayMode.Waveform]: 'Waveform',
  [DisplayMode.Spectrogram]: 'Spectrogram',
  [DisplayMode.Stacked]: 'Waveform above spectrogram',
  [DisplayMode.Overlay]: 'Waveform over spectrogram',
};

const DISPLAY_ORDER: readonly DisplayMode[] = [
  DisplayMode.Waveform,
  DisplayMode.Spectrogram,
  DisplayMode.Stacked,
  DisplayMode.Overlay,
];

function toolCommands(): readonly Command<ShellContext>[] {
  return Object.values(ToolId).map((tool) =>
    presentationCommand(
      `editor.tool-${tool}`,
      `${TOOLS[tool].name} tool`,
      CommandCategory.Tools,
      (state) => (state.tool === tool ? state : { ...state, tool }),
      () => `The ${TOOLS[tool].name.toLowerCase()} tool is in use.`,
      { keywords: ['tool', tool, TOOLS[tool].name.toLowerCase()], description: TOOLS[tool].does },
    ),
  );
}

function displayCommands(): readonly Command<ShellContext>[] {
  return [
    ...DISPLAY_ORDER.map((mode) =>
      presentationCommand(
        `editor.display-${mode}`,
        `Show as ${DISPLAY_MODES[mode].toLowerCase()}`,
        CommandCategory.View,
        (state) => (state.displayMode === mode ? state : { ...state, displayMode: mode }),
        () => `${DISPLAY_MODES[mode]}.`,
        { keywords: ['display', 'mode', 'show', ...DISPLAY_MODES[mode].toLowerCase().split(' ')] },
      ),
    ),
    presentationCommand(
      'editor.next-display-mode',
      'Next display mode',
      CommandCategory.View,
      (state) => {
        const next = DISPLAY_ORDER[(DISPLAY_ORDER.indexOf(state.displayMode) + 1) % 4];
        return next === undefined ? state : { ...state, displayMode: next };
      },
      (state) => `${DISPLAY_MODES[state.displayMode]}.`,
      { keywords: ['display', 'mode', 'next', 'cycle', 'spectrogram', 'waveform'] },
    ),
  ];
}

function channelCommands(): readonly Command<ShellContext>[] {
  return [
    presentationCommand(
      'editor.toggle-channel',
      'Show or hide a channel',
      CommandCategory.View,
      (state, { asset }, invocation) => {
        const channel = numberArgument(invocation, 'channel');
        const count = channelCount(asset.layout);
        if (
          channel === undefined ||
          !Number.isInteger(channel) ||
          channel < 0 ||
          channel >= count
        ) {
          return `${asset.name} has channels 1 to ${String(count)}.`;
        }
        const shown = state.hiddenChannels.includes(channel);
        const next = withChannelShown(state, channel, shown, count);
        return next === state && !shown ? 'The last channel shown cannot be hidden.' : next;
      },
      () => undefined,
      { discoverable: false },
    ),
    presentationCommand(
      'editor.show-all-channels',
      'Show every channel',
      CommandCategory.View,
      (state) => (state.hiddenChannels.length === 0 ? state : { ...state, hiddenChannels: [] }),
      () => 'Every channel is shown.',
      { keywords: ['channels', 'show', 'all', 'lanes', 'unhide'] },
    ),
  ];
}

function amplitudeCommands(): readonly Command<ShellContext>[] {
  return [
    presentationCommand(
      'editor.amplitude-up',
      'Magnify the waveform',
      CommandCategory.View,
      (state) => withAmplitudeStep(state, 1),
      (state) => `The waveform is magnified ${String(state.amplitude)} times.`,
      { keywords: ['amplitude', 'vertical', 'zoom', 'magnify', 'height'] },
    ),
    presentationCommand(
      'editor.amplitude-down',
      'Reduce the waveform',
      CommandCategory.View,
      (state) => withAmplitudeStep(state, -1),
      (state) =>
        state.amplitude === 1
          ? 'The waveform shows full scale at the edges of its lane.'
          : `The waveform is magnified ${String(state.amplitude)} times.`,
      { keywords: ['amplitude', 'vertical', 'zoom', 'reduce', 'height'] },
    ),
  ];
}

/** The commands that change how a view presents its asset. */
export function editorPresentationCommands(): readonly Command<ShellContext>[] {
  return [...toolCommands(), ...displayCommands(), ...channelCommands(), ...amplitudeCommands()];
}
