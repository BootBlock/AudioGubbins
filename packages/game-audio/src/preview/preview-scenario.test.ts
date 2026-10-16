import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';

import {
  SFX_BUS,
  regionMember,
  repeatEmitter,
  vectorScenario,
} from '../testing/preview-vectors.js';
import {
  previewScenarioProblems,
  scenarioSubjectProblems,
  type GamePreviewScenario,
  type PreviewEmitter,
} from './preview-scenario.js';

const REPEAT = {
  kind: 'repeat',
  intervalMilliseconds: 100,
  jitterMilliseconds: 50,
  count: 10,
} as const;
const WHOLE = vectorScenario([repeatEmitter(1, REPEAT)], 1);

/** The parts `scenario` is refused for. */
function parts(scenario: GamePreviewScenario): readonly string[] {
  return previewScenarioProblems(scenario).map((problem) => {
    expect(problem.code).toBe('game.scenario-invalid');
    expect(problem.details?.['scenario']).toBe(scenario.id);
    return String(problem.details?.['part']);
  });
}

function withEmitter(changes: Partial<PreviewEmitter>): GamePreviewScenario {
  return { ...WHOLE, emitters: [repeatEmitter(1, REPEAT, changes)] };
}

describe('a preview scenario', () => {
  it('is whole as the vectors make it', () => {
    expect(parts(WHOLE)).toEqual([]);
  });

  it('is refused for each value out of its range, naming the part', () => {
    expect(parts({ ...WHOLE, name: ' Padded' })).toEqual(['name']);
    expect(parts({ ...WHOLE, panWidth: 0 })).toEqual(['panWidth']);
    expect(parts({ ...WHOLE, panningStrength: 1.5 })).toEqual(['panningStrength']);
    expect(parts({ ...WHOLE, seed: 2 ** 32 })).toEqual(['seed']);
    expect(parts({ ...WHOLE, seed: 1.5 })).toEqual(['seed']);
    expect(parts({ ...WHOLE, listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 1 } })).toEqual([
      'listener.facingTurns',
    ]);
    expect(
      parts({ ...WHOLE, listener: { at: { x: 300_000, y: 0, z: 0 }, facingTurns: 0 } }),
    ).toEqual(['listener.at']);
    expect(parts({ ...WHOLE, emitters: [] })).toEqual(['emitters']);
    expect(
      parts({
        ...WHOLE,
        emitters: Array.from({ length: 17 }, (_, n) => repeatEmitter(n + 1, REPEAT)),
      }),
    ).toEqual(['emitters']);
  });

  it('holds each emitter once, under a well-formed identifier', () => {
    expect(
      parts({ ...WHOLE, emitters: [repeatEmitter(1, REPEAT), repeatEmitter(1, REPEAT)] }),
    ).toEqual(['emitters.1.id']);
    expect(parts(withEmitter({ id: unsafeBrandId('Not an id') }))).toEqual(['emitters.0.id']);
  });

  it('repeats at whole milliseconds, jitter at most half the interval', () => {
    const repeat = (changes: object) => withEmitter({ trigger: { ...REPEAT, ...changes } });
    expect(parts(repeat({ intervalMilliseconds: 19, jitterMilliseconds: 0 }))).toEqual([
      'emitters.0.trigger.intervalMilliseconds',
    ]);
    expect(parts(repeat({ intervalMilliseconds: 100.5, jitterMilliseconds: 0 }))).toEqual([
      'emitters.0.trigger.intervalMilliseconds',
    ]);
    expect(parts(repeat({ jitterMilliseconds: 51 }))).toEqual([
      'emitters.0.trigger.jitterMilliseconds',
    ]);
    expect(parts(repeat({ count: 0 }))).toEqual(['emitters.0.trigger.count']);
    expect(parts(repeat({ count: 10_001 }))).toEqual(['emitters.0.trigger.count']);
  });

  it('moves by waypoints from 0, at least 10 ms apart, a loop closed', () => {
    const path = (points: readonly [number, number][], repeat: 'once' | 'loop' = 'once') =>
      withEmitter({
        motion: {
          kind: 'waypoints',
          points: points.map(([x, milliseconds]) => ({ at: { x, y: 0, z: 0 }, milliseconds })),
          repeat,
        },
      });
    expect(
      parts(
        path([
          [0, 0],
          [1, 10],
        ]),
      ),
    ).toEqual([]);
    expect(parts(path([[0, 0]]))).toEqual(['emitters.0.motion.points']);
    expect(
      parts(
        path([
          [0, 5],
          [1, 20],
        ]),
      ),
    ).toEqual(['emitters.0.motion.points.0.milliseconds']);
    expect(
      parts(
        path([
          [0, 0],
          [1, 9],
        ]),
      ),
    ).toEqual(['emitters.0.motion.points.1.milliseconds']);
    expect(
      parts(
        path(
          [
            [0, 0],
            [1, 10],
          ],
          'loop',
        ),
      ),
    ).toEqual(['emitters.0.motion.repeat']);
    expect(
      parts(
        path(
          [
            [0, 0],
            [1, 10],
            [0, 20],
          ],
          'loop',
        ),
      ),
    ).toEqual([]);
  });

  it('places nothing off the plane in 2D', () => {
    expect(parts({ ...WHOLE, space: '2d' })).toEqual(['emitters.0.motion.at']);
    expect(
      parts({
        ...withEmitter({ motion: { kind: 'still', at: { x: 4, y: 2, z: 0 } } }),
        space: '2d',
      }),
    ).toEqual([]);
  });

  it('sets each bus one level, from −80 to 24 dB', () => {
    expect(parts({ ...WHOLE, busLevels: [{ bus: SFX_BUS, decibels: -6 }] })).toEqual([]);
    expect(parts({ ...WHOLE, busLevels: [{ bus: SFX_BUS, decibels: 25 }] })).toEqual([
      'busLevels.0.decibels',
    ]);
    expect(
      parts({
        ...WHOLE,
        busLevels: [
          { bus: SFX_BUS, decibels: 0 },
          { bus: SFX_BUS, decibels: 1 },
        ],
      }),
    ).toEqual(['busLevels.1.bus']);
  });
});

describe("a scenario's subjects", () => {
  it('are refused where they name a group or member the project lacks', () => {
    const member = withEmitter({ subject: { kind: 'member', member: regionMember(4) } });
    expect(
      scenarioSubjectProblems(
        WHOLE,
        () => true,
        () => false,
      ),
    ).toEqual([]);
    expect(
      scenarioSubjectProblems(
        WHOLE,
        () => false,
        () => true,
      ).map((one) => one.code),
    ).toEqual(['game.scenario-subject-unknown']);
    expect(
      scenarioSubjectProblems(
        member,
        () => true,
        () => false,
      ),
    ).toHaveLength(1);
    expect(
      scenarioSubjectProblems(
        member,
        () => false,
        () => true,
      ),
    ).toEqual([]);
  });
});
