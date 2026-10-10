/**
 * What happens when an exported file's name is taken (ADR-0092, REQ-ARCH-054).
 *
 * A pure decision from what delivery found: the name wanted, the
 * destination's listing at delivery, the policy, the answer the person gave
 * for the rest of the batch, and, in a trusted folder, the records of what
 * AudioGubbins exported there before and the size and hash of the file now
 * there where they are known. Nothing overwrites by default: the default
 * policy asks.
 *
 * Names are compared as a case-insensitive file system compares them, NFC
 * and in lower case, since a folder may be on one, so `Boom.wav` collides
 * with `boom.wav`; comparing more strictly could replace a file a person
 * thought apart. An overwrite names the file as the listing has it.
 *
 * In a trusted folder, a file AudioGubbins exported there, the last record of
 * its name, and unchanged since, its size and hash those the record holds, is
 * overwritten without asking; every other collision falls to the policy. A
 * rename takes the first free name of `name (2).ext`, `name (3).ext` and on,
 * so the same listing always gives the same name.
 */

import { safeFileName, type ExportFileName } from './file-name-safety.js';

/** What to do with a taken name: ask, which is the default, overwrite, skip or rename. */
export type CollisionPolicy = 'prompt' | 'overwrite' | 'skip' | 'rename';

/** What the person answers when asked. */
export type CollisionAnswer = 'overwrite' | 'skip' | 'rename';

/** A file AudioGubbins exported to a folder, from its export record. */
export interface ExportedFileRecord {
  readonly name: string;
  readonly size: number;

  /** The SHA-256 of its bytes, in hexadecimal. */
  readonly hash: string;
}

/** A file now in the destination, by its size and hash. */
export interface ListedFileContent {
  readonly size: number;
  readonly hash: string;
}

/** What a trusted folder knows: its export records, in the order they were made, and the taken file's content. */
export interface TrustedFolder {
  readonly records: readonly ExportedFileRecord[];
  readonly existing: ListedFileContent | undefined;
}

/** What a collision is decided from. */
export interface CollisionQuery {
  readonly wanted: ExportFileName;

  /** The names in the destination when delivery began. */
  readonly listing: readonly string[];
  readonly policy: CollisionPolicy;

  /** The answer given for the rest of the batch, if one was. */
  readonly remembered: CollisionAnswer | undefined;

  /** The folder's records, where it is trusted. */
  readonly trusted: TrustedFolder | undefined;
}

/** What delivery does. */
export type CollisionDecision =
  | { readonly kind: 'write'; readonly name: string }
  | { readonly kind: 'overwrite'; readonly name: string; readonly trusted: boolean }
  | { readonly kind: 'skip'; readonly name: string }
  | { readonly kind: 'rename'; readonly name: string }
  | { readonly kind: 'ask'; readonly name: string };

/** A name as a case-insensitive file system compares it. */
function folded(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Whether a trusted folder's file of `name` is one AudioGubbins exported there and unchanged since. */
function unchangedExport(name: string, folder: TrustedFolder): boolean {
  const { existing } = folder;
  if (existing === undefined) return false;
  const record = folder.records.findLast((one) => folded(one.name) === folded(name));
  return (
    record?.size === existing.size && record.hash.toLowerCase() === existing.hash.toLowerCase()
  );
}

/** The first free name of the form `name (n).ext`, from 2. */
function freeName(wanted: ExportFileName, listing: readonly string[]): string {
  const taken = new Set(listing.map(folded));
  for (let copy = 2; ; copy += 1) {
    const name = safeFileName(wanted, copy);
    if (!taken.has(folded(name))) return name;
  }
}

/** The decision an answer gives for a taken name, listed as `existing`. */
function answered(
  answer: CollisionAnswer,
  existing: string,
  query: CollisionQuery,
): CollisionDecision {
  switch (answer) {
    case 'overwrite':
      return { kind: 'overwrite', name: existing, trusted: false };
    case 'skip':
      return { kind: 'skip', name: existing };
    case 'rename':
      return { kind: 'rename', name: freeName(query.wanted, query.listing) };
  }
}

/** What delivery does with the name wanted. */
export function decideCollision(query: CollisionQuery): CollisionDecision {
  const name = safeFileName(query.wanted);
  const existing = query.listing.find((one) => folded(one) === folded(name));
  if (existing === undefined) return { kind: 'write', name };
  if (query.trusted !== undefined && unchangedExport(existing, query.trusted)) {
    return { kind: 'overwrite', name: existing, trusted: true };
  }
  if (query.policy !== 'prompt') return answered(query.policy, existing, query);
  if (query.remembered !== undefined) return answered(query.remembered, existing, query);
  return { kind: 'ask', name: existing };
}

/** The decision the person's answer to an `ask` gives. */
export function answerCollision(query: CollisionQuery, answer: CollisionAnswer): CollisionDecision {
  const name = safeFileName(query.wanted);
  const existing = query.listing.find((one) => folded(one) === folded(name)) ?? name;
  return answered(answer, existing, query);
}
