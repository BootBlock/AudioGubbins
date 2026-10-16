/**
 * Create Seamless Loop (ADR-0103, ADR-0105): each region's loop analysed with
 * a search for better boundaries, then the candidate and crossfade the person
 * chooses written into the region's loop, and, where asked, the region ended
 * at the loop's end.
 *
 * No loop point changes without the person's choice: a region with no
 * candidate chosen is skipped, and nothing is chosen for them. The loop is set
 * by `project.set-region`, so it is the loop the Inspector shows and changes,
 * anchored at the asset's chain as it stands.
 */

import {
  FadeShape,
  FailureKind,
  anchorResolver,
  placeRegion,
  derivedSampleCount,
  failure,
  succeed,
  type DomainFailure,
  type LoopDefinition,
  type Region,
} from '@audiogubbins/domain';
import { memberKey } from '@audiogubbins/game-audio';
import {
  defaultLoopSearch,
  type LoopAnalysis,
  type LoopAnalysisRequest,
  type LoopCandidate,
  type LoopSearch,
  type SuggestedCrossfade,
} from '@audiogubbins/loop-analysis';
import { setRegionInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { timeText } from './durations.js';
import { loopIs } from './existing-operations.js';
import type {
  AnalysisNeed,
  GuidedWorkflow,
  WorkflowInput,
  WorkflowOptions,
  WorkflowTarget,
} from './guided-workflow.js';
import { PlanBuilder } from './plan-builder.js';
import {
  gameOf,
  memberSubject,
  spanLength,
  targetMembers,
  targetsProblem,
  type MemberSubject,
} from './workflow-subjects.js';

/** The candidate a person chose for a region, and the crossfade at its join. */
export interface LoopChoice {
  /** The candidate's rank in the region's analysis. */
  readonly rank: number;
  /** Absent, the candidate's suggested crossfade, or a hard join where it suggests none. */
  readonly crossfade?: SuggestedCrossfade;
}

export interface CreateSeamlessLoopOptions {
  /** How the search for boundaries is bounded; absent, each region's default at its rate. */
  readonly search: LoopSearch | undefined;
  /** What the person chose, by the region's member key (`memberKey`). */
  readonly choices: ReadonlyMap<string, LoopChoice>;
  /** Whether each region is ended at its loop's end, so nothing plays after the loop. */
  readonly endAtLoopEnd: boolean;
}

/** A region's loop analysis and the request it answered. */
export interface LoopAnswer {
  readonly request: LoopAnalysisRequest;
  readonly analysis: LoopAnalysis;
}

/** The loop analyses, by the region's member key. */
export type LoopAnalyses = ReadonlyMap<string, LoopAnswer>;

/** The join a region's loop has where none was set: a hard one. */
const HARD_JOIN: SuggestedCrossfade = { lengthFrames: 0, shape: FadeShape.EqualPower };

function defaults(): WorkflowOptions<CreateSeamlessLoopOptions> {
  const workflow = { kind: 'workflow' } as const;
  return {
    search: { value: undefined, source: workflow },
    choices: { value: new Map(), source: workflow },
    endAtLoopEnd: { value: false, source: workflow },
  };
}

/** What a region's loop analysis is asked: its loop as placed, or the whole region where it has none. */
function requestFor(subject: MemberSubject, search: LoopSearch | undefined): LoopAnalysisRequest {
  const { region, asset } = subject;
  const placed =
    region === undefined ? undefined : placeRegion(anchorResolver(asset), region)?.loop;
  return {
    loop:
      placed === undefined
        ? {
            start: 0,
            end: spanLength(subject.span),
            crossfadeLength: 0,
            crossfadeShape: HARD_JOIN.shape,
          }
        : {
            start: placed.loopStart,
            end: placed.loopEnd,
            crossfadeLength: placed.crossfadeLength,
            crossfadeShape: placed.crossfadeShape,
          },
    search: search ?? defaultLoopSearch(subject.sampleRate),
  };
}

function analysesFor(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: CreateSeamlessLoopOptions,
): readonly AnalysisNeed[] {
  return targetMembers(gameOf(state), targets).flatMap((member): AnalysisNeed[] => {
    if (member.kind !== 'region') return [];
    const subject = memberSubject(state, member);
    return subject.ok
      ? [{ kind: 'loop', target: member, request: requestFor(subject.value, options.search) }]
      : [];
  });
}

function sameRequest(left: LoopAnalysisRequest, right: LoopAnalysisRequest): boolean {
  const loops =
    left.loop.start === right.loop.start &&
    left.loop.end === right.loop.end &&
    left.loop.crossfadeLength === right.loop.crossfadeLength &&
    left.loop.crossfadeShape === right.loop.crossfadeShape;
  const searches =
    left.search === undefined || right.search === undefined
      ? left.search === right.search
      : left.search.radiusFrames === right.search.radiusFrames &&
        left.search.keepLength === right.search.keepLength &&
        left.search.candidates === right.search.candidates;
  return loops && searches;
}

function refused(subject: MemberSubject, code: string, summary: string): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, {
    details: { member: memberKey(subject.member) },
  });
}

