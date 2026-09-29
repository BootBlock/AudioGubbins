/**
 * Reading a message that crossed into another global scope.
 *
 * A message between the main thread, the AudioWorklet, the feeder and a render
 * worker arrives as a structured clone, which the receiver cannot trust to have
 * the shape its type claims (REQ-EXEC-136.12, and the packet's "no stringly
 * typed AudioWorklet message protocol"). Each protocol names its messages in
 * one discriminated union and reads a received value into it here, field by
 * field, so a malformed message is refused with the field that was wrong rather
 * than acted on.
 *
 * A reader throws {@link MalformedMessage} at the first wrong field, caught
 * once by the protocol's `read` function and turned into a failure: a message
 * is small and wrong as a whole, so its first problem is the one to report.
 */

import {
  failure,
  FailureKind,
  fail,
  sampleCount,
  sampleRate,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import { nodeId, type NodeId } from '@audiogubbins/audio-graph';

/** A field of a received message that is not what the protocol says. */
export class MalformedMessage extends Error {
  constructor(field: string, expected: string) {
    super(`The message's ${field} is not ${expected}.`);
    this.name = 'MalformedMessage';
  }
}

/** A received value, read one field at a time. */
export type Fields = Readonly<Record<string, unknown>>;

/** Whether a value is an object with named fields, and not an array. */
function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as an object with named fields. */
export function fieldsOf(value: unknown, field = 'body'): Fields {
  if (!isFields(value)) throw new MalformedMessage(field, 'an object with named fields');
  return value;
}

export function textAt(fields: Fields, field: string): string {
  const value = fields[field];
  if (typeof value !== 'string') throw new MalformedMessage(field, 'text');
  return value;
}

/** A node's identifier. */
export function nodeAt(fields: Fields, field: string): NodeId {
  const read = nodeId(textAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a node identifier');
  return read.value;
}

/** Text, or `undefined` where the field is absent. */
export function optionalTextAt(fields: Fields, field: string): string | undefined {
  return fields[field] === undefined ? undefined : textAt(fields, field);
}

export function numberAt(fields: Fields, field: string): number {
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MalformedMessage(field, 'a finite number');
  }
  return value;
}

/** A sample rate. */
export function rateAt(fields: Fields, field: string): SampleRate {
  const read = sampleRate(numberAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a sample rate');
  return read.value;
}

/** A count of samples. */
export function samplesAt(fields: Fields, field: string): SampleCount {
  const read = sampleCount(countAt(fields, field));
  if (!read.ok) throw new MalformedMessage(field, 'a count of samples');
  return read.value;
}

/** A whole number of frames or a count, zero or more. */
export function countAt(fields: Fields, field: string): number {
  const value = numberAt(fields, field);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MalformedMessage(field, 'a whole number, zero or more');
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
    throw new MalformedMessage(field, `one of ${Object.values(values).join(', ')}`);
  }
  return found;
}

/** An array of samples per channel, each a `Float32Array`. */
export function channelsAt(fields: Fields, field: string): readonly Float32Array[] {
  const value: unknown = fields[field];
  const isSamples = (one: unknown): one is Float32Array => taggedAs(one, 'Float32Array');
  if (!Array.isArray(value) || !value.every(isSamples)) {
    throw new MalformedMessage(field, 'a list of sample arrays');
  }
  return value;
}

/**
 * Whether a value is of a built-in class, by its tag. A structured clone is
 * made in the receiving realm, which need not be the one this module was
 * loaded in, so `instanceof` could refuse a value that is what it claims.
 */
function taggedAs(value: unknown, tag: string): boolean {
  return Object.prototype.toString.call(value) === `[object ${tag}]`;
}

/** A compiled WebAssembly module, or `undefined` where the field is absent. */
export function optionalModuleAt(fields: Fields, field: string): WebAssembly.Module | undefined {
  const value: unknown = fields[field];
  if (value === undefined) return undefined;
  const isModule = (one: unknown): one is WebAssembly.Module => taggedAs(one, 'WebAssembly.Module');
  if (!isModule(value)) throw new MalformedMessage(field, 'a compiled WebAssembly module');
  return value;
}

/**
 * The end of a message channel, transferred with the message, or `undefined`
 * where the field is absent.
 */
export function optionalPortAt(fields: Fields, field: string): MessagePort | undefined {
  const value: unknown = fields[field];
  if (value === undefined) return undefined;
  const isPort = (one: unknown): one is MessagePort => taggedAs(one, 'MessagePort');
  if (!isPort(value)) throw new MalformedMessage(field, 'the end of a message channel');
  return value;
}

/** Memory shared between threads. */
export function sharedMemoryAt(fields: Fields, field: string): SharedArrayBuffer {
  const value: unknown = fields[field];
  const isShared = (one: unknown): one is SharedArrayBuffer => taggedAs(one, 'SharedArrayBuffer');
  if (!isShared(value)) throw new MalformedMessage(field, 'shared memory');
  return value;
}

/** An array of finite numbers. */
export function numbersAt(fields: Fields, field: string): readonly number[] {
  const value: unknown = fields[field];
  const isFinite = (one: unknown): one is number => typeof one === 'number' && Number.isFinite(one);
  if (!Array.isArray(value) || !value.every(isFinite)) {
    throw new MalformedMessage(field, 'a list of finite numbers');
  }
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
    return succeed(read(fieldsOf(value)));
  } catch (error) {
    if (!(error instanceof MalformedMessage)) throw error;
    return fail(failure(code, FailureKind.Rejected, error.message));
  }
}
