import {
  createDeterministicIdGenerator,
  derivedSampleCount,
  type Region,
} from '@audiogubbins/domain';
import { memberKey } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { addRegionInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import type { AssistantAnalyses } from './assistant-analyses.js';
import { CUT_INTO_SOUNDS, type CutIntoSoundsOptions } from './cut-into-sounds.js';
import type { AnalysisNeed, WorkflowTarget } from './guided-workflow.js';
import {
  applied,
  frames,
  silenceReport,
  stateText,
  wholeAnalysis,
  workflowBus,
  workflowWorld,
} from './testing/index.js';
import { workflowDispatch } from './workflow-plan.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };
const SEED = 4_242;

/** The silence of the ambience: quiet but for 1–2 s and 4–6 s. */
const REMOVALS = [frames(0, 48_000), frames(96_000, 192_000), frames(288_000, 480_000)];

function setUp() {
  const world = workflowWorld(sampleProject());
  const targets: WorkflowTarget[] = [world.members.ambience];
  const defaults = CUT_INTO_SOUNDS.defaults(world.state, targets);
  const options: CutIntoSoundsOptions = {
    group: world.groups.sfx.id,
    naming: defaults.naming.value,
    threshold: undefined,
    shortestPause: undefined,
    leadInMilliseconds: 10,
    tailMilliseconds: 50,
  };
  return { world, targets, options };
}

/** The answers to `needs`, the silence at `REMOVALS` for each. */
function answered(needs: readonly AnalysisNeed[], length: number): AssistantAnalyses {
  return new Map(
    needs.flatMap((need) =>
      need.kind === 'assistants'
        ? [
            [
              memberKey(need.target),
              wholeAnalysis(length, need.assistants, need.detectors, [silenceReport(REMOVALS)]),
            ] as const,
          ]
        : [],
    ),
  );
}

function planned(options: CutIntoSoundsOptions) {
  const { world, targets } = setUp();
  const needs = CUT_INTO_SOUNDS.analysesFor(world.state, targets, options);
  const result = CUT_INTO_SOUNDS.plan({
    state: world.state,
    targets,
    options,
    analyses: answered(needs, world.assets.ambience.length),
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(SEED),
    clock: CLOCK,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return { world, plan: result.value, needs };
}

describe('Cut Into Sounds', () => {
  it("asks the silence detector to take each pause out whole, so the lead-in and tail are the workflow's", () => {
    const { needs } = planned(setUp().options);
    expect(needs).toEqual([
      expect.objectContaining({
        kind: 'assistants',
        assistants: ['silence'],
        detectors: { silence: { 'pause-kept': 0 } },
      }),
    ]);
  });

  it('offers the group the targets share and its naming, and its own naming otherwise', () => {
    const { world } = setUp();
    const shared = CUT_INTO_SOUNDS.defaults(world.state, [world.members.door]);
    expect(shared.group).toEqual({ value: world.groups.sfx.id, source: { kind: 'targets' } });
    expect(shared.naming.value.source).toBe('{asset:snake}_{number:2}');
    expect(shared.naming.source).toEqual({ kind: 'workflow' });
    const none = CUT_INTO_SOUNDS.defaults(world.state, [world.members.ambience]);
    expect(none.group.value).toBeUndefined();
  });

  it('reaches the state an expert reaches adding, naming and grouping each region by hand', () => {
    const { world, plan } = planned(setUp().options);
    expect(plan.items.map((item) => item.kind)).toEqual(['planned']);
    const bus = workflowBus();
    const after = applied(bus, world.state, plan.invocations);

    // By hand: each sound widened by 10 ms before and 50 ms after, numbered
    // after the door, the group's one member, and joined to SFX.
    const ids = createDeterministicIdGenerator(SEED);
    const region = (start: number, end: number, name: string): Region => ({
      id: ids.next<'RegionId'>(),
      assetId: world.assets.ambience.id,
      displayName: name,
      basis: 0,
      start: derivedSampleCount(start),
      end: derivedSampleCount(end),
      tags: [],
      operations: [],
    });
    const first = region(47_520, 98_400, 'forest_ambience_02');
    const second = region(191_520, 290_400, 'forest_ambience_03');
    const byHand = applied(bus, world.state, [
      addRegionInvocation(first),
      assignMemberInvocation({ kind: 'region', region: first.id }, world.groups.sfx.id, 'inherit'),
      addRegionInvocation(second),
      assignMemberInvocation({ kind: 'region', region: second.id }, world.groups.sfx.id, 'inherit'),
    ]);
    expect(stateText(after)).toBe(stateText(byHand));
  });

  it('is undone whole by its one history step', () => {
    const { world, plan } = planned(setUp().options);
    const dispatch = workflowDispatch(plan);
    if (dispatch.kind !== 'ready') throw new Error('The plan should be ready.');
    const bus = workflowBus();
    const result = bus.executeGroup(world.state, dispatch.description, dispatch.invocations);
    if (result.kind !== 'applied' || result.entry === undefined) throw new Error('Not applied.');
    expect(result.entry.description).toBe('Cut into sounds');
    const undone = applied(bus, result.next, result.entry.inverse);
    expect(stateText(undone)).toBe(stateText(world.state));
  });

  it('plans the same from the same input', () => {
    expect(planned(setUp().options).plan).toEqual(planned(setUp().options).plan);
  });

  it('cuts no sound a region already lies over, and nothing when every sound has one', () => {
    const exact = { ...setUp().options, leadInMilliseconds: 0, tailMilliseconds: 0 };
    const { world, plan } = planned(exact);
    // The door already lies over 1–2 s, so the 4–6 s sound alone is cut.
    expect(plan.items[0]).toEqual(
      expect.objectContaining({ kind: 'planned', changes: [expect.stringContaining('4.000 s')] }),
    );
    const after = applied(workflowBus(), world.state, plan.invocations);
    const again = CUT_INTO_SOUNDS.plan({
      state: after,
      targets: [world.members.ambience],
      options: exact,
      analyses: answered(
        CUT_INTO_SOUNDS.analysesFor(after, [world.members.ambience], exact),
        480_000,
      ),
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(SEED),
      clock: CLOCK,
    });
    expect(again.ok && again.value.items.map((item) => item.kind)).toEqual(['skipped']);
  });

  it('refuses a member analysed at other settings, which blocks the step', () => {
    const { world, targets, options } = setUp();
    const needs = CUT_INTO_SOUNDS.analysesFor(world.state, targets, {
      ...options,
      threshold: -50,
    });
    const result = CUT_INTO_SOUNDS.plan({
      state: world.state,
      targets,
      options,
      analyses: answered(needs, world.assets.ambience.length),
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(SEED),
      clock: CLOCK,
    });
    if (!result.ok) throw new Error('A plan is made.');
    expect(result.value.items[0]).toEqual(
      expect.objectContaining({
        kind: 'refused',
        failures: [expect.objectContaining({ code: 'workflow.analysis-stale' })],
      }),
    );
    expect(workflowDispatch(result.value)).toEqual({
      kind: 'blocked',
      refused: [world.members.ambience],
    });
  });

  it('makes no plan without a group to put the sounds in', () => {
    const { world, targets, options } = setUp();
    const result = CUT_INTO_SOUNDS.plan({
      state: world.state,
      targets,
      options: { ...options, group: undefined },
      analyses: new Map(),
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(SEED),
      clock: CLOCK,
    });
    expect(result.ok ? undefined : result.failures[0].code).toBe('workflow.group-not-chosen');
  });
});
