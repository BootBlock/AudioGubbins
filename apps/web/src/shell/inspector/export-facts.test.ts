import { describe, expect, it } from 'vitest';

import { sampleRate, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintFrom,
  type ExportRecord,
} from '@audiogubbins/project-format';

import type { Fact } from './facts.js';
import { recordFacts, type ExportWording } from './export-facts.js';

const INTRO = unsafeBrandId<'RegionId'>('0a1b2c3d-0000-0000-0000-00000000aaaa');

/** A FLAC export of the region "Intro", from a point the history still holds, into a folder. */
const RECORD: ExportRecord = {
  id: unsafeBrandId<'ExportRecordId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d'),
  at: Date.UTC(2026, 9, 10, 14, 5),
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'2'.repeat(64)}`)),
  historyNodeId: 'point-kept',
  engineVersions: new Map([['render', '0.1.0']]),
  output: { container: 'flac', settings: new Map() },
  destination: { kind: ExportDestinationKind.Directory, label: 'Game sounds' },
  file: {
    settings: {
      format: 'flac',
      encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: false },
      sampleRate: expectSuccess(sampleRate(48_000)),
      channels: { kind: 'keep' },
      dither: { kind: 'none' },
      range: { kind: 'region', region: INTRO },
      metadata: { policy: 'minimal', edits: [] },
      fileName: '{region}',
    },
    fileName: 'Intro.flac',
    byteLength: 1_000,
    sha256: 'ab'.repeat(32),
    codec: { id: 'flac', implementation: 'codec-module', version: 'flacenc 0.5.1' },
    reproducible: false,
  },
  status: ExportStatus.Succeeded,
  problems: [],
};

/** A project whose only region is "Intro" and whose only point is "Trimmed the start". */
const WORDING: ExportWording = {
  regionName: (region) => (region === INTRO ? 'Intro' : undefined),
  trustedName: () => undefined,
  pointName: (node) => (node === 'point-kept' ? 'Trimmed the start' : undefined),
};

function asRecord(facts: readonly Fact[]): Readonly<Record<string, string>> {
  return Object.fromEntries(facts.map((fact) => [fact.term, fact.detail]));
}

describe('what the Inspector says of an export the history records (REQ-EDIT-072, REQ-STOR-197)', () => {
  it('names the region, the point it was made from, where it went and what it was', () => {
    expect(asRecord(recordFacts(RECORD, WORDING))).toMatchObject({
      'From the point': 'Trimmed the start',
      File: '“Intro.flac”',
      Exports: 'The region “Intro”',
      Metadata: 'The title and the loops alone',
      'Encoded as': 'FLAC by flacenc 0.5.1 in the codec module',
      'Its bytes': 'The project gives bytes another machine may not repeat.',
      'Where it went': 'Into “Game sounds”.',
      'How it ended': 'Every file was written.',
      'Rendered by': 'render 0.1.0',
    });
  });

  it('says what is gone where provenance was stripped, the point and the region removed, and the export failed in part', () => {
    const { file } = RECORD;
    if (file === undefined) throw new Error('The record wrote a file.');
    const { fileName: _name, ...stripped } = file;
    const facts = asRecord(
      recordFacts(
        {
          ...RECORD,
          historyNodeId: 'point-removed',
          destination: { kind: ExportDestinationKind.TrustedDirectory },
          file: stripped,
          status: ExportStatus.Partial,
          problems: ['The folder was taken away.'],
        },
        { ...WORDING, regionName: () => undefined },
      ),
    );

    expect(facts).toMatchObject({
      'From the point': 'A point no longer in the history',
      File: 'Its name was not kept',
      Exports: 'A region no longer in the project',
      'Where it went': 'Into a folder, kept trusted.',
      'How it ended': 'Only some of it was written. The folder was taken away.',
    });
  });
});
