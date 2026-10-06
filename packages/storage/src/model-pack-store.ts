/**
 * The model packs a person has installed, kept in the storage tree beside the
 * projects (ADR-0062, REQ-AUDIO-139): the storage's implementation of the model
 * packs' `PackStore`, so a pack is never reached through the origin-private
 * file system directly.
 *
 * A version is kept at `packs/<id>/<version>/`:
 *
 * - `manifest.json`: a checked record of its manifest, written when it is
 *   staged and read back through the manifest reader.
 * - `files/<index>/<offset>`: each run of bytes of the file at `index` of the
 *   manifest, named by the offset it starts at in twelve digits. A download
 *   that stops keeps its runs, and one that resumes appends a new run where
 *   they end, so no file is held open while a download waits and nothing is
 *   copied when it resumes; the tree has no append and no rename, so a file is
 *   the runs read in order.
 * - `seal.json`: a checked record of the SHA-256 of the manifest's canonical
 *   text, written once the installer has checked every file. A version is
 *   installed only while its seal is valid and is the seal of its manifest.
 *
 * The tree writes nothing atomically, so a torn manifest or seal reads as a
 * damaged version, which can only be removed, never as a pack.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  manifestConverter,
  manifestJson,
  packKey,
  type KeptPack,
  type ModelPackManifest,
  type PackRef,
  type PackStore,
} from '@audiogubbins/model-packs';
import {
  canonicalJson,
  encodeUtf8,
  hexOf,
  objectOf,
  pathOf,
  required,
  textConverter,
  type ByteSink,
  type ByteSource,
  type Converter,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords, RecordKind, type CheckedReading } from './checked-records.js';
import { refusalsReported } from './storage-failures.js';
import { PACKS_DIRECTORY } from './storage-layout.js';

const MANIFEST_FILE = 'manifest.json';
const SEAL_FILE = 'seal.json';
const FILES_DIRECTORY = 'files';

/** A run's name: the offset it starts at, in twelve digits, so names sort by offset. */
const RUN_NAME = /^[0-9]{12}$/u;
const RUN_DIGITS = 12;
const INDEX_DIGITS = 3;

/** What a seal says: the SHA-256 of the canonical manifest it seals. */
interface PackSeal {
  readonly manifest: string;
}

const SEAL_MEMBERS: ReadonlySet<string> = new Set(['manifest']);
const asDigestHex = textConverter({
  maximumLength: 64,
  pattern: /^[0-9a-f]{64}$/u,
  shape: 'a SHA-256 in lower-case hexadecimal',
});

const readSeal: Converter<PackSeal> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SEAL_MEMBERS);
  if (object === undefined) return undefined;
  const manifest = required(reading, object, pathOf(parent, key), 'manifest', asDigestHex);
  return manifest === undefined ? undefined : { manifest };
};

/** One run of a file, and where it starts. */
interface Run {
  readonly offset: number;
  readonly path: string;
  readonly source: ByteSource;
}

/** The runs of a file that follow each other from its start, and those past a gap. */
interface Runs {
  readonly whole: readonly Run[];
  readonly length: number;
  readonly stranded: readonly string[];
}

