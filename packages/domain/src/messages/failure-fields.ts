/**
 * Reading a failure that crossed into another global scope, as the one reader
 * of a message's fields reads every other value: its code and summary where a
 * receiver only shows it, or the whole failure, its details and the failure
 * it arose from, where the receiver acts on it.
 */

import { FailureKind, failure, type DomainFailure } from '../result.js';
import {
  Malformed,
  fieldsAt,
  fieldsOf,
  itemsAt,
  oneOf,
  textAt,
  type MessageFields,
} from './message-fields.js';

/**
 * A failure as a message carries it where the receiver shows it and acts on
 * nothing else: its code and summary.
 */
export interface FailureSummary {
  readonly code: string;
  readonly summary: string;
}

/** The code and summary of the failure `fields` holds. */
export function failureSummaryOf(fields: MessageFields): FailureSummary {
  return { code: textAt(fields, 'code'), summary: textAt(fields, 'summary') };
}

/** A failure's code and summary. */
export function failureSummaryAt(fields: MessageFields, field: string): FailureSummary {
  return failureSummaryOf(fieldsAt(fields, field));
}

/** A failure's code and summary, or `undefined` where the field is absent. */
export function optionalFailureSummaryAt(
  fields: MessageFields,
  field: string,
): FailureSummary | undefined {
  return fields[field] === undefined ? undefined : failureSummaryAt(fields, field);
}

/** A failure's details: named text, numbers and flags. */
function detailsOf(fields: MessageFields, name: string): DomainFailure['details'] {
  if (fields['details'] === undefined) return undefined;
  const details = fieldsOf(fields['details'], `${name}.details`);
  const read: Record<string, string | number | boolean> = {};
  for (const [key, one] of Object.entries(details)) {
    if (typeof one !== 'string' && typeof one !== 'number' && typeof one !== 'boolean') {
      throw new Malformed(`${name}.details.${key}`, 'text, a number or a flag');
    }
    read[key] = one;
  }
  return read;
}

/** A whole failure as the domain states it, with the failure it arose from, if any. */
function domainFailureOf(value: unknown, name: string): DomainFailure {
  const fields = fieldsOf(value, name);
  const details = detailsOf(fields, name);
  const cause =
    fields['cause'] === undefined ? undefined : domainFailureOf(fields['cause'], `${name}.cause`);
  return failure(
    textAt(fields, 'code'),
    oneOf(fields, 'kind', FailureKind),
    textAt(fields, 'summary'),
    {
      ...(details === undefined ? {} : { details }),
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

/** Whole failures, at least one. */
export function domainFailuresAt(
  fields: MessageFields,
  field: string,
): readonly [DomainFailure, ...DomainFailure[]] {
  const [first, ...rest] = itemsAt(fields, field, domainFailureOf);
  if (first === undefined) throw new Malformed(field, 'a list of at least one');
  return [first, ...rest];
}
