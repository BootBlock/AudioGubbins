import { describe, expect, it } from 'vitest';

import type { CommandInvocation, ExecutionResult } from '@audiogubbins/commands';
import type { EffectChainId, Project } from '@audiogubbins/domain';
import type { GameAssetGroup, GroupMember } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from '../project-command.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from '../testing/bus-runs.js';
import { filterChain, groupedState } from '../testing/grouped-state.js';
import { referenceState } from '../testing/reference-state.js';
import {
  addGroupInvocation,
  moveGroupInvocation,
  removeGroupInvocation,
  renameGroupInvocation,
  setGroupPolicyInvocation,
  unassignMemberInvocation,
} from './game-invocations.js';

const bus = projectBus();
const fixture = sampleProject();
const reference = referenceState(fixture);
const ids = fixture.ids;
const { state, groups, chains, members } = groupedState(
  reference.state,
  reference.assets,
  fixture.regions.loop,
  ids,
);
const { footsteps, gravel, ambience } = groups;

/** The rack `member` has in `project`. */
function rackOf(project: Project, member: GroupMember): EffectChainId | undefined {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.rack
    : project.assets.get(member.asset)?.rack;
}

/** Runs `invocation`, checks it applied and reads back, and that its inverse undoes it exactly. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(from, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse) {
    undone = appliedOf(bus.execute(undone, inverse)).next;
    assertReadsBack(undone);
  }
  expect(undone).toEqual(from);
  return { next, entry: entryOf(result) };
}

function after(from: ProjectState, ...invocations: readonly CommandInvocation[]): ProjectState {
  let next = from;
  for (const invocation of invocations) next = appliedOf(bus.execute(next, invocation)).next;
  return next;
}

/** Every reason a refusal gives. */
function reasonsOf(result: ExecutionResult<ProjectState>): string {
  if (result.kind !== 'refused') throw new Error(`Expected a refusal; it was ${result.kind}.`);
  return result.failures.map((failure) => failure.summary).join(' ');
}

function group(name: string, more: Partial<GameAssetGroup> = {}): GameAssetGroup {
  return { id: ids.next<'GameAssetGroupId'>(), name, policy: {}, ...more };
}

describe('game.add-group', () => {
  it('adds a group with its new chain, both undone in one step', () => {
    const chain = filterChain(ids);
    const doors = group('Doors', { policy: { processing: chain.id } });
    const { next, entry } = appliedAndUndone(state, addGroupInvocation(doors, chain));
    expect(next.gameAudio?.groups.get(doors.id)).toEqual(doors);
    expect(next.project.effectChains.get(chain.id)).toEqual(chain);
    expect(entry.description).toBe('Add group “Doors”');
  });

  it('refuses a name a sibling holds, naming the sibling by its path', () => {
    const result = bus.execute(
      state,
      addGroupInvocation(group('gravel', { parent: footsteps.id })),
    );
    expect(refusalCodeOf(result)).toBe('game.group-name-taken');
    expect(reasonsOf(result)).toContain('the group “Footsteps/Gravel” beside it');
  });

  it('refuses a policy value that does not read, naming the new group by its path and the field', () => {
    const added = addGroupInvocation(group('Steps', { parent: footsteps.id }));
    const written = JSON.parse(String(added.arguments?.['group'])) as Record<string, unknown>;
    const result = bus.execute(state, {
      ...added,
      arguments: {
        ...added.arguments,
        group: JSON.stringify({ ...written, policy: { naming: '{region' } }),
      },
    });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.failures.map((failure) => failure.summary)).toContainEqual(
      expect.stringMatching(/^The new group “Footsteps\/Steps” sets its naming template with what/),
    );
  });

  it('refuses a parent the project lacks, an identifier it holds and a chain nothing gives', () => {
    expect(
      refusalCodeOf(bus.execute(state, addGroupInvocation(group('Lost', { parent: ids.next() })))),
    ).toBe('game.group-parent-unknown');
    expect(refusalCodeOf(bus.execute(state, addGroupInvocation({ ...ambience })))).toBe(
      'game.group-duplicate-id',
    );
    const absent = group('Doors', { policy: { processing: chains.b.id } });
    expect(refusalCodeOf(bus.execute(state, addGroupInvocation(absent)))).toBe(
      'game.policy-chain-unknown',
    );
  });
});

