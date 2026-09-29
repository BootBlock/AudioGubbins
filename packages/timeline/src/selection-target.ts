/**
 * What a command acts on, resolved from a selection by one stated rule.
 *
 * The precedence (ADR-0042, REQ-EDIT-063):
 *
 * 1. The active facet, the one made last, is the target when the command
 *    accepts it.
 * 2. When the command does not accept the active facet, it is refused with the
 *    reason. It never falls back to another facet, because acting on a range
 *    the person made earlier when they had since clicked a marker is the silent
 *    guess the requirement forbids.
 * 3. With nothing selected, a command that processes takes the whole asset
 *    (REQ-EDIT-012) and any other is refused: a delete that quietly meant
 *    "everything" would be a data-loss defect.
 * 4. A channel scope narrows a time, spectral or whole-asset target; objects
 *    are whole things and take no scope.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import {
  SelectionFacet,
  activeFacet,
  type MadeFacet,
  type ObjectSelection,
  type SelectionSet,
  type SpectralArea,
} from './selection-set.js';
import type { BoundaryRange } from './viewport.js';

/** What a command acts on. */
export type SelectionTarget =
  | {
      readonly kind: 'whole-asset';
      readonly range: BoundaryRange;
      readonly channels: readonly number[];
    }
  | { readonly kind: 'time'; readonly range: BoundaryRange; readonly channels: readonly number[] }
  | { readonly kind: 'spectral'; readonly area: SpectralArea; readonly channels: readonly number[] }
  | { readonly kind: 'objects'; readonly objects: ObjectSelection };

/** What a command takes, and what it does with nothing selected. */
export interface TargetRequest {
  readonly accepts: ReadonlySet<MadeFacet>;
  readonly whenNothing: 'whole-asset' | 'refuse';
}

/** The asset a target lies in. */
export interface TargetAsset {
  readonly length: SampleCount;
  readonly channelCount: number;
}

/** How a facet is named in a refusal. */
const FACET_NAMES: Readonly<Record<MadeFacet, string>> = {
  [SelectionFacet.Time]: 'a time range',
  [SelectionFacet.Spectral]: 'a spectral area',
  [SelectionFacet.Objects]: 'a set of objects',
};

function acceptedNames(accepts: ReadonlySet<MadeFacet>): string {
  const names = [...accepts].map((facet) => FACET_NAMES[facet]);
  if (names.length <= 1) return names[0] ?? 'nothing selected';
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`;
}

function channelsOf(set: SelectionSet, asset: TargetAsset): readonly number[] {
  return set.channels ?? Array.from({ length: asset.channelCount }, (_, index) => index);
}

function wholeAsset(asset: TargetAsset): BoundaryRange {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- boundary zero starts every asset
  return { start: 0 as SampleCount, end: asset.length };
}

/** The target of a command making `request`, by the precedence above, or why there is none. */
export function resolveTarget(
  set: SelectionSet,
  request: TargetRequest,
  asset: TargetAsset,
): DomainResult<SelectionTarget> {
  const active = activeFacet(set);
  if (active === SelectionFacet.None) {
    return request.whenNothing === 'whole-asset'
      ? succeed({ kind: 'whole-asset', range: wholeAsset(asset), channels: channelsOf(set, asset) })
      : fail(
          failure(
            'selection.nothing-selected',
            FailureKind.Rejected,
            `Nothing is selected; select ${acceptedNames(request.accepts)} first.`,
          ),
        );
  }
  if (!request.accepts.has(active)) {
    return fail(
      failure(
        'selection.facet-not-accepted',
        FailureKind.Rejected,
        `This acts on ${acceptedNames(request.accepts)}; the active selection is ${FACET_NAMES[active]}.`,
        { details: { active } },
      ),
    );
  }
  switch (active) {
    case SelectionFacet.Time:
      return set.time === undefined
        ? missing(active)
        : succeed({ kind: 'time', range: set.time, channels: channelsOf(set, asset) });
    case SelectionFacet.Spectral:
      return set.spectral === undefined
        ? missing(active)
        : succeed({ kind: 'spectral', area: set.spectral, channels: channelsOf(set, asset) });
    case SelectionFacet.Objects:
      return set.objects === undefined
        ? missing(active)
        : succeed({ kind: 'objects', objects: set.objects });
  }
}

/** A selection whose recency names a facet it does not hold, which no builder here makes. */
function missing(facet: MadeFacet): DomainResult<SelectionTarget> {
  return fail(
    failure(
      'selection.inconsistent',
      FailureKind.IntegrityViolation,
      `The selection names ${FACET_NAMES[facet]} as active but holds none.`,
      { details: { facet } },
    ),
  );
}

/** The range of time a target covers, or `undefined` for objects, whose extent is theirs. */
export function targetRange(target: SelectionTarget): BoundaryRange | undefined {
  switch (target.kind) {
    case 'whole-asset':
    case 'time':
      return target.range;
    case 'spectral':
      return target.area.range;
    case 'objects':
      return undefined;
  }
}

/**
 * Whether a target lies wholly outside `shown`, so a command acting on it would
 * change something the person cannot see (REQ-EDIT-064).
 */
export function targetOutside(target: SelectionTarget, shown: BoundaryRange): boolean {
  const range = targetRange(target);
  if (range === undefined || target.kind === 'whole-asset') return false;
  return range.end <= shown.start || range.start >= shown.end;
}

/** How a target's parts are written in its description. */
export interface TargetWriting {
  readonly position: (position: SampleCount) => string;
  readonly channel: (index: number) => string;
  readonly channelCount: number;
  readonly frequency: (hertz: number) => string;
}

function channelsText(channels: readonly number[], writing: TargetWriting): string {
  if (channels.length === writing.channelCount) return 'every channel';
  const names = channels.map(writing.channel);
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return names.length === 1 ? `channel ${list}` : `channels ${list}`;
}

const OBJECT_NOUNS: Readonly<Record<ObjectSelection['kind'], readonly [string, string]>> = {
  markers: ['marker', 'markers'],
  regions: ['region', 'regions'],
  clips: ['clip', 'clips'],
  tracks: ['track', 'tracks'],
  assets: ['asset', 'assets'],
  processors: ['processor', 'processors'],
};

/**
 * The target in words, as the editor shows the active selection scope
 * (REQ-EDIT-063): `0:01.000 to 0:02.500 on channels Left and Right`.
 */
export function describeTarget(target: SelectionTarget, writing: TargetWriting): string {
  switch (target.kind) {
    case 'whole-asset':
      return `The whole asset, ${channelsText(target.channels, writing)}`;
    case 'time':
      return `${writing.position(target.range.start)} to ${writing.position(target.range.end)} on ${channelsText(target.channels, writing)}`;
    case 'spectral': {
      const { range, band } = target.area;
      return `${writing.position(range.start)} to ${writing.position(range.end)}, ${writing.frequency(band.low)} to ${writing.frequency(band.high)}, on ${channelsText(target.channels, writing)}`;
    }
    case 'objects': {
      const [one, many] = OBJECT_NOUNS[target.objects.kind];
      const count = target.objects.ids.length;
      return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
    }
  }
}
