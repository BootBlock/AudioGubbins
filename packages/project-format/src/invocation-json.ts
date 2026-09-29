/**
 * Writing and reading a command invocation as a history node stores it
 * (REQ-STOR-021, REQ-EXEC-136.12).
 *
 * An invocation names its command by identifier and carries arguments of text,
 * finite numbers, true, false and null, which is all the command layer lets one
 * hold, so a stored change can be replayed after a reload. Each is bounded, so
 * a hostile document cannot make the reader hold more than the bounds allow.
 */

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import type { InvocationRecord } from './history-record.js';
import { textConverter } from './scalar-reading.js';
import { MAXIMUM_ENTITIES, asKey } from './value-reading.js';

/** The most arguments one invocation carries. */
const MAXIMUM_ARGUMENTS = 1_024;

/**
 * The longest text argument, in UTF-16 code units: sixteen mebibytes of text,
 * room for a command that carries a pasted selection, well within the length a
 * stored history document may be.
 */
const LONGEST_ARGUMENT_TEXT = 2 ** 24;

/**
 * The shape of a command identifier. The same pattern as
 * `@audiogubbins/commands` holds one to, repeated because this package sits
 * below the command layer; the history package converts a stored identifier
 * with the command layer's own check, so a difference between the two would be
 * refused there rather than pass.
 */
const COMMAND_ID_RULE = {
  maximumLength: 128,
  pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u,
  shape: 'a command identifier such as project.rename',
} as const;

const INVOCATION_MEMBERS: ReadonlySet<string> = new Set(['commandId', 'arguments']);

const asCommandId = textConverter(COMMAND_ID_RULE);

/** Writes an invocation. */
export function writeInvocation(invocation: InvocationRecord): JsonObject {
  return presentMembers({
    commandId: invocation.commandId,
    arguments: invocation.arguments === undefined ? undefined : { ...invocation.arguments },
  });
}

const asInvocation: Converter<InvocationRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, INVOCATION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const commandId = required(reading, object, at, 'commandId', asCommandId);
  const invocationArguments = optional(reading, object, at, 'arguments', asArguments);
  if (commandId === undefined) return undefined;
  return {
    commandId,
    ...(invocationArguments === undefined ? {} : { arguments: invocationArguments }),
  };
};

const asInvocationList = listConverter(MAXIMUM_ENTITIES, asInvocation);

/** Reads a list of at least one invocation. */
export const readInvocations: Converter<readonly [InvocationRecord, ...InvocationRecord[]]> = (
  reading,
  value,
  parent,
  key,
) => {
  const list = asInvocationList(reading, value, parent, key);
  if (list === undefined) return undefined;
  const [first, ...rest] = list;
  if (first === undefined) {
    reading.refuse(
      'history.no-invocation',
      'A change holds at least one invocation.',
      pathOf(parent, key),
    );
    return undefined;
  }
  return [first, ...rest];
};

type Argument = string | number | boolean | null;

const asArguments: Converter<Readonly<Record<string, Argument>>> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const names = Object.keys(object);
  if (names.length > MAXIMUM_ARGUMENTS) {
    reading.refuse(
      'schema.too-many-items',
      'The invocation carries more arguments than one may.',
      at,
      { length: names.length, maximum: MAXIMUM_ARGUMENTS },
    );
    return undefined;
  }
  const entries: [string, Argument][] = [];
  let whole = true;
  for (const name of names) {
    const checkedName = asKey(reading, name, at, name);
    const read = required(reading, object, at, name, asArgument);
    if (checkedName === undefined || read === undefined) whole = false;
    else entries.push([checkedName, read.value]);
  }
  return whole ? Object.fromEntries(entries) : undefined;
};

/**
 * Reads one argument, wrapped, because `null` is an argument and a converter
 * gives `undefined` for a value it refused.
 */
const asArgument: Converter<{ readonly value: Argument }> = (reading, value, parent, key) => {
  if (value === null || typeof value === 'boolean') return { value };
  if (typeof value === 'number' && Number.isFinite(value)) return { value };
  if (typeof value === 'string' && value.length <= LONGEST_ARGUMENT_TEXT) return { value };
  reading.refuse(
    'schema.unknown-value',
    'An argument is text of bounded length, a finite number, true, false or null.',
    pathOf(parent, key),
  );
  return undefined;
};
