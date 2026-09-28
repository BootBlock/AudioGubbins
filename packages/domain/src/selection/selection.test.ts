import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type ClipId, type MarkerId, type TrackId } from '../identity/branded-id.js';
import type { SampleCount } from '../time/sample-time.js';
import {
  NO_SELECTION,
  SelectionFocus,
  type Selection,
  hasSelection,
  selectionFocus,
  selectionSize,
} from './selection.js';

const clipA = unsafeBrandId<'ClipId'>('aaaaaaaa-1111') as ClipId;
const clipB = unsafeBrandId<'ClipId'>('aaaaaaaa-2222') as ClipId;
const markerA = unsafeBrandId<'MarkerId'>('cccccccc-1111') as MarkerId;
const trackA = unsafeBrandId<'TrackId'>('dddddddd-1111') as TrackId;

describe('selectionFocus', () => {
  it('focuses on nothing when nothing is selected', () => {
    expect(selectionFocus(NO_SELECTION)).toBe(SelectionFocus.Nothing);
  });

  it('focuses on the time range when a range is selected', () => {
    const selection: Selection = {
      kind: 'time-range',
      start: 0 as SampleCount,
      length: 480 as SampleCount,
      trackIds: [],
    };
    expect(selectionFocus(selection)).toBe(SelectionFocus.TimeRange);
  });

  it('focuses on clips when clips are selected', () => {
    expect(selectionFocus({ kind: 'clips', ids: [clipA, clipB] })).toBe(SelectionFocus.Clips);
  });

  it('focuses on markers when markers are selected', () => {
    expect(selectionFocus({ kind: 'markers', ids: [markerA] })).toBe(SelectionFocus.Markers);
  });

  it('focuses on tracks when tracks are selected', () => {
    expect(selectionFocus({ kind: 'tracks', ids: [trackA] })).toBe(SelectionFocus.Tracks);
  });

  it('gives every selection kind exactly one focus', () => {
    // The Inspector and every command acting on "the selection" switch on the
    // focus. A kind with no focus would leave both showing nothing with no
    // error, so the mapping must stay total as kinds are added.
    const everyKind: Selection[] = [
      NO_SELECTION,
      { kind: 'time-range', start: 0 as SampleCount, length: 1 as SampleCount, trackIds: [] },
      { kind: 'clips', ids: [clipA] },
      { kind: 'regions', ids: [unsafeBrandId('bbbbbbbb-1111')] },
      { kind: 'markers', ids: [markerA] },
      { kind: 'tracks', ids: [trackA] },
      { kind: 'assets', ids: [unsafeBrandId('eeeeeeee-1111')] },
      { kind: 'processors', ids: [unsafeBrandId('ffffffff-1111')] },
    ];

    const focuses = everyKind.map(selectionFocus);
    expect(new Set(focuses).size).toBe(everyKind.length);
    expect(focuses).not.toContain(undefined);
  });
});

describe('hasSelection', () => {
  it('reports nothing selected for the empty selection', () => {
    expect(hasSelection(NO_SELECTION)).toBe(false);
  });

  it('reports a selection for a zero-length time range', () => {
    // A zero-length range is a caret position, which is still a selection: a
    // Paste command needs somewhere to paste to.
    expect(
      hasSelection({
        kind: 'time-range',
        start: 100 as SampleCount,
        length: 0 as SampleCount,
        trackIds: [],
      }),
    ).toBe(true);
  });

  it('reports a selection when entities are selected', () => {
    expect(hasSelection({ kind: 'clips', ids: [clipA] })).toBe(true);
  });
});

describe('selectionSize', () => {
  it('counts nothing as zero', () => {
    expect(selectionSize(NO_SELECTION)).toBe(0);
  });

  it('counts a time range as one however many tracks it covers', () => {
    expect(
      selectionSize({
        kind: 'time-range',
        start: 0 as SampleCount,
        length: 480 as SampleCount,
        trackIds: [trackA, unsafeBrandId('dddddddd-2222')],
      }),
    ).toBe(1);
  });

  it('counts each selected entity', () => {
    expect(selectionSize({ kind: 'clips', ids: [clipA, clipB] })).toBe(2);
  });
});
