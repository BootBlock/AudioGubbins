import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  type SourceChangePolicy,
  contentIdFrom,
  type ExternalMedia,
  type ExternalSourceIdentity,
} from '@audiogubbins/project-format';

import type { SignalEvidence, SourceClassification } from './source-classification.js';
import { resolutionsFor, type ResolutionKind } from './source-resolution.js';

const identity: ExternalSourceIdentity = {
  byteLength: 10,
  lastModified: 0,
  mediaType: 'audio/wav',
  signature: '',
  fastFingerprint: 'a'.repeat(64),
};
const evidence: SignalEvidence = {
  byteLength: 'different',
  fastFingerprint: 'different',
  contentId: 'unknown',
  containerKind: 'same',
  mediaType: 'same',
  lastModified: 'different',
  handleKey: 'same',
  relativePath: 'unknown',
};

const CLASSIFICATIONS: Readonly<Record<SourceClassification['kind'], SourceClassification>> = {
  unchanged: { kind: 'unchanged', confidence: 'sampled', evidence },
  modified: { kind: 'modified', evidence },
  replaced: { kind: 'replaced', evidence },
  'relinked-identical': {
    kind: 'relinked-identical',
    confidence: 'sampled',
    candidate: identity,
    evidence,
  },
  missing: { kind: 'missing', reason: 'not-found' },
};

function mediaOf(policy: SourceChangePolicy, retained: boolean): ExternalMedia {
  return {
    kind: 'external',
    identity,
    policy,
    ...(retained ? { retainedCopy: expectSuccess(contentIdFrom(`c1-${'1'.repeat(64)}`)) } : {}),
  };
}

/**
 * What each policy applies without asking, for each classification, with a
 * retained copy and without one: the whole table, so a default can change only
 * by changing a line here.
 */
const AUTOMATIC: readonly (readonly [
  SourceChangePolicy,
  boolean,
  Readonly<Record<SourceClassification['kind'], ResolutionKind | undefined>>,
])[] = [
  [
    'prompt',
    true,
    {
      unchanged: undefined,
      modified: undefined,
      replaced: undefined,
      'relinked-identical': undefined,
      missing: undefined,
    },
  ],
  [
    'prompt',
    false,
    {
      unchanged: undefined,
      modified: undefined,
      replaced: undefined,
      'relinked-identical': undefined,
      missing: undefined,
    },
  ],
  [
    'adopt',
    true,
    {
      unchanged: undefined,
      modified: 'adopt',
      replaced: undefined,
      'relinked-identical': undefined,
      missing: undefined,
    },
  ],
  [
    'adopt',
    false,
    {
      unchanged: undefined,
      modified: 'adopt',
      replaced: undefined,
      'relinked-identical': undefined,
      missing: undefined,
    },
  ],
  [
    'freeze',
    true,
    {
      unchanged: undefined,
      modified: 'freeze',
      replaced: 'freeze',
      'relinked-identical': undefined,
      missing: 'freeze',
    },
  ],
  [
    'freeze',
    false,
    {
      unchanged: undefined,
      modified: undefined,
      replaced: undefined,
      'relinked-identical': undefined,
      missing: undefined,
    },
  ],
];

describe('what can be done about a changed source', () => {
  it.each(AUTOMATIC)(
    'applies under the %s policy (retained copy: %s) only what the table says',
    (policy, retained, expected) => {
      for (const [kind, classification] of Object.entries(CLASSIFICATIONS)) {
        const plan = resolutionsFor(classification, mediaOf(policy, retained));
        expect(plan.automatic, kind).toBe(expected[classification.kind]);
      }
    },
  );

  it('offers nothing for an unchanged source', () => {
    expect(resolutionsFor(CLASSIFICATIONS.unchanged, mediaOf('adopt', true))).toEqual({
      choices: [],
    });
  });

  it('offers adopting only where a file stands at the recorded place', () => {
    const kinds = (classification: SourceClassification): readonly ResolutionKind[] =>
      resolutionsFor(classification, mediaOf('prompt', true)).choices.map(({ kind }) => kind);

    expect(kinds(CLASSIFICATIONS.modified)).toEqual(['adopt', 'relink', 'freeze', 'keep-offline']);
    expect(kinds(CLASSIFICATIONS.replaced)).toEqual(['adopt', 'relink', 'freeze', 'keep-offline']);
    expect(kinds(CLASSIFICATIONS['relinked-identical'])).toEqual([
      'relink',
      'freeze',
      'keep-offline',
    ]);
    expect(kinds(CLASSIFICATIONS.missing)).toEqual(['relink', 'freeze', 'keep-offline']);
  });

  it('offers freezing as unavailable, with the reason, where no copy was retained', () => {
    for (const classification of Object.values(CLASSIFICATIONS).slice(1)) {
      const { choices } = resolutionsFor(classification, mediaOf('prompt', false));

      expect(choices.find(({ kind }) => kind === 'freeze')).toEqual({
        kind: 'freeze',
        available: false,
        reason: 'no-retained-copy',
      });
      expect(choices.filter(({ available }) => !available)).toHaveLength(1);
    }
  });
});
