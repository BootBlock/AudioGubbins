/**
 * What the stored projects take, and the cleanup that frees it, served to the
 * page (REQ-STOR-102, REQ-STOR-106, REQ-STOR-200, REQ-STOR-027).
 *
 * The projects open are measured as the page gives them, not only as they were
 * last written. A cleanup is planned at the worker's own time, and carried out
 * only as it was planned and confirmed, which the storage checks again; giving
 * the caches up under pressure touches nothing else.
 */

import {
  measureUsage,
  planCleanup,
  relieveStoragePressure,
  runCleanup,
} from '@audiogubbins/storage';

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/** The usage and cleanup operations, over the worker's services. */
export function usageHandlers(services: HostServices): AreaHandlers<'usage'> {
  return {
    'usage.measure': ({ live }, { signal }) => measureUsage(services, live, signal),
    'usage.planCleanup': (selection, { signal }) =>
      planCleanup(selection, services, services.clock.now(), signal),
    'usage.runCleanup': ({ plan, confirmation }, { signal }) =>
      runCleanup(plan, confirmation, services, { signal }),
    'usage.relievePressure': (_nothing, { signal }) =>
      relieveStoragePressure(services.caches, Number.POSITIVE_INFINITY, signal),
  };
}
