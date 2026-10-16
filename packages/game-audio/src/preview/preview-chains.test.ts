import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator } from '@audiogubbins/domain';

import {
  DEFAULT_EMITTER_RULES,
  emitterRulesProblems,
  type EmitterRules,
} from '../policy/playback-rules.js';
import {
  PREVIEW_TEST_CATALOGUE,
  regionMember,
  repeatEmitter,
  vectorScenario,
} from '../testing/preview-vectors.js';
import { randomEmitterRules } from '../testing/random-game-state.js';
import { randomScenario } from '../testing/random-scenarios.js';
import { seededRandom } from '../testing/seeded-random.js';
import { pannerChain } from './preview-chains.js';

/**
 * The preview never refuses what the project holds: every emitter rule the
 * policy takes is one the spatial panner takes, so a validated scenario always
 * becomes a plan (ADR-0104).
 */

const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1);
const BY_HAND = { kind: 'by-hand' } as const;

function pannerFor(rules: EmitterRules, seed: number) {
  const random = seededRandom(seed);
  const ids = createDeterministicIdGenerator(seed);
  const scenario = randomScenario(random, ids, [{ kind: 'member', member: regionMember(1) }]);
  const [emitter] = scenario.emitters;
  if (emitter === undefined) throw new Error('A scenario has an emitter.');
  return pannerChain(scenario, rules, emitter.motion, PREVIEW_TEST_CATALOGUE, ids);
}

describe("an emitter's panner (ADR-0104)", () => {
  it('is made for every emitter rule the policy takes, at every distance', () => {
    for (const seed of SEEDS) {
      const rules = randomEmitterRules(seededRandom(seed));
      expect(emitterRulesProblems(rules), String(seed)).toEqual([]);
      expect(pannerFor(rules, seed).ok, String(seed)).toBe(true);
    }
  });

  it('is made at the ends of each distance the policy takes, no limit among them', () => {
    const scenario = vectorScenario([repeatEmitter(1, BY_HAND)], 1);
    const ids = createDeterministicIdGenerator(3);
    for (const attenuation of [
      { kind: 'inverse', unitSize: 0.01, maxDistance: 0, ceilingDecibels: 24 },
      { kind: 'logarithmic', unitSize: 1_000_000, maxDistance: 0, ceilingDecibels: -80 },
      { kind: 'inverse-square', unitSize: 0.01, maxDistance: 1_000_000, ceilingDecibels: 0 },
      { kind: 'exponent', maxDistance: 0, exponent: 16 },
      { kind: 'exponent', maxDistance: 1_000_000, exponent: 0.01 },
    ] satisfies EmitterRules['attenuation'][]) {
      const rules = { ...DEFAULT_EMITTER_RULES, attenuation };
      expect(emitterRulesProblems(rules)).toEqual([]);
      const motion = scenario.emitters[0]?.motion ?? { kind: 'still', at: { x: 0, y: 0, z: 0 } };
      expect(pannerChain(scenario, rules, motion, PREVIEW_TEST_CATALOGUE, ids).ok).toBe(true);
    }
  });
});
