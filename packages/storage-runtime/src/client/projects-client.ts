/**
 * Opening a project in the storage worker, as the page asks for it: to write
 * where this window can take its lease, and to read otherwise (REQ-STOR-021,
 * REQ-STOR-098, REQ-STOR-101).
 *
 * The page names each project it opens with a handle it never names again, and
 * hears the project's stream from before the worker is asked, so no update the
 * worker sends once it holds the project is missed; one that arrives before
 * the answer waits for the copy the answer makes. An opening abandoned by its
 * signal stops hearing, and tells the worker to let go of the project should
 * it have opened it all the same.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { OpeningRequest, ProjectRecoveryReport } from '@audiogubbins/storage';

import {
  projectStream,
  type ProjectHandle,
  type ProjectOpening,
  type ProjectUpdate,
} from '../protocol/project-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import { ProjectMirror } from './project-mirror.js';
import { RemoteProjectSession, RemoteReadOnlyProject } from './remote-project.js';

/** A project opened in the worker, and what recovery found on the way. */
export type RemoteOpenedProject =
  | {
      readonly kind: 'writable';
      readonly session: RemoteProjectSession;
      readonly report: ProjectRecoveryReport;
    }
  | {
      readonly kind: 'read-only';
      readonly view: RemoteReadOnlyProject;
      readonly report: ProjectRecoveryReport;
    };

/** The projects the page opens. */
export interface ProjectsClient {
  /** Opens a project, as `openProject` does in the worker. */
  open(request: OpeningRequest): Promise<DomainResult<RemoteOpenedProject>>;
}

/** Opens a project under `handle` (see the module comment). */
async function openUnder(
  channel: ClientChannel,
  handle: ProjectHandle,
  request: OpeningRequest,
): Promise<DomainResult<RemoteOpenedProject>> {
  const { project, access, steal, signal } = request;
  const early: ProjectUpdate[] = [];
  let hear = (update: ProjectUpdate): void => {
    early.push(update);
  };
  const stopHearing = channel.listen(projectStream(handle), (update) => {
    hear(update);
  });
  let opening: DomainResult<ProjectOpening> | undefined;
  try {
    const asked = { handle, project, access, ...(steal === undefined ? {} : { steal }) };
    opening = await channel.call('projects.open', asked, { signal });
  } finally {
    if (opening?.ok !== true) stopHearing();
    if (opening === undefined && signal?.aborted === true) {
      await channel.call('projects.abandon', { handle });
    }
  }
  if (!opening.ok) return opening;

  const { kind, report, first } = opening.value;
  const mirror = new ProjectMirror(project, first);
  for (const update of early) mirror.apply(update);
  hear = (update) => {
    mirror.apply(update);
  };
  const parts = { channel, handle, mirror, stopHearing };
  return succeed(
    kind === 'writable'
      ? { kind, report, session: new RemoteProjectSession(parts) }
      : { kind, report, view: new RemoteReadOnlyProject(parts) },
  );
}

/** The projects the page opens, over the page's end of the port. */
export function projectsClient(channel: ClientChannel): ProjectsClient {
  let next: ProjectHandle = 0;
  return {
    open: async (request) => {
      const handle = next;
      next += 1;
      return await openUnder(channel, handle, request);
    },
  };
}
