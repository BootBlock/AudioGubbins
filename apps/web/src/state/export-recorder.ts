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
 * same, and the person is told it is not recorded.
 */

import type { Clock, Logger } from '@audiogubbins/diagnostics';
import type { DomainResult, IdGenerator, ProjectId } from '@audiogubbins/domain';
import {
  ExportStatus,
  ProvenanceLevel,
  type ContentIdentity,
  type ExportDestination,
  type ExportOutput,
  type ExportRecord,
} from '@audiogubbins/project-format';
import type { CopyOptions, ExportSource } from '@audiogubbins/storage';

import type { OpenProjectStore } from './open-project-store.js';

/** Whether an export is kept in its project's history. */
export type RecordedExport =
  /** It is, with the rest of the project's provenance. */
  | 'kept'
  /** This tab only reads the project, so the tab writing it could record it and this one cannot. */
  | 'not-writable'
  /** The history refused it, and why is logged. */
  | 'failed';

/** An export as it describes itself, before it is given its identity and its time. */
export interface ExportDraft {
  readonly project: ProjectId;
  readonly source: ExportSource;
  readonly output: ExportOutput;
  readonly destination: ExportDestination;

  /** How the writing went, with the identity of the bytes where there was one output. */
  readonly written: DomainResult<ContentIdentity | undefined>;
}

/** What recording an export works with, each made once by the composition root. */
export interface RecorderServices {
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
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
      ['provenance', scope.kind === 'current-state' ? scope.provenance : ProvenanceLevel.Full],
      ['caches', includeCaches],
      ...Object.entries(more),
    ]),
  };
}

/** Records each export of the open project (see the module comment). */
export class ExportRecorder {
  private readonly services: RecorderServices;
  private readonly project: OpenProjectStore;

  constructor(services: RecorderServices, project: OpenProjectStore) {
    this.services = services;
    this.project = project;
  }

  /** Keeps the export in its project's history, where this tab writes the project. */
  readonly record = async (draft: ExportDraft): Promise<RecordedExport> => {
    const session = this.project.session();
    if (session?.project !== draft.project) return 'not-writable';
    const { written, source } = draft;
    const output = written.ok ? written.value : undefined;

    // A backup's state may be at a node the history no longer holds, and a
    // node is named only where the history can show the export on it.
    const { history } = session.getSnapshot().model;
    const record: ExportRecord = {
      id: this.services.ids.next<'ExportRecordId'>(),
      at: this.services.clock.now(),
      stateFingerprint: source.state,
      ...(history.nodes.has(source.node) ? { historyNodeId: source.node } : {}),
      engineVersions: new Map(),
      output: draft.output,
      destination: draft.destination,
      ...(output === undefined ? {} : { outputContentId: output.contentId }),
      status: written.ok ? ExportStatus.Succeeded : ExportStatus.Failed,
      problems: written.ok ? [] : written.failures.map((failure) => failure.summary),
    };
    const kept = await session.recordExport(record);
    if (kept.ok) return 'kept';
    this.services.logger.warning('An export could not be recorded in its history.', {
      code: kept.failures[0].code,
    });
    return 'failed';
  };
}
