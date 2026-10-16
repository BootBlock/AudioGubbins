/**
 * The analyses a guided workflow needs (ADR-0105), as the session holds them:
 * for each need its planner states, whether the session's detections or loop
 * analyses answer it for the member as it is now, are running, failed, or have
 * yet to be asked, and the job that asks; and the answers that are current, in
 * the form the planner reads.
 *
 * A need is answered only by an analysis of the member's audio as it is now,
 * by the assistants and settings it names, or of the loop it names: an edit
 * since makes the answer stale, and undoing it makes it current again. The
 * planner refuses a member whose need has no current answer, so nothing is
 * planned from audio that is not what the step will change.
 */

import { ZERO_SAMPLES, type QualityMode } from '@audiogubbins/domain';
import { memberKey, type GroupMember } from '@audiogubbins/game-audio';
import type {
  AnalysisNeed,
  AssistantAnalyses,
  AssistantAnalysis,
  CleanDialogueAnalyses,
  LoopAnalyses,
} from '@audiogubbins/guided-workflows';
import { LOOP_ANALYSIS_VERSION, type LoopAnalysisRequest } from '@audiogubbins/loop-analysis';
import { availabilityOf } from '@audiogubbins/model-packs';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import { detectionIdentity, type Detection } from '../analysis/detection-control.js';
import { workflowLoopOf } from '../analysis/loop-analysing.js';
import type { WorkflowAnalysisJob } from '../analysis/workflow-analysing.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import type { KnownAvailability } from '../ml/model-availability.js';
import { isCurrent } from '../state/loop-analysis-store.js';
import { sameJudging } from './detector-arguments.js';
import type { ShellContext } from './shell-context.js';

/** What the session holds for one need. */
export type NeedStatus =
  | {
      readonly kind: 'current';
      readonly need: AnalysisNeed;
      /** The answer, as the planner reads it. */
      readonly answer: AnsweredNeed;
    }
  | { readonly kind: 'running'; readonly need: AnalysisNeed; readonly name: string }
  | {
      readonly kind: 'to-analyse';
      readonly need: AnalysisNeed;
      readonly job: WorkflowAnalysisJob;
      /** Why its last analysis did not answer, where it failed. */
      readonly failed?: string;
    }
  /** It cannot be analysed as it stands, and why. */
  | { readonly kind: 'unreachable'; readonly need: AnalysisNeed; readonly reason: string };

/** A need's current answer, as the planner reads it. */
type AnsweredNeed =
  | { readonly kind: 'assistants'; readonly analysis: AssistantAnalysis }
  | {
      readonly kind: 'loop';
      readonly answer: LoopAnalyses extends ReadonlyMap<string, infer A> ? A : never;
    };

/** The processor whose model's pack Clean Dialogue asks after. */
const DENOISING_MODEL = 'deepfilternet-3';

/** The sound an editor view opens `member` as, where the session holds it. */
function soundOf(context: ShellContext, member: GroupMember): EditorAsset | undefined {
  return context.assets.find(
    member.kind === 'region' ? regionEntryId(member.region) : assetEntryId(member.asset),
  );
}

function notOpen(member: GroupMember): string {
  return `The ${member.kind} is not open in this session yet; wait for its audio to be found.`;
}

/** Whether `detection` answers `need` of `sound`'s whole audio as it is now, at `quality`. */
function answers(
  detection: Extract<Detection, { readonly kind: 'done' }>,
  need: Extract<AnalysisNeed, { readonly kind: 'assistants' }>,
  sound: EditorAsset,
  quality: QualityMode,
): boolean {
  return (
    detection.identity === detectionIdentity(sound, quality) &&
    detection.scope.whole &&
    detection.scope.range.start === 0 &&
    detection.scope.range.end === sound.length &&
    detection.assistants.join(',') === need.assistants.join(',') &&
    sameJudging(detection.detectors, need.detectors)
  );
}

function assistantsStatus(
  context: ShellContext,
  need: Extract<AnalysisNeed, { readonly kind: 'assistants' }>,
  quality: QualityMode,
): NeedStatus {
  const sound = soundOf(context, need.target);
  if (sound === undefined) return { kind: 'unreachable', need, reason: notOpen(need.target) };
  const { detection } = context;
  const found = detection.of(sound.id);
  if (found?.kind === 'running') return { kind: 'running', need, name: sound.name };
  if (found?.kind === 'done' && answers(found, need, sound, quality)) {
    const analysis: AssistantAnalysis = {
      scope: found.scope,
      assistants: found.assistants,
      detectors: found.detectors,
      reports: found.result.reports,
    };
    return { kind: 'current', need, answer: { kind: 'assistants', analysis } };
  }
  const job: WorkflowAnalysisJob = {
    name: sound.name,
    start: () => {
      detection.detect(
        sound,
        { range: { start: ZERO_SAMPLES, end: sound.length }, whole: true },
        quality,
        need.assistants,
        need.detectors,
      );
    },
    running: () => detection.of(sound.id)?.kind === 'running',
    cancel: () => {
      detection.cancel(sound.id);
    },
  };
  return found?.kind === 'failed' && found.identity === detectionIdentity(sound, quality)
    ? { kind: 'to-analyse', need, job, failed: found.reason }
    : { kind: 'to-analyse', need, job };
}

