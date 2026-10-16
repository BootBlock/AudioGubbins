import { describe, expect, it } from 'vitest';

import { chooseMember, withChoice } from './selection.js';

/** The deepest avoid-recent's depth, which the history keeps. */
const DEEPEST_RECENT = 16;

/** The first word that chooses `choice` of `n`: ⌈c·2³²/n⌉. */
function wordFor(choice: number, n: number): number {
  return Number(((BigInt(choice) << 32n) + BigInt(n) - 1n) / BigInt(n));
}

describe('uniform selection', () => {
  it('takes member ⌊u·n⌋ of the pool, whatever was chosen before', () => {
    expect(chooseMember({ kind: 'uniform' }, 4, [], wordFor(3, 4))).toBe(3);
    expect(chooseMember({ kind: 'uniform' }, 4, [3, 3, 3], wordFor(3, 4))).toBe(3);
    expect(chooseMember({ kind: 'uniform' }, 4, [], wordFor(3, 4) - 1)).toBe(2);
    expect(chooseMember({ kind: 'uniform' }, 1, [0], 0xffff_ffff)).toBe(0);
  });
});

describe('avoid-recent selection', () => {
  it('sets aside the last d chosen and takes ⌊u·m⌋ of those left, in pool order', () => {
    // Pool of 5, last chosen 1 then 3 (most recent first: 3, 1); depth 2 leaves 0, 2, 4.
    const rule = { kind: 'avoid-recent', depth: 2 } as const;
    expect(chooseMember(rule, 5, [3, 1], wordFor(0, 3))).toBe(0);
    expect(chooseMember(rule, 5, [3, 1], wordFor(1, 3))).toBe(2);
    expect(chooseMember(rule, 5, [3, 1], wordFor(2, 3))).toBe(4);
  });

  it('sets aside no more than leaves one member', () => {
    // Depth 4 over a pool of 3 sets aside min(4, 2) = 2: the last two chosen.
    const rule = { kind: 'avoid-recent', depth: 4 } as const;
    expect(chooseMember(rule, 3, [2, 0, 1], 0xffff_ffff)).toBe(1);
    expect(chooseMember(rule, 1, [0], 0)).toBe(0);
  });

  it('reads only as deep as its depth', () => {
    const rule = { kind: 'avoid-recent', depth: 1 } as const;
    // Only 2 is set aside; 0 and 1 remain although chosen before.
    expect(chooseMember(rule, 3, [2, 0, 1], wordFor(0, 2))).toBe(0);
    expect(chooseMember(rule, 3, [2, 0, 1], wordFor(1, 2))).toBe(1);
  });
});

describe('the selection history', () => {
  it('holds the most recent first, as deep as the deepest rule reads', () => {
    let recent: readonly number[] = [];
    for (let choice = 0; choice < 40; choice += 1) recent = withChoice(recent, choice);
    expect(recent).toHaveLength(DEEPEST_RECENT);
    expect(recent[0]).toBe(39);
    expect(recent.at(-1)).toBe(40 - DEEPEST_RECENT);
  });
});
