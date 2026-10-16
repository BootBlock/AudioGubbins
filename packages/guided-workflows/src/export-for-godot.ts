/**
 * Export for Godot (ADR-0102, ADR-0105): each group's export profile, naming
 * and destination set to what Godot 4's importer reads, and each looping
 * member of a group whose profile cannot hold its loop given a visible
 * override to WAV, whose `smpl` chunk carries the loop.
 *
 * It sets ordinary policy only; the export itself is offered once the step
 * has applied, as its own action, never inside it, because an export is an
 * external side effect and is never undone (ADR-0092). A member in no group
 * has no profile, naming or destination to set and is refused. Godot's own
 * import files and resources are a later phase's.
 */

import {
  FailureKind,
  failure,
  succeed,
  type DomainFailure,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  destinationPath,
  groupPath,
  inCase,
  memberKey,
  namingTemplate,
  pathText,
  resolvePolicy,
  type GameAssetGroupId,
  type GameExportProfile,
  type GroupMember,
  type NamingTemplate,
} from '@audiogubbins/game-audio';
import {
  setGroupPolicyInvocation,
  setMemberOverrideInvocation,
} from '@audiogubbins/project-commands';
import type { CommandInvocation } from '@audiogubbins/commands';

import { groupSets, overrideSets } from './existing-operations.js';
import type {
  GuidedWorkflow,
  WorkflowInput,
  NoAnalyses,
  WorkflowOptions,
} from './guided-workflow.js';
import { PlanBuilder } from './plan-builder.js';
import {
  expandedGroups,
  gameOf,
  memberSubject,
  membershipOf,
  targetsProblem,
} from './workflow-subjects.js';

/** What a group's one-shots are exported as. */
export type GodotFormat = 'wav' | 'ogg-vorbis';

export interface ExportForGodotOptions {
  readonly format: GodotFormat;
  readonly naming: NamingTemplate;
  /** The folders every group's path is placed under. */
  readonly destinationRoot: readonly string[];
}

type Input = WorkflowInput<ExportForGodotOptions, NoAnalyses>;

const DEFAULT_NAMING = '{group:snake}_{number:2}';
const DEFAULT_ROOT = ['audio'];

function defaultNaming(): NamingTemplate {
  const made = namingTemplate(DEFAULT_NAMING);
  if (!made.ok)
    throw new Error(`The default naming "${DEFAULT_NAMING}" is not one the vocabulary reads.`);
  return made.value;
}

function defaults(): WorkflowOptions<ExportForGodotOptions> {
  const workflow = { kind: 'workflow' } as const;
  return {
    format: { value: 'wav', source: workflow },
    naming: { value: defaultNaming(), source: workflow },
    destinationRoot: { value: DEFAULT_ROOT, source: workflow },
  };
}

/** WAV of 16-bit integers at `rate`, which Godot imports with its loop from `smpl`. */
function wavProfile(rate: SampleRate): GameExportProfile {
  return { format: 'wav', choices: { encoding: { kind: 'integer', bits: 16 }, sampleRate: rate } };
}

/** The profile a group's one-shots export to at `rate`: WAV as above, or Ogg Vorbis at its defaults. */
function profileOf(format: GodotFormat, rate: SampleRate): GameExportProfile {
  return format === 'wav'
    ? wavProfile(rate)
    : { format: 'ogg-vorbis', choices: { sampleRate: rate } };
}

const FORMAT_WORDS: Readonly<Record<GodotFormat, string>> = {
  wav: 'WAV, 16-bit',
  'ogg-vorbis': 'Ogg Vorbis',
};

