/**
 * Recording an export of the open project in its history, as provenance and
 * never as a change undo could reverse (REQ-STOR-197, REQ-STOR-198).
 *
 * Exporting a bundle, a backup or a folder writes files outside the storage
 * from a state of the project, which is what REQ-STOR-197 records: which state
 * and history node it was taken from, what was written, where the person knew
 * it by, and how it ended, a failure included, so a written file can always be
 * traced to the state that made it. Undo never offers to take a file back,
 * since nothing can reliably do so. Only the window writing the project can
 * record it; an export made where the project is only read is made all the
 * same, and the person is told it is not recorded. The storage worker gives
 * each record its identifier and its time, as it gives every other event of the
 * history.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import {
  ExportStatus,
  type ContentIdentity,
  type ExportDestination,
  type ExportOutput,
} from '@audiogubbins/project-format';
import type { CopyOptions, ExportSource } from '@audiogubbins/storage';
import type { ExportDraft } from '@audiogubbins/storage-runtime';

import type { OpenProjectStore } from './open-project-store.js';

/** Whether an export is kept in its project's history. */
export type RecordedExport =
  /** It is, with the rest of the project's provenance. */
  | 'kept'
  /** This tab only reads the project, so the tab writing it could record it and this one cannot. */
  | 'not-writable'
  /** The history refused it, and why is logged. */
  | 'failed';

/** An export as it describes itself once it has written, or failed to. */
export interface FinishedExport {
  readonly project: ProjectId;
  readonly source: ExportSource;
  readonly output: ExportOutput;
  readonly destination: ExportDestination;

  /** How the writing went, with the identity of the bytes where there was one output. */
  readonly written: DomainResult<ContentIdentity | undefined>;

  /** The write failed after it changed the destination, which holds part of the export. */
  readonly partial?: true;
}

/**
 * The output a copy of a project is: its container, and the scope, the
 * provenance and the caches it holds, with anything else the export says of
 * itself, such as the backup it was taken from.
 */
export function copyOutput(
  container: string,
  options: CopyOptions,
  more: Readonly<Record<string, number>> = {},
): ExportOutput {
  const { scope, includeCaches } = options;
  return {
    container,
    settings: new Map<string, string | number | boolean>([
      ['scope', scope.kind],
      ['provenance', scope.provenance],
      ['caches', includeCaches],
      ...Object.entries(more),
    ]),
  };
}

/** What a partial export's record says of the destination it left. */
const PARTIAL_PROBLEM =
  'Part of the export was written before it stopped, so the destination holds some of it.';

/** Records each export of the open project (see the module comment). */
export class ExportRecorder {
  private readonly logger: Logger;
  private readonly project: OpenProjectStore;

  constructor(logger: Logger, project: OpenProjectStore) {
    this.logger = logger;
    this.project = project;
  }

  /** Keeps the export in its project's history, where this tab writes the project. */
  readonly record = async (finished: FinishedExport): Promise<RecordedExport> => {
    const session = this.project.session();
    if (session?.project !== finished.project) return 'not-writable';
    const { written, source } = finished;
    const output = written.ok ? written.value : undefined;

    // A backup's state may be at a node the history no longer holds, and a
    // node is named only where the history can show the export on it.
    const { history } = session.getSnapshot().model;
    const draft: ExportDraft = {
      stateFingerprint: source.state,
      ...(history.nodes.has(source.node) ? { historyNodeId: source.node } : {}),
      engineVersions: new Map(),
      output: finished.output,
      destination: finished.destination,
      ...(output === undefined ? {} : { outputContentId: output.contentId }),
      status: written.ok
        ? ExportStatus.Succeeded
        : finished.partial === true
          ? ExportStatus.Partial
          : ExportStatus.Failed,
      problems: written.ok
        ? []
        : [
            ...written.failures.map((failure) => failure.summary),
            ...(finished.partial === true ? [PARTIAL_PROBLEM] : []),
          ],
    };
    const kept = await session.recordExport(draft);
    if (kept.ok) return 'kept';
    this.logger.warning('An export could not be recorded in its history.', {
      code: kept.failures[0].code,
    });
    return 'failed';
  };
}
