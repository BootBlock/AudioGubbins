/**
 * The storage root: the one file that says which schema the whole storage was
 * written with, and the pre-1.0 flow for storage of any other (REQ-STOR-052).
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

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { PRODUCT_VERSION } from '@audiogubbins/version';
import {
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

/** What opening the storage root found. */
export type StorageRootOpening =
  /** The storage was empty, and has been initialised with this build's schema. */
  | { readonly kind: 'fresh' }
  /** The storage is of this build's schema. */
  | { readonly kind: 'current' }
  /** The storage is of another schema, which before 1.0 cannot be read. */
  | { readonly kind: 'incompatible'; readonly found: number; readonly current: number }
  /** The storage holds data but no readable root: its schema cannot be told. */
  | { readonly kind: 'unreadable'; readonly fault: RecordFault | { readonly kind: 'missing' } };

/**
 * The person's confirmation of a wipe: what they were shown the storage holds.
 * A confirmation of anything else is of another storage, and is refused.
 */
export type WipeConfirmation =
  { readonly kind: 'incompatible'; readonly found: number } | { readonly kind: 'unreadable' };

const ROOT_MEMBERS: ReadonlySet<string> = new Set(['writtenBy']);
const asVersion = textConverter({ maximumLength: 64 });

/** The root's body: the product version that initialised the storage. */
const readRootBody: Converter<string> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, ROOT_MEMBERS);
  return object === undefined
    ? undefined
    : required(reading, object, pathOf(parent, key), 'writtenBy', asVersion);
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
    if (read.kind === 'valid') return succeed({ kind: 'current' });
    if (read.kind === 'invalid' && read.fault.kind === 'incompatible') {
      return succeed({
        kind: 'incompatible',
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
    await initialise(records, signal);
    return succeed({ kind: 'fresh' });
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
    await initialise(new CheckedRecords(tree, digest), signal);
    return succeed(undefined);
  });
}

async function initialise(records: CheckedRecords, signal?: AbortSignal): Promise<void> {
  await records.write(
    STORAGE_ROOT_FILE,
    RecordKind.StorageRoot,
    { writtenBy: PRODUCT_VERSION },
    signal,
  );
}
