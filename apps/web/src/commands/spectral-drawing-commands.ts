/**
 * The commands that draw a spectral shape from the keyboard (REQ-UX-005,
 * ADR-0082), so the keyboard reaches every spectral selection a pointer makes,
 * the lasso's polygon and the brush's stroke among them.
 *
 * A cursor stands in the spectrogram lane of a channel, at the playhead, which
 * the playhead's own keys move a pixel or a sample at a time; these move it up
 * and down the frequency axis a step or a tenth of one, take it to the next
 * channel shown, place a point where it stands, finish the shape and let the
 * points go. The spectral tool in use says what the points make: a marquee's
 * corner, a lasso's corners or a brush's dabs, at the fixed strength and joined
 * as the combination mode says. Finishing joins the shape to the selection as
 * `editor.select-spectral` joins a drag's, and the shape is the one a pointer
 * pressed at the first point, moved through the rest and let go at the cursor
 * draws (`keyboard-drawing.ts`). Each says where the cursor is and how many
 * points are placed, for a person who cannot see the overlay. None is undoable:
 * neither the drawing nor a selection is project content (REQ-EDIT-073).
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { channelCount } from '@audiogubbins/domain';
import {
  CursorStep,
  ToolId,
  cursorFrequency,
  cursorStepped,
  drawingLaneOf,
  drawingShape,
  isSpectralTool,
  layoutView,
  newDrawing,
  pointPlaced,
  visibleChannels,
  type DrawingContext,
  type KeyboardDrawing,
  type ViewLayout,
} from '@audiogubbins/editor-view';
import { counted } from '@audiogubbins/text';
import { formatPosition, selectionsEqual } from '@audiogubbins/timeline';

import { channelNames } from '../assets/channel-names.js';
import { drawingContextOf } from '../editor/drawing-context.js';
import { frequencyWords } from '../wording.js';
import {
  editorTarget,
  focusedEditor,
  needsEditor,
  playheadOf,
  type EditorTarget,
} from './editor-target.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { joinedSelection } from './spectral-selection-commands.js';

/** The drawing of the view `target`, its cursor in the first channel shown where none is drawn yet. */
function drawingOf({ entry, state, asset }: EditorTarget): KeyboardDrawing {
  return entry.drawing ?? newDrawing(visibleChannels(state, channelCount(asset.layout))[0] ?? 0);
}

/** The lanes of the view `target` as its surface lays them out. */
function layoutOf({ state, asset, entry }: EditorTarget, context: ShellContext): ViewLayout {
  const picture = context.picture.get();
  return layoutView(
    state,
    state.viewport.width,
    entry.height,
    channelCount(asset.layout),
    picture.asset === asset.id && picture.binding !== undefined,
  );
}

/** What `drawing` is read with in the view `target`, as its frame shows it, or why it cannot be drawn. */
function contextOf(
  drawing: KeyboardDrawing,
  target: EditorTarget,
  context: ShellContext,
): DrawingContext | string {
  const { state, asset } = target;
  return drawingContextOf(drawing, {
    state,
    asset,
    layout: layoutOf(target, context),
    selection: context.selections.of(asset.id),
    playhead: playheadOf(context, asset),
    strength: context.preferences.get().pressure.fixedStrength,
  });
}

/** Where the cursor of `drawing` is, and what it has placed, in words. */
function drawingWords(
  drawing: KeyboardDrawing,
  drawn: DrawingContext,
  { asset, state }: EditorTarget,
): string {
  const time = formatPosition(drawn.position, asset.sampleRate, state.timeFormat);
  const frequency = frequencyWords(cursorFrequency(drawing, drawn));
  const channel = channelNames(asset.layout)[drawing.channel] ?? String(drawing.channel + 1);
  const placed =
    drawing.placed.length === 0
      ? 'nothing placed'
      : `${counted(drawing.placed.length, 'point', 'points')} placed`;
  return `The cursor is at ${time}, ${frequency}, on channel ${channel}; ${placed}.`;
}

