/**
 * How a view's spectral tools draw (ADR-0082): the brush's radius and hardness,
 * the softness the marquee's and the lasso's shapes fade out across, and the
 * combination mode, how a shape drawn with no modifier held joins the
 * selection, which is how a finger or a pen adds to it and takes from it. Each
 * is the view's own, as its tool is (REQ-EDIT-061), so each is a presentation
 * change, never undoable, and each runs from the Spectral panel, the palette or
 * a shortcut alike (REQ-EDIT-073). The stepping commands move a setting through
 * the steps of its control, so a setting reached from the keyboard and one set
 * with a slider are the same number.
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';
import { HIGHEST_MASK_FREQUENCY, NO_FEATHER, type SpectralFeather } from '@audiogubbins/domain';
import {
  SPECTRAL_TOOL_RANGES,
  brushRadiusOf,
  hardnessOf,
  type EditorViewState,
  type SpectralToolSettings,
} from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

import { frequencyWords } from '../wording.js';
import { numberArgument } from './editor-target.js';
import { presentationCommand } from './editor-presentation-commands.js';
import type { ShellContext } from './shell-context.js';

/** How far a step of the keyboard moves the brush's radius, in CSS pixels. */
const RADIUS_KEY_STEP = 2;

/** The longest softness a person may give in time, in milliseconds. */
const LONGEST_SOFTNESS_MS = 10_000;

/** `state` with `tools`, or `state` itself where nothing changed, so an unchanged view is said so. */
function withTools(state: EditorViewState, tools: SpectralToolSettings): EditorViewState {
  const now = state.spectralTools;
  return now.brushRadius === tools.brushRadius &&
    now.hardness === tools.hardness &&
    now.feather.time === tools.feather.time &&
    now.feather.frequency === tools.feather.frequency &&
    now.combination === tools.combination
    ? state
    : { ...state, spectralTools: tools };
}

/** The hardness as a reader is told it: a percentage, as its control shows it. */
export function hardnessWords(hardness: number): string {
  return `${String(Math.round(hardness * 100))}%`;
}

/** The brush as the commands say it. */
function brushSaid(state: EditorViewState): string {
  const { brushRadius, hardness } = state.spectralTools;
  return `The brush is ${String(brushRadius)} pixels in radius, ${hardnessWords(hardness)} hard.`;
}

/** The softness in words, as `20 ms and 50 Hz`, or none. */
export function softnessWords(feather: SpectralFeather, sampleRate: number): string {
  if (feather.time === 0) return 'none';
  const milliseconds = Math.round((feather.time / sampleRate) * 10_000) / 10;
  return `${String(milliseconds)} ms and ${frequencyWords(feather.frequency)}`;
}

function radiusCommands(): readonly Command<ShellContext>[] {
  const stepped = (direction: 1 | -1): Command<ShellContext> =>
    presentationCommand(
      direction === 1 ? 'editor.larger-brush' : 'editor.smaller-brush',
      direction === 1 ? 'Make the spectral brush larger' : 'Make the spectral brush smaller',
      CommandCategory.Tools,
      (state) => {
        const { brushRadius } = state.spectralTools;
        const next = brushRadiusOf(brushRadius + direction * RADIUS_KEY_STEP);
        if (next === brushRadius) {
          return `The brush is already at its ${direction === 1 ? 'largest' : 'smallest'}.`;
        }
        return withTools(state, { ...state.spectralTools, brushRadius: next });
      },
      brushSaid,
      { keywords: ['brush', 'size', 'radius', 'spectral', direction === 1 ? 'larger' : 'smaller'] },
    );
  return [
    presentationCommand(
      'editor.set-brush-radius',
      'Set the spectral brush’s radius',
      CommandCategory.Tools,
      (state, _target, invocation) => {
        const pixels = numberArgument(invocation, 'pixels');
        const { minimum, maximum } = SPECTRAL_TOOL_RANGES.brushRadius;
        if (pixels === undefined) {
          return `Choose a radius from ${String(minimum)} to ${String(maximum)} pixels.`;
        }
        return withTools(state, { ...state.spectralTools, brushRadius: brushRadiusOf(pixels) });
      },
      brushSaid,
      { keywords: ['brush', 'size', 'radius', 'spectral'], discoverable: false },
    ),
    stepped(1),
    stepped(-1),
  ];
}

