/**
 * The selection commands (ADR-0042): the one way a selection changes, whether a
 * tool's drag, a tap on a marker or a region, a key or the palette asked for it
 * (REQ-EDIT-065). Each acts on the asset of the view it names, or of the editor
 * last in use, and every view of that asset shows the result (REQ-EDIT-061).
 * The editor's selection scope, a live region, says what is selected after
 * each, so none of them speaks as well.
 *
 * The commands that select time with the playhead are
 * `selection-playhead-commands.ts`.
 *
 * Processors are selected in the selection of the asset whose racks run
 * them, so the Effects rack panel and the Inspector show one selection.
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
  findSlot,
  unsafeBrandId,
  type MarkerId,
  type ProcessorId,
  type RegionId,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  EMPTY_SELECTION,
  SelectionFacet,
  selectionsEqual,
  withChannels,
  withObjects,
  withTimeRange,
  withoutFacet,
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
import type { EditorAsset } from '../assets/editor-asset.js';
import { projectTarget } from './project-edits.js';
import { chainsOfTarget } from './rack-target.js';
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

/** The identities `held` holds after `id` is chosen: added or taken away when adding, alone otherwise. */
function chosen<T extends string>(held: readonly T[], id: T, adding: boolean): readonly T[] {
  if (!adding) return [id];
  return held.includes(id) ? held.filter((each) => each !== id) : [...held, id];
}

/** `current` with the markers `ids` selected, or no object selected where there are none. */
function withMarkers(current: SelectionSet, ids: readonly MarkerId[]): SelectionSet {
  const [first, ...rest] = ids;
  return first === undefined
    ? withoutFacet(current, SelectionFacet.Objects)
    : withObjects(current, { kind: 'markers', ids: [first, ...rest] });
}

/** `current` with the regions `ids` selected, or no object selected where there are none. */
function withRegions(current: SelectionSet, ids: readonly RegionId[]): SelectionSet {
  const [first, ...rest] = ids;
  return first === undefined
    ? withoutFacet(current, SelectionFacet.Objects)
    : withObjects(current, { kind: 'regions', ids: [first, ...rest] });
}

/** `current` with the processors `ids` selected, or no object selected where there are none. */
function withProcessors(current: SelectionSet, ids: readonly ProcessorId[]): SelectionSet {
  const [first, ...rest] = ids;
  return first === undefined
    ? withoutFacet(current, SelectionFacet.Objects)
    : withObjects(current, { kind: 'processors', ids: [first, ...rest] });
}

function heldProcessors(current: SelectionSet): readonly ProcessorId[] {
  return current.objects?.kind === 'processors' ? current.objects.ids : [];
}

/**
 * The processor `named` among the chains the view's asset and its regions
 * run, by its identifier, or why it is none of them.
 */
function processorOf(
  context: ShellContext,
  target: EditorTarget,
  named: string | undefined,
): { readonly id: ProcessorId } | string {
  const project = projectTarget(context, target.asset);
  if (typeof project === 'string') return project;
  const { project: state } = project.state;
  const asset = state.assets.get(project.owner.asset.id);
  if (asset === undefined) return 'That asset is no longer in the project.';
  const targets = [
    chainsOfTarget({ kind: 'asset', asset }),
    ...[...state.regions.values()]
      .filter((region) => region.assetId === asset.id)
      .map((region) => chainsOfTarget({ kind: 'region', region, asset })),
  ];
  for (const { rack, ranges } of targets) {
    for (const id of [rack, ...ranges.map((range) => range.chain)]) {
      const chain = id === undefined ? undefined : state.effectChains.get(id);
      const found = chain === undefined || named === undefined ? undefined : findSlot(chain, named);
      if (found?.slot.kind === 'processor') return { id: found.slot.id };
    }
  }
  return `That processor is in no rack of ${target.asset.name}.`;
}

function processorSelections(): readonly Command<ShellContext>[] {
  return [
    selectionCommand(
      'editor.select-processor',
      'Select a processor',
      (current, target, context, invocation) => {
        const found = processorOf(context, target, textArgument(invocation, 'processorId'));
        if (typeof found === 'string') return found;
        // A processor is selected among the others only with `extend`, as a
        // marker is with `add`.
        const adding = invocation.arguments?.['extend'] === true;
        return withProcessors(current, chosen(heldProcessors(current), found.id, adding));
      },
      { discoverable: false },
    ),
    selectionCommand(
      'editor.deselect-processors',
      'Select no processor',
      (current, { asset }) =>
        heldProcessors(current).length === 0
          ? `No processor of ${asset.name} is selected.`
          : withoutFacet(current, SelectionFacet.Objects),
      { keywords: ['deselect', 'processor', 'clear', 'rack', 'none'] },
    ),
  ];
}

