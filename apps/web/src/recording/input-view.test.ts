import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { derivedSampleCount, sampleRate } from '@audiogubbins/domain';
import {
  RAW_STUDIO_PROFILE,
  RETROSPECTIVE_OFF,
  capturePlan,
  compareCapture,
  retrospectiveOn,
  type OpenInput,
  type RecordingSession,
  type SessionSetup,
} from '@audiogubbins/recording';

import { NOTHING_ASKED, inputStatus, type InputView, type OpenedFacts } from './input-view.js';

const RATE = expectSuccess(sampleRate(48_000));
const CHOSEN = { id: 'default' };
const OPENED = { id: 'input-1', group: 'group-1', label: 'Studio interface' };
const SETUP: SessionSetup = {
  device: CHOSEN,
  profile: RAW_STUDIO_PROFILE,
  retrospective: expectSuccess(retrospectiveOn(10)),
};
const ARMED = { ...SETUP, device: CHOSEN, purpose: { kind: 'new-stack' } } as const;
const OPEN: OpenInput = { kind: 'open', granted: { processing: {} }, rate: RATE, channels: 2 };
const PLAN = capturePlan(RAW_STUDIO_PROFILE, { supported: new Set(), contextRate: RATE });
const OPENED_FACTS: OpenedFacts = {
  device: OPENED,
  plan: PLAN,
  granted: OPEN.granted,
  comparison: compareCapture(PLAN, OPEN.granted),
  rate: RATE,
  channels: 2,
  muted: false,
};
const RECORDING: RecordingSession = {
  kind: 'recording',
  ...ARMED,
  input: OPEN,
  firstFrame: derivedSampleCount(90_000),
  retrospectiveFrames: derivedSampleCount(10_000),
};

/** The view of `session`, with the input open as the browser opened it where one is. */
function viewOf(session: RecordingSession, bufferedSeconds = 0): InputView {
  const open = session.kind !== 'armed' || session.input.kind === 'open';
  const opened = open && 'device' in session ? OPENED_FACTS : undefined;
  return { ...NOTHING_ASKED, session, opened, bufferedSeconds };
}

describe("the input's status (REQ-REC-090, ADR-0070)", () => {
  it('is none while no input is armed or open', () => {
    const idle: RecordingSession[] = [
      { kind: 'closed' },
      { kind: 'asking' },
      { kind: 'ready', ...SETUP },
    ];
    for (const session of idle) expect(inputStatus(viewOf(session), undefined)).toBeUndefined();
  });

  it('says opening, armed, buffering, counting in and recording as distinct states', () => {
    const opening = { kind: 'armed', ...ARMED, input: { kind: 'opening' } } as const;
    const armed = { kind: 'armed', ...ARMED, input: OPEN } as const;
    expect(inputStatus(viewOf(opening), undefined)).toEqual({ kind: 'opening', device: CHOSEN });
    expect(inputStatus(viewOf({ ...armed, retrospective: RETROSPECTIVE_OFF }), undefined)).toEqual({
      kind: 'armed',
      device: OPENED,
    });
    expect(
      inputStatus(
        viewOf({ ...armed, kind: 'counting-in', recordAt: derivedSampleCount(96_000) }),
        undefined,
      ),
    ).toEqual({ kind: 'counting-in', device: OPENED });
    expect(inputStatus(viewOf(RECORDING), undefined)).toEqual({
      kind: 'recording',
      device: OPENED,
    });
    expect(
      inputStatus(
        viewOf({ ...RECORDING, kind: 'stopping', reason: { kind: 'person' } }),
        undefined,
      ),
    ).toEqual({ kind: 'recording', device: OPENED });
  });

  it('says how much the buffer holds now, not the length it is set to', () => {
    const armed = { kind: 'armed', ...ARMED, input: OPEN } as const;
    expect(inputStatus(viewOf(armed, 3), undefined)).toEqual({
      kind: 'buffering',
      device: OPENED,
      seconds: 3,
    });
  });

  it('names the input the browser opened over the one chosen before it said which', () => {
    const armed = { kind: 'armed', ...ARMED, input: OPEN } as const;
    const unopened = { ...viewOf(armed), opened: undefined };
    expect(inputStatus(unopened, undefined)).toMatchObject({ device: CHOSEN });
    expect(inputStatus(viewOf(armed), undefined)).toMatchObject({ device: OPENED });
  });

  it('says calibrating while an input is open for a calibration, whatever the session', () => {
    expect(inputStatus(viewOf({ kind: 'ready', ...SETUP }), { device: OPENED })).toEqual({
      kind: 'calibrating',
      device: OPENED,
    });
  });
});