function damaged(ref: PackRef, summary: string, cause?: DomainFailure): DomainFailure {
  return failure('storage.pack-damaged', FailureKind.IntegrityViolation, summary, {
    details: { pack: ref.id, version: ref.version },
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Why a record read is not valid, as a failure. */
function faultOf(
  ref: PackRef,
  what: string,
  reading: Exclude<CheckedReading<unknown>, { kind: 'valid' }>,
): DomainFailure {
  if (reading.kind === 'absent') return damaged(ref, `The ${what} of ${packKey(ref)} is missing.`);
  const { fault } = reading;
  const cause =
    fault.kind === 'malformed'
      ? fault.failures[0]
      : fault.kind === 'damaged'
        ? fault.cause
        : undefined;
  return damaged(ref, `The ${what} of ${packKey(ref)} cannot be read (${fault.kind}).`, cause);
}

function notStaged(ref: PackRef): DomainResult<never> {
  return fail(
    failure(
      'storage.pack-not-staged',
      FailureKind.Conflict,
      `${packKey(ref)} is not being installed, so its files are not added to.`,
      { details: { pack: ref.id, version: ref.version } },
    ),
  );
}

/** The bytes of runs read in order, as one source. */
function joined(runs: readonly Run[], length: number): ByteSource {
  return {
    size: length,
    read: async (offset, wanted, signal) => {
      const end = Math.min(offset + wanted, length);
      const bytes = new Uint8Array(Math.max(0, end - offset));
      let filled = 0;
      for (const run of runs) {
        const runEnd = run.offset + run.source.size;
        if (runEnd <= offset + filled || run.offset >= end) continue;
        const from = offset + filled - run.offset;
        const take = Math.min(runEnd, end) - (offset + filled);
        const part = await run.source.read(from, take, signal);
        bytes.set(part, filled);
        filled += part.length;
        // A run that came back short changed under the reader, which reads
        // on no further, so the caller sees a short read.
        if (part.length !== take) return bytes.slice(0, filled);
      }
      return bytes;
    },
  };
}

/** The packs a storage keeps (see the module comment). */
export class ModelPackStore implements PackStore {
  private readonly records: CheckedRecords;

  constructor(tree: StorageTree, digest: Digest) {
    this.records = new CheckedRecords(tree, digest);
  }

  async kept(): Promise<DomainResult<readonly KeptPack[]>> {
    return await refusalsReported(async () => {
      const kept: KeptPack[] = [];
      for (const pack of await this.tree.list(PACKS_DIRECTORY)) {
        for (const version of await this.tree.list(`${PACKS_DIRECTORY}/${pack.name}`)) {
          kept.push(await this.keptVersion({ id: pack.name, version: version.name }));
        }
      }
      return succeed(kept);
    });
  }

  async stage(manifest: ModelPackManifest): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      const ref = { id: manifest.id, version: manifest.version };
      const directory = this.directoryOf(ref);
      if ((await this.tree.readFile(`${directory}/${SEAL_FILE}`)) !== undefined) {
        return fail(
          failure(
            'storage.pack-sealed',
            FailureKind.Conflict,
            `${packKey(ref)} is installed; only its removal changes it.`,
            { details: { pack: ref.id, version: ref.version } },
          ),
        );
      }
      const held = await this.manifestOf(ref);
      if (held.kind === 'valid' && sameManifest(held.value, manifest)) return succeed(undefined);
      // Another manifest's runs are of other files, which this one's hashes
      // would only refuse later.
      await this.tree.remove(directory);
      return await this.records.write(
        `${directory}/${MANIFEST_FILE}`,
        RecordKind.PackManifest,
        manifestJson(manifest),
      );
    });
  }

  async stagedBytes(ref: PackRef, index: number): Promise<DomainResult<number>> {
    return await refusalsReported(async () => {
      if (!(await this.isStaged(ref))) return notStaged(ref);
      return succeed((await this.runsOf(ref, index)).length);
    });
  }

  async append(ref: PackRef, index: number): Promise<DomainResult<ByteSink>> {
    return await refusalsReported(async () => {
      if (!(await this.isStaged(ref))) return notStaged(ref);
      const runs = await this.runsOf(ref, index);
      for (const path of runs.stranded) await this.tree.remove(path);
      return succeed(await this.tree.createFile(this.runPath(ref, index, runs.length)));
    });
  }

  async open(ref: PackRef, index: number): Promise<DomainResult<ByteSource | undefined>> {
    return await refusalsReported(async () => {
      const runs = await this.runsOf(ref, index);
      return succeed(runs.whole.length === 0 ? undefined : joined(runs.whole, runs.length));
    });
  }

  async seal(ref: PackRef): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      const held = await this.manifestOf(ref);
      if (held.kind !== 'valid' || !(await this.isStaged(ref))) return notStaged(ref);
      const seal: PackSeal = { manifest: await this.digestOf(held.value) };
      return await this.records.write(
        `${this.directoryOf(ref)}/${SEAL_FILE}`,
        RecordKind.PackSeal,
        { ...seal },
      );
    });
  }

  async remove(ref: PackRef): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      const directory = this.directoryOf(ref);
      // The seal goes first, so a removal cut short never leaves a version
      // sealed over files it no longer has.
      await this.tree.remove(`${directory}/${SEAL_FILE}`);
      await this.tree.remove(directory);
      return succeed(undefined);
    });
  }

  private get tree(): StorageTree {
    return this.records.tree;
  }

  private directoryOf(ref: PackRef): string {
    return `${PACKS_DIRECTORY}/${ref.id}/${ref.version}`;
  }

  private filesOf(ref: PackRef, index: number): string {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 10 ** INDEX_DIGITS) {
      throw new RangeError(
        `A pack's file is numbered from 0 to ${String(10 ** INDEX_DIGITS - 1)}.`,
      );
    }
    return `${this.directoryOf(ref)}/${FILES_DIRECTORY}/${String(index).padStart(INDEX_DIGITS, '0')}`;
  }

  private runPath(ref: PackRef, index: number, offset: number): string {
    return `${this.filesOf(ref, index)}/${String(offset).padStart(RUN_DIGITS, '0')}`;
  }

  private async manifestOf(ref: PackRef): Promise<CheckedReading<ModelPackManifest>> {
    return await this.records.read(
      `${this.directoryOf(ref)}/${MANIFEST_FILE}`,
      RecordKind.PackManifest,
      manifestConverter,
    );
  }

  /** Whether a version has a manifest and no seal: its files may arrive. */
  private async isStaged(ref: PackRef): Promise<boolean> {
    const directory = this.directoryOf(ref);
    return (
      (await this.tree.readFile(`${directory}/${SEAL_FILE}`)) === undefined &&
      (await this.manifestOf(ref)).kind === 'valid'
    );
  }

  private async digestOf(manifest: ModelPackManifest): Promise<string> {
    return hexOf(await this.records.digest(encodeUtf8(canonicalJson(manifestJson(manifest)))));
  }

  /** The runs of a file, in order of offset. */
  private async runsOf(ref: PackRef, index: number): Promise<Runs> {
    const directory = this.filesOf(ref, index);
    const whole: Run[] = [];
    const stranded: string[] = [];
    let length = 0;
    for (const entry of await this.tree.list(directory)) {
      const path = `${directory}/${entry.name}`;
      const source =
        entry.kind === 'file' && RUN_NAME.test(entry.name)
          ? await this.tree.openFile(path)
          : undefined;
      if (source === undefined || Number(entry.name) !== length || stranded.length > 0) {
        stranded.push(path);
        continue;
      }
      whole.push({ offset: length, path, source });
      length += source.size;
    }
    return { whole, length, stranded };
  }

  /** What is kept of one version, as the store finds it. */
  private async keptVersion(ref: PackRef): Promise<KeptPack> {
    const manifest = await this.manifestOf(ref);
    if (manifest.kind !== 'valid') {
      return { kind: 'damaged', ref, reason: faultOf(ref, 'manifest', manifest) };
    }
    if (manifest.value.id !== ref.id || manifest.value.version !== ref.version) {
      return {
        kind: 'damaged',
        ref,
        reason: damaged(ref, `The manifest kept as ${packKey(ref)} is of another pack.`),
      };
    }
    const directory = this.directoryOf(ref);
    if ((await this.tree.readFile(`${directory}/${SEAL_FILE}`)) === undefined) {
      let received = 0;
      for (const [index, file] of manifest.value.files.entries()) {
        received += Math.min((await this.runsOf(ref, index)).length, file.bytes);
      }
      return { kind: 'staged', manifest: manifest.value, received };
    }
    const seal = await this.records.read(
      `${directory}/${SEAL_FILE}`,
      RecordKind.PackSeal,
      readSeal,
    );
    if (seal.kind !== 'valid') return { kind: 'damaged', ref, reason: faultOf(ref, 'seal', seal) };
    return seal.value.manifest === (await this.digestOf(manifest.value))
      ? { kind: 'sealed', manifest: manifest.value }
      : {
          kind: 'damaged',
          ref,
          reason: damaged(ref, `The seal of ${packKey(ref)} is of another manifest.`),
        };
  }
}

function sameManifest(one: ModelPackManifest, other: ModelPackManifest): boolean {
  return canonicalJson(manifestJson(one)) === canonicalJson(manifestJson(other));
}
