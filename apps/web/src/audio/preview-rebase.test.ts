/**
 * Laying a run's plan afresh (`preview-rebase.ts`): only where nothing sounds,
 * a cut voice's fade counted as sounding, and the events from there read with
 * their voices numbered from the first.
 */

import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import type { PreviewEvent, PreviewSimulation } from '@audiogubbins/game-audio';

import { FROM_THE_START, quietAt, rebasedView, voicesLaid } from './preview-rebase.js';

const RATE = 48_000;
const EMITTER = unsafeBrandId<'PreviewEmitterId'>('e0000000-0001');
const MEMBER = { kind: 'region', region: unsafeBrandId<'RegionId'>('0000a000-0001') } as const;

function started(frame: number, voice: number): PreviewEvent {
  return {
    kind: 'started',
    frame,
    emitter: EMITTER,
    trigger: voice,
    voice,
    lane: 0,
    member: MEMBER,
    pitchCents: 0,
    gainDecibels: 0,
    offsetFrames: 0,
    bus: undefined,
  };
}

function ending(kind: 'stolen' | 'ended', frame: number, voice: number): PreviewEvent {
  return { kind, frame, emitter: EMITTER, voice };
}

/** A simulation whose log is `events`; its state is never read here but carried. */
function simulationOf(events: readonly PreviewEvent[]): PreviewSimulation {
  return { log: { events, horizonFrame: 100_000 }, state: { horizonFrame: 100_000 } };
}

describe('a quiet moment to lay a plan afresh from', () => {
  const log = simulationOf([
    started(0, 0),
    ending('ended', 1_000, 0),
    started(2_000, 1),
    ending('stolen', 3_000, 1),
    started(3_000, 2),
    ending('ended', 5_000, 2),
    started(9_000, 3),
  ]);

  it('is none while a voice sounds', () => {
    expect(quietAt(log, FROM_THE_START, 4_000, RATE)).toBeUndefined();
  });

  it('is none while a stolen voice may still be fading', () => {
    const fading = simulationOf([started(0, 0), ending('stolen', 3_000, 0)]);
    expect(quietAt(fading, FROM_THE_START, 3_200, RATE)).toBeUndefined();
    expect(quietAt(fading, FROM_THE_START, 3_480, RATE)).toEqual({ frame: 3_480, voice: 1 });
  });

  it('is where every voice before it has ended, numbering from the next', () => {
    expect(quietAt(log, FROM_THE_START, 6_000, RATE)).toEqual({ frame: 6_000, voice: 3 });
  });

  it('is read from the last one on', () => {
    expect(quietAt(log, { frame: 6_000, voice: 3 }, 9_500, RATE)).toBeUndefined();
  });
});

describe('the log as a plan laid afresh reads it', () => {
  it('holds the events from its frame, each voice numbered from the first', () => {
    const log = simulationOf([
      started(0, 0),
      ending('ended', 1_000, 0),
      started(6_000, 1),
      ending('stolen', 7_000, 1),
      started(7_000, 2),
    ]);

    const view = rebasedView(log, { frame: 6_000, voice: 1 });

    // Each trigger keeps its ordinal: only the voices are numbered again.
    expect(view.log.events).toEqual([
      { ...started(6_000, 1), voice: 0 },
      ending('stolen', 7_000, 0),
      { ...started(7_000, 2), voice: 1 },
    ]);
    expect(view.state).toBe(log.state);
    expect(voicesLaid(log, { frame: 6_000, voice: 1 })).toBe(2);
  });

  it('is the log itself from the start', () => {
    const log = simulationOf([started(0, 0)]);
    expect(rebasedView(log, FROM_THE_START)).toBe(log);
  });
});
