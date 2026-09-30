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
  /** The audio thread started with timeline frame `position` reaching the output at `contextFrame`. */
  const play = (contextFrame: number, position: number): TransportEvent => ({
    kind: 'play',
    contextFrame,
    position: frames(position),
  });

  it('plays from where the audio thread says it started, and interpolates as the context runs', () => {
    const playing = run([
      { kind: 'seek', to: frames(1_000), contextFrame: 0 },
      play(48_000, 1_000),
    ]);
    expect(playing.mode).toBe(TransportMode.Playing);
    expect(at(playing, 96_000)).toBe(45_100);
  });

  it('holds a start whose first frame is still passing through the graph’s latency', () => {
    // Timeline frame 1 000 reaches the output 4 800 context frames after the start.
    const playing = run([play(4_800, 1_000)]);
    expect(at(playing, 0)).toBe(1_000);
    expect(at(playing, 4_800)).toBe(1_000);
    expect(at(playing, 4_800 + 48_000)).toBe(45_100);
  });

  it('takes each report of the audio thread’s count as the new anchor, keeping where the play began', () => {
    const playing = run([
      { kind: 'seek', to: frames(300), contextFrame: 0 },
      play(0, 300),
      // An underrun held the audio back: the count is behind the context's clock.
      { kind: 'clock', contextFrame: 48_000, position: frames(40_000) },
    ]);
    expect(at(playing, 48_000)).toBe(40_000);
    expect(at(playing, 96_000)).toBe(84_100);
    expect(run([{ kind: 'stop' }], playing)).toEqual({
      mode: TransportMode.Stopped,
      position: 300,
    });
  });

  it('ignores a report when not playing', () => {
    const paused = run([play(0, 0), { kind: 'pause', contextFrame: 4_800 }]);
    expect(run([{ kind: 'clock', contextFrame: 9_600, position: frames(9_000) }], paused)).toEqual(
      paused,
    );
  });

  it('pauses where the clock puts it, and settles where the audio thread halted', () => {
    const paused = run([play(0, 0), { kind: 'pause', contextFrame: 48_000 }]);
    expect(paused).toEqual({ mode: TransportMode.Paused, position: 44_100, origin: 0 });
    // The halt landed two quanta after the pause was asked for.
    const settled = run([{ kind: 'halted', position: frames(44_335) }], paused);
    expect(settled).toEqual({ mode: TransportMode.Paused, position: 44_335, origin: 0 });
    const resumed = run([play(200_000, 44_335)], settled);
    expect(at(resumed, 248_000)).toBe(88_435);
  });

  it('parks a paused transport where it was heard, and Stop still returns to where the play started', () => {
    const paused = run([
      { kind: 'seek', to: frames(300), contextFrame: 0 },
      play(0, 300),
      { kind: 'pause', contextFrame: 48_000 },
    ]);
    const parked = run([{ kind: 'parked', position: frames(40_000) }], paused);
    expect(parked).toEqual({ mode: TransportMode.Paused, position: 40_000, origin: 300 });
    expect(run([{ kind: 'stop' }], parked)).toEqual({ mode: TransportMode.Stopped, position: 300 });
  });

  it('refuses to park a transport that is not paused', () => {
    const playing = run([play(0, 0)]);
    const parked = nextTransportState(playing, { kind: 'parked', position: frames(10) }, CLOCK);
    expect(expectFailureCode(parked)).toBe('transport.park-while-not-paused');
  });

  it('ignores a halt when not paused, since a seek or a stop has moved it since', () => {
    const stopped = run([play(0, 0), { kind: 'stop' }]);
    expect(run([{ kind: 'halted', position: frames(4_000) }], stopped)).toEqual(stopped);
  });

  it('returns to where the last play started when stopped', () => {
    const stopped = run([
      { kind: 'seek', to: frames(300), contextFrame: 0 },
      play(0, 300),
      { kind: 'pause', contextFrame: 4_800 },
      play(9_000, 4_710),
      { kind: 'stop' },
    ]);
    expect(stopped).toEqual({ mode: TransportMode.Stopped, position: 300 });
  });

  it('freezes the position while the system holds the context, and plays on from it', () => {
    const suspended = run([play(0, 0), { kind: 'context-suspended', contextFrame: 48_000 }]);
    expect(suspended.mode).toBe(TransportMode.Suspended);
    // The context was away for a minute; the position did not move.
    expect(at(suspended, 48_000 * 61)).toBe(44_100);

    const resumed = run([{ kind: 'context-resumed', contextFrame: 48_000 * 61 }], suspended);
    expect(resumed.mode).toBe(TransportMode.Playing);
    expect(at(resumed, 48_000 * 62)).toBe(88_200);
    // A start the audio thread reports while the system holds the context waits for it.
    expect(run([play(48_000 * 2, 44_100)], suspended)).toEqual(suspended);
  });

  it('leaves a stopped or paused transport where it is when the context comes and goes', () => {
    const paused = run([play(0, 0), { kind: 'pause', contextFrame: 4_800 }]);
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
      play(0, 0),
      { kind: 'context-suspended', contextFrame: 4_800 },
      { kind: 'pause', contextFrame: 5_000 },
      { kind: 'context-resumed', contextFrame: 9_000 },
    ]);
    expect(state).toEqual({ mode: TransportMode.Paused, position: 4_410, origin: 0 });
  });

  it('seeks while playing, so playback and Stop both go from the new place', () => {
    const state = run([play(0, 0), { kind: 'seek', to: frames(10_000), contextFrame: 4_800 }]);
    expect(at(state, 4_800 + 48_000)).toBe(54_100);
    expect(run([{ kind: 'stop' }], state)).toEqual({
      mode: TransportMode.Stopped,
      position: 10_000,
    });
  });

  it('stops at the end the audio thread counted, whatever the context’s clock says', () => {
    const state = run([play(0, 0), { kind: 'reached-end', position: frames(88_000) }]);
    expect(state).toEqual({ mode: TransportMode.Stopped, position: 88_000 });
  });

  it('refuses a pause while stopped, which would say it had paused something', () => {
    expect(
      expectFailureCode(
        nextTransportState(TRANSPORT_AT_START, { kind: 'pause', contextFrame: 0 }, CLOCK),
      ),
    ).toBe('transport.pause-while-stopped');
  });
});
