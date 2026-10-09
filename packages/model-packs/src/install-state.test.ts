import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';

import { nextInstallState, type InstallEvent, type InstallState } from './install-state.js';

const REASON = failure('model-pack.network-failed', FailureKind.Retryable, 'It broke.');
const DAMAGE = failure('model-pack.file-hash-mismatch', FailureKind.IntegrityViolation, 'Rot.');

/** One state of each kind, part way where a kind has progress. */
const STATES: Readonly<Record<InstallState['kind'], InstallState>> = {
  available: { kind: 'available' },
  queued: { kind: 'queued', received: 40, total: 100 },
  downloading: { kind: 'downloading', received: 40, total: 100 },
  paused: { kind: 'paused', received: 40, total: 100 },
  verifying: { kind: 'verifying', total: 100 },
  installed: { kind: 'installed' },
  failed: { kind: 'failed', reason: REASON, resumable: true, received: 40 },
  removing: { kind: 'removing' },
};

/** One event of each kind, whose numbers each state that takes it accepts. */
const EVENTS: Readonly<Record<InstallEvent['kind'], InstallEvent>> = {
  queue: { kind: 'queue', received: 40, total: 100 },
  start: { kind: 'start', received: 10, total: 100 },
  progress: { kind: 'progress', received: 60 },
  pause: { kind: 'pause' },
  resume: { kind: 'resume', received: 45 },
  downloaded: { kind: 'downloaded' },
  verified: { kind: 'verified' },
  fail: { kind: 'fail', reason: REASON, resumable: true },
  retry: { kind: 'retry', received: 40, total: 100 },
  damaged: { kind: 'damaged', reason: DAMAGE },
  cancel: { kind: 'cancel' },
  remove: { kind: 'remove' },
  removed: { kind: 'removed' },
};

/**
 * Every transition the machine allows, and where it goes; every pair of a state
 * and an event not listed is refused. Written out whole, so a transition added
 * or lost anywhere changes this table.
 */
const ALLOWED: ReadonlyMap<string, InstallState> = new Map([
  ['available queue', { kind: 'queued', received: 40, total: 100 }],
  ['available start', { kind: 'downloading', received: 10, total: 100 }],
  ['queued start', { kind: 'downloading', received: 10, total: 100 }],
  ['queued pause', { kind: 'paused', received: 40, total: 100 }],
  ['queued fail', { kind: 'failed', reason: REASON, resumable: true, received: 40 }],
  ['queued cancel', { kind: 'removing' }],
  ['downloading progress', { kind: 'downloading', received: 60, total: 100 }],
  ['downloading pause', { kind: 'paused', received: 40, total: 100 }],
  ['downloading fail', { kind: 'failed', reason: REASON, resumable: true, received: 40 }],
  ['downloading cancel', { kind: 'removing' }],
  ['paused queue', { kind: 'queued', received: 40, total: 100 }],
  ['paused resume', { kind: 'downloading', received: 45, total: 100 }],
  ['paused cancel', { kind: 'removing' }],
  ['verifying verified', { kind: 'installed' }],
  ['verifying fail', { kind: 'failed', reason: REASON, resumable: false, received: 0 }],
  ['verifying pause', { kind: 'paused', received: 100, total: 100 }],
  ['verifying cancel', { kind: 'removing' }],
  ['installed damaged', { kind: 'failed', reason: DAMAGE, resumable: false, received: 0 }],
  ['installed remove', { kind: 'removing' }],
  ['failed queue', { kind: 'queued', received: 40, total: 100 }],
  ['failed retry', { kind: 'downloading', received: 40, total: 100 }],
  ['failed cancel', { kind: 'removing' }],
  ['failed remove', { kind: 'removing' }],
  ['removing removed', { kind: 'available' }],
  ['removing fail', { kind: 'failed', reason: REASON, resumable: false, received: 0 }],
] satisfies [string, InstallState][]);

