/**
 * The commands that change the spectral selection (ADR-0082).
 *
 * A spectral tool's shape joins it by the command a spectral marquee, lasso
 * or brush runs on release, given the shape as a mask of the one shape it
 * drew, how it joins the selection, and the channels a replacing shape scopes
 * it to. What it makes of the selection is the editor view's
 * `withDrawnShape`, which the drag's preview showed, so the selection a drag
 * previews is the selection it makes.
 *
 * The keyboard makes the selections a pointer makes of rectangles
 * (REQ-UX-005): a band of the time selection replacing the area, added to it
 * or taken from it, as a marquee's shape is joined, so a compound area is
 * built a band at a time; the area widened or narrowed in time or in
 * frequency by a step of the view, and cleared; and the selection described
 * in words, for a person who cannot see it. A lasso's polygon and a brush's
 * stroke are drawn by a pointer, a finger or a pen among them, or given as a
 * mask to `editor.select-spectral`. None is undoable: a selection is not
 * project content (REQ-EDIT-073).
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';
import {
  HIGHEST_MASK_FREQUENCY,
  Malformed,
  MaskEffect,
  channelCount,
  maskProblem,
  spectralMaskOf,
  type SpectralMask,
} from '@audiogubbins/domain';
import {
  SPECTRAL_TIME_STEP_PIXELS,
  SpectralStep,
  maskSteppedInFrequency,
  maskSteppedInTime,
  withDrawnShape,
  type DrawnShape,
} from '@audiogubbins/editor-view';
import {
  SelectionFacet,
  SpectralCombination,
  samplesWithin,
  withSpectralMask,
  withSpectralShape,
  withoutFacet,
  type SelectionSet,
} from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { isMemberOf } from '../state/stored-value.js';
import { frequencyWords } from '../wording.js';
import {
  channelsArgument,
  editorTarget,
  needsEditor,
  numberArgument,
  type EditorTarget,
} from './editor-target.js';
import { selectionCommand } from './selection-command.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { spectralSelectionWords } from './spectral-words.js';

/** Why a drawn shape's mask cannot be read from `text`, or the mask. */
function drawnMaskOf(text: string | undefined): ReturnType<typeof spectralMaskOf> | string {
  const unreadable = 'A spectral shape needs a mask to join to the selection.';
  if (text === undefined) return unreadable;
  try {
    return spectralMaskOf(JSON.parse(text), 'mask');
  } catch (error) {
    // The text is an argument anyone may type, so a malformed one is refused
    // with a reason rather than taken as a fault.
    if (error instanceof SyntaxError || error instanceof Malformed) return unreadable;
    throw error;
  }
}

/**
 * The shape a spectral tool drew, as `editor.select-spectral` is given it: a
 * mask of the one shape and the softness, how it joins the selection, and
 * the channels a replacing shape scopes it to, each read as anything typed
 * is. Whether the mask may stand is asked of the selection it makes.
 */
function drawnShapeOf(
  invocation: Parameters<Command<ShellContext>['run']>[1],
  asset: EditorAsset,
): DrawnShape | string {
  const mask = drawnMaskOf(textArgument(invocation, 'mask'));
  if (typeof mask === 'string') return mask;
  const [shape, ...others] = mask.shapes;
  if (others.length > 0) return 'A spectral tool draws one shape at a time.';
  const combination = invocation.arguments?.['combination'];
  if (!isMemberOf(SpectralCombination, combination)) {
    return 'A spectral shape replaces the selection, adds to it or takes from it.';
  }
  return {
    shape,
    combination,
    feather: mask.feather,
    channels: channelsArgument(invocation, 'channels', channelCount(asset.layout)),
  };
}

/** The command that joins a spectral tool's shape to the selection. */
function drawnShapeCommand(): Command<ShellContext> {
  return selectionCommand(
    'editor.select-spectral',
    'Select a spectral area',
    (current, { asset }, _context, invocation) => {
      const drawn = drawnShapeOf(invocation, asset);
      if (typeof drawn === 'string') return drawn;
      const next = withDrawnShape(current, drawn, channelCount(asset.layout));
      if (next.spectral === undefined) return 'Nothing is selected to take that shape from.';
      // The one check of the shape and of what joining it made, which may
      // pass the shapes or points a selection may hold.
      return maskProblem(next.spectral, asset.length) ?? next;
    },
    { discoverable: false },
  );
}

/** The highest frequency the asset of `target` holds: half its rate. */
function highestOf({ asset }: EditorTarget): number {
  return Math.min(HIGHEST_MASK_FREQUENCY, asset.sampleRate / 2);
}

/**
 * `current` with `mask` as its spectral selection, or why the mask may not
 * stand in the asset: the one check every spectral selection passes.
 */
function withCheckedMask(
  current: SelectionSet,
  mask: SpectralMask,
  { asset }: EditorTarget,
): SelectionSet | string {
  return maskProblem(mask, asset.length) ?? withSpectralMask(current, mask);
}

/** What each band command does, by how its band joins the area. */
const BANDS: Readonly<
  Record<
    SpectralCombination,
    {
      readonly id: string;
      readonly label: string;
      readonly keywords: readonly string[];
      readonly does: string;
    }
  >
