/**
 * Reading a model channel's message that crossed a thread, field by field
 * (REQ-EXEC-136.12), or why it cannot be read.
 */

import type { DomainResult } from '@audiogubbins/domain';

import { isChannelEnd } from '../channel-end.js';
import { RuntimeBuild, type RuntimeConfiguration } from '../inference-options.js';
import {
  Malformed,
  bytesAt,
  countAt,
  fieldsOf,
  oneOf,
  readMessage,
  textAt,
  type Fields,
} from './fields.js';
import { capabilitiesFrom, digestAt, failuresAt, positiveAt } from './inference-message-reading.js';
import {
  FromModelThreadKind,
  MODEL_CHANNEL,
  ToModelChannelKind,
  type FromModelThread,
  type ToModelChannel,
  type ToModelThread,
} from './model-channel-messages.js';

function configurationFrom(value: unknown): RuntimeConfiguration {
  const fields = fieldsOf(value, 'configuration');
  return { build: oneOf(fields, 'build', RuntimeBuild), threads: positiveAt(fields, 'threads') };
}

function portAt(fields: Fields): ToModelThread['port'] {
  const port = fields['port'];
  if (!isChannelEnd(port)) throw new Malformed('port', 'the end of a message channel');
  return port;
}

function toThreadFrom(fields: Fields): ToModelThread {
  if (fields['kind'] !== MODEL_CHANNEL) throw new Malformed('kind', MODEL_CHANNEL);
  return {
    kind: MODEL_CHANNEL,
    port: portAt(fields),
    capabilities: capabilitiesFrom(fields['capabilities']),
  };
}

function fromThreadFrom(fields: Fields): FromModelThread {
  const kind = oneOf(fields, 'kind', FromModelThreadKind);
  switch (kind) {
    case FromModelThreadKind.Inference:
      return {
        kind,
        configuration: configurationFrom(fields['configuration']),
        port: portAt(fields),
      };
    case FromModelThreadKind.File:
      return {
        kind,
        call: countAt(fields, 'call'),
        pack: textAt(fields, 'pack'),
        version: textAt(fields, 'version'),
        path: textAt(fields, 'path'),
      };
    case FromModelThreadKind.Cancel:
      return { kind, call: countAt(fields, 'call') };
  }
}

function toChannelFrom(fields: Fields): ToModelChannel {
  const kind = oneOf(fields, 'kind', ToModelChannelKind);
  switch (kind) {
    case ToModelChannelKind.File:
      return {
        kind,
        call: countAt(fields, 'call'),
        bytes: bytesAt(fields, 'bytes'),
        sha256: digestAt(fields, 'sha256'),
      };
    case ToModelChannelKind.FileFailed:
      return { kind, call: countAt(fields, 'call'), failures: failuresAt(fields) };
    case ToModelChannelKind.InferenceFailed:
      return {
        kind,
        configuration: configurationFrom(fields['configuration']),
        reason: textAt(fields, 'reason'),
      };
  }
}

/**
 * Whether a message a thread's scope received is meant for its model channel,
 * which the thread's own protocol never sends: a message of its kind.
 */
export function isModelChannelMessage(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === MODEL_CHANNEL
  );
}

/** The page's connection of a thread's scope to its model channel, read, or why it cannot be. */
export function readToModelThread(value: unknown): DomainResult<ToModelThread> {
  return readMessage(value, 'inference.message-malformed', toThreadFrom);
}

/** A message the page received over a model channel, read, or why it cannot be. */
export function readFromModelThread(value: unknown): DomainResult<FromModelThread> {
  return readMessage(value, 'inference.message-malformed', fromThreadFrom);
}

/** A message a thread received over its model channel, read, or why it cannot be. */
export function readToModelChannel(value: unknown): DomainResult<ToModelChannel> {
  return readMessage(value, 'inference.reply-malformed', toChannelFrom);
}