function heldMarkers(current: SelectionSet): readonly MarkerId[] {
  return current.objects?.kind === 'markers' ? current.objects.ids : [];
}

function heldRegions(current: SelectionSet): readonly RegionId[] {
  return current.objects?.kind === 'regions' ? current.objects.ids : [];
}

function objectSelections(): readonly Command<ShellContext>[] {
  return [
    selectionCommand(
      'editor.select-marker',
      'Select a marker',
      (current, { asset }, _context, invocation) => {
        const [id] = markerIdsOf(textArgument(invocation, 'marker'));
        if (id === undefined || !asset.markers.some((marker) => marker.id === id)) {
          return `That marker is not in ${asset.name}.`;
        }
        const adding = invocation.arguments?.['add'] === true;
        return withMarkers(current, chosen(heldMarkers(current), id, adding));
      },
      { discoverable: false },
    ),
    selectionCommand(
      'editor.select-region',
      'Select a region',
      (current, { asset }, _context, invocation) => {
        const named = textArgument(invocation, 'region')?.trim() ?? '';
        const region = asset.regions.find((one) => one.id === named);
        if (region === undefined) return `That region is not in ${asset.name}.`;
        const adding = invocation.arguments?.['add'] === true;
        return withRegions(current, chosen(heldRegions(current), region.id, adding));
      },
      { discoverable: false },
    ),
  ];
}

/** Which way a step goes through a view's markers or regions. */
const Step = { Next: 'next', Previous: 'previous' } as const;

type Step = (typeof Step)[keyof typeof Step];

/**
 * The object a step from `held` reaches among `ordered`, each at its position
 * on the view's timeline: past the last of those selected, or before the
 * first; with none of them selected, the first at or after the playhead, or
 * the last at or before it.
 */
function stepped<T extends string>(
  ordered: readonly { readonly id: T; readonly at: number }[],
  held: readonly T[],
  playhead: number,
  step: Step,
): T | undefined {
  const places = ordered.flatMap((one, index) => (held.includes(one.id) ? [index] : []));
  if (places.length > 0) {
    const index = step === Step.Next ? Math.max(...places) + 1 : Math.min(...places) - 1;
    return ordered[index]?.id;
  }
  return step === Step.Next
    ? ordered.find((one) => one.at >= playhead)?.id
    : ordered.findLast((one) => one.at <= playhead)?.id;
}

/** A kind of object a view's selection steps through: what it is called, and where each is. */
interface Steppable<T extends string> {
  readonly noun: string;
  readonly plural: string;
  readonly ordered: (asset: EditorAsset) => readonly { readonly id: T; readonly at: number }[];
  readonly held: (current: SelectionSet) => readonly T[];
  readonly selected: (current: SelectionSet, ids: readonly T[]) => SelectionSet;
}

const MARKERS: Steppable<MarkerId> = {
  noun: 'marker',
  plural: 'markers',
  ordered: (asset) => asset.markers.map((marker) => ({ id: marker.id, at: marker.position })),
  held: heldMarkers,
  selected: withMarkers,
};

const REGIONS: Steppable<RegionId> = {
  noun: 'region',
  plural: 'regions',
  ordered: (asset) => asset.regions.map((region) => ({ id: region.id, at: region.start })),
  held: heldRegions,
  selected: withRegions,
};

/** Selects the next or previous object of a kind in the view, from the keyboard or the palette. */
function stepCommand<T extends string>(kind: Steppable<T>, step: Step): Command<ShellContext> {
  return selectionCommand(
    `editor.select-${step}-${kind.noun}`,
    `Select the ${step} ${kind.noun}`,
    (current, { asset }, context) => {
      const held = kind.held(current);
      const id = stepped(kind.ordered(asset), held, playheadOf(context, asset), step);
      if (id !== undefined) return kind.selected(current, [id]);
      const way = step === Step.Next ? 'after' : 'before';
      if (held.length === 0) return `${asset.name} has no ${kind.plural} ${way} the playhead.`;
      return `No ${kind.noun} lies ${way} the ${held.length === 1 ? 'one' : 'ones'} selected.`;
    },
    { keywords: [kind.noun, 'select', step, 'step', 'jump'] },
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
      'editor.scope-all-channels',
      'Select every channel',
      (current, { asset }) => withChannels(current, [], channelCount(asset.layout)),
      { keywords: ['channels', 'scope', 'all', 'every'] },
    ),
  ];
}

/** The commands that change the selection. */
export function selectionCommands(): readonly Command<ShellContext>[] {
  return [
    ...rangeCommands(),
    ...objectSelections(),
    ...processorSelections(),
    stepCommand(MARKERS, Step.Next),
    stepCommand(MARKERS, Step.Previous),
    stepCommand(REGIONS, Step.Next),
    stepCommand(REGIONS, Step.Previous),
    ...wholeCommands(),
  ];
}
