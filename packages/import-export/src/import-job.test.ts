import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  cancelImport,
  importJob,
  importProgress,
  nextImportJob,
  type ImportFileEvent,
  type ImportJob,
} from './import-job.js';

const UNREADABLE = failure(
  'codecs.malformed',
  FailureKind.IntegrityViolation,
  'The header is cut short.',
);

function job(): ImportJob {
  return importJob([
    { name: 'a.flac', bytes: 1_000 },
    { name: 'b.mp3', bytes: 2_000 },
    { name: 'c.wav', bytes: 3_000 },
  ]);
}

function run(current: ImportJob, index: number, events: readonly ImportFileEvent[]): ImportJob {
  return events.reduce((next, event) => expectSuccess(nextImportJob(next, index, event)), current);
}

const TO_ADDING: readonly ImportFileEvent[] = [
  { kind: 'analyse' },
  { kind: 'copy', bytesTotal: 1_000 },
  { kind: 'copy-progress', bytesCopied: 1_000 },
  { kind: 'decode', framesTotal: 48_000 },
  { kind: 'decode-progress', framesDecoded: 48_000 },
  { kind: 'add' },
];

const IMPORTED: readonly ImportFileEvent[] = [...TO_ADDING, { kind: 'imported' }];

describe('a batch import', () => {
  it('takes a file through every stage to imported', () => {
    const imported = run(job(), 0, IMPORTED);
    expect(imported.entries[0]?.state).toEqual({ kind: 'imported' });
  });

  it('skips a stage a file does not need, but never goes back', () => {
    const linked = run(job(), 0, [{ kind: 'analyse' }, { kind: 'add' }, { kind: 'imported' }]);
    expect(linked.entries[0]?.state).toEqual({ kind: 'imported' });
    const decoding = run(job(), 0, [{ kind: 'analyse' }, { kind: 'decode', framesTotal: 10 }]);
    expect(expectFailureCode(nextImportJob(decoding, 0, { kind: 'copy', bytesTotal: 10 }))).toBe(
      'import-export.import-step-refused',
    );
    expect(expectFailureCode(nextImportJob(job(), 0, { kind: 'add' }))).toBe(
      'import-export.import-step-refused',
    );
  });

  it.each([
    [
      'progress going back',
      [
        { kind: 'analyse' },
        { kind: 'copy', bytesTotal: 10 },
        { kind: 'copy-progress', bytesCopied: 5 },
      ],
      { kind: 'copy-progress', bytesCopied: 4 },
    ],
    [
      'copied bytes past the file',
      [{ kind: 'analyse' }, { kind: 'copy', bytesTotal: 10 }],
      { kind: 'copy-progress', bytesCopied: 11 },
    ],
    [
      'decoded frames past the stream',
      [{ kind: 'analyse' }, { kind: 'decode', framesTotal: 10 }],
      { kind: 'decode-progress', framesDecoded: 11 },
    ],
    ['an import before adding', [{ kind: 'analyse' }], { kind: 'imported' }],
    ['a second analysis', [{ kind: 'analyse' }], { kind: 'analyse' }],
    ['a refusal of a file imported', IMPORTED, { kind: 'refused', failure: UNREADABLE }],
  ] as const)('refuses %s', (_name, events, event) => {
    expect(expectFailureCode(nextImportJob(run(job(), 0, events), 0, event))).toBe(
      'import-export.import-step-refused',
    );
  });

  it('begins the next file only as the one before it is added, decoding ahead by one', () => {
    const decoding = run(job(), 0, TO_ADDING.slice(0, 4));
    expect(expectFailureCode(nextImportJob(decoding, 1, { kind: 'analyse' }))).toBe(
      'import-export.import-step-refused',
    );
    const adding = run(decoding, 0, TO_ADDING.slice(4));
    const ahead = run(adding, 1, TO_ADDING.slice(0, 5));
    expect(ahead.entries[1]?.state).toEqual({
      kind: 'decoding',
      framesDecoded: 48_000,
      framesTotal: 48_000,
    });
    expect(expectFailureCode(nextImportJob(ahead, 2, { kind: 'analyse' }))).toBe(
      'import-export.import-step-refused',
    );
    expect(expectFailureCode(nextImportJob(ahead, 1, { kind: 'add' }))).toBe(
      'import-export.import-step-refused',
    );
    const second = run(run(ahead, 0, [{ kind: 'imported' }]), 1, [{ kind: 'add' }]);
    expect(second.entries[1]?.state).toEqual({ kind: 'adding' });
  });

  it('goes on past a refused file, keeping its reason', () => {
    const refused = run(job(), 0, [{ kind: 'analyse' }, { kind: 'refused', failure: UNREADABLE }]);
    expect(refused.entries[0]?.state).toEqual({
      kind: 'refused',
      stage: 'analysing',
      failure: UNREADABLE,
    });
    const next = run(refused, 1, IMPORTED);
    expect(importProgress(next)).toEqual({ ended: 2, imported: 1, refused: 1, total: 3 });
  });

  it('cancels the file in progress and every later one, keeping what was imported', () => {
    const middle = run(run(job(), 0, IMPORTED), 1, [
      { kind: 'analyse' },
      { kind: 'copy', bytesTotal: 2_000 },
    ]);
    expect(cancelImport(middle).entries.map((entry) => entry.state)).toEqual([
      { kind: 'imported' },
      { kind: 'cancelled', stage: 'copying' },
      { kind: 'cancelled', stage: 'queued' },
    ]);
    const refused = run(run(job(), 0, [{ kind: 'refused', failure: UNREADABLE }]), 1, [
      { kind: 'analyse' },
    ]);
    expect(cancelImport(refused).entries.map((entry) => entry.state.kind)).toEqual([
      'refused',
      'cancelled',
      'cancelled',
    ]);
  });

  it('refuses a file it does not have', () => {
    expect(expectFailureCode(nextImportJob(job(), 3, { kind: 'analyse' }))).toBe(
      'import-export.import-file-unknown',
    );
  });
});