describe('game.remove-group', () => {
  it('refuses a group that still holds a group or a member, naming it by its path', () => {
    const children = bus.execute(state, removeGroupInvocation(footsteps.id));
    expect(refusalCodeOf(children)).toBe('game.group-has-children');
    expect(reasonsOf(children)).toContain('group “Footsteps” still holds 1 group');
    const held = bus.execute(state, removeGroupInvocation(gravel.id));
    expect(refusalCodeOf(held)).toBe('game.group-has-members');
    expect(reasonsOf(held)).toContain('group “Footsteps/Gravel” still has 1 member');
  });

  it('removes an empty group with the chain only it named, and undo gives both back', () => {
    const chain = filterChain(ids);
    const doors = group('Doors', { policy: { processing: chain.id } });
    const added = after(state, addGroupInvocation(doors, chain));
    const { next, entry } = appliedAndUndone(added, removeGroupInvocation(doors.id));
    expect(next.gameAudio?.groups.has(doors.id)).toBe(false);
    expect(next.project.effectChains.has(chain.id)).toBe(false);
    expect(entry.inverse).toEqual([addGroupInvocation(doors, chain)]);
  });

  it('leaves no game-audio state once the last group goes', () => {
    const emptied = after(
      reference.state,
      addGroupInvocation(ambience),
      removeGroupInvocation(ambience.id),
    );
    expect(emptied).toEqual(reference.state);
  });
});

describe('game.rename-group', () => {
  it('renames, undone to the old name', () => {
    const { next, entry } = appliedAndUndone(state, renameGroupInvocation(gravel.id, 'Stone'));
    expect(next.gameAudio?.groups.get(gravel.id)?.name).toBe('Stone');
    expect(entry.description).toBe('Rename group “Footsteps/Gravel” to “Stone”');
  });

  it('refuses a name no group may hold and one a sibling holds, and changes nothing for its own', () => {
    expect(refusalCodeOf(bus.execute(state, renameGroupInvocation(gravel.id, 'A/B')))).toBe(
      'game.group-name-invalid',
    );
    expect(refusalCodeOf(bus.execute(state, renameGroupInvocation(ambience.id, 'FOOTSTEPS')))).toBe(
      'game.group-name-taken',
    );
    expect(unchangedCodeOf(bus.execute(state, renameGroupInvocation(gravel.id, 'Gravel')))).toBe(
      'game.group-name-unchanged',
    );
  });
});

describe('game.move-group', () => {
  it('re-points every inheriting member’s rack in the same step, and undo puts it back', () => {
    expect(rackOf(state.project, members.loop)).toBe(chains.a.id);
    const top = appliedAndUndone(state, moveGroupInvocation(gravel.id, undefined));
    // At the top level nothing sets Gravel's processing, so its inheritor has no rack.
    expect(rackOf(top.next.project, members.loop)).toBeUndefined();
    expect(top.entry.description).toBe('Move group “Footsteps/Gravel” to the top level');

    const quiet = appliedAndUndone(state, moveGroupInvocation(gravel.id, ambience.id));
    expect(rackOf(quiet.next.project, members.loop)).toBeUndefined();
    expect(quiet.next.project.effectChains.has(chains.a.id)).toBe(true);
  });

  it('refuses a group moved inside itself, naming it', () => {
    const result = bus.execute(state, moveGroupInvocation(footsteps.id, gravel.id));
    expect(refusalCodeOf(result)).toBe('game.group-cycle');
    expect(reasonsOf(result)).toContain('inside itself');
    expect(unchangedCodeOf(bus.execute(state, moveGroupInvocation(gravel.id, footsteps.id)))).toBe(
      'game.group-not-moved',
    );
  });
});

