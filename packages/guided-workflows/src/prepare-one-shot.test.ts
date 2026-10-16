import {
  FadeShape,
  copyChain,
  createDeterministicIdGenerator,
  derivedSampleCount,
  treatmentChain,
  type EditRange,
  type TreatmentStep,
} from '@audiogubbins/domain';
import type { AssistantReport } from '@audiogubbins/detection-runtime';
import { memberKey, type GroupMember } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  applyInvocation,
  processTargetInvocation,
  setRackInvocation,
  setRegionInvocation,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import type { AssistantAnalyses } from './assistant-analyses.js';
import type { WorkflowTarget } from './guided-workflow.js';
import { PREPARE_ONE_SHOT, type PrepareOneShotOptions } from './prepare-one-shot.js';
import {
  applied,
  frames,
  restorationReport,
  silenceReport,
  stateText,
  wholeAnalysis,
  workflowBus,
  workflowWorld,
  type WorkflowWorld,
} from './testing/index.js';
import type { WorkflowItemTarget } from './workflow-plan.js';
import { memberSubject } from './workflow-subjects.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };
const SEED = 9_001;

interface Found {
  readonly silence: readonly EditRange[];
  readonly dcOffset: boolean;
  readonly quiet?: boolean;
}

function options(world: WorkflowWorld): PrepareOneShotOptions {
  const defaults = PREPARE_ONE_SHOT.defaults(world.state, []);
  return {
    threshold: defaults.threshold.value,
    leadInMilliseconds: defaults.leadInMilliseconds.value,
    tailMilliseconds: defaults.tailMilliseconds.value,
    fadeInMilliseconds: defaults.fadeInMilliseconds.value,
    fadeInShape: defaults.fadeInShape.value,
    fadeOutMilliseconds: defaults.fadeOutMilliseconds.value,
    fadeOutShape: defaults.fadeOutShape.value,
    peakDbtp: defaults.peakDbtp.value,
    placement: defaults.placement.value,
  };
}

/** The answers for each member of `found`, analysed whole as it is in `state`. */
function answered(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  chosen: PrepareOneShotOptions,
  found: ReadonlyMap<string, Found>,
): AssistantAnalyses {
  return new Map(
    PREPARE_ONE_SHOT.analysesFor(state, targets, chosen).flatMap((need) => {
      const what = found.get(memberKey(need.target));
      const subject = memberSubject(state, need.target);
      if (need.kind !== 'assistants' || what === undefined || !subject.ok) return [];
      const length = subject.value.span.end - subject.value.span.start;
      const reports: AssistantReport[] = [
        silenceReport(what.silence, what.quiet === true ? length : undefined),
        restorationReport({ dcOffset: what.dcOffset }),
      ];
      return [
        [
          memberKey(need.target),
          wholeAnalysis(length, need.assistants, need.detectors, reports),
        ] as const,
      ];
    }),
  );
}

