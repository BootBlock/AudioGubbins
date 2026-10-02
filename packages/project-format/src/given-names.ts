/**
 * The one rule for the name a person gives a project or an asset
 * (REQ-PROD-056), wherever such a name is made, set, carried in or read.
 *
 * A name given is trimmed and must hold something a reader sees: one of
 * nothing but space and code points that draw nothing reads as blank, by the
 * rule every name a reader is shown is held to (`asName` in the text package).
 * A name as written, set by undo or read from a document, keeps the space
 * around it, since undo gives a state back as it was (REQ-STOR-101), and is
 * held to the same rule, so no state undo restores is one a person could not
 * have named. Either is bounded by {@link LONGEST_NAME}, in the code units the
 * document holds every name to.
 *
 * The rule is kept beside the document because every package that makes or
 * reads such a name depends on this one: the commands, the storage that
 * makes, forks and brings in a project, and the application.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { asName, asWrittenName, type NameProblem } from '@audiogubbins/text';

import { pathOf, type Converter } from './document-reading.js';
import { textConverter } from './scalar-reading.js';
import { LONGEST_NAME } from './value-reading.js';

/** What a name is the name of, which its refusal codes begin with. */
export type NamedSubject = 'project' | 'asset';

/** The refusal of a name by the part of the rule that refused it. */
function refusal(subject: NamedSubject, problem: NameProblem): DomainFailure {
  return problem.kind === 'blank'
    ? failure(`${subject}.name-blank`, FailureKind.Rejected, `A ${subject} needs a name.`)
    : failure(
        `${subject}.name-too-long`,
        FailureKind.Rejected,
        `A ${subject} name can be at most ${String(LONGEST_NAME)} characters long.`,
      );
}

/**
 * A name the text rule took, held to the document's bound in code units too:
 * the text rule counts the characters a reader sees, of which a name has no
 * more than code units, so a name within this bound is within that one.
 */
function bounded(subject: NamedSubject, name: string | NameProblem): DomainResult<string> {
  if (typeof name !== 'string') return fail(refusal(subject, name));
  return name.length > LONGEST_NAME ? fail(refusal(subject, { kind: 'too-long' })) : succeed(name);
}

/** `value` as a name a person gave, trimmed, or why it cannot be one. */
export function givenName(subject: NamedSubject, value: unknown): DomainResult<string> {
  return bounded(subject, asName(value, LONGEST_NAME));
}

/** `value` as a name exactly as written, or why it cannot be one. */
export function writtenName(subject: NamedSubject, value: unknown): DomainResult<string> {
  return bounded(subject, asWrittenName(value, LONGEST_NAME));
}

/**
 * A converter that reads a written name of `subject`: a value that is not text
 * is refused as the schema's, and text the rule refuses by the rule's codes.
 */
function nameConverter(subject: NamedSubject): Converter<string> {
  const asText = textConverter({ maximumLength: Number.MAX_SAFE_INTEGER });
  return (reading, value, parent, key) => {
    const text = asText(reading, value, parent, key);
    if (text === undefined) return undefined;
    const name = writtenName(subject, text);
    if (name.ok) return name.value;
    reading.refuseAll(name.failures, pathOf(parent, key));
    return undefined;
  };
}

/** Reads a project's name from a document, a header or a tree. */
export const asProjectName = nameConverter('project');

/** Reads an asset's name from a document. */
export const asAssetName = nameConverter('asset');
