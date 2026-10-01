/**
 * The files linked assets were recorded from, as the page asks the storage
 * worker to look at them again (REQ-STOR-104, REQ-STOR-053).
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';

import type { LendingCall, PageFile } from './page-ports.js';

/** Looking at linked files again. */
export interface SourcesClient {
  /**
   * The identity of `file` now, as `examineFile` gives it against `recorded`:
   * read, sampled and, where `recorded` knows the content, hashed whole in the
   * worker.
   */
  examine(
    recorded: ExternalSourceIdentity,
    file: PageFile,
    signal?: AbortSignal,
  ): Promise<DomainResult<ExternalSourceIdentity>>;
}

/** Looking at linked files again, over calls that lend the page's ports. */
export function sourcesClient(call: LendingCall): SourcesClient {
  return {
    examine: (recorded, file, signal) =>
      call('sources.examine', (lend) => ({ recorded, file: lend.file(file) }), signal),
  };
}
