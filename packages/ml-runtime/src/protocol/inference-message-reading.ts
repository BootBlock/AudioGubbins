/**
 * Reading an inference message that crossed a thread, field by field
 * (REQ-EXEC-136.12): every option, setup, tensor and failure is read into its
 * type, or the message is refused with the field that was wrong.
 */

import { FailureKind, failure, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import {
  GraphOptimisation,
  InferenceMode,
  PreviewAcceleratorKind,
  RuntimeBuild,
  isSha256Hex,
  type InferenceCapabilities,
  type InferenceExecution,
  type InferenceOptions,
  type PreviewAccelerator,
  type RuntimeIdentity,
  type RuntimeSetup,
} from '../inference-options.js';
import { tensor, type TensorDimension, type TensorInfo } from '../tensor.js';
import {
  Malformed,
  bytesAt,
  countAt,
  fieldsOf,
  flagAt,
  floatsAt,
  itemsAt,
  oneOf,
  readMessage,
  textAt,
  type Fields,
} from './fields.js';
import {
  FromInferenceWorkerKind,
  ToInferenceWorkerKind,
  type FromInferenceWorker,
  type InferenceFailures,
  type NamedTensor,
  type ToInferenceWorker,
} from './inference-messages.js';

/** A SHA-256 digest in lowercase hexadecimal. */
function digestAt(fields: Fields, field: string): string {
  const value = textAt(fields, field);
  if (!isSha256Hex(value)) throw new Malformed(field, 'a SHA-256 digest in lowercase hexadecimal');
  return value;
}

/** A whole number, one or more. */
function positiveAt(fields: Fields, field: string): number {
  const value = countAt(fields, field);
  if (value === 0) throw new Malformed(field, 'a whole number, one or more');
  return value;
}

function acceleratorFrom(value: unknown, name: string): PreviewAccelerator {
  const fields = fieldsOf(value, name);
  const kind = oneOf(fields, 'kind', PreviewAcceleratorKind);
  return kind === PreviewAcceleratorKind.Threads
    ? { kind, threads: positiveAt(fields, 'threads') }
    : { kind };
}

function optionsFrom(value: unknown, name: string): InferenceOptions {
  const fields = fieldsOf(value, name);
  const kind = oneOf(fields, 'kind', InferenceMode);
  const graphOptimisation = oneOf(fields, 'graphOptimisation', GraphOptimisation);
  return kind === InferenceMode.Pinned
    ? { kind, graphOptimisation }
    : {
        kind,
        graphOptimisation,
        accelerator: acceleratorFrom(fields['accelerator'], 'accelerator'),
      };
}

function capabilitiesFrom(value: unknown): InferenceCapabilities {
  const fields = fieldsOf(value, 'capabilities');
  return {
    fixedWidthSimd: flagAt(fields, 'fixedWidthSimd'),
    threads: positiveAt(fields, 'threads'),
    webGpu: flagAt(fields, 'webGpu'),
  };
}

function setupFrom(value: unknown): RuntimeSetup {
  const fields = fieldsOf(value, 'setup');
  const filesBase = textAt(fields, 'filesBase');
  if (!filesBase.endsWith('/')) throw new Malformed('filesBase', 'a base URL ending in a slash');
  const digests = fieldsOf(fields['webAssemblySha256'], 'webAssemblySha256');
  return {
    filesBase,
    webAssemblySha256: {
      [RuntimeBuild.Cpu]: digestAt(digests, RuntimeBuild.Cpu),
      [RuntimeBuild.WebGpu]: digestAt(digests, RuntimeBuild.WebGpu),
    },
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

/** A failure's details: named text, numbers and flags. */
function detailsFrom(fields: Fields): DomainFailure['details'] {
  if (fields['details'] === undefined) return undefined;
  const details = fieldsOf(fields['details'], 'details');
  const read: Record<string, string | number | boolean> = {};
  for (const [name, one] of Object.entries(details)) {
    if (typeof one !== 'string' && typeof one !== 'number' && typeof one !== 'boolean') {
      throw new Malformed(`details.${name}`, 'text, a number or a flag');
    }
    read[name] = one;
  }
  return read;
}

/** A failure as the domain states it, with the failure it arose from, if any. */
function failureFrom(value: unknown, name: string): DomainFailure {
  const fields = fieldsOf(value, name);
  const details = detailsFrom(fields);
  const cause = fields['cause'] === undefined ? undefined : failureFrom(fields['cause'], 'cause');
  return failure(
    textAt(fields, 'code'),
    oneOf(fields, 'kind', FailureKind),
    textAt(fields, 'summary'),
    {
      ...(details === undefined ? {} : { details }),
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

function failuresAt(fields: Fields): InferenceFailures {
  const [first, ...rest] = itemsAt(fields, 'failures', failureFrom);
  if (first === undefined) throw new Malformed('failures', 'a list of at least one');
  return [first, ...rest];
}

function toWorkerFrom(fields: Fields): ToInferenceWorker {
  const kind = oneOf(fields, 'kind', ToInferenceWorkerKind);
  switch (kind) {
    case ToInferenceWorkerKind.Start:
      return { kind, setup: setupFrom(fields['setup']) };
    case ToInferenceWorkerKind.Open:
      return {
        kind,
        call: countAt(fields, 'call'),
        model: bytesAt(fields, 'model'),
        options: optionsFrom(fields['options'], 'options'),
      };
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

function fromWorkerFrom(fields: Fields): FromInferenceWorker {
  const kind = oneOf(fields, 'kind', FromInferenceWorkerKind);
  switch (kind) {
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
      return { kind, call: countAt(fields, 'call'), failures: failuresAt(fields) };
    case FromInferenceWorkerKind.Refused:
      return { kind, failures: failuresAt(fields) };
  }
}

/** A message the inference worker received, read, or why it cannot be. */
export function readToInferenceWorker(value: unknown): DomainResult<ToInferenceWorker> {
  return readMessage(value, 'inference.message-malformed', toWorkerFrom);
}

/** A message the inference worker sent, read, or why it cannot be. */
export function readFromInferenceWorker(value: unknown): DomainResult<FromInferenceWorker> {
  return readMessage(value, 'inference.reply-malformed', fromWorkerFrom);
}
