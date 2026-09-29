import { describe, expect, it } from 'vitest';

import { soundBound, soundRefusal } from './sound-bound.js';

describe("the bound on extracting a picture's sound", () => {
  it('is a quarter of what the page says it has, or a fixed gibibyte where it says nothing', () => {
    expect(soundBound({ availableMemoryBytes: 4e9 })).toBe(1e9);
    expect(soundBound({ availableMemoryBytes: undefined })).toBe(1024 ** 3);
  });

  it('lets a short picture through', () => {
    // A minute at 48 kHz in eight channels is 92 MB, beside a 20 MB file.
    expect(soundRefusal(20e6, 60, 48_000, 1e9)).toBeUndefined();
  });

  it('refuses an hour-long reel, saying what it needs and what the page can spare', () => {
    // 1.5 GB of file and 5.5 GB of sound, counted at eight channels.
    expect(soundRefusal(1.5e9, 3600, 48_000, 1e9)).toBe(
      'Extracting the picture’s sound needs up to 7 GB: the 1.5 GB file, read whole, and 60 ' +
        'minutes of sound in up to 8 channels. This page can spare 1 GB for it.',
    );
  });

  it('counts the file and its sound together, since both are held while it decodes', () => {
    expect(soundRefusal(0, 60, 48_000, 92_160_000)).toBeUndefined();
    expect(soundRefusal(1, 60, 48_000, 92_160_000)).toBeDefined();
  });

  it('refuses a picture that does not say how long it is', () => {
    expect(soundRefusal(1000, Number.POSITIVE_INFINITY, 48_000, 1e9)).toBe(
      'The picture does not say how long it is, so the memory its sound needs cannot be told.',
    );
  });
});
