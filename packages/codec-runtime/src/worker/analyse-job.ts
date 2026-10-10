/**
 * An `analyse` request (ADR-0090): a file recognised, routed and, where it is
 * decoded, described from the codec module's description of its stream, with
 * its metadata, before anything is stored. Nothing is decoded; the session
 * opened to describe the stream is released before the answer.
 */

import type { CancellationSignal } from '@audiogubbins/domain';

import { asyncAudioBytes } from '../files/async-file-bytes.js';
import { openFileSource, type FileSource } from '../files/file-source.js';
import type { FileReaderSyncLike } from '../files/sync-file-bytes.js';
import type { ImportAnalysis } from './codec-worker-messages.js';
import { openImport, readMetadata, type ImportServices } from './import-opening.js';
import type { JobEnd } from './job-end.js';

/**
 * Analyses the file `source` names, answering the analysis, or the failure of
 * a file that could not be read. Reading may reject with the signal's reason,
 * or with `SourceUnreadable`.
 */
export async function runAnalysis(
  source: FileSource,
  reader: FileReaderSyncLike,
  services: ImportServices,
  signal: CancellationSignal,
): Promise<JobEnd> {
  const file = await openFileSource(source, reader);
  if (!file.ok) return { kind: 'failed', failure: file.failures[0] };
  try {
    const bytes = asyncAudioBytes(file.value.bytes);
    const opened = await openImport(file.value.bytes, bytes, services, signal);
    let analysis: ImportAnalysis;
    switch (opened.kind) {
      case 'refused':
        analysis = opened;
        break;
      case 'read-in-place':
        analysis = { ...opened, metadata: await readMetadata(opened.container, bytes, signal) };
        break;
      case 'decode': {
        const { session, stream, decoder } = opened.opened;
        session.release();
        analysis = {
          kind: 'decode',
          stream,
          decoder,
          metadata: await readMetadata(stream.container, bytes, signal),
        };
        break;
      }
    }
    return { kind: 'analysed', analysis };
  } finally {
    file.value.close();
  }
}
