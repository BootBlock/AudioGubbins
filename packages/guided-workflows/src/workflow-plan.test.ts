import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { unassignMemberInvocation } from '@audiogubbins/project-commands';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import { EXPORT_FOR_GODOT } from './export-for-godot.js';
import { NORMALISE_GAME_SFX } from './normalise-game-sfx.js';
import { applied, stateText, workflowBus, workflowWorld } from './testing/index.js';
import { workflowDispatch } from './workflow-plan.js';
import { targetMembers } from './workflow-subjects.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };

describe('a workflow plan as one step', () => {
  it('leaves the project as it was where a command fails part of the way through', () => {
    const world = workflowWorld(sampleProject());
    const defaults = EXPORT_FOR_GODOT.defaults(world.state, []);
    const result = EXPORT_FOR_GODOT.plan({
      state: world.state,
      targets: [{ kind: 'group', group: world.groups.footsteps.id, subgroups: false }],
      options: {
        format: 'ogg-vorbis',
        naming: defaults.naming.value,
        destinationRoot: defaults.destinationRoot.value,
      },
      analyses: undefined,
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(1),
      clock: CLOCK,
    });
    if (!result.ok) throw new Error('A plan is made.');
    const dispatch = workflowDispatch(result.value);
    if (dispatch.kind !== 'ready') throw new Error('The plan is ready.');
    // The walk loop leaves its group after the plan is made, so its override,
    // the last of the step's changes, is refused after the group's are made.
    const bus = workflowBus();
    const moved = applied(bus, world.state, [unassignMemberInvocation(world.members.walk)]);
    const before = stateText(moved);
    const step = bus.executeGroup(moved, dispatch.description, dispatch.invocations);
    expect(step.kind).toBe('refused');
    expect(stateText(moved)).toBe(before);
  });

  it('has nothing to run where every item is skipped', () => {
    const world = workflowWorld(sampleProject());
    const result = NORMALISE_GAME_SFX.plan({
      state: world.state,
      targets: [world.members.door],
      options: { loudness: undefined, placement: 'group' },
      analyses: undefined,
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(1),
      clock: CLOCK,
      leftOut: [world.groups.sfx.id, world.members.door],
    });
    expect(result.ok && workflowDispatch(result.value)).toEqual({ kind: 'nothing' });
  });

  it('makes no plan over a group the project no longer holds', () => {
    const world = workflowWorld(sampleProject());
    const gone = createDeterministicIdGenerator(99).next<'GameAssetGroupId'>();
    const result = NORMALISE_GAME_SFX.plan({
      state: world.state,
      targets: [{ kind: 'group', group: gone, subgroups: false }],
      options: { loudness: undefined, placement: 'group' },
      analyses: undefined,
      catalogue: PROCESSOR_CATALOGUE,
      ids: createDeterministicIdGenerator(1),
      clock: CLOCK,
    });
    expect(result.ok ? undefined : result.failures[0].code).toBe('workflow.group-unknown');
  });
});

describe('targetMembers', () => {
  it("lists a group's members in membership order, then its subgroups', each member once", () => {
    const world = workflowWorld(sampleProject());
    const game = world.state.gameAudio;
    if (game === undefined) throw new Error('The world has groups.');
    expect(
      targetMembers(game, [
        world.members.walk,
        { kind: 'group', group: world.groups.sfx.id, subgroups: true },
      ]),
    ).toEqual([world.members.walk, world.members.door, world.members.footstep]);
    expect(
      targetMembers(game, [{ kind: 'group', group: world.groups.sfx.id, subgroups: false }]),
    ).toEqual([world.members.door]);
  });
});
