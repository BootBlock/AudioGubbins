import { describe, expect, it } from 'vitest';

import { derivedSampleCount } from '@audiogubbins/domain';

import {
  SUSPENSION_CAUTION,
  punchWindow,
  scheduleRecording,
  scheduleStep,
  type RecordingSchedule,
  type ScheduleFacts,
} from './controlled-recording.js';

const frames = derivedSampleCount;

const NOW: ScheduleFacts = {
  now: frames(10_000),
  armed: true,
  pageVisible: true,
  suspensionRisk: false,
};

function codeOf(result: ReturnType<typeof scheduleRecording>): string | undefined {
  return result.ok ? undefined : result.failures[0].code;
}

describe('scheduling a controlled recording (REQ-REC-020, ADR-0070)', () => {
  it('counts in from now and records when the count-in ends', () => {
    expect(scheduleRecording({ countIn: frames(4_000) }, NOW)).toEqual({
      ok: true,
      value: { countInFrom: 10_000, recordAt: 14_000 },
    });
  });

  it('stops a timed recording after its length', () => {
    expect(scheduleRecording({ countIn: frames(0), stopAfter: frames(48_000) }, NOW)).toEqual({
      ok: true,
      value: { countInFrom: 10_000, recordAt: 10_000, stopAt: 58_000 },
    });
  });

  it('records at a set time, counting in before it', () => {
    expect(scheduleRecording({ countIn: frames(2_000), startAt: frames(50_000) }, NOW)).toEqual({
      ok: true,
      value: { countInFrom: 48_000, recordAt: 50_000 },
    });
  });

  it('refuses a start in the past, and one too soon for its count-in', () => {
    expect(codeOf(scheduleRecording({ countIn: frames(0), startAt: frames(9_999) }, NOW))).toBe(
      'recording.schedule-in-the-past',
    );
    const tooSoon = scheduleRecording({ countIn: frames(2_000), startAt: frames(11_000) }, NOW);
    expect(tooSoon).toMatchObject({
      ok: false,
      failures: [{ summary: 'The start is too soon for the count-in before it.' }],
    });
    expect(scheduleRecording({ countIn: frames(1_000), startAt: frames(11_000) }, NOW).ok).toBe(
      true,
    );
  });

  it('refuses unless the input is armed and the page is in view', () => {
    expect(codeOf(scheduleRecording({ countIn: frames(0) }, { ...NOW, armed: false }))).toBe(
      'recording.schedule-not-armed',
    );
    expect(codeOf(scheduleRecording({ countIn: frames(0) }, { ...NOW, pageVisible: false }))).toBe(
      'recording.schedule-page-hidden',
    );
    expect(codeOf(scheduleRecording({ countIn: frames(0), stopAfter: frames(0) }, NOW))).toBe(
      'recording.schedule-empty',
    );
  });

  it('cautions, before scheduling, where the platform may suspend capture', () => {
    const scheduled = scheduleRecording({ countIn: frames(0) }, { ...NOW, suspensionRisk: true });
    expect(scheduled).toMatchObject({ ok: true, value: { caution: SUSPENSION_CAUTION } });
  });
});

describe('the steps of a scheduled recording', () => {
  const schedule: RecordingSchedule = {
    countInFrom: frames(20_000),
    recordAt: frames(24_000),
    stopAt: frames(72_000),
  };

  it('waits, counts in, records and stops at the frames scheduled', () => {
    expect(scheduleStep(schedule, 'waiting', frames(19_999), true)).toEqual({
      kind: 'wait',
      until: 20_000,
    });
    expect(scheduleStep(schedule, 'waiting', frames(20_000), true)).toEqual({
      kind: 'begin-count-in',
    });
    expect(scheduleStep(schedule, 'counting-in', frames(23_999), true)).toEqual({
      kind: 'wait',
      until: 24_000,
    });
    expect(scheduleStep(schedule, 'counting-in', frames(24_000), true)).toEqual({
      kind: 'begin-recording',
    });
    expect(scheduleStep(schedule, 'recording', frames(71_999), true)).toEqual({
      kind: 'wait',
      until: 72_000,
    });
    expect(scheduleStep(schedule, 'recording', frames(72_000), true)).toEqual({
      kind: 'stop',
      reason: 'timed',
    });
  });

  it('records at once where there is no count-in, and waits on nothing where there is no timed stop', () => {
    const plain: RecordingSchedule = { countInFrom: frames(5_000), recordAt: frames(5_000) };
    expect(scheduleStep(plain, 'waiting', frames(5_000), true)).toEqual({
      kind: 'begin-recording',
    });
    expect(scheduleStep(plain, 'recording', frames(900_000), true)).toEqual({ kind: 'wait' });
  });

  it('cancels when the page is hidden before recording, and stops when it is hidden during one', () => {
    expect(scheduleStep(schedule, 'waiting', frames(0), false).kind).toBe('cancel');
    expect(scheduleStep(schedule, 'counting-in', frames(22_000), false).kind).toBe('cancel');
    expect(scheduleStep(schedule, 'recording', frames(30_000), false)).toEqual({
      kind: 'stop',
      reason: 'background-suspended',
    });
  });
});

describe("a punch's window (ADR-0072)", () => {
  it('runs from the pre-roll before the range to the end of the post-roll after it', () => {
    expect(
      punchWindow({
        start: frames(96_000),
        length: frames(48_000),
        preRoll: frames(24_000),
        postRoll: frames(12_000),
      }),
    ).toEqual({ from: 72_000, length: 84_000 });
  });

  it("begins at the asset's start where the range is nearer it than the pre-roll", () => {
    expect(
      punchWindow({
        start: frames(10_000),
        length: frames(48_000),
        preRoll: frames(24_000),
        postRoll: frames(12_000),
      }),
    ).toEqual({ from: 0, length: 70_000 });
  });
});
