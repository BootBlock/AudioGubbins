import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listedFolder, writableFolder } from './chosen-folders.js';
import { filesFromInput } from './external-files.js';
import { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './testing/file-handles.js';

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

const decoder = new TextDecoder();

/** A file a folder input gave, lying at `path` inside the folder chosen. */
function inputFile(path: string, text: string): File {
  const file = new File([text], path.split('/').at(-1) ?? path);
  Object.defineProperty(file, 'webkitRelativePath', { value: `Chosen/${path}` });
  return file;
}

async function textOf(folder: FakeDirectoryHandle, path: string): Promise<string | undefined> {
  const source = await writableFolder(folder).open(path);
  return source === undefined ? undefined : decoder.decode(await source.read(0, source.size));
}

describe('reading the files of a folder the person chose', () => {
  it('lists each file by where it lies inside the folder, and opens it', async () => {
    const reader = listedFolder(
      filesFromInput([
        inputFile('audiogubbins-project.json', '{}'),
        inputFile('history/nodes/a.json', 'node'),
      ]),
    );

    expect(await reader.list()).toEqual([
      { path: 'audiogubbins-project.json', size: 2 },
      { path: 'history/nodes/a.json', size: 4 },
    ]);
    const source = await reader.open('history/nodes/a.json');
    expect(source === undefined ? '' : decoder.decode(await source.read(0, 4))).toBe('node');
    expect(await reader.open('history/nodes/b.json')).toBeUndefined();
  });

  it('leaves out a file chosen alone, which lies in no folder', async () => {
    // A browser gives a file chosen alone an empty path, which jsdom leaves out.
    const loose = new File(['x'], 'loose.json');
    Object.defineProperty(loose, 'webkitRelativePath', { value: '' });
    const reader = listedFolder(filesFromInput([loose]));

    expect(await reader.list()).toEqual([]);
  });
});

describe('writing into a folder the directory picker gave', () => {
  it('makes the folders a path needs, and replaces a file once its sink closes', async () => {
    const folder = new FakeDirectoryHandle('Project', []);
    const writer = writableFolder(folder);

    const sink = await writer.create('history/nodes/a.json');
    await sink.write(new TextEncoder().encode('first'));
    expect(await textOf(folder, 'history/nodes/a.json')).toBe('');
    await sink.close();

    expect(await textOf(folder, 'history/nodes/a.json')).toBe('first');
    expect(await writer.list()).toEqual([{ path: 'history/nodes/a.json', size: 5 }]);
  });

  it('lists every file at any depth, and leaves a file it did not write as it was', async () => {
    const folder = new FakeDirectoryHandle('Project', [
      new FakeFileHandle(new File(['read me'], 'README.md')),
      new FakeDirectoryHandle('project', [new FakeFileHandle(new File(['{}'], 'settings.json'))]),
    ]);
    const writer = writableFolder(folder);

    const sink = await writer.create('project/track-order.json');
    await sink.write(new TextEncoder().encode('[]'));
    await sink.close();

    expect(await writer.list()).toEqual([
      { path: 'README.md', size: 7 },
      { path: 'project/settings.json', size: 2 },
      { path: 'project/track-order.json', size: 2 },
    ]);
  });

  it('removes a file, and finds nothing where there is nothing, without failing', async () => {
    const folder = new FakeDirectoryHandle('Project', [
      new FakeDirectoryHandle('exports', [new FakeFileHandle(new File(['{}'], 'e1.json'))]),
    ]);
    const writer = writableFolder(folder);

    await writer.remove('exports/e1.json');
    await writer.remove('exports/e1.json');
    await writer.remove('missing/e2.json');

    expect(await writer.list()).toEqual([]);
    expect(await writer.open('exports/e1.json')).toBeUndefined();
    expect(await writer.open('missing/e2.json')).toBeUndefined();
  });

  it("makes a refusal of the platform the storage's failure of its kind", async () => {
    const folder = new FakeDirectoryHandle('Project', []);
    vi.spyOn(folder, 'getDirectoryHandle').mockRejectedValue(
      new DOMException('The folder can no longer be written.', 'NotAllowedError'),
    );

    const refused = writableFolder(folder).create('history/cursor.json');

    await expect(refused).rejects.toBeInstanceOf(TreeFailure);
    await expect(refused).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
  });
});
