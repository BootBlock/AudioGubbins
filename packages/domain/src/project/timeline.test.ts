import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId, type AssetId } from '../identity/branded-id.js';
import { sampleRate, type SampleCount } from '../time/sample-time.js';
import { expectSuccess } from '../testing/unwrap.js';
import { AssetOrigin, type Asset, assetRangeEnd, assetRangeFitsAsset } from './asset.js';
import {
  type Clip,
  type PlacedRegion,
  clipAssetId,
  clipEnd,
  clipsOverlap,
  regionEnd,
} from './timeline.js';

const asset: Asset = {
  id: unsafeBrandId<'AssetId'>('12341234-asset'),
  displayName: 'Gravel footstep',
  origin: AssetOrigin.Imported,
  sampleRate: expectSuccess(sampleRate(44_100)),
  channelLayout: StandardLayouts.mono,
  length: 10_000 as SampleCount,
  storageKey: 'opaque-to-the-domain',
  edits: [],
};

function makeClip(start: number, length: number, suffix = 'aaaa'): Clip {
  return {
    id: unsafeBrandId<'ClipId'>(`56785678-${suffix}`),
    trackId: unsafeBrandId<'TrackId'>('43214321-track'),
    displayName: 'Clip',
    source: { assetId: asset.id, start: 0 as SampleCount, length: length as SampleCount },
    timelineStart: start as SampleCount,
    timelineLength: length as SampleCount,
    gain: 1,
    fadeInLength: 0 as SampleCount,
    fadeOutLength: 0 as SampleCount,
    muted: false,
  };
}

describe('clipEnd', () => {
  it('is the first frame after the clip', () => {
    expect(clipEnd(makeClip(1_000, 500))).toBe(1_500);
  });

  it('equals the start for a zero-length clip', () => {
    expect(clipEnd(makeClip(1_000, 0))).toBe(1_000);
  });
});

describe('clipsOverlap', () => {
  it('reports overlap when one clip starts inside the other', () => {
    expect(clipsOverlap(makeClip(0, 1_000), makeClip(500, 1_000, 'bbbb'))).toBe(true);
  });

  it('reports no overlap for clips that merely touch', () => {
    // Ranges are half-open, so a clip ending at 1000 and one starting at 1000
    // are adjacent, not overlapping. Treating them as overlapping would make
    // every ordinary splice look like a conflict.
    expect(clipsOverlap(makeClip(0, 1_000), makeClip(1_000, 1_000, 'bbbb'))).toBe(false);
  });

  it('reports no overlap for separated clips', () => {
    expect(clipsOverlap(makeClip(0, 100), makeClip(5_000, 100, 'bbbb'))).toBe(false);
  });

  it('reports overlap when one clip wholly contains the other', () => {
    expect(clipsOverlap(makeClip(0, 10_000), makeClip(100, 50, 'bbbb'))).toBe(true);
  });

  it('is symmetric', () => {
    const left = makeClip(0, 1_000);
    const right = makeClip(500, 1_000, 'bbbb');
    expect(clipsOverlap(left, right)).toBe(clipsOverlap(right, left));
  });

  it('reports no overlap for a zero-length clip at another clip boundary', () => {
    expect(clipsOverlap(makeClip(0, 1_000), makeClip(1_000, 0, 'bbbb'))).toBe(false);
  });
});

describe('clipAssetId', () => {
  it('names the asset the clip reads from', () => {
    expect(clipAssetId(makeClip(0, 100))).toBe(asset.id);
  });
});

describe('regionEnd', () => {
  it('is the first frame after the region', () => {
    const region: PlacedRegion = {
      id: unsafeBrandId('87658765-region'),
      displayName: 'Loop body',
      start: 2_000 as SampleCount,
      length: 3_000 as SampleCount,
      tags: [],
    };
    expect(regionEnd(region)).toBe(5_000);
  });
});

describe('assetRangeFitsAsset', () => {
  it('accepts a range wholly inside the asset', () => {
    const range = { assetId: asset.id, start: 100 as SampleCount, length: 200 as SampleCount };
    expect(assetRangeFitsAsset(range, asset)).toBe(true);
  });

  it('accepts a range ending exactly at the asset end', () => {
    const range = { assetId: asset.id, start: 9_000 as SampleCount, length: 1_000 as SampleCount };
    expect(assetRangeFitsAsset(range, asset)).toBe(true);
  });

  it('rejects a range reading one frame past the asset end', () => {
    const range = { assetId: asset.id, start: 9_000 as SampleCount, length: 1_001 as SampleCount };
    expect(assetRangeFitsAsset(range, asset)).toBe(false);
  });

  it('rejects a range that names a different asset', () => {
    const range = {
      assetId: unsafeBrandId<'AssetId'>('99999999-other') as AssetId,
      start: 0 as SampleCount,
      length: 10 as SampleCount,
    };
    expect(assetRangeFitsAsset(range, asset)).toBe(false);
  });

  it('computes the end of a range', () => {
    expect(
      assetRangeEnd({ assetId: asset.id, start: 5 as SampleCount, length: 10 as SampleCount }),
    ).toBe(15);
  });
});
