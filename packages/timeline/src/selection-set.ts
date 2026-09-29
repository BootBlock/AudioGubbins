/**
 * What the person has selected in an asset, as explicit facets.
 *
 * REQ-EDIT-063 forbids one ambiguous selection: a time range, a spectral area,
 * a set of objects and a channel scope are different things to edit, so each is
 * its own optional facet. Each is kept until it is cleared or made invalid
 * (REQ-EDIT-064), and one of them is active: the one the person made last,
 * which is what a command acts on (`selection-target.ts`, ADR-0042). Selecting
 * a marker after a range keeps the range, shown but not active, so a click does
 * not throw away a careful selection.
 *
 * This is the one home of the selection (REQ-EXEC-136.11): the Inspector, the
 * menus, the palette and every command read this value and resolve it through
 * the same precedence.
 */

import type {
  AssetId,
  ClipId,
  MarkerId,
  ProcessorId,
  RegionId,
  SampleCount,
  TrackId,
} from '@audiogubbins/domain';

import type { BoundaryRange } from './viewport.js';

/** A frequency band in hertz, `low` below `high`. */
export interface FrequencyBand {
  readonly low: number;
  readonly high: number;
}

/** A point of a spectral lasso: a boundary and a frequency. */
export interface SpectralPoint {
  readonly position: SampleCount;
  readonly frequency: number;
}

/** The outline a spectral selection takes within its range and band. */
export type SpectralShape =
  | { readonly kind: 'rectangle' }
  | {
      readonly kind: 'lasso';
      /** At least three points, each inside the range and band. */
      readonly points: readonly [SpectralPoint, SpectralPoint, SpectralPoint, ...SpectralPoint[]];
    };

/** An area of time and frequency. */
export interface SpectralArea {
  readonly range: BoundaryRange;
  readonly band: FrequencyBand;
  readonly shape: SpectralShape;
}

/** One or more selected objects of one kind. */
export type ObjectSelection =
  | { readonly kind: 'markers'; readonly ids: readonly [MarkerId, ...MarkerId[]] }
  | { readonly kind: 'regions'; readonly ids: readonly [RegionId, ...RegionId[]] }
  | { readonly kind: 'clips'; readonly ids: readonly [ClipId, ...ClipId[]] }
  | { readonly kind: 'tracks'; readonly ids: readonly [TrackId, ...TrackId[]] }
  | { readonly kind: 'assets'; readonly ids: readonly [AssetId, ...AssetId[]] }
  | { readonly kind: 'processors'; readonly ids: readonly [ProcessorId, ...ProcessorId[]] };

/** Which facet a command acts on. */
export const SelectionFacet = {
  None: 'none',
  Time: 'time',
  Spectral: 'spectral',
  Objects: 'objects',
} as const;

export type SelectionFacet = (typeof SelectionFacet)[keyof typeof SelectionFacet];

/** A facet that holds something: every facet but none. */
export type MadeFacet = Exclude<SelectionFacet, typeof SelectionFacet.None>;

/** What is selected in one asset. */
export interface SelectionSet {
  /** A time range, `[start, end)`, at least one sample long. */
  readonly time?: BoundaryRange;
  readonly spectral?: SpectralArea;
  readonly objects?: ObjectSelection;
  /**
   * The channels a time, spectral or whole-asset target covers, by index in the
   * asset's layout, ascending and without repeats. Absent means every channel.
   */
  readonly channels?: readonly [number, ...number[]];
  /**
   * The facets present, the most recently made first. The first is the active
   * one; when it is cleared the one made before it becomes active, which is the
   * person's own earlier choice rather than a guess.
   */
  readonly recency: readonly MadeFacet[];
}

/** Nothing selected. */
export const EMPTY_SELECTION: SelectionSet = { recency: [] };

/** The facet a command acts on: the one made last, or none. */
export function activeFacet(set: SelectionSet): SelectionFacet {
  return set.recency[0] ?? SelectionFacet.None;
}

function madeLast(set: SelectionSet, facet: MadeFacet): readonly MadeFacet[] {
  return [facet, ...set.recency.filter((each) => each !== facet)];
}

/** `set` with `time` as its active time range; an empty range clears the time facet. */
export function withTimeRange(set: SelectionSet, time: BoundaryRange): SelectionSet {
  if (time.end <= time.start) return withoutFacet(set, SelectionFacet.Time);
  return { ...set, time, recency: madeLast(set, SelectionFacet.Time) };
}

/** `set` with `area` as its active spectral selection. */
export function withSpectralArea(set: SelectionSet, area: SpectralArea): SelectionSet {
  if (area.range.end <= area.range.start || !(area.band.high > area.band.low)) {
    return withoutFacet(set, SelectionFacet.Spectral);
  }
  return { ...set, spectral: area, recency: madeLast(set, SelectionFacet.Spectral) };
}

/** `set` with `objects` as its active object selection. */
export function withObjects(set: SelectionSet, objects: ObjectSelection): SelectionSet {
  return { ...set, objects, recency: madeLast(set, SelectionFacet.Objects) };
}

