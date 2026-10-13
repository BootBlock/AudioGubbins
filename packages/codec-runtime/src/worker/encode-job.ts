/**
 * An `encode` request (ADR-0092): an export's rendered stream, arriving from
 * the render worker, encoded into its file's bytes, which go to the storage
 * worker to stage. The encoder is opened by the factory the worker is given,
 * which chooses each format's encoder; this job only moves the stream through
 * it, a block at a time under both channels' credit, so neither side of it
 * holds more than the credit allows.
 *
 * Each way the request can end before its streams do, an encoder refused, a
 * render that failed, a receiver that refused or a cancellation, ends both
 * streams with the reason, so neither the render worker nor the storage
 * worker waits on a stream that will not come.
 */

import type { AudioFileWriter, CodecEnvironment } from '@audiogubbins/codecs';
import type { BrowserAudioEncoding, BrowserFamily } from '@audiogubbins/capabilities';
import {
  FailureKind,
  failure,
  sampleCount,
  type CancellationSignal,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  readRenderedStreamMessage,
  type EncodedStreamMessage,
  type RenderedStreamMessage,
} from '@audiogubbins/import-export';

import type { CodecModule } from '../codec-module.js';
import type { EncoderIdentity } from '../encoding/encoder-identity.js';
import { CreditedReceiver } from '../streams/credited-receiver.js';
import { CreditedSender } from '../streams/credited-sender.js';
import type { MessagePortLike } from '../streams/stream-port.js';
import { WORK_CANCELLED } from '../work-cancelled.js';
import type { ExportEncodeRequest, EncoderModuleName } from './codec-worker-messages.js';
import { JOB_FAULT, endOfThrown, type JobContext, type JobEnd } from './job-end.js';

/** What an export's encoder may use, each loaded on first use. */
export interface ExportEncoderServices {
  readonly codecModule: () => Promise<DomainResult<CodecModule>>;
  readonly encoderModule: (encoder: EncoderModuleName) => Promise<DomainResult<WebAssembly.Module>>;
  /** The browser's encoding classes, where the scope has them; AAC-LC is encoded by them alone. */
  readonly encoding: BrowserAudioEncoding | undefined;
  /**
   * The bit rates the browser's encoder was probed to take, by codec, which
   * a request is held to before its encoder is opened (`codecDescriptorIn`).
   */
  readonly browserBitRates: CodecEnvironment['browserBitRates'];
  /** The browser's family and major version, which names its encoder's version. */
  readonly browser: BrowserFamily | undefined;
  readonly signal: CancellationSignal;
}

/** An export's encoder, opened: the writer it writes through, and which encoder it is. */
export interface OpenedExportEncoder {
  readonly writer: AudioFileWriter;
  readonly encoder: EncoderIdentity;
}

/**
 * Opens the encoder of an export's file: the factory the worker is given,
 * which answers the writer the format's encoder writes through and the
 * encoder's identity, or why the format cannot be encoded here.
 */
export type OpenExportEncoder = (
  request: ExportEncodeRequest,
  services: ExportEncoderServices,
) => Promise<DomainResult<OpenedExportEncoder>>;

/** How many rendered blocks may wait unread: enough to keep the encoder busy, few enough to bound them. */
const RENDERED_WINDOW = 4;

/** The failure of a rendered stream that ends at other than the frames it sent. */
function framesDisagree(sent: number, stated: number): DomainFailure {
  return failure(
    'codec-runtime.rendered-frames-disagree',
    FailureKind.IntegrityViolation,
    `The render sent ${String(sent)} frames and says it rendered ${String(stated)}, so nothing of it is kept.`,
  );
}

/** The two streams of an encode, and how each is ended. */
class EncodeStreams {
  readonly rendered: CreditedReceiver<RenderedStreamMessage>;
  readonly encoded: CreditedSender<EncodedStreamMessage>;

  constructor(rendered: MessagePortLike, stream: MessagePortLike) {
    this.rendered = new CreditedReceiver(rendered, readRenderedStreamMessage, RENDERED_WINDOW);
    this.encoded = new CreditedSender(stream);
  }

