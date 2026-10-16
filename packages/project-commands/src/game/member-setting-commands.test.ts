import { describe, expect, it } from 'vitest';

import type { CommandInvocation, ExecutionResult } from '@audiogubbins/commands';
import type { EffectChainId, Project } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { busName, memberKey, type GroupMember } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { setRackInvocation } from '../processing/rack-commands.js';
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
  resetMemberOverrideInvocation,
  setGroupPolicyInvocation,
  setMemberOverrideInvocation,
  setMemberProcessingInvocation,
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
const { footsteps } = groups;

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

describe('game.set-member-override and game.reset-member-override', () => {
  it('sets a field over the group and resets it to the group’s, each undone exactly', () => {
    const ui = expectSuccess(busName('UI'));
    const set = appliedAndUndone(state, setMemberOverrideInvocation(members.loop, 'bus', ui));
    expect(membershipIn(set.next, members.loop).membership?.overrides).toEqual({ bus: ui });
    expect(set.entry.description).toBe('Set the bus of “Walk loop” over group “Footsteps/Gravel”');
    const reset = appliedAndUndone(set.next, resetMemberOverrideInvocation(members.loop, 'bus'));
    expect(membershipIn(reset.next, members.loop).membership?.overrides).toEqual({});
    expect(
      unchangedCodeOf(bus.execute(state, resetMemberOverrideInvocation(members.loop, 'bus'))),
    ).toBe('game.override-unset');
  });

  it('refuses a field only the group sets, naming the group, and a value out of range naming the member', () => {
    const emitter = bus.execute(state, {
      commandId: ProjectCommandId.SetMemberOverride,
      arguments: {
        ...setMemberOverrideInvocation(members.loop, 'bus', expectSuccess(busName('UI'))).arguments,
        field: 'emitter',
      },
    });
    expect(refusalCodeOf(emitter)).toBe('game.field-not-overridable');
    expect(reasonsOf(emitter)).toContain('group “Footsteps/Gravel”');

    const loud = bus.execute(
      state,
      setMemberOverrideInvocation(members.loop, 'loudness', {
        integratedLufs: -90,
        toleranceLu: 1,
      }),
    );
    expect(refusalCodeOf(loud)).toBe('game.policy-loudness-invalid');
    expect(reasonsOf(loud)).toContain('Walk loop');
  });
});

describe('game.set-member-processing', () => {
  it('resets an owning member to inherited, its rack following, and undo gives back its own', () => {
    const { next, entry } = appliedAndUndone(
      racked,
      setMemberProcessingInvocation(members.rain, 'inherit'),
    );
    expect(rackOf(next.project, members.rain)).toBe(chains.a.id);
    expect(membershipIn(next, members.rain).membership?.processing).toBe('inherit');
    expect(entry.inverse).toEqual([setMemberProcessingInvocation(members.rain, 'own', ownChain)]);
  });

  it('lets an inheriting member own the rack it has, then follow its group no more', () => {
    const owned = appliedAndUndone(state, setMemberProcessingInvocation(members.loop, 'own'));
    expect(rackOf(owned.next.project, members.loop)).toBe(chains.a.id);
    const moved = after(
      owned.next,
      setGroupPolicyInvocation(footsteps.id, 'processing', chains.b.id, chains.b),
    );
    expect(rackOf(moved.project, members.loop)).toBe(chains.a.id);
    expect(rackOf(moved.project, members.footstep)).toBe(chains.b.id);
  });

  it('changes nothing where the member already stands so, and refuses a rack given with inherit', () => {
    expect(
      unchangedCodeOf(bus.execute(state, setMemberProcessingInvocation(members.loop, 'inherit'))),
    ).toBe('game.processing-unchanged');
    expect(
      refusalCodeOf(
        bus.execute(state, setMemberProcessingInvocation(members.rain, 'inherit', 'none')),
      ),
    ).toBe('game.rack-inherited');
  });
});
