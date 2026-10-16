/**
 * Normalise Game SFX (ADR-0101, ADR-0105): each group's loudness target set
 * where the person asks, and realised as a loudness normalisation ending the
 * chain its members inherit; where the group inherits no chain, its
 * processing becomes a copy of the built-in game chain for its target. A
 * member that owns its processing is normalised at the end of its own rack.
 *
 * A group's subject is the group, so a member target that inherits its
 * group's processing is normalised through its group's chain unless the
 * person chooses its own rack. Nothing is measured here: the members are
 * measured once the step has applied, for conformance (`measureAfter`).
 */

import { FailureKind, failure, succeed, type DomainFailure } from '@audiogubbins/domain';
import {
  groupPath,
  memberKey,
  pathText,
  resolveGroupPolicy,
  resolvePolicy,
  type GameAssetGroupId,
  type GroupMember,
  type LoudnessTarget,
} from '@audiogubbins/game-audio';
import { setGroupPolicyInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { levelText } from './durations.js';
import { groupSets } from './existing-operations.js';
import type {
  GuidedWorkflow,
  NoAnalyses,
  WorkflowInput,
  WorkflowOptions,
  WorkflowTarget,
} from './guided-workflow.js';
import { builtInChainFor, loudnessStep, processorsOf } from './level-slots.js';
import { PlanBuilder } from './plan-builder.js';
import {
  groupChainChange,
  memberRackChange,
  type Placement,
  type ProcessingChange,
} from './processing-placement.js';
import {
  expandedGroups,
  gameOf,
  memberSubject,
  membershipOf,
  targetsProblem,
} from './workflow-subjects.js';

export interface NormaliseGameSfxOptions {
  /** The loudness target each group target is set to; absent, each keeps its own. */
  readonly loudness: LoudnessTarget | undefined;
  /** Where a member target that inherits its group's processing is normalised. */
  readonly placement: Placement;
}

type Input = WorkflowInput<NormaliseGameSfxOptions, NoAnalyses>;

function defaults(): WorkflowOptions<NormaliseGameSfxOptions> {
  return {
    loudness: { value: undefined, source: { kind: 'workflow' } },
    placement: { value: 'group', source: { kind: 'workflow' } },
  };
}

function noTarget(code: string, summary: string, details: Record<string, string>): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, { details });
}

function targetWords(target: LoudnessTarget): string {
  return levelText(target.integratedLufs, 'LUFS');
}

/** The normalisation to `target`, made as a treatment is, or why it cannot be. */
function levelFor(target: LoudnessTarget, input: Input) {
  return processorsOf(
    [{ step: loudnessStep(target), state: undefined }],
    input.catalogue,
    input.ids,
  );
}

/** Setting `group`'s loudness target to `asked`, where it is asked for and not set already. */
function targetSetting(
  group: GameAssetGroupId,
  name: string,
  asked: LoudnessTarget | undefined,
  state: ProjectState,
): ProcessingChange {
  const owned = gameOf(state).groups.get(group);
  if (asked === undefined || (owned !== undefined && groupSets(owned, 'loudness', asked))) {
    return { invocations: [], changes: [] };
  }
  return {
    invocations: [setGroupPolicyInvocation(group, 'loudness', asked)],
    changes: [`Set the loudness target of "${name}" to ${targetWords(asked)}.`],
  };
}