/** A loop request's every value, written out, so two requests are the same exactly where their texts are. */
function requestText(request: LoopAnalysisRequest): string {
  const { loop, search } = request;
  return JSON.stringify([
    loop.start,
    loop.end,
    loop.crossfadeLength,
    loop.crossfadeShape,
    search?.radiusFrames,
    search?.keepLength,
    search?.candidates,
  ]);
}

function loopStatus(
  context: ShellContext,
  state: ProjectState,
  need: Extract<AnalysisNeed, { readonly kind: 'loop' }>,
  quality: QualityMode,
): NeedStatus {
  const { target } = need;
  if (target.kind !== 'region') {
    return { kind: 'unreachable', need, reason: 'A loop belongs to a region.' };
  }
  const sound = soundOf(context, target);
  if (sound === undefined) return { kind: 'unreachable', need, reason: notOpen(target) };
  const looped = workflowLoopOf(sound, state);
  if (typeof looped === 'string') return { kind: 'unreachable', need, reason: looped };
  const analysing = context.loopAnalysis;
  const record = analysing.analyses.of(target.region);
  if (record?.kind === 'running') return { kind: 'running', need, name: sound.name };
  const asked =
    record !== undefined &&
    isCurrent(record, looped.identity, LOOP_ANALYSIS_VERSION) &&
    requestText(record.request) === requestText(need.request);
  if (asked && record.kind === 'done') {
    return {
      kind: 'current',
      need,
      answer: { kind: 'loop', answer: { request: record.request, analysis: record.analysis } },
    };
  }
  const job: WorkflowAnalysisJob = {
    name: sound.name,
    start: () => {
      analysing.analyse(looped, need.request, quality);
    },
    running: () => analysing.isRunning(target.region),
    cancel: () => {
      analysing.cancel(target.region);
    },
  };
  return asked && record.kind === 'failed'
    ? { kind: 'to-analyse', need, job, failed: record.reason }
    : { kind: 'to-analyse', need, job };
}

/** What the session holds for each of `needs`, of the project as `state` holds it. */
export function needStatuses(
  context: ShellContext,
  state: ProjectState,
  needs: readonly AnalysisNeed[],
): readonly NeedStatus[] {
  const quality = context.audioSettings.get().renderQuality;
  return needs.map((need) =>
    need.kind === 'assistants'
      ? assistantsStatus(context, need, quality)
      : loopStatus(context, state, need, quality),
  );
}

/** The assistants' current answers among `statuses`, by member key. */
export function assistantAnswers(statuses: readonly NeedStatus[]): AssistantAnalyses {
  return new Map(
    statuses.flatMap((status) =>
      status.kind === 'current' && status.answer.kind === 'assistants'
        ? [[memberKey(status.need.target), status.answer.analysis] as const]
        : [],
    ),
  );
}

/** The loop analyses' current answers among `statuses`, by member key. */
export function loopAnswers(statuses: readonly NeedStatus[]): LoopAnalyses {
  return new Map(
    statuses.flatMap((status) =>
      status.kind === 'current' && status.answer.kind === 'loop'
        ? [[memberKey(status.need.target), status.answer.answer] as const]
        : [],
    ),
  );
}

/**
 * Whether this machine has the local denoising model's pack and can run it,
 * as the installer last said: a pack not yet known of is not counted, so a
 * plan never names a model the render may find missing.
 */
export function denoisingModel(
  availability: KnownAvailability,
): CleanDialogueAnalyses['denoisingModel'] {
  const model = PROCESSOR_CATALOGUE.get(DENOISING_MODEL)?.version.model;
  if (availability.kind === 'unknown' || model === undefined) return 'absent';
  const pack = availabilityOf(
    { role: 'processor', typeKey: DENOISING_MODEL, required: true, model },
    availability.context,
  );
  return pack.condition === 'available' || pack.condition === 'update-available'
    ? 'installed'
    : 'absent';
}
