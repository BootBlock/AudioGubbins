import { describe, expect, it } from 'vitest';

import type { CommandInvocation, ExecutionResult } from '@audiogubbins/commands';
import type { EffectChainId, Project } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { busName, memberKey, type GroupMember } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { setRackInvocation } from '../processing/rack-commands.js';
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
import { assignMemberInvocation, unassignMemberInvocation } from './game-invocations.js';

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

function rackOf(project: Project, member: GroupMember): EffectChainId | undefined {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.rack
    : project.assets.get(member.asset)?.rack;
}

/** `member`'s membership in `of`, and its place in the assignment order. */
function membershipIn(of: ProjectState, member: GroupMember) {
  const memberships = of.gameAudio?.memberships ?? [];
  const index = memberships.findIndex((one) => memberKey(one.member) === memberKey(member));
  return { membership: memberships[index], index };
}

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

function reasonsOf(result: ExecutionResult<ProjectState>): string {
  if (result.kind !== 'refused') throw new Error(`Expected a refusal; it was ${result.kind}.`);
  return result.failures.map((failure) => failure.summary).join(' ');
}

/** The rain asset with a rack of its own, a chain nothing else names. */
const ownChain = filterChain(ids);
const racked = after(
  state,
  setRackInvocation({ kind: 'asset', asset: reference.assets.rain }, ownChain),
);

describe('game.assign-member', () => {
  it('gives a member joining to inherit the rack it inherits, and undo gives back its own whole', () => {
    const left = after(racked, unassignMemberInvocation(members.rain));
    const { next, entry } = appliedAndUndone(
      left,
      assignMemberInvocation(members.rain, gravel.id, 'inherit'),
    );
    expect(rackOf(next.project, members.rain)).toBe(chains.a.id);
    // Nothing names the rain's own chain once it inherits, so it leaves with the change.
    expect(next.project.effectChains.has(ownChain.id)).toBe(false);
    expect(entry.inverse).toEqual([unassignMemberInvocation(members.rain, ownChain)]);
    expect(entry.description).toBe('Put “Rain” in group “Footsteps/Gravel”');
  });

  it('keeps the rack of a member that owns its processing, and joins it into a group of none', () => {
    const own = appliedAndUndone(racked, assignMemberInvocation(members.rain, gravel.id, 'own'));
    expect(rackOf(own.next.project, members.rain)).toBe(ownChain.id);
    const quiet = appliedAndUndone(
      state,
      assignMemberInvocation(members.footstep, ambience.id, 'inherit'),
    );
    expect(rackOf(quiet.next.project, members.footstep)).toBeUndefined();
  });

  it('keeps its place in the assignment order as it moves, and undo moves it back with its settings', () => {
    const before = membershipIn(state, members.footstep);
    const { next, entry } = appliedAndUndone(
      state,
      assignMemberInvocation(members.footstep, ambience.id, 'own', {
        overrides: { bus: expectSuccess(busName('UI')) },
      }),
    );
    const moved = membershipIn(next, members.footstep);
    expect(moved.index).toBe(before.index);
    expect(moved.membership?.group).toBe(ambience.id);
    expect(entry.description).toBe('Move “Gravel footstep” to group “Ambience”');

    const last = appliedAndUndone(
      state,
      assignMemberInvocation(members.footstep, footsteps.id, 'inherit', { position: 2 }),
    );
    expect(membershipIn(last.next, members.footstep).index).toBe(2);
  });

  it('refuses a rack given with inherit, a place past the order and a group the project lacks', () => {
    const rack = bus.execute(
      state,
      assignMemberInvocation(members.rain, gravel.id, 'inherit', { rack: 'none' }),
    );
    expect(refusalCodeOf(rack)).toBe('game.rack-inherited');
    expect(
      refusalCodeOf(
        bus.execute(state, assignMemberInvocation(members.rain, gravel.id, 'own', { position: 3 })),
      ),
    ).toBe('game.position-invalid');
    expect(
      refusalCodeOf(bus.execute(state, assignMemberInvocation(members.rain, ids.next(), 'own'))),
    ).toBe('game.group-unknown');
    expect(
      unchangedCodeOf(
        bus.execute(state, assignMemberInvocation(members.rain, footsteps.id, 'own')),
      ),
    ).toBe('game.member-unchanged');
  });
});

describe('a membership’s overrides that do not read', () => {
  it('are refused naming the member by its name and each field', () => {
    const joining = assignMemberInvocation(members.rain, gravel.id, 'own');
    const result = bus.execute(state, {
      ...joining,
      arguments: { ...joining.arguments, overrides: '{"bus":""}' },
    });
    const asset = members.rain.kind === 'asset' ? members.rain.asset : undefined;
    const name = asset === undefined ? undefined : state.project.assets.get(asset)?.displayName;
    expect(name).toBeDefined();
    expect(reasonsOf(result)).toContain(
      `The asset “${String(name)}” overrides its group’s bus with what it does not take`,
    );
  });
});

describe('game.unassign-member', () => {
  it('takes a member out, keeping its rack, and undo puts it back at its place', () => {
    const before = membershipIn(state, members.footstep);
    const { next, entry } = appliedAndUndone(state, unassignMemberInvocation(members.footstep));
    expect(membershipIn(next, members.footstep).membership).toBeUndefined();
    expect(rackOf(next.project, members.footstep)).toBe(chains.a.id);
    expect(entry.inverse).toEqual([
      assignMemberInvocation(members.footstep, footsteps.id, 'inherit', {
        overrides: {},
        position: before.index,
      }),
    ]);
  });

  it('refuses a member in no group', () => {
    const left = after(state, unassignMemberInvocation(members.rain));
    const result = bus.execute(left, unassignMemberInvocation(members.rain));
    expect(refusalCodeOf(result)).toBe('game.member-not-in-group');
    expect(reasonsOf(result)).toContain('“Rain” is in no group');
  });
});
