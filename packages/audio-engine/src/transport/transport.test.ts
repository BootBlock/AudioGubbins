import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate, type SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { audibleFrame, contextFrameFor, timelineFrameAt, type MediaClock } from './media-clock.js';
import {
  TRANSPORT_AT_START,
  TransportMode,
  nextTransportState,
  transportPosition,
  type TransportEvent,
  type TransportState,
} from './transport.js';

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

/** 44.1 kHz material on a 48 kHz device: the rates differ, as they usually do. */
const CLOCK: MediaClock = {
  timelineRate: expectSuccess(sampleRate(44_100)),
  contextRate: expectSuccess(sampleRate(48_000)),
};

function run(events: readonly TransportEvent[], from: TransportState = TRANSPORT_AT_START) {
  return events.reduce<TransportState>(
    (state, event) => expectSuccess(nextTransportState(state, event, CLOCK)),
    from,
  );
}

function at(state: TransportState, contextFrame: number): number {
  return expectSuccess(transportPosition(state, CLOCK, contextFrame));
}

describe('the media clock', () => {
  const anchor = { contextFrame: 1_000, timelineFrame: frames(500) };

  it('converts context frames to timeline frames at the two rates, rounding down', () => {
    // One second of context is 44 100 timeline frames.
    expect(expectSuccess(timelineFrameAt(CLOCK, anchor, 49_000))).toBe(44_600);
    // 1 context frame is 0.91875 timeline frames: not yet one.
    expect(expectSuccess(timelineFrameAt(CLOCK, anchor, 1_001))).toBe(500);
  });

  it('stays exact ten hours in, where the product of frames and rate passes 2^53', () => {
    const tenHours = 10 * 3_600 * 48_000;
    const exact = (BigInt(tenHours) * 44_100n) / 48_000n;
    expect(BigInt(expectSuccess(timelineFrameAt(CLOCK, anchor, 1_000 + tenHours)))).toBe(
      500n + exact,
    );
  });

  it('finds the first context frame that plays a timeline frame', () => {
    for (const target of [500, 501, 777, 44_600]) {
      const contextFrame = contextFrameFor(CLOCK, anchor, frames(target));
      expect(expectSuccess(timelineFrameAt(CLOCK, anchor, contextFrame))).toBeGreaterThanOrEqual(
        target,
      );
      if (contextFrame > anchor.contextFrame) {
        expect(expectSuccess(timelineFrameAt(CLOCK, anchor, contextFrame - 1))).toBeLessThan(
          target,
        );
      }
    }
  });

  it('puts what is heard behind what is played by the output latency', () => {
    // 480 context frames of output latency is 441 timeline frames.
    expect(expectSuccess(audibleFrame(CLOCK, frames(10_000), 480))).toBe(9_559);
    expect(expectSuccess(audibleFrame(CLOCK, frames(100), 480))).toBe(0);
  });
});

describe('the transport', () => {
  it('plays from where it stands and reports its position as the context runs', () => {
    const playing = run([
      { kind: 'seek', to: frames(1_000), contextFrame: 0 },
      { kind: 'play', contextFrame: 48_000 },
    ]);
    expect(playing.mode).toBe(TransportMode.Playing);
    expect(at(playing, 96_000)).toBe(45_100);
  });

  it('pauses where it was and plays on from there', () => {
    const paused = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'pause', contextFrame: 48_000 },
    ]);
    expect(paused).toEqual({ mode: TransportMode.Paused, position: 44_100, origin: 0 });
    const resumed = run([{ kind: 'play', contextFrame: 200_000 }], paused);
    expect(at(resumed, 248_000)).toBe(88_200);
  });

  it('returns to where the last play started when stopped', () => {
    const stopped = run([
      { kind: 'seek', to: frames(300), contextFrame: 0 },
      { kind: 'play', contextFrame: 0 },
      { kind: 'pause', contextFrame: 4_800 },
      { kind: 'play', contextFrame: 9_000 },
      { kind: 'stop' },
    ]);
    expect(stopped).toEqual({ mode: TransportMode.Stopped, position: 300 });
  });

  it('freezes the position while the system holds the context, and plays on from it', () => {
    const suspended = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'context-suspended', contextFrame: 48_000 },
    ]);
    expect(suspended.mode).toBe(TransportMode.Suspended);
    // The context was away for a minute; the position did not move.
    expect(at(suspended, 48_000 * 61)).toBe(44_100);

    const resumed = run([{ kind: 'context-resumed', contextFrame: 48_000 * 61 }], suspended);
    expect(resumed.mode).toBe(TransportMode.Playing);
    expect(at(resumed, 48_000 * 62)).toBe(88_200);
  });

  it('leaves a stopped or paused transport where it is when the context comes and goes', () => {
    const paused = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'pause', contextFrame: 4_800 },
    ]);
    for (const state of [TRANSPORT_AT_START, paused]) {
      const after = run(
        [
          { kind: 'context-suspended', contextFrame: 10_000 },
          { kind: 'context-resumed', contextFrame: 20_000 },
        ],
        state,
      );
      expect(after).toEqual(state);
    }
  });

  it('stays paused through a resumption when paused while the context was away', () => {
    const state = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'context-suspended', contextFrame: 4_800 },
      { kind: 'pause', contextFrame: 5_000 },
      { kind: 'context-resumed', contextFrame: 9_000 },
    ]);
    expect(state).toEqual({ mode: TransportMode.Paused, position: 4_410, origin: 0 });
  });

  it('seeks while playing, so playback and Stop both go from the new place', () => {
    const state = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'seek', to: frames(10_000), contextFrame: 4_800 },
    ]);
    expect(at(state, 4_800 + 48_000)).toBe(54_100);
    expect(run([{ kind: 'stop' }], state)).toEqual({
      mode: TransportMode.Stopped,
      position: 10_000,
    });
  });

  it('stops where the material ran out', () => {
    const state = run([
      { kind: 'play', contextFrame: 0 },
      { kind: 'reached-end', contextFrame: 96_000 },
    ]);
    expect(state).toEqual({ mode: TransportMode.Stopped, position: 88_200 });
  });

  it('refuses a pause while stopped, which would say it had paused something', () => {
    expect(
      expectFailureCode(
        nextTransportState(TRANSPORT_AT_START, { kind: 'pause', contextFrame: 0 }, CLOCK),
      ),
    ).toBe('transport.pause-while-stopped');
  });
});
