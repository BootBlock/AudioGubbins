/**
 * Deterministic domain fixtures.
 *
 * A project built the same way every run, so a test that asserts on its shape
 * gets the same identifiers, the same order and the same values on every
 * machine (REQ-REPO-191).
 *
 * The identifiers come from the deterministic generator rather than a random
 * one. That is the whole point: a failing test that names a clip can be found
 * again, and a golden result that records an identifier stays valid.
 */

import {
  AssetOrigin,
  MAIN_OUTPUT,
  StandardLayouts,
  createDeterministicIdGenerator,
  createProject,
  type Asset,
  type Clip,
  type IdGenerator,
  type Marker,
  type Project,
  type Region,
  type Track,
} from '@audiogubbins/domain';

import { fixtureSampleCount, fixtureSampleRate } from './measures.js';

/** What a fixture project holds, named so a test can refer to its parts. */
export interface ProjectFixture {
  readonly project: Project;
  readonly ids: IdGenerator;

  readonly assets: { readonly footstep: Asset; readonly ambience: Asset };
  readonly tracks: { readonly foley: Track; readonly background: Track };
  readonly clips: { readonly firstStep: Clip; readonly secondStep: Clip };
  readonly regions: { readonly loop: Region };
  readonly markers: { readonly start: Marker };
}

/** A small project with enough in it to exercise the model. */
export function sampleProject(seed = 20_260_918): ProjectFixture {
  const ids = createDeterministicIdGenerator(seed);
  const rate = fixtureSampleRate(48_000);

  const footstep: Asset = {
    id: ids.next<'AssetId'>(),
    displayName: 'Gravel footstep',
    origin: AssetOrigin.Imported,
    sampleRate: rate,
    channelLayout: StandardLayouts.mono,
    length: fixtureSampleCount(24_000),
    storageKey: 'fixture:gravel-footstep',
    edits: [],
  };

  const ambience: Asset = {
    id: ids.next<'AssetId'>(),
    displayName: 'Forest ambience',
    origin: AssetOrigin.Imported,
    sampleRate: rate,
    channelLayout: StandardLayouts.stereo,
    length: fixtureSampleCount(480_000),
    storageKey: 'fixture:forest-ambience',
    edits: [],
  };

  const foley: Track = {
    id: ids.next<'TrackId'>(),
    displayName: 'Foley',
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    output: MAIN_OUTPUT,
  };

  const background: Track = {
    id: ids.next<'TrackId'>(),
    displayName: 'Background',
    channelLayout: StandardLayouts.stereo,
    gain: 0.6,
    pan: 0,
    muted: false,
    soloed: false,
    output: MAIN_OUTPUT,
  };

  /** A clip placing part of the footstep on the foley track. */
  const step = (start: number, sourceStart: number, length: number, name: string): Clip => ({
    id: ids.next<'ClipId'>(),
    trackId: foley.id,
    displayName: name,
    source: {
      assetId: footstep.id,
      start: fixtureSampleCount(sourceStart),
      length: fixtureSampleCount(length),
    },
    timelineStart: fixtureSampleCount(start),
    timelineLength: fixtureSampleCount(length),
    gain: 1,
    fadeInLength: fixtureSampleCount(240),
    fadeOutLength: fixtureSampleCount(480),
    muted: false,
  });

  const firstStep = step(0, 0, 12_000, 'Step 1');

  // Deliberately adjacent rather than overlapping: half-open ranges make
  // adjacency exact, and a test that asserts no overlap needs a case that
  // touches without overlapping.
  const secondStep = step(12_000, 12_000, 12_000, 'Step 2');

  // The region and the marker are placed on the footstep before any edit, so
  // their basis is its unedited source.
  const loop: Region = {
    id: ids.next<'RegionId'>(),
    assetId: footstep.id,
    displayName: 'Walk loop',
    basis: 0,
    start: fixtureSampleCount(0),
    end: fixtureSampleCount(24_000),
    loop: {
      basis: 0,
      start: fixtureSampleCount(2_400),
      end: fixtureSampleCount(21_600),
      crossfadeLength: fixtureSampleCount(480),
    },
    tags: ['footstep', 'gravel'],
    operations: [],
  };

  const start: Marker = {
    id: ids.next<'MarkerId'>(),
    assetId: footstep.id,
    displayName: 'Walk begins',
    basis: 0,
    position: fixtureSampleCount(0),
    paletteKey: 'teal',
  };

  const project: Project = {
    ...createProject(ids.next<'ProjectId'>(), 'Footstep pack', {
      sampleRate: rate,
      channelLayout: StandardLayouts.stereo,
    }),
    assets: new Map([
      [footstep.id, footstep],
      [ambience.id, ambience],
    ]),
    tracks: new Map([
      [foley.id, foley],
      [background.id, background],
    ]),
    clips: new Map([
      [firstStep.id, firstStep],
      [secondStep.id, secondStep],
    ]),
    regions: new Map([[loop.id, loop]]),
    markers: new Map([[start.id, start]]),
    trackOrder: [foley.id, background.id],
  };

  return {
    project,
    ids,
    assets: { footstep, ambience },
    tracks: { foley, background },
    clips: { firstStep, secondStep },
    regions: { loop },
    markers: { start },
  };
}

/** An empty project, for a test that wants to build its own contents. */
export function emptyProject(seed = 1): Project {
  const ids = createDeterministicIdGenerator(seed);
  return createProject(ids.next<'ProjectId'>(), 'Untitled', {
    sampleRate: fixtureSampleRate(48_000),
    channelLayout: StandardLayouts.stereo,
  });
}
