/**
 * The projects the page opens, served to it: opening one to write or to read,
 * closing it, and asking for a project another window writes (REQ-STOR-021,
 * REQ-STOR-098, REQ-STOR-101).
 *
 * A project opens under the handle the page named, as `openProject` opens it
 * with the worker's services. An opening the page abandoned is let go rather
 * than held, whether the worker hears so while it opens or only after it
 * answered, when the page says so by abandoning the handle; either way no
 * project stays open, holding its lease, that no page can reach. A session is
 * released once it closes, which it refuses while anything is unsaved; a view
 * always closes.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { succeed } from '@audiogubbins/domain';
import { openProject, type OpenedProject } from '@audiogubbins/storage';

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { sessionHandlers } from './session-area.js';

/** Closes a project nothing will reach, which has nothing unsaved, being just opened. */
async function letGo(opened: OpenedProject, logger: Logger): Promise<void> {
  if (opened.kind === 'read-only') {
    opened.view.close();
    return;
  }
  const closed = await opened.session.close();
  if (!closed.ok) {
    logger.warning('A project whose opening was abandoned could not be closed.', {
      code: closed.failures[0].code,
    });
  }
}

/** The operations of the projects the page opens, over the worker's services. */
export function projectHandlers(
  services: HostServices,
  projects: OpenProjects,
): AreaHandlers<'projects'> {
  return {
    'projects.open': async ({ handle, project, access, steal }, { signal }) => {
      const opened = await openProject(
        { project, access, signal, ...(steal === undefined ? {} : { steal }) },
        services,
      );
      if (!opened.ok) return opened;
      if (signal.aborted) {
        await letGo(opened.value, services.logger);
        signal.throwIfAborted();
      }
      const { kind, report } = opened.value;
      return succeed({ kind, report, first: projects.hold(handle, opened.value) });
    },
    'projects.abandon': async ({ handle }) => {
      const opened = projects.find(handle);
      projects.release(handle);
      if (opened !== undefined) await letGo(opened, services.logger);
      return undefined;
    },
    'projects.close': async ({ handle }) => {
      const closed = await projects.session(handle).close();
      if (closed.ok) projects.release(handle);
      return closed;
    },
    'projects.closeView': ({ handle }) => {
      projects.view(handle).close();
      projects.release(handle);
      return Promise.resolve(undefined);
    },
    'projects.requestTransfer': ({ handle }, { signal }) =>
      projects.view(handle).requestTransfer(signal),
    ...sessionHandlers(services, projects),
  };
}
