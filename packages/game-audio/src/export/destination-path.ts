/**
 * Where a group's files go (ADR-0102): a relative folder path inside the
 * folder the person exports to, 0 to 16 segments, each a name every common
 * file system takes as it is.
 *
 * A segment is refused, never repaired: a path that `safeFolderName` would
 * change would deliver somewhere other than the person wrote. `.` and `..`
 * are refused, so a path never leaves the folder it is inside. A path with
 * tokens is a folder template, a later phase's (`REQ-GODOT-119`).
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { folderSegmentProblem } from '@audiogubbins/import-export';

export interface DestinationPath {
  /** The folders from the export's folder down, outermost first; none is that folder itself. */
  readonly segments: readonly string[];
}

/** The most folders a destination descends. */
const LONGEST_DESTINATION = 16;

function invalid(
  sentence: string,
  details: Readonly<Record<string, string | number>>,
): DomainFailure {
  return failure('game.destination-invalid', FailureKind.Rejected, sentence, { details });
}

function segmentProblem(segment: string, index: number): DomainFailure | undefined {
  const problem = folderSegmentProblem(segment);
  if (problem === undefined) return undefined;
  if (problem.kind === 'steps-out') {
    return invalid(
      `The destination's folder "${segment}" would step out of the folder it is in; name a folder.`,
      { index },
    );
  }
  return invalid(
    `The destination's folder "${segment}" is not a name every file system takes; "${problem.safe}" is.`,
    { index, safe: problem.safe },
  );
}

/** The destination `segments` name, or every reason it is not one. */
export function destinationPath(segments: readonly string[]): DomainResult<DestinationPath> {
  const problems: DomainFailure[] = [];
  if (segments.length > LONGEST_DESTINATION) {
    problems.push(
      invalid(
        `A destination descends at most ${String(LONGEST_DESTINATION)} folders; this one descends ${String(segments.length)}.`,
        { segments: segments.length },
      ),
    );
  }
  segments.forEach((segment, index) => {
    const problem = segmentProblem(segment, index);
    if (problem !== undefined) problems.push(problem);
  });
  const [first, ...rest] = problems;
  return first === undefined ? succeed({ segments }) : fail(first, ...rest);
}
