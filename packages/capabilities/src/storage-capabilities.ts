/**
 * What each storage object the browser may lack costs the user, and why.
 *
 * REQ-EXEC-216 forbids assuming a browser API is there: each object
 * {@link StoragePlatform} can be without has its reason, its remedy where the
 * user has one, and what AudioGubbins does instead, written once here so the
 * capability surface, a notice and a diagnostic bundle say the same thing.
 * REQ-STOR-098 decides the one about Web Locks: without coordination between
 * tabs a project is opened read-only rather than risk two writers.
 *
 * The origin-private file system, persistent storage and the storage estimate
 * are not here: the registry already reports them (`CapabilityKey`), and a
 * second statement of the same absence would drift from the first.
 */

import type { StoragePlatform } from './storage-platform.js';

/** A storage object the browser either offers or does not. */
export const StorageCapabilityKey = {
  /** Web Locks, which decide the one tab that may change a project. */
  WebLocks: 'web-locks',

  /** A broadcast channel, which tells the other tabs when that tab changes. */
  BroadcastChannel: 'broadcast-channel',

  /** IndexedDB, which keeps the handles of files the user linked. */
  IndexedDb: 'indexed-db',

  /** The pickers that hand AudioGubbins a file or folder it can return to. */
  FilePickers: 'file-pickers',

  /** The SHA-256 digest media is identified by. */
  ContentDigest: 'content-digest',

  /** Random numbers, from which what AudioGubbins stores is named. */
  RandomTokens: 'random-tokens',

  /** A way for long work to give the interface a turn. */
  HostYielding: 'host-yielding',
} as const;

/** A storage object the browser either offers or does not. */
export type StorageCapabilityKey = (typeof StorageCapabilityKey)[keyof typeof StorageCapabilityKey];

/** A storage object the browser lacks, and what that means. */
export interface StorageCapabilityAbsence {
  readonly key: StorageCapabilityKey;

  /** Why, in British English, for the person using AudioGubbins. */
  readonly reason: string;

  /** What the user can do about it, absent where there is nothing. */
  readonly remedy?: string;

  /** What AudioGubbins does without it. */
  readonly fallback: string;
}

/** The remedy for an object only a page served securely is given. */
const SERVE_SECURELY = 'Open AudioGubbins from its https:// address rather than an insecure one.';

/** Each object's absence (see the module comment). */
const ABSENCE: Readonly<Record<StorageCapabilityKey, Omit<StorageCapabilityAbsence, 'key'>>> = {
  [StorageCapabilityKey.WebLocks]: {
    reason: 'This browser cannot agree between tabs which one may change a project.',
    remedy: SERVE_SECURELY,
    fallback:
      'Projects open read-only, so two tabs can never overwrite each other. Export a project to keep a copy of your changes.',
  },
  [StorageCapabilityKey.BroadcastChannel]: {
    reason: 'This browser cannot send a message from one tab to the others.',
    fallback:
      'A tab is not told at once when another takes a project over or changes it, so a read-only tab can show an older state until you refresh it.',
  },
  [StorageCapabilityKey.IndexedDb]: {
    reason: 'This browser will not keep the files you link between visits.',
    remedy: 'Private browsing and blocked site data usually cause this.',
    fallback: 'A linked file has to be chosen again after the page reloads.',
  },
  [StorageCapabilityKey.FilePickers]: {
    reason: 'This browser cannot give AudioGubbins a file or folder it can return to later.',
    fallback:
      'Files are copied into AudioGubbins rather than linked, and backups are downloaded rather than written to a folder you choose.',
  },
  [StorageCapabilityKey.ContentDigest]: {
    reason: 'This browser does not offer the digest AudioGubbins identifies media by.',
    remedy: SERVE_SECURELY,
    fallback: 'Media cannot be imported or checked, because its identity cannot be taken.',
  },
  [StorageCapabilityKey.RandomTokens]: {
    reason: 'This browser does not offer the random numbers AudioGubbins names what it stores by.',
    fallback: 'Media cannot be imported and files cannot be linked, because neither can be named.',
  },
  [StorageCapabilityKey.HostYielding]: {
    reason: 'This browser offers no way to pause long work so the interface can respond.',
    fallback: 'The interface may pause while a large file is fingerprinted.',
  },
};

/** Whether the platform offers each object. */
const PROBES: Readonly<Record<StorageCapabilityKey, (platform: StoragePlatform) => boolean>> = {
  [StorageCapabilityKey.WebLocks]: (p) => p.locks !== undefined,
  [StorageCapabilityKey.BroadcastChannel]: (p) => p.openBroadcastChannel !== undefined,
  [StorageCapabilityKey.IndexedDb]: (p) => p.indexedDb !== undefined,
  [StorageCapabilityKey.FilePickers]: (p) => p.pickers !== undefined,
  [StorageCapabilityKey.ContentDigest]: (p) => p.subtle !== undefined,
  [StorageCapabilityKey.RandomTokens]: (p) => p.randomBytes !== undefined,
  [StorageCapabilityKey.HostYielding]: (p) => p.hostYielding.kind !== 'none',
};

/** Every storage object the platform lacks, in a stable order, with what it costs. */
export function missingStorageCapabilities(
  platform: StoragePlatform,
): readonly StorageCapabilityAbsence[] {
  return Object.values(StorageCapabilityKey)
    .filter((key) => !PROBES[key](platform))
    .map((key) => ({ key, ...ABSENCE[key] }));
}
