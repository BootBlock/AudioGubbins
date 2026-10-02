/**
 * Forking a project from a state in its history or from a named snapshot: a new
 * project of its own that begins where the other was (REQ-STOR-199,
 * REQ-STOR-193, REQ-STOR-194).
 *
 * The source is read as a read-only window reads it, so forking never changes
 * it, and needs no lease on it. The fork has its own identity, journal, history
 * and header: its history begins at an origin that records the project, the
 * node it was taken from and the fingerprint of the state it began as there
 * (REQ-STOR-194), and its export log begins empty, so no export recipe is
 * linked to the source's. Media is shared by content, as the store shares it
 * between every project, so no audio is copied. The state is reached as a move
 * to the node would reach it, from the snapshot's kept state where the fork is
 * of a snapshot.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  Turns,
  givenName,
  readProjectDocument,
  writeProjectDocument,
  type Digest,
  type HistoryNodeId,
  type ProjectState,
  type SnapshotId,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { stateAt } from './history-moves.js';
import { readProjectCopy, type ProjectCopy } from './project-copy.js';
import { writeNewProject } from './project-creation.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import { stateOf } from './project-identity.js';
import type { RecoveryServices } from './project-recovery.js';
import { NO_SUCH_NODE } from './session-failures.js';
import { refusalsReported } from './storage-failures.js';
import type { LeaseCoordinator } from './write-lease.js';

/** Where in its source a fork begins. */
export type ForkPoint =
  | { readonly kind: 'node'; readonly node: HistoryNodeId }
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotId };

/** A fork to make. */
export interface ForkRequest {
  readonly source: ProjectId;
  readonly from: ForkPoint;

  /** The fork's name. */
  readonly name: string;
}

/** What forking works with, each made once by the composition root. */
export interface ForkServices extends RecoveryServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
}

/** Makes a fork (see the module comment), and gives its header. */
export async function forkProject(
  request: ForkRequest,
  services: ForkServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const name = givenName('project', request.name);
  if (!name.ok) return name;
  const records = new CheckedRecords(services.tree, services.digest);
  const source = new ProjectFiles(records, request.source);
  const copy = await readProjectCopy(source, services, signal);
  if (!copy.ok) return copy;
  const reached = await stateFrom(copy.value, request.from, services, signal);
  if (!reached.ok) return reached;
  const sourceState = await source.states.fingerprint(reached.value.state);

  const project = services.ids.next<'ProjectId'>();
  const forked = stateOf(reached.value.state, project);
  const state = { ...forked, project: { ...forked.project, displayName: name.value } };
  // The document reader is the one authority on what a project may hold, so a
  // name it would refuse is refused here before anything is written.
  const readable = readProjectDocument(writeProjectDocument(state));
  if (!readable.ok) return readable;
  return await refusalsReported(
    async () =>
      await writeNewProject(
        new ProjectFiles(records, project),
        {
          state,
          origin: {
            kind: 'fork',
            project: request.source,
            node: reached.value.node,
            stateFingerprint: sourceState,
          },
          at: services.clock.now(),
        },
        {
          ids: services.ids,
          turns: new Turns(services.yieldToHost, signal),
          coordinator: services.coordinator,
        },
      ),
  );
}

/** The state at the fork's point, and the node it is at. */
async function stateFrom(
  copy: ProjectCopy,
  from: ForkPoint,
  services: ForkServices,
  signal?: AbortSignal,
): Promise<DomainResult<{ readonly state: ProjectState; readonly node: HistoryNodeId }>> {
  const { history, state } = copy.model;
  if (from.kind === 'snapshot') {
    const snapshot = history.snapshots.get(from.snapshot);
    if (snapshot === undefined) {
      return fail(
        failure('storage.no-such-snapshot', FailureKind.Rejected, 'There is no such snapshot.', {
          details: { snapshot: from.snapshot },
        }),
      );
    }
    const kept = await copy.states.load(snapshot.stateFingerprint, signal);
    if (kept.ok) return succeed({ state: kept.value, node: snapshot.node });
    services.logger.warning('A snapshot’s kept state could not be read, so a fork replays to it.', {
      code: kept.failures[0].code,
    });
    return await stateFrom(copy, { kind: 'node', node: snapshot.node }, services, signal);
  }
  if (!history.nodes.has(from.node)) return fail(NO_SUCH_NODE);
  const reached = await stateAt(
    history,
    state,
    from.node,
    {
      bus: services.bus,
      logger: services.logger,
      states: copy.states,
    },
    signal,
  );
  return reached.ok ? succeed({ state: reached.value, node: from.node }) : reached;
}
