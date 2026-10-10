import { TreeFailure } from '@audiogubbins/project-format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileDestination, folderDestination } from './delivery-destinations.js';
import { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './testing/file-handles.js';

/**
 * An export's destinations in the browser (ADR-0092): a save dialog's file and
 * a folder, written through `createWritable`, which replaces a file only when
 * its stream closes, a folder left as it was where a write is abandoned.
 */

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

async function textOf(handle: FileSystemFileHandle): Promise<string> {
  return await (await handle.getFile()).text();
}

describe('an export’s destinations in the browser', () => {
  it('lists a folder’s entries, reads a file of it, and writes a new one whole', async () => {
    const old = new FakeFileHandle(new File(['old'], 'Step.wav'));
    const folder = folderDestination(
      new FakeDirectoryHandle('Game sounds', [old, new FakeDirectoryHandle('Music', [])]),
    );
    expect(folder.name).toBe('Game sounds');
    expect(await folder.access()).toBe('granted');
    expect(await folder.list()).toEqual(['Step.wav', 'Music']);
    const read = await folder.open('Step.wav');
    expect(read && new TextDecoder().decode(await read.read(0, read.size))).toBe('old');
    expect(await folder.open('Rain.wav')).toBeUndefined();

    const sink = await folder.create('Step.wav');
    await sink.write(new TextEncoder().encode('new'));
    expect(await textOf(old)).toBe('old');
    await sink.close();
    expect(await textOf(old)).toBe('new');
  });

  it('removes a file it made where its writing is abandoned, and leaves one it replaced as it was', async () => {
    const old = new FakeFileHandle(new File(['old'], 'Step.wav'));
    const folder = folderDestination(new FakeDirectoryHandle('Game sounds', [old]));
    const made = await folder.create('Rain.wav');
    await made.write(new Uint8Array([1]));
    await made.abort();
    const replaced = await folder.create('Step.wav');
    await replaced.write(new Uint8Array([1]));
    await replaced.abort();

    expect(await folder.list()).toEqual(['Step.wav']);
    expect(await textOf(old)).toBe('old');
  });

  it('says when a destination needs the person’s leave, and refuses as the tree does', async () => {
    const handle = new FakeDirectoryHandle('Game sounds', []);
    handle.permission.state = 'prompt';
    expect(await folderDestination(handle).access()).toBe('needs-permission');
    const file = new FakeFileHandle(new File([], 'Take.wav'));
    file.permission.state = 'denied';
    expect(await fileDestination(file).access()).toBe('needs-permission');

    const nested = folderDestination(
      new FakeDirectoryHandle('Game sounds', [new FakeDirectoryHandle('Step.wav', [])]),
    );
    await expect(nested.create('Step.wav')).rejects.toBeInstanceOf(TreeFailure);
  });

  it('writes a save dialog’s file, replacing it only once it closes', async () => {
    const handle = new FakeFileHandle(new File(['old'], 'Take.wav'));
    const file = fileDestination(handle);
    expect(file.name).toBe('Take.wav');
    const sink = await file.open();
    await sink.write(new TextEncoder().encode('new'));
    expect(await textOf(handle)).toBe('old');
    await sink.close();
    expect(await textOf(handle)).toBe('new');
  });
});
