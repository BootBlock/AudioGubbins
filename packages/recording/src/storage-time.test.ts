import { describe, expect, it } from 'vitest';

import { sampleRate, type DomainResult } from '@audiogubbins/domain';

import {
  STORAGE_WARNING_SECONDS,
  recordingBytesPerSecond,
  storageTimeLeft,
} from './storage-time.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));

/** A second of stereo at 48 kHz in 32-bit floats. */
const STEREO_SECOND = 48_000 * 2 * 4;

describe('the storage time a recording has left (REQ-REC-096, ADR-0071)', () => {
  it('takes four bytes a sample, a sample a channel', () => {
    expect(recordingBytesPerSecond(RATE, 2)).toBe(STEREO_SECOND);
  });

  it("counts each second twice, since finishing needs the recording's size again", () => {
    const free = 1_000 * STEREO_SECOND;
    expect(storageTimeLeft({ quota: free + 50, usage: 50 }, RATE, 2)).toEqual({
      kind: 'enough',
      seconds: 500,
    });
  });

  it('keeps room to finish what an unfinished recording already holds', () => {
    const free = 1_000 * STEREO_SECOND;
    expect(storageTimeLeft({ quota: free, usage: 0 }, RATE, 2, 400 * STEREO_SECOND)).toEqual({
      kind: 'enough',
      seconds: 300,
    });
  });

  it('warns below the margin, and says when nothing is left', () => {
    const free = 2 * (STORAGE_WARNING_SECONDS - 1) * STEREO_SECOND;
    expect(storageTimeLeft({ quota: free, usage: 0 }, RATE, 2)).toEqual({
      kind: 'low',
      seconds: STORAGE_WARNING_SECONDS - 1,
    });
    expect(storageTimeLeft({ quota: STEREO_SECOND, usage: 0 }, RATE, 2)).toEqual({
      kind: 'exhausted',
    });
    expect(storageTimeLeft({ quota: 10, usage: 20 }, RATE, 2)).toEqual({ kind: 'exhausted' });
  });

  it('knows nothing without an estimate, rather than taking plenty', () => {
    expect(storageTimeLeft(undefined, RATE, 2)).toEqual({ kind: 'unknown' });
  });
});
