/**
 * Selecting time from the keyboard (REQ-UX-005, REQ-EDIT-063): setting the
 * selection's start or end at the playhead, and extending it with the playhead
 * as it moves a pixel or a sample, as a text field extends its selection with
 * the caret. Without them a second of audio took 48,000 presses at a sample
 * each, and a selection could only grow.
 *
 * Each acts on the view it names or the editor last in use, and on its asset's
 * selection, which every view of the asset shows (REQ-EDIT-061). A range counts
 * only where it is the facet made last, as the selection set's precedence says,
 * so a range set aside for a marker since is not taken up again. None is
 * undoable, as no selection command is (REQ-EDIT-073).
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { ZERO_SAMPLES, sampleCount, type SampleCount } from '@audiogubbins/domain';
import {
  SelectionFacet,
  activeFacet,
  samplesWithin,
  withTimeRange,
  type BoundaryRange,
  type SelectionSet,
} from '@audiogubbins/timeline';

import { editorTarget, needsEditor, playheadOf, type EditorTarget } from './editor-target.js';
import { setPlayhead } from './playhead-commands.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The range made last in `set`, or `undefined` where another facet was made after it. */
function rangeMadeLast(set: SelectionSet): BoundaryRange | undefined {
  return activeFacet(set) === SelectionFacet.Time ? set.time : undefined;
}

/** `value` kept within the asset. */
function within(target: EditorTarget, value: number): SampleCount {
  const read = sampleCount(Math.min(target.asset.length, Math.max(0, value)));
  return read.ok ? read.value : ZERO_SAMPLES;
}

/** The range a selection edge set at the playhead makes, or why it makes none. */
type EdgeAt = (
  playhead: SampleCount,
  range: BoundaryRange | undefined,
  target: EditorTarget,
) => BoundaryRange | string;

/** Where the playhead starts the selection: up to its end, or the asset's where there is none. */
const startAt: EdgeAt = (playhead, range, { asset }) => {
  const end = range?.end ?? asset.length;
  return playhead < end
    ? { start: playhead, end }
    : `The playhead is at or after the end of the ${range === undefined ? 'asset' : 'selection'}, so nothing can start there.`;
};

/** Where the playhead ends the selection: from its start, or the asset's where there is none. */
const endAt: EdgeAt = (playhead, range) => {
  const start = range?.start ?? ZERO_SAMPLES;
  return playhead > start
    ? { start, end: playhead }
    : `The playhead is at or before the start of the ${range === undefined ? 'asset' : 'selection'}, so nothing can end there.`;
};

function edgeCommand(
  id: string,
  label: string,
  edge: EdgeAt,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const current = context.selections.of(target.asset.id);
      const range = rangeMadeLast(current);
      const made = edge(playheadOf(context, target.asset), range, target);
      if (typeof made === 'string') return made;
      if (range?.start === made.start && range.end === made.end) {
        return unchanged('editor.selection-unchanged', 'That is already the selection.');
      }
      context.selections.change(target.asset.id, () => withTimeRange(current, made));
      return undefined;
    },
    { availability: needsEditor, keywords },
  );
}

/**
 * The edge that moves with the playhead, and the one that stays: the edge the
 * playhead is on, or where it is on neither, the edge it is moving towards, so
 * a range made by a drag grows the way the key points. With no range, the
 * selection starts at the playhead.
 */
function edgesOf(
  playhead: SampleCount,
  range: BoundaryRange | undefined,
  forward: boolean,
): { readonly moving: SampleCount; readonly anchor: SampleCount } {
  if (range === undefined) return { moving: playhead, anchor: playhead };
  if (playhead === range.start) return { moving: range.start, anchor: range.end };
  if (playhead === range.end) return { moving: range.end, anchor: range.start };
  return forward
    ? { moving: range.end, anchor: range.start }
    : { moving: range.start, anchor: range.end };
}

/**
 * Moves the playhead by `frames`, from the edge of the selection that moves
 * with it, and makes the selection run from the edge that stays to where the
 * playhead went: it grows, or shrinks back past nothing, as the key says.
 */
function extendCommand(
  id: string,
  label: string,
  frames: (target: EditorTarget) => number,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const current = context.selections.of(target.asset.id);
      const step = frames(target);
      const edges = edgesOf(playheadOf(context, target.asset), rangeMadeLast(current), step > 0);
      const to = within(target, edges.moving + step);
      if (to === edges.moving) {
        return unchanged('editor.selection-unchanged', 'The selection cannot go further that way.');
      }
      setPlayhead(context, target, to);
      const { anchor } = edges;
      context.selections.change(target.asset.id, () =>
        withTimeRange(
          current,
          to < anchor ? { start: to, end: anchor } : { start: anchor, end: to },
        ),
      );
      return undefined;
    },
    { availability: needsEditor, keywords },
  );
}

/** A pixel of the view, in frames, or a single frame, in the direction given. */
const aPixel = (sign: -1 | 1) => (target: EditorTarget) =>
  sign * samplesWithin(target.state.viewport, 1);
const aSample = (sign: -1 | 1) => () => sign;

/** The commands that select time with the playhead. */
export function selectionPlayheadCommands(): readonly Command<ShellContext>[] {
  return [
    edgeCommand(
      'editor.selection-start-at-playhead',
      'Start the selection at the playhead',
      startAt,
      ['selection', 'start', 'in', 'mark', 'playhead'],
    ),
    edgeCommand('editor.selection-end-at-playhead', 'End the selection at the playhead', endAt, [
      'selection',
      'end',
      'out',
      'mark',
      'playhead',
    ]),
    extendCommand('editor.extend-selection-back', 'Extend the selection back', aPixel(-1), [
      'extend',
      'selection',
      'back',
      'left',
      'grow',
      'shrink',
      'pixel',
    ]),
    extendCommand('editor.extend-selection-forward', 'Extend the selection forward', aPixel(1), [
      'extend',
      'selection',
      'forward',
      'right',
      'grow',
      'shrink',
      'pixel',
    ]),
    extendCommand(
      'editor.extend-selection-back-sample',
      'Extend the selection back one sample',
      aSample(-1),
      ['extend', 'selection', 'sample', 'back', 'left', 'exact'],
    ),
    extendCommand(
      'editor.extend-selection-forward-sample',
      'Extend the selection forward one sample',
      aSample(1),
      ['extend', 'selection', 'sample', 'forward', 'right', 'exact'],
    ),
  ];
}
