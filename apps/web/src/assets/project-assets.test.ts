import { describe, expect, it } from 'vitest';

import { derivedSampleCount, streamLength, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PcmDescriptionKind } from '@audiogubbins/audio-engine';
import { addRegionInvocation, applyInvocation } from '@audiogubbins/project-commands';
import { ProjectCommandId } from '@audiogubbins/project-commands';

import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { projectEntries, regionEntryId } from './project-assets.js';

holdPlatformFiles();

const SECOND = 48_000;
const LOOP_LENGTH = 6 * SECOND;

describe('an asset of the project, as a view opens it (ADR-0051)', () => {
  it('plays its chain as it stands: a deletion shortens it and changes its revision', async () => {
    const audio = await windowWithAudio();
    const before = audio.asset();

    expectSuccess(
      await audio.session.run(
        applyInvocation(
          { id: audio.assetId },
          {
            id: unsafeBrandId<'EditOperationId'>('0000eeee-0000-4000-8000-0000000000e1'),
            kind: 'delete',
            range: { start: derivedSampleCount(0), end: derivedSampleCount(SECOND) },
          },
        ),
      ),
    );
    const after = await audio.changed(before);

    expect([before.length, after.length]).toEqual([LOOP_LENGTH, LOOP_LENGTH - SECOND]);
    expect(after.revision).not.toBe(before.revision);
    const described = after.describe();
    if (described.kind !== PcmDescriptionKind.Edited) throw new Error('Not an edited sound.');
    expect(streamLength(described.plan.streams[0])).toBe(LOOP_LENGTH - SECOND);
    expect(described.media.map((media) => [media.asset, media.length])).toEqual([
      [audio.assetId, LOOP_LENGTH],
    ]);
  });

  it('is the value it was where a change to the project left it alone', async () => {
    const audio = await windowWithAudio();
    const before = audio.asset();

    expectSuccess(
      await audio.session.run({
        commandId: ProjectCommandId.Rename,
        arguments: { name: 'Quay' },
      }),
    );

    expect(audio.session.getSnapshot().model.state.project.displayName).toBe('Quay');
    expect(audio.asset()).toBe(before);
  });

  it('opens a region as its slice of the asset, its markers placed from its start', async () => {
    const audio = await windowWithAudio({
      markers: [{ name: 'Hit', at: 9600 }],
      regions: [{ name: 'Body', start: 4800, end: 244_800 }],
    });
    const [region] = audio.session.getSnapshot().model.state.project.regions.values();
    if (region === undefined) throw new Error('No region.');

    const shown = audio.window.context.assets.find(regionEntryId(region.id));

    expect(shown).toMatchObject({
      name: 'Body',
      length: 240_000,
      owner: { kind: 'project', offset: 4800 },
      regions: [],
    });
    expect(shown?.markers.map((marker) => [marker.displayName, marker.position])).toEqual([
      ['Hit', 4800],
    ]);
  });

  it('says a region whose audio every later edit removed has nothing left to show', async () => {
    const audio = await windowWithAudio({ regions: [{ name: 'Click', start: 4800, end: 9600 }] });
    const [region] = audio.session.getSnapshot().model.state.project.regions.values();
    if (region === undefined) throw new Error('No region.');
    const id = regionEntryId(region.id);
    expect(audio.window.context.assets.find(id)).toBeDefined();
    const before = audio.asset();

    expectSuccess(
      await audio.session.run(
        applyInvocation(
          { id: audio.assetId },
          {
            id: unsafeBrandId<'EditOperationId'>('0000eeee-0000-4000-8000-0000000000e2'),
            kind: 'delete',
            range: { start: derivedSampleCount(0), end: derivedSampleCount(SECOND) },
          },
        ),
      ),
    );
    await audio.changed(before);

    expect(audio.window.context.assets.find(id)).toBeUndefined();
    expect(audio.window.context.assets.get().unopened.get(id)).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringMatching(/^Nothing of it is left/),
    });
  });

  it('cannot be opened until the page holds its file, and says so', async () => {
    const audio = await windowWithAudio();
    const state = audio.session.getSnapshot().model.state;

    const finding = projectEntries(state, () => ({ kind: 'finding' })).entries;
    const missing = projectEntries(state, () => ({
      kind: 'unavailable',
      reason: 'The file it is linked to could not be found.',
    })).entries;

    expect(finding.get(audio.entry)).toEqual({
      kind: 'finding',
      id: audio.entry,
      name: 'Loop',
      reason: 'The audio of "Loop" is being read.',
    });
    expect(missing.get(audio.entry)).toMatchObject({
      kind: 'unavailable',
      reason: 'The file it is linked to could not be found.',
    });
  });

  it('adds a region the project gains, as a view of its own', async () => {
    const audio = await windowWithAudio();
    const id = unsafeBrandId<'RegionId'>('0000ffff-0000-4000-8000-0000000000f1');

    expectSuccess(
      await audio.session.run(
        addRegionInvocation({
          id,
          assetId: audio.assetId,
          displayName: 'Tail',
          basis: 0,
          start: derivedSampleCount(SECOND),
          end: derivedSampleCount(2 * SECOND),
          tags: [],
          operations: [],
        }),
      ),
    );

    expect(audio.window.context.assets.find(regionEntryId(id))).toMatchObject({
      name: 'Tail',
      length: SECOND,
    });
    expect(audio.asset().regions.map((region) => [region.displayName, region.start])).toEqual([
      ['Tail', SECOND],
    ]);
  });
});
