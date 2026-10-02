/**
 * Reading a parsed JSON document into typed values, reporting every problem.
 *
 * REQ-EXEC-136.12 requires runtime validation of project files and bundles,
 * because TypeScript has no opinion about a file someone else wrote. Every
 * document of the format is read through these helpers, so each refuses the
 * same way: a stable code, the kind `integrity-violation`, and `details.at`, a
 * path such as `project.clips[3].trackId`.
 *
 * Every problem is reported rather than the first, so a damaged file says
 * everything that is wrong with it at once, up to a bound that keeps one bad
 * file from flooding a log. A refusal never quotes a value the document holds:
 * a name or a path in a project is the user's (REQ-PRIV-165), and a value may
 * be any size. It says where the value is and what was expected of it.
 *
 * A member this build does not know is refused rather than ignored. Before 1.0
 * a document with a member this schema lacks is from another schema version,
 * and ignoring the member would lose it the next time the project is saved.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  isJsonArray,
  isJsonObject,
  memberOf,
  type JsonArray,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';

/** The most problems one reading reports before it only counts them. */
const MAXIMUM_REPORTED_PROBLEMS = 100;

/** The longest part of an unknown member's key a refusal names. */
const LONGEST_NAMED_KEY = 32;

/** Structured context a refusal carries beside its path. */
export type ProblemDetails = Readonly<Record<string, string | number | boolean>>;

/** The problems found reading one document. */
export interface Reading {
  /** Records a problem with the value at `at`. */
  refuse(code: string, summary: string, at: string, details?: ProblemDetails): void;

  /**
   * Records the failures of a domain constructor for the value at `at`, as
   * integrity violations there, each keeping the domain's code and failure.
   */
  refuseAll(failures: readonly DomainFailure[], at: string): void;

  /**
   * The document's value, or every problem found. A reader that returns nothing
   * must have refused something, so a clean reading with no value is a
   * programmer error and throws.
   */
  outcome<TValue>(value: TValue | undefined): DomainResult<TValue>;
}

/**
 * Reads one value found at `at`, or returns `undefined` having refused it. The
 * path is built only when something is refused, so a document of a million
 * entities is not a million paths.
 */
export type Converter<TValue> = (
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
) => TValue | undefined;

/** Starts reading a document. */
export function startReading(): Reading {
  const failures: DomainFailure[] = [];
  let omitted = 0;

  const record = (problem: DomainFailure): void => {
    if (failures.length < MAXIMUM_REPORTED_PROBLEMS) failures.push(problem);
    else omitted += 1;
  };

  return {
    refuse(code, summary, at, details = {}) {
      record(
        failure(code, FailureKind.IntegrityViolation, summary, { details: { ...details, at } }),
      );
    },

    refuseAll(problems, at) {
      for (const problem of problems) {
        record(
          failure(problem.code, FailureKind.IntegrityViolation, problem.summary, {
            details: { at },
            cause: problem,
          }),
        );
      }
    },

    outcome: (value) => outcomeOf(failures, omitted, value),
  };
}

/** The value read, or the problems recorded and a count of any past the bound. */
function outcomeOf<TValue>(
  failures: readonly DomainFailure[],
  omitted: number,
  value: TValue | undefined,
): DomainResult<TValue> {
  const [first, ...rest] = failures;
  if (first !== undefined) {
    if (omitted > 0) {
      rest.push(
        failure(
          'schema.further-problems',
          FailureKind.IntegrityViolation,
          'More problems were found than are listed.',
          { details: { omitted } },
        ),
      );
    }
    return fail(first, ...rest);
  }
  if (value === undefined) {
    throw new Error('A document reader returned no value and recorded no problem.');
  }
  return succeed(value);
}

