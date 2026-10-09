import { describe, expect, it } from 'vitest';

import { FailureKind, derivedSampleCount, failure, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { RecordingEnding, stateFingerprintFrom } from '@audiogubbins/project-format';
import type { InterruptedRecording, ProjectRecoveryReport } from '@audiogubbins/storage';

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

/** A recording a reload cut short, as the opening lists it. */
const INTERRUPTED: InterruptedRecording = {
  session: unsafeBrandId<'RecordingSessionId'>('5e5510a0-0000-4000-8000-000000000001'),
  frames: derivedSampleCount(96_000),
  recordedAt: 1_790_000_000_000,
  sampleRate: 48_000,
  channels: 2,
  device: { channelCount: 2 },
  purpose: { kind: 'stack' },
  ending: RecordingEnding.Interrupted,
  missing: 0,
};

const CASES: readonly (readonly [string, Partial<ProjectRecoveryReport>, RecoveryFinding])[] = [
  [
    'a recording cut short, first, so it is offered before anything else',
    { interruptedRecordings: [INTERRUPTED] },
    { kind: 'interrupted-recordings', recordings: 1 },
  ],
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
