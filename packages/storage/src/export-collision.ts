/**
 * Where a folder delivery writes, decided by `@audiogubbins/import-export`'s
 * rules from the folder's listing at delivery, never assumed (ADR-0092,
 * REQ-ARCH-054): the policy, the answer the person gave for the rest of a
 * batch, and, in a trusted folder, the records of what AudioGubbins exported
 * there before against the size and SHA-256 of the file now there, each
 * record naming its file by its path from the trusted folder. Where the
 * rules ask, the person is asked, and the delivery waits for the answer; a
 * question dismissed skips the file.
 */

import type { DomainFailure } from '@audiogubbins/domain';
import {
  answerCollision,
  decideCollision,
  type AnsweredDecision,
  type CollisionAnswer,
  type CollisionPolicy,
  type CollisionQuery,
  type ExportFileName,
  type ExportedFileRecord,
  type ListedFileContent,
} from '@audiogubbins/import-export';
import type { Sha256 } from '@audiogubbins/model-packs';
import { CONTENT_CHUNK_BYTES, hexOf, type ByteSource } from '@audiogubbins/project-format';

import { collisionSkipped } from './export-failures.js';

/** What the person answers when asked about a taken name, or nothing where they dismissed it. */
export interface CollisionReply {
  readonly answer: CollisionAnswer;

  /** Whether the answer holds for the rest of the batch. */
  readonly applyToAll: boolean;
}

/** Asks the person what to do with a taken name, waiting for their answer. */
export type CollisionPrompt = (
  name: string,
  signal?: AbortSignal,
) => Promise<CollisionReply | undefined>;

/** A folder delivery's rules: the folder as it is listed and read, and what decides a taken name. */
interface FolderRules {
  readonly folder: {
    list(signal?: AbortSignal): Promise<readonly string[]>;
    open(name: string): Promise<ByteSource | undefined>;
  };
  readonly wanted: ExportFileName;
  readonly policy: CollisionPolicy;
  readonly remembered: CollisionAnswer | undefined;
  readonly trusted: readonly ExportedFileRecord[] | undefined;
  readonly prompt: CollisionPrompt;
}

/** Where a decided delivery writes and what it replaces, or why it writes nothing. */
export type Decided =
  | {
      readonly kind: 'write';
      readonly name: string;
      readonly replaced: 'none' | 'chosen' | 'trusted';
      readonly remembered: CollisionAnswer | undefined;
    }
  | {
      readonly kind: 'refused';
      readonly failure: DomainFailure;
      readonly remembered: CollisionAnswer | undefined;
    };

/** What a decision comes to. */
function outcomeOf(decision: AnsweredDecision, remembered: CollisionAnswer | undefined): Decided {
  switch (decision.kind) {
    case 'write':
    case 'rename':
      return { kind: 'write', name: decision.name, replaced: 'none', remembered };
    case 'overwrite':
      return {
        kind: 'write',
        name: decision.name,
        replaced: decision.trusted ? 'trusted' : 'chosen',
        remembered,
      };
    case 'skip':
      return { kind: 'refused', failure: collisionSkipped(decision.name), remembered };
  }
}

/** The size and SHA-256 of the folder's file of that name, where it is there to read. */
async function contentOf(
  folder: FolderRules['folder'],
  name: string,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<ListedFileContent | undefined> {
  const file = await folder.open(name);
  if (file === undefined) return undefined;
  const run = sha256();
  for (let offset = 0; offset < file.size; offset += CONTENT_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(CONTENT_CHUNK_BYTES, file.size - offset);
    const chunk = await file.read(offset, length, signal);
    // A file that changed as it was read is not the one any record names.
    if (chunk.length !== length) return undefined;
    await run.update(chunk);
  }
  return { size: file.size, hash: hexOf(await run.digest()) };
}

/**
 * The name a trusted folder's record keeps a delivered file under: its path
 * from the trusted folder, `/` between names (ADR-0102). Neither a folder's
 * name nor a file's holds a `/`, so the path is read back as it was written,
 * and a file delivered into the trusted folder itself keeps its bare name.
 */
export function trustedRecordName(path: readonly string[], name: string): string {
  return [...path, name].join('/');
}

/**
 * The records, of those kept for a trusted folder, of the files in the folder
 * `path` leads to, each named as that folder lists it. Folder names are
 * matched as written, so a record of the same folder under another case is
 * not found and its file is asked about, the safe way to be wrong.
 */
export function recordsIn(
  records: readonly ExportedFileRecord[],
  path: readonly string[],
): readonly ExportedFileRecord[] {
  const folder = trustedRecordName(path, '');
  return records.flatMap((record) => {
    const name = record.name.slice(folder.length);
    return record.name.startsWith(folder) && !name.includes('/') ? [{ ...record, name }] : [];
  });
}

/** Decides a folder delivery's name from its listing, asking the person where the rules ask. */
export async function decidedIn(
  rules: FolderRules,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<Decided> {
  const { folder, trusted } = rules;
  const listing = await folder.list(signal);
  const base: CollisionQuery = {
    wanted: rules.wanted,
    listing,
    policy: rules.policy,
    remembered: rules.remembered,
    trusted: undefined,
  };
  // Asked with nothing that answers for it, the rules name the file the
  // wanted name takes, if any: the one a trusted folder's records are checked
  // against.
  const taken = decideCollision({ ...base, policy: 'prompt', remembered: undefined });
  const query: CollisionQuery =
    trusted === undefined || taken.kind !== 'ask'
      ? base
      : {
          ...base,
          trusted: {
            records: trusted,
            existing: await contentOf(folder, taken.name, sha256, signal),
          },
        };
  const decision = decideCollision(query);
  if (decision.kind !== 'ask') return outcomeOf(decision, rules.remembered);
  const reply = await rules.prompt(decision.name, signal);
  if (reply === undefined) {
    return {
      kind: 'refused',
      failure: collisionSkipped(decision.name),
      remembered: rules.remembered,
    };
  }
  const remembered = reply.applyToAll ? reply.answer : rules.remembered;
  return outcomeOf(answerCollision(query, reply.answer), remembered);
}
