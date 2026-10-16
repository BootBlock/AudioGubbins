import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sampleRate, type DomainFailure } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { EncodedStreamMessage, ExportSettings } from '@audiogubbins/import-export';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { Sha256 } from '@audiogubbins/model-packs';
import {
  ExportDestinationKind,
  TreeFailure,
  TreeFailureKind,
  stateFingerprintFrom,
  type ByteSink,
  type ByteSource,
  type ExportCodec,
} from '@audiogubbins/project-format';

import type { EncodedStream } from './encoded-stream.js';
import type { CollisionReply } from './export-collision.js';
import { deliverStaged, type DeliveryDestination, type DeliveryFolder } from './export-delivery.js';
import { ExportStaging, type ExportOrigin } from './export-staging.js';
import { mediaSharingOf } from './storage-sharing.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';

/**
 * Staging an export and delivering it (ADR-0092, REQ-ARCH-054): the encoded
 * body written as it arrives and the head and tail once it finishes; a
 * delivery deciding a folder's collisions from its listing, asking where the
 * rules ask and overwriting an unchanged trusted export silently; a refused
 * delivery leaving the destination as it was and the export staged; and a
 * delivered one recorded in the project's history.
 */

const sha256: Sha256 = () => {
  const hash = createHash('sha256');
  return {
    update: (bytes) => {
      hash.update(bytes);
      return Promise.resolve();
    },
    digest: () => Promise.resolve(new Uint8Array(hash.digest())),
  };
};

const HEAD = Uint8Array.from([1, 2, 3, 4]);
const BODY = [Uint8Array.from([10, 11, 12]), Uint8Array.from([13, 14])];
const TAIL = Uint8Array.from([99]);
const WHOLE = Uint8Array.from([...HEAD, ...BODY.flatMap((part) => [...part]), ...TAIL]);
const WHOLE_SHA = createHash('sha256').update(WHOLE).digest('hex');

const SETTINGS: ExportSettings = {
  format: 'wav',
  encoding: { kind: 'integer', bits: 16 },
  sampleRate: expectSuccess(sampleRate(48_000)),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'project' },
  metadata: { policy: 'full', edits: [] },
  fileName: '{project}',
};

/** The encoder the codec worker names once the file is encoded. */
const ENCODER: ExportCodec = { id: 'pcm', implementation: 'application', version: '0.1.0' };

