import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { checkedFile, type ExternalFile } from './external-file.js';
import { memorySource } from './testing/index.js';

function fileOf(extra: Partial<ExternalFile>): ExternalFile {
  return {
    source: memorySource(new Uint8Array(0)),
    fileName: 'Take 1.wav',
    mediaType: 'audio/wav',
    lastModified: 1_780_000_000_000,
    ...extra,
  };
}

function codesOf(file: ExternalFile): readonly string[] {
  const checked = checkedFile(file);
  return checked.ok ? [] : checked.failures.map((problem) => problem.code);
}

describe('what a file says about itself', () => {
  it('normalises the media type the platform reports', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['audio/wav', 'audio/wav'],
      ['Audio/X-WAV', 'audio/x-wav'],
      ['audio/ogg; codecs=opus', 'audio/ogg'],
      ['  audio/flac  ', 'audio/flac'],
      ['', 'application/octet-stream'],
      ['audio', 'application/octet-stream'],
      ['audio/wav/extra', 'application/octet-stream'],
      [`audio/${'x'.repeat(250)}`, 'application/octet-stream'],
    ];
    for (const [reported, recorded] of cases) {
      expect(expectSuccess(checkedFile(fileOf({ mediaType: reported }))).mediaType, reported).toBe(
        recorded,
      );
    }
  });

  it('keeps the optional signals only where they are given', () => {
    expect(expectSuccess(checkedFile(fileOf({})))).toEqual({
      fileName: 'Take 1.wav',
      mediaType: 'audio/wav',
      lastModified: 1_780_000_000_000,
    });
    expect(
      expectSuccess(
        checkedFile(fileOf({ handleKey: 'h:0001', relativePath: 'Takes/Day 2/Take 1.wav' })),
      ),
    ).toMatchObject({ handleKey: 'h:0001', relativePath: 'Takes/Day 2/Take 1.wav' });
  });

  it('refuses a handle token that names the backups folder’s kept handle', () => {
    expect(codesOf(fileOf({ handleKey: 'folder:backups' }))).toEqual([
      'media.handle-key-malformed',
    ]);
  });

  it('refuses every signal that cannot be recorded, all at once', () => {
    expect(
      codesOf(
        fileOf({
          fileName: 'C:\\Users\\name\\Take 1.wav',
          lastModified: -1,
          handleKey: 'handles/1',
          relativePath: '../Take 1.wav',
        }),
      ),
    ).toEqual([
      'media.file-name-malformed',
      'media.last-modified-malformed',
      'media.handle-key-malformed',
      'media.relative-path-malformed',
    ]);
  });
});
