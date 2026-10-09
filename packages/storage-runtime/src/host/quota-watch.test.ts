import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { storageTimeLeft, type StorageTimeLeft } from '@audiogubbins/recording';

import { QuotaWatch } from './quota-watch.js';

/**
 * The recording time left, watched while a recording is made (ADR-0071): the
 * estimate is read again each five seconds of audio committed and no more
 * often, one read at a time, and the time left counts the audio committed,
 * which finishing takes again.
 */

const RATE = expectSuccess(sampleRate(48_000));
const ESTIMATE = { quota: 1_000_000_000, usage: 100_000_000 };

/** A watch over an estimate that answers when told, and what it heard. */
function watched() {
  let reads = 0;
  let answer: (() => void) | undefined;
  const heard: StorageTimeLeft[] = [];
  const watch = new QuotaWatch(
    () => {
      reads += 1;
      return new Promise((resolve) => {
        answer = () => {
          resolve(ESTIMATE);
        };
      });
    },
    RATE,
    2,
    (timeLeft) => heard.push(timeLeft),
  );
  const answered = async (): Promise<void> => {
    answer?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { watch, heard, reads: () => reads, answered };
}

describe('the recording time left while recording', () => {
  it('is read again each five seconds of audio committed, one read at a time', async () => {
    const { watch, reads, answered } = watched();
    watch.committed(0);
    watch.committed(48_000);
    expect(reads()).toBe(1);
    await answered();
    watch.committed(4 * 48_000);
    expect(reads()).toBe(1);
    watch.committed(5 * 48_000);
    expect(reads()).toBe(2);
    watch.committed(11 * 48_000);
    expect(reads()).toBe(2);
    await answered();
    watch.committed(11 * 48_000);
    expect(reads()).toBe(3);
  });

  it('counts the audio committed, which finishing the recording takes again', async () => {
    const { watch, heard, answered } = watched();
    watch.committed(60 * 48_000);
    await answered();
    const committedBytes = 60 * 48_000 * 2 * 4;
    expect(heard).toEqual([storageTimeLeft(ESTIMATE, RATE, 2, committedBytes)]);
    expect(watch.timeLeft).toEqual(heard[0]);
    expect(watch.timeLeft).not.toEqual(storageTimeLeft(ESTIMATE, RATE, 2));
  });
});