const ORIGIN: ExportOrigin = {
  settings: SETTINGS,
  reproducible: true,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'2'.repeat(64)}`)),
  engineVersions: new Map([['renderer', '1']]),
};

/** A codec worker's encoded stream played from a list, recording what it was told. */
class FakeEncoded implements EncodedStream {
  readonly refusals: DomainFailure[] = [];
  read = 0;
  #closed = false;
  readonly #messages: readonly EncodedStreamMessage[];

  constructor(messages: readonly EncodedStreamMessage[]) {
    this.#messages = messages;
  }

  next(): Promise<EncodedStreamMessage | undefined> {
    if (this.#closed) return Promise.resolve(undefined);
    this.read += 1;
    return Promise.resolve(this.#messages[this.read - 1]);
  }

  refuse(failure: DomainFailure): void {
    this.refusals.push(failure);
    this.#closed = true;
  }

  close(): void {
    this.#closed = true;
  }
}

function encoded(): readonly EncodedStreamMessage[] {
  return [
    ...BODY.map((bytes): EncodedStreamMessage => ({ kind: 'body', bytes })),
    { kind: 'finished', file: { head: HEAD, tail: TAIL, dropped: [{ kind: 'coverArt' }] } },
  ];
}

/**
 * A folder in memory whose files are replaced only when a sink closes, and
 * whose folders are made as the port says: one asked for that is not there is
 * made, with those above it still to be made, only when a file is created in
 * it, and removed again, while empty, where that file is abandoned.
 */
class MemoryFolder implements DeliveryFolder {
  readonly name: string;
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Map<string, MemoryFolder>();
  access: () => Promise<'granted' | 'needs-permission'> = () => Promise.resolve('granted');
  refuseWrites = false;

  /** Every folder name asked for, in order, from this folder down. */
  readonly asked: string[];

  /** Makes this folder where it is still to be made, answering how to take that back. */
  readonly #make: () => () => void;

  constructor(
    name = 'Game sounds',
    asked: string[] = [],
    make: () => () => void = () => () => undefined,
  ) {
    this.name = name;
    this.asked = asked;
    this.#make = make;
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.files.keys(), ...this.folders.keys()]);
  }

  folder(name: string): Promise<DeliveryFolder | undefined> {
    this.asked.push(name);
    if (this.files.has(name)) return Promise.resolve(undefined);
    const there = this.folders.get(name);
    if (there !== undefined) return Promise.resolve(there);
    const made: MemoryFolder = new MemoryFolder(name, this.asked, () => {
      const above = this.#make();
      if (this.folders.has(name)) return above;
      this.folders.set(name, made);
      return () => {
        if (made.files.size === 0 && made.folders.size === 0) this.folders.delete(name);
        above();
      };
    });
    made.refuseWrites = this.refuseWrites;
    return Promise.resolve(made);
  }

  /** The folder at `path` from this one, where it is made. */
  at(...path: string[]): MemoryFolder | undefined {
    return path.reduce<MemoryFolder | undefined>((folder, name) => folder?.folders.get(name), this);
  }

  open(name: string): Promise<ByteSource | undefined> {
    const bytes = this.files.get(name);
    return Promise.resolve(
      bytes === undefined
        ? undefined
        : {
            size: bytes.length,
            read: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length)),
          },
    );
  }

  create(name: string): Promise<ByteSink> {
    const parts: number[] = [];
    const undo = this.#make();
    return Promise.resolve({
      write: (chunk) => {
        if (this.refuseWrites) {
          return Promise.reject(new TreeFailure(TreeFailureKind.Unavailable, 'Withdrawn.'));
        }
        parts.push(...chunk);
        return Promise.resolve();
      },
      close: () => {
        this.files.set(name, Uint8Array.from(parts));
        return Promise.resolve();
      },
      abort: () => {
        undo();
        return Promise.resolve();
      },
    });
  }
}

async function setUp() {
  const test = harness(51);
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  const coordinator = new MemoryLeaseCoordinator();
  const staging = new ExportStaging({
    tree,
    sha256,
    nextToken: () => test.ids.next<'AssetId'>(),
    sharing: mediaSharingOf(coordinator),
  });
  const services = { sha256, ids: test.ids, clock: { now: () => 1_790_000_000_000 } };
  const staged = async () =>
    expectSuccess(
      await staging.stage(header.id, ORIGIN, new FakeEncoded(encoded()), () => undefined),
    );
  const stagedFiles = () => tree.paths().filter((path) => path.startsWith('cache/staging/'));
  return { session, staging, services, staged, stagedFiles, tree, coordinator, project: header.id };
}

function intoFolder(
  folder: MemoryFolder,
  options: {
    readonly policy?: 'prompt' | 'overwrite' | 'skip' | 'rename';
    readonly trusted?: readonly { name: string; size: number; hash: string }[];
    readonly reply?: CollisionReply;
    readonly asked?: string[];
    readonly path?: readonly string[];
  } = {},
): DeliveryDestination {
  return {
    kind: 'folder',
    folder,
    path: options.path ?? [],
    wanted: { stem: 'Footsteps', extension: 'wav' },
    policy: options.policy ?? 'prompt',
    remembered: undefined,
    trusted: options.trusted,
    prompt: (name) => {
      options.asked?.push(name);
      return Promise.resolve(options.reply);
    },
  };
}

describe('staging an export (ADR-0092)', () => {
  it('writes the body as it arrives and the head and tail once it finishes, with the whole file’s SHA-256', async () => {
    const { staging, stagedFiles, project, coordinator } = await setUp();
    const progress: number[] = [];
    const stream = new FakeEncoded(encoded());
    const staged = expectSuccess(
      await staging.stage(project, ORIGIN, stream, (bytes) => progress.push(bytes)),
    );

    expect(staged).toMatchObject({
      bytes: WHOLE.length,
      sha256: WHOLE_SHA,
      dropped: [{ kind: 'coverArt' }],
    });
    expect(progress).toEqual([3, 5]);
    expect(stagedFiles()).toHaveLength(3);
    expect(stream.refusals).toEqual([]);
    // While anything is staged, no window starting may clear the staging.
    expect(await coordinator.lockStorage('exclusive', { wait: false })).toEqual({ kind: 'busy' });
    await staging.discard(staged.token);
    expect(stagedFiles()).toEqual([]);
    const alone = await coordinator.lockStorage('exclusive', { wait: false });
    expect(alone.kind).toBe('held');
    if (alone.kind === 'held') await alone.release();
  });

  it.each([
    [
      'a stream that fails',
      [
        { kind: 'body', bytes: HEAD },
        {
          kind: 'failed',
          failure: { code: 'codec.fault', kind: 'retryable', summary: 'The encoder failed.' },
        },
      ],
      'codec.fault',
    ],
    [
      'a stream that stops before it finishes',
      [{ kind: 'body', bytes: HEAD }],
      'export.stream-out-of-order',
    ],
  ] as const)('keeps nothing of %s, and tells the codec worker', async (_case, messages, code) => {
    const { staging, stagedFiles, project } = await setUp();
    const stream = new FakeEncoded(messages);
    expect(expectFailureCode(await staging.stage(project, ORIGIN, stream, () => undefined))).toBe(
      code,
    );
    expect(stagedFiles()).toEqual([]);
    expect(stream.refusals.map((refusal) => refusal.code)).toEqual([code]);
  });

  it('keeps nothing when cancelled, and tells the codec worker', async () => {
    const { staging, stagedFiles, project } = await setUp();
    const controller = new AbortController();
    const stream = new FakeEncoded(encoded());
    await expect(
      staging.stage(
        project,
        ORIGIN,
        stream,
        () => {
          controller.abort(new Error('Called off.'));
        },
        controller.signal,
      ),
    ).rejects.toThrow('Called off.');
    expect(stagedFiles()).toEqual([]);
    expect(stream.refusals.map((refusal) => refusal.code)).toEqual(['export.cancelled']);
  });
});

describe('staging an export cancelled once it is written', () => {
  it('removes the head, the body and the tail as the hash is taken', async () => {
    const tree = new MemoryStorageTree();
    const test = harness(52);
    const controller = new AbortController();
    const cancelling: Sha256 = () => ({
      update: () => {
        controller.abort(new Error('Called off.'));
        return Promise.resolve();
      },
      digest: () => Promise.resolve(new Uint8Array(32)),
    });
    const staging = new ExportStaging({
      tree,
      sha256: cancelling,
      nextToken: () => test.ids.next<'AssetId'>(),
      sharing: mediaSharingOf(new MemoryLeaseCoordinator()),
    });
    const project = test.ids.next<'ProjectId'>();
    await expect(
      staging.stage(
        project,
        ORIGIN,
        new FakeEncoded(encoded()),
        () => undefined,
        controller.signal,
      ),
    ).rejects.toThrow('Called off.');
    expect(tree.paths()).toEqual([]);
  });
});

describe('delivering a staged export (ADR-0092, REQ-ARCH-054)', () => {
  it('writes head, body and tail into a folder, records the export, and gives the staging up', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    const { token } = await staged();
    const delivery = expectSuccess(
      await deliverStaged(session, staging, token, ENCODER, intoFolder(folder), services),
    );

    expect(delivery).toMatchObject({ kind: 'delivered', name: 'Footsteps.wav', replaced: 'none' });
    expect(folder.files.get('Footsteps.wav')).toEqual(WHOLE);
    expect(stagedFiles()).toEqual([]);
    const [record] = session.getSnapshot().model.exports;
    expect(record).toMatchObject({
      destination: { kind: ExportDestinationKind.Directory, label: 'Game sounds' },
      output: { container: 'wav' },
      file: {
        settings: SETTINGS,
        fileName: 'Footsteps.wav',
        byteLength: WHOLE.length,
        sha256: WHOLE_SHA,
        codec: { id: 'pcm', implementation: 'application', version: '0.1.0' },
        reproducible: true,
      },
      status: 'succeeded',
    });
  });

  it('asks about a taken name, renames by the answer, and remembers it for the batch', async () => {
    const { session, staging, services, staged } = await setUp();
    const folder = new MemoryFolder();
    folder.files.set('footsteps.WAV', Uint8Array.from([7]));
    const asked: string[] = [];
    const delivery = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { reply: { answer: 'rename', applyToAll: true }, asked }),
        services,
      ),
    );

    expect(asked).toEqual(['footsteps.WAV']);
    expect(delivery).toMatchObject({ name: 'Footsteps (2).wav', remembered: 'rename' });
    expect(folder.files.get('footsteps.WAV')).toEqual(Uint8Array.from([7]));
    expect(folder.files.get('Footsteps (2).wav')).toEqual(WHOLE);
  });

  it('leaves the folder as it was and the export staged where the person dismisses the question, so another folder takes it', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    folder.files.set('Footsteps.wav', Uint8Array.from([7]));
    const { token } = await staged();
    const refused = expectSuccess(
      await deliverStaged(session, staging, token, ENCODER, intoFolder(folder), services),
    );

    expect(refused.kind === 'refused' ? refused.failure.code : refused.kind).toBe(
      'export.collision-skipped',
    );
    expect([...folder.files]).toEqual([['Footsteps.wav', Uint8Array.from([7])]]);
    expect(stagedFiles()).toHaveLength(3);
    expect(session.getSnapshot().model.exports).toEqual([]);

    const other = new MemoryFolder();
    expect(
      expectSuccess(
        await deliverStaged(session, staging, token, ENCODER, intoFolder(other), services),
      ).kind,
    ).toBe('delivered');
    expect(other.files.get('Footsteps.wav')).toEqual(WHOLE);
  });

  it('follows the policy without asking: skips, or overwrites', async () => {
    const { session, staging, services, staged } = await setUp();
    const folder = new MemoryFolder();
    folder.files.set('Footsteps.wav', Uint8Array.from([7]));
    const asked: string[] = [];
    const { token } = await staged();
    const skipped = expectSuccess(
      await deliverStaged(
        session,
        staging,
        token,
        ENCODER,
        intoFolder(folder, { policy: 'skip', asked }),
        services,
      ),
    );
    expect(skipped.kind).toBe('refused');
    const overwritten = expectSuccess(
      await deliverStaged(
        session,
        staging,
        token,
        ENCODER,
        intoFolder(folder, { policy: 'overwrite', asked }),
        services,
      ),
    );
    expect(overwritten).toMatchObject({ kind: 'delivered', replaced: 'chosen' });
    expect(folder.files.get('Footsteps.wav')).toEqual(WHOLE);
    expect(asked).toEqual([]);
  });

  it('overwrites silently in a trusted folder a file it exported there unchanged, and asks about one changed since', async () => {
    const { session, staging, services, staged } = await setUp();
    const earlier = Uint8Array.from([5, 5, 5]);
    const record = {
      name: 'Footsteps.wav',
      size: earlier.length,
      hash: createHash('sha256').update(earlier).digest('hex'),
    };
    const folder = new MemoryFolder();
    folder.files.set('Footsteps.wav', earlier);
    const asked: string[] = [];
    const trusted = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { trusted: [record], asked }),
        services,
      ),
    );
    expect(trusted).toMatchObject({ kind: 'delivered', replaced: 'trusted' });
    expect(asked).toEqual([]);
    expect(session.getSnapshot().model.exports[0]?.destination.kind).toBe(
      ExportDestinationKind.TrustedDirectory,
    );

    // The file there now is the one just written, which no record given names.
    const changed = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { trusted: [record], asked }),
        services,
      ),
    );
    expect(changed.kind).toBe('refused');
    expect(asked).toEqual(['Footsteps.wav']);
  });

  it('refuses a destination it may not write, or one that refuses the file, keeping the export staged', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const { token } = await staged();
    const locked = new MemoryFolder();
    locked.access = () => Promise.resolve('needs-permission');
    const needed = expectSuccess(
      await deliverStaged(session, staging, token, ENCODER, intoFolder(locked), services),
    );
    expect(needed.kind === 'refused' ? needed.failure.code : needed.kind).toBe(
      'export.permission-needed',
    );

    const withdrawn = new MemoryFolder();
    withdrawn.refuseWrites = true;
    const refused = expectSuccess(
      await deliverStaged(session, staging, token, ENCODER, intoFolder(withdrawn), services),
    );
    expect(refused.kind === 'refused' ? refused.failure.code : refused.kind).toBe(
      'export.destination-unavailable',
    );
    expect(withdrawn.files.size).toBe(0);
    expect(stagedFiles()).toHaveLength(3);
  });

  it('writes a save dialog’s file whole, recorded by the file’s name', async () => {
    const { session, staging, services, staged } = await setUp();
    let written: Uint8Array | undefined;
    const parts: number[] = [];
    const delivery = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        {
          kind: 'file',
          file: {
            name: 'Take 3.wav',
            access: () => Promise.resolve('granted'),
            open: () =>
              Promise.resolve({
                write: (chunk) => {
                  parts.push(...chunk);
                  return Promise.resolve();
                },
                close: () => {
                  written = Uint8Array.from(parts);
                  return Promise.resolve();
                },
                abort: () => Promise.resolve(),
              }),
          },
        },
        services,
      ),
    );
    expect(delivery).toMatchObject({ kind: 'delivered', name: 'Take 3.wav' });
    expect(written).toEqual(WHOLE);
    expect(session.getSnapshot().model.exports[0]?.destination).toEqual({
      kind: ExportDestinationKind.File,
      label: 'Take 3.wav',
    });
  });

  it('fails where the export is no longer staged', async () => {
    const { session, staging, services, staged, tree } = await setUp();
    const { token } = await staged();
    // Storage pressure gave the staging up.
    await tree.remove('cache/staging');
    expect(
      expectFailureCode(
        await deliverStaged(
          session,
          staging,
          token,
          ENCODER,
          intoFolder(new MemoryFolder()),
          services,
        ),
      ),
    ).toBe('export.staged-missing');
    expect(staging.staged(token)).toBeUndefined();
  });
});

describe('delivering into a relative folder (ADR-0102)', () => {
  /** The record of `bytes` exported to `name`, as a trusted folder keeps it. */
  function recordOf(name: string, bytes: Uint8Array) {
    return { name, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
  }

  /** The code a delivery was refused with, or its kind where it was not. */
  function refusal(delivery: Awaited<ReturnType<typeof deliverStaged>>): string {
    const answer = expectSuccess(delivery);
    return answer.kind === 'refused' ? answer.failure.code : answer.kind;
  }

  it('makes the folders the path names, writes into the last, and records the file by its name', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    const delivery = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { path: ['sfx', 'Footsteps'] }),
        services,
      ),
    );

    expect(delivery).toMatchObject({ kind: 'delivered', name: 'Footsteps.wav', replaced: 'none' });
    expect(folder.at('sfx', 'Footsteps')?.files.get('Footsteps.wav')).toEqual(WHOLE);
    expect(folder.files.size).toBe(0);
    expect(folder.asked).toEqual(['sfx', 'Footsteps']);
    expect(stagedFiles()).toEqual([]);
    expect(session.getSnapshot().model.exports[0]).toMatchObject({
      destination: { kind: ExportDestinationKind.Directory, label: 'Game sounds' },
      file: { fileName: 'Footsteps.wav' },
    });
  });

  it('decides a taken name from the listing of the folder written into, not the folder chosen', async () => {
    const { session, staging, services, staged } = await setUp();
    const folder = new MemoryFolder();
    folder.files.set('Footsteps.wav', Uint8Array.from([7]));
    const asked: string[] = [];
    const first = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { path: ['sfx'], asked }),
        services,
      ),
    );
    expect(first).toMatchObject({ kind: 'delivered', replaced: 'none' });
    expect(asked).toEqual([]);

    // The folder is there now, holding the file: the next delivery into it asks.
    const second = await deliverStaged(
      session,
      staging,
      (await staged()).token,
      ENCODER,
      intoFolder(folder, { path: ['sfx'], asked }),
      services,
    );
    expect(refusal(second)).toBe('export.collision-skipped');
    expect(asked).toEqual(['Footsteps.wav']);
    expect(folder.files.get('Footsteps.wav')).toEqual(Uint8Array.from([7]));
  });

  it('overwrites silently in a trusted folder only where the record of that path matches', async () => {
    const { session, staging, services, staged } = await setUp();
    const earlier = Uint8Array.from([5, 5, 5]);
    const folder = new MemoryFolder();
    const sfx = new MemoryFolder('sfx');
    folder.folders.set('sfx', sfx);
    sfx.files.set('Footsteps.wav', earlier);
    folder.files.set('Footsteps.wav', earlier);
    const asked: string[] = [];

    // A record of the file in the trusted folder itself does not speak for one inside it.
    const elsewhere = await deliverStaged(
      session,
      staging,
      (await staged()).token,
      ENCODER,
      intoFolder(folder, { path: ['sfx'], trusted: [recordOf('Footsteps.wav', earlier)], asked }),
      services,
    );
    expect(refusal(elsewhere)).toBe('export.collision-skipped');
    expect(asked).toEqual(['Footsteps.wav']);

    // Nor one of the file inside it for the one in the trusted folder itself.
    const above = await deliverStaged(
      session,
      staging,
      (await staged()).token,
      ENCODER,
      intoFolder(folder, { trusted: [recordOf('sfx/Footsteps.wav', earlier)], asked }),
      services,
    );
    expect(refusal(above)).toBe('export.collision-skipped');
    expect(asked).toEqual(['Footsteps.wav', 'Footsteps.wav']);

    const trusted = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, {
          path: ['sfx'],
          trusted: [recordOf('sfx/Footsteps.wav', earlier)],
          asked,
        }),
        services,
      ),
    );
    expect(trusted).toMatchObject({ kind: 'delivered', replaced: 'trusted' });
    expect(asked).toHaveLength(2);
    expect(sfx.files.get('Footsteps.wav')).toEqual(WHOLE);
    expect(folder.files.get('Footsteps.wav')).toEqual(earlier);
  });

  it.each([
    ['a step out', ['..']],
    ['a step that stays', ['sfx', '.']],
    ['an empty name, as an absolute path starts', ['', 'sfx']],
    ['a separator inside a name', ['sfx/ui']],
    ['a backslash inside a name', ['sfx\\ui']],
    ['a drive', ['C:', 'sfx']],
    ['a name a file system changes', ['sfx ']],
  ])(
    'refuses %s before it asks the folder anything, keeping the export staged',
    async (_case, path) => {
      const { session, staging, services, staged, stagedFiles } = await setUp();
      const folder = new MemoryFolder();
      const { token } = await staged();
      expect(
        refusal(
          await deliverStaged(
            session,
            staging,
            token,
            ENCODER,
            intoFolder(folder, { path }),
            services,
          ),
        ),
      ).toBe('export.destination-path-invalid');
      expect(folder.asked).toEqual([]);
      expect(folder.folders.size + folder.files.size).toBe(0);
      expect(stagedFiles()).toHaveLength(3);
      expect(session.getSnapshot().model.exports).toEqual([]);
    },
  );

  it('refuses a path through a file, leaving the folder as it was and the export staged', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    folder.files.set('sfx', Uint8Array.from([1]));
    const delivery = expectSuccess(
      await deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { path: ['sfx', 'ui'] }),
        services,
      ),
    );
    expect(delivery).toMatchObject({
      kind: 'refused',
      failure: { code: 'export.destination-folder-taken', details: { path: 'sfx' } },
    });
    expect([...folder.files.keys()]).toEqual(['sfx']);
    expect(folder.folders.size).toBe(0);
    expect(stagedFiles()).toHaveLength(3);
  });

  it('abandons the file where its write is refused, so the folders made are taken back, keeping the export staged', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    folder.refuseWrites = true;
    const delivery = await deliverStaged(
      session,
      staging,
      (await staged()).token,
      ENCODER,
      intoFolder(folder, { path: ['sfx', 'ui'] }),
      services,
    );
    expect(refusal(delivery)).toBe('export.destination-unavailable');
    expect(folder.folders.size).toBe(0);
    expect(stagedFiles()).toHaveLength(3);
    expect(session.getSnapshot().model.exports).toEqual([]);
  });

  it('stops walking the path when cancelled, making nothing', async () => {
    const { session, staging, services, staged, stagedFiles } = await setUp();
    const folder = new MemoryFolder();
    const controller = new AbortController();
    const walked = folder.folder.bind(folder);
    folder.folder = async (name) => {
      const inner = await walked(name);
      controller.abort(new Error('Called off.'));
      return inner;
    };
    await expect(
      deliverStaged(
        session,
        staging,
        (await staged()).token,
        ENCODER,
        intoFolder(folder, { path: ['sfx', 'ui'] }),
        services,
        controller.signal,
      ),
    ).rejects.toThrow('Called off.');
    expect(folder.asked).toEqual(['sfx']);
    expect(folder.folders.size).toBe(0);
    expect(stagedFiles()).toHaveLength(3);
  });
});
