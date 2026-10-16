/**
 * Prepare One-Shot (ADR-0105): each member trimmed to its sound with a
 * lead-in and a tail, faded in and out at its new edges, its DC offset
 * removed where the detector finds one, and its level normalised last.
 *
 * Trims and fades are the member's own: a region's boundaries and its own
 * processing, an asset's trim and fade edits. The DC removal and the level
 * are processing at the end of a rack (ADR-0060's order): the member's own,
 * or, where it inherits its group's processing and the person chose so, its
 * group's chain. The level is a loudness normalisation to the member's
 * effective loudness target, or a peak normalisation to the stated peak where
 * none is set. A fade already at an edge, a trim already made and processing
 * already at the rack's end are not made again.
 */

import {
  FadeShape,
  FailureKind,
  FindingKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type EditRange,
  type ProcessorInstance,
  type TreatmentStep,
} from '@audiogubbins/domain';
import type { AssistantReport, DetectionScope } from '@audiogubbins/detection-runtime';
import { memberKey, resolvePolicy } from '@audiogubbins/game-audio';
import { DC_OFFSET_DETECTOR } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import {
  analysisFor,
  assistantRunning,
  reportOf,
  type AssistantAnalyses,
} from './assistant-analyses.js';
import { framesOf, levelText, timeText } from './durations.js';
import type {
  AnalysisNeed,
  GuidedWorkflow,
  WorkflowInput,
  WorkflowOptions,
  WorkflowTarget,
} from './guided-workflow.js';
import { assetParts, keptSpan, regionParts, type Part } from './one-shot-edges.js';
import { loudnessStep, peakStep, processorsOf } from './level-slots.js';
import { PlanBuilder } from './plan-builder.js';
import { placedChange, type Placement, type ProcessingChange } from './processing-placement.js';
import { SILENCE, quietThroughout, silenceDetectors } from './silence-reading.js';
import {
  gameOf,
  memberSubject,
  spanLength,
  targetMembers,
  targetsProblem,
  type MemberSubject,
} from './workflow-subjects.js';

export interface PrepareOneShotOptions {
  /** The loudest sample silence holds, in dBFS; absent, the detector's default. */
  readonly threshold: number | undefined;
  /** How much before the sound the member starts, in milliseconds. */
  readonly leadInMilliseconds: number;
  /** How much after the sound the member ends, in milliseconds. */
  readonly tailMilliseconds: number;
  readonly fadeInMilliseconds: number;
  readonly fadeInShape: FadeShape;
  readonly fadeOutMilliseconds: number;
  readonly fadeOutShape: FadeShape;
  /** The true peak a member with no loudness target is normalised to, in dBTP. */
  readonly peakDbtp: number;
  /** Where a member that inherits its group's processing has its DC removal and level. */
  readonly placement: Placement;
}

/** The assistant that runs the DC offset detector. */
const RESTORATION = assistantRunning(DC_OFFSET_DETECTOR);

/**
 * The defaults: a lead-in as long as the fade in and a tail as long as the
 * fade out, so each fade spans the quiet kept at its edge; a short linear fade
 * in, which keeps the attack, and a longer equal-power fade out, which ends
 * the decay without a step; and a true peak of −1 dBTP.
 */
const DEFAULTS = {
  leadIn: 2,
  tail: 20,
  fadeIn: 2,
  fadeOut: 20,
  peak: -1,
} as const;

function defaults(): WorkflowOptions<PrepareOneShotOptions> {
  const workflow = { kind: 'workflow' } as const;
  return {
    threshold: { value: undefined, source: workflow },
    leadInMilliseconds: { value: DEFAULTS.leadIn, source: workflow },
    tailMilliseconds: { value: DEFAULTS.tail, source: workflow },
    fadeInMilliseconds: { value: DEFAULTS.fadeIn, source: workflow },
    fadeInShape: { value: FadeShape.Linear, source: workflow },
    fadeOutMilliseconds: { value: DEFAULTS.fadeOut, source: workflow },
    fadeOutShape: { value: FadeShape.EqualPower, source: workflow },
    peakDbtp: { value: DEFAULTS.peak, source: workflow },
    placement: { value: 'member', source: workflow },
  };
}

function need(
  member: MemberSubject['member'],
  options: PrepareOneShotOptions,
): Extract<AnalysisNeed, { readonly kind: 'assistants' }> {
  return {
    kind: 'assistants',
    target: member,
    assistants: [SILENCE, RESTORATION],
    detectors: silenceDetectors({ threshold: options.threshold }),
  };
}

function analysesFor(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
  options: PrepareOneShotOptions,
): readonly AnalysisNeed[] {
  return targetMembers(gameOf(state), targets).map((member) => need(member, options));
}

function refused(subject: MemberSubject, code: string, summary: string): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, {
    details: { member: memberKey(subject.member) },
  });
}

/** The DC removal the restoration found a need for, where it found one. */
function dcSteps(report: AssistantReport): readonly TreatmentStep[] {
  const found = report.recommendation.findings.find(
    (finding) => finding.kind === FindingKind.DcOffset && finding.treatment.kind === 'steps',
  );
  return found?.treatment.kind === 'steps' ? found.treatment.steps : [];
}

