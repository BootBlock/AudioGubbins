/**
 * The members of the browser's `LockManager` the write leases and the
 * storage-wide lock use, as a structural type the platform's own fits
 * (REQ-STOR-098, REQ-STOR-102).
 */

/** The options of a lock request the coordination makes. */
export interface LeaseLockOptions {
  readonly mode?: 'shared' | 'exclusive';
  readonly ifAvailable?: boolean;
  readonly steal?: boolean;
  readonly signal?: AbortSignal;
}

/** The members of a `LockManager` the coordination uses. */
export interface LeaseLocks {
  request(
    name: string,
    options: LeaseLockOptions,
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void>;
  query(): Promise<{ readonly held?: readonly { readonly name?: string }[] }>;
}
