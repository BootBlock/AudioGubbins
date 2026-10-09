/**
 * Reading an inference message that crossed a thread, field by field
 * (REQ-EXEC-136.12): every option, setup, tensor and failure is read into its
 * type, or the message is refused with the field that was wrong.
 */

import {
  Malformed,
  bytesAt,
  countAt,
  domainFailuresAt,
  fieldsOf,
  flagAt,
  floatsAt,
  itemsAt,
  oneOf,
  readMessage,
  textAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';

import { isChannelEnd } from '../channel-end.js';
import {
  GraphOptimisation,
  isSha256Hex,
  type InferenceCapabilities,
  type InferenceExecution,
  type InferenceOptions,
  type RuntimeIdentity,
  type RuntimeSetup,
} from '../inference-options.js';
import { tensor, type TensorDimension, type TensorInfo } from '../tensor.js';
import {
  FromInferenceWorkerKind,
  ToInferenceThreadKind,
  ToInferenceWorkerKind,
  type FromInferenceWorker,
  type NamedTensor,
  type ToInferenceThread,
  type ToInferenceWorker,
} from './inference-messages.js';

/** A SHA-256 digest in lowercase hexadecimal. */
export function digestAt(fields: MessageFields, field: string): string {
  const value = textAt(fields, field);
  if (!isSha256Hex(value)) throw new Malformed(field, 'a SHA-256 digest in lowercase hexadecimal');
  return value;
}

function optionsFrom(value: unknown, name: string): InferenceOptions {
  const fields = fieldsOf(value, name);
  return { graphOptimisation: oneOf(fields, 'graphOptimisation', GraphOptimisation) };
}

export function capabilitiesFrom(value: unknown): InferenceCapabilities {
  const fields = fieldsOf(value, 'capabilities');
  return { fixedWidthSimd: flagAt(fields, 'fixedWidthSimd') };
}

function setupFrom(value: unknown): RuntimeSetup {
  const fields = fieldsOf(value, 'setup');
  const filesBase = textAt(fields, 'filesBase');
  if (!filesBase.endsWith('/')) throw new Malformed('filesBase', 'a base URL ending in a slash');
  return {
    filesBase,
    webAssemblySha256: digestAt(fields, 'webAssemblySha256'),
    capabilities: capabilitiesFrom(fields['capabilities']),
  };
}

/** A tensor whose dimensions describe its floats. */
function namedTensorFrom(value: unknown, name: string): NamedTensor {
  const fields = fieldsOf(value, name);
  const dims = itemsAt(fields, 'dims', (item, place) => countAt({ [place]: item }, place));
  const read = tensor(floatsAt(fields, 'data'), dims);
  if (!read.ok) throw new Malformed(`${name}.dims`, 'the dimensions of its data');
  return { name: textAt(fields, 'name'), ...read.value };
}

function dimensionFrom(item: unknown, place: string): TensorDimension {
  return typeof item === 'string' ? item : countAt({ [place]: item }, place);
}

function infoFrom(value: unknown, name: string): TensorInfo {
  const fields = fieldsOf(value, name);
  return { name: textAt(fields, 'name'), dims: itemsAt(fields, 'dims', dimensionFrom) };
}

function identityFrom(value: unknown): RuntimeIdentity {
  const fields = fieldsOf(value, 'runtime');
  return {
    name: textAt(fields, 'name'),
    version: textAt(fields, 'version'),
    webAssemblySha256: digestAt(fields, 'webAssemblySha256'),
  };
}

function executionFrom(value: unknown): InferenceExecution {
  const fields = fieldsOf(value, 'execution');
  return {
    options: optionsFrom(fields['options'], 'options'),
    runtime: identityFrom(fields['runtime']),
  };
}

function toThreadFrom(fields: MessageFields): ToInferenceThread {
  const kind = oneOf(fields, 'kind', ToInferenceThreadKind);
  switch (kind) {
    case ToInferenceThreadKind.Start:
      return { kind, setup: setupFrom(fields['setup']) };
    case ToInferenceThreadKind.Connect: {
      const port = fields['port'];
      if (!isChannelEnd(port)) throw new Malformed('port', 'the end of a message channel');
      return { kind, client: countAt(fields, 'client'), port };
    }
    case ToInferenceThreadKind.Disconnect:
      return { kind, client: countAt(fields, 'client') };
  }
}

function toWorkerFrom(fields: MessageFields): ToInferenceWorker {
  const kind = oneOf(fields, 'kind', ToInferenceWorkerKind);
  switch (kind) {
    case ToInferenceWorkerKind.Open:
      return {
        kind,
        call: countAt(fields, 'call'),
        sha256: digestAt(fields, 'sha256'),
        options: optionsFrom(fields['options'], 'options'),
      };
    case ToInferenceWorkerKind.Model:
      return { kind, call: countAt(fields, 'call'), model: bytesAt(fields, 'model') };
    case ToInferenceWorkerKind.Run:
      return {
        kind,
        call: countAt(fields, 'call'),
        session: countAt(fields, 'session'),
        inputs: itemsAt(fields, 'inputs', namedTensorFrom),
      };
    case ToInferenceWorkerKind.Cancel:
      return { kind, call: countAt(fields, 'call') };
    case ToInferenceWorkerKind.Release:
      return { kind, session: countAt(fields, 'session') };
  }
}

function fromWorkerFrom(fields: MessageFields): FromInferenceWorker {
  const kind = oneOf(fields, 'kind', FromInferenceWorkerKind);
  switch (kind) {
    case FromInferenceWorkerKind.ModelWanted:
      return { kind, call: countAt(fields, 'call') };
    case FromInferenceWorkerKind.Opened:
      return {
        kind,
        call: countAt(fields, 'call'),
        inputs: itemsAt(fields, 'inputs', infoFrom),
        outputs: itemsAt(fields, 'outputs', infoFrom),
        execution: executionFrom(fields['execution']),
      };
    case FromInferenceWorkerKind.Ran:
      return {
        kind,
        call: countAt(fields, 'call'),
        outputs: itemsAt(fields, 'outputs', namedTensorFrom),
      };
    case FromInferenceWorkerKind.Failed:
      return {
        kind,
        call: countAt(fields, 'call'),
        failures: domainFailuresAt(fields, 'failures'),
      };
    case FromInferenceWorkerKind.Refused:
      return { kind, failures: domainFailuresAt(fields, 'failures') };
  }
}

/** A message the inference worker's own scope received from the page, read, or why it cannot be. */
export function readToInferenceThread(value: unknown): DomainResult<ToInferenceThread> {
  return readMessage(value, 'inference.message-malformed', toThreadFrom);
}

/** A message the inference worker received over a thread's channel, read, or why it cannot be. */
export function readToInferenceWorker(value: unknown): DomainResult<ToInferenceWorker> {
  return readMessage(value, 'inference.message-malformed', toWorkerFrom);
}

/** A message the inference worker sent, read, or why it cannot be. */
export function readFromInferenceWorker(value: unknown): DomainResult<FromInferenceWorker> {
  return readMessage(value, 'inference.reply-malformed', fromWorkerFrom);
}