describe('game.set-group-policy', () => {
  it('takes every inheritor from one chain to none to another, the own member left alone', () => {
    const own = rackOf(state.project, members.rain);
    const none = appliedAndUndone(
      state,
      setGroupPolicyInvocation(footsteps.id, 'processing', 'none'),
    );
    expect(rackOf(none.next.project, members.footstep)).toBeUndefined();
    expect(rackOf(none.next.project, members.loop)).toBeUndefined();
    // Nothing names chain A any more, so it leaves, and the inverse gives it back whole.
    expect(none.next.project.effectChains.has(chains.a.id)).toBe(false);
    expect(none.entry.inverse).toEqual([
      setGroupPolicyInvocation(footsteps.id, 'processing', chains.a.id, chains.a),
    ]);
    expect(none.entry.description).toBe('Set the processing of group “Footsteps”');

    const b = appliedAndUndone(
      none.next,
      setGroupPolicyInvocation(footsteps.id, 'processing', chains.b.id, chains.b),
    );
    expect(rackOf(b.next.project, members.footstep)).toBe(chains.b.id);
    expect(rackOf(b.next.project, members.loop)).toBe(chains.b.id);
    expect(rackOf(b.next.project, members.rain)).toBe(own);
  });

  it('keeps a chain a group names after the last member that names it leaves', () => {
    const left = after(
      state,
      unassignMemberInvocation(members.footstep, 'none'),
      unassignMemberInvocation(members.loop, 'none'),
    );
    expect(left.project.effectChains.has(chains.a.id)).toBe(true);
    assertReadsBack(left);
  });

  it('resets a field to inherited, and refuses a value out of range naming the group', () => {
    const target = { integratedLufs: -16, toleranceLu: 1 };
    const set = appliedAndUndone(state, setGroupPolicyInvocation(gravel.id, 'loudness', target));
    expect(set.next.gameAudio?.groups.get(gravel.id)?.policy.loudness).toEqual(target);
    const reset = appliedAndUndone(
      set.next,
      setGroupPolicyInvocation(gravel.id, 'loudness', undefined),
    );
    expect(reset.next.gameAudio?.groups.get(gravel.id)?.policy).toEqual({});
    expect(reset.entry.description).toBe(
      'Reset the loudness target of group “Footsteps/Gravel” to inherited',
    );

    const loud = bus.execute(
      state,
      setGroupPolicyInvocation(gravel.id, 'loudness', { integratedLufs: 3, toleranceLu: 1 }),
    );
    expect(refusalCodeOf(loud)).toBe('game.policy-loudness-invalid');
    expect(reasonsOf(loud)).toContain('Footsteps/Gravel');
    expect(
      unchangedCodeOf(bus.execute(state, setGroupPolicyInvocation(gravel.id, 'bus', undefined))),
    ).toBe('game.policy-unchanged');
  });

  it('refuses a value that does not read, naming the group by its path and the field', () => {
    // A bus has a name, which the bus's own constructor refuses as the value is
    // read, before the state's rules see it.
    const result = bus.execute(state, {
      commandId: ProjectCommandId.SetGroupPolicy,
      arguments: { group: gravel.id, field: 'bus', value: '""' },
    });
    expect(reasonsOf(result)).toMatch(/^The group “Footsteps\/Gravel” sets its bus with what/);
  });

  it('refuses a field it does not know and a chain given beside a field that names none', () => {
    expect(
      refusalCodeOf(
        bus.execute(state, {
          commandId: ProjectCommandId.SetGroupPolicy,
          arguments: { group: gravel.id, field: 'colour' },
        }),
      ),
    ).toBe('game.field-unknown');
    const beside = setGroupPolicyInvocation(gravel.id, 'loudness', {
      integratedLufs: -16,
      toleranceLu: 1,
    });
    const chain = addGroupInvocation(gravel, chains.b).arguments?.['chain'] ?? null;
    const withChain = { ...beside, arguments: { ...beside.arguments, chain } };
    expect(refusalCodeOf(bus.execute(state, withChain))).toBe('chain.not-named');
  });
});
