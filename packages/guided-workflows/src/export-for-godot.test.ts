import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import { destinationPath, type GameExportProfile } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  setGroupPolicyInvocation,
  setMemberOverrideInvocation,
} from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { describe, expect, it } from 'vitest';

import { EXPORT_FOR_GODOT, type ExportForGodotOptions } from './export-for-godot.js';
import type { WorkflowTarget } from './guided-workflow.js';
import { applied, stateText, workflowBus, workflowWorld } from './testing/index.js';
import { workflowDispatch, type WorkflowItemTarget } from './workflow-plan.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16), utcOffsetMinutes: 0 };

function options(
  state: ProjectState,
  format: ExportForGodotOptions['format'],
): ExportForGodotOptions {
  const defaults = EXPORT_FOR_GODOT.defaults(state, []);
  return {
    format,
    naming: defaults.naming.value,
    destinationRoot: defaults.destinationRoot.value,
  };
}

function plan(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  chosen: ExportForGodotOptions,
  leftOut: readonly WorkflowItemTarget[] = [],
) {
  const result = EXPORT_FOR_GODOT.plan({
    state,
    targets,
    options: chosen,
    analyses: undefined,
    catalogue: PROCESSOR_CATALOGUE,
    ids: createDeterministicIdGenerator(3),
    clock: CLOCK,
    leftOut,
  });
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

function folder(...segments: string[]) {
  const made = destinationPath(segments);
  if (!made.ok) throw new Error(made.failures[0].summary);
  return made.value;
}

describe('Export for Godot', () => {
  it('reaches the state an expert reaches setting each policy and the loop override by hand', () => {
    const world = workflowWorld(sampleProject());
    const targets: WorkflowTarget[] = [
      { kind: 'group', group: world.groups.sfx.id, subgroups: true },
    ];
    const chosen = options(world.state, 'ogg-vorbis');
    const result = plan(world.state, targets, chosen);
    expect(result.items.map((item) => [item.kind, item.target])).toEqual([
      ['planned', world.groups.sfx.id],
      ['planned', world.groups.footsteps.id],
      ['planned', world.members.walk],
    ]);
    expect(result.exportAfter).toEqual([
      world.members.door,
      world.members.footstep,
      world.members.walk,
    ]);
    const bus = workflowBus();
    const after = applied(bus, world.state, result.invocations);

    // By hand: Ogg Vorbis at the project's rate for both groups, named by
    // group and number, each in its own folder under audio/, and the walk
    // loop, the one looping member, exported as 16-bit WAV, which keeps it.
    const rate = world.state.project.settings.sampleRate;
    const ogg: GameExportProfile = { format: 'ogg-vorbis', choices: { sampleRate: rate } };
    const wav: GameExportProfile = {
      format: 'wav',
      choices: { encoding: { kind: 'integer', bits: 16 }, sampleRate: rate },
    };
    const byHand = applied(bus, world.state, [
      setGroupPolicyInvocation(world.groups.sfx.id, 'exportProfile', ogg),
      setGroupPolicyInvocation(world.groups.sfx.id, 'naming', chosen.naming),
      setGroupPolicyInvocation(world.groups.sfx.id, 'destination', folder('audio', 'sfx')),
      setGroupPolicyInvocation(world.groups.footsteps.id, 'exportProfile', ogg),
      setGroupPolicyInvocation(world.groups.footsteps.id, 'naming', chosen.naming),
      setGroupPolicyInvocation(
        world.groups.footsteps.id,
        'destination',
        folder('audio', 'sfx', 'footsteps'),
      ),
      setMemberOverrideInvocation(world.members.walk, 'exportProfile', wav),
    ]);
    expect(stateText(after)).toBe(stateText(byHand));
  });

  it('is undone whole by one step, plans the same again, and nothing once done', () => {
    const world = workflowWorld(sampleProject());
    const targets: WorkflowTarget[] = [
      { kind: 'group', group: world.groups.sfx.id, subgroups: true },
    ];
    const chosen = options(world.state, 'ogg-vorbis');
    const result = plan(world.state, targets, chosen);
    expect(plan(world.state, targets, chosen)).toEqual(result);
    const dispatch = workflowDispatch(result);
    if (dispatch.kind !== 'ready') throw new Error('The plan is ready.');
    const bus = workflowBus();
    const step = bus.executeGroup(world.state, dispatch.description, dispatch.invocations);
    if (step.kind !== 'applied' || step.entry === undefined) throw new Error('Not applied.');
    expect(stateText(applied(bus, step.next, step.entry.inverse))).toBe(stateText(world.state));
    // The walk loop now exports as WAV through its override, so it needs no item.
    const again = plan(step.next, targets, chosen);
    expect(again.items.map((item) => item.kind)).toEqual(['skipped', 'skipped']);
    expect(again.invocations).toEqual([]);
  });

  it('gives no override where the group exports WAV, which holds the loop already', () => {
    const world = workflowWorld(sampleProject());
    const result = plan(world.state, [world.members.walk], options(world.state, 'wav'));
    expect(result.items.map((item) => [item.kind, item.target])).toEqual([
      ['planned', world.groups.footsteps.id],
      ['skipped', world.members.walk],
    ]);
    expect(result.exportAfter).toEqual([world.members.walk]);
  });

  it('refuses a member in no group, blocking the step until the person leaves it out', () => {
    const world = workflowWorld(sampleProject());
    const targets = [world.members.ambience, world.members.door];
    const chosen = options(world.state, 'wav');
    const blocked = plan(world.state, targets, chosen);
    expect(blocked.items[0]).toEqual(
      expect.objectContaining({
        kind: 'refused',
        failures: [expect.objectContaining({ code: 'workflow.member-in-no-group' })],
      }),
    );
    expect(blocked.exportAfter).toEqual([world.members.door]);
    expect(workflowDispatch(blocked)).toEqual({
      kind: 'blocked',
      refused: [world.members.ambience],
    });
    const rest = plan(world.state, targets, chosen, [world.members.ambience]);
    expect(workflowDispatch(rest).kind).toBe('ready');
  });
});
