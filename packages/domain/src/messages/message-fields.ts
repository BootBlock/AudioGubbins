/**
 * Reading a message that crossed into another global scope, one field at a
 * time: the one reader every thread protocol reads its messages with.
 *
 * A message between the page and a worker, or between workers, arrives as a
 * structured clone, which the receiver cannot trust to have the shape its type
 * claims (REQ-EXEC-136.12). Each protocol names its messages in one
 * discriminated union and reads a received value into it with these readers,
 * field by field, each throwing {@link Malformed} at the first wrong field;
 * {@link readMessage} catches it once and answers a failure that names the
 * field: a message is small and wrong as a whole, so its first problem is the
 * one to report. A field's name is its path in the message, such as
 * `result.reports[0].found`, so a refusal says where.
 *
 * It lives here, below every package that runs a thread, since each of them
 * may depend on the domain and no other package sits below them all; the
 * domain's own values, a quality mode among them, are read here in the one
 * form they cross a thread in. A value that crosses inside many messages, a
 * plan, a chain or a description of audio, is read by a field reader of its
 * own built on these, and {@link readValue} answers it alone.
 */

import { isWellFormedId, unsafeBrandId, type Branded } from '../identity/branded-id.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { qualityModeFrom, type QualityMode } from '../processing/quality-mode.js';
import { sampleCount, sampleRate, type SampleCount, type SampleRate } from '../time/sample-time.js';

/** A field of a received message that is not what the protocol says. */
export class Malformed extends Error {
  /** The field's path in the message. */
  readonly field: string;

  constructor(field: string, expected: string) {
    super(`The message's ${field} is not ${expected}.`);
    this.name = 'Malformed';
    this.field = field;
  }
}

/** A received value, read one field at a time. */
export type MessageFields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is MessageFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is of a built-in class, by its tag. A structured clone is
 * made in the receiving realm, which need not be the one this module was
 * loaded in, so `instanceof` could refuse a value that is what it claims.
 */
export function isTagged(value: unknown, tag: string): boolean {
  return Object.prototype.toString.call(value) === `[object ${tag}]`;
}

/** The value as an object with named fields, `field` naming it. */
export function fieldsOf(value: unknown, field: string): MessageFields {
  if (!isFields(value)) throw new Malformed(field, 'an object with named fields');
  return value;
}

/** The field `field` as an object with named fields. */
export function fieldsAt(fields: MessageFields, field: string): MessageFields {
  return fieldsOf(fields[field], field);
}

/** The value, named `field`, as text. */
export function textOf(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Malformed(field, 'text');
  return value;
}

export function textAt(fields: MessageFields, field: string): string {
  return textOf(fields[field], field);
}

/** Text, or `undefined` where the field is absent. */
export function optionalTextAt(fields: MessageFields, field: string): string | undefined {
  return fields[field] === undefined ? undefined : textAt(fields, field);
}

/** The value, named `field`, as true or false. */
export function flagOf(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Malformed(field, 'true or false');
  return value;
}

export function flagAt(fields: MessageFields, field: string): boolean {
  return flagOf(fields[field], field);
}

/** The value, named `field`, as a finite number. */
export function numberOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Malformed(field, 'a finite number');
  }
  return value;
}

/** A finite number. */
export function numberAt(fields: MessageFields, field: string): number {
  return numberOf(fields[field], field);
}

/** The value, named `field`, as a whole number, zero or more. */
export function countOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Malformed(field, 'a whole number, zero or more');
  }
  return value;
}

/** A whole number, zero or more. */
export function countAt(fields: MessageFields, field: string): number {
  return countOf(fields[field], field);
}

/** A whole number, zero or more, or `undefined` where the field is absent. */
export function optionalCountAt(fields: MessageFields, field: string): number | undefined {
  return fields[field] === undefined ? undefined : countAt(fields, field);
}

/** The value, named `field`, as one of the values of a const object. */
export function oneOfValues<TValue extends string | number>(
  value: unknown,
  field: string,
  values: Readonly<Record<string, TValue>>,
): TValue {
  const found = Object.values(values).find((one) => one === value);
  if (found === undefined) {
    throw new Malformed(field, `one of ${Object.values(values).join(', ')}`);
  }
  return found;
}

