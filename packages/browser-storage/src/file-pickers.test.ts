import { countingTokens } from '@audiogubbins/media-store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { filesFromInput } from './external-files.js';
import { FileHandleKeeper } from './file-handle-keeper.js';
import { filesInDirectory, pickDirectory, pickFiles, pickSaveFile } from './file-pickers.js';
import { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './testing/file-handles.js';
import { MemoryDatabases } from './testing/memory-indexed-db.js';

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

const fileHandle = (name: string): FakeFileHandle =>
  new FakeFileHandle(new File(['x'], name, { type: 'audio/wav', lastModified: 5 }));

const dismissed = (): Promise<unknown> =>
  Promise.reject(new DOMException('The user dismissed the picker.', 'AbortError'));

describe('choosing files through the pickers', () => {
  it('keeps the handle of each file chosen, and hands each over as the media store takes it', async () => {
    const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
    const chosen = [fileHandle('one.wav'), fileHandle('two.wav')];
    const asked: object[] = [];
    const picked = await pickFiles(
      (options) => {
        asked.push(options);
        return Promise.resolve(chosen);
      },
      keeper,
      { multiple: true },
    );

    expect(asked).toEqual([{ multiple: true }]);
    expect(picked).toMatchObject({
      kind: 'picked',
      chosen: [
        { fileName: 'one.wav', mediaType: 'audio/wav', lastModified: 5, handleKey: 't1' },
        { fileName: 'two.wav', handleKey: 't2' },
      ],
    });
    expect(await keeper.find('t2')).toBe(chosen[1]);
  });

  it('hands files over without a key where no keeper is given', async () => {
    const picked = await pickFiles(() => Promise.resolve([fileHandle('one.wav')]), undefined, {
      multiple: false,
    });
    expect(picked.kind === 'picked' && picked.chosen[0]?.handleKey).toBeUndefined();
  });

  it('answers cancelled where the user dismisses any picker, and refuses anything else it throws', async () => {
    expect(await pickFiles(dismissed, undefined, { multiple: true })).toEqual({
      kind: 'cancelled',
    });
    expect(await pickDirectory(dismissed, 'readwrite')).toEqual({ kind: 'cancelled' });
    expect(await pickSaveFile(dismissed, 'project.zip')).toEqual({ kind: 'cancelled' });

    const outsideAGesture = new DOMException('Needs a gesture.', 'SecurityError');
    await expect(
      pickFiles(() => Promise.reject(outsideAGesture), undefined, { multiple: true }),
    ).rejects.toBe(outsideAGesture);
  });

  it('refuses what a picker hands back where it is not what was asked for', async () => {
    await expect(
      pickFiles(() => Promise.resolve(['one.wav']), undefined, { multiple: true }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      pickDirectory(() => Promise.resolve(fileHandle('one.wav')), 'read'),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('asks for a folder in the mode it is wanted for, and where to save by a suggested name', async () => {
    const folder = new FakeDirectoryHandle('Backups', []);
    const asked: object[] = [];
    const ask = (answer: unknown) => (options: object) => {
      asked.push(options);
      return Promise.resolve(answer);
    };
    expect(await pickDirectory(ask(folder), 'readwrite')).toEqual({
      kind: 'picked',
      chosen: folder,
    });
    const target = fileHandle('project.zip');
    expect(await pickSaveFile(ask(target), 'project.zip')).toEqual({
      kind: 'picked',
      chosen: target,
    });
    expect(asked).toEqual([{ mode: 'readwrite' }, { suggestedName: 'project.zip' }]);
  });
});

describe('the files in a folder the user chose', () => {
  it('walks every folder inside it, giving each file where it lies and keeping its handle', async () => {
    const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
    const folder = new FakeDirectoryHandle('Session', [
      fileHandle('mix.wav'),
      new FakeDirectoryHandle('stems', [
        fileHandle('drums.wav'),
        new FakeDirectoryHandle('old', [fileHandle('bass.wav')]),
      ]),
    ]);

    const found = [];
    for await (const file of filesInDirectory(folder, keeper)) found.push(file);

    expect(found.map(({ relativePath, handleKey }) => [relativePath, handleKey])).toEqual([
      ['mix.wav', 't1'],
      ['stems/drums.wav', 't2'],
      ['stems/old/bass.wav', 't3'],
    ]);
  });

  it('stops between files once the signal aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('Cancelled.');
    const folder = new FakeDirectoryHandle('Session', [fileHandle('a.wav'), fileHandle('b.wav')]);
    const walk = filesInDirectory(folder, undefined, controller.signal);

    expect((await walk.next()).value).toMatchObject({ fileName: 'a.wav' });
    controller.abort(reason);
    await expect(walk.next()).rejects.toBe(reason);
  });
});

describe("files from the page's own file input", () => {
  it('hands each over with no key, and where it lies inside a chosen folder', () => {
    const alone = new File(['x'], 'alone.wav', { type: 'audio/wav', lastModified: 7 });
    const inFolder = new File(['y'], 'kick.wav');
    // Every browser gives each file the path; the test environment gives none.
    Object.defineProperty(alone, 'webkitRelativePath', { value: '' });
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: 'Session/stems/kick.wav' });

    const [first, second] = filesFromInput([alone, inFolder]);
    expect(first).toMatchObject({ fileName: 'alone.wav', mediaType: 'audio/wav', lastModified: 7 });
    expect(first).not.toHaveProperty('relativePath');
    expect(first).not.toHaveProperty('handleKey');
    expect(second?.relativePath).toBe('stems/kick.wav');
    expect(second?.source.size).toBe(1);
  });
});
