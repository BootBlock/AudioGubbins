/**
 * The assistants' answers a workflow plans from (ADR-0062, ADR-0105), and the
 * rule that an answer is the one its need asked for: of the same assistants,
 * judging by the same values, over the whole member as it is now. An answer
 * of other settings, or of a member changed since, is refused rather than
 * planned from, so nothing is applied that the audio as it is would not give.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DetectorValues,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { AssistantReport, DetectionScope } from '@audiogubbins/detection-runtime';
import { memberKey } from '@audiogubbins/game-audio';
import { CANONICAL_ASSISTANTS, type AudioDetector } from '@audiogubbins/processors';

import type { AnalysisNeed } from './guided-workflow.js';
import { spanLength, type MemberSubject } from './workflow-subjects.js';

/** What the assistants answered for one member. */
export interface AssistantAnalysis {
  /** What was read, on the member's own timeline. */
  readonly scope: DetectionScope;
  /** The assistants' keys, in the order asked. */
  readonly assistants: readonly string[];
  readonly detectors: DetectorValues;
  /** Each assistant's report, in the order asked. */
  readonly reports: readonly AssistantReport[];
}

/** The assistants' answers, by the member's key (`memberKey`). */
export type AssistantAnalyses = ReadonlyMap<string, AssistantAnalysis>;

/** The key of the assistant that runs `detector`: a fault in this build where none does. */
export function assistantRunning(detector: AudioDetector): string {
  const assistant = CANONICAL_ASSISTANTS.find((one) => one.detectors.includes(detector));
  if (assistant === undefined) {
    throw new Error(`No assistant runs the ${detector.identity.key} detector.`);
  }
  return assistant.key;
}

function stale(subject: MemberSubject, summary: string): DomainFailure {
  return failure('workflow.analysis-stale', FailureKind.Rejected, summary, {
    details: { member: memberKey(subject.member) },
  });
}

function sameValues(left: DetectorValues, right: DetectorValues): boolean {
  const keys = (values: Readonly<Record<string, unknown>>): string =>
    Object.keys(values).toSorted().join(',');
  if (keys(left) !== keys(right)) return false;
  return Object.entries(left).every(([detector, values]) => {
    const other = right[detector];
    return (
      other !== undefined &&
      keys(values) === keys(other) &&
      Object.entries(values).every(([key, value]) => other[key] === value)
    );
  });
}

/**
 * The reports `need` asked for of `subject`, by assistant key, or why the
 * answer given cannot be planned from: none was given, or it is of other
 * assistants, other settings, or another span than the member's whole audio
 * as it is now.
 */
export function analysisFor(
  analyses: AssistantAnalyses,
  need: Extract<AnalysisNeed, { readonly kind: 'assistants' }>,
  subject: MemberSubject,
): DomainResult<{
  readonly scope: DetectionScope;
  readonly reports: ReadonlyMap<string, AssistantReport>;
}> {
  const analysis = analyses.get(memberKey(subject.member));
  if (analysis === undefined) {
    return fail(
      failure(
        'workflow.analysis-missing',
        FailureKind.Rejected,
        `"${subject.name}" has not been analysed yet; analyse it first.`,
        { details: { member: memberKey(subject.member) } },
      ),
    );
  }
  const { scope } = analysis;
  if (
    analysis.assistants.join(',') !== need.assistants.join(',') ||
    !sameValues(analysis.detectors, need.detectors)
  ) {
    return fail(
      stale(subject, `"${subject.name}" was analysed at other settings; analyse it again.`),
    );
  }
  if (!scope.whole || scope.range.start !== 0 || scope.range.end !== spanLength(subject.span)) {
    return fail(
      stale(subject, `"${subject.name}" has changed since it was analysed; analyse it again.`),
    );
  }
  const reports = new Map(
    need.assistants.flatMap((key, index) => {
      const report = analysis.reports[index];
      return report?.recommendation.assistant === key ? [[key, report] as const] : [];
    }),
  );
  if (reports.size !== need.assistants.length) {
    return fail(
      stale(subject, `The analysis of "${subject.name}" is incomplete; analyse it again.`),
    );
  }
  return succeed({ scope, reports });
}

/** The report of the assistant keyed `key` among `reports`: present wherever `analysisFor` succeeded for it. */
export function reportOf(
  reports: ReadonlyMap<string, AssistantReport>,
  key: string,
): AssistantReport {
  const report = reports.get(key);
  if (report === undefined)
    throw new Error(`The analysis holds no report of the ${key} assistant.`);
  return report;
}
