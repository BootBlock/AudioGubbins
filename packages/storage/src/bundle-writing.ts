/**
 * Writing a project's tree as a portable bundle: a ZIP archive of exactly the
 * tree's files and a manifest of each one's path, length and content identity
 * (REQ-STOR-099, REQ-STOR-103, REQ-EXEC-216).
 *
 * The tree's files are written in the order of their paths, each made or
 * streamed only as the archive reaches it and never held past it, so a tree of
 * a history larger than memory is written holding one file and one kept state
 * at a time. The manifest goes last, once every entry it lists is written: a
 * metadata file's identity is taken from its bytes as they pass, and a media
 * file's or a cache's is the one the tree names for it, its bytes proved to be
 * those as they are written (`tree-bodies.ts`), so each is read and hashed
 * once. One tree always gives the same archive, byte for byte, and a bundle
 * unpacked and packed again is the bundle it was. A reader finds the manifest
 * by the archive's directory, wherever it lies.
 */

import { FailureKind, failure, type DomainFailure, type DomainResult } from '@audiogubbins/domain';
import {
  BUNDLE_MANIFEST_PATH,
  contentIdOf,
  writeBundleManifest,
  writeZip,
  type ByteSink,
  type Digest,
  type ManifestEntry,
  type ProjectTreeFile,
  type YieldToHost,
  type ZipEntryInput,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { CarriedFailure, refusalsReported } from './storage-failures.js';
import type { BodyOpener } from './tree-bodies.js';

/** How a bundle is written. */
interface BundleWriting {
  /** Each media file and cache, proved against what the tree names as it is read. */
  readonly open: BodyOpener;
  readonly digest: Digest;

  /** Asked as the archive is written, whose chunks may be read and checksummed at once. */
  readonly yieldToHost: YieldToHost;
  readonly signal?: AbortSignal;
}

/** Writes a tree's files and their manifest as a bundle into `sink`, and closes it. */
export async function writeBundle(
  files: readonly ProjectTreeFile[],
  sink: ByteSink,
  writing: BundleWriting,
): Promise<DomainResult<ZipWritten>> {
  // A file that cannot be made or opened, or is refused as it is read, as the
  // archive reaches it fails the archive, which abandons the sink, with its
  // failure.
  return await refusalsReported(
    async () =>
      await writeZip(entriesOf(files, writing), sink, {
        yieldToHost: writing.yieldToHost,
        ...(writing.signal === undefined ? {} : { signal: writing.signal }),
      }),
  );
}

/** Each file made or opened only as the archive reaches it, and then the manifest of them all. */
async function* entriesOf(
  files: readonly ProjectTreeFile[],
  writing: BundleWriting,
): AsyncGenerator<ZipEntryInput, void, undefined> {
  const { signal } = writing;
  const listed: ManifestEntry[] = [];
  for (const file of files) {
    const { path, body } = file;
    if (body.kind === 'text') {
      const text = await body.text(signal);
      if (!text.ok) throw new CarriedFailure(text.failures[0]);
      if (text.value === undefined) continue;
      const identity = await contentIdOf(
        bytesSource(text.value),
        writing.digest,
        signal === undefined ? {} : { signal },
      );
      if (!identity.ok) throw new CarriedFailure(identity.failures[0]);
      listed.push({ path, size: text.value.length, contentId: identity.value.contentId });
      yield { path, source: text.value };
      continue;
    }
    const source = await writing.open(file, signal);
    if (!source.ok) throw new CarriedFailure(source.failures[0]);
    if (source.value.size !== body.byteLength) throw new CarriedFailure(lengthChanged(path));
    listed.push({ path, size: body.byteLength, contentId: body.contentId });
    yield { path, source: source.value };
  }
  const manifest = writeBundleManifest(listed);
  if (!manifest.ok) throw new CarriedFailure(manifest.failures[0]);
  yield { path: BUNDLE_MANIFEST_PATH, source: manifest.value };
}

function lengthChanged(path: string): DomainFailure {
  return failure(
    'storage.file-changed',
    FailureKind.Conflict,
    'A file changed length while the bundle was written.',
    { details: { file: path } },
  );
}
