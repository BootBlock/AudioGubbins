import { describe, expect, it } from 'vitest';

import { TreeFailure, TreeFailureKind, isTreePath, isTreeSegment } from './storage-tree.js';

describe('a path in the storage tree', () => {
  it('accepts the names the storage writes', () => {
    expect(isTreePath('projects/0a1b2c3d-00000000/head-0.json')).toBe(true);
    expect(isTreePath(`media/c1-${'a'.repeat(64)}`)).toBe(true);
    expect(isTreePath('')).toBe(true);
  });

  it('refuses a segment that could climb out of the tree or differ by file system', () => {
    for (const path of ['..', 'a/../b', '/a', 'a//b', 'a/', '.hidden', 'Upper', 'a\b', 'a b']) {
      expect(isTreePath(path), path).toBe(false);
    }
    expect(isTreeSegment('x'.repeat(129))).toBe(false);
    expect(isTreeSegment('x'.repeat(128))).toBe(true);
  });
});

describe('a refusal of the storage tree', () => {
  it('keeps its kind and the platform error as its cause', () => {
    const cause = new Error('QuotaExceededError');
    const refusal = new TreeFailure(TreeFailureKind.Quota, 'The storage is full.', { cause });

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.kind).toBe('quota');
    expect(refusal.cause).toBe(cause);
    expect(refusal.name).toBe('TreeFailure');
  });
});
