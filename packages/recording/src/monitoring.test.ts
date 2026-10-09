import { describe, expect, it } from 'vitest';

import { derivedSampleCount, sampleRate, type DomainResult } from '@audiogubbins/domain';

import {
  MONITORING_UNAVAILABLE,
  feedbackRisk,
  monitoringLatency,
  nextMonitoring,
  type Monitoring,
  type MonitoringContext,
  type MonitoringEvent,
  type MonitoringPath,
} from './monitoring.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));

const DIRECT: MonitoringPath = {
  route: { kind: 'direct' },
  rate: RATE,
  output: 0.01,
  input: 0.005,
};
const LIVE_CHAIN: MonitoringPath = {
  ...DIRECT,
  route: { kind: 'chain', verdict: { live: true, latency: derivedSampleCount(480) } },
};
const DEAD_CHAIN: MonitoringPath = {
  ...DIRECT,
  route: { kind: 'chain', verdict: { live: false, reason: 'Its denoiser needs the whole file.' } },
};

const SAFE: MonitoringContext = { headphones: false, risk: { kind: 'none' }, path: DIRECT };
const RISKY: MonitoringContext = { ...SAFE, risk: { kind: 'likely', why: 'same-device' } };
const HEADPHONES: MonitoringContext = { ...SAFE, headphones: true };

/** The state after `events`, from no input open; throws on a refusal. */
function after(...events: readonly MonitoringEvent[]): Monitoring {
  return events.reduce<Monitoring>(
    (state, event) => valueOf(nextMonitoring(state, event)),
    MONITORING_UNAVAILABLE,
  );
}

const opened = (context: MonitoringContext, remembered = false): MonitoringEvent => ({
  kind: 'input-opened',
  context,
  remembered,
});

describe('input monitoring (REQ-REC-091, ADR-0070)', () => {
  it('is off when an input opens, even where the person had it on, unless the profile is for headphones', () => {
    expect(after(opened(SAFE)).kind).toBe('off');
    expect(after(opened(SAFE, true)).kind).toBe('off');
    expect(after(opened(HEADPHONES)).kind).toBe('off');
    expect(after(opened(HEADPHONES, true))).toEqual({
      kind: 'on',
      context: HEADPHONES,
      latency: { seconds: 0.015, inputKnown: true },
    });
  });

  it('keeps a headphones profile off, with the reason, when its chain cannot run live', () => {
    expect(after(opened({ ...HEADPHONES, path: DEAD_CHAIN }, true))).toEqual({
      kind: 'off',
      context: { ...HEADPHONES, path: DEAD_CHAIN },
      refusal: 'Its denoiser needs the whole file.',
    });
  });

  it('turns on and off with one toggle', () => {
    expect(after(opened(SAFE), { kind: 'toggle' }).kind).toBe('on');
    expect(after(opened(SAFE), { kind: 'toggle' }, { kind: 'toggle' }).kind).toBe('off');
  });

  it('can be on only while an input is open', () => {
    const refused = nextMonitoring(MONITORING_UNAVAILABLE, { kind: 'toggle' });
    expect(refused.ok).toBe(false);
    expect(after(opened(SAFE), { kind: 'toggle' }, { kind: 'input-closed' })).toEqual(
      MONITORING_UNAVAILABLE,
    );
  });

  it('warns of feedback before it starts, and starts only once the person confirms', () => {
    const warned = after(opened(RISKY), { kind: 'toggle' });
    expect(warned).toEqual({ kind: 'confirming', context: RISKY });
    expect(valueOf(nextMonitoring(warned, { kind: 'confirm' })).kind).toBe('on');
    expect(valueOf(nextMonitoring(warned, { kind: 'toggle' })).kind).toBe('off');
    expect(nextMonitoring(after(opened(SAFE)), { kind: 'confirm' }).ok).toBe(false);
  });

  it('takes a headphones profile at its word and does not warn', () => {
    expect(after(opened({ ...RISKY, headphones: true }), { kind: 'toggle' }).kind).toBe('on');
  });

  it('stops for confirmation when a risk appears while it is on, and not for one already confirmed', () => {
    const on = after(opened(SAFE), { kind: 'toggle' });
    expect(valueOf(nextMonitoring(on, { kind: 'context-changed', context: RISKY })).kind).toBe(
      'confirming',
    );

    const confirmed = after(opened(RISKY), { kind: 'toggle' }, { kind: 'confirm' });
    const moved = valueOf(
      nextMonitoring(confirmed, {
        kind: 'context-changed',
        context: { ...RISKY, path: LIVE_CHAIN },
      }),
    );
    expect(moved.kind).toBe('on');
  });

  it('monitors through a live chain, adding its latency, and refuses one that cannot run live', () => {
    expect(after(opened({ ...SAFE, path: LIVE_CHAIN }), { kind: 'toggle' })).toMatchObject({
      kind: 'on',
      latency: { seconds: 0.025, inputKnown: true },
    });

    const refused = nextMonitoring(after(opened({ ...SAFE, path: DEAD_CHAIN })), {
      kind: 'toggle',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.failures[0]).toMatchObject({
        code: 'monitoring.chain-not-live',
        summary: 'Its denoiser needs the whole file.',
      });
    }

    // Refused before any feedback warning is shown.
    expect(
      nextMonitoring(after(opened({ ...RISKY, path: DEAD_CHAIN })), { kind: 'toggle' }).ok,
    ).toBe(false);
  });

  it('turns off, with the reason, when its chain can no longer run live', () => {
    const on = after(opened({ ...SAFE, path: LIVE_CHAIN }), { kind: 'toggle' });
    expect(
      valueOf(
        nextMonitoring(on, { kind: 'context-changed', context: { ...SAFE, path: DEAD_CHAIN } }),
      ),
    ).toEqual({
      kind: 'off',
      context: { ...SAFE, path: DEAD_CHAIN },
      refusal: 'Its denoiser needs the whole file.',
    });
  });
});

