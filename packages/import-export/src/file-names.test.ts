import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { safeFileName } from './file-name-safety.js';
import {
  fillFileNameTemplate,
  readFileNameTemplate,
  type FileNameValues,
} from './file-name-template.js';

/** 2026-10-10 23:30 UTC. */
const LATE_EVENING = Date.UTC(2026, 9, 10, 23, 30);

const VALUES: FileNameValues = {
  project: 'Door slam',
  region: 'Creak',
  index: 3,
  count: 12,
  clock: { epochMilliseconds: LATE_EVENING, utcOffsetMinutes: 0 },
  extension: 'wav',
};

function filled(template: string, values: Partial<FileNameValues> = {}): string {
  return fillFileNameTemplate(expectSuccess(readFileNameTemplate(template)), {
    ...VALUES,
    ...values,
  });
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('the file name template', () => {
  it('fills every token', () => {
    expect(filled('{project} - {region} {index} {date}.{format}')).toBe(
      'Door slam - Creak 03 2026-10-10.wav',
    );
  });

  it('pads the index to the width of the batch count', () => {
    expect(filled('{index}', { index: 7, count: 9 })).toBe('7');
    expect(filled('{index}', { index: 7, count: 100 })).toBe('007');
  });

  it("takes the date from the clock at the caller's offset from UTC", () => {
    expect(
      filled('{date}', { clock: { epochMilliseconds: LATE_EVENING, utcOffsetMinutes: 60 } }),
    ).toBe('2026-10-11');
    expect(
      filled('{date}', { clock: { epochMilliseconds: LATE_EVENING, utcOffsetMinutes: -24 * 60 } }),
    ).toBe('2026-10-09');
  });

  it('reads doubled braces as braces', () => {
    expect(filled('{{{project}}}')).toBe('{Door slam}');
  });
});

describe('a safe file name', () => {
  it('replaces every character a common file system forbids, and every control character', () => {
    expect(safeFileName({ stem: 'a<b>c:d"e/f\\g|h?i*j\u0001k\u007fl', extension: 'wav' })).toBe(
      'a_b_c_d_e_f_g_h_i_j_k_l.wav',
    );
  });

  it('drops leading dots and spaces, and trailing dots and spaces', () => {
    expect(safeFileName({ stem: ' .hidden take. . ', extension: 'flac' })).toBe('hidden take.flac');
  });

  it('gives a Windows device name a leading underscore, in any case and before any dot', () => {
    for (const stem of ['CON', 'con', 'Aux', 'nul.backup', 'COM1', 'lpt9', 'COM¹', 'prn ']) {
      expect(safeFileName({ stem, extension: 'wav' }).startsWith('_')).toBe(true);
    }
    expect(safeFileName({ stem: 'console', extension: 'wav' })).toBe('console.wav');
    expect(safeFileName({ stem: 'COM10', extension: 'wav' })).toBe('COM10.wav');
  });

  it('names an empty stem "export"', () => {
    expect(safeFileName({ stem: ' ..', extension: 'mp3' })).toBe('export.mp3');
  });

  it('writes the name as NFC', () => {
    expect(safeFileName({ stem: 'Café', extension: 'wav' })).toBe('Café.wav');
  });

  it('keeps the name within 255 bytes of UTF-8, cutting whole code points from the stem', () => {
    const stem = '🔊'.repeat(100);
    const name = safeFileName({ stem, extension: 'opus' });
    expect(utf8Bytes(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith('🔊.opus')).toBe(true);
    expect(name).toBe(`${'🔊'.repeat(62)}.opus`);
    const copied = safeFileName({ stem, extension: 'opus' }, 12);
    expect(utf8Bytes(copied)).toBeLessThanOrEqual(255);
    expect(copied.endsWith('🔊 (12).opus')).toBe(true);
  });

  it('keeps a name of exactly 255 bytes whole', () => {
    const stem = 'a'.repeat(251);
    expect(safeFileName({ stem, extension: 'wav' })).toBe(`${stem}.wav`);
    expect(safeFileName({ stem: `${stem}b`, extension: 'wav' })).toBe(`${stem}.wav`);
  });
});
