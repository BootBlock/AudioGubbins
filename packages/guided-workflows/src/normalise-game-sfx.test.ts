import {
  copyChain,
  createDeterministicIdGenerator,
  treatmentChain,
  type IdGenerator,
  type TreatmentStep,
} from '@audiogubbins/domain';
import type { LoudnessTarget } from '@audiogubbins/game-audio';
import { BUILT_IN_LIBRARY, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  addSlotInvocation,
  setGroupPolicyInvocation,
  setRackInvocation,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import type { WorkflowTarget } from './guided-workflow.js';
import { NORMALISE_GAME_SFX, type NormaliseGameSfxOptions } from './normalise-game-sfx.js';
import { applied, stateText, workflowBus, workflowWorld } from './testing/index.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };
const SEED = 31;

function plan(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: NormaliseGameSfxOptions = { loudness: undefined, placement: 'group' },
) {
  const result = NORMALISE_GAME_SFX.plan({
    state,
    targets,
    options,
    analyses: undefined,
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(SEED),
    clock: CLOCK,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

function level(target: number, ceiling: number): TreatmentStep {
  return {
    typeKey: 'loudness-normalisation',
    values: { target, 'limit-true-peak': true, ceiling },
  };
}

function made(step: TreatmentStep, ids: IdGenerator) {
  const chain = treatmentChain([step], [undefined], PROCESSOR_CATALOGUE, ids);
  const [processor] = chain.ok ? chain.value.slots : [];
  if (processor?.kind !== 'processor') throw new Error('The level is made.');
  return processor;
}

/** The built-in entry for game SFX at −16 LUFS. */
function gameSfxChain() {
  const content = BUILT_IN_LIBRARY[0]?.content;
  if (content?.kind !== 'chain') throw new Error('The library lists its game SFX chain first.');
  return content.chain;
}

/** The last processor of the chain `id` names in `state`, by type and its target. */
function ending(state: ProjectState, id: string | undefined) {
  const chain = [...state.project.effectChains.values()].find((one) => one.id === id);
  const last = chain?.slots.at(-1);
  if (last?.kind !== 'processor') return undefined;
  const target = PROCESSOR_CATALOGUE.get(last.typeKey)?.parameters.find(
    (one) => one.key === 'target',
  );
  return {
    typeKey: last.typeKey,
    target: target === undefined ? undefined : last.values.get(target.id),
    slots: chain?.slots.length,
  };
}

describe('Normalise Game SFX', () => {
  it("reaches the state an expert reaches normalising each group's chain and own rack by hand", () => {
    const world = workflowWorld(sampleProject());
    const targets: WorkflowTarget[] = [
      { kind: 'group', group: world.groups.sfx.id, subgroups: true },
    ];
    const result = plan(world.state, targets);
    expect(result.items.map((item) => [item.kind, item.target])).toEqual([
      ['planned', world.groups.sfx.id],
      ['planned', world.groups.footsteps.id],
      ['planned', world.members.walk],
    ]);
    expect(result.measureAfter).toEqual([
      world.members.door,
      world.members.footstep,
      world.members.walk,
    ]);
    const bus = workflowBus();
    const after = applied(bus, world.state, result.invocations);

    // By hand: SFX, which inherits no chain, takes a copy of the built-in game
    // SFX chain, which already normalises to its −16 LUFS; Footsteps' own chain
    // gains the normalisation at its end; the walk loop, which owns its
    // processing, gains a rack of it.
    const ids = createDeterministicIdGenerator(SEED);
    made(level(-16, -1), ids);
    const sfxChain = ids.next<'EffectChainId'>();
    const copied = copyChain(gameSfxChain(), ids);
    const footstepsLevel = made(level(-16, -1), ids);
    const walkLevel = made(level(-16, -1), ids);
    const walkRack = ids.next<'EffectChainId'>();
    const byHand = applied(bus, world.state, [
      setGroupPolicyInvocation(world.groups.sfx.id, 'processing', sfxChain, {
        id: sfxChain,
        slots: copied.slots,
      }),
      addSlotInvocation(world.chain.id, { index: 1 }, footstepsLevel),
      setRackInvocation(
        { kind: 'region', region: world.regions.walk, asset: world.assets.footstep },
        { id: walkRack, slots: [walkLevel] },
      ),
    ]);
    expect(stateText(after)).toBe(stateText(byHand));
    expect(after.project.regions.get(world.regions.door.id)?.rack).toBe(sfxChain);
  });

  it('is undone whole by one step, plans the same again, and nothing once done', () => {
    const world = workflowWorld(sampleProject());
    const targets: WorkflowTarget[] = [
      { kind: 'group', group: world.groups.sfx.id, subgroups: true },
    ];
    const result = plan(world.state, targets);
    expect(plan(world.state, targets)).toEqual(result);
    const bus = workflowBus();
    const [first, ...rest] = result.invocations;
    if (first === undefined) throw new Error('The plan changes something.');
    const step = bus.executeGroup(world.state, result.description, [first, ...rest]);
    if (step.kind !== 'applied' || step.entry === undefined) throw new Error('Not applied.');
    expect(stateText(applied(bus, step.next, step.entry.inverse))).toBe(stateText(world.state));
    expect(plan(step.next, targets).items.map((item) => item.kind)).toEqual([
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it("sets a group's target where asked, and sets its normalisation anew when the target moves", () => {
    const world = workflowWorld(sampleProject());
    const targets: WorkflowTarget[] = [
      { kind: 'group', group: world.groups.footsteps.id, subgroups: false },
    ];
    const at = (integratedLufs: number): NormaliseGameSfxOptions => {
      const loudness: LoudnessTarget = { integratedLufs, toleranceLu: 1, truePeakCeilingDbtp: -1 };
      return { loudness, placement: 'group' };
    };
    const bus = workflowBus();
    const first = applied(bus, world.state, plan(world.state, targets, at(-18)).invocations);
    expect(
      first.gameAudio?.groups.get(world.groups.footsteps.id)?.policy.loudness?.integratedLufs,
    ).toBe(-18);
    expect(ending(first, world.chain.id)).toEqual({
      typeKey: 'loudness-normalisation',
      target: -18,
      slots: 2,
    });
    const second = applied(bus, first, plan(first, targets, at(-20)).invocations);
    expect(ending(second, world.chain.id)).toEqual({
      typeKey: 'loudness-normalisation',
      target: -20,
      slots: 2,
    });
  });

  it("normalises a member target through its group's chain, or its own rack where chosen", () => {
    const world = workflowWorld(sampleProject());
    const viaGroup = plan(world.state, [world.members.footstep]);
    expect(viaGroup.items.map((item) => [item.kind, item.target])).toEqual([
      ['planned', world.groups.footsteps.id],
      ['skipped', world.members.footstep],
    ]);
    const own = plan(world.state, [world.members.footstep], {
      loudness: undefined,
      placement: 'member',
    });
    const after = applied(workflowBus(), world.state, own.invocations);
    const rack = after.project.assets.get(world.assets.footstep.id)?.rack;
    expect(rack).not.toBe(world.chain.id);
    expect(ending(after, rack)).toEqual({
      typeKey: 'loudness-normalisation',
      target: -16,
      slots: 2,
    });
    expect(after.project.effectChains.get(world.chain.id)?.slots).toHaveLength(1);
  });

  it('refuses a member in no group, which has no target, and leaves it unmeasured', () => {
    const world = workflowWorld(sampleProject());
    const result = plan(world.state, [world.members.ambience, world.members.door]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        kind: 'refused',
        failures: [expect.objectContaining({ code: 'workflow.member-in-no-group' })],
      }),
    );
    expect(result.measureAfter).toEqual([world.members.door]);
  });
});
