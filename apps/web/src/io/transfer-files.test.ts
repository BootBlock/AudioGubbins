import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseThroughInput } from './file-input.js';
import { browserTransferFiles } from './transfer-files.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** The file input the page has open, as a person meets it. */
function openInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No file input is open.');
  return input;
}

/** Answers the open input with `files`, as the browser does once a person chooses. */
function choose(files: readonly File[]): void {
  const input = openInput();
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe("asking for files through the page's own input", () => {
  it('opens an input of the kinds asked for, and settles with the files chosen', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const chosen = chooseThroughInput({ accept: '.zip' });

    expect(click).toHaveBeenCalledTimes(1);
    expect(openInput().accept).toBe('.zip');
    const file = new File(['x'], 'harbour.zip');
    choose([file]);

    expect(await chosen).toEqual([file]);
    expect(document.querySelector('input')).toBeNull();
  });

  it('settles with nothing where the person dismisses it, and takes it out of the page', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const chosen = chooseThroughInput({ folder: true });

    expect(openInput().webkitdirectory).toBe(true);
    openInput().dispatchEvent(new Event('cancel'));

    expect(await chosen).toEqual([]);
    expect(document.querySelector('input')).toBeNull();
  });
});

describe('passing files where the browser has no pickers', () => {
  it('offers a saved file as a download once its sink has closed', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:harbour');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const files = browserTransferFiles(undefined, undefined);

    const target = await files.save('Harbour.zip', 'application/zip');
    await target?.sink.write(new Uint8Array([1, 2, 3]));
    await target?.sink.close();
    target?.finish();

    expect(click).toHaveBeenCalledTimes(1);
    const [blob] = created.mock.calls[0] ?? [];
    expect(blob instanceof Blob && blob.type).toBe('application/zip');
    expect(blob instanceof Blob && blob.size).toBe(3);
    expect(files.chooseFolderToWrite).toBeUndefined();
  });

  it('hands over a bundle chosen through the input as itself, and a folder as its files', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const files = browserTransferFiles(undefined, undefined);

    const bundle = files.chooseBundle();
    // A file chosen alone lies in no folder, which a browser says with an empty
    // path jsdom leaves out.
    const alone = new File(['bundle'], 'Harbour.zip');
    Object.defineProperty(alone, 'webkitRelativePath', { value: '' });
    choose([alone]);
    expect(await bundle).toEqual({ name: 'Harbour.zip', bytes: { kind: 'file', file: alone } });

    const folder = files.chooseFolderToRead();
    const inside = new File(['{}'], 'audiogubbins-project.json');
    Object.defineProperty(inside, 'webkitRelativePath', {
      value: 'Harbour/audiogubbins-project.json',
    });
    choose([inside]);
    expect(await folder).toEqual({
      kind: 'files',
      files: [{ path: 'audiogubbins-project.json', file: inside }],
    });
  });

  it('hands over an audio file chosen through the input as itself, with no key to find it by', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const files = browserTransferFiles(undefined, undefined);

    const media = files.chooseMediaFile();
    const take = new File(['take'], 'take.wav', { type: 'audio/wav', lastModified: 9 });
    Object.defineProperty(take, 'webkitRelativePath', { value: '' });
    choose([take]);

    expect(await media).toEqual({
      fileName: 'take.wav',
      mediaType: 'audio/wav',
      lastModified: 9,
      bytes: { kind: 'file', file: take },
    });
  });

  it('brings nothing in where the person chooses nothing', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const files = browserTransferFiles(undefined, undefined);

    const bundle = files.chooseBundle();
    openInput().dispatchEvent(new Event('cancel'));
    expect(await bundle).toBeUndefined();
  });
});
