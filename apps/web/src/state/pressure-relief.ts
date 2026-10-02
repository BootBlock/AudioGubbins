/**
 * Making room when the storage is full while the open project is being saved,
 * by giving up what is made again and nothing else (REQ-STOR-106,
 * REQ-STOR-027).
 *
 * When a write is refused because the storage is full, the caches are given up
 * in the order they go under pressure, and the writes waiting are tried again.
 * Nothing that cannot be made again is touched without the person: where the
 * caches free nothing, the project stays unsaved, the status bar says why, and
 * the Storage panel offers the rest. Each refusal is answered once, so a
 * storage full of the project itself is not emptied of caches in a loop.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { UsageClient } from '@audiogubbins/storage-runtime';

import { isAbandoned } from './abandoning.js';
import type { OpenProjectStore } from './open-project-store.js';

/** The failure a write refused for want of room is reported as. */
const FULL = 'storage.full';

/**
 * Gives up caches through `usage` and tries again whenever the open project's
 * saving is refused as full, the relief given up once its project is let go.
 */
export function relieveWhenFull(
  project: OpenProjectStore,
  usage: UsageClient,
  logger: Logger,
): () => void {
  let answered = false;
  return project.subscribe(() => {
    const session = project.session();
    const save = session?.getSnapshot().save;
    const full = save?.kind === 'not-saved' && save.cause.code === FULL;
    if (!full) {
      answered = false;
      return;
    }
    if (answered || session === undefined) return;
    answered = true;
    usage
      .relievePressure(project.scope())
      .then(async (relief) => {
        if (!relief.ok) {
          logger.warning('Caches could not be given up to make room.', {
            code: relief.failures[0].code,
          });
          return;
        }
        if (relief.value.total > 0) await session.retry();
      })
      .catch((error: unknown) => {
        if (isAbandoned(error)) return;
        logger.error('Making room in the storage failed.', {
          reason: error instanceof Error ? error.message : 'unknown',
        });
      });
  });
}
