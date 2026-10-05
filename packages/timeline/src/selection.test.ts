import type { MarkerId, RegionId, SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  SelectionFacet,
  activeFacet,
  reconciled,
  selectionsEqual,
  withChannels,
  withObjects,
  withSpectralArea,
  withTimeRange,
  withoutFacet,
  type SelectableContent,
  type SelectionSet,
  type SpectralArea,
} from './selection-set.js';
import {
  describeTarget,
  resolveTarget,
  targetOutside,
  type TargetRequest,
  type TargetWriting,
} from './selection-target.js';

const at = (value: number): SampleCount => value as SampleCount;
const marker = (id: string): MarkerId => id as MarkerId;
const range = (start: number, end: number) => ({ start: at(start), end: at(end) });

const ASSET = { length: at(48_000), channelCount: 2 };
const AREA: SpectralArea = {
  range: range(100, 200),
  band: { low: 1000, high: 2000 },
  shape: { kind: 'rectangle' },
};

const PROCESSING: TargetRequest = {
  accepts: new Set([SelectionFacet.Time, SelectionFacet.Spectral]),
  whenNothing: 'whole-asset',
};
const DELETING: TargetRequest = {
  accepts: new Set([SelectionFacet.Time, SelectionFacet.Objects]),
  whenNothing: 'refuse',
};

const WRITING: TargetWriting = {
  position: (position) => String(position),
  channel: (index) => ['Left', 'Right', 'Centre'][index] ?? String(index),
  channelCount: 3,
  frequency: (hertz) => `${String(hertz)} Hz`,
  counted: (count, one, many) => `${String(count)} of ${one} or ${many}`,
};

describe('the selection set', () => {
  it('keeps each facet and makes the one made last active', () => {
    let set = withTimeRange(EMPTY_SELECTION, range(10, 20));
    set = withObjects(set, { kind: 'markers', ids: [marker('m1')] });
    expect(activeFacet(set)).toBe(SelectionFacet.Objects);
    expect(set.time).toEqual(range(10, 20));
    set = withTimeRange(set, range(30, 40));
    expect(activeFacet(set)).toBe(SelectionFacet.Time);
    expect(set.recency).toEqual([SelectionFacet.Time, SelectionFacet.Objects]);
  });

  it('makes the facet made before active when the active one is cleared', () => {
    let set = withTimeRange(EMPTY_SELECTION, range(10, 20));
    set = withSpectralArea(set, AREA);
    set = withObjects(set, { kind: 'markers', ids: [marker('m1')] });
    set = withoutFacet(set, SelectionFacet.Objects);
    expect(activeFacet(set)).toBe(SelectionFacet.Spectral);
    set = withoutFacet(set, SelectionFacet.Spectral);
    expect(activeFacet(set)).toBe(SelectionFacet.Time);
    set = withoutFacet(set, SelectionFacet.Time);
    expect(activeFacet(set)).toBe(SelectionFacet.None);
  });

  it('clears a facet given an empty range or band', () => {
    const set = withTimeRange(EMPTY_SELECTION, range(10, 20));
    expect(withTimeRange(set, range(20, 20)).time).toBeUndefined();
    expect(withSpectralArea(set, { ...AREA, band: { low: 5, high: 5 } }).spectral).toBeUndefined();
  });

  it('scopes channels sorted and without repeats, and drops a scope of every channel', () => {
    const set = withTimeRange(EMPTY_SELECTION, range(0, 10));
    expect(withChannels(set, [2, 0, 2, 9], 3).channels).toEqual([0, 2]);
    expect(withChannels(set, [1, 0], 2).channels).toBeUndefined();
    expect(withChannels(set, [], 2)).toEqual(set);
    expect(activeFacet(withChannels(set, [1], 2))).toBe(SelectionFacet.Time);
  });
});

describe('reconciling a selection with changed content', () => {
  const content = (length: number, markers: string[] = []): SelectableContent => ({
    length: at(length),
    channelCount: 2,
    markers: new Set(markers),
    regions: new Set<RegionId>(),
  });

  it('keeps a selection the change left valid as the same value', () => {
    const set = withObjects(withTimeRange(EMPTY_SELECTION, range(0, 10)), {
      kind: 'markers',
      ids: [marker('m1')],
    });
    expect(reconciled(set, content(100, ['m1']))).toBe(set);
  });

  it('clips a range past the new end, and drops one wholly past it', () => {
    const set = withTimeRange(EMPTY_SELECTION, range(50, 150));
    expect(reconciled(set, content(100)).time).toEqual(range(50, 100));
    const gone = reconciled(set, content(40));
    expect(gone.time).toBeUndefined();
    expect(activeFacet(gone)).toBe(SelectionFacet.None);
  });

  it('removes objects that no longer exist, and channels the layout lost', () => {
    let set = withTimeRange(EMPTY_SELECTION, range(0, 10));
    set = withObjects(set, { kind: 'markers', ids: [marker('m1'), marker('m2')] });
    set = withChannels(set, [1], 3);
    const kept = reconciled(set, { ...content(100, ['m2']), channelCount: 1 });
    expect(kept.objects).toEqual({ kind: 'markers', ids: ['m2'] });
    expect(kept.channels).toBeUndefined();
    const none = reconciled(set, content(100));
    expect(none.objects).toBeUndefined();
    expect(activeFacet(none)).toBe(SelectionFacet.Time);
  });

  it('compares selections by what they hold', () => {
    const one = withTimeRange(EMPTY_SELECTION, range(0, 10));
    expect(selectionsEqual(one, withTimeRange(EMPTY_SELECTION, range(0, 10)))).toBe(true);
    expect(selectionsEqual(one, withTimeRange(EMPTY_SELECTION, range(0, 11)))).toBe(false);
  });
});

