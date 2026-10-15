import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  unsafeBrandId,
  type AssetId,
  type RegionId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  BUILT_IN_PRESETS,
  planExport,
  resolvePreset,
  type CodecLookup,
  type ExportContext,
  type ExportPreset,
} from '@audiogubbins/import-export';

import { profileFromPreset } from './game-export-profile.js';
import { memberExportSettings } from './member-export-settings.js';

const REGION: RegionId = unsafeBrandId('region-step');
const ASSET: AssetId = unsafeBrandId('asset-field');

/** A whole asset as a group holds it: the asset it is, which its range does not read. */
const ASSET_MEMBER = { kind: 'asset', asset: ASSET } as const;

/** A 16-bit mono asset at 44.1 kHz: unlike every built-in preset's rate and depth. */
const CONTEXT: ExportContext = {
  source: {
    name: 'Field recording',
    sampleRate: expectSuccess(sampleRate(44_100)),
    layout: StandardLayouts.mono,
    precision: { kind: 'integer', bits: 16 },
    length: expectSuccess(sampleCount(441_000)),
    regions: [],
  },
  codecs: () => undefined,
};

/** A writer of integer PCM in WAV at any rate, the one codec a WAV profile's plan needs. */
const PCM: NonNullable<ReturnType<CodecLookup>> = {
  id: 'pcm',
  name: 'PCM',
  lossless: true,
  codes: { waveFormatTags: [], aifcCompressionTypes: [] },
  read: undefined,
  write: {
    implementation: 'application',
    containers: ['wav'],
    reproducible: true,
    licence: 'Apache-2.0',
    sampleRates: { kind: 'any', minimum: 8_000, maximum: 384_000 },
    maximumChannels: 8,
  },
};

const CONTEXT_WITH_CODECS: ExportContext = {
  ...CONTEXT,
  codecs: (id) => (id === 'pcm' ? PCM : undefined),
};

function preset(id: string): ExportPreset {
  const found = BUILT_IN_PRESETS.find((one) => one.id === id);
  if (found === undefined) throw new Error(`No built-in preset ${id}.`);
  return found;
}

describe("a member's export settings from a profile", () => {
  it('are the settings the preset it came from resolves to, with the range and name of the member', () => {
    for (const each of BUILT_IN_PRESETS) {
      const settings = memberExportSettings(
        profileFromPreset(each),
        { kind: 'region', region: REGION },
        CONTEXT,
        'step_07',
      );
      expect(settings, each.id).toEqual({
        ...resolvePreset(each, CONTEXT),
        range: { kind: 'region', region: REGION },
        fileName: 'step_07',
      });
    }
  });

  it("take the profile's choices and the format's defaults for the member's audio", () => {
    const settings = memberExportSettings(
      profileFromPreset(preset('game-wav-16-48k')),
      { kind: 'region', region: REGION },
      CONTEXT,
      'step_07',
    );
    expect(settings).toMatchObject({
      format: 'wav',
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: { kind: 'keep' },
      dither: { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 },
    });
  });

  it('export a region member as its region, and an asset member as the whole of its audio', () => {
    const profile = profileFromPreset(preset('master-flac'));
    const region = memberExportSettings(profile, { kind: 'region', region: REGION }, CONTEXT, 'a');
    const asset = memberExportSettings(profile, ASSET_MEMBER, CONTEXT, 'a');
    expect(region.range).toEqual({ kind: 'region', region: REGION });
    expect(asset.range).toEqual({ kind: 'project' });
  });

  it('take the name they are given as a literal, not a name a preset chose', () => {
    const own: ExportPreset = {
      id: 'own',
      name: 'Mine',
      format: 'wav',
      settings: { fileName: '{project} {index}', range: { kind: 'every-region' } },
    };
    const settings = memberExportSettings(
      profileFromPreset(own),
      ASSET_MEMBER,
      CONTEXT,
      'Field {date} }{',
    );
    expect(settings.fileName).toBe('Field {{date}} }}{{');
    expect(settings.range).toEqual({ kind: 'project' });
  });

  it('name a file planned from them exactly the stem they were given', () => {
    const settings = memberExportSettings(
      profileFromPreset(preset('game-wav-16-48k')),
      ASSET_MEMBER,
      CONTEXT,
      'Field {index} {{x}}',
    );
    const clock = { epochMilliseconds: 0, utcOffsetMinutes: 0 };
    const [file] = expectSuccess(planExport(settings, CONTEXT_WITH_CODECS, clock));
    expect(file?.name).toEqual({ stem: 'Field {index} {{x}}', extension: 'wav' });
  });
});
