/**
 * One file imported outside a batch, as a test of the import's stages drives
 * them: prepared, then added, the two steps a batch takes for each of its files
 * (`import-batch.ts`), with every event the file reports told to `observe`.
 */

import type { DomainResult } from '@audiogubbins/domain';

import { addPrepared, prepareImport } from '../audio-import.js';
import type {
  AudioImport,
  AudioImportServices,
  ImportObserver,
  ImportedAudio,
} from '../import-contracts.js';
import type { ProjectSession } from '../project-session.js';

/** Imports `request.file` into the session's project, as a batch imports each of its files. */
export async function importAudio(
  session: ProjectSession,
  request: AudioImport,
  services: AudioImportServices,
  observe: ImportObserver = () => undefined,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedAudio>> {
  const prepared = await prepareImport(session, request, services, observe, signal);
  if (!prepared.ok) return prepared;
  observe({ kind: 'add' });
  return await addPrepared(session, prepared.value, services.commands);
}
