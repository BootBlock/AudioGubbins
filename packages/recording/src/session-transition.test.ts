import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  derivedSampleCount,
  failure,
  sampleRate,
  unsafeBrandId,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import { RAW_STUDIO_PROFILE, VOICE_PROFILE } from './capture-profile.js';
import { RETROSPECTIVE_OFF } from './retrospective-buffer.js';
import {
  CLOSED_SESSION,
  inputIsOpen,
  type ArmedPurpose,
  type OpenInput,
  type RecordingSession,
  type SessionSetup,
  type StopReason,
} from './session-state.js';
import type { SessionEvent } from './session-events.js';
import { nextSession } from './session-transition.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE: SampleRate = valueOf(sampleRate(48_000));
const frames = derivedSampleCount;

const DEVICE = { id: 'input-1', group: 'group-1', label: 'Interface' };
const OTHER_DEVICE = { id: 'input-2' };
const SETUP: SessionSetup = {
  device: DEVICE,
  profile: RAW_STUDIO_PROFILE,
  retrospective: { on: true, seconds: 10 },
};
const NEW_STACK: ArmedPurpose = { kind: 'new-stack' };
const INTO_STACK: ArmedPurpose = {
  kind: 'take',
  stack: unsafeBrandId<'TakeStackId'>('stack-1'),
};
const OPEN: OpenInput = { kind: 'open', granted: { processing: {} }, rate: RATE, channels: 2 };
const BROKEN = failure('recording.chunk-write-failed', FailureKind.Retryable, 'It broke.');
const EARLIER = failure('recording.earlier', FailureKind.Rejected, 'Before.');

const ARMED_OPENING: RecordingSession = {
  kind: 'armed',
  ...SETUP,
  device: DEVICE,
  purpose: NEW_STACK,
  input: { kind: 'opening' },
};
const ARMED_OPEN: RecordingSession = { ...ARMED_OPENING, input: OPEN };
const RECORDING: RecordingSession = {
  kind: 'recording',
  ...SETUP,
  device: DEVICE,
  purpose: NEW_STACK,
  input: OPEN,
  firstFrame: frames(90_000),
  retrospectiveFrames: frames(10_000),
};

/** One session of each kind, an armed input both opening and open. */
const STATES = {
  closed: CLOSED_SESSION,
  asking: { kind: 'asking' },
  ready: { kind: 'ready', ...SETUP },
  'armed-opening': ARMED_OPENING,
  'armed-open': ARMED_OPEN,
  'counting-in': {
    kind: 'counting-in',
    ...SETUP,
    device: DEVICE,
    purpose: NEW_STACK,
    input: OPEN,
    recordAt: frames(96_000),
  },
  recording: RECORDING,
  stopping: { ...RECORDING, kind: 'stopping', reason: { kind: 'person' } },
  failed: { kind: 'failed', failure: EARLIER },
} satisfies Readonly<Record<string, RecordingSession>>;

const GRANTED_SETUP: SessionSetup = {
  profile: VOICE_PROFILE,
  retrospective: RETROSPECTIVE_OFF,
};

/** One event of each kind, with the write lease held where it is asked for. */
const EVENTS: Readonly<Record<SessionEvent['kind'], SessionEvent>> = {
  'permission-asked': { kind: 'permission-asked' },
  'permission-granted': { kind: 'permission-granted', setup: GRANTED_SETUP },
  'permission-denied': { kind: 'permission-denied' },
  'permission-revoked': { kind: 'permission-revoked' },
  'device-chosen': { kind: 'device-chosen', device: OTHER_DEVICE },
  'profile-chosen': { kind: 'profile-chosen', profile: VOICE_PROFILE },
  'retrospective-set': { kind: 'retrospective-set', setting: RETROSPECTIVE_OFF },
  arm: { kind: 'arm', purpose: NEW_STACK, holdsWriteLease: true },
  retarget: { kind: 'retarget', purpose: INTO_STACK },
  'device-opened': { kind: 'device-opened', granted: { processing: {} }, rate: RATE, channels: 2 },
  'device-lost': { kind: 'device-lost' },
  disarm: { kind: 'disarm' },
  'count-in-started': { kind: 'count-in-started', recordAt: frames(96_000), holdsWriteLease: true },
  'count-in-elapsed': { kind: 'count-in-elapsed', held: frames(2_000) },
  record: { kind: 'record', at: frames(100_000), held: frames(1_000), holdsWriteLease: true },
  stop: { kind: 'stop', reason: 'person' },
  failed: { kind: 'failed', failure: BROKEN },
  stopped: { kind: 'stopped' },
  close: { kind: 'close' },
};

