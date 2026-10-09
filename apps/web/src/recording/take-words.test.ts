import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import { RecordingEnding, endedUnexpectedly } from '@audiogubbins/project-format';
import type { StopReason } from '@audiogubbins/recording';

import { endingOf } from './take-words.js';

describe('the ending a stopped recording is kept with (ADR-0071)', () => {
  it('keeps each reason as its own ending, and only the person and the timed stop as expected', () => {
    const broken = failure('recording.chunk-write-failed', FailureKind.Retryable, 'It broke.');
    const reasons: readonly (readonly [StopReason, RecordingEnding, boolean])[] = [
      [{ kind: 'person' }, RecordingEnding.Stopped, false],
      [{ kind: 'timed' }, RecordingEnding.Timed, false],
      [{ kind: 'device-lost' }, RecordingEnding.DeviceLost, true],
      [{ kind: 'permission-revoked' }, RecordingEnding.PermissionRevoked, true],
      [{ kind: 'background-suspended' }, RecordingEnding.Suspended, true],
      [{ kind: 'quota' }, RecordingEnding.StorageFull, true],
      [{ kind: 'failure', failure: broken }, RecordingEnding.Failed, true],
    ];
    for (const [reason, ending, unexpected] of reasons) {
      expect(endingOf(reason)).toBe(ending);
      expect(endedUnexpectedly(endingOf(reason))).toBe(unexpected);
    }
  });
});