/**
 * `set` scoped to `channels`, which are sorted and de-duplicated. An empty
 * list, or one naming every channel of a layout of `channelCount`, means every
 * channel. The active facet does not change: a scope narrows a target, it is
 * not one.
 */
export function withChannels(
  set: SelectionSet,
  channels: readonly number[],
  channelCount: number,
): SelectionSet {
  const scoped = [...new Set(channels)]
    .filter((channel) => Number.isInteger(channel) && channel >= 0 && channel < channelCount)
    .sort((a, b) => a - b);
  const [first, ...rest] = scoped;
  const unscoped: SelectionSet = {
    recency: set.recency,
    ...(set.time === undefined ? {} : { time: set.time }),
    ...(set.spectral === undefined ? {} : { spectral: set.spectral }),
    ...(set.objects === undefined ? {} : { objects: set.objects }),
  };
  return first === undefined || scoped.length === channelCount
    ? unscoped
    : { ...unscoped, channels: [first, ...rest] };
}

/** `set` without one facet; the facet made before it becomes active. */
export function withoutFacet(set: SelectionSet, facet: SelectionFacet): SelectionSet {
  return {
    recency: set.recency.filter((each) => each !== facet),
    ...(facet === SelectionFacet.Time || set.time === undefined ? {} : { time: set.time }),
    ...(facet === SelectionFacet.Spectral || set.spectral === undefined
      ? {}
      : { spectral: set.spectral }),
    ...(facet === SelectionFacet.Objects || set.objects === undefined
      ? {}
      : { objects: set.objects }),
    ...(set.channels === undefined ? {} : { channels: set.channels }),
  };
}

/** What an asset holds, for reconciling a selection with it. */
export interface SelectableContent {
  readonly length: SampleCount;
  readonly channelCount: number;
  readonly markers: ReadonlySet<string>;
  readonly regions: ReadonlySet<string>;
}

function clippedRange(range: BoundaryRange, length: SampleCount): BoundaryRange | undefined {
  const end = Math.min(range.end, length);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the smaller of two boundaries is a boundary
  return end > range.start ? { start: range.start, end: end as SampleCount } : undefined;
}

function survivingObjects(
  objects: ObjectSelection,
  content: SelectableContent,
): ObjectSelection | undefined {
  switch (objects.kind) {
    case 'markers': {
      const [first, ...rest] = objects.ids.filter((id) => content.markers.has(id));
      return first === undefined ? undefined : { kind: 'markers', ids: [first, ...rest] };
    }
    case 'regions': {
      const [first, ...rest] = objects.ids.filter((id) => content.regions.has(id));
      return first === undefined ? undefined : { kind: 'regions', ids: [first, ...rest] };
    }
    default:
      // An asset's view holds no clips, tracks, assets or processors of its
      // own, so a selection of them is the project's to reconcile.
      return objects;
  }
}

/**
 * `set` made valid for `content` after a change to it (REQ-EDIT-064): a range
 * past the end is clipped, or dropped if nothing of it is left, channels the
 * layout no longer has are dropped, and objects that no longer exist are
 * removed. A facet that is left whole is kept exactly, so an unrelated change
 * never disturbs a selection.
 */
export function reconciled(set: SelectionSet, content: SelectableContent): SelectionSet {
  let next = set;
  if (set.time !== undefined) {
    const time = clippedRange(set.time, content.length);
    next = time === undefined ? withoutFacet(next, SelectionFacet.Time) : { ...next, time };
  }
  if (set.spectral !== undefined) {
    const range = clippedRange(set.spectral.range, content.length);
    next =
      range === undefined
        ? withoutFacet(next, SelectionFacet.Spectral)
        : { ...next, spectral: { ...set.spectral, range } };
  }
  if (set.objects !== undefined) {
    const objects = survivingObjects(set.objects, content);
    next =
      objects === undefined ? withoutFacet(next, SelectionFacet.Objects) : { ...next, objects };
  }
  if (set.channels !== undefined) next = withChannels(next, set.channels, content.channelCount);
  return selectionsEqual(next, set) ? set : next;
}

function rangesEqual(left?: BoundaryRange, right?: BoundaryRange): boolean {
  return left?.start === right?.start && left?.end === right?.end;
}

function listsEqual(left: readonly unknown[] = [], right: readonly unknown[] = []): boolean {
  return left.length === right.length && left.every((each, index) => each === right[index]);
}

/** Whether two selections select the same things with the same facet active. */
export function selectionsEqual(left: SelectionSet, right: SelectionSet): boolean {
  return (
    listsEqual(left.recency, right.recency) &&
    rangesEqual(left.time, right.time) &&
    rangesEqual(left.spectral?.range, right.spectral?.range) &&
    left.spectral?.band.low === right.spectral?.band.low &&
    left.spectral?.band.high === right.spectral?.band.high &&
    left.spectral?.shape === right.spectral?.shape &&
    left.objects?.kind === right.objects?.kind &&
    listsEqual(left.objects?.ids, right.objects?.ids) &&
    listsEqual(left.channels, right.channels)
  );
}
