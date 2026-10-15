import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { destinationPath } from './destination-path.js';

/** Where each refusal of `segments` points: the folder's index, or the count it has too many. */
function refusedAt(
  segments: readonly string[],
): readonly (string | number | boolean | undefined)[] {
  const result = destinationPath(segments);
  if (result.ok) throw new Error(`Expected ${segments.join('/')} to be refused.`);
  return result.failures.map((failure) => {
    expect(failure.code).toBe('game.destination-invalid');
    return failure.details?.['index'] ?? failure.details?.['segments'];
  });
}

describe('a destination path', () => {
  it('holds the folders it is given, outermost first', () => {
    expect(expectSuccess(destinationPath(['audio', 'Foot steps', 'grass_01']))).toEqual({
      segments: ['audio', 'Foot steps', 'grass_01'],
    });
  });

  it('may be no folder at all: the folder the export goes to', () => {
    expect(expectSuccess(destinationPath([]))).toEqual({ segments: [] });
  });

  it('descends at most 16 folders', () => {
    expectSuccess(destinationPath(Array.from({ length: 16 }, (_, index) => `f${String(index)}`)));
    expect(refusedAt(Array.from({ length: 17 }, () => 'f'))).toEqual([17]);
  });

  it('refuses . and .., which step out of the folder', () => {
    expect(refusedAt(['audio', '.'])).toEqual([1]);
    expect(refusedAt(['..', 'audio'])).toEqual([0]);
    const result = destinationPath(['..']);
    expect(result.ok ? undefined : result.failures[0].summary).toBe(
      'The destination\'s folder ".." would step out of the folder it is in; name a folder.',
    );
  });

  it('refuses a folder name a common file system would not take as it is, never repairing it', () => {
    const unsafe = ['a/b', 'a\\b', 'a:b', 'CON', 'lpt1.txt', ' lead', 'trail.', '', 'Café'];
    for (const segment of unsafe) {
      expect(refusedAt(['audio', segment]), JSON.stringify(segment)).toEqual([1]);
    }
    const result = destinationPath(['a:b']);
    expect(result.ok ? undefined : result.failures[0].details).toEqual({ index: 0, safe: 'a_b' });
  });

  it('names every refused folder at once', () => {
    expect(refusedAt(['ok', 'a?b', 'fine', '..', 'NUL'])).toEqual([1, 3, 4]);
  });
});
