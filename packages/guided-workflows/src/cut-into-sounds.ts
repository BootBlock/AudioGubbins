/**
 * Cut Into Sounds (ADR-0105): a region over each sound the silence leaves in
 * a member, with a lead-in and a tail, put in the chosen group inheriting its
 * processing and named by the naming chosen, the group's own by default.
 *
 * Each region is what `project.add-region` makes, named as it is added, and
 * joins the group by `game.assign-member`; its name is the one the naming
 * gives it as the group's member, numbered after the members the group has.
 * A sound a region already lies over is not cut again.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type Region,
  type RegionId,
  type Span,
} from '@audiogubbins/domain';
import { silenceRemovals } from '@audiogubbins/detection-runtime';
import {
  groupPath,
  memberNames,
  namingTemplate,
  pathText,
  resolveGroupPolicy,
  type GameAssetGroupId,
  type GameAudioState,
  type NamingTemplate,
  type RegionMember,
} from '@audiogubbins/game-audio';
import { addRegionInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { analysisFor, reportOf, type AssistantAnalyses } from './assistant-analyses.js';
import { framesOf, timeText } from './durations.js';
import { regionOver } from './existing-operations.js';
import type {
  AnalysisNeed,
  GuidedWorkflow,
  WorkflowInput,
  WorkflowOptions,
  WorkflowTarget,
} from './guided-workflow.js';
import { PlanBuilder } from './plan-builder.js';
import { SILENCE, quietThroughout, silenceDetectors, soundsLeft } from './silence-reading.js';
import {
  gameOf,
  memberSubject,
  membershipOf,
  spanLength,
  targetMembers,
  targetsProblem,
  type MemberSubject,
} from './workflow-subjects.js';

export interface CutIntoSoundsOptions {
  /** The group the sounds join; none chosen, nothing can be planned. */
  readonly group: GameAssetGroupId | undefined;
  readonly naming: NamingTemplate;
  /** The loudest sample silence holds, in dBFS; absent, the detector's default. */
  readonly threshold: number | undefined;
  /** The shortest silence between two sounds, in seconds; absent, the detector's default. */
  readonly shortestPause: number | undefined;
  /** How much before each sound its region starts, in milliseconds. */
  readonly leadInMilliseconds: number;
  /** How much after each sound its region ends, in milliseconds. */
  readonly tailMilliseconds: number;
}

/** The naming the workflow offers where the group sets none. */
const DEFAULT_NAMING = '{asset:snake}_{number:2}';

/** How much of the silence before and after each sound its region keeps, by default. */
const DEFAULT_LEAD_IN_MILLISECONDS = 10;
const DEFAULT_TAIL_MILLISECONDS = 50;

function workflowNaming(): NamingTemplate {
  const made = namingTemplate(DEFAULT_NAMING);
  if (!made.ok)
    throw new Error(`The default naming "${DEFAULT_NAMING}" is not one the vocabulary reads.`);
  return made.value;
}

/** The one group every member of `targets` is in, where they are all in one. */
function commonGroup(
  game: GameAudioState,
  targets: readonly WorkflowTarget[],
): GameAssetGroupId | undefined {
  const groups = new Set(
    targetMembers(game, targets).map((member) => membershipOf(game, member)?.group),
  );
  const [only] = groups;
  return groups.size === 1 ? only : undefined;
}

function defaults(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): WorkflowOptions<CutIntoSoundsOptions> {
  const game = gameOf(state);
  const group = commonGroup(game, targets);
  const naming = group === undefined ? undefined : resolveGroupPolicy(game, group).fields.naming;
  return {
    group: {
      value: group,
      source: group === undefined ? { kind: 'workflow' } : { kind: 'targets' },
    },
    naming:
      naming?.value === undefined
        ? { value: workflowNaming(), source: { kind: 'workflow' } }
        : { value: naming.value, source: { kind: 'policy', source: naming.source } },
    threshold: { value: undefined, source: { kind: 'workflow' } },
    shortestPause: { value: undefined, source: { kind: 'workflow' } },
    leadInMilliseconds: { value: DEFAULT_LEAD_IN_MILLISECONDS, source: { kind: 'workflow' } },
    tailMilliseconds: { value: DEFAULT_TAIL_MILLISECONDS, source: { kind: 'workflow' } },
  };
}

/** The silence need of `member`: its pauses taken out whole, so each sound's lead-in and tail are the workflow's. */
function need(
  member: MemberSubject['member'],
  options: CutIntoSoundsOptions,
): Extract<AnalysisNeed, { readonly kind: 'assistants' }> {
  return {
    kind: 'assistants',
    target: member,
    assistants: [SILENCE],
    detectors: silenceDetectors({
      threshold: options.threshold,
      shortestPause: options.shortestPause,
      pauseKept: 0,
    }),
  };
}

function analysesFor(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: CutIntoSoundsOptions,
): readonly AnalysisNeed[] {
  return targetMembers(gameOf(state), targets).map((member) => need(member, options));
}

