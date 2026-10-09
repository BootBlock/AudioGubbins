/**
 * Reading a model channel's message that crossed a thread, field by field
 * (REQ-EXEC-136.12), or why it cannot be read.
 */

import {
  Malformed,
  bytesAt,
  countAt,
  domainFailuresAt,
  oneOf,
  readMessage,
  textAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';

import { isChannelEnd } from '../channel-end.js';
import { capabilitiesFrom, digestAt } from './inference-message-reading.js';
import {
  FromModelThreadKind,
  MODEL_CHANNEL,
  ToModelChannelKind,
  type FromModelThread,
  type ToModelChannel,
  type ToModelThread,
} from './model-channel-messages.js';

function portAt(fields: MessageFields): ToModelThread['port'] {
  const port = fields['port'];
  if (!isChannelEnd(port)) throw new Malformed('port', 'the end of a message channel');
  return port;
}

function toThreadFrom(fields: MessageFields): ToModelThread {
  if (fields['kind'] !== MODEL_CHANNEL) throw new Malformed('kind', MODEL_CHANNEL);
  return {
    kind: MODEL_CHANNEL,
    port: portAt(fields),
    capabilities: capabilitiesFrom(fields['capabilities']),
  };
}

function fromThreadFrom(fields: MessageFields): FromModelThread {
  const kind = oneOf(fields, 'kind', FromModelThreadKind);
  switch (kind) {
    case FromModelThreadKind.Inference:
      return { kind, port: portAt(fields) };
    case FromModelThreadKind.Version:
      return {
        kind,
        call: countAt(fields, 'call'),
        pack: textAt(fields, 'pack'),
        version: textAt(fields, 'version'),
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

function toChannelFrom(fields: MessageFields): ToModelChannel {
  const kind = oneOf(fields, 'kind', ToModelChannelKind);
  switch (kind) {
    case ToModelChannelKind.VersionReady:
      return { kind, call: countAt(fields, 'call') };
    case ToModelChannelKind.File:
      return {
        kind,
        call: countAt(fields, 'call'),
        bytes: bytesAt(fields, 'bytes'),
        sha256: digestAt(fields, 'sha256'),
      };
    case ToModelChannelKind.CallFailed:
      return {
        kind,
        call: countAt(fields, 'call'),
        failures: domainFailuresAt(fields, 'failures'),
      };
    case ToModelChannelKind.InferenceFailed:
      return { kind, reason: textAt(fields, 'reason') };
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
