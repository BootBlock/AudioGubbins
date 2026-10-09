/**
 * Reading the values only the audio runtime's messages carry: a graph and its
 * nodes, a compiled module and the DSP delivery that names it, the end of a
 * message channel and shared memory. Every other field is read by the
 * domain's one field reader (`message-fields.ts`), which these build on, so a
 * malformed field is refused alike in every protocol.
 */

import {
  Malformed,
  fieldsOf,
  isTagged,
  oneOf,
  textAt,
  type MessageFields,
} from '@audiogubbins/domain';
import {
  nodeId,
  readGraphDescriptor,
  type GraphDescriptor,
  type NodeId,
} from '@audiogubbins/audio-graph';

import { DspDeliveryKind, type DspDelivery } from '../dsp/dsp-delivery.js';

/** A node's identifier. */
export function nodeAt(fields: MessageFields, field: string): NodeId {
  const read = nodeId(textAt(fields, field));
  if (!read.ok) throw new Malformed(field, 'a node identifier');
  return read.value;
}

/** A graph's descriptor, read by the graph's own reader, which trusts nothing. */
export function graphAt(fields: MessageFields, field: string): GraphDescriptor {
  const graph = readGraphDescriptor(fields[field]);
  if (!graph.ok) throw new Malformed(field, 'a graph descriptor');
  return graph.value;
}

/** A compiled WebAssembly module. */
export function moduleAt(fields: MessageFields, field: string): WebAssembly.Module {
  const value: unknown = fields[field];
  const isModule = (one: unknown): one is WebAssembly.Module => isTagged(one, 'WebAssembly.Module');
  if (!isModule(value)) throw new Malformed(field, 'a compiled WebAssembly module');
  return value;
}

/**
 * The DSP module as a thread is given it, its module read by `readModule`, or
 * the reason there is none. Its own fields are read under their full names,
 * `dsp.module` and the like, so a refusal says which `kind` was wrong.
 */
export function dspDeliveryAt<TModule>(
  fields: MessageFields,
  field: string,
  readModule: (delivery: MessageFields, field: string) => TModule,
): DspDelivery<TModule> {
  const delivery = fieldsOf(fields[field], field);
  const [kindField, moduleField, reasonField] = [
    `${field}.kind`,
    `${field}.module`,
    `${field}.reason`,
  ];
  const named: MessageFields = {
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
export function portAt(fields: MessageFields, field: string): MessagePort {
  const value: unknown = fields[field];
  const isPort = (one: unknown): one is MessagePort => isTagged(one, 'MessagePort');
  if (!isPort(value)) throw new Malformed(field, 'the end of a message channel');
  return value;
}

/** The end of a message channel, or `undefined` where the field is absent. */
export function optionalPortAt(fields: MessageFields, field: string): MessagePort | undefined {
  return fields[field] === undefined ? undefined : portAt(fields, field);
}

/** Memory shared between threads. */
export function sharedMemoryAt(fields: MessageFields, field: string): SharedArrayBuffer {
  const value: unknown = fields[field];
  const isShared = (one: unknown): one is SharedArrayBuffer => isTagged(one, 'SharedArrayBuffer');
  if (!isShared(value)) throw new Malformed(field, 'shared memory');
  return value;
}