const DENIED = {
  kind: 'failed',
  failure: expect.objectContaining({ code: 'recording.permission-denied' }),
};
const REVOKED = {
  kind: 'failed',
  failure: expect.objectContaining({ code: 'recording.permission-revoked' }),
};
const READY_WITHOUT_DEVICE = {
  kind: 'ready',
  profile: SETUP.profile,
  retrospective: SETUP.retrospective,
};
const FAILED = { kind: 'failed', failure: BROKEN };
const STOPPING = (reason: StopReason): unknown => ({ ...RECORDING, kind: 'stopping', reason });

/**
 * Every transition the session allows, and where it goes; every other pair of a
 * state and an event is refused. Written out whole, so a transition added or
 * lost anywhere changes this table.
 */
const ALLOWED: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['closed permission-asked', { kind: 'asking' }],
  ['closed permission-granted', { kind: 'ready', ...GRANTED_SETUP }],
  ['closed permission-denied', DENIED],
  ['closed failed', FAILED],
  ['closed close', CLOSED_SESSION],
  ['asking permission-granted', { kind: 'ready', ...GRANTED_SETUP }],
  ['asking permission-denied', DENIED],
  ['asking permission-revoked', REVOKED],
  ['asking failed', FAILED],
  ['asking close', CLOSED_SESSION],
  ['ready permission-revoked', REVOKED],
  ['ready device-lost', READY_WITHOUT_DEVICE],
  ['ready failed', FAILED],
  ['ready device-chosen', { kind: 'ready', ...SETUP, device: OTHER_DEVICE }],
  ['ready profile-chosen', { kind: 'ready', ...SETUP, profile: VOICE_PROFILE }],
  ['ready retrospective-set', { kind: 'ready', ...SETUP, retrospective: RETROSPECTIVE_OFF }],
  ['ready arm', ARMED_OPENING],
  ['ready close', CLOSED_SESSION],
  ['armed-opening permission-revoked', REVOKED],
  ['armed-opening device-lost', READY_WITHOUT_DEVICE],
  ['armed-opening failed', FAILED],
  ['armed-opening device-chosen', { ...ARMED_OPENING, device: OTHER_DEVICE }],
  ['armed-opening profile-chosen', { ...ARMED_OPENING, profile: VOICE_PROFILE }],
  ['armed-opening retrospective-set', { ...ARMED_OPENING, retrospective: RETROSPECTIVE_OFF }],
  ['armed-opening retarget', { ...ARMED_OPENING, purpose: INTO_STACK }],
  ['armed-opening device-opened', ARMED_OPEN],
  ['armed-opening disarm', { kind: 'ready', ...SETUP }],
  ['armed-opening close', CLOSED_SESSION],
  ['armed-open permission-revoked', REVOKED],
  ['armed-open device-lost', READY_WITHOUT_DEVICE],
  ['armed-open failed', FAILED],
  ['armed-open device-chosen', { ...ARMED_OPENING, device: OTHER_DEVICE }],
  ['armed-open profile-chosen', { ...ARMED_OPENING, profile: VOICE_PROFILE }],
  ['armed-open retrospective-set', { ...ARMED_OPEN, retrospective: RETROSPECTIVE_OFF }],
  ['armed-open retarget', { ...ARMED_OPEN, purpose: INTO_STACK }],
  ['armed-open disarm', { kind: 'ready', ...SETUP }],
  ['armed-open count-in-started', STATES['counting-in']],
  [
    'armed-open record',
    { ...RECORDING, firstFrame: frames(99_000), retrospectiveFrames: frames(1_000) },
  ],
  ['armed-open close', CLOSED_SESSION],
  ['counting-in permission-revoked', REVOKED],
  ['counting-in device-lost', READY_WITHOUT_DEVICE],
  ['counting-in failed', FAILED],
  ['counting-in disarm', { kind: 'ready', ...SETUP }],
  [
    'counting-in count-in-elapsed',
    { ...RECORDING, firstFrame: frames(94_000), retrospectiveFrames: frames(2_000) },
  ],
  ['counting-in stop', ARMED_OPEN],
  ['counting-in close', CLOSED_SESSION],
  ['recording permission-revoked', STOPPING({ kind: 'permission-revoked' })],
  ['recording device-lost', STOPPING({ kind: 'device-lost' })],
  ['recording failed', STOPPING({ kind: 'failure', failure: BROKEN })],
  ['recording stop', STOPPING({ kind: 'person' })],
  ['stopping permission-revoked', { ...STATES.stopping, inputClosedBy: 'permission-revoked' }],
  ['stopping device-lost', { ...STATES.stopping, inputClosedBy: 'device-lost' }],
  ['stopping failed', FAILED],
  ['stopping stopped', ARMED_OPEN],
  ['failed permission-asked', { kind: 'asking' }],
  ['failed permission-granted', { kind: 'ready', ...GRANTED_SETUP }],
  ['failed failed', FAILED],
  ['failed close', CLOSED_SESSION],
]);

