/**
 * Why the browser refused to keep a write, and what the user can do about it.
 *
 * Told only that a change will not survive a reload, a user has nothing to act
 * on: a full quota and storage the browser refuses outright have different
 * remedies, and neither is one they could guess. The browser names each by the
 * error it throws, and the storage-failure notice says the cause and the remedy
 * from that (REQ-UX-059, REQ-STOR-025).
 */

/** Why the browser refused a write, as far as it says. */
const StorageFailureCause = {
  /** The storage the browser gives this site is full. */
  Full: 'full',

  /** The browser refuses this site any storage, by its settings or its mode. */
  Refused: 'refused',

  /** The browser threw something that says neither. */
  Unknown: 'unknown',
} as const;

/** Why the browser refused a write, as far as it says. */
export type StorageFailureCause = (typeof StorageFailureCause)[keyof typeof StorageFailureCause];

/**
 * The names a browser gives the error it throws at its quota: the standard
 * one, and the one Firefox gave before it took the standard.
 */
const QUOTA_ERRORS: ReadonlySet<string> = new Set([
  'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

/**
 * The name a browser gives the error it throws where it refuses the site
 * storage at all: site data blocked in its settings, or a private window that
 * keeps none.
 */
const REFUSAL_ERROR = 'SecurityError';

/**
 * The name of what was thrown, where it has one: read from the object rather
 * than from `Error`, since a browser's `DOMException` need not be one.
 */
function nameOf(thrown: unknown): string | undefined {
  if (typeof thrown !== 'object' || thrown === null || !('name' in thrown)) return undefined;
  return typeof thrown.name === 'string' ? thrown.name : undefined;
}

/** Why the browser refused a write, read from what it threw. */
export function causeOf(thrown: unknown): StorageFailureCause {
  const name = nameOf(thrown);
  if (name === undefined) return StorageFailureCause.Unknown;
  if (QUOTA_ERRORS.has(name)) return StorageFailureCause.Full;
  return name === REFUSAL_ERROR ? StorageFailureCause.Refused : StorageFailureCause.Unknown;
}

/**
 * The cause and the remedy of each, as the notice says them after what is not
 * kept.
 *
 * At the quota the remedies are in AudioGubbins, since the quota is the site's
 * and clearing the browser's storage deletes more than it says (see
 * `MAKING_ROOM_SAFELY`); where the browser refuses the site storage, only its
 * settings can change that. Every one ends with the retry, which holds whatever
 * the cause: every write tries again.
 */
const SAID: Readonly<Record<StorageFailureCause, string>> = {
  [StorageFailureCause.Full]:
    "The browser's storage for this site is full. Deleting workspaces or shortcut profiles you no longer need makes room, as does exporting and then discarding any text that could not be read, in the Workspaces and Shortcuts settings. AudioGubbins tries again with your next change.",
  [StorageFailureCause.Refused]:
    "The browser is refusing this site any storage, as it does where its settings block site data or a private window keeps none. Allowing this site to keep data, in the browser's settings, lets AudioGubbins save again; it tries with your next change.",
  [StorageFailureCause.Unknown]:
    'The browser did not say why. AudioGubbins tries again with your next change.',
};

/** Why a write was refused and what the user can do, as the notice says it. */
export function causeAndRemedy(cause: StorageFailureCause): string {
  return SAID[cause];
}