/** One of the values of a const object, such as a message's `kind` or a numbered quality. */
export function oneOf<TValue extends string | number>(
  fields: MessageFields,
  field: string,
  values: Readonly<Record<string, TValue>>,
): TValue {
  return oneOfValues(fields[field], field, values);
}

/** The value, named `field`, as a list, each element read by `read` with the name of its place. */
export function itemsOf<TItem>(
  value: unknown,
  field: string,
  read: (item: unknown, name: string) => TItem,
): readonly TItem[] {
  if (!Array.isArray(value)) throw new Malformed(field, 'a list');
  return value.map((item: unknown, index) => read(item, `${field}[${String(index)}]`));
}

/**
 * The value, named `field`, as a list of at most `most` elements, each read
 * as {@link itemsOf} reads them. The length is checked before any element is
 * read, so a value cannot ask its reader for unbounded work.
 */
export function boundedItemsOf<TItem>(
  value: unknown,
  field: string,
  most: number,
  read: (item: unknown, name: string) => TItem,
): readonly TItem[] {
  if (Array.isArray(value) && value.length > most) {
    throw new Malformed(field, `a list of at most ${String(most)}`);
  }
  return itemsOf(value, field, read);
}

/** The elements of a list, each read by `read` with the name of its place. */
export function itemsAt<TItem>(
  fields: MessageFields,
  field: string,
  read: (item: unknown, name: string) => TItem,
): readonly TItem[] {
  return itemsOf(fields[field], field, read);
}

/** The elements of a list, each read as an object named by its place. */
export function objectsAt<TItem>(
  fields: MessageFields,
  field: string,
  read: (item: MessageFields, name: string) => TItem,
): readonly TItem[] {
  return itemsAt(fields, field, (item, name) => read(fieldsOf(item, name), name));
}

/** The elements of a list that holds at least one, each read as {@link objectsAt} reads them. */
export function nonEmptyObjectsAt<TItem>(
  fields: MessageFields,
  field: string,
  read: (item: MessageFields, name: string) => TItem,
): readonly [TItem, ...TItem[]] {
  const [first, ...rest] = objectsAt(fields, field, read);
  if (first === undefined) throw new Malformed(field, 'a list of at least one');
  return [first, ...rest];
}

/** A list of finite numbers. */
export function numbersAt(fields: MessageFields, field: string): readonly number[] {
  const value: unknown = fields[field];
  const isFinite = (one: unknown): one is number => typeof one === 'number' && Number.isFinite(one);
  if (!Array.isArray(value) || !value.every(isFinite)) {
    throw new Malformed(field, 'a list of finite numbers');
  }
  return value;
}

/** A list of whole numbers, each zero or more. */
export function countsAt(fields: MessageFields, field: string): readonly number[] {
  const value: unknown = fields[field];
  const isCount = (one: unknown): one is number =>
    typeof one === 'number' && Number.isSafeInteger(one) && one >= 0;
  if (!Array.isArray(value) || !value.every(isCount)) {
    throw new Malformed(field, 'a list of whole numbers, each zero or more');
  }
  return value;
}

/** A list of text. */
export function textsAt(fields: MessageFields, field: string): readonly string[] {
  const value: unknown = fields[field];
  const isText = (one: unknown): one is string => typeof one === 'string';
  if (!Array.isArray(value) || !value.every(isText)) {
    throw new Malformed(field, 'a list of text');
  }
  return value;
}

/** Whether a typed array's memory is its own rather than shared, so it can be moved. */
function ownsMemory(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buffer' in value &&
    isTagged(value.buffer, 'ArrayBuffer')
  );
}

/** 32-bit floats in memory of their own. */
export function floatsAt(fields: MessageFields, field: string): Float32Array<ArrayBuffer> {
  const value = fields[field];
  const isFloats = (one: unknown): one is Float32Array<ArrayBuffer> =>
    isTagged(one, 'Float32Array') && ownsMemory(one);
  if (!isFloats(value)) throw new Malformed(field, '32-bit floats in memory of their own');
  return value;
}