const PAIRS = Object.entries(STATES).flatMap(([name, state]) =>
  Object.values(EVENTS).map((event) => [`${name} ${event.kind}`, state, event] as const),
);

describe('the recording session (REQ-ARCH-153, ADR-0070)', () => {
  it('covers every state and every event', () => {
    expect(PAIRS).toHaveLength(9 * 19);
  });

  it.each(PAIRS)('%s', (pair, state, event) => {
    const next = nextSession(state, event);
    const expected = ALLOWED.get(pair);
    if (expected === undefined) {
      expect(next.ok).toBe(false);
      if (!next.ok) {
        expect(next.failures[0].code).toBe('recording.transition-refused');
        expect(next.failures[0].details).toEqual({ state: state.kind, event: event.kind });
        expect(next.failures[0].summary).toMatch(/: \w/);
      }
    } else {
      expect(next).toEqual({ ok: true, value: expected });
    }
  });

  it('arms, counts in and records only with the write lease, and says why', () => {
    const withoutLease: readonly [RecordingSession, SessionEvent][] = [
      [STATES.ready, { kind: 'arm', purpose: NEW_STACK, holdsWriteLease: false }],
      [ARMED_OPEN, { kind: 'count-in-started', recordAt: frames(96_000), holdsWriteLease: false }],
      [
        ARMED_OPEN,
        { kind: 'record', at: frames(100_000), held: frames(0), holdsWriteLease: false },
      ],
    ];
    for (const [state, event] of withoutLease) {
      const next = nextSession(state, event);
      expect(next.ok).toBe(false);
      if (!next.ok) {
        expect(next.failures[0].code).toBe('recording.no-write-lease');
        expect(next.failures[0].summary).toMatch(/Another tab holds this project/);
      }
    }
  });

  it('disarms without the lease: closing the microphone is never refused', () => {
    expect(nextSession(ARMED_OPEN, { kind: 'disarm' }).ok).toBe(true);
  });

  it('arms only a chosen input', () => {
    const next = nextSession(
      { kind: 'ready', profile: RAW_STUDIO_PROFILE, retrospective: RETROSPECTIVE_OFF },
      EVENTS.arm,
    );
    expect(next.ok).toBe(false);
  });

  it('arms a punch over a range of a frame or more whose pre-roll begins within the asset', () => {
    const punch = (start: number, length: number, preRoll: number): ArmedPurpose => ({
      kind: 'punch',
      asset: unsafeBrandId<'AssetId'>('asset-1'),
      start: frames(start),
      length: frames(length),
      preRoll: frames(preRoll),
      postRoll: frames(4_800),
    });
    const arm = (purpose: ArmedPurpose): boolean =>
      nextSession({ kind: 'ready', ...SETUP }, { kind: 'arm', purpose, holdsWriteLease: true }).ok;

    expect(arm(punch(48_000, 24_000, 48_000))).toBe(true);
    expect(arm(punch(48_000, 0, 0))).toBe(false);
    expect(arm(punch(48_000, 24_000, 48_001))).toBe(false);
    expect(nextSession(ARMED_OPEN, { kind: 'retarget', purpose: punch(0, 0, 0) }).ok).toBe(false);
  });

  it('begins a take with the buffered frames, up to the buffer and never before the clock', () => {
    const record = (held: number, at: number): unknown => {
      const next = valueOf(
        nextSession(ARMED_OPEN, {
          kind: 'record',
          at: frames(at),
          held: frames(held),
          holdsWriteLease: true,
        }),
      );
      return next.kind === 'recording' ? [next.firstFrame, next.retrospectiveFrames] : undefined;
    };
    // Ten seconds at 48 kHz is the buffer's capacity.
    expect(record(1_000_000, 1_000_000)).toEqual([520_000, 480_000]);
    expect(record(1_000, 1_000_000)).toEqual([999_000, 1_000]);
    expect(record(1_000_000, 300)).toEqual([0, 300]);

    const unbuffered = valueOf(
      nextSession(
        { ...ARMED_OPEN, retrospective: RETROSPECTIVE_OFF },
        { kind: 'record', at: frames(5_000), held: frames(5_000), holdsWriteLease: true },
      ),
    );
    expect(unbuffered).toMatchObject({ firstFrame: 5_000, retrospectiveFrames: 0 });
  });

  it.each([
    [{ kind: 'person' }, ARMED_OPEN],
    [{ kind: 'timed' }, ARMED_OPEN],
    [{ kind: 'quota' }, ARMED_OPEN],
    [{ kind: 'background-suspended' }, { kind: 'ready', ...SETUP }],
    [{ kind: 'device-lost' }, READY_WITHOUT_DEVICE],
    [{ kind: 'permission-revoked' }, REVOKED],
    [{ kind: 'failure', failure: BROKEN }, FAILED],
  ] satisfies [StopReason, unknown][])(
    'after a recording stopped for %o, keeps the input armed only where capture did not end',
    (reason, expected) => {
      expect(nextSession({ ...RECORDING, kind: 'stopping', reason }, EVENTS.stopped)).toEqual({
        ok: true,
        value: expected,
      });
    },
  );

  it('closes the input after finishing when it was lost while the recording was finished', () => {
    const lost = valueOf(nextSession(STATES.stopping, EVENTS['device-lost']));
    expect(nextSession(lost, EVENTS.stopped)).toEqual({ ok: true, value: READY_WITHOUT_DEVICE });

    const revoked = valueOf(nextSession(STATES.stopping, EVENTS['permission-revoked']));
    expect(nextSession(revoked, EVENTS.stopped)).toEqual({ ok: true, value: REVOKED });
  });

  it('opens an input only once armed: every state any events reach keeps that rule', () => {
    // Every session reachable from closed within six events, each state's
    // input checked against its kind.
    const reached = new Map<string, RecordingSession>();
    let frontier: RecordingSession[] = [CLOSED_SESSION];
    for (let depth = 0; depth < 6; depth += 1) {
      const next: RecordingSession[] = [];
      for (const state of frontier) {
        for (const event of Object.values(EVENTS)) {
          const result = nextSession(state, event);
          const key = JSON.stringify(result.ok ? result.value : undefined);
          if (!result.ok || reached.has(key)) continue;
          reached.set(key, result.value);
          next.push(result.value);
        }
      }
      frontier = next;
    }

    expect(reached.size).toBeGreaterThan(20);
    for (const state of reached.values()) {
      if (inputIsOpen(state)) {
        expect(['armed', 'counting-in', 'recording', 'stopping']).toContain(state.kind);
      }
    }
  });
});

describe('an open input (REQ-REC-090)', () => {
  it('holds an input open only while armed and open, counting in, recording or stopping', () => {
    const open = Object.entries(STATES)
      .filter(([, state]) => inputIsOpen(state))
      .map(([name]) => name);
    expect(open).toEqual(['armed-open', 'counting-in', 'recording', 'stopping']);
  });
});
