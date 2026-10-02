/**
 * Writing a project's tree as a portable bundle: a ZIP archive of exactly the
 * tree's files and a manifest of each one's path, length and content identity
 * (REQ-STOR-099, REQ-STOR-103, REQ-EXEC-216).
 *
 * The entries are written in the order of their paths, the manifest among them,
 * each streamed from wherever it is kept and never held whole, so one tree
 * always gives the same archive, byte for byte, and a bundle unpacked and
 * packed again is the bundle it was. Every identity in the manifest is taken
 * from the bytes, but for media the store keeps, whose identity the store
 * proved when it kept it; media from anywhere else is hashed and must be the
 * media its name says.
 */

import {
  FailureKind,
  fail,
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
  type ByteSource,
  type Digest,
  type ManifestEntry,
  type ProjectTreeFile,
  type YieldToHost,
  type ZipEntryInput,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { refusalsReported } from './storage-failures.js';

/** How the bytes of a media file or a cache of a tree are read. */
export type BodyOpener = (
  file: ProjectTreeFile,
  signal?: AbortSignal,
) => Promise<DomainResult<ByteSource>>;

/** How a bundle is written. */
interface BundleWriting {
  readonly open: BodyOpener;
  readonly digest: Digest;

  /** Whether media is hashed to prove it, where it does not come from the store. */
  readonly proveMedia: boolean;

  /** Asked as the archive is written, whose chunks may be read and checksummed at once. */
  readonly yieldToHost: YieldToHost;
  readonly signal?: AbortSignal;
}

/** A failure met while the archive is written, carried out of its entries. */
class EntryRefused extends Error {
  readonly failure: DomainFailure;

  constructor(refusal: DomainFailure) {
    super(refusal.summary);
    this.name = 'EntryRefused';
    this.failure = refusal;
  }
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
  try {
    return await refusalsReported(
      async () =>
        await writeZip(zipEntries(ordered, writing), sink, {
          yieldToHost: writing.yieldToHost,
          ...(writing.signal === undefined ? {} : { signal: writing.signal }),
        }),
    );
  } catch (error: unknown) {
    // A file that could not be opened as the archive reached it: the archive
    // has abandoned the sink, and the failure is the file's own.
    if (error instanceof EntryRefused) return fail(error.failure);
    throw error;
  }
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
    if (!source.ok) throw new EntryRefused(source.failures[0]);
    if (source.value.size !== body.byteLength) throw new EntryRefused(lengthChanged(path));
    yield { path, source: source.value };
  }
}

/** The manifest's entry for each file. */
async function manifestEntries(
  files: readonly ProjectTreeFile[],
  writing: BundleWriting,
): Promise<DomainResult<readonly ManifestEntry[]>> {
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const { path, body } = file;
    if (body.kind === 'media' && !writing.proveMedia) {
      entries.push({ path, size: body.byteLength, contentId: body.contentId });
      continue;
    }
    const source =
      body.kind === 'text'
        ? succeed(bytesSource(body.bytes))
        : await writing.open(file, writing.signal);
    if (!source.ok) return source;
    const identity = await contentIdOf(
      source.value,
      writing.digest,
      writing.signal === undefined ? {} : { signal: writing.signal },
    );
    if (!identity.ok) return identity;
    const { contentId, byteLength } = identity.value;
    if (body.kind === 'media' && contentId !== body.contentId) return fail(mediaDamaged(path));
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

function mediaDamaged(path: string): DomainFailure {
  return failure(
    'storage.media-damaged',
    FailureKind.IntegrityViolation,
    'A media file is not the media its name says it is.',
    { details: { file: path } },
  );
}
