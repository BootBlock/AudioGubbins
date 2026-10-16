/**
 * What applying an assistant's report reads of it (ADR-0062): how a
 * recommendation found over a scope is placed, the silence it would take out,
 * and the state each of its steps learned. The Analysis panel, the analysis
 * commands and the guided workflows' planners all read a report by these
 * rules, stated once beside the report they read, so what the panel offers is
 * what a command or a workflow applies.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type EditRange,
  type ProcessorState,
} from '@audiogubbins/domain';

import type { AssistantReport } from './detection-result.js';

/** What a detection reads of a target's audio: a range of it, and whether that is all of it. */
export interface DetectionScope {
  /** On the target's timeline. */
  readonly range: EditRange;
  readonly whole: boolean;
}

/**
 * How a recommendation found over `scope` is applied, the one rule both what
 * its steps learn from and how it is applied follow: over a range, as a rack
 * edit, which reads the target before its racks; over the whole target, as
 * its rack, after a copy of the rack it has, so it hears the audio heard.
 */
export function treatmentPlacement(scope: DetectionScope): 'range' | 'rack' {
  return scope.whole ? 'rack' : 'range';
}

/** Which of the silence found is taken out: at the edges of what was analysed, within it, or both. */
export const SILENCE_PARTS = ['edges', 'within', 'both'] as const;

/** Which of the silence found is taken out. */
export type SilencePart = (typeof SILENCE_PARTS)[number];

/**
 * The stretches `report` would take out over `scope` that are `part` of the
 * silence: one at the start or end of what was analysed is at an edge, and
 * any other within.
 */
export function silenceRemovals(
  report: AssistantReport,
  scope: DetectionScope,
  part: SilencePart,
): readonly EditRange[] {
  const atAnEdge = (range: EditRange): boolean =>
    range.start === scope.range.start || range.end === scope.range.end;
  return report.recommendation.removals.filter(
    (range) => part === 'both' || atAnEdge(range) === (part === 'edges'),
  );
}

/**
 * The state each of `report`'s steps learned, in their order, `undefined` for
 * a step whose processor reads none; or, where a step needed state it could
 * not learn, why, since its recommendation cannot then be applied.
 */
export function learnedStates(
  report: AssistantReport,
): DomainResult<readonly (ProcessorState | undefined)[]> {
  const states: (ProcessorState | undefined)[] = [];
  for (const learned of report.learned) {
    if (learned.kind === 'refused') {
      return fail(failure('detection.state-not-learned', FailureKind.Rejected, learned.reason));
    }
    states.push(learned.kind === 'learned' ? learned.state : undefined);
  }
  return succeed(states);
}
