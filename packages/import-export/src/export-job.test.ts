import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  nextExportJob,
  plannedExport,
  type DeliveryTarget,
  type ExportJob,
  type ExportJobEvent,
  type StagedFile,
} from './export-job.js';

const STAGED: StagedFile = { bytes: 4_000, hash: 'ab'.repeat(32), reproducible: true };
const TARGET: DeliveryTarget = { kind: 'folder', name: 'Slam.wav' };
const DENIED = failure(
  'storage.permission-denied',
  FailureKind.Retryable,
  'Permission was taken back.',
);
const BROKEN = failure('codec.encoder-failed', FailureKind.Unrecoverable, 'The encoder failed.');

function run(job: ExportJob, events: readonly ExportJobEvent[]): ExportJob {
  return events.reduce((current, event) => expectSuccess(nextExportJob(current, event)), job);
}

const TO_STAGED: readonly ExportJobEvent[] = [
  { kind: 'render-started' },
  { kind: 'progress', framesRendered: 500, bytesStaged: 1_000 },
  { kind: 'progress', framesRendered: 1_000, bytesStaged: 2_000 },
  { kind: 'render-finished' },
  { kind: 'staged', staged: STAGED },
];

const TO_DELIVERING: readonly ExportJobEvent[] = [
  ...TO_STAGED,
  { kind: 'delivery-started', target: TARGET },
];

function job(): ExportJob {
  return plannedExport('export-1', 1_000);
}

describe('an export job', () => {
  it('runs from planned to delivered, with its progress', () => {
    const rendering = run(job(), TO_STAGED.slice(0, 2));
    expect(rendering.state).toEqual({ kind: 'rendering', framesRendered: 500, bytesStaged: 1_000 });
    const delivered = run(job(), [
      ...TO_DELIVERING,
      { kind: 'delivery-progress', bytesDelivered: 1_500 },
      { kind: 'delivery-progress', bytesDelivered: 4_000 },
      { kind: 'delivered' },
    ]);
    expect(delivered.state).toEqual({ kind: 'delivered', staged: STAGED, target: TARGET });
  });

  it('returns to staged with the reason when a delivery is refused, and delivers again without rendering', () => {
    const refused = run(job(), [...TO_DELIVERING, { kind: 'delivery-refused', failure: DENIED }]);
    expect(refused.state).toEqual({ kind: 'staged', staged: STAGED, refused: DENIED });
    const elsewhere: DeliveryTarget = { kind: 'download', name: 'Slam.wav' };
    const retried = run(refused, [
      { kind: 'delivery-started', target: elsewhere },
      { kind: 'delivery-progress', bytesDelivered: 4_000 },
      { kind: 'delivered' },
    ]);
    expect(retried.state).toEqual({ kind: 'delivered', staged: STAGED, target: elsewhere });
  });

  it.each([
    ['planned', []],
    ['rendering', TO_STAGED.slice(0, 1)],
    ['encoding', TO_STAGED.slice(0, 4)],
    ['staged', TO_STAGED],
    ['delivering', TO_DELIVERING],
  ] as const)('fails or is cancelled from %s', (stage, events) => {
    const reached = run(job(), events);
    expect(reached.state.kind).toBe(stage);
    expect(run(reached, [{ kind: 'failed', failure: BROKEN }]).state).toEqual({
      kind: 'failed',
      stage,
      failure: BROKEN,
    });
    expect(run(reached, [{ kind: 'cancel' }]).state).toEqual({ kind: 'cancelled', stage });
  });

  it('refuses every step once it has ended', () => {
    const delivered = run(job(), [
      ...TO_DELIVERING,
      { kind: 'delivery-progress', bytesDelivered: 4_000 },
      { kind: 'delivered' },
    ]);
    const cancelled = run(job(), [{ kind: 'cancel' }]);
    const failed = run(job(), [{ kind: 'failed', failure: BROKEN }]);
    for (const ended of [delivered, cancelled, failed]) {
      for (const event of [
        { kind: 'cancel' },
        { kind: 'failed', failure: BROKEN },
        { kind: 'render-started' },
        { kind: 'delivery-started', target: TARGET },
      ] as const) {
        expect(expectFailureCode(nextExportJob(ended, event))).toBe(
          'import-export.export-step-refused',
        );
      }
    }
  });

  it.each([
    ['a second render', TO_STAGED.slice(0, 1), { kind: 'render-started' }],
    ['progress before rendering', [], { kind: 'progress', framesRendered: 1, bytesStaged: 0 }],
    [
      'frames going back',
      TO_STAGED.slice(0, 2),
      { kind: 'progress', framesRendered: 499, bytesStaged: 1_000 },
    ],
    [
      'frames past the total',
      TO_STAGED.slice(0, 1),
      { kind: 'progress', framesRendered: 1_001, bytesStaged: 0 },
    ],
    [
      'staged bytes shrinking',
      TO_STAGED.slice(0, 2),
      { kind: 'progress', framesRendered: 600, bytesStaged: 999 },
    ],
    ['a render finishing short', TO_STAGED.slice(0, 2), { kind: 'render-finished' }],
    [
      'staging before the render finishes',
      TO_STAGED.slice(0, 3),
      { kind: 'staged', staged: STAGED },
    ],
    [
      'a staged file smaller than its staged bytes',
      TO_STAGED.slice(0, 4),
      { kind: 'staged', staged: { ...STAGED, bytes: 1_999 } },
    ],
    [
      'delivery before staging',
      TO_STAGED.slice(0, 4),
      { kind: 'delivery-started', target: TARGET },
    ],
    ['a second delivery at once', TO_DELIVERING, { kind: 'delivery-started', target: TARGET }],
    [
      'delivered bytes past the file',
      TO_DELIVERING,
      { kind: 'delivery-progress', bytesDelivered: 4_001 },
    ],
    ['a delivery finished short', TO_DELIVERING, { kind: 'delivered' }],
    [
      'a refusal with nothing being delivered',
      TO_STAGED,
      { kind: 'delivery-refused', failure: DENIED },
    ],
  ] as const)('refuses %s', (_name, events, event) => {
    expect(expectFailureCode(nextExportJob(run(job(), events), event))).toBe(
      'import-export.export-step-refused',
    );
  });
});
