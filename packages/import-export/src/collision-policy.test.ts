import { describe, expect, it } from 'vitest';

import {
  answerCollision,
  decideCollision,
  type CollisionPolicy,
  type CollisionQuery,
  type TrustedFolder,
} from './collision-policy.js';

const WANTED = { stem: 'Slam', extension: 'wav' } as const;
const HASH = 'ab'.repeat(32);

function query(changes: Partial<CollisionQuery> = {}): CollisionQuery {
  return {
    wanted: WANTED,
    listing: ['Slam.wav', 'Creak.wav'],
    policy: 'prompt',
    remembered: undefined,
    trusted: undefined,
    ...changes,
  };
}

const TRUSTED: TrustedFolder = {
  records: [{ name: 'Slam.wav', size: 1_000, hash: HASH }],
  existing: { size: 1_000, hash: HASH },
};

describe('deciding a collision', () => {
  it('writes a name the listing does not have, whatever the policy', () => {
    for (const policy of ['prompt', 'overwrite', 'skip', 'rename'] as const) {
      expect(decideCollision(query({ policy, listing: ['Creak.wav'] }))).toEqual({
        kind: 'write',
        name: 'Slam.wav',
      });
    }
  });

  it('asks by default, and never overwrites without being told to', () => {
    expect(decideCollision(query())).toEqual({ kind: 'ask', name: 'Slam.wav' });
  });

  it.each([
    ['overwrite', { kind: 'overwrite', name: 'Slam.wav', trusted: false }],
    ['skip', { kind: 'skip', name: 'Slam.wav' }],
    ['rename', { kind: 'rename', name: 'Slam (2).wav' }],
  ] as const)('follows the %s policy', (policy, decision) => {
    expect(decideCollision(query({ policy }))).toEqual(decision);
  });

  it('compares names as a case-insensitive, normalising file system does', () => {
    expect(decideCollision(query({ listing: ['SLAM.WAV'] }))).toEqual({
      kind: 'ask',
      name: 'SLAM.WAV',
    });
    const decomposed = { stem: 'Café', extension: 'wav' };
    expect(decideCollision(query({ wanted: decomposed, listing: ['CAFÉ.wav'] }))).toEqual({
      kind: 'ask',
      name: 'CAFÉ.wav',
    });
    expect(decideCollision(query({ policy: 'overwrite', listing: ['slam.wav'] }))).toEqual({
      kind: 'overwrite',
      name: 'slam.wav',
      trusted: false,
    });
  });

  it('collides on the safe name, not the name as typed', () => {
    const typed = { stem: 'Slam?', extension: 'wav' };
    expect(decideCollision(query({ wanted: typed, listing: ['Slam_.wav'] }))).toEqual({
      kind: 'ask',
      name: 'Slam_.wav',
    });
  });

  it('renames to the first free copy number, in order, the same for the same listing', () => {
    const listing = ['Slam.wav', 'slam (2).WAV', 'Slam (3).wav', 'Slam (5).wav'];
    expect(decideCollision(query({ policy: 'rename', listing }))).toEqual({
      kind: 'rename',
      name: 'Slam (4).wav',
    });
    expect(decideCollision(query({ policy: 'rename', listing: [...listing].reverse() }))).toEqual({
      kind: 'rename',
      name: 'Slam (4).wav',
    });
  });

  it("applies the batch's remembered answer where the policy asks, and only there", () => {
    expect(decideCollision(query({ remembered: 'skip' }))).toEqual({
      kind: 'skip',
      name: 'Slam.wav',
    });
    expect(decideCollision(query({ remembered: 'rename' }))).toEqual({
      kind: 'rename',
      name: 'Slam (2).wav',
    });
    expect(decideCollision(query({ policy: 'overwrite', remembered: 'skip' }))).toEqual({
      kind: 'overwrite',
      name: 'Slam.wav',
      trusted: false,
    });
  });
});

describe('a trusted folder', () => {
  it('overwrites, without asking, a file it exported there and that is unchanged since', () => {
    for (const policy of ['prompt', 'skip', 'rename'] as const) {
      expect(decideCollision(query({ policy, trusted: TRUSTED }))).toEqual({
        kind: 'overwrite',
        name: 'Slam.wav',
        trusted: true,
      });
    }
  });

  it('matches the record and the file whatever the case of the name or the hash', () => {
    const trusted: TrustedFolder = {
      records: [{ name: 'slam.WAV', size: 1_000, hash: HASH.toUpperCase() }],
      existing: { size: 1_000, hash: HASH },
    };
    expect(decideCollision(query({ trusted }))).toMatchObject({ kind: 'overwrite', trusted: true });
  });

  it.each([
    ['a file whose size changed', { ...TRUSTED, existing: { size: 1_001, hash: HASH } }],
    ['a file whose hash changed', { ...TRUSTED, existing: { size: 1_000, hash: 'cd'.repeat(32) } }],
    ['a file whose content is not known', { ...TRUSTED, existing: undefined }],
    [
      'a file it has no record of',
      { ...TRUSTED, records: [{ name: 'Creak.wav', size: 1_000, hash: HASH }] },
    ],
    [
      'a file that matches an earlier record but not the last',
      {
        records: [
          { name: 'Slam.wav', size: 1_000, hash: HASH },
          { name: 'Slam.wav', size: 2_000, hash: 'ef'.repeat(32) },
        ],
        existing: { size: 1_000, hash: HASH },
      },
    ],
  ] as const)('leaves %s to the policy', (_name, trusted) => {
    for (const [policy, kind] of [
      ['prompt', 'ask'],
      ['skip', 'skip'],
      ['overwrite', 'overwrite'],
      ['rename', 'rename'],
    ] as const satisfies readonly (readonly [CollisionPolicy, string])[]) {
      const decision = decideCollision(query({ policy, trusted }));
      expect(decision.kind).toBe(kind);
      if (decision.kind === 'overwrite') expect(decision.trusted).toBe(false);
    }
  });
});

describe('answering a collision', () => {
  it('gives the decision the answer names, against the listed name', () => {
    const asked = query({ listing: ['SLAM.wav', 'Slam (2).wav'] });
    expect(answerCollision(asked, 'overwrite')).toEqual({
      kind: 'overwrite',
      name: 'SLAM.wav',
      trusted: false,
    });
    expect(answerCollision(asked, 'skip')).toEqual({ kind: 'skip', name: 'SLAM.wav' });
    expect(answerCollision(asked, 'rename')).toEqual({ kind: 'rename', name: 'Slam (3).wav' });
  });
});