const PAIRS = Object.values(STATES).flatMap((state) =>
  Object.values(EVENTS).map((event) => [`${state.kind} ${event.kind}`, state, event] as const),
);

describe('the install state machine (REQ-ARCH-153)', () => {
  it('covers every state and every event', () => {
    expect(PAIRS).toHaveLength(8 * 13);
  });

  it.each(PAIRS)('%s', (pair, state, event) => {
    const next = nextInstallState(state, event);
    const expected = ALLOWED.get(pair);
    if (expected === undefined) {
      expect(next.ok).toBe(false);
      if (!next.ok) {
        expect(next.failures[0].code).toBe('model-pack.transition-refused');
        expect(next.failures[0].details).toEqual({ state: state.kind, event: event.kind });
        expect(next.failures[0].summary).toMatch(/: \w/);
      }
    } else {
      expect(next).toEqual({ ok: true, value: expected });
    }
  });

  it('finishes downloading only once every byte has arrived', () => {
    const whole = nextInstallState(
      { kind: 'downloading', received: 100, total: 100 },
      { kind: 'downloaded' },
    );
    expect(whole).toEqual({ ok: true, value: { kind: 'verifying', total: 100 } });
    expect(nextInstallState(STATES.downloading, { kind: 'downloaded' }).ok).toBe(false);
  });

  it('lets progress only grow, and never past the whole', () => {
    for (const received of [39, 101, -1, 40.5, Number.NaN]) {
      expect(nextInstallState(STATES.downloading, { kind: 'progress', received }).ok).toBe(false);
    }
    expect(nextInstallState(STATES.downloading, { kind: 'progress', received: 40 }).ok).toBe(true);
    expect(nextInstallState(STATES.downloading, { kind: 'progress', received: 100 }).ok).toBe(true);
  });

  it('starts, resumes and retries only within the whole download, of one byte or more', () => {
    expect(nextInstallState(STATES.available, { kind: 'start', received: 0, total: 0 }).ok).toBe(
      false,
    );
    expect(
      nextInstallState(STATES.available, { kind: 'start', received: 101, total: 100 }).ok,
    ).toBe(false);
    expect(nextInstallState(STATES.paused, { kind: 'resume', received: 101 }).ok).toBe(false);
    expect(nextInstallState(STATES.failed, { kind: 'retry', received: 0, total: 0 }).ok).toBe(
      false,
    );
  });

  it('keeps nothing a failed download cannot be resumed from', () => {
    const failed = nextInstallState(STATES.downloading, {
      kind: 'fail',
      reason: DAMAGE,
      resumable: false,
    });
    expect(failed).toEqual({
      ok: true,
      value: { kind: 'failed', reason: DAMAGE, resumable: false, received: 0 },
    });
  });

  it('retries a failure that cannot be resumed from only from nothing', () => {
    const unresumable: InstallState = {
      kind: 'failed',
      reason: REASON,
      resumable: false,
      received: 0,
    };
    expect(nextInstallState(unresumable, { kind: 'retry', received: 40, total: 100 }).ok).toBe(
      false,
    );
    expect(nextInstallState(unresumable, { kind: 'retry', received: 0, total: 100 })).toEqual({
      ok: true,
      value: { kind: 'downloading', received: 0, total: 100 },
    });
    expect(nextInstallState(unresumable, { kind: 'queue', received: 40, total: 100 }).ok).toBe(
      false,
    );
    expect(nextInstallState(unresumable, { kind: 'queue', received: 0, total: 100 })).toEqual({
      ok: true,
      value: { kind: 'queued', received: 0, total: 100 },
    });
  });

  it('queues only within the whole download, of one byte or more', () => {
    for (const [received, total] of [
      [0, 0],
      [101, 100],
      [-1, 100],
    ] as const) {
      expect(nextInstallState(STATES.available, { kind: 'queue', received, total }).ok).toBe(false);
    }
  });
});
