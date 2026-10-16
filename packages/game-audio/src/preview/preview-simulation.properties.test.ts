/**
 * The simulation's properties over random scenarios (ADR-0104, the plan's
 * section 13 for REQ-GAME-122): determinism, continuation, the voice limit and
 * budget, repetition avoidance, counter draws, and members' own variation.
 */

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { DEFAULT_EMITTER_RULES } from '../policy/playback-rules.js';
import {
  SFX_BUS,
  emitterId,
  poolMember,
  randomVectorSpec,
  repeatEmitter,
  vectorInput,
  vectorScenario,
  type VectorSpec,
} from '../testing/preview-vectors.js';
import { memberKey } from '../groups/membership.js';
import type { PreviewEvent, StartedEvent } from './preview-event-log.js';
import { simulatePreview, type PreviewSimulation } from './preview-simulation.js';

const SEEDS = Array.from({ length: 40 }, (_, index) => 1_000 + index);

function simulated(spec: VectorSpec, from?: PreviewSimulation): PreviewSimulation {
  return expectSuccess(simulatePreview(vectorInput(spec), from));
}

function startedOf(events: readonly PreviewEvent[]): readonly StartedEvent[] {
  return events.filter((event): event is StartedEvent => event.kind === 'started');
}

describe('a simulation', () => {
  it.each(SEEDS)(
    'is the same log for the same input, and another for another seed (%i)',
    (seed) => {
      const spec = randomVectorSpec(seed);
      expect(simulated(spec).log).toEqual(simulated(spec).log);
      const reseeded = {
        ...spec,
        scenario: { ...spec.scenario, seed: (spec.scenario.seed + 1) % 2 ** 32 },
      };
      const started = startedOf(simulated(spec).log.events);
      if (started.some((event) => event.pitchCents !== 0 || event.gainDecibels !== 0)) {
        expect(startedOf(simulated(reseeded).log.events)).not.toEqual(started);
      }
    },
  );

  it.each(SEEDS)(
    'continued is the whole: earlier horizons and hand actions added later change nothing heard (%i)',
    (seed) => {
      const spec = randomVectorSpec(seed);
      const whole = simulated(spec).log;
      // The hand actions arrive one by one, each continuation to a horizon a
      // little after it, then the rest; each keeps the log before its frame.
      let running = simulated({ ...spec, hand: [], horizonFrame: 9_000 });
      for (let count = 1; count <= spec.hand.length; count += 1) {
        const hand = spec.hand.slice(0, count);
        const at = hand.at(-1)?.frame ?? 0;
        const next = simulated(
          {
            ...spec,
            hand,
            horizonFrame: Math.min(
              spec.horizonFrame,
              Math.max(at + 4_800, running.log.horizonFrame),
            ),
          },
          running,
        );
        const kept = running.log.events.filter(
          (event) => event.frame < Math.min(at, running.log.horizonFrame),
        );
        expect(next.log.events.slice(0, kept.length)).toEqual(kept);
        running = next;
      }
      expect(simulated(spec, running).log).toEqual(whole);
    },
  );

  it.each(SEEDS)(
    'never sounds more than an emitter’s limit or the preview’s budget (%i)',
    (seed) => {
      const spec = randomVectorSpec(seed);
      const sounding = new Map<number, string>();
      const limits = new Map(
        spec.scenario.emitters.map((emitter, index) => [
          emitter.id,
          spec.emitters[index]?.rules.voices.limit ?? 0,
        ]),
      );
      for (const event of simulated(spec).log.events) {
        if (event.kind === 'started') {
          sounding.set(event.voice, event.emitter);
          const own = [...sounding.values()].filter((emitter) => emitter === event.emitter).length;
          expect(own).toBeLessThanOrEqual(limits.get(event.emitter) ?? 0);
          expect(sounding.size).toBeLessThanOrEqual(spec.voiceBudget);
        } else if ('voice' in event) {
          expect(sounding.delete(event.voice)).toBe(true);
        }
      }
    },
  );

  it.each(SEEDS)(
    'with avoid-recent(d) never repeats a member within d choices where the pool leaves another (%i)',
    (seed) => {
      const spec = randomVectorSpec(seed);
      for (const [index, emitter] of spec.scenario.emitters.entries()) {
        const { rules, pool } = spec.emitters[index] ?? { rules: DEFAULT_EMITTER_RULES, pool: [] };
        if (rules.selection.kind !== 'avoid-recent' || pool.length <= rules.selection.depth)
          continue;
        const depth = rules.selection.depth;
        const chosen = startedOf(simulated(spec).log.events)
          .filter((event) => event.emitter === emitter.id)
          .map((event) => memberKey(event.member));
        chosen.forEach((member, at) => {
          expect(chosen.slice(Math.max(0, at - depth), at)).not.toContain(member);
        });
      }
    },
  );
});

