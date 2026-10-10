import { describe, expect, it } from 'vitest';

import { sampleRate, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintFrom,
  type ExportRecord,
} from '@audiogubbins/project-format';

import { when } from '../../wording.js';
import { describeExport } from './history-words.js';

const AT = Date.UTC(2026, 9, 10, 14, 5);

/** An export of a bundle, as the project's own exports are recorded. */
const BUNDLE: ExportRecord = {
  id: unsafeBrandId<'ExportRecordId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d'),
  at: AT,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'2'.repeat(64)}`)),
  engineVersions: new Map(),
  output: { container: 'zip', settings: new Map() },
  destination: { kind: ExportDestinationKind.Download, label: 'Harbour.zip' },
  status: ExportStatus.Succeeded,
  problems: [],
};

/** An audio file exported into a folder by the codec module's FLAC encoder. */
const FLAC: ExportRecord = {
  ...BUNDLE,
  output: { container: 'flac', settings: new Map() },
  destination: { kind: ExportDestinationKind.Directory, label: 'Game sounds' },
  file: {
    settings: {
      format: 'flac',
      encoding: { bits: 24, compressionLevel: 5 },
      sampleRate: expectSuccess(sampleRate(48_000)),
      channels: { kind: 'keep' },
      dither: { kind: 'none' },
      range: { kind: 'project' },
      metadata: { policy: 'full', edits: [] },
      fileName: '{project}',
    },
    fileName: 'Loop.flac',
    byteLength: 1_000,
    sha256: 'ab'.repeat(32),
    codec: { id: 'flac', implementation: 'codec-module', version: '0.12.0' },
    reproducible: true,
  },
};

describe('what the History panel says of an export (REQ-STOR-197, REQ-AUDIO-145)', () => {
  it('names a project export by where it went', () => {
    expect(describeExport(BUNDLE)).toBe(`Exported as Harbour.zip on ${when(AT)}`);
  });

  it('names an audio file, where it went, its codec and version, and whether it is reproducible', () => {
    expect(describeExport(FLAC)).toBe(
      `Exported as “Loop.flac” to “Game sounds” on ${when(AT)}, encoded as FLAC by the codec module 0.12.0, the same bytes on every machine`,
    );
  });

  it("says a browser's encoding may not be repeated elsewhere", () => {
    const file = FLAC.file;
    if (file === undefined) throw new Error('The record names its file.');
    const aac: ExportRecord = {
      ...FLAC,
      destination: { kind: ExportDestinationKind.Download },
      file: {
        ...file,
        fileName: 'Loop.m4a',
        codec: { id: 'aac-lc', implementation: 'browser', version: 'WebCodecs (Chromium) 130' },
        reproducible: false,
      },
    };

    expect(describeExport(aac)).toBe(
      `Exported as “Loop.m4a” on ${when(AT)}, encoded as AAC-LC by the browser's encoder WebCodecs (Chromium) 130, bytes another machine may not repeat`,
    );
  });
});
