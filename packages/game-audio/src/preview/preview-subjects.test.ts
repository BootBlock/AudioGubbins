/**
 * What a preview's emitters play by, read from the game-audio state, and the
 * preview's one promise about that state: it is audition, so simulating and
 * planning a scenario leave the project and its game-audio state exactly as
 * they were (ADR-0104).
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  sampleRate,
  type EditPlan,
  type Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { GameAudioState } from '../groups/game-audio-state.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import { DEFAULT_EMITTER_RULES, DEFAULT_VOICE_VARIATION } from '../policy/playback-rules.js';
import { resolveAll, resolveGroupPolicy } from '../policy/policy-resolution.js';
import { randomGameWorld } from '../testing/random-game-state.js';
import {
  PREVIEW_TEST_CATALOGUE,
  repeatEmitter,
  vectorScenario,
} from '../testing/preview-vectors.js';
import { previewPlan } from './preview-plan.js';
import { simulatePreview } from './preview-simulation.js';
import { previewSubjects, type MemberSound } from './preview-subjects.js';

const RATE = expectSuccess(sampleRate(48_000));
const SOUND: MemberSound = { sampleRate: RATE, length: 4_800 };

/** A member's plan: its asset or region's first 4,800 frames, as far as the preview reads it. */
function planOf(project: Project, member: GroupMember): EditPlan {
  const asset =
    member.kind === 'asset' ? member.asset : project.regions.get(member.region)?.assetId;
  if (asset === undefined) throw new Error('A member of the world is in its project.');
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: StandardLayouts.stereo,
        segments: [
          {
            source: { kind: 'media', asset },
            start: derivedSampleCount(0),
            length: derivedSampleCount(4_800),
            reversed: false,
            stages: [],
          },
        ],
      },
    ],
  };
}

/** A copy of the project and state that shares nothing with them. */
function copied(project: Project, state: GameAudioState): unknown {
  return structuredClone({ project, state });
}

describe("a preview's subjects", () => {
  it.each([3, 11, 19, 27])(
    'play by the group’s resolved rules and each member’s own variation and bus (world %i)',
    (seed) => {
      const { project, state } = randomGameWorld(seed);
      const subjects = previewSubjects(project, state, () => SOUND);
      const policies = resolveAll(project, state);
      for (const group of state.groups.keys()) {
        expect(subjects.emitterRules({ kind: 'group', group })).toEqual(
          resolveGroupPolicy(state, group).fields.emitter.value ?? DEFAULT_EMITTER_RULES,
        );
        const pool = subjects.poolOf({ kind: 'group', group });
        const members = state.memberships
          .filter((one) => one.group === group)
          .map((one) => one.member);
        expect(pool.map((one) => one.member)).toEqual(members);
        for (const one of pool) {
          const policy = policies.get(memberKey(one.member));
          expect(one.variation).toEqual(policy?.variation.value ?? DEFAULT_VOICE_VARIATION);
          expect(one.bus).toEqual(policy?.bus.value);
        }
      }
    },
  );

  it('leave out a member with no sound, and play a member by its group’s rules', () => {
    const { project, state } = randomGameWorld(5);
    const [first] = state.memberships;
    if (first === undefined) throw new Error('The world has a member.');
    const subjects = previewSubjects(project, state, (member) =>
      memberKey(member) === memberKey(first.member) ? undefined : SOUND,
    );
    expect(subjects.poolOf({ kind: 'member', member: first.member })).toEqual([]);
    expect(subjects.emitterRules({ kind: 'member', member: first.member })).toEqual(
      resolveGroupPolicy(state, first.group).fields.emitter.value ?? DEFAULT_EMITTER_RULES,
    );
  });
});

describe('a preview', () => {
  it.each([2, 8, 14])(
    'leaves the project and its game-audio state as they were (world %i)',
    (seed) => {
      const { project, state } = randomGameWorld(seed);
      const before = copied(project, state);
      const groups = [...state.groups.keys()].filter((group) =>
        state.memberships.some((one) => one.group === group),
      );
      const emitters = groups
        .slice(0, 4)
        .map((group, index) =>
          repeatEmitter(
            index + 1,
            { kind: 'repeat', intervalMilliseconds: 50, jitterMilliseconds: 10, count: 20 },
            { subject: { kind: 'group', group } },
          ),
        );
      if (emitters.length === 0) throw new Error('The world has a group with members.');
      const scenario = vectorScenario(emitters, seed);
      const subjects = previewSubjects(project, state, () => SOUND);
      const simulation = expectSuccess(
        simulatePreview({
          scenario,
          ...subjects,
          hand: [],
          sampleRate: RATE,
          voiceBudget: 16,
          horizonFrame: 48_000,
        }),
      );
      const members = new Map(
        state.memberships.map((one) => [memberKey(one.member), planOf(project, one.member)]),
      );
      expectSuccess(
        previewPlan(
          simulation,
          scenario,
          members,
          PREVIEW_TEST_CATALOGUE,
          createDeterministicIdGenerator(seed),
          StandardLayouts.stereo,
        ),
      );
      expect(copied(project, state)).toEqual(before);
    },
  );
});
