/**
 * The rule for a name a project command sets, on a project or an asset
 * (REQ-PROD-056).
 *
 * A name a person types is trimmed and must say something. A name restored by
 * undo is taken exactly as it was, whatever it holds, because the project may
 * have come from a document that named it so, and undo must give that state
 * back rather than a tidier one (REQ-STOR-101). Either is bounded by the
 * project document's own bound on a name, {@link LONGEST_NAME}, so a command
 * never sets a name the document would refuse.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { LONGEST_NAME } from '@audiogubbins/project-format';

/** What a name is the name of, which its refusal codes begin with. */
export type NamedSubject = 'project' | 'asset';

/** A rule a name is read by: {@link typedName} or {@link heldName}. */
export type NameRule = (subject: NamedSubject, text: string) => DomainResult<string>;

/** A name exactly as given, or why the project document cannot hold it. */
export const heldName: NameRule = (subject, text) =>
  text.length <= LONGEST_NAME
    ? succeed(text)
    : fail(
        failure(
          `${subject}.name-too-long`,
          FailureKind.Rejected,
          `A ${subject} name can be at most ${String(LONGEST_NAME)} characters long.`,
        ),
      );

/** A name a person gave, trimmed, or why it cannot be one. */
export const typedName: NameRule = (subject, text) => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return fail(
      failure(`${subject}.name-blank`, FailureKind.Rejected, `A ${subject} name cannot be blank.`),
    );
  }
  return heldName(subject, trimmed);
};
