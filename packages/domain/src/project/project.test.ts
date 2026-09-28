import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import {
  unsafeBrandId,
  type AssetId,
  type ProjectId,
  type TrackId,
} from '../identity/branded-id.js';
import { sampleRate, type SampleCount } from '../time/sample-time.js';
import { expectSuccess } from '../testing/unwrap.js';
import type { Clip, Marker, Region } from './timeline.js';
import { MAIN_OUTPUT, type Track } from './routing.js';
import {
  type Project,
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

  it('extends to a marker placed past the last clip', () => {
    const track = makeTrack('aaaa');
    const marker: Marker = {
      id: unsafeBrandId('88888888-marker'),
      displayName: 'End',
      position: 9_000 as SampleCount,
    };
    const project: Project = {
      ...withClips([makeClip('1111', track.id, 0, 100)], [track]),
      markers: new Map([[marker.id, marker]]),
    };
    expect(projectLength(project)).toBe(9_000);
  });

  it('extends to the end of a region placed past the last clip', () => {
    const region: Region = {
      id: unsafeBrandId('aaaaaaaa-region'),
      displayName: 'Tail',
      start: 4_000 as SampleCount,
      length: 1_000 as SampleCount,
      tags: [],
    };
    const project: Project = {
      ...createProject(projectId, 'Test', settings),
      regions: new Map([[region.id, region]]),
    };
    expect(projectLength(project)).toBe(5_000);
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

  it('reports every asset as unused in an empty project', () => {
    expect(isAssetInUse(createProject(projectId, 'Empty', settings), assetId('any'))).toBe(false);
  });
});
