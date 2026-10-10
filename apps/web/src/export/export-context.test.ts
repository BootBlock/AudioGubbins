import { describe, expect, it } from 'vitest';

import { StandardLayouts, derivedSampleCount, unsafeBrandId } from '@audiogubbins/domain';
import { applyInvocation } from '@audiogubbins/project-commands';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { regionEntryId } from '../assets/project-entry.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { exportContextOf } from './export-context.js';

holdPlatformFiles();

const SECOND = 48_000;

describe('what an export of an asset is planned against (ADR-0092)', () => {
  it("describes the asset as it is heard, and each region from its own first frame, in the timeline's order", async () => {
    const audio = await windowWithAudio({
      regions: [
        { name: 'Gulls', start: 3 * SECOND, end: 4 * SECOND },
        { name: 'Waves', start: 0, end: 2 * SECOND },
      ],
    });
    const context = expectSuccess(
      exportContextOf(audio.asset(), audio.session.getSnapshot().model.state),
    );

    expect(context.source).toMatchObject({
      // The project's name, which `{project}` names a file by, not the asset's.
      name: 'Harbour',
      sampleRate: SECOND,
      layout: StandardLayouts.stereo,
      length: 6 * SECOND,
      precision: { kind: 'integer', bits: 16 },
    });
    expect(
      context.source.regions.map(({ name, start, length }) => ({ name, start, length })),
    ).toEqual([
      { name: 'Waves', start: 0, length: 2 * SECOND },
      { name: 'Gulls', start: 0, length: SECOND },
    ]);
    expect(context.codecs('flac')?.name).toBe('FLAC');
  });

  it('needs floating point where an edit makes what is heard', async () => {
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
    const edited = await audio.changed(before);

    expect(
      expectSuccess(exportContextOf(edited, audio.session.getSnapshot().model.state)).source,
    ).toMatchObject({ length: 5 * SECOND, precision: { kind: 'float' } });
  });

  it('refuses a region, which is exported from its asset', async () => {
    const audio = await windowWithAudio({ regions: [{ name: 'Waves', start: 0, end: SECOND }] });
    const placed = audio.asset().regions[0];
    const region =
      placed === undefined ? undefined : audio.window.context.assets.find(regionEntryId(placed.id));
    if (region === undefined) throw new Error('The region opens.');

    expect(
      expectFailureCode(exportContextOf(region, audio.session.getSnapshot().model.state)),
    ).toBe('export.asset-unavailable');
  });
});