function planOver(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  chosen: PrepareOneShotOptions,
  found: ReadonlyMap<string, Found>,
  leftOut: readonly WorkflowItemTarget[] = [],
) {
  const result = PREPARE_ONE_SHOT.plan({
    state,
    targets,
    options: chosen,
    analyses: answered(state, targets, chosen, found),
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(SEED),
    clock: CLOCK,
    leftOut,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

/** The footstep with 50 ms of silence at each end and an offset; the door with 100 ms and none. */
function sounds(world: WorkflowWorld): ReadonlyMap<string, Found> {
  return new Map<string, Found>([
    [
      memberKey(world.members.footstep),
      { silence: [frames(0, 2_400), frames(21_600, 24_000)], dcOffset: true },
    ],
    [
      memberKey(world.members.door),
      { silence: [frames(0, 4_800), frames(43_200, 48_000)], dcOffset: false },
    ],
  ]);
}

const LOUDNESS_AT_SFX: TreatmentStep = {
  typeKey: 'loudness-normalisation',
  values: { target: -16, 'limit-true-peak': true, ceiling: -1 },
};
const DC_REMOVAL: TreatmentStep = { typeKey: 'dc-offset-removal', values: {} };

function made(
  steps: readonly TreatmentStep[],
  ids: ReturnType<typeof createDeterministicIdGenerator>,
) {
  const chain = treatmentChain(
    steps,
    steps.map(() => undefined),
    PROCESSOR_CATALOGUE,
    ids,
  );
  if (!chain.ok) throw new Error(chain.failures[0].summary);
  return chain.value.slots;
}

describe('Prepare One-Shot', () => {
  it('reaches the state an expert reaches trimming, fading and normalising each by hand', () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.footstep, world.members.door];
    const plan = planOver(world.state, targets, options(world), sounds(world));
    expect(plan.items.map((item) => item.kind)).toEqual(['planned', 'planned']);
    const bus = workflowBus();
    const after = applied(bus, world.state, plan.invocations);

    const ids = createDeterministicIdGenerator(SEED);
    const { footstep, ambience } = world.assets;
    // The footstep asset: 2 ms of lead-in and 20 ms of tail kept, so 2,304
    // frames in to 22,560, then faded over them, its own rack a copy of the
    // Footsteps chain ending with the offset removed and −16 LUFS.
    const trim = {
      id: ids.next<'EditOperationId'>(),
      kind: 'trim',
      range: frames(2_304, 22_560),
    } as const;
    const fadeIn = ids.next<'EditOperationId'>();
    const fadeOut = ids.next<'EditOperationId'>();
    const [dc, level] = made([DC_REMOVAL, LOUDNESS_AT_SFX], ids);
    const rack = ids.next<'EffectChainId'>();
    const copied = copyChain(world.chain, ids);
    // The door region: 4,704 frames in to 44,160 of its own, which starts at 48,000.
    const doorIn = ids.next<'EditOperationId'>();
    const doorOut = ids.next<'EditOperationId'>();
    const [doorLevel] = made([LOUDNESS_AT_SFX], ids);
    const doorRack = ids.next<'EffectChainId'>();
    if (dc === undefined || level === undefined || doorLevel === undefined) {
      throw new Error('The treatments are made.');
    }
    const door = (start: number, end: number) => ({
      kind: 'region' as const,
      asset: ambience.id,
      region: world.regions.door.id,
      basis: 0,
      range: frames(start, end),
    });
    const byHand = applied(bus, world.state, [
      applyInvocation(footstep, trim),
      processTargetInvocation({ kind: 'asset', asset: footstep.id, range: frames(0, 96) }, fadeIn, {
        kind: 'fade',
        direction: 'in',
        shape: FadeShape.Linear,
      }),
      processTargetInvocation(
        { kind: 'asset', asset: footstep.id, range: frames(19_296, 20_256) },
        fadeOut,
        { kind: 'fade', direction: 'out', shape: FadeShape.EqualPower },
      ),
      setRackInvocation(
        { kind: 'asset', asset: footstep },
        { id: rack, slots: [...copied.slots, dc, level] },
        'own',
      ),
      setRegionInvocation({
        ...world.regions.door,
        start: derivedSampleCount(52_704),
        end: derivedSampleCount(92_160),
      }),
      processTargetInvocation(door(52_704, 52_800), doorIn, {
        kind: 'fade',
        direction: 'in',
        shape: FadeShape.Linear,
      }),
      processTargetInvocation(door(91_200, 92_160), doorOut, {
        kind: 'fade',
        direction: 'out',
        shape: FadeShape.EqualPower,
      }),
      setRackInvocation(
        { kind: 'region', region: world.regions.door, asset: ambience },
        { id: doorRack, slots: [doorLevel] },
        'own',
      ),
    ]);
    expect(stateText(after)).toBe(stateText(byHand));
  });

  it('is undone whole by its one history step, and plans the same from the same input', () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.footstep, world.members.door];
    const plan = planOver(world.state, targets, options(world), sounds(world));
    expect(planOver(world.state, targets, options(world), sounds(world))).toEqual(plan);
    const bus = workflowBus();
    const [first, ...rest] = plan.invocations;
    if (first === undefined) throw new Error('The plan changes something.');
    const result = bus.executeGroup(world.state, plan.description, [first, ...rest]);
    if (result.kind !== 'applied' || result.entry === undefined) throw new Error('Not applied.');
    expect(stateText(applied(bus, result.next, result.entry.inverse))).toBe(stateText(world.state));
  });

  it('plans nothing again once each member is prepared', () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.footstep, world.members.door];
    const chosen = options(world);
    const after = applied(
      workflowBus(),
      world.state,
      planOver(world.state, targets, chosen, sounds(world)).invocations,
    );
    // Analysed again, each holds no silence at its edges long enough to take out, and no offset.
    const prepared = new Map<string, Found>([
      [memberKey(world.members.footstep), { silence: [], dcOffset: false }],
      [memberKey(world.members.door), { silence: [], dcOffset: false }],
    ]);
    const again = planOver(after, targets, chosen, prepared);
    expect(again.items.map((item) => item.kind)).toEqual(['skipped', 'skipped']);
    expect(again.invocations).toEqual([]);
  });

  it("adds to the group's chain, for every member inheriting it, where the person chooses so", () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.footstep];
    const plan = planOver(
      world.state,
      targets,
      { ...options(world), placement: 'group' },
      sounds(world),
    );
    const after = applied(workflowBus(), world.state, plan.invocations);
    const chain = after.project.effectChains.get(world.chain.id);
    expect(
      chain?.slots.map((slot) => (slot.kind === 'processor' ? slot.typeKey : 'group')),
    ).toEqual(['filter', 'dc-offset-removal', 'loudness-normalisation']);
    expect(after.project.assets.get(world.assets.footstep.id)?.rack).toBe(world.chain.id);
    expect(
      after.gameAudio?.memberships.find(
        (one) => memberKey(one.member) === memberKey(world.members.footstep),
      )?.processing,
    ).toBe('inherit');
  });

  it('normalises a member with no loudness target to the stated peak', () => {
    const world = workflowWorld(sampleProject());
    const ambience: GroupMember = world.members.ambience;
    const found = new Map<string, Found>([
      [memberKey(ambience), { silence: [frames(0, 4_800)], dcOffset: false }],
    ]);
    const plan = planOver(world.state, [ambience], options(world), found);
    const after = applied(workflowBus(), world.state, plan.invocations);
    const rack = after.project.assets.get(world.assets.ambience.id)?.rack;
    const last =
      rack === undefined ? undefined : after.project.effectChains.get(rack)?.slots.at(-1);
    expect(last?.kind === 'processor' ? last.typeKey : undefined).toBe('peak-normalisation');
  });

  it('refuses a looping region and a quiet one, and skips what the person left out', () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.walk, world.members.door];
    const found = new Map<string, Found>([
      [memberKey(world.members.walk), { silence: [], dcOffset: false }],
      [memberKey(world.members.door), { silence: [], dcOffset: false, quiet: true }],
    ]);
    const plan = planOver(world.state, targets, options(world), found);
    expect(
      plan.items.map((item) => (item.kind === 'refused' ? item.failures[0].code : item.kind)),
    ).toEqual(['workflow.one-shot-loops', 'workflow.quiet-throughout']);
    const rest = planOver(world.state, targets, options(world), found, [world.members.walk]);
    expect(rest.items[0]).toEqual({
      kind: 'skipped',
      target: world.members.walk,
      reason: 'Left out of this run.',
    });
  });
});
