/**
 * The projects the page's export tests plan against: described as an export
 * sees them, checked against the codec registry as it stands, so a rule the
 * import-export package holds is met here as the page meets it.
 */

import { codecDescriptor } from '@audiogubbins/codecs';
import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  unsafeBrandId,
  type RegionId,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportClock, ExportContext, ExportSource } from '@audiogubbins/import-export';

/** A rate, made where it is one. */
export function rateOf(hertz: number): SampleRate {
  return expectSuccess(sampleRate(hertz));
}

export const FIRST_REGION: RegionId = unsafeBrandId('region-first');
const SECOND_REGION: RegionId = unsafeBrandId('region-second');

/** A stereo project of 16-bit audio at `hertz`, a second long, with two regions. */
function stereoProject(hertz = 48_000): ExportSource {
  const rate = rateOf(hertz);
  const audio = {
    sampleRate: rate,
    layout: StandardLayouts.stereo,
    precision: { kind: 'integer', bits: 16 },
  } as const;
  return {
    ...audio,
    name: 'Footsteps',
    length: expectSuccess(sampleCount(hertz)),
    regions: [
      {
        ...audio,
        id: FIRST_REGION,
        name: 'Left foot',
        start: expectSuccess(sampleCount(0)),
        length: expectSuccess(sampleCount(hertz / 4)),
      },
      {
        ...audio,
        id: SECOND_REGION,
        name: 'Right foot',
        start: expectSuccess(sampleCount(hertz / 2)),
        length: expectSuccess(sampleCount(hertz / 4)),
      },
    ],
  };
}

/** What an export of `source` is planned against, with the registry's codecs. */
export function exportContextOver(source: ExportSource = stereoProject()): ExportContext {
  return { source, codecs: codecDescriptor };
}

/** A fixed moment, in UTC, for the `{date}` a file name may hold. */
export const EXPORT_CLOCK: ExportClock = {
  epochMilliseconds: Date.UTC(2026, 9, 10, 12),
  utcOffsetMinutes: 0,
};
