/**
 * Reading a spectrogram message that crossed a thread, field by field
 * (REQ-EXEC-136.12). A reader throws at the first wrong field, which the
 * protocol's `read` function turns into a failure naming it.
 */

import {
  DspImplementation,
  dspDeliveryAt,
  isMessagePortLike,
  pcmDescriptionOf,
} from '@audiogubbins/audio-engine';
import {
  Malformed,
  bytesAt,
  countAt,
  flagAt,
  isTagged,
  oneOf,
  optionalBytesAt,
  optionalTextAt,
  qualityModeAt,
  readMessage,
  textAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';

import { configAt } from './spectrogram-config.js';
import {
  FromSpectrogramWorkerKind,
  ToSpectrogramWorkerKind,
  type CompiledModule,
  type FromSpectrogramWorker,
  type ToSpectrogramWorker,
} from './spectrogram-messages.js';

/** A compiled WebAssembly module, by its tag, as a clone of one is made. */
function moduleAt(fields: MessageFields, field: string): CompiledModule {
  const value = fields[field];
  const isModule = (one: unknown): one is CompiledModule => isTagged(one, 'WebAssembly.Module');
  if (!isModule(value)) throw new Malformed(field, 'a compiled WebAssembly module');
  return value;
}

/** A message that names no job: the DSP, or the port to the preview worker. */
function readScope(fields: MessageFields): ToSpectrogramWorker {
  if (fields['kind'] === ToSpectrogramWorkerKind.Dsp) {
    return {
      kind: ToSpectrogramWorkerKind.Dsp,
      delivery: dspDeliveryAt(fields, 'delivery', moduleAt),
    };
  }
  const port = fields['port'];
  if (!isMessagePortLike(port)) throw new Malformed('port', 'the end of a message channel');
  return { kind: ToSpectrogramWorkerKind.Previews, port };
}

/** A message about one job. */
function readJob(fields: MessageFields): ToSpectrogramWorker {
  const job = textAt(fields, 'job');
  switch (fields['kind']) {
    case ToSpectrogramWorkerKind.Open:
      return {
        kind: ToSpectrogramWorkerKind.Open,
        job,
        identity: textAt(fields, 'identity'),
        revision: textAt(fields, 'revision'),
        channels: countAt(fields, 'channels'),
        description: pcmDescriptionOf(fields['description'], 'description'),
        quality: qualityModeAt(fields, 'quality'),
      };
    case ToSpectrogramWorkerKind.Focus:
      return { kind: ToSpectrogramWorkerKind.Focus, job, centre: countAt(fields, 'centre') };
    case ToSpectrogramWorkerKind.Want:
      return {
        kind: ToSpectrogramWorkerKind.Want,
        job,
        request: countAt(fields, 'request'),
        config: configAt(fields, 'config'),
        channel: countAt(fields, 'channel'),
        level: countAt(fields, 'level'),
        index: countAt(fields, 'index'),
        cached: optionalBytesAt(fields, 'cached'),
      };
    case ToSpectrogramWorkerKind.Cancel:
      return { kind: ToSpectrogramWorkerKind.Cancel, job, request: countAt(fields, 'request') };
    case ToSpectrogramWorkerKind.Close:
      return { kind: ToSpectrogramWorkerKind.Close, job };
    default:
      throw new Malformed('kind', `one of ${Object.values(ToSpectrogramWorkerKind).join(', ')}`);
  }
}

function readToWorker(fields: MessageFields): ToSpectrogramWorker {
  return fields['kind'] === ToSpectrogramWorkerKind.Dsp ||
    fields['kind'] === ToSpectrogramWorkerKind.Previews
    ? readScope(fields)
    : readJob(fields);
}

function readFromWorker(fields: MessageFields): FromSpectrogramWorker {
  switch (fields['kind']) {
    case FromSpectrogramWorkerKind.Dsp:
      return {
        kind: FromSpectrogramWorkerKind.Dsp,
        implementation: oneOf(fields, 'implementation', DspImplementation),
        fallbackReason: optionalTextAt(fields, 'fallbackReason'),
      };
    case FromSpectrogramWorkerKind.Tile:
      return {
        kind: FromSpectrogramWorkerKind.Tile,
        job: textAt(fields, 'job'),
        request: countAt(fields, 'request'),
        bytes: bytesAt(fields, 'bytes'),
        adopted: flagAt(fields, 'adopted'),
        refusedCache: optionalTextAt(fields, 'refusedCache'),
      };
    case FromSpectrogramWorkerKind.Failed:
      return {
        kind: FromSpectrogramWorkerKind.Failed,
        job: textAt(fields, 'job'),
        reason: textAt(fields, 'reason'),
      };
    default:
      throw new Malformed('kind', `one of ${Object.values(FromSpectrogramWorkerKind).join(', ')}`);
  }
}

/** A message to the worker, read from its structured clone. */
export function readToSpectrogramWorker(value: unknown): DomainResult<ToSpectrogramWorker> {
  return readMessage(value, 'spectral.message-to-worker-malformed', readToWorker);
}

/** A message from the worker, read from its structured clone. */
export function readFromSpectrogramWorker(value: unknown): DomainResult<FromSpectrogramWorker> {
  return readMessage(value, 'spectral.message-from-worker-malformed', readFromWorker);
}
