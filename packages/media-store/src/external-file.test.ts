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

  it('refuses each shape of name and path the project reader refuses', () => {
    for (const fileName of ['', 'a/b.wav', 'tab\there.wav', 'x'.repeat(1_025)]) {
      expect(codesOf(fileOf({ fileName })), fileName).toEqual(['media.file-name-malformed']);
    }
    for (const lastModified of [1.5, Number.NaN, 2 ** 53]) {
      expect(codesOf(fileOf({ lastModified }))).toEqual(['media.last-modified-malformed']);
    }
    for (const handleKey of ['', 'a b', 'x'.repeat(129)]) {
      expect(codesOf(fileOf({ handleKey })), handleKey).toEqual(['media.handle-key-malformed']);
    }
    for (const relativePath of ['/a.wav', 'a//b.wav', 'a/./b.wav', 'a/..', 'C:/a.wav', 'a\\b']) {
      expect(codesOf(fileOf({ relativePath })), relativePath).toEqual([
        'media.relative-path-malformed',
      ]);
    }
  });
});