function planGroup(builder: PlanBuilder, group: GameAssetGroupId, input: Input): void {
  if (!builder.takes(group)) return;
  const game = gameOf(builder.state);
  const owned = game.groups.get(group);
  if (owned === undefined) return;
  const path = groupPath(game.groups, group);
  const name = pathText(path);
  const destination = destinationPath([
    ...input.options.destinationRoot,
    ...path.map((segment) => inCase(segment, 'snake')),
  ]);
  if (!destination.ok) {
    builder.refuse(group, destination.failures);
    return;
  }
  const rate = builder.state.project.settings.sampleRate;
  const profile = profileOf(input.options.format, rate);
  const { naming } = input.options;
  const changes: string[] = [];
  const invocations: CommandInvocation[] = [];
  if (!groupSets(owned, 'exportProfile', profile)) {
    changes.push(
      `Export "${name}" as ${FORMAT_WORDS[input.options.format]} at ${String(rate)} Hz.`,
    );
    invocations.push(setGroupPolicyInvocation(group, 'exportProfile', profile));
  }
  if (!groupSets(owned, 'naming', naming)) {
    changes.push(`Name the files of "${name}" by ${naming.source}.`);
    invocations.push(setGroupPolicyInvocation(group, 'naming', naming));
  }
  if (!groupSets(owned, 'destination', destination.value)) {
    changes.push(`Put the files of "${name}" in ${destination.value.segments.join('/')}/.`);
    invocations.push(setGroupPolicyInvocation(group, 'destination', destination.value));
  }
  builder.attempt(group, changes, invocations, `"${name}" already exports for Godot as chosen.`);
}

/**
 * The override a looping member needs, where its effective profile once the
 * groups are set is not WAV, which alone of the formats here holds a loop.
 */
function planLoop(builder: PlanBuilder, member: GroupMember, isTarget: boolean): void {
  const { state } = builder;
  const subject = memberSubject(state, member);
  if (!subject.ok) {
    if (builder.takes(member)) builder.refuse(member, subject.failures);
    return;
  }
  const { region, name } = subject.value;
  const looping = region?.loop !== undefined;
  const profile = resolvePolicy(state.project, gameOf(state), member).exportProfile.value;
  if (!looping || profile?.format === 'wav') {
    if (isTarget && builder.takes(member)) {
      builder.skip(
        member,
        `"${name}" is exported with its group's settings, which need no override.`,
      );
    }
    return;
  }
  if (!builder.takes(member)) return;
  const wav = wavProfile(state.project.settings.sampleRate);
  const overrides = subject.value.membership?.overrides ?? {};
  builder.attempt(
    member,
    [`Export "${name}" as WAV, 16-bit, an override of its group's profile, so its loop is kept.`],
    overrideSets(overrides, 'exportProfile', wav)
      ? []
      : [setMemberOverrideInvocation(member, 'exportProfile', wav)],
    `"${name}" already exports as WAV, which keeps its loop.`,
  );
}

function notInGroup(member: GroupMember): DomainFailure {
  return failure(
    'workflow.member-in-no-group',
    FailureKind.Rejected,
    'It is not in a group: assign it first, so a group gives it its profile, naming and folder.',
    { details: { member: memberKey(member) } },
  );
}

function plan(input: Input) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  const groups: GameAssetGroupId[] = [];
  const exported: { readonly member: GroupMember; readonly isTarget: boolean }[] = [];
  const seen = new Set<string>();
  const exports = (member: GroupMember, isTarget: boolean): void => {
    if (seen.has(memberKey(member))) return;
    seen.add(memberKey(member));
    exported.push({ member, isTarget });
  };
  for (const target of input.targets) {
    if (target.kind === 'group') {
      for (const group of expandedGroups(game, target.group, target.subgroups)) {
        groups.push(group);
        for (const membership of game.memberships) {
          if (membership.group === group) exports(membership.member, false);
        }
      }
      continue;
    }
    const membership = membershipOf(game, target);
    if (membership === undefined) {
      if (builder.takes(target)) builder.refuse(target, [notInGroup(target)]);
      continue;
    }
    groups.push(membership.group);
    exports(target, true);
  }
  for (const group of groups) planGroup(builder, group, input);
  for (const { member, isTarget } of exported) planLoop(builder, member, isTarget);
  const exportAfter = exported
    .map(({ member }) => member)
    .filter((member) => {
      const group = membershipOf(game, member)?.group;
      return !builder.refused(member) && (group === undefined || !builder.refused(group));
    });
  return succeed(builder.plan('Prepare the export for Godot', { exportAfter }));
}

export const EXPORT_FOR_GODOT: GuidedWorkflow<ExportForGodotOptions, NoAnalyses> = {
  key: 'export-for-godot',
  label: 'Export for Godot',
  defaults,
  analysesFor: () => [],
  plan,
};
