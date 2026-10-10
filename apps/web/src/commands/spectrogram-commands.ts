/**
 * How a view's spectrogram is analysed and drawn (ADR-0080, ADR-0082): the
 * analysis's window, its length and the overlap of windows, the range of
 * levels its colours span, and the ramp it is drawn in. Each is the view's own
 * (REQ-EDIT-061), kept with it, and changed only here, through the builder the
 * presentation commands use, so a panel that shows them invokes these and
 * nothing else. The analysis chooses which tiles are made; the range and the
 * ramp map a tile's levels to colours and never change a tile.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { StftWindow } from '@audiogubbins/audio-engine';
import {
  DEFAULT_SPECTROGRAM_DISPLAY,
  SpectrogramColours,
  isDisplayRange,
  type DisplayRange,
  type EditorViewState,
  type SpectrogramDisplay,
} from '@audiogubbins/editor-view';
import {
  LEVEL_FLOOR_DECIBELS,
  levelDecibels,
  spectrogramConfig,
  type SpectrogramConfig,
  type SpectrogramOverlap,
} from '@audiogubbins/spectral-analysis';

import { numberArgument } from './editor-target.js';
import { presentationCommand } from './editor-presentation-commands.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What each window is called. */
const WINDOWS: Readonly<Record<StftWindow, string>> = {
  [StftWindow.Hann]: 'Hann',
  [StftWindow.BlackmanHarris]: 'Blackman–Harris',
};

/** What each ramp is called. */
const COLOURS: Readonly<Record<SpectrogramColours, string>> = {
  [SpectrogramColours.Theme]: 'the theme’s colours',
  [SpectrogramColours.Greyscale]: 'greys',
};

const OVERLAPS: readonly SpectrogramOverlap[] = [1, 2, 4, 8];

/** Decibels a step of the range moves its floor or ceiling by. */
const RANGE_STEP = 6;

/** The loudest level a tile tells apart, which a ceiling cannot pass. */
const LOUDEST_LEVEL = levelDecibels(255);

/** A level as the person reads it, to a tenth: "-96.5 dBFS". */
const LEVELS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

const SAMPLES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** How a spectrogram is analysed, in a sentence. */
export function analysisWords(config: SpectrogramConfig): string {
  const overlap =
    config.overlap === 1 ? 'one after another' : `overlapping ${String(config.overlap)} times`;
  return `The spectrogram analyses windows of ${SAMPLES.format(config.windowLength)} samples through the ${WINDOWS[config.window]} window, ${overlap}.`;
}

/** The levels a spectrogram's colours span, in a sentence. */
export function rangeWords(range: DisplayRange): string {
  return `The spectrogram’s colours span ${LEVELS.format(range.floor)} to ${LEVELS.format(range.ceiling)} dBFS.`;
}

/** The ramp a spectrogram is drawn in, in a sentence. */
export function colourWords(colours: SpectrogramColours): string {
  return `The spectrogram is drawn in ${COLOURS[colours]}.`;
}

/** `state` with its spectrogram's `change`, or itself where nothing changed. */
function withDisplay(state: EditorViewState, change: Partial<SpectrogramDisplay>): EditorViewState {
  const display = { ...state.spectrogram, ...change };
  const before = state.spectrogram;
  return display.analysis.windowLength === before.analysis.windowLength &&
    display.analysis.window === before.analysis.window &&
    display.analysis.overlap === before.analysis.overlap &&
    display.range.floor === before.range.floor &&
    display.range.ceiling === before.range.ceiling &&
    display.colours === before.colours
    ? state
    : { ...state, spectrogram: display };
}

/** `state` analysed with `settings`, or why a spectrogram cannot be. */
function analysed(
  state: EditorViewState,
  settings: { readonly windowLength: number; readonly window: string; readonly overlap: number },
): EditorViewState | string {
  const config = spectrogramConfig(settings);
  return config.ok ? withDisplay(state, { analysis: config.value }) : config.failures[0].summary;
}

/** `state` whose colours span `range`, or why they cannot. */
function ranged(state: EditorViewState, range: DisplayRange): EditorViewState | string {
  return isDisplayRange(range)
    ? withDisplay(state, { range })
    : `A spectrogram’s colours span at least 6 dB, on half-decibel steps, from ${LEVELS.format(LEVEL_FLOOR_DECIBELS)} to ${LEVELS.format(LOUDEST_LEVEL)} dBFS.`;
}

/** The analysis an invocation names, any setting it leaves out kept as the view has it. */
function analysisArguments(
  state: EditorViewState,
  invocation: CommandInvocation,
): { readonly windowLength: number; readonly window: string; readonly overlap: number } {
  const current = state.spectrogram.analysis;
  return {
    windowLength: numberArgument(invocation, 'windowLength') ?? current.windowLength,
    window: textArgument(invocation, 'window') ?? current.window,
    overlap: numberArgument(invocation, 'overlap') ?? current.overlap,
  };
}

const analysisSaid = (state: EditorViewState): string => analysisWords(state.spectrogram.analysis);
const ANALYSIS_KEYWORDS = ['spectrogram', 'analysis', 'window', 'resolution', 'fft', 'stft'];

/** The analysis an invocation names, for a panel that sets it whole. */
function analysisCommand(): Command<ShellContext> {
  return presentationCommand(
    'editor.spectrogram-analysis',
    'Analyse the spectrogram with these settings',
    CommandCategory.View,
    (state, _target, invocation) => analysed(state, analysisArguments(state, invocation)),
    analysisSaid,
    { keywords: ANALYSIS_KEYWORDS, discoverable: false },
  );
}