function planGroup(
  builder: PlanBuilder,
  group: GameAssetGroupId,
  asked: boolean,
  input: Input,
): void {
  if (!builder.takes(group)) return;
  const { state } = builder;
  const game = gameOf(state);
  const name = pathText(groupPath(game.groups, group));
  const set = asked ? input.options.loudness : undefined;
  const target = set ?? resolveGroupPolicy(game, group).fields.loudness.value;
  if (target === undefined) {
    builder.refuse(group, [
      noTarget(
        'workflow.no-loudness-target',
        `"${name}" has no loudness target; set one, or leave it out.`,
        { group },
      ),
    ]);
    return;
  }
  const level = levelFor(target, input);
  if (!level.ok) {
    builder.refuse(group, level.failures);
    return;
  }
  const setting = targetSetting(group, name, set, state);
  const change = groupChainChange(
    state,
    group,
    { treatments: [], level: level.value[0] },
    () => builtInChainFor(target.integratedLufs, input.catalogue, input.ids),
    input.catalogue,
    input.ids,
  );
  builder.attempt(
    group,
    [...setting.changes, ...change.changes],
    [...setting.invocations, ...change.invocations],
    `What "${name}" plays is already normalised to ${targetWords(target)}.`,
  );
}

function planOwnRack(builder: PlanBuilder, member: GroupMember, input: Input): void {
  if (!builder.takes(member)) return;
  const { state } = builder;
  const subject = memberSubject(state, member);
  if (!subject.ok) {
    builder.refuse(member, subject.failures);
    return;
  }
  const target = resolvePolicy(state.project, gameOf(state), member).loudness.value;
  if (target === undefined) {
    builder.refuse(member, [
      noTarget(
        'workflow.no-loudness-target',
        `"${subject.value.name}" has no loudness target; give its group one, or leave it out.`,
        { member: memberKey(member) },
      ),
    ]);
    return;
  }
  const level = levelFor(target, input);
  if (!level.ok) {
    builder.refuse(member, level.failures);
    return;
  }
  const change = memberRackChange(
    state,
    subject.value,
    { treatments: [], level: level.value[0] },
    input.catalogue,
    input.ids,
  );
  builder.attempt(
    member,
    change.changes,
    change.invocations,
    `"${subject.value.name}" is already normalised to ${targetWords(target)} at the end of its rack.`,
  );
}

/** Plans one target, giving each member it covers to `measured`. */
function planTarget(
  builder: PlanBuilder,
  target: WorkflowTarget,
  measured: GroupMember[],
  input: Input,
): void {
  const game = gameOf(input.state);
  if (target.kind === 'group') {
    for (const group of expandedGroups(game, target.group, target.subgroups)) {
      planGroup(builder, group, true, input);
      for (const membership of game.memberships) {
        if (membership.group !== group) continue;
        measured.push(membership.member);
        if (membership.processing === 'own') planOwnRack(builder, membership.member, input);
      }
    }
    return;
  }
  const membership = membershipOf(game, target);
  if (membership === undefined) {
    if (builder.takes(target)) {
      builder.refuse(target, [
        noTarget(
          'workflow.member-in-no-group',
          'It is in no group, so it has no loudness target; put it in one first.',
          { member: memberKey(target) },
        ),
      ]);
    }
    return;
  }
  measured.push(target);
  if (membership.processing === 'own' || input.options.placement === 'member') {
    planOwnRack(builder, target, input);
    return;
  }
  planGroup(builder, membership.group, false, input);
  if (builder.takes(target)) {
    const name = pathText(groupPath(game.groups, membership.group));
    builder.skip(target, `It is normalised through the chain of its group "${name}".`);
  }
}

function plan(input: Input) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  const measured: GroupMember[] = [];
  for (const target of input.targets) planTarget(builder, target, measured, input);
  const seen = new Set<string>();
  const measureAfter = measured.filter((member) => {
    const key = memberKey(member);
    if (seen.has(key)) return false;
    seen.add(key);
    const membership = membershipOf(game, member);
    return (
      !builder.refused(member) &&
      !(membership?.processing === 'inherit' && builder.refused(membership.group))
    );
  });
  return succeed(builder.plan('Normalise game SFX', { measureAfter }));
}

export const NORMALISE_GAME_SFX: GuidedWorkflow<NormaliseGameSfxOptions, NoAnalyses> = {
  key: 'normalise-game-sfx',
  label: 'Normalise Game SFX',
  defaults,
  analysesFor: () => [],
  plan,
};