describe("a trigger's choices", () => {
  it('are its own draws: a trigger suppressed before it changes none of them', () => {
    const emitter = repeatEmitter(1, {
      kind: 'repeat',
      intervalMilliseconds: 30,
      jitterMilliseconds: 5,
      count: 40,
    });
    const pool = [1, 2, 3, 4].map((n) =>
      poolMember(n, 2_000, {
        variation: {
          pitchCents: { min: -500, max: 500 },
          gainDecibels: { min: -12, max: 0 },
          startOffsetMilliseconds: { max: 10 },
        },
      }),
    );
    const spec = (cooldownMilliseconds: number): VectorSpec => ({
      scenario: vectorScenario([emitter], 77),
      emitters: [
        {
          rules: {
            ...DEFAULT_EMITTER_RULES,
            voices: { limit: 64, stealing: 'oldest' },
            cooldownMilliseconds,
          },
          pool,
        },
      ],
      hand: [],
      voiceBudget: 64,
      horizonFrame: 96_000,
    });
    const free = new Map(
      startedOf(simulated(spec(0)).log.events).map((event) => [event.trigger, event]),
    );
    const cooled = startedOf(simulated(spec(70)).log.events);
    expect(cooled.length).toBeLessThan(free.size);
    for (const event of cooled) {
      const same = free.get(event.trigger);
      expect([event.member, event.pitchCents, event.gainDecibels, event.offsetFrames]).toEqual([
        same?.member,
        same?.pitchCents,
        same?.gainDecibels,
        same?.offsetFrames,
      ]);
    }
  });

  it('take each chosen member’s own variation and bus', () => {
    const emitter = repeatEmitter(1, {
      kind: 'repeat',
      intervalMilliseconds: 40,
      jitterMilliseconds: 0,
      count: 30,
    });
    const fixed = (cents: number) => ({
      pitchCents: { min: cents, max: cents },
      gainDecibels: { min: 0, max: 0 },
      startOffsetMilliseconds: { max: 0 },
    });
    const pool = [
      poolMember(1, 1_000, { variation: fixed(-100) }),
      poolMember(2, 1_000, { variation: fixed(700), bus: SFX_BUS }),
    ];
    const started = startedOf(
      simulated({
        scenario: vectorScenario([emitter], 3),
        emitters: [{ rules: DEFAULT_EMITTER_RULES, pool }],
        hand: [],
        voiceBudget: 64,
        horizonFrame: 96_000,
      }).log.events,
    );
    expect(new Set(started.map((event) => memberKey(event.member))).size).toBe(2);
    for (const event of started) {
      const second = memberKey(event.member) === memberKey(pool[1]?.member ?? event.member);
      expect([event.pitchCents, event.bus]).toEqual(second ? [700, SFX_BUS] : [-100, undefined]);
    }
  });

  it('do not depend on the order of the scenario’s emitters', () => {
    const spec = randomVectorSpec(4_242);
    const reversed: VectorSpec = {
      ...spec,
      scenario: { ...spec.scenario, emitters: spec.scenario.emitters.toReversed() },
      emitters: spec.emitters.toReversed(),
    };
    expect(simulated(reversed).log).toEqual(simulated(spec).log);
  });
});

describe('a continuation', () => {
  it('goes on from a snapshot well before its horizon, many snapshots in', () => {
    // Four emitters of 400 triggers each: thousands of actions, so a hand
    // trigger at 5 s goes on from a snapshot and replays only from it.
    const repeat = {
      kind: 'repeat',
      intervalMilliseconds: 20,
      jitterMilliseconds: 10,
      count: 400,
    } as const;
    const emitters = [1, 2, 3, 4].map((n) => repeatEmitter(n, repeat));
    const spec: VectorSpec = {
      scenario: vectorScenario(emitters, 9),
      emitters: emitters.map((_, index) => ({
        rules: {
          ...DEFAULT_EMITTER_RULES,
          voices: { limit: 3, stealing: 'quietest' },
          cooldownMilliseconds: 25,
        },
        pool: [1, 2, 3].map((n) =>
          poolMember(10 * index + n, 9_000, {
            variation: {
              pitchCents: { min: -50, max: 50 },
              gainDecibels: { min: -9, max: 0 },
              startOffsetMilliseconds: { max: 5 },
            },
          }),
        ),
      })),
      hand: [],
      voiceBudget: 8,
      horizonFrame: 480_000,
    };
    const before = simulated(spec);
    const hand = [
      { kind: 'trigger', emitter: emitterId(2), frame: 240_017 },
      { kind: 'stop', emitter: emitterId(3), frame: 240_017 },
      { kind: 'trigger', emitter: emitterId(2), frame: 300_000 },
    ] as const;
    const after = { ...spec, hand };
    expect(simulated(after, before).log).toEqual(simulated(after).log);
    expect(simulated(after, before).log.events.filter((event) => event.frame < 240_017)).toEqual(
      before.log.events.filter((event) => event.frame < 240_017),
    );
  });

  it('is refused from a simulation of other rules or hand actions it does not keep', () => {
    const spec = randomVectorSpec(5);
    const from = simulated({
      ...spec,
      hand: [{ kind: 'trigger', emitter: emitterId(1), frame: 10 }],
    });
    expect(simulatePreview(vectorInput({ ...spec, hand: [] }), from).ok).toBe(false);
    const other: VectorSpec = { ...spec, voiceBudget: spec.voiceBudget + 1 };
    expect(simulatePreview(vectorInput(other), simulated(spec)).ok).toBe(false);
  });
});
