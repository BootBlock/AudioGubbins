/**
 * Writing a project's tree as a portable bundle: a ZIP archive of exactly the
 * tree's files and a manifest of each one's path, length and content identity
 * (REQ-STOR-099, REQ-STOR-103, REQ-EXEC-216).
 *
 * The entries are written in the order of their paths, the manifest among them,
 * each streamed from wherever it is kept and never held whole, so one tree
 * always gives the same archive, byte for byte, and a bundle unpacked and
 * packed again is the bundle it was. A metadata file's identity in the manifest
 * is taken from its bytes; a media file's or a cache's is the one the tree
 * names for it, and its bytes are proved to be those as they are written into
 * the archive (`tree-bodies.ts`), so each is read and hashed once.
 */

import {
  FailureKind,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  BUNDLE_MANIFEST_PATH,
  compareCodeUnits,
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
  const entries = await manifestEntries(files, writing);
  if (!entries.ok) {
    await sink.abort(entries.failures[0]);
    return entries;
  }
  const listing = writeBundleManifest(entries.value);
  if (!listing.ok) {
    await sink.abort(listing.failures[0]);
    return listing;
  }
  const manifest: ProjectTreeFile = {
    path: BUNDLE_MANIFEST_PATH,
    body: { kind: 'text', bytes: listing.value },
  };
  const ordered = [...files, manifest].sort((one, other) => compareCodeUnits(one.path, other.path));
  // A file that cannot be opened, or is refused as it is read, as the archive
  // reaches it fails the archive, which abandons the sink, with its failure.
  return await refusalsReported(
    async () =>
      await writeZip(zipEntries(ordered, writing), sink, {
        yieldToHost: writing.yieldToHost,
        ...(writing.signal === undefined ? {} : { signal: writing.signal }),
      }),
  );
}

/** Each file opened only as the archive reaches it. */
async function* zipEntries(
  files: readonly ProjectTreeFile[],
  writing: BundleWriting,
): AsyncGenerator<ZipEntryInput, void, undefined> {
  for (const file of files) {
    const { path, body } = file;
    if (body.kind === 'text') {
      yield { path, source: body.bytes };
      continue;
    }
    const source = await writing.open(file, writing.signal);
    if (!source.ok) throw new CarriedFailure(source.failures[0]);
    if (source.value.size !== body.byteLength) throw new CarriedFailure(lengthChanged(path));
    yield { path, source: source.value };
  }
}

/** The manifest's entry for each file. */
async function manifestEntries(
  files: readonly ProjectTreeFile[],
  writing: BundleWriting,
): Promise<DomainResult<readonly ManifestEntry[]>> {
  const entries: ManifestEntry[] = [];
  for (const { path, body } of files) {
    if (body.kind !== 'text') {
      entries.push({ path, size: body.byteLength, contentId: body.contentId });
      continue;
    }
    const identity = await contentIdOf(
      bytesSource(body.bytes),
      writing.digest,
      writing.signal === undefined ? {} : { signal: writing.signal },
    );
    if (!identity.ok) return identity;
    const { contentId, byteLength } = identity.value;
    entries.push({ path, size: byteLength, contentId });
  }
  return succeed(entries);
}

function lengthChanged(path: string): DomainFailure {
  return failure(
    'storage.file-changed',
    FailureKind.Conflict,
    'A file changed length while the bundle was written.',
    { details: { file: path } },
  );
}
