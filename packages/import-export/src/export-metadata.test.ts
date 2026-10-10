import { describe, expect, it } from 'vitest';

import { sampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { MetadataMap } from '@audiogubbins/codecs';

import { exportMetadata, type MetadataRates } from './export-metadata.js';
import { rate } from './testing/export-fixtures.js';

const frames = (count: number) => expectSuccess(sampleCount(count));

const SAME: MetadataRates = { from: rate(48_000), to: rate(48_000) };

const PROJECT: MetadataMap = {
  text: { title: 'Door slam', artist: 'Foley', copyright: '2026' },
  cues: [{ position: frames(100), name: 'Hit' }],
  tuning: { unityNote: 60, fineTuneCents: 0 },
};

const REGION: MetadataMap = {
  text: { title: 'Slam', comment: 'Take 3' },
  loops: [
    { start: frames(1_000), length: frames(44_100), playCount: 'endless', direction: 'forward' },
  ],
};

describe('the metadata an export carries', () => {
  it("carries the project's with the region's over it, in full", () => {
    expect(
      expectSuccess(exportMetadata(PROJECT, REGION, { policy: 'full', edits: [] }, SAME)),
    ).toEqual({
      text: { title: 'Slam', artist: 'Foley', copyright: '2026', comment: 'Take 3' },
      cues: PROJECT.cues,
      tuning: PROJECT.tuning,
      loops: REGION.loops,
    });
  });

  it('carries the title and the loops alone when minimal, and nothing when none', () => {
    expect(
      expectSuccess(exportMetadata(PROJECT, REGION, { policy: 'minimal', edits: [] }, SAME)),
    ).toEqual({
      text: { title: 'Slam' },
      loops: REGION.loops,
    });
    expect(
      expectSuccess(exportMetadata(PROJECT, REGION, { policy: 'none', edits: [] }, SAME)),
    ).toEqual({});
  });

  it("applies the person's edits over the policy, the last edit of a field deciding it", () => {
    const map = expectSuccess(
      exportMetadata(
        PROJECT,
        undefined,
        {
          policy: 'full',
          edits: [
            { kind: 'remove', key: 'artist' },
            { kind: 'set', key: 'genre', value: 'Foley' },
            { kind: 'set', key: 'title', value: 'Slam, final' },
          ],
        },
        SAME,
      ),
    );
    expect(map.text).toEqual({ title: 'Slam, final', copyright: '2026', genre: 'Foley' });
  });

  it('places loops and cues at the file rate by the rule for a change of rate', () => {
    const map = expectSuccess(
      exportMetadata(
        PROJECT,
        REGION,
        { policy: 'full', edits: [] },
        { from: rate(44_100), to: rate(48_000) },
      ),
    );
    // 100 → 108.8 → 109; 1000 → 1088.4 → 1088; 45100 → 49088.4 → 49088.
    expect(map.cues).toEqual([{ position: 109, name: 'Hit' }]);
    expect(map.loops).toEqual([
      { start: 1_088, length: 48_000, playCount: 'endless', direction: 'forward' },
    ]);
  });

  it('keeps every position exact at the same rate', () => {
    const map = expectSuccess(exportMetadata(PROJECT, REGION, { policy: 'full', edits: [] }, SAME));
    expect(map.loops).toEqual(REGION.loops);
    expect(map.cues).toEqual(PROJECT.cues);
  });
});
