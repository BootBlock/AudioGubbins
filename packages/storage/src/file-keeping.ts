/**
 * Keeping the file an import brings in as the person chose (REQ-STOR-025):
 * copied into the media store or linked where it lies, through the media
 * store's own pipeline, with the copy's progress reported as it is made.
 */

import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import { importMedia, type ImportServices, type ImportedMedia } from '@audiogubbins/media-store';
import type { AssetSource, KeptMetadata, SourceAudioShape } from '@audiogubbins/project-format';

import { keepsCopy } from './import-analysis.js';
import type { AudioImport, ImportObserver } from './import-contracts.js';

/**
 * Keeps the file itself as the person chose, copied or linked, reporting the
 * copy's progress where it is copied, with `audio` recorded in its provenance.
 */
export async function keepFile(
  request: Pick<AudioImport, 'file' | 'choice' | 'importedAt'>,
  projectId: ProjectId,
  services: ImportServices,
  observe: ImportObserver,
  recorded: { readonly audio?: SourceAudioShape },
  signal?: AbortSignal,
): Promise<DomainResult<ImportedMedia>> {
  const copying = keepsCopy(request.choice);
  const bytesTotal = request.file.source.size;
  if (copying) observe({ kind: 'copy', bytesTotal });
  let copied = 0;
  return await importMedia(
    {
      file: request.file,
      choice: request.choice,
      projectId,
      importedAt: request.importedAt,
      ...recorded,
    },
    services,
    {
      ...(signal === undefined ? {} : { signal }),
      // The bytes read from the file as they are received into the store,
      // which is the copy the person waits for; the store's own second pass
      // copies what it already holds.
      onProgress: (progress) => {
        if (!copying || progress.stage !== 'receiving' || progress.done <= copied) return;
        copied = Math.min(progress.done, bytesTotal);
        observe({ kind: 'copy-progress', bytesCopied: copied });
      },
    },
  );
}

/** The source with the file's metadata in its provenance, where it states any. */
export function withFileMetadata(source: AssetSource, metadata: KeptMetadata): AssetSource {
  return Object.keys(metadata).length === 0 || source.provenance === undefined
    ? source
    : { ...source, provenance: { ...source.provenance, metadata } };
}