/**
 * A command that changes the view's drawing as `change` says and tells where
 * the cursor is, or refuses with why it cannot.
 */
function drawingCommand(
  id: string,
  label: string,
  change: (
    drawing: KeyboardDrawing,
    target: EditorTarget,
    drawn: DrawingContext,
    context: ShellContext,
  ) => KeyboardDrawing | string,
  options: {
    readonly keywords: readonly string[];
    readonly description?: string;
    /** When the command can run, where it is more than wherever an editor shows an asset. */
    readonly availability?: (context: ShellContext) => CommandAvailability;
    readonly takesItsKeyOnlyWhenAvailable?: boolean;
  },
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const drawing = drawingOf(target);
      const drawn = contextOf(drawing, target, context);
      if (typeof drawn === 'string') return drawn;
      const next = change(drawing, target, drawn, context);
      if (typeof next === 'string') return next;
      if (next === target.entry.drawing) {
        return unchanged('editor.drawing-unchanged', drawingWords(next, drawn, target));
      }
      context.editorViews.draw(target.panel, () => next);
      // The cursor's frequency is its share of the axis, the same in every lane.
      context.interaction.announce(drawingWords(next, drawn, target));
      return undefined;
    },
    {
      availability: options.availability ?? needsEditor,
      keywords: ['spectral', 'cursor', 'keyboard', 'draw', ...options.keywords],
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.takesItsKeyOnlyWhenAvailable === undefined
        ? {}
        : { takesItsKeyOnlyWhenAvailable: options.takesItsKeyOnlyWhenAvailable }),
    },
  );
}

/** What each cursor step is called. */
const STEPS: readonly (readonly [step: CursorStep, id: string, label: string])[] = [
  [CursorStep.Up, 'editor.spectral-cursor-up', 'Move the spectral cursor up'],
  [CursorStep.Down, 'editor.spectral-cursor-down', 'Move the spectral cursor down'],
  [CursorStep.FineUp, 'editor.spectral-cursor-up-fine', 'Move the spectral cursor up a little'],
  [
    CursorStep.FineDown,
    'editor.spectral-cursor-down-fine',
    'Move the spectral cursor down a little',
  ],
];

function cursorCommands(): readonly Command<ShellContext>[] {
  return STEPS.map(([step, id, label]) =>
    drawingCommand(
      id,
      label,
      (drawing) => {
        const next = cursorStepped(drawing, step);
        if (next !== drawing) return next;
        return step === CursorStep.Up || step === CursorStep.FineUp
          ? 'The cursor is at the top of the lane.'
          : 'The cursor is at the foot of the lane.';
      },
      { keywords: ['frequency', 'up', 'down', 'move'] },
    ),
  );
}

/** The channel after the drawing's whose lane shows a spectrogram, round to the first. */
function nextChannelCommand(): Command<ShellContext> {
  return drawingCommand(
    'editor.spectral-cursor-next-channel',
    'Move the spectral cursor to the next channel',
    (drawing, target, _drawn, context) => {
      if (drawing.placed.length > 0) {
        return 'A shape is drawn in one channel. Finish it or let its points go first.';
      }
      const { state, asset } = target;
      const lanes = layoutOf(target, context);
      const channels = visibleChannels(state, channelCount(asset.layout)).filter(
        (channel) => drawingLaneOf(lanes, channel) !== undefined,
      );
      const next = channels[(channels.indexOf(drawing.channel) + 1) % channels.length];
      return next === undefined || next === drawing.channel
        ? 'The view shows no other channel’s spectrogram.'
        : { ...drawing, channel: next };
    },
    { keywords: ['channel', 'next', 'lane'] },
  );
}

/**
 * Available where the editor in use draws with a spectral tool: Enter, which
 * places a point, is a button's everywhere else.
 */
