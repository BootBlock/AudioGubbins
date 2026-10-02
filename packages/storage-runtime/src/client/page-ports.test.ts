import { File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TreeFailure, TreeFailureKind, type ByteSink } from '@audiogubbins/project-format';
import { MemoryDirectory, memorySink } from '@audiogubbins/storage/testing';

import { pageBytes, pageFolder, pageSink, pageWriter } from '../host/remote-page-ports.js';
import { PortChannel } from '../protocol/port-channel.js';
import type { ClientChannel, HostChannel } from '../protocol/storage-operations.js';
import { portPair, type PortPair } from '../testing/port-pair.js';
import { PagePorts } from './page-ports.js';

/** A page lending its ports, and the worker's end that calls them. */
function lending(): {
  readonly pair: PortPair;
  readonly ports: PagePorts;
  readonly worker: HostChannel;
} {
  const pair = portPair();
  const page: ClientChannel = new PortChannel(pair.page);
  const ports = new PagePorts();
  page.serve(ports.handlers());
  return { pair, ports, worker: new PortChannel(pair.worker) };
}

/** The operations of every call the page was sent. */
function operationsCalled(pair: PortPair): string[] {
  return pair.toPage.flatMap((message) =>
    typeof message === 'object' && message !== null && 'operation' in message
      ? [String(message.operation)]
      : [],
  );
}

// jsdom's `File` clones to a plain object, where a browser clones the file
// itself, so these tests hold the platform's own.
beforeEach(() => {
  vi.stubGlobal('File', PlatformFile);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the ports the page lends the storage worker', () => {
  it('writes a sink the page lent, small writes together, and lets it go after', async () => {
    const { ports, worker } = lending();
    const sink = memorySink();
    const reached: number[] = [];
    const counted: ByteSink = {
      write: async (chunk) => {
        reached.push(chunk.length);
        await sink.write(chunk);
      },
      close: () => sink.close(),
      abort: () => sink.abort(),
    };
    const chunk = new Uint8Array([1, 2, 3, 4]);
    const large = new Uint8Array(70_000).fill(9);

    const lentWhileWriting = await ports.lending(async (lend) => {
      const remote = pageSink(worker, lend.sink(counted));
      await remote.write(chunk.subarray(1, 3));
      await remote.write(chunk);
      await remote.write(large);
      await remote.write(chunk);
      await remote.close();
      return ports.lent;
    });

    expect(reached).toEqual([6, 70_000, 4]);
    expect(Array.from(sink.bytes().subarray(0, 6))).toEqual([2, 3, 1, 2, 3, 4]);
    expect(sink.bytes()).toHaveLength(70_010);
    expect(sink.ending).toBe('closed');
    expect(chunk).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(large).toHaveLength(70_000);
    expect(lentWhileWriting).toBe(1);
    expect(ports.lent).toBe(0);
  });

  it('refuses the worker with the refusal the page met as the bytes reached it', async () => {
    const { ports, worker } = lending();
    const full: ByteSink = {
      write: () => Promise.reject(new TreeFailure(TreeFailureKind.Quota, 'The disc is full.')),
      close: () => Promise.resolve(),
      abort: () => Promise.resolve(),
    };

    const refusal: unknown = await ports.lending(async (lend) => {
      const remote = pageSink(worker, lend.sink(full));
      await remote.write(new Uint8Array(8));
      return await remote.close().catch((error: unknown) => error);
    });

    expect(refusal).toBeInstanceOf(TreeFailure);
    expect(refusal).toMatchObject({ kind: TreeFailureKind.Quota, message: 'The disc is full.' });
  });

  it('abandons a sink let go unclosed, and refuses the calls that come after', async () => {
    const { ports, worker } = lending();
    const sink = memorySink();

    const remote = await ports.lending(async (lend) => {
      const lent = pageSink(worker, lend.sink(sink));
      await lent.write(new Uint8Array([7]));
      return lent;
    });

    expect(sink.ending).toBe('aborted');
    expect(ports.lent).toBe(0);
    await expect(remote.close()).rejects.toThrow(/No sink is lent as port 0/);
  });

  it('reads a source the page lent, leaving the source its own buffer', async () => {
    const { ports, worker } = lending();
    const held = new Uint8Array([5, 6, 7, 8, 9]);
    const source = {
      size: held.length,
      read: (offset: number, length: number) =>
        Promise.resolve(held.subarray(offset, offset + length)),
    };

    const read = await ports.lending(
      async (lend) => await pageBytes(worker, lend.bytes({ kind: 'source', source })).read(1, 3),
    );

    expect(Array.from(read)).toEqual([6, 7, 8]);
    expect(held).toEqual(new Uint8Array([5, 6, 7, 8, 9]));
    expect(ports.lent).toBe(0);
  });

  it('passes a file the page holds as itself, which the worker reads without the page', async () => {
    const { pair, ports, worker } = lending();
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'take.wav', { type: 'audio/wav' });

    const read = await ports.lending(async (lend) => {
      const crossing = structuredClone(
        lend.folder({ kind: 'files', files: [{ path: 'a/take.wav', file }] }),
      );
      const folder = pageFolder(worker, crossing);
      const opened = await folder.open('a/take.wav');
      const bytes = Array.from((await opened?.read(2, 2)) ?? []);
      return { listed: await folder.list(), bytes, lent: ports.lent };
    });

    expect(read).toEqual({
      listed: [{ path: 'a/take.wav', size: 4 }],
      bytes: [3, 4],
      lent: 0,
    });
    expect(operationsCalled(pair)).toEqual([]);
  });

  it('lends what a folder opens and creates for the rest of the call that lent it', async () => {
    const { ports, worker } = lending();
    const folder = new MemoryDirectory();
    folder.files.set('project.json', new Uint8Array([1, 2]));
    folder.files.set('stale.json', new Uint8Array([3]));

    const lentAtMost = await ports.lending(async (lend) => {
      const writer = pageWriter(worker, lend.writer(folder));
      const opened = await writer.open('project.json');
      expect(Array.from((await opened?.read(0, 2)) ?? [])).toEqual([1, 2]);
      const sink = await writer.create('media/a.bin');
      await sink.write(new Uint8Array([4, 5]));
      await sink.close();
      await writer.create('media/b.bin');
      await writer.remove('stale.json');
      expect(await writer.list()).toEqual([
        { path: 'project.json', size: 2 },
        { path: 'media/a.bin', size: 2 },
      ]);
      return ports.lent;
    });

    expect(lentAtMost).toBe(4);
    expect(ports.lent).toBe(0);
    expect(folder.files.get('media/a.bin')).toEqual(new Uint8Array([4, 5]));
    expect(folder.files.has('media/b.bin')).toBe(false);
  });
});
