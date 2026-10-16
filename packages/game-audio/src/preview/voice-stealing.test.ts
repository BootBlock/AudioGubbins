import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { DEFAULT_EMITTER_RULES, type VoiceStealing } from '../policy/playback-rules.js';
import {
  emitterId,
  poolMember,
  repeatEmitter,
  vectorInput,
  vectorScenario,
} from '../testing/preview-vectors.js';
import type { PreviewEvent, VoiceEndEvent } from './preview-event-log.js';
import { simulatePreview } from './preview-simulation.js';
import type { HandAction } from './trigger-schedule.js';
import { lowestFreeLane, victimOf, type SoundingVoice } from './voice-allocation.js';

function voice(
  number: number,
  start: number,
  gainDecibels = 0,
  rank = 0,
  lane = number,
): SoundingVoice {
  return { voice: number, rank, lane, start, gainDecibels };
}

describe('the voice a full emitter steals', () => {
  it('is the oldest by frame, then by emitter, then by lane', () => {
    expect(victimOf([voice(1, 20), voice(2, 10), voice(3, 30)], 'oldest').voice).toBe(2);
    expect(victimOf([voice(1, 10, 0, 1, 0), voice(2, 10, 0, 0, 5)], 'oldest').voice).toBe(2);
    expect(victimOf([voice(1, 10, 0, 0, 4), voice(2, 10, 0, 0, 2)], 'oldest').voice).toBe(2);
  });

  it('is the quietest, then the oldest', () => {
    expect(victimOf([voice(1, 10, -3), voice(2, 20, -9), voice(3, 30, -1)], 'quietest').voice).toBe(
      2,
    );
    expect(victimOf([voice(1, 20, -6), voice(2, 10, -6)], 'quietest').voice).toBe(2);
  });
});

describe('a lane', () => {
  it('is the lowest free at the frame, or the next one', () => {
    expect(lowestFreeLane([100, 50, 0], 60)).toBe(1);
    expect(lowestFreeLane([100, 50, 0], 40)).toBe(2);
    expect(lowestFreeLane([100, 100], 40)).toBe(2);
    expect(lowestFreeLane([60], 60)).toBe(0);
  });
});

/** The log of one emitter of a limit of `limit` stealing by `stealing`, its voices one second long. */
function stealing(
  limit: number,
  rule: VoiceStealing,
  hand: readonly HandAction[],
  gains = { min: 0, max: 0 },
): readonly PreviewEvent[] {
  const emitter = repeatEmitter(1, {
    kind: 'repeat',
    intervalMilliseconds: 100,
    jitterMilliseconds: 0,
    count: 6,
  });
  const pool = [
    poolMember(1, 48_000, {
      variation: {
        pitchCents: { min: 0, max: 0 },
        gainDecibels: gains,
        startOffsetMilliseconds: { max: 0 },
      },
    }),
  ];
  return expectSuccess(
    simulatePreview(
      vectorInput({
        scenario: vectorScenario([emitter], 5),
        emitters: [
          { rules: { ...DEFAULT_EMITTER_RULES, voices: { limit, stealing: rule } }, pool },
        ],
        hand,
        voiceBudget: 64,
        horizonFrame: 96_000,
      }),
    ),
  ).log.events;
}

describe('an emitter at its limit', () => {
  it('steals its oldest voice, which fades in its own lane while the new one takes another', () => {
    const events = stealing(2, 'oldest', []);
    const started = events.filter((event) => event.kind === 'started');
    const stolen = events.filter((event): event is VoiceEndEvent => event.kind === 'stolen');
    // Two voices, then each trigger steals the oldest: lanes 0, 1, then the
    // stolen voice's lane is busy with its fade, so 2, then 0 (its voice
    // stolen 100 ms before, long faded), then 1, then 2.
    expect(started.map((event) => event.lane)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(stolen.map((event) => [event.voice, event.frame])).toEqual([
      [0, 9_600],
      [1, 14_400],
      [2, 19_200],
      [3, 24_000],
    ]);
    // Never more than the limit sounding, and never more than limit + 1 lanes.
    expect(Math.max(...started.map((event) => event.lane))).toBe(2);
  });

  it('takes a lane beyond its limit + 1 only where two steals fall within one fade', () => {
    // Two hand triggers on the frame of a repeat's: three steals at one frame.
    const at = 9_600;
    const hand: HandAction[] = [
      { kind: 'trigger', emitter: emitterId(1), frame: at },
      { kind: 'trigger', emitter: emitterId(1), frame: at },
    ];
    const started = stealing(2, 'oldest', hand).filter(
      (event) => event.kind === 'started' && event.frame === at,
    );
    expect(started.map((event) => event.kind === 'started' && event.lane)).toEqual([2, 3, 4]);
  });

  it('steals its quietest voice where its rule says so', () => {
    const events = stealing(2, 'quietest', [], { min: -12, max: 0 });
    const gains = new Map(
      events.flatMap((event) =>
        event.kind === 'started' ? [[event.voice, event.gainDecibels]] : [],
      ),
    );
    const firstSteal = events.find((event) => event.kind === 'stolen');
    expect(firstSteal?.kind === 'stolen' && firstSteal.voice).toBe(
      (gains.get(0) ?? 0) <= (gains.get(1) ?? 0) ? 0 : 1,
    );
  });

  it('rejects the trigger where its rule rejects, starting nothing', () => {
    const events = stealing(2, 'reject', []).filter((event) => event.kind !== 'ended');
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'started',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ]);
  });
});

describe('the preview at its voice budget', () => {
  it('applies the triggering emitter’s rule across every emitter', () => {
    const repeat = {
      kind: 'repeat',
      intervalMilliseconds: 100,
      jitterMilliseconds: 0,
      count: 3,
    } as const;
    const pool = [poolMember(1, 48_000)];
    const run = (rule: VoiceStealing) =>
      expectSuccess(
        simulatePreview(
          vectorInput({
            scenario: vectorScenario([repeatEmitter(1, repeat), repeatEmitter(2, repeat)], 3),
            emitters: [1, 2].map(() => ({
              rules: { ...DEFAULT_EMITTER_RULES, voices: { limit: 8, stealing: rule } },
              pool,
            })),
            hand: [],
            voiceBudget: 3,
            horizonFrame: 48_000,
          }),
        ),
      ).log.events.map((event) => [event.kind, event.frame, event.emitter]);
    const [first, second] = [emitterId(1), emitterId(2)];
    expect(run('oldest')).toEqual([
      ['started', 0, first],
      ['started', 0, second],
      ['started', 4_800, first],
      // The budget is full: the oldest across both is emitter 1's first voice.
      ['budget-stolen', 4_800, first],
      ['started', 4_800, second],
      ['budget-stolen', 9_600, second],
      ['started', 9_600, first],
      ['budget-stolen', 9_600, first],
      ['started', 9_600, second],
    ]);
    expect(run('reject').filter(([kind]) => kind === 'budget-rejected')).toHaveLength(3);
  });
});
