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
import {
  nodeId,
  readGraphDescriptor,
  type GraphDescriptor,
  type NodeId,
} from '@audiogubbins/audio-graph';

import { DspDeliveryKind, type DspDelivery } from '../dsp/dsp-delivery.js';

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

/** A graph's descriptor, read by the graph's own reader, which trusts nothing. */
export function graphAt(fields: Fields, field: string): GraphDescriptor {
  const graph = readGraphDescriptor(fields[field]);
  if (!graph.ok) throw new MalformedMessage(field, 'a graph descriptor');
  return graph.value;
}

export function flagAt(fields: Fields, field: string): boolean {
  const value = fields[field];
  if (typeof value !== 'boolean') throw new MalformedMessage(field, 'true or false');
  return value;
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

/** A whole number, zero or more, or `undefined` where the field is absent. */
export function optionalCountAt(fields: Fields, field: string): number | undefined {
  return fields[field] === undefined ? undefined : countAt(fields, field);
}

/** One of the values of a const object, such as a message's `kind` or a numbered quality. */
export function oneOf<TValue extends string | number>(
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

/** A compiled WebAssembly module. */
export function moduleAt(fields: Fields, field: string): WebAssembly.Module {
  const value: unknown = fields[field];
  const isModule = (one: unknown): one is WebAssembly.Module => taggedAs(one, 'WebAssembly.Module');
  if (!isModule(value)) throw new MalformedMessage(field, 'a compiled WebAssembly module');
  return value;
}

/**
 * Bytes in memory of their own, never over shared memory, which WebAssembly
 * does not compile from.
 */
export function bytesAt(fields: Fields, field: string): Uint8Array<ArrayBuffer> {
  const value: unknown = fields[field];
  const isBytes = (one: unknown): one is Uint8Array<ArrayBuffer> =>
    taggedAs(one, 'Uint8Array') &&
    typeof one === 'object' &&
    one !== null &&
    'buffer' in one &&
    taggedAs(one.buffer, 'ArrayBuffer');
  if (!isBytes(value)) throw new MalformedMessage(field, 'bytes');
  return value;
}

/**
 * The DSP module as a thread is given it, its module read by `readModule`, or
 * the reason there is none. Its own fields are read under their full names,
 * `dsp.module` and the like, so a refusal says which `kind` was wrong.
 */
export function dspDeliveryAt<TModule>(
  fields: Fields,
  field: string,
  readModule: (delivery: Fields, field: string) => TModule,
): DspDelivery<TModule> {
  const delivery = fieldsOf(fields[field], field);
  const [kindField, moduleField, reasonField] = [
    `${field}.kind`,
    `${field}.module`,
    `${field}.reason`,
  ];
  const named: Fields = {
    [kindField]: delivery['kind'],
    [moduleField]: delivery['module'],
    [reasonField]: delivery['reason'],
  };
  const kind = oneOf(named, kindField, DspDeliveryKind);
  return kind === DspDeliveryKind.Available
    ? { kind, module: readModule(named, moduleField) }
    : { kind, reason: textAt(named, reasonField) };
}

/** The end of a message channel, transferred with the message. */
export function portAt(fields: Fields, field: string): MessagePort {
  const value: unknown = fields[field];
  const isPort = (one: unknown): one is MessagePort => taggedAs(one, 'MessagePort');
  if (!isPort(value)) throw new MalformedMessage(field, 'the end of a message channel');
  return value;
}

/** The end of a message channel, or `undefined` where the field is absent. */
export function optionalPortAt(fields: Fields, field: string): MessagePort | undefined {
  return fields[field] === undefined ? undefined : portAt(fields, field);
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

/** An array of text. */
export function textsAt(fields: Fields, field: string): readonly string[] {
  const value: unknown = fields[field];
  const isText = (one: unknown): one is string => typeof one === 'string';
  if (!Array.isArray(value) || !value.every(isText)) {
    throw new MalformedMessage(field, 'a list of text');
  }
  return value;
}

/** The elements of a list, each read by `read` with the name of its place. */
export function itemsAt<TItem>(
  fields: Fields,
  field: string,
  read: (item: unknown, name: string) => TItem,
): readonly TItem[] {
  const value: unknown = fields[field];
  if (!Array.isArray(value)) throw new MalformedMessage(field, 'a list');
  return value.map((item: unknown, index) => read(item, `${field}[${String(index)}]`));
}

/** The elements of a list, each read as an object named by its place. */
export function listAt<TItem>(
  fields: Fields,
  field: string,
  read: (item: Fields) => TItem,
): readonly TItem[] {
  return itemsAt(fields, field, (item, name) => read(fieldsOf(item, name)));
}

/** The elements of a list that holds at least one, each read as {@link listAt} reads them. */
export function nonEmptyListAt<TItem>(
  fields: Fields,
  field: string,
  read: (item: Fields) => TItem,
): readonly [TItem, ...TItem[]] {
  const [first, ...rest] = listAt(fields, field, read);
  if (first === undefined) throw new MalformedMessage(field, 'a list of at least one');
  return [first, ...rest];
}

/**
 * A failure as a message carries it where the receiver shows it and acts on
 * nothing else: its code and summary.
 */
export interface FailureSummary {
  readonly code: string;
  readonly summary: string;
}

export function failureSummaryFrom(fields: Fields): FailureSummary {
  return { code: textAt(fields, 'code'), summary: textAt(fields, 'summary') };
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
