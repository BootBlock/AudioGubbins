import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import {
  unsafeBrandId,
  type AssetId,
  type BusId,
  type EffectChainId,
  type ProjectId,
  type TrackId,
} from '../identity/branded-id.js';
import type { EditOperation, RegionOperation } from '../editing/operations.js';
import { assetOf, operationId, range } from '../testing/editing-fixtures.js';
import { sampleRate, type SampleCount } from '../time/sample-time.js';
import { expectSuccess } from '../testing/unwrap.js';
import type { Clip, Marker, Region } from './timeline.js';
import { MAIN_OUTPUT, type Bus, type Track } from './routing.js';
import {
  type Project,
  chainUseCount,
  chainUsers,
  clipsOnTrack,
  createProject,
  isAssetInUse,
  projectLength,
  tracksInOrder,
} from './project.js';

const settings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  channelLayout: StandardLayouts.stereo,
};

const projectId = unsafeBrandId<'ProjectId'>('99999999-project') as ProjectId;

function trackId(suffix: string): TrackId {
  return unsafeBrandId<'TrackId'>(`55555555-${suffix}`);
}

function assetId(suffix: string): AssetId {
  return unsafeBrandId<'AssetId'>(`66666666-${suffix}`);
}

function makeTrack(suffix: string): Track {
  return {
    id: trackId(suffix),
    displayName: suffix,
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    output: MAIN_OUTPUT,
  };
}

function makeClip(
  suffix: string,
  track: TrackId,
  start: number,
  length: number,
  asset = assetId('aaaa'),
): Clip {
  return {
    id: unsafeBrandId<'ClipId'>(`77777777-${suffix}`),
    trackId: track,
    displayName: suffix,
    source: { assetId: asset, start: 0 as SampleCount, length: length as SampleCount },
    timelineStart: start as SampleCount,
    timelineLength: length as SampleCount,
    gain: 1,
    fadeInLength: 0 as SampleCount,
    fadeOutLength: 0 as SampleCount,
    muted: false,
  };
}

function withClips(clips: readonly Clip[], tracks: readonly Track[] = []): Project {
  const base = createProject(projectId, 'Test project', settings);
  return {
    ...base,
    clips: new Map(clips.map((clip) => [clip.id, clip])),
    tracks: new Map(tracks.map((track) => [track.id, track])),
    trackOrder: tracks.map((track) => track.id),
  };
}

describe('createProject', () => {
  it('starts with no entities and no track order', () => {
    const project = createProject(projectId, 'Untitled', settings);
    expect(project.assets.size).toBe(0);
    expect(project.tracks.size).toBe(0);
    expect(project.clips.size).toBe(0);
    expect(project.trackOrder).toEqual([]);
  });

  it('keeps the display name separate from the identifier', () => {
    const project = createProject(projectId, 'Footstep pack', settings);
    expect(project.displayName).toBe('Footstep pack');
    expect(project.id).toBe(projectId);
  });
});

describe('tracksInOrder', () => {
  it('returns tracks in the order recorded, not the order they were added', () => {
    const first = makeTrack('aaaa');
    const second = makeTrack('bbbb');
    const project: Project = {
      ...createProject(projectId, 'Test', settings),
      tracks: new Map([
        [first.id, first],
        [second.id, second],
      ]),
      trackOrder: [second.id, first.id],
    };
    expect(tracksInOrder(project).map((track) => track.displayName)).toEqual(['bbbb', 'aaaa']);
  });

  it('skips an order entry for a track that is no longer present', () => {
    const present = makeTrack('aaaa');
    const project: Project = {
      ...createProject(projectId, 'Test', settings),
      tracks: new Map([[present.id, present]]),
      trackOrder: [trackId('missing'), present.id],
    };
    expect(tracksInOrder(project)).toEqual([present]);
  });
});