/** The path of `key` inside the value at `parent`. */
export function pathOf(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${String(key)}]`;
  return parent === '' ? key : `${parent}.${key}`;
}

/** Reads a member that must be present. */
export function required<TValue>(
  reading: Reading,
  object: JsonObject,
  at: string,
  key: string,
  convert: Converter<TValue>,
): TValue | undefined {
  const value = memberOf(object, key);
  if (value === undefined) {
    reading.refuse('schema.missing-member', `The member "${key}" is required.`, pathOf(at, key));
    return undefined;
  }
  return convert(reading, value, at, key);
}

/** Reads a member that may be absent, which gives `undefined` without a problem. */
export function optional<TValue>(
  reading: Reading,
  object: JsonObject,
  at: string,
  key: string,
  convert: Converter<TValue>,
): TValue | undefined {
  const value = memberOf(object, key);
  return value === undefined ? undefined : convert(reading, value, at, key);
}

/** Reads an object, refusing any member not among `members`. */
export function objectOf(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  members: ReadonlySet<string>,
): JsonObject | undefined {
  const object = anyObjectOf(reading, value, parent, key);
  if (object !== undefined) checkMembers(reading, object, pathOf(parent, key), members);
  return object;
}

/**
 * Reads an object whose members depend on one of them, such as a union's
 * `kind`. The caller checks its members with {@link checkMembers} once it knows
 * which set applies.
 */
export function anyObjectOf(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
): JsonObject | undefined {
  if (isJsonObject(value)) return value;
  reading.refuse('schema.not-an-object', 'An object is expected here.', pathOf(parent, key));
  return undefined;
}

/** Refuses each member of the object at `at` that is not among `members`. */
export function checkMembers(
  reading: Reading,
  object: JsonObject,
  at: string,
  members: ReadonlySet<string>,
): void {
  for (const name of Object.keys(object)) {
    if (!members.has(name)) {
      reading.refuse(
        'schema.unknown-member',
        'The object has a member this schema does not define.',
        at,
        {
          member: name.slice(0, LONGEST_NAMED_KEY),
        },
      );
    }
  }
}

/** Reads an array of at most `maximum` items. */
export function listOf(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  maximum: number,
): JsonArray | undefined {
  if (!isJsonArray(value)) {
    reading.refuse('schema.not-an-array', 'An array is expected here.', pathOf(parent, key));
    return undefined;
  }
  if (value.length > maximum) {
    reading.refuse(
      'schema.too-many-items',
      'The array holds more items than this document may.',
      pathOf(parent, key),
      {
        length: value.length,
        maximum,
      },
    );
    return undefined;
  }
  return value;
}

/** A converter reading each item of an array of at most `maximum` with `item`. */
export function listConverter<TValue>(
  maximum: number,
  item: Converter<TValue>,
): Converter<readonly TValue[]> {
  return (reading, value, parent, key) => {
    const list = listOf(reading, value, parent, key, maximum);
    if (list === undefined) return undefined;
    const at = pathOf(parent, key);
    const items: TValue[] = [];
    let whole = true;
    for (const [index, entry] of list.entries()) {
      const read = item(reading, entry, at, index);
      if (read === undefined) whole = false;
      else items.push(read);
    }
    return whole ? items : undefined;
  };
}

/**
 * Reads a list of entities into a map by identifier, refusing a second entity
 * with an identifier already read. Entities may appear in any order.
 */
export function entitiesOf<TEntity extends { readonly id: string }>(
  reading: Reading,
  object: JsonObject,
  at: string,
  key: string,
  maximum: number,
  entity: Converter<TEntity>,
): ReadonlyMap<TEntity['id'], TEntity> | undefined {
  const list = required(reading, object, at, key, (inner, value, parent, name) =>
    listOf(inner, value, parent, name, maximum),
  );
  if (list === undefined) return undefined;

  const listAt = pathOf(at, key);
  const entities = new Map<TEntity['id'], TEntity>();
  for (const [index, value] of list.entries()) {
    const read = entity(reading, value, listAt, index);
    if (read === undefined) continue;
    if (entities.has(read.id)) {
      reading.refuse(
        'schema.duplicate-id',
        'Another entity in this list has the same identifier.',
        pathOf(listAt, index),
      );
      continue;
    }
    entities.set(read.id, read);
  }
  return entities;
}
