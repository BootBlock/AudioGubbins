/**
 * The storage root as the application sees it: whether this browser can keep
 * projects at all, whether the stored data is of this build's schema, and the
 * blocking compatibility flow where it is not (REQ-STOR-052, REQ-EXEC-216).
 *
 * The root is opened before anything else reads project storage. Storage of
 * another schema, or storage whose schema cannot be told, blocks every project
 * until the person decides: they may save a copy of the raw data, set the
 * decision aside, which leaves every byte as it is and every project
 * unavailable, or wipe it once they have confirmed twice. Nothing here
 * migrates, and nothing is removed without the wipe.
 */

import {
  fail,
  failure,
  FailureKind,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { Digest, StorageTree } from '@audiogubbins/project-format';
import {
  exportRawStorage,
  openStorageRoot,
  wipeStorage,
  type StorageRootOpening,
  type WipeConfirmation,
} from '@audiogubbins/storage';

import type { TransferFiles } from '../io/transfer-files.js';
import { observable, type Observable } from './observable.js';

/** What the raw data is saved as. */
const RAW_DATA_NAME = 'AudioGubbins stored data.zip';

/** What the stored data is, where it blocks every project. */
export type BlockingData = Extract<StorageRootOpening, { kind: 'incompatible' | 'unreadable' }>;

/** Where the storage root stands. */
export type StorageRootState =
  /** This browser cannot keep projects, and why. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'opening' }
  | { readonly kind: 'ready' }
  /** The storage refused to be read, as a full or unreachable one does. */
  | { readonly kind: 'failed'; readonly cause: DomainFailure }
  | {
      readonly kind: 'blocked';
      readonly data: BlockingData;

      /** Whether the compatibility screen is showing, or the person set it aside. */
      readonly shown: boolean;

      /** What is being done with the data, while it is. */
      readonly working?: 'exporting' | 'wiping';
    };

/** What the storage root is kept in. */
export interface StorageRootServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
}

/** The storage root, and the decisions the compatibility screen offers. */
export interface StorageRootStore extends Observable<StorageRootState> {
  /** Opens the root, and answers whether projects can now be read. */
  readonly open: () => Promise<DomainResult<boolean>>;

  /** Leaves the data as it is, and every project unavailable. */
  readonly setAside: () => void;

  /** Shows the compatibility screen again. */
  readonly review: () => void;

  /**
   * Writes every stored file into a ZIP archive, saved where the person
   * chooses, and answers whether it was saved: not where they dismissed the
   * choice.
   */
  readonly exportRaw: (files: TransferFiles) => Promise<DomainResult<boolean>>;

  /** Removes the data the person was shown, once they confirmed it twice. */
  readonly wipe: () => Promise<DomainResult<void>>;
}

/** Why the compatibility decisions cannot be taken now. */
const NOTHING_BLOCKS = failure(
  'storage.nothing-blocks',
  FailureKind.Conflict,
  'The stored projects can be opened, so there is nothing to decide about them.',
);

/** The confirmation of a wipe of what the person was shown. */
function confirmationOf(data: BlockingData): WipeConfirmation {
  return data.kind === 'incompatible'
    ? { kind: 'incompatible', schema: data.schema, found: data.found }
    : { kind: 'unreadable' };
}

/** The store over a browser that cannot keep projects: always unavailable, with the reason. */
export function unavailableStorageRoot(reason: string): StorageRootStore {
  const state = observable<StorageRootState>({ kind: 'unavailable', reason });
  const refused = (): Promise<DomainResult<never>> =>
    Promise.resolve(fail(failure('storage.unavailable', FailureKind.Unrecoverable, reason)));
  return {
    get: state.get,
    subscribe: state.subscribe,
    open: () => Promise.resolve(succeed(false)),
    setAside: () => undefined,
    review: () => undefined,
    exportRaw: refused,
    wipe: refused,
  };
}

/** The storage root of the storage this browser keeps projects in. */
export class StorageRoot implements StorageRootStore {
  private readonly services: StorageRootServices;
  private readonly state = observable<StorageRootState>({ kind: 'opening' });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(services: StorageRootServices) {
    this.services = services;
  }

  readonly open = async (): Promise<DomainResult<boolean>> => {
    this.state.set({ kind: 'opening' });
    const opened = await openStorageRoot(this.services.tree, this.services.digest);
    if (!opened.ok) {
      this.state.set({ kind: 'failed', cause: opened.failures[0] });
      return opened;
    }
    const found = opened.value;
    if (found.kind === 'fresh' || found.kind === 'current') {
      this.state.set({ kind: 'ready' });
      return succeed(true);
    }
    this.state.set({ kind: 'blocked', data: found, shown: true });
    return succeed(false);
  };

  readonly setAside = (): void => {
    const current = this.state.get();
    if (current.kind === 'blocked') this.state.set({ ...current, shown: false });
  };

  readonly review = (): void => {
    const current = this.state.get();
    if (current.kind === 'blocked') this.state.set({ ...current, shown: true });
  };

  readonly exportRaw = async (files: TransferFiles): Promise<DomainResult<boolean>> => {
    if (this.state.get().kind !== 'blocked') return fail(NOTHING_BLOCKS);
    // Asked before anything is read, in the handler of the person's gesture,
    // which the browser's own chooser needs.
    const target = await files.save(RAW_DATA_NAME, 'application/zip');
    if (target === undefined) return succeed(false);
    return await this.whileBlocked('exporting', async () => {
      const written = await exportRawStorage(this.services.tree, target.sink);
      if (!written.ok) return written;
      target.finish();
      return succeed(true);
    });
  };

  readonly wipe = (): Promise<DomainResult<void>> =>
    this.whileBlocked('wiping', async (data) => {
      const { tree, digest } = this.services;
      const wiped = await wipeStorage(tree, digest, confirmationOf(data));
      if (wiped.ok) this.state.set({ kind: 'ready' });
      return wiped;
    });

  /** The blocking data, while it blocks, with what is done to it while it is worked on. */
  private async whileBlocked<TValue>(
    working: 'exporting' | 'wiping',
    work: (data: BlockingData) => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    const current = this.state.get();
    if (current.kind !== 'blocked') return fail(NOTHING_BLOCKS);
    this.state.set({ ...current, working });
    try {
      return await work(current.data);
    } finally {
      const after = this.state.get();
      if (after.kind === 'blocked') {
        this.state.set({ kind: 'blocked', data: after.data, shown: true });
      }
    }
  }
}