  /** Ends both streams with `reason`, and answers the request with `end`. */
  async fail(reason: DomainFailure, end: JobEnd): Promise<JobEnd> {
    this.rendered.refuse(reason);
    if (this.encoded.refusal === undefined) {
      await this.encoded.send({ kind: 'failed', failure: reason }, []);
    }
    return end;
  }

  close(): void {
    this.rendered.close();
    this.encoded.close();
  }
}

/** Encodes the rendered stream over `rendered` into the file's bytes over `stream`. */
export async function runEncode(
  request: ExportEncodeRequest,
  rendered: MessagePortLike,
  stream: MessagePortLike,
  open: OpenExportEncoder,
  services: Omit<ExportEncoderServices, 'signal'>,
  context: JobContext,
): Promise<JobEnd> {
  const streams = new EncodeStreams(rendered, stream);
  try {
    const opened = await open(request, { ...services, signal: context.signal });
    if (!opened.ok) {
      const reason = opened.failures[0];
      return await streams.fail(reason, { kind: 'failed', failure: reason });
    }
    return await encodeThrough(opened.value, streams, context);
  } catch (error) {
    const end = endOfThrown(error, context.signal);
    if (end === undefined) {
      await streams.fail(JOB_FAULT, { kind: 'failed', failure: JOB_FAULT });
      throw error;
    }
    return await streams.fail(end.kind === 'failed' ? end.failure : WORK_CANCELLED, end);
  } finally {
    streams.close();
  }
}

/** Moves the rendered blocks through the opened encoder's writer until the render ends. */
async function encodeThrough(
  opened: OpenedExportEncoder,
  streams: EncodeStreams,
  context: JobContext,
): Promise<JobEnd> {
  const { writer } = opened;
  const { signal } = context;
  let frames = 0;
  for (;;) {
    const message = await streams.rendered.next(signal);
    if (!message.ok) {
      const reason = message.failures[0];
      return await streams.fail(reason, { kind: 'failed', failure: reason });
    }
    const rendered = message.value;
    if (rendered.kind === 'failed') {
      return await streams.fail(rendered.failure, { kind: 'failed', failure: rendered.failure });
    }
    if (rendered.kind === 'end') {
      if (rendered.frames !== frames) {
        const reason = framesDisagree(frames, rendered.frames);
        return await streams.fail(reason, { kind: 'failed', failure: reason });
      }
      return await finish(opened, streams, signal, rendered.frames);
    }
    const written = await writer.write(rendered.channels, rendered.frames, signal);
    if (!written.ok) {
      const reason = written.failures[0];
      return await streams.fail(reason, { kind: 'failed', failure: reason });
    }
    for (const bytes of written.value) {
      // The writer's bytes may lie in buffers it keeps, so a copy is what moves.
      const body = bytes.slice();
      const sent = await streams.encoded.send({ kind: 'body', bytes: body }, [body.buffer]);
      if (!sent.ok) {
        const reason = sent.failures[0];
        streams.rendered.refuse(reason);
        return { kind: 'failed', failure: reason };
      }
    }
    frames += rendered.frames;
    context.progress(frames);
  }
}

/** Ends the file: its head and tail, after every body byte. */
async function finish(
  { writer, encoder }: OpenedExportEncoder,
  streams: EncodeStreams,
  signal: CancellationSignal,
  frames: number,
): Promise<JobEnd> {
  const finished = await writer.finish(signal);
  if (!finished.ok) {
    const reason = finished.failures[0];
    return await streams.fail(reason, { kind: 'failed', failure: reason });
  }
  const sent = await streams.encoded.send({ kind: 'finished', file: finished.value }, []);
  if (!sent.ok) return { kind: 'failed', failure: sent.failures[0] };
  const total = sampleCount(frames);
  return total.ok
    ? { kind: 'encoded', frames: total.value, encoder }
    : { kind: 'failed', failure: total.failures[0] };
}