/** The level step for `subject`: its effective loudness target, or the stated peak. */
function levelStep(
  state: ProjectState,
  subject: MemberSubject,
  options: PrepareOneShotOptions,
): { readonly step: TreatmentStep; readonly words: string } {
  const loudness = resolvePolicy(state.project, gameOf(state), subject.member).loudness.value;
  return loudness === undefined
    ? {
        step: peakStep(options.peakDbtp),
        words: `a true peak of ${levelText(options.peakDbtp, 'dBTP')}`,
      }
    : { step: loudnessStep(loudness), words: levelText(loudness.integratedLufs, 'LUFS') };
}

/** The DC removal and level at the end of the member's rack or its group's chain. */
function rackPart(
  state: ProjectState,
  subject: MemberSubject,
  report: AssistantReport,
  input: WorkflowInput<PrepareOneShotOptions, AssistantAnalyses>,
): DomainResult<ProcessingChange> {
  const level = levelStep(state, subject, input.options);
  const steps = [...dcSteps(report), level.step].map((step) => ({ step, state: undefined }));
  const made = processorsOf(steps, input.catalogue, input.ids);
  if (!made.ok) return made;
  const treatments: ProcessorInstance[] = [...made.value];
  const last = treatments.pop();
  const change = placedChange(
    state,
    subject,
    { treatments, level: last },
    input.options.placement,
    input.catalogue,
    input.ids,
  );
  return succeed({
    invocations: change.invocations,
    changes: [
      ...change.changes,
      ...(change.invocations.length === 0 ? [] : [`Its level is normalised to ${level.words}.`]),
    ],
  });
}

/** The span a member keeps and its fades' lengths, or why it cannot be made a one-shot. */
function edgesOf(
  one: MemberSubject,
  silence: AssistantReport,
  scope: DetectionScope,
  options: PrepareOneShotOptions,
): DomainFailure | { readonly kept: EditRange; readonly fadeIn: number; readonly fadeOut: number } {
  if (one.region?.loop !== undefined) {
    return refused(
      one,
      'workflow.one-shot-loops',
      `"${one.name}" loops, so it is not a one-shot; take its loop away first, or leave it out.`,
    );
  }
  if (quietThroughout(silence)) {
    return refused(one, 'workflow.quiet-throughout', `"${one.name}" is quiet throughout.`);
  }
  const rate = one.sampleRate;
  const kept = keptSpan(
    silence,
    scope,
    spanLength(one.span),
    framesOf(options.leadInMilliseconds, rate),
    framesOf(options.tailMilliseconds, rate),
  );
  const fadeIn = framesOf(options.fadeInMilliseconds, rate);
  const fadeOut = framesOf(options.fadeOutMilliseconds, rate);
  if (fadeIn + fadeOut > kept.end - kept.start) {
    return refused(
      one,
      'workflow.shorter-than-fades',
      `"${one.name}" is ${timeText(kept.end - kept.start, rate)} long, shorter than its fades; shorten them.`,
    );
  }
  return { kept, fadeIn, fadeOut };
}

/** Every change that prepares `one`, or why it cannot be prepared. */
function preparation(
  state: ProjectState,
  one: MemberSubject,
  input: WorkflowInput<PrepareOneShotOptions, AssistantAnalyses>,
): DomainResult<readonly Part[]> {
  const analysis = analysisFor(input.analyses, need(one.member, input.options), one);
  if (!analysis.ok) return analysis;
  const { reports, scope } = analysis.value;
  const edges = edgesOf(one, reportOf(reports, SILENCE), scope, input.options);
  if ('code' in edges) return fail(edges);
  const { kept, fadeIn, fadeOut } = edges;
  const shapes = { in: input.options.fadeInShape, out: input.options.fadeOutShape };
  const parts =
    one.region === undefined
      ? assetParts(one, kept, fadeIn, fadeOut, shapes, input.ids)
      : succeed(regionParts(one, kept, fadeIn, fadeOut, shapes, input.ids));
  if (!parts.ok) return parts;
  const rack = rackPart(state, one, reportOf(reports, RESTORATION), input);
  return rack.ok ? succeed([...parts.value, rack.value]) : rack;
}

function planMember(
  builder: PlanBuilder,
  member: MemberSubject['member'],
  input: WorkflowInput<PrepareOneShotOptions, AssistantAnalyses>,
): void {
  const subject = memberSubject(builder.state, member);
  if (!subject.ok) {
    builder.refuse(member, subject.failures);
    return;
  }
  const parts = preparation(builder.state, subject.value, input);
  if (!parts.ok) {
    builder.refuse(member, parts.failures);
    return;
  }
  builder.attempt(
    member,
    parts.value.flatMap((part) => part.changes),
    parts.value.flatMap((part) => part.invocations),
    `"${subject.value.name}" is already prepared.`,
  );
}

function plan(input: WorkflowInput<PrepareOneShotOptions, AssistantAnalyses>) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  for (const member of targetMembers(game, input.targets)) {
    if (builder.takes(member)) planMember(builder, member, input);
  }
  return succeed(builder.plan('Prepare one-shots'));
}

export const PREPARE_ONE_SHOT: GuidedWorkflow<PrepareOneShotOptions, AssistantAnalyses> = {
  key: 'prepare-one-shot',
  label: 'Prepare One-Shot',
  defaults,
  analysesFor,
  plan,
};