/** The region `subject` with its loop set to `loop`, ended at the loop's end where `endAtLoopEnd`. */
function looped(
  subject: MemberSubject,
  region: Region,
  loop: LoopDefinition,
  endAtLoopEnd: boolean,
): Region {
  const { span, asset } = subject;
  const basis = asset.edits.length;
  return {
    ...region,
    basis,
    start: derivedSampleCount(span.start),
    end: derivedSampleCount(endAtLoopEnd ? span.start + loop.loopEnd : span.end),
    loop: {
      basis,
      start: derivedSampleCount(span.start + loop.loopStart),
      end: derivedSampleCount(span.start + loop.loopEnd),
      crossfadeLength: loop.crossfadeLength,
      crossfadeShape: loop.crossfadeShape,
    },
  };
}

/** The candidate `choice` names in `subject`'s analysis, or why it cannot be taken from it. */
function chosenCandidate(
  subject: MemberSubject,
  choice: LoopChoice,
  input: WorkflowInput<CreateSeamlessLoopOptions, LoopAnalyses>,
): LoopCandidate | DomainFailure {
  const answer = input.analyses.get(memberKey(subject.member));
  if (answer === undefined) {
    return refused(
      subject,
      'workflow.analysis-missing',
      `The loop of "${subject.name}" has not been analysed yet; analyse it first.`,
    );
  }
  if (!sameRequest(answer.request, requestFor(subject, input.options.search))) {
    return refused(
      subject,
      'workflow.analysis-stale',
      `"${subject.name}" has changed since its loop was analysed; analyse it again.`,
    );
  }
  return (
    answer.analysis.candidates.find((one) => one.rank === choice.rank) ??
    refused(
      subject,
      'workflow.candidate-unknown',
      `The analysis of "${subject.name}" has no candidate ${String(choice.rank)}.`,
    )
  );
}

/** What setting `loop` on `subject`, and ending it there where `ends`, says. */
function loopWords(subject: MemberSubject, loop: LoopDefinition, ends: boolean): readonly string[] {
  const rate = subject.sampleRate;
  const join =
    loop.crossfadeLength === 0
      ? 'with a hard join'
      : `crossfaded over ${timeText(loop.crossfadeLength, rate)}, ${loop.crossfadeShape}`;
  return [
    `Loop "${subject.name}" from ${timeText(loop.loopStart, rate)} to ${timeText(loop.loopEnd, rate)}, ${join}.`,
    ...(ends ? [`End "${subject.name}" at its loop's end.`] : []),
  ];
}

function planRegion(
  builder: PlanBuilder,
  subject: MemberSubject,
  region: Region,
  input: WorkflowInput<CreateSeamlessLoopOptions, LoopAnalyses>,
): void {
  const choice = input.options.choices.get(memberKey(subject.member));
  if (choice === undefined) {
    builder.skip(subject.member, `No loop was chosen for "${subject.name}".`);
    return;
  }
  const candidate = chosenCandidate(subject, choice, input);
  if ('code' in candidate) {
    builder.refuse(subject.member, [candidate]);
    return;
  }
  const crossfade = choice.crossfade ?? candidate.crossfade ?? HARD_JOIN;
  const loop: LoopDefinition = {
    loopStart: derivedSampleCount(candidate.start),
    loopEnd: derivedSampleCount(candidate.end),
    crossfadeLength: derivedSampleCount(crossfade.lengthFrames),
    crossfadeShape: crossfade.shape,
  };
  const ends = input.options.endAtLoopEnd && candidate.end !== spanLength(subject.span);
  builder.attempt(
    subject.member,
    loopWords(subject, loop, ends),
    loopIs(subject.asset, region, loop) && !ends
      ? []
      : [setRegionInvocation(looped(subject, region, loop, input.options.endAtLoopEnd))],
    `"${subject.name}" already loops at the points chosen.`,
  );
}

function plan(input: WorkflowInput<CreateSeamlessLoopOptions, LoopAnalyses>) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  for (const member of targetMembers(game, input.targets)) {
    if (!builder.takes(member)) continue;
    const subject = memberSubject(builder.state, member);
    if (!subject.ok) {
      builder.refuse(member, subject.failures);
      continue;
    }
    const { region } = subject.value;
    if (region === undefined) {
      builder.refuse(member, [
        refused(
          subject.value,
          'workflow.loop-needs-region',
          `"${subject.value.name}" is a whole asset; a loop belongs to a region of it.`,
        ),
      ]);
      continue;
    }
    planRegion(builder, subject.value, region, input);
  }
  return succeed(builder.plan('Create seamless loops'));
}

export const CREATE_SEAMLESS_LOOP: GuidedWorkflow<CreateSeamlessLoopOptions, LoopAnalyses> = {
  key: 'create-seamless-loop',
  label: 'Create Seamless Loop',
  defaults,
  analysesFor,
  plan,
};
