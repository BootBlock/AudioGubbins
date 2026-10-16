import {
  copyChain,
  createDeterministicIdGenerator,
  treatmentChain,
  type ProcessorState,
  type TreatmentStep,
} from '@audiogubbins/domain';
import { memberKey, type GroupMember } from '@audiogubbins/game-audio';
import { BUILT_IN_LIBRARY, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { setRackInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import { CLEAN_DIALOGUE, type CleanDialogueAnalyses } from './clean-dialogue.js';
import type { Placement } from './processing-placement.js';
import {
  applied,
  frames,
  repairReport,
  restorationReport,
  stateText,
  wholeAnalysis,
  workflowBus,
  workflowWorld,
} from './testing/index.js';
import { memberSubject } from './workflow-subjects.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };
const SEED = 77;
const NOISE_STRETCH = frames(0, 4_800);
const PROFILE: ProcessorState = { kind: 'noise-profile', values: [0.5, 0.25] };

function analysed(
  state: ProjectState,
  member: GroupMember,
  model: CleanDialogueAnalyses['denoisingModel'],
): CleanDialogueAnalyses {
  const [need] = CLEAN_DIALOGUE.analysesFor(state, [member], { placement: 'member' });
  const subject = memberSubject(state, member);
  if (need?.kind !== 'assistants' || !subject.ok) throw new Error('One analysis is asked for.');
  const length = subject.value.span.end - subject.value.span.start;
  const reports = [
    restorationReport({ dcOffset: true, noise: { stretch: NOISE_STRETCH, state: PROFILE } }),
    repairReport(true),
  ];
  return {
    assistants: new Map([
      [memberKey(member), wholeAnalysis(length, need.assistants, need.detectors, reports)],
    ]),
    denoisingModel: model,
  };
}

function plan(
  state: ProjectState,
  member: GroupMember,
  model: CleanDialogueAnalyses['denoisingModel'],
  placement: Placement = 'member',
) {
  const result = CLEAN_DIALOGUE.plan({
    state,
    targets: [member],
    options: { placement },
    analyses: analysed(state, member, model),
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(SEED),
    clock: CLOCK,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

/** The built-in Dialogue chain. */
function dialogueChain() {
  const content = BUILT_IN_LIBRARY.find((entry) => entry.name.startsWith('Dialogue'))?.content;
  if (content?.kind !== 'chain') throw new Error('The library has its Dialogue chain.');
  return content.chain;
}

function typesOf(state: ProjectState, chain: string | undefined): readonly string[] {
  const found = [...state.project.effectChains.values()].find((one) => one.id === chain);
  return (found?.slots ?? []).map((slot) => (slot.kind === 'processor' ? slot.typeKey : 'group'));
}

/** The steps recommended: the offset, then clicks, then the noise by the local model. */
const RECOMMENDED: readonly TreatmentStep[] = [
  { typeKey: 'dc-offset-removal', values: {} },
  { typeKey: 'de-click', values: {} },
  { typeKey: 'deepfilternet-3', values: {} },
];

describe('Clean Dialogue', () => {
  it('reaches the state an expert reaches applying each recommendation and the Dialogue chain by hand', () => {
    const world = workflowWorld(sampleProject());
    const member = world.members.ambience;
    const result = plan(world.state, member, 'installed');
    const bus = workflowBus();
    const after = applied(bus, world.state, result.invocations);

    // By hand: the offset, then clicks, then the noise by the local model,
    // then the Dialogue chain whole, at its own −23 LUFS as nothing sets one.
    const ids = createDeterministicIdGenerator(SEED);
    const recommended = treatmentChain(
      RECOMMENDED,
      [undefined, undefined, undefined],
      PROCESSOR_CATALOGUE,
      ids,
    );
    if (!recommended.ok) throw new Error(recommended.failures[0].summary);
    const dialogue = copyChain(dialogueChain(), ids);
    const rack = ids.next<'EffectChainId'>();
    const byHand = applied(bus, world.state, [
      setRackInvocation(
        { kind: 'asset', asset: world.assets.ambience },
        { id: rack, slots: [...recommended.value.slots, ...dialogue.slots] },
      ),
    ]);
    expect(stateText(after)).toBe(stateText(byHand));
    expect(typesOf(after, rack)).toEqual([
      'dc-offset-removal',
      'de-click',
      'deepfilternet-3',
      'filter',
      'de-esser',
      'compressor',
      'loudness-normalisation',
    ]);
  });

  it('takes the noise with the reduction learned from the noise floor where the model is absent', () => {
    const world = workflowWorld(sampleProject());
    const result = plan(world.state, world.members.ambience, 'absent');
    const after = applied(workflowBus(), world.state, result.invocations);
    const rack = after.project.assets.get(world.assets.ambience.id)?.rack;
    const chain = rack === undefined ? undefined : after.project.effectChains.get(rack);
    const reduction = chain?.slots.find(
      (slot) => slot.kind === 'processor' && slot.typeKey === 'noise-reduction',
    );
    expect(reduction?.kind === 'processor' ? reduction.state : undefined).toEqual(PROFILE);
  });

  it('is undone whole by one step, plans the same again, and nothing once done', () => {
    const world = workflowWorld(sampleProject());
    const member = world.members.ambience;
    const result = plan(world.state, member, 'installed');
    expect(plan(world.state, member, 'installed')).toEqual(result);
    const bus = workflowBus();
    const [first, ...rest] = result.invocations;
    if (first === undefined) throw new Error('The plan changes something.');
    const step = bus.executeGroup(world.state, result.description, [first, ...rest]);
    if (step.kind !== 'applied' || step.entry === undefined) throw new Error('Not applied.');
    expect(stateText(applied(bus, step.next, step.entry.inverse))).toBe(stateText(world.state));
    expect(plan(step.next, member, 'installed').items.map((item) => item.kind)).toEqual([
      'skipped',
    ]);
  });

  it("normalises to the member's effective target, in its group's chain where the person chooses", () => {
    const world = workflowWorld(sampleProject());
    const result = plan(world.state, world.members.footstep, 'installed', 'group');
    const after = applied(workflowBus(), world.state, result.invocations);
    expect(typesOf(after, world.chain.id).at(-1)).toBe('loudness-normalisation');
    expect(after.project.assets.get(world.assets.footstep.id)?.rack).toBe(world.chain.id);
  });
});
