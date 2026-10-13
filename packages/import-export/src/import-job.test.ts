import { describe, expect, it } from 'vitest';

import type { RecognisedFormat } from '@audiogubbins/codecs';
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

const FLAC: RecognisedFormat = {
  kind: 'audio',
  container: 'flac',
  codec: { kind: 'named', codec: 'flac' },
};

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
      'decoded frames going back',
      [
        { kind: 'analyse' },
        { kind: 'decode', framesTotal: 10 },
        { kind: 'decode-progress', framesDecoded: 6 },
      ],
      { kind: 'decode-progress', framesDecoded: 5 },
    ],
    ['an import before adding', [{ kind: 'analyse' }], { kind: 'imported' }],
    ['a second analysis', [{ kind: 'analyse' }], { kind: 'analyse' }],
    ['a refusal of a file imported', IMPORTED, { kind: 'refused', failure: UNREADABLE }],
  ] as const)('refuses %s', (_name, events, event) => {
    expect(expectFailureCode(nextImportJob(run(job(), 0, events), 0, event))).toBe(
      'import-export.import-step-refused',
    );
  });

  it('decodes a stream past the length it states, or one that states none', () => {
    const stated = run(job(), 0, [
      { kind: 'analyse' },
      { kind: 'decode', framesTotal: 10 },
      { kind: 'decode-progress', framesDecoded: 11 },
    ]);
    expect(stated.entries[0]?.state).toEqual({
      kind: 'decoding',
      framesDecoded: 11,
      framesTotal: 10,
    });
    const unstated = run(job(), 0, [
      { kind: 'analyse' },
      { kind: 'decode', framesTotal: undefined },
      { kind: 'decode-progress', framesDecoded: 4_800 },
    ]);
    expect(unstated.entries[0]?.state).toEqual({
      kind: 'decoding',
      framesDecoded: 4_800,
      framesTotal: undefined,
    });
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

  it('keeps the format the analysis recognised on the entry, whatever the file comes to', () => {
    const recognised = run(job(), 0, [{ kind: 'analyse' }, { kind: 'recognised', format: FLAC }]);
    expect(recognised.entries[0]).toEqual({
      file: { name: 'a.flac', bytes: 1_000 },
      state: { kind: 'analysing' },
      format: FLAC,
    });
    const refused = run(recognised, 0, [{ kind: 'refused', failure: UNREADABLE }]);
    expect(refused.entries[0]?.format).toEqual(FLAC);
    expect(cancelImport(run(recognised, 0, TO_ADDING.slice(1))).entries[0]?.format).toEqual(FLAC);
  });

  it.each([
    ['before the file is analysed', []],
    ['a second time', [{ kind: 'analyse' }, { kind: 'recognised', format: FLAC }]],
    ['once the file is decoding', [{ kind: 'analyse' }, { kind: 'decode', framesTotal: 10 }]],
  ] as const)('refuses a format recognised %s', (_name, events) => {
    expect(
      expectFailureCode(
        nextImportJob(run(job(), 0, events), 0, { kind: 'recognised', format: FLAC }),
      ),
    ).toBe('import-export.import-step-refused');
  });

  it('keeps the storage a file needs on its entry, known or not, whatever the file comes to', () => {
    const known = run(job(), 0, [
      { kind: 'analyse' },
      { kind: 'room', needed: { kind: 'known', bytes: 2_000 } },
    ]);
    expect(known.entries[0]).toEqual({
      file: { name: 'a.flac', bytes: 1_000 },
      state: { kind: 'analysing' },
      room: { kind: 'known', bytes: 2_000 },
    });
    const refused = run(known, 0, [{ kind: 'refused', failure: UNREADABLE }]);
    expect(refused.entries[0]?.room).toEqual({ kind: 'known', bytes: 2_000 });
    const unknown = run(job(), 0, [
      { kind: 'analyse' },
      { kind: 'room', needed: { kind: 'unknown', atLeast: 1_000 } },
      ...IMPORTED.slice(1),
    ]);
    expect(unknown.entries[0]?.room).toEqual({ kind: 'unknown', atLeast: 1_000 });
  });

  it.each([
    ['before the file is analysed', []],
    ['a second time', [{ kind: 'analyse' }, { kind: 'room', needed: { kind: 'known', bytes: 1 } }]],
    ['once the file is copied', [{ kind: 'analyse' }, { kind: 'copy', bytesTotal: 10 }]],
  ] as const)('refuses the storage a file needs stated %s', (_name, events) => {
    expect(
      expectFailureCode(
        nextImportJob(run(job(), 0, events), 0, {
          kind: 'room',
          needed: { kind: 'known', bytes: 1 },
        }),
      ),
    ).toBe('import-export.import-step-refused');
  });

  it('refuses a file it does not have', () => {
    expect(expectFailureCode(nextImportJob(job(), 3, { kind: 'analyse' }))).toBe(
      'import-export.import-file-unknown',
    );
  });
});
