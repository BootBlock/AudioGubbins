import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { failure, FailureKind } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  exportBatch,
  nextExportBatch,
  plannedExport,
  type ExportBatch,
  type ExportJobEvent,
  type PlannedFile,
} from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { ExportRunState } from '../../export/export-types.js';
import { observable } from '../../state/observable.js';
import { shownRun } from '../../testing/export-states.js';
import { renderInTheShell } from '../../testing/in-the-shell.js';
import { ExportProgress } from './export-progress.js';

const FRAMES = 48_000;

/** A batch of two files after `events` of the first. */
function batchAfter(events: readonly ExportJobEvent[]): ExportBatch {
  let batch = exportBatch([plannedExport('export-1', FRAMES), plannedExport('export-2', FRAMES)]);
  for (const event of events) batch = expectSuccess(nextExportBatch(batch, 'export-1', event));
  return batch;
}

/** The files of the batch, as far as the surface reads them: their names. */
function namedFiles(): ReadonlyMap<string, PlannedFile> {
  const named = (stem: string): PlannedFile =>
    ({ name: { stem, extension: 'wav' } }) as PlannedFile;
  return new Map([
    ['export-1', named('Waves')],
    ['export-2', named('Gulls')],
  ]);
}

function progressOver(state: ExportRunState) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  renderInTheShell(<ExportProgress exports={observable(state)} run={run} />);
  return { run };
}

describe('the export under way (ADR-0092)', () => {
  it('shows how far the batch has got, each file where it is, and offers to cancel', async () => {
    const user = userEvent.setup();
    const { run } = progressOver({
      kind: 'running',
      ...shownRun(
        batchAfter([
          { kind: 'render-started' },
          { kind: 'progress', framesRendered: FRAMES / 2, bytesStaged: 10 },
        ]),
        namedFiles(),
      ),
      asking: undefined,
    });
    const dialog = screen.getByRole('dialog', { name: 'Exporting' });

    expect(within(dialog).getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute(
      'value',
      String(FRAMES / 2),
    );
    const files = within(dialog).getByRole('list', { name: 'Files being exported' });
    expect(
      within(files)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Waves.wav Rendering, 50%', 'Gulls.wav Waiting']);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the export' }));
    expect(run).toHaveBeenCalledWith(ExportCommand.Cancel);
  });

  it('offers a held file its retry and another destination, saying why it waits', async () => {
    const user = userEvent.setup();
    const refused = failure(
      'export.permission-needed',
      FailureKind.Rejected,
      'Leave was taken back.',
    );
    const { run } = progressOver({
      kind: 'held',
      ...shownRun(
        batchAfter([
          { kind: 'render-started' },
          { kind: 'progress', framesRendered: FRAMES, bytesStaged: 10 },
          { kind: 'render-finished' },
          { kind: 'staged', staged: { bytes: 10, hash: 'ab', reproducible: true } },
          { kind: 'delivery-started', target: { kind: 'folder', name: 'Waves.wav' } },
          { kind: 'delivery-refused', failure: refused },
        ]),
        namedFiles(),
      ),
    });
    const waiting = screen.getByRole('group', { name: 'What to do with Waves.wav' });

    expect(screen.getByText(/Not delivered: Leave was taken back\./u)).toBeInTheDocument();
    await user.click(within(waiting).getByRole('button', { name: 'Retry' }));
    await user.click(within(waiting).getByRole('button', { name: 'Deliver into a folder…' }));
    expect(run.mock.calls).toEqual([
      [ExportCommand.Retry, { job: 'export-1' }],
      [ExportCommand.DeliverElsewhere, { job: 'export-1', to: 'folder' }],
    ]);
  });

  it('is shut while the collision prompt asks, and once the export has ended', () => {
    progressOver({ kind: 'ended', ...shownRun(batchAfter([]), namedFiles()), said: 'Done.' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
