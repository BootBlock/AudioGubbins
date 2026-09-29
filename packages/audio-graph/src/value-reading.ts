/**
 * Reading an untrusted value one field at a time, collecting every problem.
 *
 * A graph descriptor reaches a worker or an AudioWorklet as a structured clone,
 * which the receiving side cannot trust to have the shape its type claims
 * (REQ-EXEC-136.12). Each reader here answers the value it read, or `undefined`
 * having recorded why not, so the descriptor reader can keep going and report
 * every problem at once rather than the first.
 */

import { failure, FailureKind, type DomainFailure } from '@audiogubbins/domain';

/** Where the problems found while reading one value are collected. */
export type Problems = DomainFailure[];

/** A value that is an object with named fields, and not an array. */
export type FieldRecord = Readonly<Record<string, unknown>>;

/**
 * The shape of a port or setting name: lower-case words joined by hyphens, as
 * node identifiers are, so a name survives a message, a log and a file alike.
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Records a problem at a path in the value. */
export function report(
  problems: Problems,
  code: string,
  path: string,
  summary: string,
  cause?: DomainFailure,
): void {
  problems.push(
    failure(`graph.${code}`, FailureKind.Rejected, `${path}: ${summary}`, {
      details: { path },
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}

/** Whether a value is an object with named fields. */
function isFieldRecord(value: unknown): value is FieldRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is an array, whose elements are as yet unread. */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Reads an object with named fields. */
export function readRecord(
  value: unknown,
  path: string,
  problems: Problems,
): FieldRecord | undefined {
  if (isFieldRecord(value)) return value;
  report(problems, 'shape-invalid', path, 'expected an object with named fields.');
  return undefined;
}

/** Reads an array, each of whose elements the caller reads in turn. */
function readArray(
  value: unknown,
  path: string,
  problems: Problems,
): readonly unknown[] | undefined {
  if (isArray(value)) return value;
  report(problems, 'shape-invalid', path, 'expected an array.');
  return undefined;
}

/** Reads a string that is not empty. */
export function readText(value: unknown, path: string, problems: Problems): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  report(problems, 'shape-invalid', path, 'expected a string that is not empty.');
  return undefined;
}

/** Reads the name of a port or a setting. */
export function readName(value: unknown, path: string, problems: Problems): string | undefined {
  if (typeof value === 'string' && NAME_PATTERN.test(value)) return value;
  report(
    problems,
    'name-invalid',
    path,
    'a port or setting name is lower-case letters, digits and hyphens, starting with a letter.',
  );
  return undefined;
}

/** Reads a number that is finite. */
export function readFiniteNumber(
  value: unknown,
  path: string,
  problems: Problems,
): number | undefined {
  if (typeof value !== 'number') {
    report(problems, 'shape-invalid', path, 'expected a number.');
    return undefined;
  }
  if (Number.isFinite(value)) return value;
  report(problems, 'number-not-finite', path, 'a number here must be finite.');
  return undefined;
}

/**
 * Reads every element of an array with one reader, answering the elements
 * only when all of them were read.
 */
export function readEach<TValue>(
  value: unknown,
  path: string,
  problems: Problems,
  readElement: (element: unknown, elementPath: string) => TValue | undefined,
): readonly TValue[] | undefined {
  const elements = readArray(value, path, problems);
  if (elements === undefined) return undefined;
  const read: TValue[] = [];
  let complete = true;
  for (const [index, element] of elements.entries()) {
    const one = readElement(element, `${path}[${String(index)}]`);
    if (one === undefined) complete = false;
    else read.push(one);
  }
  return complete ? read : undefined;
}
