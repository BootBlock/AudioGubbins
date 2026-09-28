/**
 * What the user currently has selected.
 *
 * REQ-EXEC-136.11 names selection precedence as a domain rule that must have
 * one authoritative home, because the Inspector (REQ-EDIT-072), the menus, the
 * command palette, the context menus and every command that acts on "the
 * selection" must agree about what is selected and which part of it wins.
 * Without one home, the Inspector could show a clip's properties while the
 * Delete command removed a marker.
 *
 * Selection is domain state rather than view state: REQ-EDIT-072 requires
 * direct manipulation and Inspector editing to act on the same thing, and two
 * views cannot agree about the selection if each owns its own.
 */

import type {
  AssetId,
  ClipId,
  MarkerId,
  ProcessorId,
  RegionId,
  TrackId,
} from '../identity/branded-id.js';
import type { SampleCount } from '../time/sample-time.js';

/** A contiguous stretch of the project timeline. */
export interface TimeRangeSelection {
  readonly kind: 'time-range';
  readonly start: SampleCount;
  readonly length: SampleCount;

  /**
   * The tracks the range covers.
   *
   * Empty means every track. A range on no track would select nothing, so the
   * empty case is given the useful meaning rather than being invalid.
   */
  readonly trackIds: readonly TrackId[];
}

/** One or more selected entities of the same kind. */
export type EntitySelection =
  | { readonly kind: 'clips'; readonly ids: readonly [ClipId, ...ClipId[]] }
  | { readonly kind: 'regions'; readonly ids: readonly [RegionId, ...RegionId[]] }
  | { readonly kind: 'markers'; readonly ids: readonly [MarkerId, ...MarkerId[]] }
  | { readonly kind: 'tracks'; readonly ids: readonly [TrackId, ...TrackId[]] }
  | { readonly kind: 'assets'; readonly ids: readonly [AssetId, ...AssetId[]] }
  | { readonly kind: 'processors'; readonly ids: readonly [ProcessorId, ...ProcessorId[]] };

/** Nothing is selected. */
export interface EmptySelection {
  readonly kind: 'none';
}

/** What the user currently has selected. */
export type Selection = EmptySelection | TimeRangeSelection | EntitySelection;

/** Nothing is selected. */
export const NO_SELECTION: EmptySelection = { kind: 'none' };

/**
 * What the Inspector shows and what a command acting on "the selection"
 * targets.
 *
 * The ordering below is the precedence rule, stated once:
 *
 * 1. A selected entity wins over a time range. Selecting a clip and then
 *    dragging a range over it means the user is working on the range, but
 *    clicking the clip afterwards means they are working on the clip. Only one
 *    of the two is ever the current selection, so the active kind decides.
 * 2. Within an entity selection, every selected entity shares a kind. A
 *    selection cannot mix clips and markers, which removes the question of
 *    which of the two the Inspector should show.
 * 3. An empty selection targets nothing. It never silently falls back to the
 *    whole project: a Delete that quietly meant "everything" because nothing
 *    was selected would be a data-loss defect.
 */
export const SelectionFocus = {
  Nothing: 'nothing',
  TimeRange: 'time-range',
  Clips: 'clips',
  Regions: 'regions',
  Markers: 'markers',
  Tracks: 'tracks',
  Assets: 'assets',
  Processors: 'processors',
} as const;

/** What the Inspector shows for the current selection. */
export type SelectionFocus = (typeof SelectionFocus)[keyof typeof SelectionFocus];

/** Resolves a selection to the single thing the Inspector and commands act on. */
export function selectionFocus(selection: Selection): SelectionFocus {
  switch (selection.kind) {
    case 'none':
      return SelectionFocus.Nothing;
    case 'time-range':
      return SelectionFocus.TimeRange;
    case 'clips':
      return SelectionFocus.Clips;
    case 'regions':
      return SelectionFocus.Regions;
    case 'markers':
      return SelectionFocus.Markers;
    case 'tracks':
      return SelectionFocus.Tracks;
    case 'assets':
      return SelectionFocus.Assets;
    case 'processors':
      return SelectionFocus.Processors;
  }
}

/** Whether anything is selected. */
export function hasSelection(selection: Selection): boolean {
  return selection.kind !== 'none';
}

/**
 * How many things are selected.
 *
 * A time range counts as one, because it is one range however many tracks it
 * covers. The Inspector uses this to choose between a single-item view and a
 * multiple-selection view.
 */
export function selectionSize(selection: Selection): number {
  switch (selection.kind) {
    case 'none':
      return 0;
    case 'time-range':
      return 1;
    default:
      return selection.ids.length;
  }
}