describe('clipsOnTrack', () => {
  it('returns only the clips on the requested track', () => {
    const trackA = makeTrack('aaaa');
    const trackB = makeTrack('bbbb');
    const onA = makeClip('1111', trackA.id, 0, 100);
    const onB = makeClip('2222', trackB.id, 0, 100);
    const project = withClips([onA, onB], [trackA, trackB]);
    expect(clipsOnTrack(project, trackA.id)).toEqual([onA]);
  });

  it('sorts clips by their timeline start', () => {
    const track = makeTrack('aaaa');
    const later = makeClip('2222', track.id, 500, 100);
    const earlier = makeClip('1111', track.id, 0, 100);
    const project = withClips([later, earlier], [track]);
    expect(clipsOnTrack(project, track.id).map((clip) => clip.timelineStart)).toEqual([0, 500]);
  });

  it('returns nothing for a track with no clips', () => {
    const track = makeTrack('aaaa');
    expect(clipsOnTrack(withClips([], [track]), track.id)).toEqual([]);
  });
});

describe('projectLength', () => {
  it('is zero for an empty project', () => {
    expect(projectLength(createProject(projectId, 'Empty', settings))).toBe(0);
  });

  it('reaches the end of the last clip', () => {
    const track = makeTrack('aaaa');
    const project = withClips([makeClip('1111', track.id, 1_000, 500)], [track]);
    expect(projectLength(project)).toBe(1_500);
  });

  it('takes the furthest clip when clips overlap', () => {
    const track = makeTrack('aaaa');
    const project = withClips(
      [makeClip('1111', track.id, 0, 2_000), makeClip('2222', track.id, 500, 100)],
      [track],
    );
    expect(projectLength(project)).toBe(2_000);
  });

  it('places nothing for a region or a marker, which lie on an asset at its own rate', () => {
    const track = makeTrack('aaaa');
    const asset = assetId('marked');
    const marker: Marker = {
      id: unsafeBrandId('88888888-marker'),
      assetId: asset,
      displayName: 'End',
      basis: 0,
      position: 9_000 as SampleCount,
    };
    const region: Region = {
      id: unsafeBrandId('aaaaaaaa-region'),
      assetId: asset,
      displayName: 'Tail',
      basis: 0,
      start: 4_000 as SampleCount,
      end: 5_000 as SampleCount,
      tags: [],
      operations: [],
    };
    const project: Project = {
      ...withClips([makeClip('1111', track.id, 0, 100)], [track]),
      markers: new Map([[marker.id, marker]]),
      regions: new Map([[region.id, region]]),
    };
    expect(projectLength(project)).toBe(100);
  });
});

describe('isAssetInUse', () => {
  it('reports an asset a clip reads from as in use', () => {
    const track = makeTrack('aaaa');
    const asset = assetId('inuse');
    const project = withClips([makeClip('1111', track.id, 0, 100, asset)], [track]);
    expect(isAssetInUse(project, asset)).toBe(true);
  });

  it('reports an asset no clip reads from as unused', () => {
    const track = makeTrack('aaaa');
    const project = withClips([makeClip('1111', track.id, 0, 100, assetId('used'))], [track]);
    expect(isAssetInUse(project, assetId('unused'))).toBe(false);
  });

  it('reports an asset its own region or marker names as in use, and no other', () => {
    const asset = assetId('marked');
    const marker: Marker = {
      id: unsafeBrandId('88888888-marker'),
      assetId: asset,
      displayName: 'Hit',
      basis: 0,
      position: 10 as SampleCount,
    };
    const region: Region = {
      id: unsafeBrandId('aaaaaaaa-region'),
      assetId: assetId('regioned'),
      displayName: 'Body',
      basis: 0,
      start: 0 as SampleCount,
      end: 10 as SampleCount,
      tags: [],
      operations: [],
    };
    const project: Project = {
      ...createProject(projectId, 'Test', settings),
      markers: new Map([[marker.id, marker]]),
      regions: new Map([[region.id, region]]),
    };
    expect(isAssetInUse(project, asset)).toBe(true);
    expect(isAssetInUse(project, assetId('regioned'))).toBe(true);
    expect(isAssetInUse(project, assetId('unused'))).toBe(false);
  });

  it('reports every asset as unused in an empty project', () => {
    expect(isAssetInUse(createProject(projectId, 'Empty', settings), assetId('any'))).toBe(false);
  });
});

