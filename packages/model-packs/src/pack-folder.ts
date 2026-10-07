/**
 * A pack version a person already has, read from the folder its build wrote
 * (ADR-0062): the folder's `manifest.json`, through the one manifest reader,
 * and each file the manifest names, by its path inside the folder, served to
 * the installer as an `ImportedPackSource`.
 *
 * Nothing is believed of the folder but what the manifest reader admits: the
 * manifest's text is bounded before it is read, and a file the manifest names
 * that the folder does not hold refuses the import before a byte is kept. The
 * files are opened, never read, here; the installer reads them as it reads a
 * download, and checks every one against its length and SHA-256.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { decodeUtf8, type ByteSource } from '@audiogubbins/project-format';

import { ImportedPackSource } from './imported-pack-source.js';
import type { ModelPackManifest } from './manifest.js';
import { MANIFEST_LIMITS, readModelPackManifest } from './manifest-reading.js';

/** The file a pack version's folder keeps its manifest in, as the pack build writes it. */
const PACK_MANIFEST_FILE = 'manifest.json';

/**
 * The most bytes a manifest's text may take: its bound in UTF-16 code units,
 * each of which UTF-8 writes in three bytes at most.
 */
const MOST_MANIFEST_BYTES = MANIFEST_LIMITS.maximumLength * 3;

/** A folder the person chose, as far as an import reads it: a file by its path inside. */
export interface PackFolder {
  /** The file at `path` inside the folder, or nothing where it holds none. */
  open(path: string): Promise<ByteSource | undefined>;
}

/** A pack version read from a folder: its manifest, and the source its files are read from. */
export interface ImportedPack {
  readonly manifest: ModelPackManifest;
  readonly source: ImportedPackSource;
}

function refused(code: string, summary: string, file: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary, { details: { file } }));
}

/** The text of the folder's manifest, or why it cannot be read. */
async function manifestText(
  folder: PackFolder,
  signal?: AbortSignal,
): Promise<DomainResult<string>> {
  const source = await folder.open(PACK_MANIFEST_FILE);
  if (source === undefined) {
    return refused(
      'model-pack.import-manifest-missing',
      `The folder chosen holds no ${PACK_MANIFEST_FILE}, so it is not a model pack's folder.`,
      PACK_MANIFEST_FILE,
    );
  }
  if (source.size > MOST_MANIFEST_BYTES) {
    return refused(
      'model-pack.import-manifest-too-long',
      `The folder's ${PACK_MANIFEST_FILE} is longer than a manifest may be.`,
      PACK_MANIFEST_FILE,
    );
  }
  const bytes = await source.read(0, source.size, signal);
  // A file that changed or went as it was read comes back short (`ByteSource`).
  if (bytes.length !== source.size) {
    return refused(
      'model-pack.import-manifest-changed',
      `The folder's ${PACK_MANIFEST_FILE} changed while it was read.`,
      PACK_MANIFEST_FILE,
    );
  }
  return decodeUtf8(bytes);
}

/**
 * The pack version `folder` holds, as its manifest and the source its files are
 * read from, or every reason it is not one.
 */
export async function readPackFolder(
  folder: PackFolder,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedPack>> {
  const text = await manifestText(folder, signal);
  if (!text.ok) return text;
  const manifest = readModelPackManifest(text.value);
  if (!manifest.ok) return manifest;
  const files = new Map<string, ByteSource>();
  for (const file of manifest.value.files) {
    const source = await folder.open(file.path);
    if (source === undefined) {
      return refused(
        'model-pack.import-file-missing',
        `The folder chosen holds no ${file.path}, which ${manifest.value.name} ${manifest.value.version} needs.`,
        file.path,
      );
    }
    files.set(file.path, source);
  }
  return succeed({
    manifest: manifest.value,
    source: new ImportedPackSource(manifest.value, files),
  });
}
