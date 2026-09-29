import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { contentIdFrom, type ExternalSourceIdentity } from '@audiogubbins/project-format';

import { classifySource, type SourceObservation } from './source-classification.js';

const WAVE = '52494646a086010057415645666d7420'; // RIFF, a length, WAVE, fmt
const FLAC = '664c61430000002210001000000e';
const idOf = (digit: string) => expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));

const recorded: ExternalSourceIdentity = {
  handleKey: 'handle-0001',
  fileName: 'Take 1.wav',
  relativePath: 'Takes/Take 1.wav',
  byteLength: 100_000,
  lastModified: 1_780_000_000_000,
  mediaType: 'audio/wav',
  signature: WAVE,
  fastFingerprint: 'a'.repeat(64),
};

function present(extra: Partial<ExternalSourceIdentity> = {}): SourceObservation {
  return { kind: 'present', file: { ...recorded, ...extra } };
}

const EDITED = { fastFingerprint: 'b'.repeat(64), byteLength: 120_000 };

describe('what became of an external source', () => {
  it('finds the file unchanged by its sampled signals, whatever its modification time', () => {
    const touched = classifySource(recorded, present({ lastModified: 1_790_000_000_000 }));

    expect(touched).toEqual({
      kind: 'unchanged',
      confidence: 'sampled',
      evidence: {
        byteLength: 'same',
        fastFingerprint: 'same',
        contentId: 'unknown',
        containerKind: 'same',
        mediaType: 'same',
        lastModified: 'different',
        handleKey: 'same',
        relativePath: 'same',
      },
    });
  });

  it('proves the file unchanged where both full content identities are known', () => {
    const known = { ...recorded, contentId: idOf('1') };

    expect(classifySource(known, present({ contentId: idOf('1') }))).toMatchObject({
      kind: 'unchanged',
      confidence: 'content-identity',
    });
  });

  it('lets differing full content identities decide, whatever the fingerprints say', () => {
    const known = { ...recorded, contentId: idOf('1') };

    expect(classifySource(known, present({ contentId: idOf('2') })).kind).toBe('modified');
  });

  it('never takes an unchanged modification time for sameness', () => {
    expect(classifySource(recorded, present({ fastFingerprint: 'b'.repeat(64) })).kind).toBe(
      'modified',
    );
  });

  it('finds an edited file of the same kind modified, whichever container bytes an edit changes', () => {
    const edits: readonly (readonly [string, string, string])[] = [
      ['a sized container of a new length', WAVE, '52494646b086010057415645666d7420'],
      ['an AIFF of a new length', '464f524d00001000414946460000', '464f524d00002000414946460000'],
      ['a frame header of another rate', 'fffb9064000000000000', 'fffbb064000000000000'],
      ['a tag of another version', '4944330300000000', '4944330400000000'],
      ['a box of a new length', '0000001c667479704d344120', '00000020667479704d344120'],
      ['a container known by its magic', FLAC, `${FLAC.slice(0, 8)}ffffffff`],
    ];
    for (const [edit, before, after] of edits) {
      expect(
        classifySource({ ...recorded, signature: before }, present({ ...EDITED, signature: after }))
          .kind,
        edit,
      ).toBe('modified');
    }
  });

  it('finds another kind of file in the old one’s place replaced', () => {
    const replacements: readonly (readonly [string, Partial<ExternalSourceIdentity>])[] = [
      ['another container', { signature: FLAC }],
      ['a sized container holding another form', { signature: `${WAVE.slice(0, 16)}41564920` }],
      ['another media type', { mediaType: 'audio/flac' }],
    ];
    for (const [difference, extra] of replacements) {
      expect(classifySource(recorded, present({ ...EDITED, ...extra })).kind, difference).toBe(
        'replaced',
      );
    }
  });

  it('finds the file missing, with the reason as data', () => {
    for (const reason of ['not-found', 'permission-refused', 'unreadable'] as const) {
      expect(classifySource(recorded, { kind: 'absent', reason })).toEqual({
        kind: 'missing',
        reason,
      });
    }
  });

  it('recognises an identical copy elsewhere, saying how sure it is', () => {
    const moved = { ...recorded, handleKey: 'handle-0002', relativePath: 'Moved/Take 1.wav' };
    const absent: SourceObservation = { kind: 'absent', reason: 'not-found' };

    const sampled = classifySource(recorded, absent, moved);
    const proven = classifySource({ ...recorded, contentId: idOf('3') }, absent, {
      ...moved,
      contentId: idOf('3'),
    });

    expect(sampled).toMatchObject({
      kind: 'relinked-identical',
      confidence: 'sampled',
      candidate: moved,
      evidence: { handleKey: 'different', relativePath: 'different', fastFingerprint: 'same' },
    });
    expect(proven).toMatchObject({ kind: 'relinked-identical', confidence: 'content-identity' });
  });

  it('prefers an identical copy to a modified file in the old place, and the old place to a copy', () => {
    const copy = { ...recorded, handleKey: 'handle-0002' };

    expect(classifySource(recorded, present(EDITED), copy).kind).toBe('relinked-identical');
    expect(classifySource(recorded, present(), copy).kind).toBe('unchanged');
  });

  it('ignores a candidate of other content', () => {
    const other = { ...recorded, handleKey: 'handle-0002', fastFingerprint: 'c'.repeat(64) };
    const absent: SourceObservation = { kind: 'absent', reason: 'permission-refused' };

    expect(classifySource(recorded, absent, other).kind).toBe('missing');
    expect(classifySource(recorded, present(EDITED), other).kind).toBe('modified');
    expect(
      classifySource({ ...recorded, contentId: idOf('4') }, absent, {
        ...recorded,
        contentId: idOf('5'),
      }).kind,
    ).toBe('missing');
  });
});
