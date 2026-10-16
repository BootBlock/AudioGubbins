import {
  FadeShape,
  createDeterministicIdGenerator,
  derivedSampleCount,
} from '@audiogubbins/domain';
import { memberKey } from '@audiogubbins/game-audio';
import type {
  LoopAnalysis,
  LoopCandidate,
  LoopMetric,
  LoopMetrics,
} from '@audiogubbins/loop-analysis';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { setRegionInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import {
  CREATE_SEAMLESS_LOOP,
  type CreateSeamlessLoopOptions,
  type LoopAnalyses,
  type LoopChoice,
} from './create-seamless-loop.js';
import type { WorkflowTarget } from './guided-workflow.js';
import { applied, stateText, workflowBus, workflowWorld } from './testing/index.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };

const PASSING: LoopMetric = { value: 0, unit: 'ratio', verdict: 'pass', channel: 0 };

const METRICS: LoopMetrics = {
  discontinuity: PASSING,
  dcMismatch: PASSING,
  netDc: PASSING,
  levelMismatch: PASSING,
  phaseMismatch: PASSING,
  spectralMismatch: PASSING,
  zeroCrossing: { start: PASSING, end: PASSING, signs: PASSING },
  crossfade: undefined,
  cycleStability: { seam: PASSING, drift: PASSING },
};

function candidate(rank: number, start: number, end: number): LoopCandidate {
  return {
    rank,
    start,
    end,
    moved: { start: 0, end: 0 },
    cost: rank,
    metrics: METRICS,
    crossfade: { lengthFrames: 240, shape: FadeShape.Linear },
    makesRoomForCrossfade: false,
  };
}

/** The analysis of each region `analysesFor` asks for, offering `candidates`. */
function answered(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: CreateSeamlessLoopOptions,
  candidates: readonly LoopCandidate[],
): LoopAnalyses {
  return new Map(
    CREATE_SEAMLESS_LOOP.analysesFor(state, targets, options).flatMap((need) => {
      if (need.kind !== 'loop') return [];
      const analysis: LoopAnalysis = {
        version: 1,
        sampleRate: state.project.settings.sampleRate,
        channels: 1,
        windowFrames: 1_024,
        current: METRICS,
        verdict: 'pass',
        candidates,
        seam: { tail: [], head: [] },
      };
      return [[memberKey(need.target), { request: need.request, analysis }] as const];
    }),
  );
}

function plan(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: CreateSeamlessLoopOptions,
  candidates: readonly LoopCandidate[],
  analysedOptions = options,
) {
  const result = CREATE_SEAMLESS_LOOP.plan({
    state,
    targets,
    options,
    analyses: answered(state, targets, analysedOptions, candidates),
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(5),
    clock: CLOCK,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const CANDIDATES = [candidate(1, 2_400, 21_600), candidate(2, 2_350, 21_650)];

function chose(key: string, choice: LoopChoice, endAtLoopEnd = false): CreateSeamlessLoopOptions {
  return { search: undefined, choices: new Map([[key, choice]]), endAtLoopEnd };
}

describe('Create Seamless Loop', () => {
  it("asks for the region's loop as it is placed, with the default search at its rate", () => {
    const world = workflowWorld(sampleProject());
    const needs = CREATE_SEAMLESS_LOOP.analysesFor(
      world.state,
      [world.members.walk, world.members.footstep],
      chose('none', { rank: 1 }),
    );
    expect(needs).toEqual([
      {
        kind: 'loop',
        target: world.members.walk,
        request: {
          loop: { start: 2_400, end: 21_600, crossfadeLength: 480, crossfadeShape: 'equal-power' },
          search: { radiusFrames: 960, keepLength: false, candidates: 5 },
        },
      },
    ]);
  });

  it('changes no loop the person chose nothing for', () => {
    const world = workflowWorld(sampleProject());
    const result = plan(world.state, [world.members.walk], chose('none', { rank: 1 }), CANDIDATES);
    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'skipped', target: world.members.walk }),
    ]);
    expect(result.invocations).toEqual([]);
  });

  it('reaches the state an expert reaches setting the chosen loop by hand, undone in one step', () => {
    const world = workflowWorld(sampleProject());
    const options = chose(memberKey(world.members.walk), { rank: 2 }, true);
    const result = plan(world.state, [world.members.walk], options, CANDIDATES);
    expect(plan(world.state, [world.members.walk], options, CANDIDATES)).toEqual(result);
    const bus = workflowBus();
    const [first, ...rest] = result.invocations;
    if (first === undefined) throw new Error('The plan sets the loop.');
    const step = bus.executeGroup(world.state, result.description, [first, ...rest]);
    if (step.kind !== 'applied' || step.entry === undefined) throw new Error('Not applied.');

    // By hand: candidate 2's points, its suggested crossfade, and the region ended there.
    const byHand = applied(bus, world.state, [
      setRegionInvocation({
        ...world.regions.walk,
        end: derivedSampleCount(21_650),
        loop: {
          basis: 0,
          start: derivedSampleCount(2_350),
          end: derivedSampleCount(21_650),
          crossfadeLength: derivedSampleCount(240),
          crossfadeShape: FadeShape.Linear,
        },
      }),
    ]);
    expect(stateText(step.next)).toBe(stateText(byHand));
    expect(stateText(applied(bus, step.next, step.entry.inverse))).toBe(stateText(world.state));
  });

  it('plans nothing again once the region loops at the points chosen', () => {
    const world = workflowWorld(sampleProject());
    const options = chose(memberKey(world.members.walk), {
      rank: 2,
      crossfade: { lengthFrames: 120, shape: FadeShape.SCurve },
    });
    const after = applied(
      workflowBus(),
      world.state,
      plan(world.state, [world.members.walk], options, CANDIDATES).invocations,
    );
    const again = plan(after, [world.members.walk], options, CANDIDATES);
    expect(again.items.map((item) => item.kind)).toEqual(['skipped']);
  });

  it('refuses an analysis of the region as it was, a candidate it does not hold, and an asset', () => {
    const world = workflowWorld(sampleProject());
    const key = memberKey(world.members.walk);
    const stale = plan(world.state, [world.members.walk], chose(key, { rank: 1 }), CANDIDATES, {
      ...chose(key, { rank: 1 }),
      search: { radiusFrames: 100, keepLength: true, candidates: 3 },
    });
    const unknown = plan(world.state, [world.members.walk], chose(key, { rank: 9 }), CANDIDATES);
    const asset = plan(
      world.state,
      [world.members.footstep],
      chose(memberKey(world.members.footstep), { rank: 1 }),
      CANDIDATES,
    );
    const codes = [stale, unknown, asset].map((one) =>
      one.items.map((item) => (item.kind === 'refused' ? item.failures[0].code : item.kind)),
    );
    expect(codes).toEqual([
      ['workflow.analysis-stale'],
      ['workflow.candidate-unknown'],
      ['workflow.loop-needs-region'],
    ]);
  });

  it("refuses a crossfade longer than the audio before the loop, as the region's command does", () => {
    const world = workflowWorld(sampleProject());
    const early = [candidate(1, 100, 21_600)];
    const result = plan(
      world.state,
      [world.members.walk],
      chose(memberKey(world.members.walk), { rank: 1 }),
      early,
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        kind: 'refused',
        failures: [expect.objectContaining({ code: 'editing.loop-crossfade-without-lead' })],
      }),
    );
  });
});
