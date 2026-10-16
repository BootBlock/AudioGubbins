import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { DEFAULT_EMITTER_RULES } from '../policy/playback-rules.js';
import {
  emitterId,
  poolMember,
  repeatEmitter,
  vectorInput,
  vectorScenario,
} from '../testing/preview-vectors.js';
import { cooldownFrames, suppressedBy } from './cooldown.js';
import { simulatePreview } from './preview-simulation.js';

describe('a cooldown', () => {
  it('is strict: a trigger exactly the cooldown after the last started one starts', () => {
    expect(suppressedBy(1_000, 900, 100)).toBe(false);
    expect(suppressedBy(999, 900, 100)).toBe(true);
    expect(suppressedBy(5, undefined, 100)).toBe(false);
    expect(cooldownFrames(100, 48_000)).toBe(4_800);
  });

  it('suppresses triggers within it, measured from the last trigger that started', () => {
    // Every 60 ms with a 100 ms cooldown: 0 starts, 60 is suppressed, 120 starts
    // (120 after 0), 180 suppressed, 240 starts.
    const emitter = repeatEmitter(1, {
      kind: 'repeat',
      intervalMilliseconds: 60,
      jitterMilliseconds: 0,
      count: 5,
    });
    const log = expectSuccess(
      simulatePreview(
        vectorInput({
          scenario: vectorScenario([emitter], 1),
          emitters: [
            {
              rules: { ...DEFAULT_EMITTER_RULES, cooldownMilliseconds: 100 },
              pool: [poolMember(1, 480)],
            },
          ],
          hand: [],
          voiceBudget: 64,
          horizonFrame: 48_000,
        }),
      ),
    ).log;
    const triggers = log.events.filter((event) => event.kind !== 'ended');
    expect(triggers.map((event) => [event.kind, event.frame])).toEqual([
      ['started', 0],
      ['suppressed', 2_880],
      ['started', 5_760],
      ['suppressed', 8_640],
      ['started', 11_520],
    ]);
  });

  it('is not moved by a trigger the voice limit rejects', () => {
    // A limit of one that rejects, a voice longer than everything, and a
    // cooldown of 100 ms: the trigger at 0 starts; those at 120 ms and 240 ms
    // are past the cooldown and rejected; had a rejection moved the cooldown,
    // the trigger at 300 ms would be suppressed rather than rejected.
    const emitter = repeatEmitter(1, {
      kind: 'repeat',
      intervalMilliseconds: 60,
      jitterMilliseconds: 0,
      count: 6,
    });
    const rules = {
      ...DEFAULT_EMITTER_RULES,
      cooldownMilliseconds: 100,
      voices: { limit: 1, stealing: 'reject' as const },
    };
    const log = expectSuccess(
      simulatePreview(
        vectorInput({
          scenario: vectorScenario([emitter], 1),
          emitters: [{ rules, pool: [poolMember(1, 480_000)] }],
          hand: [{ kind: 'trigger', emitter: emitterId(1), frame: 14_400 }],
          voiceBudget: 64,
          horizonFrame: 48_000,
        }),
      ),
    ).log;
    expect(log.events.map((event) => [event.kind, event.frame])).toEqual([
      ['started', 0],
      ['suppressed', 2_880],
      ['rejected', 5_760],
      ['rejected', 8_640],
      ['rejected', 11_520],
      ['rejected', 14_400],
      ['rejected', 14_400],
    ]);
  });
});
