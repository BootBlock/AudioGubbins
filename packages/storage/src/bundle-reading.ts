/**
 * Opening a portable bundle to read the project it holds: its manifest first,
 * then every entry held to it (REQ-STOR-052, REQ-STOR-099, REQ-EXEC-136.12).
 *
 * The manifest is read before anything else, so a bundle of another schema is
 * refused with the version it was found to be before its project is looked at.
 * Then the archive must hold exactly what the manifest lists, each entry of the
 * length listed; an entry the manifest does not list, or one it lists that is
 * missing, refuses the bundle. Every entry is checked against its content
 * identity before its bytes are given to anyone: a metadata file as it is read,
 * and a media file or a cache by hashing it as it streams, before the caller
 * streams it again, so nothing from a bundle is ever kept that is not what the
 * bundle says. Nothing is held whole but a metadata file.
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
  LONGEST_MANIFEST,
  contentIdOf,
  openZip,
  readBundleManifest,
  readVerified,
  type ByteSource,
  type Digest,
  type ManifestEntry,
  type ProjectTreeListing,
  type ZipEntry,
} from '@audiogubbins/project-format';

import type { BodyOpener } from './bundle-writing.js';
import { bytesSource } from './byte-streams.js';

/** A bundle opened and held to its manifest. */
interface OpenedBundle {
  /** The project's tree, each metadata file checked as it is read. */
  readonly listing: ProjectTreeListing;

  /** A media file or a cache, checked against its identity before it is given. */
  readonly open: BodyOpener;
}

/** Opens a bundle (see the module comment). */
export async function openBundle(
  source: ByteSource,
  digest: Digest,
  signal?: AbortSignal,
): Promise<DomainResult<OpenedBundle>> {
  const archive = await openZip(source, signal === undefined ? {} : { signal });
  if (!archive.ok) return archive;
  const entries = new Map(archive.value.entries.map((entry) => [entry.path, entry]));
  const manifestEntry = entries.get(BUNDLE_MANIFEST_PATH);
  if (manifestEntry === undefined) return fail(bundleProblem('bundle.no-manifest'));
  if (manifestEntry.size > LONGEST_MANIFEST)
    return fail(bundleProblem('bundle.manifest-too-large'));
  const manifestBytes = await wholeEntry(manifestEntry, signal);
  if (!manifestBytes.ok) return manifestBytes;
  const manifest = readBundleManifest(manifestBytes.value);
  if (!manifest.ok) return manifest;

  const listed = new Map(manifest.value.entries.map((entry) => [entry.path, entry]));
  const problems = [...entries.keys()].flatMap((path) => {
    if (path === BUNDLE_MANIFEST_PATH) return [];
    const expected = listed.get(path);
    if (expected === undefined) return [bundleProblem('bundle.unlisted-entry', path)];
    return expected.size === entries.get(path)?.size
      ? []
      : [bundleProblem('bundle.length-mismatch', path)];
  });
  for (const path of listed.keys()) {
    if (!entries.has(path)) problems.push(bundleProblem('bundle.missing-entry', path));
  }
  const [first, ...rest] = problems;
  if (first !== undefined) return fail(first, ...rest);

  const checked = new CheckedEntries(entries, listed, digest);
  return succeed({
    listing: {
      files: manifest.value.entries.map(({ path, size }) => ({ path, size })),
      read: async (path, readSignal) => await checked.read(path, readSignal),
    },
    open: async ({ path }, openSignal) => await checked.open(path, openSignal),
  });
}

/** A bundle's entries, each given only once it is proved the entry its manifest lists. */
class CheckedEntries {
  private readonly entries: ReadonlyMap<string, ZipEntry>;
  private readonly listed: ReadonlyMap<string, ManifestEntry>;
  private readonly digest: Digest;

  constructor(
    entries: ReadonlyMap<string, ZipEntry>,
    listed: ReadonlyMap<string, ManifestEntry>,
    digest: Digest,
  ) {
    this.entries = entries;
    this.listed = listed;
    this.digest = digest;
  }

  /** A metadata file's bytes, checked. */
  async read(path: string, signal?: AbortSignal): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
    const entry = this.entries.get(path);
    if (entry === undefined) return fail(bundleProblem('bundle.missing-entry', path));
    const bytes = await wholeEntry(entry, signal);
    if (!bytes.ok) return bytes;
    const proved = await this.prove(path, bytesSource(bytes.value), signal);
    return proved.ok ? succeed(bytes.value) : proved;
  }

  /** A file's bytes to stream, once they are hashed and found to be the ones listed. */
  async open(path: string, signal?: AbortSignal): Promise<DomainResult<ByteSource>> {
    const entry = this.entries.get(path);
    if (entry === undefined) return fail(bundleProblem('bundle.missing-entry', path));
    const opened = await entry.open(signal);
    if (!opened.ok) return opened;
    const proved = await this.prove(path, opened.value, signal);
    return proved.ok ? opened : proved;
  }

  private async prove(
    path: string,
    source: ByteSource,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    const identity = await contentIdOf(source, this.digest, signal === undefined ? {} : { signal });
    if (!identity.ok) return identity;
    return identity.value.contentId === this.listed.get(path)?.contentId
      ? succeed(undefined)
      : fail(bundleProblem('bundle.entry-damaged', path));
  }
}

/** An entry's bytes whole, checked against its CRC-32: only for a metadata file. */
async function wholeEntry(
  entry: ZipEntry,
  signal?: AbortSignal,
): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
  const bytes = new Uint8Array(entry.size);
  let at = 0;
  const read = await readVerified(
    entry,
    (chunk) => {
      bytes.set(chunk, at);
      at += chunk.length;
      return Promise.resolve();
    },
    signal === undefined ? {} : { signal },
  );
  return read.ok ? succeed(bytes) : read;
}

const SUMMARIES: ReadonlyMap<string, string> = new Map([
  ['bundle.no-manifest', 'The archive has no manifest, so it is not a bundle this build reads.'],
  ['bundle.manifest-too-large', 'The manifest is longer than any bundle’s may be.'],
  ['bundle.unlisted-entry', 'The archive holds an entry its manifest does not list.'],
  ['bundle.missing-entry', 'The archive lacks an entry its manifest lists.'],
  ['bundle.length-mismatch', 'An entry is not the length its manifest lists.'],
  ['bundle.entry-damaged', 'An entry is not the content its manifest lists.'],
]);

function bundleProblem(code: string, path?: string): DomainFailure {
  return failure(code, FailureKind.IntegrityViolation, SUMMARIES.get(code) ?? code, {
    ...(path === undefined ? {} : { details: { entry: path } }),
  });
}
