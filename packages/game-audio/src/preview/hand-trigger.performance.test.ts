/**
 * What a hand trigger costs at the preview's bounds (ADR-0104, section 6 of the
 * phase plan): sixteen emitters of 64 voices each triggered 50 times a second,
 * a plan already laid 30 seconds ahead, and a hand trigger ten seconds in that
 * the preview continues with a horizon 100 ms past it, the rest laid later off
 * the trigger's path.
 *
 * Measured on the reference machine: the simulation 0.5 to 0.7 ms, the plan's
 * extension 1.3 to 2.5 ms, most of it laying again every lane that sounds
 * across the trigger or held voices after it, about a microsecond each of the
 * thousand-odd lanes, whether the old plan was laid 1 s or 30 s ahead. The
 * simulation is held to the phase plan's 1 ms; the two together to 5 ms, a
 * tenth of the shortest feed-ahead (50 ms), where the plan asked 1 ms of both.
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  unsafeBrandId,
  type EditPlan,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { memberKey } from '../groups/membership.js';
import { DEFAULT_EMITTER_RULES } from '../policy/playback-rules.js';
import {
  PREVIEW_TEST_CATALOGUE,
  VARIED,
  VECTOR_RATE,
  emitterId,
  poolMember,
  repeatEmitter,
  vectorInput,
  vectorScenario,
  type VectorSpec,
} from '../testing/preview-vectors.js';
import { extendPreviewPlan, previewPlan } from './preview-plan.js';
import { simulatePreview } from './preview-simulation.js';

const ASSET = unsafeBrandId<'AssetId'>('0000beef-0001');
const SECOND = 48_000;

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('a hand trigger at the bounds', () => {
  it('is simulated within 1 ms and planned within 5 ms in all', { timeout: 120_000 }, () => {
    const emitters = Array.from({ length: 16 }, (_, index) =>
      repeatEmitter(index + 1, {
        kind: 'repeat',
        intervalMilliseconds: 20,
        jitterMilliseconds: 5,
        count: 10_000,
      }),
    );
    const pools = emitters.map((_, index) =>
      [1, 2, 3, 4].map((n) => poolMember(10 * index + n, SECOND, { variation: VARIED })),
    );
    const spec: VectorSpec = {
      scenario: vectorScenario(emitters, 3),
      emitters: pools.map((pool) => ({
        rules: { ...DEFAULT_EMITTER_RULES, voices: { limit: 64, stealing: 'oldest' } },
        pool,
      })),
      hand: [],
      voiceBudget: 16 * 64,
      horizonFrame: 30 * SECOND,
    };
    const members = new Map(
      pools.flat().map((member): [string, EditPlan] => [
        memberKey(member.member),
        {
          streams: [
            {
              sampleRate: VECTOR_RATE,
              layout: StandardLayouts.mono,
              segments: [
                {
                  source: { kind: 'media', asset: ASSET },
                  start: derivedSampleCount(0),
                  length: derivedSampleCount(SECOND),
                  reversed: false,
                  stages: [],
                },
              ],
            },
          ],
        },
      ]),
    );
    const simulation = expectSuccess(simulatePreview(vectorInput(spec)));
    const plan = expectSuccess(
      previewPlan(
        simulation,
        spec.scenario,
        members,
        PREVIEW_TEST_CATALOGUE,
        createDeterministicIdGenerator(1),
        StandardLayouts.stereo,
      ),
    );
    const simulating: number[] = [];
    const all: number[] = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const frame = 10 * SECOND + attempt;
      const started = performance.now();
      const continued = expectSuccess(
        simulatePreview(
          vectorInput({
            ...spec,
            hand: [{ kind: 'trigger', emitter: emitterId(3), frame }],
            horizonFrame: frame + SECOND / 10,
          }),
          simulation,
        ),
      );
      const simulated = performance.now();
      expectSuccess(extendPreviewPlan(plan, continued, frame));
      simulating.push(simulated - started);
      all.push(performance.now() - started);
    }
    expect(median(simulating)).toBeLessThan(1);
    expect(median(all)).toBeLessThan(5);
  });
});