function windowCommands(): readonly Command<ShellContext>[] {
  return [
    ...(['longer', 'shorter'] as const).map((way) =>
      presentationCommand(
        `editor.spectrogram-window-${way}`,
        way === 'longer'
          ? 'Analyse the spectrogram with longer windows, finer in frequency'
          : 'Analyse the spectrogram with shorter windows, finer in time',
        CommandCategory.View,
        (state) => {
          const { analysis } = state.spectrogram;
          const windowLength =
            way === 'longer' ? analysis.windowLength * 2 : analysis.windowLength / 2;
          return analysed(state, { ...analysis, windowLength });
        },
        analysisSaid,
        { keywords: [...ANALYSIS_KEYWORDS, way] },
      ),
    ),
    ...Object.values(StftWindow).map((window) =>
      presentationCommand(
        `editor.spectrogram-window-${window}`,
        `Analyse the spectrogram through the ${WINDOWS[window]} window`,
        CommandCategory.View,
        (state) => analysed(state, { ...state.spectrogram.analysis, window }),
        analysisSaid,
        { keywords: [...ANALYSIS_KEYWORDS, WINDOWS[window].toLowerCase()] },
      ),
    ),
  ];
}

function overlapCommands(): readonly Command<ShellContext>[] {
  return OVERLAPS.map((overlap) =>
    presentationCommand(
      `editor.spectrogram-overlap-${String(overlap)}`,
      overlap === 1
        ? 'Analyse the spectrogram’s windows one after another'
        : `Overlap the spectrogram’s windows ${String(overlap)} times`,
      CommandCategory.View,
      (state) => analysed(state, { ...state.spectrogram.analysis, overlap }),
      analysisSaid,
      { keywords: [...ANALYSIS_KEYWORDS, 'overlap', 'hop'] },
    ),
  );
}

const rangeSaid = (state: EditorViewState): string => rangeWords(state.spectrogram.range);
const RANGE_KEYWORDS = ['spectrogram', 'range', 'level', 'decibels', 'db', 'contrast'];

/** The steps of a range's floor and ceiling, each its own command. */
const RANGE_STEPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly edge: keyof DisplayRange;
  readonly by: number;
  readonly keywords: readonly string[];
}[] = [
  {
    id: 'editor.spectrogram-floor-lower',
    label: 'Show quieter levels in the spectrogram',
    edge: 'floor',
    by: -RANGE_STEP,
    keywords: ['floor', 'quieter'],
  },
  {
    id: 'editor.spectrogram-floor-raise',
    label: 'Hide the quietest levels in the spectrogram',
    edge: 'floor',
    by: RANGE_STEP,
    keywords: ['floor', 'noise'],
  },
  {
    id: 'editor.spectrogram-ceiling-lower',
    label: 'Brighten the spectrogram’s quieter levels',
    edge: 'ceiling',
    by: -RANGE_STEP,
    keywords: ['ceiling', 'brighter'],
  },
  {
    id: 'editor.spectrogram-ceiling-raise',
    label: 'Span louder levels in the spectrogram’s colours',
    edge: 'ceiling',
    by: RANGE_STEP,
    keywords: ['ceiling', 'louder'],
  },
];

function rangeCommands(): readonly Command<ShellContext>[] {
  return [
    presentationCommand(
      'editor.spectrogram-range',
      'Span these levels in the spectrogram’s colours',
      CommandCategory.View,
      (state, _target, invocation) =>
        ranged(state, {
          floor: numberArgument(invocation, 'floor') ?? state.spectrogram.range.floor,
          ceiling: numberArgument(invocation, 'ceiling') ?? state.spectrogram.range.ceiling,
        }),
      rangeSaid,
      { keywords: RANGE_KEYWORDS, discoverable: false },
    ),
    ...RANGE_STEPS.map(({ id, label, edge, by, keywords }) =>
      presentationCommand(
        id,
        label,
        CommandCategory.View,
        (state) => {
          const { range } = state.spectrogram;
          const moved = Math.min(LOUDEST_LEVEL, Math.max(LEVEL_FLOOR_DECIBELS, range[edge] + by));
          return ranged(state, { ...range, [edge]: moved });
        },
        rangeSaid,
        { keywords: [...RANGE_KEYWORDS, ...keywords] },
      ),
    ),
    presentationCommand(
      'editor.spectrogram-range-default',
      'Span the spectrogram’s usual levels',
      CommandCategory.View,
      (state) => ranged(state, DEFAULT_SPECTROGRAM_DISPLAY.range),
      rangeSaid,
      { keywords: [...RANGE_KEYWORDS, 'reset', 'default'] },
    ),
  ];
}

function colourCommands(): readonly Command<ShellContext>[] {
  return Object.values(SpectrogramColours).map((colours) =>
    presentationCommand(
      `editor.spectrogram-colours-${colours}`,
      `Draw the spectrogram in ${COLOURS[colours]}`,
      CommandCategory.View,
      (state) => withDisplay(state, { colours }),
      () => colourWords(colours),
      { keywords: ['spectrogram', 'colours', 'ramp', 'palette', colours] },
    ),
  );
}

/** The commands that change how a view's spectrogram is analysed and drawn. */
export function spectrogramCommands(): readonly Command<ShellContext>[] {
  return [
    analysisCommand(),
    ...windowCommands(),
    ...overlapCommands(),
    ...rangeCommands(),
    ...colourCommands(),
  ];
}