/** The sounds of `subject` to cut, on its asset's timeline, that no region lies over yet. */
function soundsToCut(
  state: ProjectState,
  subject: MemberSubject,
  sounds: readonly Span[],
): readonly Span[] {
  return sounds
    .map((sound) => ({
      start: subject.span.start + sound.start,
      end: subject.span.start + sound.end,
    }))
    .filter((sound) => !regionOver(state.project, subject.asset, sound));
}

/**
 * The regions over `sounds`, named as the group's members by `naming`, or
 * every reason one cannot be named: each named in the state where it and the
 * regions before it have joined the group, so it is numbered after them.
 */
function namedRegions(
  state: ProjectState,
  subject: MemberSubject,
  sounds: readonly Span[],
  group: GameAssetGroupId,
  input: WorkflowInput<CutIntoSoundsOptions, AssistantAnalyses>,
):
  | { readonly regions: readonly Region[] }
  | { readonly failures: readonly [DomainFailure, ...DomainFailure[]] } {
  const unnamed = sounds.map((sound): Region => ({
    id: input.ids.next<'RegionId'>(),
    assetId: subject.asset.id,
    displayName: '',
    basis: subject.asset.edits.length,
    start: derivedSampleCount(sound.start),
    end: derivedSampleCount(sound.end),
    tags: [],
    operations: [],
  }));
  const members = unnamed.map((region): RegionMember => ({ kind: 'region', region: region.id }));
  const regions = new Map(state.project.regions);
  for (const region of unnamed) regions.set(region.id, region);
  const game = gameOf(state);
  const joined: GameAudioState = {
    ...game,
    memberships: [
      ...game.memberships,
      ...members.map((member) => ({
        member,
        group,
        processing: 'inherit' as const,
        overrides: {},
      })),
    ],
  };
  const names = memberNames(
    { ...state.project, regions },
    joined,
    members,
    input.options.naming,
    input.clock,
  );
  const failures = names.flatMap((name) => (name.kind === 'refused' ? name.failures : []));
  const [first, ...rest] = failures;
  if (first !== undefined) return { failures: [first, ...rest] };
  const byRegion = new Map<RegionId, string>(
    names.flatMap((name) =>
      name.kind === 'named' ? [[name.member.region, name.name] as const] : [],
    ),
  );
  return {
    regions: unnamed.map((region) => ({ ...region, displayName: byRegion.get(region.id) ?? '' })),
  };
}

function planMember(
  builder: PlanBuilder,
  member: MemberSubject['member'],
  group: GameAssetGroupId,
  input: WorkflowInput<CutIntoSoundsOptions, AssistantAnalyses>,
): void {
  const { state } = builder;
  const subject = memberSubject(state, member);
  if (!subject.ok) {
    builder.refuse(member, subject.failures);
    return;
  }
  const asked = need(member, input.options);
  const analysis = analysisFor(input.analyses, asked, subject.value);
  if (!analysis.ok) {
    builder.refuse(member, analysis.failures);
    return;
  }
  const report = reportOf(analysis.value.reports, SILENCE);
  if (quietThroughout(report)) {
    builder.skip(
      member,
      `"${subject.value.name}" is quiet throughout, so it holds no sound to cut.`,
    );
    return;
  }
  const rate = subject.value.sampleRate;
  const sounds = soundsLeft(
    silenceRemovals(report, analysis.value.scope, 'both'),
    spanLength(subject.value.span),
    framesOf(input.options.leadInMilliseconds, rate),
    framesOf(input.options.tailMilliseconds, rate),
  );
  const cut = soundsToCut(state, subject.value, sounds);
  const named = namedRegions(state, subject.value, cut, group, input);
  if ('failures' in named) {
    builder.refuse(member, named.failures);
    return;
  }
  const groupName = pathText(groupPath(gameOf(state).groups, group));
  builder.attempt(
    member,
    named.regions.map(
      (region) =>
        `Add the region "${region.displayName}" from ${timeText(region.start, rate)} to ${timeText(region.end, rate)} of "${subject.value.asset.displayName}", in "${groupName}".`,
    ),
    named.regions.flatMap((region) => [
      addRegionInvocation(region),
      assignMemberInvocation({ kind: 'region', region: region.id }, group, 'inherit'),
    ]),
    `A region already lies over every sound in "${subject.value.name}".`,
  );
}

function plan(input: WorkflowInput<CutIntoSoundsOptions, AssistantAnalyses>) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const { group } = input.options;
  if (group === undefined || !game.groups.has(group)) {
    return fail(
      failure(
        'workflow.group-not-chosen',
        FailureKind.Rejected,
        'Choose the group the sounds are put in.',
      ),
    );
  }
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  for (const member of targetMembers(game, input.targets)) {
    if (builder.takes(member)) planMember(builder, member, group, input);
  }
  return succeed(builder.plan('Cut into sounds'));
}

export const CUT_INTO_SOUNDS: GuidedWorkflow<CutIntoSoundsOptions, AssistantAnalyses> = {
  key: 'cut-into-sounds',
  label: 'Cut Into Sounds',
  defaults,
  analysesFor,
  plan,
};