describe('chainUsers', () => {
  const shared: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');
  const other: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-bbbb');

  const rackEdit = (chain: EffectChainId, name: string): EditOperation => ({
    id: operationId(name),
    kind: 'process',
    range: range(0, 10),
    edit: { kind: 'rack', chain },
  });
  const regionEdit = (chain: EffectChainId, name: string): RegionOperation => ({
    id: operationId(name),
    basis: 0,
    range: range(0, 10),
    edit: { kind: 'rack', chain },
  });
  const regionOf = (
    name: string,
    operations: readonly RegionOperation[],
    rack?: EffectChainId,
  ): Region => ({
    id: unsafeBrandId(`aaaaaaaa-${name}`),
    assetId: assetId('regioned'),
    displayName: name,
    basis: 0,
    start: 0 as SampleCount,
    end: 100 as SampleCount,
    tags: [],
    operations,
    ...(rack === undefined ? {} : { rack }),
  });
  const busOf = (name: string, effectChainId?: EffectChainId): Bus => ({
    id: unsafeBrandId<'BusId'>(`bbbbbbbb-${name}`),
    displayName: name,
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    muted: false,
    ...(effectChainId === undefined ? {} : { effectChainId }),
  });

  // Each kind of user names the shared chain once, and once more by a
  // neighbour naming another chain, so a count of any one kind that ignored
  // which chain it named, or missed the kind, would be wrong.
  const edited = assetOf('0001', 100, [
    {
      id: operationId('gain'),
      kind: 'process',
      range: range(0, 10),
      edit: { kind: 'gain', gain: 2 },
    },
    rackEdit(shared, 'first'),
    rackEdit(shared, 'second'),
  ]);
  const editedElsewhere = assetOf('0002', 100, [rackEdit(other, 'other')]);
  const racked = { ...assetOf('0003', 100), rack: shared };
  const rackedElsewhere = { ...assetOf('0004', 100), rack: other };
  const processedRegion = regionOf('0001', [regionEdit(shared, 'region')]);
  const processedElsewhere = regionOf('0002', [regionEdit(other, 'elsewhere')]);
  const rackedRegion = regionOf('0003', [], shared);
  const rackedRegionElsewhere = regionOf('0004', [], other);
  const track: Track = { ...makeTrack('aaaa'), effectChainId: shared };
  const trackElsewhere: Track = { ...makeTrack('bbbb'), effectChainId: other };
  const bus = busOf('0001', shared);
  const busElsewhere = busOf('0002', other);
  const plainBus = busOf('0003');

  const project: Project = {
    ...withClips([], [track, trackElsewhere, makeTrack('cccc')]),
    assets: new Map(
      [edited, editedElsewhere, racked, rackedElsewhere].map((asset) => [asset.id, asset]),
    ),
    regions: new Map(
      [processedRegion, processedElsewhere, rackedRegion, rackedRegionElsewhere].map((region) => [
        region.id,
        region,
      ]),
    ),
    buses: new Map<BusId, Bus>([bus, busElsewhere, plainBus].map((each) => [each.id, each])),
  };

  it('names every asset edit, region edit, asset rack, region rack, track and bus that applies the chain, and no other', () => {
    expect(chainUsers(project, shared)).toEqual({
      assetEdits: [edited.id],
      regionEdits: [processedRegion.id],
      assetRacks: [racked.id],
      regionRacks: [rackedRegion.id],
      tracks: [track.id],
      buses: [bus.id],
    });
  });

  it('counts each user once, an asset with two edits of the chain as one, so a shared chain is known as shared', () => {
    expect(chainUseCount(chainUsers(project, shared))).toBe(6);
    expect(chainUseCount(chainUsers(project, other))).toBe(6);
    expect(
      chainUseCount(chainUsers(project, unsafeBrandId<'EffectChainId'>('33333333-cccc'))),
    ).toBe(0);
  });
});