function drawsSpectrally(context: ShellContext): CommandAvailability {
  const target = focusedEditor(context);
  if (typeof target === 'string') return unavailable(target);
  return isSpectralTool(target.state.tool)
    ? AVAILABLE
    : unavailable('Choose the spectral marquee, lasso or brush to draw with first.');
}

/**
 * Available while the editor in use has placed a point of a shape, with
 * `reason` otherwise: Escape and Shift+Enter, which let the points go and
 * finish the shape, back out and press elsewhere.
 */
function drawingAShape(reason: string): (context: ShellContext) => CommandAvailability {
  return (context) => {
    const target = focusedEditor(context);
    if (typeof target === 'string') return unavailable(target);
    return (target.entry.drawing?.placed.length ?? 0) > 0 ? AVAILABLE : unavailable(reason);
  };
}

const NO_POINT = 'No point of a spectral shape is placed.';
const PLACE_FIRST = 'Place a point of the shape first.';

function placeCommand(): Command<ShellContext> {
  return drawingCommand(
    'editor.place-spectral-point',
    'Place a point of the spectral shape at the cursor',
    (drawing, { state }, drawn) => {
      if (state.tool === ToolId.SpectralMarquee && drawing.placed.length > 0) {
        return 'The marquee has its corner. Move the cursor to the other corner and finish the shape.';
      }
      return pointPlaced(drawing, drawn.position);
    },
    {
      keywords: ['point', 'place', 'corner', 'stamp', 'dab', 'lasso', 'brush', 'marquee'],
      availability: drawsSpectrally,
      takesItsKeyOnlyWhenAvailable: true,
      description:
        'Places a point where the cursor is: the marquee’s corner, a corner of the lasso’s shape, or a dab of the brush.',
    },
  );
}

function cancelCommand(): Command<ShellContext> {
  return drawingCommand(
    'editor.cancel-spectral-shape',
    'Let go of the spectral shape being drawn',
    (drawing) => (drawing.placed.length === 0 ? NO_POINT : { ...drawing, placed: [] }),
    {
      keywords: ['cancel', 'shape', 'points', 'clear'],
      availability: drawingAShape(NO_POINT),
      takesItsKeyOnlyWhenAvailable: true,
    },
  );
}

/**
 * The shape the points make let go at the cursor, joined to the selection
 * as a drag's is, its points then let go of.
 */
function finishCommand(): Command<ShellContext> {
  return shellCommand(
    'editor.finish-spectral-shape',
    'Finish the spectral shape at the cursor',
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const drawing = target.entry.drawing;
      if (drawing === undefined || drawing.placed.length === 0) return PLACE_FIRST;
      const drawn = contextOf(drawing, target, context);
      if (typeof drawn === 'string') return drawn;
      const shape = drawingShape(drawing, drawn);
      if (shape === undefined) {
        return 'Those points enclose nothing a selection can hold: a lasso needs three corners around an area, and a marquee a corner away from the cursor in time and in frequency.';
      }
      const { asset } = target;
      const current = context.selections.of(asset.id);
      const next = joinedSelection(current, shape, asset);
      if (typeof next === 'string') return next;
      if (selectionsEqual(next, current)) {
        return unchanged('editor.selection-unchanged', 'That is already the selection.');
      }
      context.selections.change(asset.id, () => next);
      context.editorViews.draw(target.panel, () => ({ ...drawing, placed: [] }));
      return undefined;
    },
    {
      availability: drawingAShape(PLACE_FIRST),
      takesItsKeyOnlyWhenAvailable: true,
      keywords: ['spectral', 'finish', 'close', 'shape', 'lasso', 'brush', 'marquee', 'keyboard'],
      description:
        'Joins the shape the points make, let go at the cursor, to the spectral selection, as the combination mode says.',
    },
  );
}

/** The commands that draw a spectral shape from the keyboard. */
export function spectralDrawingCommands(): readonly Command<ShellContext>[] {
  return [
    ...cursorCommands(),
    nextChannelCommand(),
    placeCommand(),
    finishCommand(),
    cancelCommand(),
  ];
}
