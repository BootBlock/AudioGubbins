import { describe, expect, it } from 'vitest';

import {
  clipEnd,
  clipsOnTrack,
  clipsOverlap,
  isAssetInUse,
  isWellFormedId,
  projectLength,
  tracksInOrder,
  validateMarker,
  validateRegion,
} from '@audiogubbins/domain';

import { emptyProject, sampleProject } from './projects.js';

describe('sampleProject', () => {
  it('builds the same project every time, so a failing test can be found again', () => {
    const first = sampleProject();
    const second = sampleProject();

    expect(first.project.id).toBe(second.project.id);
    expect(first.clips.firstStep.id).toBe(second.clips.firstStep.id);
    expect([...first.project.assets.keys()]).toEqual([...second.project.assets.keys()]);
  });

  it('builds a different project for a different seed', () => {
    expect(sampleProject(1).project.id).not.toBe(sampleProject(2).project.id);
  });

  it('gives every entity a well-formed identifier', () => {
    const fixture = sampleProject();
    const ids = [
      fixture.project.id,
      ...fixture.project.assets.keys(),
      ...fixture.project.tracks.keys(),
      ...fixture.project.clips.keys(),
      ...fixture.project.regions.keys(),
      ...fixture.project.markers.keys(),
    ];

    for (const id of ids) expect(isWellFormedId(id)).toBe(true);
  });

  it('gives every entity a distinct identifier', () => {
    const fixture = sampleProject();
    const ids = [
      fixture.project.id,
      ...fixture.project.assets.keys(),
      ...fixture.project.tracks.keys(),
      ...fixture.project.clips.keys(),
      ...fixture.project.regions.keys(),
      ...fixture.project.markers.keys(),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds two tracks in a recorded order', () => {
    const fixture = sampleProject();
    expect(tracksInOrder(fixture.project).map((track) => track.displayName)).toEqual([
      'Foley',
      'Background',
    ]);
  });

  it('places both clips on the foley track, in timeline order', () => {
    const fixture = sampleProject();
    const clips = clipsOnTrack(fixture.project, fixture.tracks.foley.id);

    expect(clips.map((clip) => clip.displayName)).toEqual(['Step 1', 'Step 2']);
  });

  it('places the clips adjacent rather than overlapping', () => {
    // Half-open ranges make adjacency exact, and a test that asserts no overlap
    // needs a case that touches without overlapping.
    const { firstStep, secondStep } = sampleProject().clips;

    expect(clipEnd(firstStep)).toBe(secondStep.timelineStart);
    expect(clipsOverlap(firstStep, secondStep)).toBe(false);
  });

  it('has a project length reaching the end of the last clip', () => {
    const fixture = sampleProject();
    expect(projectLength(fixture.project)).toBe(clipEnd(fixture.clips.secondStep));
  });

  it('uses one asset and leaves the other unused, so both cases are available', () => {
    const fixture = sampleProject();

    expect(isAssetInUse(fixture.project, fixture.assets.footstep.id)).toBe(true);
    expect(isAssetInUse(fixture.project, fixture.assets.ambience.id)).toBe(false);
  });

  it('carries a mono asset and a stereo one', () => {
    const fixture = sampleProject();

    expect(fixture.assets.footstep.channelLayout.roles).toHaveLength(1);
    expect(fixture.assets.ambience.channelLayout.roles).toHaveLength(2);
  });

  it('places its region, with a loop, and its marker validly on the footstep', () => {
    const fixture = sampleProject();
    const { loop } = fixture.regions;
    if (loop.loop === undefined) throw new Error('the loop region has no loop');

    expect(validateRegion(fixture.assets.footstep, loop).ok).toBe(true);
    expect(validateMarker(fixture.assets.footstep, fixture.markers.start).ok).toBe(true);
    expect(loop.loop.start).toBeGreaterThanOrEqual(loop.start);
    expect(loop.loop.end).toBeLessThanOrEqual(loop.end);
  });

  it('records marker colour as a palette key, never as a colour', () => {
    // REQ-UX-070 keeps marker colours in a semantic palette, so a marker stays
    // legible when the user switches theme.
    expect(sampleProject().markers.start.paletteKey).toBe('teal');
  });

  it('keeps every clip inside the asset it reads from', () => {
    const fixture = sampleProject();

    for (const clip of fixture.project.clips.values()) {
      const asset = fixture.project.assets.get(clip.source.assetId);
      expect(asset).toBeDefined();
      expect(clip.source.start + clip.source.length).toBeLessThanOrEqual(asset?.length ?? 0);
    }
  });
});

describe('emptyProject', () => {
  it('holds nothing', () => {
    const project = emptyProject();

    expect(project.assets.size).toBe(0);
    expect(project.tracks.size).toBe(0);
    expect(project.clips.size).toBe(0);
    expect(projectLength(project)).toBe(0);
  });

  it('still has a well-formed identifier and a name', () => {
    const project = emptyProject();

    expect(isWellFormedId(project.id)).toBe(true);
    expect(project.displayName).toBe('Untitled');
  });
});