describe("the monitoring path's latency", () => {
  it('adds the output, the input where reported and a live chain, as an estimate short of an unreported input', () => {
    expect(monitoringLatency(DIRECT)).toEqual({ seconds: 0.015, inputKnown: true });
    expect(monitoringLatency({ route: DIRECT.route, rate: RATE, output: 0.02 })).toEqual({
      seconds: 0.02,
      inputKnown: false,
    });
    expect(monitoringLatency(DEAD_CHAIN).seconds).toBe(0.015);
  });
});

describe('the feedback risk', () => {
  it('is likely for one physical device, by its group', () => {
    expect(feedbackRisk({ id: 'a', group: 'g' }, { id: 'b', group: 'g' })).toEqual({
      kind: 'likely',
      why: 'same-device',
    });
    expect(feedbackRisk({ id: 'a', group: '' }, { id: 'b', group: '' })).toEqual({ kind: 'none' });
  });

  it.each([
    ['Microphone (Realtek(R) Audio)', 'Speakers (Realtek(R) Audio)'],
    ['MacBook Pro Microphone', 'MacBook Pro Speakers'],
    ['Default - Microphone Array (Intel SST)', 'Speakers (Intel SST)'],
  ])('is likely for %s and %s, whose names differ only by their roles', (input, output) => {
    expect(feedbackRisk({ id: 'a', label: input }, { id: 'b', label: output })).toEqual({
      kind: 'likely',
      why: 'same-name',
    });
  });

  it('is none for devices of other names, and for an output worn on the head', () => {
    expect(
      feedbackRisk({ id: 'a', label: 'USB Microphone' }, { id: 'b', label: 'Speakers (Realtek)' }),
    ).toEqual({ kind: 'none' });
    expect(
      feedbackRisk(
        { id: 'a', group: 'g', label: 'Headset Microphone (USB)' },
        { id: 'b', group: 'g', label: 'Headphones (USB)' },
      ),
    ).toEqual({ kind: 'none' });
    expect(feedbackRisk({ id: 'a', label: 'Microphone' }, { id: 'b', label: 'Speakers' })).toEqual({
      kind: 'none',
    });
  });
});
