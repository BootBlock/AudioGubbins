/**
 * The manifest of a portable bundle, `manifest.json`: the format and schema of
 * the bundle, and every other entry's path, length and content identity
 * (REQ-STOR-099, REQ-STOR-052, REQ-EXEC-136.12).
 *
 * A bundle is a ZIP archive of exactly a project's unpacked tree and this
 * manifest, so converting between the two loses nothing. The manifest says what
 * the archive must hold: an entry it does not list, or one of another length,
 * refuses the bundle, and each entry's bytes are checked against its content
 * identity as they are read, which proves far more than the archive's CRC-32. A
 * manifest of another `portableBundle` schema version is refused with the
 * version it was found to be: before 1.0 nothing migrates.
 */

import { flatMapResult, type DomainResult } from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { compareCodeUnits, prettyCanonicalJson, type JsonObject } from './canonical-json.js';
import { readCompatibleHeader } from './compatibility.js';
import type { ContentId } from './content-identity.js';
import {
  listConverter,
  objectOf,
  pathOf,
  required,
  startReading,
  type Converter,
} from './document-reading.js';
import { parseJson } from './json-parsing.js';
import { asContentId, integerConverter, textConverter } from './scalar-reading.js';
import { isTreePath } from './storage-tree.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/** Where a bundle keeps its manifest. */
export const BUNDLE_MANIFEST_PATH = 'manifest.json';

/** The format name a bundle's manifest carries. */
const BUNDLE_MANIFEST_FORMAT = 'audiogubbins.bundle-manifest';

/** One entry of a bundle, as its manifest lists it. */
export interface ManifestEntry {
  readonly path: string;
  readonly size: number;
  readonly contentId: ContentId;
}

/** A bundle's manifest: its entries, sorted by path. */
export interface BundleManifest {
  readonly entries: readonly ManifestEntry[];
}

const MANIFEST_MEMBERS: ReadonlySet<string> = new Set(['format', 'schemaVersion', 'entries']);
const ENTRY_MEMBERS: ReadonlySet<string> = new Set(['path', 'size', 'contentId']);

/** The most entries a manifest lists, as many as a ZIP archive is read with. */
const MAXIMUM_ENTRIES = 1_000_000;

const asText = textConverter({ maximumLength: 4_096 });

const asPath: Converter<string> = (reading, value, parent, key) => {
  const path = asText(reading, value, parent, key);
  if (path === undefined) return undefined;
  if (isTreePath(path) && path !== '' && path !== BUNDLE_MANIFEST_PATH) return path;
  reading.refuse(
    'manifest.bad-path',
    'A manifest entry is a path of the tree.',
    pathOf(parent, key),
  );
  return undefined;
};

const asSize = integerConverter(0, Number.MAX_SAFE_INTEGER);

const asEntry: Converter<ManifestEntry> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, ENTRY_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const path = required(reading, object, at, 'path', asPath);
  const size = required(reading, object, at, 'size', asSize);
  const contentId = required(reading, object, at, 'contentId', asContentId);
  return path === undefined || size === undefined || contentId === undefined
    ? undefined
    : { path, size, contentId };
};

const asEntries = listConverter(MAXIMUM_ENTRIES, asEntry);

/** The text of a manifest listing `entries`. Throws where two share a path. */
export function writeBundleManifest(entries: readonly ManifestEntry[]): Uint8Array<ArrayBuffer> {
  const sorted = [...entries].sort((one, other) => compareCodeUnits(one.path, other.path));
  sorted.forEach((entry, index) => {
    if (sorted[index + 1]?.path === entry.path) {
      throw new Error(`A manifest lists ${entry.path} twice.`);
    }
  });
  const manifest: JsonObject = {
    format: BUNDLE_MANIFEST_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.portableBundle,
    entries: sorted.map(({ path, size, contentId }) => ({ path, size, contentId })),
  };
  return encodeUtf8(prettyCanonicalJson(manifest));
}

/** The manifest the bytes hold, refusing one of another schema first. */
export function readBundleManifest(bytes: Uint8Array): DomainResult<BundleManifest> {
  return flatMapResult(
    flatMapResult(decodeUtf8(bytes), (text) =>
      parseJson(text, { maximumLength: 2 ** 28, maximumDepth: 8 }),
    ),
    (value) => {
      const header = readCompatibleHeader(value, BUNDLE_MANIFEST_FORMAT, 'portableBundle');
      if (!header.ok) return header;
      const reading = startReading();
      const object = objectOf(reading, value, '', '', MANIFEST_MEMBERS);
      const entries =
        object === undefined ? undefined : required(reading, object, '', 'entries', asEntries);
      if (entries !== undefined) {
        const paths = new Set(entries.map(({ path }) => path));
        if (paths.size !== entries.length) {
          reading.refuse('manifest.duplicate-path', 'A manifest lists a path twice.', 'entries');
        }
      }
      return reading.outcome(entries === undefined ? undefined : { entries });
    },
  );
}
