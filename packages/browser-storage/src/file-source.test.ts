import { describe, expect, it } from 'vitest';

import { fileSource } from './file-source.js';

const file = (text: string, lastModified = 1_000): File =>
  new File([text], 'take.wav', { lastModified });

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('a file the user chose, read in ranges', () => {
  it('reads each range asked for, and short past the end', async () => {
    const source = fileSource(file('abcdef'));
    expect(source.size).toBe(6);
    expect(text(await source.read(1, 3))).toBe('bcd');
    expect(text(await source.read(4, 10))).toBe('ef');
  });

  it.each([
    ['its size', file('abcdefg')],
    ['its modification time', file('abcdef', 2_000)],
  ])('reads nothing once the file its handle names has changed %s', async (_what, changed) => {
    let current = file('abcdef');
    const source = fileSource(file('abcdef'), () => Promise.resolve(current));
    expect(text(await source.read(0, 2))).toBe('ab');

    current = changed;
    expect(await source.read(0, 2)).toEqual(new Uint8Array(0));
  });

  it('reads nothing once the file its handle names has gone', async () => {
    const source = fileSource(file('abcdef'), () =>
      Promise.reject(new DOMException('Gone.', 'NotFoundError')),
    );
    expect(await source.read(0, 2)).toEqual(new Uint8Array(0));
  });

  it('reads nothing where the browser refuses a file that changed under it', async () => {
    const changed = file('abcdef');
    changed.slice = () => {
      const refused = new Blob();
      refused.arrayBuffer = () =>
        Promise.reject(new DOMException('The file changed.', 'NotReadableError'));
      return refused;
    };
    expect(await fileSource(changed).read(0, 2)).toEqual(new Uint8Array(0));
  });

  it('rejects with the reason where the signal aborts, and refuses a range of no whole numbers', async () => {
    const source = fileSource(file('abcdef'));
    const reason = new Error('Cancelled.');
    await expect(source.read(0, 2, AbortSignal.abort(reason))).rejects.toBe(reason);
    await expect(source.read(0.5, 2)).rejects.toBeInstanceOf(RangeError);
  });
});
