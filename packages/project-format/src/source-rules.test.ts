import { describe, expect, it } from 'vitest';

import type { JsonValue } from './canonical-json.js';
import { startReading } from './document-reading.js';
import { writeExternalIdentity } from './project-writing.js';
import { readExternalIdentity } from './source-reading.js';
import { isFileName, isHandleKey, isRelativePath } from './source-rules.js';

/** An identity whose optional signals each test sets. */
const IDENTITY = writeExternalIdentity({
  byteLength: 1,
  lastModified: 0,
  mediaType: 'audio/wav',
  signature: '',
  fastFingerprint: 'a'.repeat(64),
});

/** Whether the document's reader takes an identity with the member set to `text`. */
function readerTakes(member: string, text: JsonValue): boolean {
  const reading = startReading();
  readExternalIdentity(reading, { ...IDENTITY, [member]: text }, '', 'identity');
  return reading.outcome(true).ok;
}

const RULES = [
  {
    member: 'handleKey',
    check: isHandleKey,
    taken: ['h:0001', 'handle-0001', 'a.b_c', 'h:folder:1', 'Folder:1', 'x'.repeat(128)],
    refused: [
      '',
      'a b',
      'handles/1',
      'C:\\take.wav',
      'folder:backups',
      'folder:',
      'folder:anything-else',
      'x'.repeat(129),
    ],
  },
  {
    member: 'fileName',
    check: isFileName,
    taken: ['Take 1.wav', '.hidden', 'Forêt 中.flac', 'x'.repeat(1_024)],
    refused: ['', 'a/b.wav', 'C:\\Users\\name\\Take 1.wav', 'tab\there.wav', 'x'.repeat(1_025)],
  },
  {
    member: 'relativePath',
    check: isRelativePath,
    taken: ['Take 1.wav', 'Takes/Day 2/Take 1.wav', 'a/.hidden/b', 'a/.../b', 'x'.repeat(4_096)],
    refused: [
      '',
      '/a.wav',
      'a/',
      'a//b.wav',
      'a/./b.wav',
      './a.wav',
      'a/..',
      '..',
      'Sounds/../../secret.wav',
      'C:/a.wav',
      'a\\b',
      'a/\nb',
      'x'.repeat(4_097),
    ],
  },
] as const;

describe('the rules an external source is recorded by', () => {
  for (const { member, check, taken, refused } of RULES) {
    it(`takes a ${member} that is one and refuses one that is not`, () => {
      for (const text of taken) expect(check(text), text).toBe(true);
      for (const text of refused) expect(check(text), text).toBe(false);
    });

    it(`checks a ${member} exactly as the document's reader reads it`, () => {
      for (const text of [...taken, ...refused]) {
        expect(check(text), text).toBe(readerTakes(member, text));
      }
    });
  }
});
