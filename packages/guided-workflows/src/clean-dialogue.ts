/**
 * Clean Dialogue (ADR-0062, ADR-0105): a member's rack extended, as applying
 * an assistant's recommendation extends one, with what the restoration and
 * repair assistants recommend, the built-in Dialogue chain's treatment and
 * the dialogue loudness last.
 *
 * The recommended steps come first, each with the state it learned: an offset
 * and hum before clicks, and the noise last of them, so its profile is the
 * noise alone. Where the person has the local denoising model's pack, the
 * model takes the noise in place of the noise reduction learned from the
 * noise floor. Then the Dialogue chain's high-pass, de-esser and compressor,
 * and a loudness normalisation to the member's effective target, or the
 * Dialogue chain's own −23 LUFS where none is set.
 */

import {
  FindingKind,
  succeed,
  type DomainResult,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { learnedStates, type AssistantReport } from '@audiogubbins/detection-runtime';
import { resolvePolicy } from '@audiogubbins/game-audio';
import { CLICK_DETECTOR, DC_OFFSET_DETECTOR } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import {
  analysisFor,
  assistantRunning,
  reportOf,
  type AssistantAnalyses,
} from './assistant-analyses.js';
import type {
  AnalysisNeed,
  GuidedWorkflow,
  WorkflowInput,
  WorkflowOptions,
  WorkflowTarget,
} from './guided-workflow.js';
import { builtInChainFor, loudnessStep, processorsOf, type LearnedStep } from './level-slots.js';
import { PlanBuilder } from './plan-builder.js';
import type { ChainProcessing } from './chain-ending.js';
import { placedChange, type Placement } from './processing-placement.js';
import {
  gameOf,
  memberSubject,
  targetMembers,
  targetsProblem,
  type MemberSubject,
} from './workflow-subjects.js';

export interface CleanDialogueOptions {
  /** Where a member that inherits its group's processing is cleaned. */
  readonly placement: Placement;
}

export interface CleanDialogueAnalyses {
  /** The restoration and repair assistants' answers, by member key. */
  readonly assistants: AssistantAnalyses;
  /** Whether the local denoising model's pack is installed on this machine. */
  readonly denoisingModel: 'installed' | 'absent';
}

type Input = WorkflowInput<CleanDialogueOptions, CleanDialogueAnalyses>;

const RESTORATION = assistantRunning(DC_OFFSET_DETECTOR);
const REPAIR = assistantRunning(CLICK_DETECTOR);

/** The local denoising model's processor, which runs where its pack is installed. */
const DENOISING_MODEL = 'deepfilternet-3';

/** The integrated loudness the built-in Dialogue chain normalises to, by which it is found. */
const DIALOGUE_LUFS = -23;

function defaults(): WorkflowOptions<CleanDialogueOptions> {
  return { placement: { value: 'member', source: { kind: 'workflow' } } };
}

function need(
  member: MemberSubject['member'],
): Extract<AnalysisNeed, { readonly kind: 'assistants' }> {
  return { kind: 'assistants', target: member, assistants: [RESTORATION, REPAIR], detectors: {} };
}

function analysesFor(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): readonly AnalysisNeed[] {
  return targetMembers(gameOf(state), targets).map(need);
}

/** `report`'s steps with the state each learned, or why one could not learn it. */
function learnedSteps(report: AssistantReport): DomainResult<readonly LearnedStep[]> {
  const states = learnedStates(report);
  if (!states.ok) return states;
  return succeed(
    report.recommendation.steps.map((step, index) => ({ step, state: states.value[index] })),
  );
}

/** The types of the steps `report` recommends for the noise it found. */
function noiseTreatments(report: AssistantReport): ReadonlySet<string> {
  return new Set(
    report.recommendation.findings.flatMap((finding) =>
      finding.kind === FindingKind.Noise && finding.treatment.kind === 'steps'
        ? finding.treatment.steps.map((step) => step.typeKey)
        : [],
    ),
  );
}

/** The recommended steps in the order they are applied, the noise last, by the model where installed. */
function recommendedSteps(
  restoration: AssistantReport,
  repair: AssistantReport,
  model: CleanDialogueAnalyses['denoisingModel'],
): DomainResult<readonly LearnedStep[]> {
  const restored = learnedSteps(restoration);
  if (!restored.ok) return restored;
  const repaired = learnedSteps(repair);
  if (!repaired.ok) return repaired;
  const noise = noiseTreatments(restoration);
  const denoising = restored.value.filter((one) => noise.has(one.step.typeKey));
  const others = restored.value.filter((one) => !noise.has(one.step.typeKey));
  const denoise: readonly LearnedStep[] =
    model === 'installed' && denoising.length > 0
      ? [{ step: { typeKey: DENOISING_MODEL, values: {} }, state: undefined }]
      : denoising;
  return succeed([...others, ...repaired.value, ...denoise]);
}

/** The built-in Dialogue chain, copied: a fault in this build where it is missing. */
function dialogueChain(input: Input): readonly ProcessorInstance[] {
  const chain = builtInChainFor(DIALOGUE_LUFS, input.catalogue, input.ids);
  if (chain === undefined)
    throw new Error('The processing library has no built-in Dialogue chain.');
  return chain.slots.flatMap((slot) => (slot.kind === 'processor' ? [slot] : []));
}

/** What cleaning `subject` puts at the end of its processing, or why it cannot be made. */
function cleaning(
  state: ProjectState,
  subject: MemberSubject,
  input: Input,
): DomainResult<ChainProcessing> {
  const analysis = analysisFor(input.analyses.assistants, need(subject.member), subject);
  if (!analysis.ok) return analysis;
  const { reports } = analysis.value;
  const steps = recommendedSteps(
    reportOf(reports, RESTORATION),
    reportOf(reports, REPAIR),
    input.analyses.denoisingModel,
  );
  const made = steps.ok ? processorsOf(steps.value, input.catalogue, input.ids) : steps;
  if (!made.ok) return made;
  const dialogue = dialogueChain(input);
  const target = resolvePolicy(state.project, gameOf(state), subject.member).loudness.value;
  const level =
    target === undefined
      ? succeed(dialogue.slice(-1))
      : processorsOf(
          [{ step: loudnessStep(target), state: undefined }],
          input.catalogue,
          input.ids,
        );
  if (!level.ok) return level;
  return succeed({
    treatments: [...made.value, ...dialogue.slice(0, -1)],
    level: level.value[0],
  });
}

function planMember(builder: PlanBuilder, member: MemberSubject['member'], input: Input): void {
  const { state } = builder;
  const subject = memberSubject(state, member);
  if (!subject.ok) {
    builder.refuse(member, subject.failures);
    return;
  }
  const processing = cleaning(state, subject.value, input);
  if (!processing.ok) {
    builder.refuse(member, processing.failures);
    return;
  }
  const change = placedChange(
    state,
    subject.value,
    processing.value,
    input.options.placement,
    input.catalogue,
    input.ids,
  );
  builder.attempt(
    member,
    change.changes,
    change.invocations,
    `"${subject.value.name}" already ends with this treatment.`,
  );
}

function plan(input: Input) {
  const game = gameOf(input.state);
  const problem = targetsProblem(game, input.targets);
  if (problem !== undefined) return problem;
  const builder = new PlanBuilder(input.state, input.catalogue, input.leftOut);
  for (const member of targetMembers(game, input.targets)) {
    if (builder.takes(member)) planMember(builder, member, input);
  }
  return succeed(builder.plan('Clean dialogue'));
}

export const CLEAN_DIALOGUE: GuidedWorkflow<CleanDialogueOptions, CleanDialogueAnalyses> = {
  key: 'clean-dialogue',
  label: 'Clean Dialogue',
  defaults,
  analysesFor,
  plan,
};
