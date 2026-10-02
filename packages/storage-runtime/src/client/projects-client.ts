/**
 * Opening a project in the storage worker, as the page asks for it: to write
 * where this window can take its lease, and to read otherwise (REQ-STOR-021,
 * REQ-STOR-098, REQ-STOR-101).
 *
 * The page names each project it opens with a handle it never names again, and
 * hears the project from before the worker is asked, its history in slices and
 * every update after (`remote-opening.ts`). An opening abandoned by its signal
 * stops hearing, and tells the worker to let go of the project should it have
 * opened it all the same.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { OpeningRequest, ProjectRecoveryReport } from '@audiogubbins/storage';

import type { ProjectHandle } from '../protocol/project-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import { heldUnder } from './remote-opening.js';
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
  const asked = { handle, project, access, ...(steal === undefined ? {} : { steal }) };
  const held = await heldUnder(
    channel,
    handle,
    project,
    () => channel.call('projects.open', asked, { signal }),
    signal,
  );
  if (!held.ok) return held;
  const { answer, parts } = held.value;
  const { kind, report } = answer;
  return succeed(
    kind === 'writable'
      ? { kind, report, session: new RemoteProjectSession(parts) }
      : { kind, report, view: new RemoteReadOnlyProject(parts) },
  );
}

/** The projects the page opens, over the page's end of the port. */
export function projectsClient(
  channel: ClientChannel,
  nextHandle: () => ProjectHandle,
): ProjectsClient {
  return {
    open: async (request) => await openUnder(channel, nextHandle(), request),
  };
}

/**
 * The handles the page names the projects it holds by, each new: one counter
 * for every way a project comes to be held, an opening or a restore.
 */
export function handleCounter(): () => ProjectHandle {
  let next: ProjectHandle = 0;
  return () => {
    const handle = next;
    next += 1;
    return handle;
  };
}
