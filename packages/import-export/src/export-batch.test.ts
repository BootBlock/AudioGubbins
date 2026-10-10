import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  batchProgress,
  cancelExportBatch,
  exportBatch,
  nextExportBatch,
  nextJobToStart,
  rememberCollisionAnswer,
  type ExportBatch,
} from './export-batch.js';
import { plannedExport, type ExportJobEvent } from './export-job.js';

const STAGED = { bytes: 10, hash: 'ab'.repeat(32), reproducible: true } as const;
const DENIED = failure('storage.collision', FailureKind.Conflict, 'The name is taken.');

function batch(): ExportBatch {
  return exportBatch([plannedExport('a', 100), plannedExport('b', 200), plannedExport('c', 300)]);
}

function staged(frames: number): readonly ExportJobEvent[] {
  return [
    { kind: 'render-started' },
    { kind: 'progress', framesRendered: frames, bytesStaged: 10 },
    { kind: 'render-finished' },
    { kind: 'staged', staged: STAGED },
  ];
}

const DELIVERED: readonly ExportJobEvent[] = [
  { kind: 'delivery-started', target: { kind: 'folder', name: 'x.wav' } },
  { kind: 'delivery-progress', bytesDelivered: 10 },
  { kind: 'delivered' },
];

function run(current: ExportBatch, id: string, events: readonly ExportJobEvent[]): ExportBatch {
  return events.reduce((next, event) => expectSuccess(nextExportBatch(next, id, event)), current);
}

describe('a batch export', () => {
  it('runs its jobs one at a time, in order', () => {
    const started = batch();
    expect(nextJobToStart(started)?.id).toBe('a');
    expect(expectFailureCode(nextExportBatch(started, 'b', { kind: 'render-started' }))).toBe(
      'import-export.export-batch-busy',
    );
    const first = run(started, 'a', [{ kind: 'render-started' }]);
    expect(nextJobToStart(first)).toBeUndefined();
    const done = run(first, 'a', [...staged(100).slice(1), ...DELIVERED]);
    expect(nextJobToStart(done)?.id).toBe('b');
  });

  it('holds the batch while a job asks about a collision, and not once its delivery is refused', () => {
    const asking = run(batch(), 'a', staged(100));
    expect(nextJobToStart(asking)).toBeUndefined();
    const refused = run(asking, 'a', [
      { kind: 'delivery-started', target: { kind: 'folder', name: 'x.wav' } },
      { kind: 'delivery-refused', failure: DENIED },
    ]);
    expect(nextJobToStart(refused)?.id).toBe('b');
  });

  it('goes on past a failed job', () => {
    const failed = run(batch(), 'a', [
      { kind: 'render-started' },
      { kind: 'failed', failure: DENIED },
    ]);
    expect(nextJobToStart(failed)?.id).toBe('b');
  });

  it('remembers an answer only when the person applies it to the rest', () => {
    expect(rememberCollisionAnswer(batch(), 'skip', false).remembered).toBeUndefined();
    expect(rememberCollisionAnswer(batch(), 'skip', true).remembered).toBe('skip');
  });

  it('cancels every job not yet ended, and leaves the delivered ones', () => {
    const middle = run(run(batch(), 'a', [...staged(100), ...DELIVERED]), 'b', [
      { kind: 'render-started' },
    ]);
    expect(cancelExportBatch(middle).jobs.map((job) => job.state)).toEqual([
      { kind: 'delivered', staged: STAGED, target: { kind: 'folder', name: 'x.wav' } },
      { kind: 'cancelled', stage: 'rendering' },
      { kind: 'cancelled', stage: 'planned' },
    ]);
  });

  it('reports the progress of the whole', () => {
    const middle = run(run(batch(), 'a', [...staged(100), ...DELIVERED]), 'b', [
      { kind: 'render-started' },
      { kind: 'progress', framesRendered: 50, bytesStaged: 1 },
    ]);
    expect(batchProgress(middle)).toEqual({
      jobsSettled: 1,
      jobsTotal: 3,
      framesRendered: 150,
      framesTotal: 600,
    });
  });

  it('refuses a job it does not have', () => {
    expect(expectFailureCode(nextExportBatch(batch(), 'z', { kind: 'cancel' }))).toBe(
      'import-export.export-job-unknown',
    );
  });
});