describe('resolving a command target', () => {
  const timeThenMarker: SelectionSet = withObjects(withTimeRange(EMPTY_SELECTION, range(10, 20)), {
    kind: 'markers',
    ids: [marker('m1')],
  });

  it('takes the active facet when the command accepts it', () => {
    expect(expectSuccess(resolveTarget(timeThenMarker, DELETING, ASSET))).toEqual({
      kind: 'objects',
      objects: { kind: 'markers', ids: ['m1'] },
    });
  });

  it('refuses rather than falling back to an older facet the command would accept', () => {
    const refused = resolveTarget(timeThenMarker, PROCESSING, ASSET);
    expect(expectFailureCode(refused)).toBe('selection.facet-not-accepted');
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(
      'This acts on a time range or a spectral area; the active selection is a set of objects.',
    );
  });

  it('takes the whole asset with nothing selected for processing, and refuses anything else', () => {
    expect(expectSuccess(resolveTarget(EMPTY_SELECTION, PROCESSING, ASSET))).toEqual({
      kind: 'whole-asset',
      range: range(0, 48_000),
      channels: [0, 1],
    });
    expect(expectFailureCode(resolveTarget(EMPTY_SELECTION, DELETING, ASSET))).toBe(
      'selection.nothing-selected',
    );
  });

  it('narrows time, spectral and whole-asset targets to the channel scope, never objects', () => {
    const scoped = withChannels(withTimeRange(EMPTY_SELECTION, range(0, 5)), [1], 2);
    expect(expectSuccess(resolveTarget(scoped, PROCESSING, ASSET))).toEqual({
      kind: 'time',
      range: range(0, 5),
      channels: [1],
    });
    const spectral = withChannels(withSpectralArea(EMPTY_SELECTION, AREA), [0], 2);
    expect(expectSuccess(resolveTarget(spectral, PROCESSING, ASSET))).toMatchObject({
      kind: 'spectral',
      channels: [0],
    });
    const whole = withChannels(EMPTY_SELECTION, [0], 2);
    expect(expectSuccess(resolveTarget(whole, PROCESSING, ASSET))).toMatchObject({ channels: [0] });
    const objects = withChannels(timeThenMarker, [0], 2);
    expect(expectSuccess(resolveTarget(objects, DELETING, ASSET))).not.toHaveProperty('channels');
  });

  it('reports a set whose active facet it does not hold as an integrity fault', () => {
    expect(
      expectFailureCode(resolveTarget({ recency: [SelectionFacet.Time] }, PROCESSING, ASSET)),
    ).toBe('selection.inconsistent');
  });
});

describe('describing a target', () => {
  it('says what a command will act on, in words', () => {
    expect(describeTarget({ kind: 'time', range: range(10, 20), channels: [0, 1] }, WRITING)).toBe(
      '10 to 20 on channels Left and Right',
    );
    expect(
      describeTarget({ kind: 'whole-asset', range: range(0, 9), channels: [0, 1, 2] }, WRITING),
    ).toBe('The whole asset, every channel');
    expect(describeTarget({ kind: 'spectral', area: AREA, channels: [2] }, WRITING)).toBe(
      '100 to 200, 1000 Hz to 2000 Hz, on channel Centre',
    );
    expect(
      describeTarget(
        { kind: 'objects', objects: { kind: 'markers', ids: [marker('a'), marker('b')] } },
        WRITING,
      ),
    ).toBe('2 of marker or markers');
  });

  it('tells when a target lies wholly outside what a view shows', () => {
    const target = { kind: 'time', range: range(10, 20), channels: [0] } as const;
    expect(targetOutside(target, range(20, 30))).toBe(true);
    expect(targetOutside(target, range(19, 30))).toBe(false);
    expect(
      targetOutside({ kind: 'whole-asset', range: range(0, 5), channels: [0] }, range(10, 20)),
    ).toBe(false);
  });
});
