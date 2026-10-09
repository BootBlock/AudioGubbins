import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { stateFingerprintFrom } from '@audiogubbins/project-format';
import type { ProjectRecoveryReport } from '@audiogubbins/storage';

import { recoverySentences } from '../shell/project-words.js';
import { recoveryFindings, type RecoveryFinding } from './recovery-findings.js';

/**
 * The open project keeps a report only where `recoveryFindings` finds anything,
 * and the shell says one sentence a finding. Each notable field alone must be
 * found and said, so a field one of them reads and the other misses fails here.
 */

/** A report of an opening that found nothing amiss. */
const CLEAN: ProjectRecoveryReport = {
  head: { epoch: 2, generation: 3 },
  fallbacks: [],
  replayed: 4,
  fenced: [],
  missingStates: [],
  interruptedRecordings: [],
};

const POSITION = { epoch: 1, sequence: 7 };

/** A state fingerprint whose digits are all `digit`. */
function fingerprint(digit: string) {
  return expectSuccess(stateFingerprintFrom(`s1-${digit.repeat(64)}`));
}

const CASES: readonly (readonly [string, Partial<ProjectRecoveryReport>, RecoveryFinding])[] = [
  [
    'a head it fell back from',
    { fallbacks: [{ path: 'heads/x.json', reason: { kind: 'head-fenced' } }] },
    { kind: 'fallback' },
  ],
  [
    'a cursor state it rebuilt',
    {
      rebuiltCursorState: failure('state.damaged', FailureKind.IntegrityViolation, 'Damaged.'),
    },
    { kind: 'rebuilt-cursor-state' },
  ],
  [
    'a break in the journal',
    {
      journalBreak: {
        at: POSITION,
        reason: { kind: 'missing' },
        discarded: [POSITION, { epoch: 1, sequence: 8 }],
      },
    },
    { kind: 'journal-break', discarded: 2 },
  ],
  [
    'records of a writer that lost the project',
    { fenced: [POSITION] },
    { kind: 'fenced', changes: 1 },
  ],
  [
    'kept states storage does not hold',
    { missingStates: [fingerprint('a'), fingerprint('b'), fingerprint('c')] },
    { kind: 'missing-states', states: 3 },
  ],
];

describe('what recovery found', () => {
  it('finds and says nothing of an opening that found nothing amiss', () => {
    expect(recoveryFindings(CLEAN)).toEqual([]);
    expect(recoverySentences(CLEAN)).toEqual([]);
  });

  it.each(CASES)('finds %s, and says it in one sentence', (_, field, finding) => {
    const report = { ...CLEAN, ...field };
    expect(recoveryFindings(report)).toEqual([finding]);
    expect(recoverySentences(report)).toHaveLength(1);
  });

  it('says every finding of one report, in the order the fields are read', () => {
    const report = CASES.reduce<ProjectRecoveryReport>(
      (gathered, [, field]) => ({ ...gathered, ...field }),
      CLEAN,
    );
    expect(recoveryFindings(report).map((found) => found.kind)).toEqual(
      CASES.map(([, , finding]) => finding.kind),
    );
    expect(recoverySentences(report)).toHaveLength(CASES.length);
  });
});
