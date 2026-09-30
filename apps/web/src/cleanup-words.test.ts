import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';

import { cleanedSentences } from './cleanup-words.js';

const HARBOUR = unsafeBrandId<'ProjectId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');
const QUAY = unsafeBrandId<'ProjectId'>('1a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');

describe('what a cleanup came to, in words', () => {
  it('says only what it freed where every step was carried out', () => {
    expect(
      cleanedSentences([
        { step: 'expired-history', freed: 2_048, busy: [], unapplied: [] },
        { step: 'unreferenced-media', freed: 0, busy: [] },
      ]),
    ).toEqual(['The cleanup freed 2 kB.']);
  });

  it('says each project left and each refusal, with its reason, after what it freed', () => {
    expect(
      cleanedSentences([
        { step: 'expired-backups', freed: 0, busy: [HARBOUR] },
        { step: 'expired-history', freed: 0, busy: [HARBOUR, QUAY], unapplied: [QUAY] },
        { step: 'unreferenced-media', freed: 0, busy: [], refused: { kind: 'storing' } },
      ]),
    ).toEqual([
      'The cleanup freed 0 bytes.',
      '2 projects another tab has open were left as they were.',
      'The history of 1 project changed after the cleanup was planned, so it was kept. Plan the cleanup again to compact it.',
      'Another tab is storing audio now, so none can be purged. Try again shortly.',
    ]);
  });
});