function hardnessCommands(): readonly Command<ShellContext>[] {
  const { step, minimum, maximum } = SPECTRAL_TOOL_RANGES.hardness;
  const stepped = (direction: 1 | -1): Command<ShellContext> =>
    presentationCommand(
      direction === 1 ? 'editor.harder-brush' : 'editor.softer-brush',
      direction === 1 ? 'Make the spectral brush harder' : 'Make the spectral brush softer',
      CommandCategory.Tools,
      (state) => {
        const { hardness } = state.spectralTools;
        const next = hardnessOf(hardness + direction * step);
        if (next === hardness) {
          return `The brush is already at its ${direction === 1 ? 'hardest' : 'softest'}.`;
        }
        return withTools(state, { ...state.spectralTools, hardness: next });
      },
      brushSaid,
      {
        keywords: ['brush', 'hardness', 'edge', 'spectral', direction === 1 ? 'harder' : 'softer'],
      },
    );
  return [
    presentationCommand(
      'editor.set-brush-hardness',
      'Set the spectral brush’s hardness',
      CommandCategory.Tools,
      (state, _target, invocation) => {
        const hardness = numberArgument(invocation, 'hardness');
        if (hardness === undefined) {
          return `Choose a hardness from ${hardnessWords(minimum)} to ${hardnessWords(maximum)}.`;
        }
        return withTools(state, { ...state.spectralTools, hardness: hardnessOf(hardness) });
      },
      brushSaid,
      { keywords: ['brush', 'hardness', 'edge', 'spectral'], discoverable: false },
    ),
    stepped(1),
    stepped(-1),
  ];
}

/**
 * The softness `milliseconds` and `hertz` make for an asset at `sampleRate`,
 * or why they make none: both nothing, a hard edge, or both above nothing,
 * as a mask's feather must be (ADR-0081).
 */
function featherOf(
  milliseconds: number | undefined,
  hertz: number | undefined,
  sampleRate: number,
): SpectralFeather | string {
  const asked = `Give a softness in time, up to ${String(LONGEST_SOFTNESS_MS)} ms, and in frequency, up to ${frequencyWords(HIGHEST_MASK_FREQUENCY)}: both nothing, or both more.`;
  if (milliseconds === undefined || hertz === undefined) return asked;
  if (milliseconds < 0 || milliseconds > LONGEST_SOFTNESS_MS) return asked;
  if (hertz < 0 || hertz > HIGHEST_MASK_FREQUENCY) return asked;
  const time = Math.round((milliseconds / 1000) * sampleRate);
  if (time === 0 && hertz === 0) return NO_FEATHER;
  if (time === 0 || hertz === 0) {
    return 'A softness fades out in both time and frequency, or in neither. Give both, or neither.';
  }
  return { time, frequency: hertz };
}

function softnessCommands(): readonly Command<ShellContext>[] {
  return [
    presentationCommand(
      'editor.set-spectral-softness',
      'Set the softness of the spectral marquee and lasso',
      CommandCategory.Tools,
      (state, { asset }, invocation) => {
        const feather = featherOf(
          numberArgument(invocation, 'milliseconds'),
          numberArgument(invocation, 'hertz'),
          asset.sampleRate,
        );
        if (typeof feather === 'string') return feather;
        return withTools(state, { ...state.spectralTools, feather });
      },
      (state) =>
        state.spectralTools.feather.time === 0
          ? 'The marquee and the lasso draw hard edges.'
          : 'The marquee and the lasso fade out past their edges.',
      {
        keywords: ['softness', 'feather', 'edge', 'marquee', 'lasso', 'spectral'],
        discoverable: false,
      },
    ),
    presentationCommand(
      'editor.hard-spectral-edges',
      'Give the spectral marquee and lasso hard edges',
      CommandCategory.Tools,
      (state) => withTools(state, { ...state.spectralTools, feather: NO_FEATHER }),
      () => 'The marquee and the lasso draw hard edges.',
      { keywords: ['softness', 'feather', 'hard', 'edge', 'marquee', 'lasso', 'spectral'] },
    ),
  ];
}

/**
 * What each combination mode is called on its control, and what a shape
 * drawn in it does to the spectral selection, as an instruction and as a
 * statement.
 */
export const COMBINATIONS: Readonly<
  Record<
    SpectralCombination,
    { readonly name: string; readonly verb: string; readonly does: string }
  >
> = {
  [SpectralCombination.Replace]: { name: 'Replace', verb: 'replace', does: 'replaces' },
  [SpectralCombination.Add]: { name: 'Add', verb: 'add to', does: 'adds to' },
  [SpectralCombination.Subtract]: { name: 'Take away', verb: 'take from', does: 'takes from' },
};

/**
 * The commands that choose the combination mode, each one mode, so each is a
 * control's, an entry's of the palette and a shortcut's alike.
 */
function combinationCommands(): readonly Command<ShellContext>[] {
  return Object.values(SpectralCombination).map((combination) => {
    const { verb, does } = COMBINATIONS[combination];
    return presentationCommand(
      `editor.spectral-combination-${combination}`,
      `Make a spectral tool’s shape ${verb} the selection`,
      CommandCategory.Tools,
      (state) => withTools(state, { ...state.spectralTools, combination }),
      () => `A spectral tool’s shape ${does} the spectral selection.`,
      {
        keywords: [
          'spectral',
          'combination',
          'mode',
          'selection',
          'touch',
          'pen',
          ...does.split(' '),
        ],
        description: `A shape drawn with no modifier held ${does} the spectral selection; Shift still adds and Alt still takes away.`,
      },
    );
  });
}

/** The commands that set how a view's spectral tools draw. */
export function spectralToolCommands(): readonly Command<ShellContext>[] {
  return [
    ...radiusCommands(),
    ...hardnessCommands(),
    ...softnessCommands(),
    ...combinationCommands(),
  ];
}
