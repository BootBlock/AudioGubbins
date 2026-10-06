/**
 * Reading a message that crossed into another global scope, one field at a
 * time.
 *
 * A message between the page and the inference worker arrives as a structured
 * clone, which the receiver cannot trust to have the shape its type claims
 * (REQ-EXEC-136.12). Each reader throws {@link Malformed} at the first wrong
 * field, caught once by {@link readMessage} and turned into a failure that
 * names the field: a message is small and wrong as a whole, so its first
 * problem is the one to report.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

/** A field of a received message that is not what the protocol says. */
export class Malformed extends Error {
  constructor(field: string, expected: string) {
    super(`The message's ${field} is not ${expected}.`);
    this.name = 'Malformed';
  }
}

/** A received value, read one field at a time. */
export type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as an object with named fields. */
export function fieldsOf(value: unknown, field: string): Fields {
  if (!isFields(value)) throw new Malformed(field, 'an object with named fields');
  return value;
}

export function textAt(fields: Fields, field: string): string {
  const value = fields[field];
  if (typeof value !== 'string') throw new Malformed(field, 'text');
  return value;
}

export function flagAt(fields: Fields, field: string): boolean {
  const value = fields[field];
  if (typeof value !== 'boolean') throw new Malformed(field, 'true or false');
  return value;
}

/** A whole number, zero or more. */
export function countAt(fields: Fields, field: string): number {
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Malformed(field, 'a whole number, zero or more');
  }
  return value;
}

/** One of the values of a const object, such as a message's `kind`. */
export function oneOf<TValue extends string>(
  fields: Fields,
  field: string,
  values: Readonly<Record<string, TValue>>,
): TValue {
  const value = fields[field];
  const found = Object.values(values).find((one) => one === value);
  if (found === undefined) {
    throw new Malformed(field, `one of ${Object.values(values).join(', ')}`);
  }
  return found;
}

/** The elements of a list, each read by `read` with the name of its place. */
export function itemsAt<TItem>(
  fields: Fields,
  field: string,
  read: (item: unknown, name: string) => TItem,
): readonly TItem[] {
  const value: unknown = fields[field];
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((item: unknown, index) => read(item, `${field}[${String(index)}]`));
}

/**
 * Whether a value is of a built-in class, by its tag. A structured clone is
 * made in the receiving realm, which need not be the one this module was
 * loaded in, so `instanceof` could refuse a value that is what it claims.
 */
function taggedAs(value: unknown, tag: string): boolean {
  return Object.prototype.toString.call(value) === `[object ${tag}]`;
}

/** Whether a typed array's memory is its own rather than shared, so it can be moved. */
function ownsMemory(value: { readonly buffer: unknown }): boolean {
  return taggedAs(value.buffer, 'ArrayBuffer');
}

function isFloats(value: unknown): value is Float32Array<ArrayBuffer> {
  return (
    taggedAs(value, 'Float32Array') &&
    typeof value === 'object' &&
    value !== null &&
    'buffer' in value &&
    ownsMemory(value)
  );
}

function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return (
    taggedAs(value, 'Uint8Array') &&
    typeof value === 'object' &&
    value !== null &&
    'buffer' in value &&
    ownsMemory(value)
  );
}

/** 32-bit floats in memory of their own. */
export function floatsAt(fields: Fields, field: string): Float32Array<ArrayBuffer> {
  const value = fields[field];
  if (!isFloats(value)) throw new Malformed(field, '32-bit floats in memory of their own');
  return value;
}

/** Bytes in memory of their own. */
export function bytesAt(fields: Fields, field: string): Uint8Array<ArrayBuffer> {
  const value = fields[field];
  if (!isBytes(value)) throw new Malformed(field, 'bytes in memory of their own');
  return value;
}

/**
 * Reads a message with `read`, answering the refusal of a malformed one as a
 * failure under `code`. Anything else thrown is a fault in the reader and
 * propagates.
 */
export function readMessage<TMessage>(
  value: unknown,
  code: string,
  read: (fields: Fields) => TMessage,
): DomainResult<TMessage> {
  try {
    return succeed(read(fieldsOf(value, 'body')));
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    return fail(failure(code, FailureKind.Rejected, error.message));
  }
}