> = {
  [SpectralCombination.Replace]: {
    id: 'editor.select-spectral-band',
    label: 'Select a band of frequencies over the time selection',
    keywords: ['select', 'replace'],
    does: 'Selects',
  },
  [SpectralCombination.Add]: {
    id: 'editor.add-spectral-band',
    label: 'Add a band of frequencies over the time selection',
    keywords: ['add', 'join', 'union', 'compound'],
    does: 'Adds to the spectral selection',
  },
  [SpectralCombination.Subtract]: {
    id: 'editor.subtract-spectral-band',
    label: 'Take a band of frequencies over the time selection away',
    keywords: ['subtract', 'take away', 'remove', 'exclude', 'compound'],
    does: 'Takes from the spectral selection',
  },
};

/**
 * The band of the time selection, as a rectangle joined to the area as
 * `combination` says, as a marquee's is: the band the invocation names by
 * `low` and `high` in hertz, or the band the view's spectrogram shows where
 * it names none, softened as the view's marquee softens.
 */
function bandCommand(combination: SpectralCombination): Command<ShellContext> {
  const { id, label, keywords, does } = BANDS[combination];
  return selectionCommand(
    id,
    label,
    (current, target, _context, invocation) => {
      const { time } = current;
      if (time === undefined) return 'Select a time range first, then a band of it.';
      const highest = highestOf(target);
      const shown = target.state.spectral;
      const low = numberArgument(invocation, 'low') ?? shown.lowest;
      const high = numberArgument(invocation, 'high') ?? Math.min(highest, shown.highest);
      if (!(low >= 0 && high > low && high <= highest)) {
        return `A band is a low frequency below a high one, from nothing to ${frequencyWords(highest)}.`;
      }
      const next = withSpectralShape(
        current,
        { kind: 'rectangle', effect: MaskEffect.Add, range: time, band: { low, high } },
        combination,
        target.state.spectralTools.feather,
      );
      // Only a band taken from no area leaves none.
      if (next.spectral === undefined) {
        return 'No area of time and frequency is selected to take a band from.';
      }
      // The one check of the band and of what joining it made, as a drawn
      // shape's: a band may pass the shapes a selection may hold.
      return maskProblem(next.spectral, target.asset.length) ?? next;
    },
    {
      keywords: ['spectral', 'band', 'frequency', 'area', 'time selection', ...keywords],
      description: `${does} a band of frequencies over the time selection: the band given, or the band the spectrogram shows.`,
    },
  );
}

/** Which way a step goes, and in which dimension. */
interface StepKind {
  readonly step: SpectralStep;
  readonly dimension: 'time' | 'frequency';
}

const STEPS: readonly StepKind[] = [
  { step: SpectralStep.Widen, dimension: 'time' },
  { step: SpectralStep.Narrow, dimension: 'time' },
  { step: SpectralStep.Widen, dimension: 'frequency' },
  { step: SpectralStep.Narrow, dimension: 'frequency' },
];

/** The spectral selection widened or narrowed a step of the view, in time or in frequency. */
function stepCommand({ step, dimension }: StepKind): Command<ShellContext> {
  const widening = step === SpectralStep.Widen;
  const span = dimension === 'time' ? 'in time' : 'in frequency';
  return selectionCommand(
    `editor.${step}-spectral-${dimension === 'time' ? 'time' : 'band'}`,
    `${widening ? 'Widen' : 'Narrow'} the spectral selection ${span}`,
    (current, target) => {
      const mask = current.spectral;
      if (mask === undefined) return 'No area of time and frequency is selected.';
      const stepped =
        dimension === 'time'
          ? maskSteppedInTime(
              mask,
              step,
              samplesWithin(target.state.viewport, SPECTRAL_TIME_STEP_PIXELS),
              target.asset.length,
            )
          : maskSteppedInFrequency(mask, step, target.state.spectral, highestOf(target));
      if (stepped === undefined) {
        return widening
          ? `The spectral selection reaches as far ${span} as the audio does.`
          : `The spectral selection cannot be narrowed ${span} any further.`;
      }
      return withCheckedMask(current, stepped, target);
    },
    {
      keywords: [
        'spectral',
        'selection',
        widening ? 'widen' : 'narrow',
        widening ? 'grow' : 'shrink',
        dimension === 'time' ? 'time' : 'band',
        'frequency',
      ],
    },
  );
}

function clearCommand(): Command<ShellContext> {
  return selectionCommand(
    'editor.clear-spectral-selection',
    'Select no area of time and frequency',
    (current) =>
      current.spectral === undefined
        ? 'No area of time and frequency is selected.'
        : withoutFacet(current, SelectionFacet.Spectral),
    { keywords: ['spectral', 'clear', 'deselect', 'none', 'area'] },
  );
}

/**
 * Says the spectral selection in words, as the Spectral panel shows it
 * (REQ-UX-005): told each time it is asked, since saying it is what it does.
 */
function describeCommand(): Command<ShellContext> {
  return shellCommand(
    'editor.describe-spectral-selection',
    'Describe the spectral selection',
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      context.interaction.announce(
        spectralSelectionWords(
          context.selections.of(target.asset.id),
          target.asset,
          target.state.timeFormat,
        ),
      );
      return undefined;
    },
    {
      availability: needsEditor,
      keywords: ['spectral', 'selection', 'describe', 'say', 'read', 'screen reader', 'area'],
    },
  );
}

/** The commands that change the spectral selection, and the one that says it. */
export function spectralSelectionCommands(): readonly Command<ShellContext>[] {
  return [
    drawnShapeCommand(),
    ...Object.values(SpectralCombination).map(bandCommand),
    ...STEPS.map(stepCommand),
    clearCommand(),
    describeCommand(),
  ];
}
