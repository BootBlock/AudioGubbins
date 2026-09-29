/**
 * The states a project keeps whole, each in a file named by its fingerprint:
 * the `SnapshotStore` the packet names (ADR-0020, REQ-STOR-101, REQ-STOR-194).
 *
 * A state is written as the compact canonical text of its project document,
 * whose digest is its fingerprint, so the file's name says what it must hold. A
 * file is written once and never changed: putting a state already whole is a
 * no-op, since rewriting a file in place could tear what was sound. Reading one
 * validates the document through the format's reader and derives the
 * fingerprint again from the state read, refusing a file that holds anything
 * but the state its name promises, so a torn or altered state is reported and
 * never used.
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  decodeUtf8,
  encodeUtf8,
  fingerprintOf,
  parseProjectDocument,
  stateFingerprintFrom,
  writeProjectDocument,
  type Digest,
  type ProjectState,
  type StateFingerprint,
  type StorageTree,
} from '@audiogubbins/project-format';

const STATE_FILE = /^(s1-[0-9a-f]{64})\.json$/u;

/**
 * The states kept whole in one directory: a project's own, or those of one of
 * its backup generations.
 */
export class SnapshotStore {
  private readonly tree: StorageTree;
  private readonly digest: Digest;
  private readonly directory: string;

  constructor(tree: StorageTree, digest: Digest, directory: string) {
    this.tree = tree;
    this.digest = digest;
    this.directory = directory;
  }

  /** The fingerprint a state is kept under, without keeping it. */
  async fingerprint(state: ProjectState): Promise<StateFingerprint> {
    return await fingerprintOf(canonicalJson(writeProjectDocument(state)), this.digest);
  }

  /**
   * Keeps a state whole, if it is not kept already, and gives its fingerprint.
   * Rejects with the tree's refusal where it cannot be written.
   */
  async put(state: ProjectState, signal?: AbortSignal): Promise<StateFingerprint> {
    const text = canonicalJson(writeProjectDocument(state));
    const fingerprint = await fingerprintOf(text, this.digest);
    const bytes = encodeUtf8(text);
    const path = this.path(fingerprint);
    // A file of the full length is whole: the tree tears a write by cutting it
    // short, and a name is only ever written with the one text it names.
    const held = await this.tree.openFile(path);
    if (held?.size !== bytes.length) await this.tree.writeFile(path, bytes, signal);
    return fingerprint;
  }

  /** The state kept under a fingerprint, or why there is none to trust. */
  async get(
    fingerprint: StateFingerprint,
    signal?: AbortSignal,
  ): Promise<DomainResult<ProjectState>> {
    const bytes = await this.tree.readFile(this.path(fingerprint), signal);
    if (bytes === undefined) return fail(stateMissing(fingerprint));
    const read = flatMapResult(decodeUtf8(bytes), parseProjectDocument);
    if (!read.ok) {
      return fail(
        failure(
          'storage.state-unreadable',
          FailureKind.IntegrityViolation,
          'A kept state cannot be read.',
          {
            details: { state: fingerprint },
            cause: read.failures[0],
          },
        ),
      );
    }
    if ((await this.fingerprint(read.value)) !== fingerprint) {
      return fail(
        failure(
          'storage.state-mismatch',
          FailureKind.IntegrityViolation,
          'A kept state is not the state its name promises.',
          { details: { state: fingerprint } },
        ),
      );
    }
    return succeed(read.value);
  }

  /** The fingerprint of every state file the project holds, whole or not. */
  async list(): Promise<ReadonlySet<StateFingerprint>> {
    const held = new Set<StateFingerprint>();
    for (const entry of await this.tree.list(this.directory)) {
      const name = STATE_FILE.exec(entry.name)?.[1];
      const fingerprint = name === undefined ? undefined : stateFingerprintFrom(name);
      if (entry.kind === 'file' && fingerprint?.ok === true) held.add(fingerprint.value);
    }
    return held;
  }

  /** Removes a kept state, once nothing the project keeps names it. */
  async remove(fingerprint: StateFingerprint): Promise<void> {
    await this.tree.remove(this.path(fingerprint));
  }

  /** The file a state is kept in. */
  path(fingerprint: StateFingerprint): string {
    return `${this.directory}/${fingerprint}.json`;
  }
}

/** The failure of a state that is not kept. */
function stateMissing(fingerprint: StateFingerprint): DomainFailure {
  return failure('storage.state-missing', FailureKind.Conflict, 'A state is not kept.', {
    details: { state: fingerprint },
  });
}
