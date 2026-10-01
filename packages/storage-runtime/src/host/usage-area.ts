/**
 * What the stored projects take, and the cleanup that frees it, served to the
 * page (REQ-STOR-102, REQ-STOR-106, REQ-STOR-200, REQ-STOR-027).
 *
 * The projects open in the worker are measured as they are now, not only as
 * they were last written, since their newest changes may be in the journal
 * alone. A cleanup is planned at the worker's own time, and carried out only
 * as it was planned and confirmed, which the storage checks again, through the
 * session the page holds for the project it has open; giving the caches up
 * under pressure touches nothing else.
 */

import {
  measureUsage,
  planCleanup,
  relieveStoragePressure,
  runCleanup,
} from '@audiogubbins/storage';

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';

/** The usage and cleanup operations, over the worker's services and its open projects. */
export function usageHandlers(
  services: HostServices,
  projects: OpenProjects,
): AreaHandlers<'usage'> {
  return {
    'usage.measure': (_nothing, { signal }) => measureUsage(services, projects.states(), signal),
    'usage.planCleanup': (selection, { signal }) =>
      planCleanup(selection, services, services.clock.now(), signal),
    'usage.runCleanup': ({ plan, confirmation, held }, { signal }) =>
      runCleanup(plan, confirmation, services, {
        signal,
        ...(held === undefined ? {} : { held: projects.session(held) }),
      }),
    'usage.relievePressure': (_nothing, { signal }) =>
      relieveStoragePressure(services.caches, Number.POSITIVE_INFINITY, signal),
  };
}
