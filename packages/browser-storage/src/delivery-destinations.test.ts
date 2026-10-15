import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
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

  it('walks into a folder that is there, reading and writing in it as in the folder chosen', async () => {
    const old = new FakeFileHandle(new File(['old'], 'Step.wav'));
    const sfx = new FakeDirectoryHandle('sfx', [old]);
    const folder = folderDestination(new FakeDirectoryHandle('Game sounds', [sfx]));
    const inner = await folder.folder('sfx');
    expect(inner?.name).toBe('sfx');
    expect(await inner?.list()).toEqual(['Step.wav']);
    const sink = await inner?.create('Step.wav');
    await sink?.write(new TextEncoder().encode('new'));
    await sink?.close();
    expect(await textOf(old)).toBe('new');
  });

  it('answers no folder where a file has the name', async () => {
    const folder = folderDestination(
      new FakeDirectoryHandle('Game sounds', [new FakeFileHandle(new File([], 'sfx'))]),
    );
    expect(await folder.folder('sfx')).toBeUndefined();
  });

  it('makes a folder not there only when a file is created in it, with those above it', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    const folder = folderDestination(root);
    const ui = await (await folder.folder('sfx'))?.folder('ui');
    expect(ui?.name).toBe('ui');
    expect(await ui?.list()).toEqual([]);
    expect(await ui?.open('Click.wav')).toBeUndefined();
    // Walking made nothing: a delivery refused before it writes leaves the folder as it was.
    expect(await folder.list()).toEqual([]);

    const sink = await ui?.create('Click.wav');
    await sink?.write(new TextEncoder().encode('click'));
    await sink?.close();
    const made = await (await root.getDirectoryHandle('sfx')).getDirectoryHandle('ui');
    expect(await textOf(await made.getFileHandle('Click.wav'))).toBe('click');
  });

  it('takes back the folders it made where the file is abandoned, and leaves one that was there', async () => {
    const root = new FakeDirectoryHandle('Game sounds', [new FakeDirectoryHandle('sfx', [])]);
    const folder = folderDestination(root);
    const ui = await (await folder.folder('sfx'))?.folder('ui');
    const deeper = await ui?.folder('clicks');
    const sink = await deeper?.create('Click.wav');
    await sink?.write(new Uint8Array([1]));
    await sink?.abort();

    expect(await folder.list()).toEqual(['sfx']);
    expect(await folderDestination(await root.getDirectoryHandle('sfx')).list()).toEqual([]);
  });

  it('takes back what it made where making a folder is refused part-way, and reports the refusal', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    root.refuseMaking = (name) =>
      name === 'clicks' ? new DOMException('The disk is full.', 'QuotaExceededError') : undefined;
    const folder = folderDestination(root);
    const deeper = await (await (await folder.folder('sfx'))?.folder('ui'))?.folder('clicks');

    const refused = deeper?.create('Click.wav');
    await expect(refused).rejects.toBeInstanceOf(TreeFailure);
    await expect(refused).rejects.toMatchObject({ kind: TreeFailureKind.Quota });
    expect(await folder.list()).toEqual([]);
  });

  it('takes back what it made where the file itself is refused', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    root.refuseMaking = (name) =>
      name === 'Click.wav' ? new DOMException('Withdrawn.', 'NotAllowedError') : undefined;
    const folder = folderDestination(root);
    const ui = await (await folder.folder('sfx'))?.folder('ui');

    await expect(ui?.create('Click.wav')).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
    });
    expect(await folder.list()).toEqual([]);
  });

  it('stops making folders when cancelled, taking back what it made', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    const controller = new AbortController();
    root.refuseMaking = (name) => {
      if (name === 'ui') controller.abort(new Error('Called off.'));
      return undefined;
    };
    const folder = folderDestination(root);
    const deeper = await (await (await folder.folder('sfx'))?.folder('ui'))?.folder('clicks');

    await expect(deeper?.create('Click.wav', controller.signal)).rejects.toThrow('Called off.');
    expect(await folder.list()).toEqual([]);
    await expect(folder.folder('sfx', controller.signal)).rejects.toThrow('Called off.');
  });

  it('writes into a folder another program made meanwhile, keeping it, but never over a file put there', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    const folder = folderDestination(root);
    const sfx = await folder.folder('sfx');
    const theirs = new FakeFileHandle(new File(['theirs'], 'Step.wav'));
    root.add(new FakeDirectoryHandle('sfx', [theirs]));

    await expect(sfx?.create('Step.wav')).rejects.toBeInstanceOf(TreeFailure);
    expect(await textOf(theirs)).toBe('theirs');

    const sink = await sfx?.create('Rain.wav');
    await sink?.write(new Uint8Array([1]));
    await sink?.abort();
    expect(await folderDestination(await root.getDirectoryHandle('sfx')).list()).toEqual([
      'Step.wav',
    ]);
    expect(await folder.list()).toEqual(['sfx']);
  });

  it('keeps a folder it made where something else was put in it before the file was abandoned', async () => {
    const root = new FakeDirectoryHandle('Game sounds', []);
    const folder = folderDestination(root);
    const sink = await (await folder.folder('sfx'))?.create('Rain.wav');
    const made = await root.getDirectoryHandle('sfx');
    if (!(made instanceof FakeDirectoryHandle)) throw new Error('The fake makes fake folders.');
    made.add(new FakeFileHandle(new File(['theirs'], 'Wind.wav')));
    await sink?.abort();

    expect(await folderDestination(made).list()).toEqual(['Wind.wav']);
    expect(await folder.list()).toEqual(['sfx']);
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
