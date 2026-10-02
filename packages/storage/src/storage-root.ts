/**
 * The storage root: the one file that says which schema the whole storage was
 * written with, and the pre-1.0 flow for storage of any other (REQ-STOR-052).
 *
 * Storage holds data of two schemas, which move independently: its own records,
 * whose envelope names `projectStorage`, and the project documents inside the
 * states they keep, `projectDocument`. The root records the version of each, so
 * storage written with another version of either is found at the root and shown
 * on the compatibility screen, rather than failing project by project.
 *
 * Opening the root initialises an empty storage, accepts one of this build's
 * schema, and otherwise reports what it found and changes nothing: the
 * interface shows the blocking compatibility screen, where the person may
 * export the raw data (`raw-export.ts`), cancel and leave every byte as it is,
 * or confirm a wipe. Wiping removes everything and initialises the current
 * schema. Nothing here migrates.
 *
 * The root is written before anything else on initialising and removed last on
 * wiping, so a crash part-way through either leaves a storage that opens as it
 * did before: empty, or still of the old schema.
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import { PRODUCT_VERSION, SCHEMA_VERSIONS } from '@audiogubbins/version';
import {
  compatibilityOf,
  integerConverter,
  objectOf,
  pathOf,
  required,
  textConverter,
  type Converter,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords, RecordKind, type RecordFault } from './checked-records.js';
import { refusalsReported } from './storage-failures.js';
import { STORAGE_ROOT_FILE } from './storage-layout.js';

/** The schemas storage holds data of, each recorded at the root. */
export type StoredSchema = 'projectStorage' | 'projectDocument';

/** What opening the storage root found. */
export type StorageRootOpening =
  /** The storage was empty, and has been initialised with this build's schema. */
  | { readonly kind: 'fresh' }
  /** The storage is of this build's schema. */
  | { readonly kind: 'current' }
  /** The storage holds `schema` of another version, which before 1.0 cannot be read. */
  | {
      readonly kind: 'incompatible';
      readonly schema: StoredSchema;
      readonly found: number;
      readonly current: number;
    }
  /** The storage holds data but no readable root: its schema cannot be told. */
  | { readonly kind: 'unreadable'; readonly fault: RecordFault | { readonly kind: 'missing' } };

/**
 * The person's confirmation of a wipe: what they were shown the storage holds.
 * A confirmation of anything else is of another storage, and is refused.
 */
export type WipeConfirmation =
  | { readonly kind: 'incompatible'; readonly schema: StoredSchema; readonly found: number }
  | { readonly kind: 'unreadable' };

/**
 * The root's body: the product version that initialised the storage, and the
 * version of the project documents it holds.
 */
interface RootBody {
  readonly writtenBy: string;
  readonly projectDocument: number;
}

const ROOT_MEMBERS: ReadonlySet<string> = new Set(['writtenBy', 'schemas']);
const SCHEMA_MEMBERS: ReadonlySet<string> = new Set(['projectDocument']);
const asVersion = textConverter({ maximumLength: 64 });
const asSchemaVersion = integerConverter(1, Number.MAX_SAFE_INTEGER);

/** The versions of the schemas the storage holds beside its own records. */
const asSchemas: Converter<number> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SCHEMA_MEMBERS);
  return object === undefined
    ? undefined
    : required(reading, object, pathOf(parent, key), 'projectDocument', asSchemaVersion);
};

const readRootBody: Converter<RootBody> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, ROOT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const writtenBy = required(reading, object, at, 'writtenBy', asVersion);
  const projectDocument = required(reading, object, at, 'schemas', asSchemas);
  return writtenBy === undefined || projectDocument === undefined
    ? undefined
    : { writtenBy, projectDocument };
};

/** Opens the storage root, initialising an empty storage. */
export async function openStorageRoot(
  tree: StorageTree,
  digest: Digest,
  signal?: AbortSignal,
): Promise<DomainResult<StorageRootOpening>> {
  return await refusalsReported<StorageRootOpening>(async () => {
    const records = new CheckedRecords(tree, digest);
    const read = await records.read(
      STORAGE_ROOT_FILE,
      RecordKind.StorageRoot,
      readRootBody,
      signal,
    );
    if (read.kind === 'valid') {
      const documents = compatibilityOf(read.value.projectDocument, 'projectDocument');
      return succeed(
        documents.kind === 'current'
          ? { kind: 'current' }
          : {
              kind: 'incompatible',
              schema: 'projectDocument',
              found: documents.found,
              current: documents.current,
            },
      );
    }
    if (read.kind === 'invalid' && read.fault.kind === 'incompatible') {
      return succeed({
        kind: 'incompatible',
        schema: 'projectStorage',
        found: read.fault.found,
        current: read.fault.current,
      });
    }
    // A root torn with nothing beside it is an initialisation a crash cut
    // short, since the root is written before anything else: nothing is lost by
    // writing it again.
    const others = (await tree.list('')).filter((entry) => entry.name !== STORAGE_ROOT_FILE);
    if (others.length > 0 || (read.kind === 'invalid' && read.fault.kind !== 'damaged')) {
      return succeed({
        kind: 'unreadable',
        fault: read.kind === 'invalid' ? read.fault : { kind: 'missing' },
      });
    }
    return mapResult(await initialise(records, signal), () => ({ kind: 'fresh' }) as const);
  });
}

/**
 * Removes everything the storage holds and initialises this build's schema,
 * once the person has confirmed what they were shown. Refused where the storage
 * no longer holds what the confirmation describes.
 */
export async function wipeStorage(
  tree: StorageTree,
  digest: Digest,
  confirmation: WipeConfirmation,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  const opening = await openStorageRoot(tree, digest, signal);
  if (!opening.ok) return opening;
  const found = opening.value;
  const confirmed =
    (found.kind === 'incompatible' &&
      confirmation.kind === 'incompatible' &&
      confirmation.schema === found.schema &&
      confirmation.found === found.found) ||
    (found.kind === 'unreadable' && confirmation.kind === 'unreadable');
  if (!confirmed) {
    return fail(
      failure(
        'storage.wipe-unconfirmed',
        FailureKind.Rejected,
        'The storage no longer holds what the wipe was confirmed for, so nothing was removed.',
      ),
    );
  }
  return await refusalsReported(async () => {
    for (const entry of await tree.list('')) {
      if (entry.name !== STORAGE_ROOT_FILE) await tree.remove(entry.name);
    }
    await tree.remove(STORAGE_ROOT_FILE);
    return await initialise(new CheckedRecords(tree, digest), signal);
  });
}

async function initialise(
  records: CheckedRecords,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  return await records.write(
    STORAGE_ROOT_FILE,
    RecordKind.StorageRoot,
    { writtenBy: PRODUCT_VERSION, schemas: { projectDocument: SCHEMA_VERSIONS.projectDocument } },
    signal,
  );
}
