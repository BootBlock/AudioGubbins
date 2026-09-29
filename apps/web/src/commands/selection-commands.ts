/**
 * The selection commands (ADR-0042): the one way a selection changes, whether
 * a tool's drag, a click on a marker, a key or the palette asked for it
 * (REQ-EDIT-065). Each acts on the asset of the view it names, or of the
 * editor last in use, and every view of that asset shows the result
 * (REQ-EDIT-061). The editor's selection scope, a live region, says what is
 * selected after each, so none of them speaks as well.
 *
 * None is undoable: a selection is not project content, and Undo is kept for
 * what is (REQ-EDIT-073).
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import {
  ZERO_SAMPLES,
  channelCount,
  isWellFormedId,
  sampleCount,
  unsafeBrandId,
  type MarkerId,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  EMPTY_SELECTION,
  SelectionFacet,
  activeFacet,
  selectionsEqual,
  withChannels,
  withObjects,
  withTimeRange,
  withoutFacet,
  type BoundaryRange,
  type SelectionSet,
} from '@audiogubbins/timeline';

import {
  boundaryArgument,
  channelsArgument,
  editorTarget,
  needsEditor,
  playheadOf,
  type EditorTarget,
} from './editor-target.js';
import { shellCommand, textArgument, type ShellCommandOptions } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

type SelectionChange = (
  current: SelectionSet,
  target: EditorTarget,
  context: ShellContext,
  invocation: Parameters<Command<ShellContext>['run']>[1],
) => SelectionSet | string;

function selectionCommand(
  id: string,
  label: string,
  change: SelectionChange,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const current = context.selections.of(target.asset.id);
      const next = change(current, target, context, invocation);
      if (typeof next === 'string') return next;
      if (selectionsEqual(next, current)) {
        return unchanged('editor.selection-unchanged', 'That is already the selection.');
      }
      context.selections.change(target.asset.id, () => next);
      return undefined;
    },
    { availability: needsEditor, ...extra },
  );
}

function boundary(value: number): SampleCount | undefined {
  const read = sampleCount(value);
  return read.ok ? read.value : undefined;
}

/**
 * The range the selection is extended from: its time range where that is the
 * facet made last, and otherwise the sample at the playhead, never a range the
 * person made before the marker they have since chosen.
 */
function extensible(
  current: SelectionSet,
  target: EditorTarget,
  context: ShellContext,
): BoundaryRange {
  if (activeFacet(current) === SelectionFacet.Time && current.time !== undefined) {
    return current.time;
  }
  const at = playheadOf(context, target.asset);
  const end = boundary(Math.min(at + 1, target.asset.length));
  return { start: at, end: end ?? at };
}

function extendBy(step: -1 | 1): SelectionChange {
  return (current, target, context) => {
    const range = extensible(current, target, context);
    const moved =
      step === 1
        ? { start: range.start, end: boundary(Math.min(range.end + 1, target.asset.length)) }
        : { start: boundary(Math.max(range.start - 1, 0)), end: range.end };
    if (moved.start === undefined || moved.end === undefined) return current;
    return withTimeRange(current, { start: moved.start, end: moved.end });
  };
}

/**
 * The marker identities an argument names, as a list separated by commas,
 * each checked for the shape an identifier has before it is taken as one.
 */
export function markerIdsOf(text: string | undefined): readonly MarkerId[] {
  return (text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(isWellFormedId)
    .map((part) => unsafeBrandId<'MarkerId'>(part));
}

function rangeCommands(): readonly Command<ShellContext>[] {
  return [
    selectionCommand(
      'editor.select-time',
      'Select a time range',
      (current, { asset }, _context, invocation) => {
        const start = boundaryArgument(invocation, 'start', asset);
        const end = boundaryArgument(invocation, 'end', asset);
        if (start === undefined || end === undefined || end <= start) {
          return 'A time range needs a start before its end, within the asset.';
        }
        const count = channelCount(asset.layout);
        const channels = channelsArgument(invocation, 'channels', count) ?? [];
        return withChannels(withTimeRange(current, { start, end }), channels, count);
      },
      { discoverable: false },
    ),
  ];
}

function markerSelection(): Command<ShellContext> {
  return selectionCommand(
    'editor.select-marker',
    'Select a marker',
    (current, { asset }, context, invocation) => {
      const [id] = markerIdsOf(textArgument(invocation, 'marker'));
      const markers = context.content.of(asset).markers;
      if (id === undefined || !markers.some((marker) => marker.id === id)) {
        return `That marker is not in ${asset.name}.`;
      }
      const adding = invocation.arguments?.['add'] === true;
      const held: readonly MarkerId[] =
        current.objects?.kind === 'markers' ? current.objects.ids : [];
      const ids = adding
        ? held.includes(id)
          ? held.filter((each) => each !== id)
          : [...held, id]
        : [id];
      const [first, ...rest] = ids;
      return first === undefined
        ? withoutFacet(current, SelectionFacet.Objects)
        : withObjects(current, { kind: 'markers', ids: [first, ...rest] });
    },
    { discoverable: false },
  );
}

function wholeCommands(): readonly Command<ShellContext>[] {
  return [
    selectionCommand(
      'editor.select-all',
      'Select all',
      (current, { asset }) => {
        const end = boundary(asset.length);
        return end === undefined || end === 0
          ? `${asset.name} holds nothing to select.`
          : withTimeRange(current, { start: ZERO_SAMPLES, end });
      },
      { keywords: ['select', 'all', 'whole', 'everything'] },
    ),
    selectionCommand('editor.clear-selection', 'Select nothing', () => EMPTY_SELECTION, {
      keywords: ['clear', 'deselect', 'none', 'nothing', 'selection'],
    }),
    selectionCommand(
      'editor.extend-selection-back',
      'Extend the selection back one sample',
      extendBy(-1),
      {
        keywords: ['extend', 'selection', 'sample', 'back', 'left', 'grow'],
      },
    ),
    selectionCommand(
      'editor.extend-selection-forward',
      'Extend the selection forward one sample',
      extendBy(1),
      { keywords: ['extend', 'selection', 'sample', 'forward', 'right', 'grow'] },
    ),
    selectionCommand(
      'editor.scope-all-channels',
      'Select every channel',
      (current, { asset }) => withChannels(current, [], channelCount(asset.layout)),
      { keywords: ['channels', 'scope', 'all', 'every'] },
    ),
  ];
}

/** The commands that change the selection. */
export function selectionCommands(): readonly Command<ShellContext>[] {
  return [...rangeCommands(), markerSelection(), ...wholeCommands()];
}
