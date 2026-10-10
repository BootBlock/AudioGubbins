import { describe, expect, it } from 'vitest';

import {
  containerName,
  formatName,
  namedFormat,
  unnamedFormat,
  type RecognisedFormat,
} from './recognised-format.js';

describe('a recognised format in a few words', () => {
  it.each([
    [namedFormat('ogg', 'vorbis'), 'Ogg, Vorbis'],
    [namedFormat('wav', 'pcm'), 'WAV, uncompressed PCM'],
    [unnamedFormat('ogg', 'Speex'), 'Ogg, Speex'],
    [{ kind: 'audio', container: 'mp4', codec: { kind: 'unstated' } }, 'MPEG-4'],
    [{ kind: 'unknown' }, 'Not a recognised audio format'],
  ] satisfies readonly (readonly [RecognisedFormat, string])[])(
    'names %o as %s',
    (format, name) => {
      expect(formatName(format)).toBe(name);
    },
  );

  it('names a container as a sentence does', () => {
    expect(containerName('aifc')).toBe('AIFF-C');
  });
});
