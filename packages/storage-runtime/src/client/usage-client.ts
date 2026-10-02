/**
 * What the stored projects take, and the cleanup that frees it, as the page
 * asks the storage worker for them (REQ-STOR-102, REQ-STOR-106, REQ-STOR-200,
 * REQ-STOR-027).
 */

import type { DomainResult } from '@audiogubbins/domain';
import type {
  CleanupConfirmation,
  CleanupPlan,
  CleanupSelection,
  PressureRelief,
  StepOutcome,
  StorageUsage,
} from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';
import type { RemoteProjectSession } from './remote-project.js';

/** How a cleanup is carried out: through the session the page holds, and until when. */
export interface CleanupRunOptions {
  /**
   * The project open to write here, cleaned through its own session, whose
   * lease any other way in would find held, by this very window.
   */
  readonly held?: RemoteProjectSession;
  readonly signal?: AbortSignal;
}

/** The storage's usage, and its cleanup. */
export interface UsageClient {
  /** Measures the storage, the projects open taken as they are now. */
  measure(signal?: AbortSignal): Promise<DomainResult<StorageUsage>>;

  /** Plans a cleanup of what was chosen, removing nothing. */
  planCleanup(
    selection: CleanupSelection,
    signal?: AbortSignal,
  ): Promise<DomainResult<CleanupPlan>>;

  /**
   * Carries a plan out, with the bytes the person confirmed where any step
   * reaches past the caches.
   */
  runCleanup(
    plan: CleanupPlan,
    confirmation: CleanupConfirmation | undefined,
    options?: CleanupRunOptions,
  ): Promise<DomainResult<readonly StepOutcome[]>>;

  /** Gives every cache up, in the order storage pressure gives them up, and nothing else. */
  relievePressure(signal?: AbortSignal): Promise<DomainResult<PressureRelief>>;
}

/** The usage and cleanup, over the page's end of the port. */
export function usageClient(channel: ClientChannel): UsageClient {
  return {
    measure: (signal) => channel.call('usage.measure', undefined, { signal }),
    planCleanup: (selection, signal) => channel.call('usage.planCleanup', selection, { signal }),
    runCleanup: (plan, confirmation, { held, signal } = {}) =>
      channel.call(
        'usage.runCleanup',
        {
          plan,
          ...(confirmation === undefined ? {} : { confirmation }),
          ...(held === undefined ? {} : { held: held.handle }),
        },
        { signal },
      ),
    relievePressure: (signal) => channel.call('usage.relievePressure', undefined, { signal }),
  };
}