/** Bytes in memory of their own, which can be moved, and compiled from as WebAssembly. */
export function bytesAt(fields: MessageFields, field: string): Uint8Array<ArrayBuffer> {
  const value = fields[field];
  const isBytes = (one: unknown): one is Uint8Array<ArrayBuffer> =>
    isTagged(one, 'Uint8Array') && ownsMemory(one);
  if (!isBytes(value)) throw new Malformed(field, 'bytes in memory of their own');
  return value;
}

/** Bytes in memory of their own, or `undefined` where the field is absent. */
export function optionalBytesAt(
  fields: MessageFields,
  field: string,
): Uint8Array<ArrayBuffer> | undefined {
  return fields[field] === undefined ? undefined : bytesAt(fields, field);
}

/** The value, named `field`, as samples, one `Float32Array` per channel. */
export function sampleArraysOf(value: unknown, field: string): readonly Float32Array[] {
  const isSamples = (one: unknown): one is Float32Array => isTagged(one, 'Float32Array');
  if (!Array.isArray(value) || !value.every(isSamples)) {
    throw new Malformed(field, 'a list of sample arrays');
  }
  return value;
}

/** Samples, one `Float32Array` per channel. */
export function sampleArraysAt(fields: MessageFields, field: string): readonly Float32Array[] {
  return sampleArraysOf(fields[field], field);
}

/** The value, named `field`, as an identifier of the domain's form, branded `TBrand`. */
export function identifierOf<TBrand extends string>(
  value: unknown,
  field: string,
): Branded<TBrand> {
  if (typeof value !== 'string' || !isWellFormedId(value)) {
    throw new Malformed(field, 'an identifier');
  }
  return unsafeBrandId<TBrand>(value);
}

/** An identifier of the domain's form, branded `TBrand`. */
export function identifierAt<TBrand extends string>(
  fields: MessageFields,
  field: string,
): Branded<TBrand> {
  return identifierOf<TBrand>(fields[field], field);
}

/** The value, named `field`, as a sample rate. */
export function rateOf(value: unknown, field: string): SampleRate {
  const read = sampleRate(numberOf(value, field));
  if (!read.ok) throw new Malformed(field, 'a sample rate');
  return read.value;
}

/** A sample rate. */
export function rateAt(fields: MessageFields, field: string): SampleRate {
  return rateOf(fields[field], field);
}

/** The value, named `field`, as a count of samples. */
export function sampleCountOf(value: unknown, field: string): SampleCount {
  const read = sampleCount(countOf(value, field));
  if (!read.ok) throw new Malformed(field, 'a count of samples');
  return read.value;
}

/** A count of samples. */
export function sampleCountAt(fields: MessageFields, field: string): SampleCount {
  return sampleCountOf(fields[field], field);
}

/** Frames from `start` up to `end`, which is not before it. */
export function frameRangeAt(
  fields: MessageFields,
  field: string,
): { readonly start: number; readonly end: number } {
  const range = fieldsAt(fields, field);
  const start = countAt(range, 'start');
  const end = countAt(range, 'end');
  if (end < start) throw new Malformed(field, 'a range that ends at or after its start');
  return { start, end };
}

/**
 * A quality mode, in the one form one crosses a thread in, the mode itself:
 * its settings read by the domain's one reading of them, and its level taken
 * from them rather than from the message, so a level and settings that
 * disagree cannot arrive.
 */
export function qualityModeAt(fields: MessageFields, field: string): QualityMode {
  const mode = qualityModeFrom(fieldsAt(fields, field)['settings']);
  if (!mode.ok) throw new Malformed(field, 'a quality mode');
  return mode.value;
}

/**
 * Reads a value of any shape with `read`, answering the refusal of a
 * malformed one as a failure under `code` that names the field. Anything else
 * thrown is a fault in the reader and propagates.
 */
export function readValue<TValue>(
  value: unknown,
  code: string,
  read: (value: unknown) => TValue,
): DomainResult<TValue> {
  try {
    return succeed(read(value));
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    return fail(
      failure(code, FailureKind.Rejected, error.message, { details: { field: error.field } }),
    );
  }
}

/** Reads a message with `read`, as {@link readValue} reads a value, its body named `body`. */
export function readMessage<TMessage>(
  value: unknown,
  code: string,
  read: (fields: MessageFields) => TMessage,
): DomainResult<TMessage> {
  return readValue(value, code, (body) => read(fieldsOf(body, 'body')));
}
