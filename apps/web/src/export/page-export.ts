/**
 * The page's export made over the project system's storage (ADR-0092), with
 * what the composition root gives it: what renders and encodes the audio, the
 * assets it renders, the room the storage estimate leaves, and the time.
 * Where projects cannot be kept there is no export, since an export is staged
 * in their storage and recorded in a project's history.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { ExportClock } from '@audiogubbins/import-export';

import type { ExportStorage } from '../state/project-system.js';
import { PageExportControl, type ExportControlParts } from './export-control.js';
import type { ExportControl } from './export-types.js';

/** What the composition root gives the export beside the project system's storage. */
export type ExportNeeds = Pick<
  ExportControlParts,
  'runner' | 'codecs' | 'assets' | 'room' | 'clock'
>;

/** The page's export over `storage`, or none where projects cannot be kept. */
export function startExport(
  storage: ExportStorage | undefined,
  needs: ExportNeeds,
): ExportControl | undefined {
  if (storage === undefined) return undefined;
  const { destinations } = storage;
  return new PageExportControl({
    ...needs,
    exports: storage.exports,
    trusted: storage.trusted,
    allowWriting: destinations.allowWriting,
    download: destinations.download,
    digest: storage.digest,
  });
}

/** The moment `milliseconds` on the page's clock, with this machine's offset from UTC then. */
export function exportClockAt(milliseconds: number): ExportClock {
  return {
    epochMilliseconds: milliseconds,
    utcOffsetMinutes: -new Date(milliseconds).getTimezoneOffset(),
  };
}

/**
 * The bytes the storage has free, from the browser's estimate where it gives
 * both its figures, or nothing where it gives none or refuses, as one may in
 * a context it does not trust: an export then goes ahead, and the storage
 * refuses what it cannot hold.
 */
export async function storageRoom(
  estimate: (() => Promise<StorageEstimate>) | undefined,
  logger: Logger,
): Promise<number | undefined> {
  if (estimate === undefined) return undefined;
  try {
    const { quota, usage } = await estimate();
    return quota === undefined || usage === undefined ? undefined : Math.max(0, quota - usage);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    logger.info('The storage estimate could not be read.', { reason: error.message });
    return undefined;
  }
}
