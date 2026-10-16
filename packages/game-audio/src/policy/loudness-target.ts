/**
 * A loudness target (ADR-0101): what a member should measure at, never a
 * processor. A conformance report measures members against it, and the
 * Normalise Game SFX workflow realises it as a slot of a rack; nothing is
 * normalised because a group sets one.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

export interface LoudnessTarget {
  /** The integrated loudness, −70 to 0 LUFS. */
  readonly integratedLufs: number;

  /** How far from the target a measurement may be and conform, 0.1 to 6 LU. */
  readonly toleranceLu: number;

  /** The true peak a member must stay under, −20 to 0 dBTP, where one is set. */
  readonly truePeakCeilingDbtp?: number;
}

const INTEGRATED = { lowest: -70, highest: 0 };
const TOLERANCE = { lowest: 0.1, highest: 6 };
const CEILING = { lowest: -20, highest: 0 };

function within(value: number, range: { readonly lowest: number; readonly highest: number }) {
  return Number.isFinite(value) && value >= range.lowest && value <= range.highest;
}

function invalid(part: keyof LoudnessTarget, sentence: string): DomainFailure {
  return failure('game.loudness-invalid', FailureKind.Rejected, sentence, { details: { part } });
}

/** Every value of `target` out of its range. */
export function loudnessProblems(target: LoudnessTarget): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  if (!within(target.integratedLufs, INTEGRATED)) {
    problems.push(invalid('integratedLufs', 'A loudness target is from −70 to 0 LUFS integrated.'));
  }
  if (!within(target.toleranceLu, TOLERANCE)) {
    problems.push(invalid('toleranceLu', "A loudness target's tolerance is from 0.1 to 6 LU."));
  }
  if (target.truePeakCeilingDbtp !== undefined && !within(target.truePeakCeilingDbtp, CEILING)) {
    problems.push(
      invalid(
        'truePeakCeilingDbtp',
        "A loudness target's true-peak ceiling is from −20 to 0 dBTP.",
      ),
    );
  }
  return problems;
}
