/**
 * The codec worker's end of a rendered-block channel (ADR-0092): an export's
 * blocks, sent by the render worker straight over a port, written to the
 * export's encoder one at a time, in order, and the body bytes each answers
 * handed on before the next block is asked for.
 *
 * Credit is how far the render may run ahead: {@link BLOCKS_AHEAD} blocks at
 * the start, then one more for each block written and handed on, so the
 * render waits on a slow encoder or a slow store rather than a queue of audio
 * growing (G4). The channel ends with the render's length, which must be the
 * frames written, or with the render's failures. An encoder that fails, a
 * hand-off that fails, a message that cannot be read and a cancellation each
 * refuse the channel, which stops the render, and end the intake.
 */

import {
  BlockReplyKind,
  RenderedBlockKind,
  readRenderedBlockMessage,
  type MessagePortLike,
  type RenderedBlockMessage,
  type RenderedBlockReply,
} from '@audiogubbins/audio-engine';
import type { AudioFileWriter, FinishedAudioFile } from '@audiogubbins/codecs';
import {
  FailureKind,
  cancellationReason,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

/** The blocks the render may send before the first is written. */
const BLOCKS_AHEAD = 2;

/** What an intake made: the finished file's head and tail, and the frames written. */
export interface EncodedRender {
  readonly file: FinishedAudioFile;
  readonly frames: number;
}

/** The next message, or the failure of one that could not be received. */
type Arrival = DomainResult<RenderedBlockMessage>;

/** The messages arrived and not yet taken, and the one take waiting for the next. */
class Arrivals {
  readonly #queue: Arrival[] = [];
  #waiting: ((arrival: Arrival) => void) | undefined;

  push(arrival: Arrival): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (waiting === undefined) this.#queue.push(arrival);
    else waiting(arrival);
  }

  next(signal: CancellationSignal | undefined): Promise<Arrival> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      if (signal === undefined) {
        this.#waiting = resolve;
        return;
      }
      if (signal.aborted) {
        reject(cancellationReason(signal));
        return;
      }
      const abandon = (): void => {
        this.#waiting = undefined;
        reject(cancellationReason(signal));
      };
      signal.addEventListener('abort', abandon, { once: true });
      this.#waiting = (arrival) => {
        signal.removeEventListener('abort', abandon);
        resolve(arrival);
      };
    });
  }
}

const unreceivable = failure(
  'codec-runtime.block-unreceivable',
  FailureKind.Unrecoverable,
  'A rendered block could not be received by the codec worker.',
);

const cancelled = failure(
  'codec-runtime.encoding-cancelled',
  FailureKind.Rejected,
  'The export was cancelled.',
);

function lengthDiffers(stated: number, written: number): DomainFailure {
  return failure(
    'codec-runtime.render-length-differs',
    FailureKind.IntegrityViolation,
    `The render says it made ${String(stated)} frames, and ${String(written)} were written.`,
    { details: { stated, written } },
  );
}

/** What a block came to: written and handed on, or the failures that refuse the channel. */
type Written = DomainResult<number>;

/** One channel's blocks, written in order. */
class BlockIntake {
  readonly #port: MessagePortLike;
  readonly #writer: AudioFileWriter;
  readonly #handOn: (body: readonly Uint8Array[]) => Promise<DomainResult<undefined>>;
  readonly #signal: CancellationSignal | undefined;
  readonly #arrivals = new Arrivals();
  #frames = 0;

  constructor(
    port: MessagePortLike,
    writer: AudioFileWriter,
    handOn: (body: readonly Uint8Array[]) => Promise<DomainResult<undefined>>,
    signal: CancellationSignal | undefined,
  ) {
    this.#port = port;
    this.#writer = writer;
    this.#handOn = handOn;
    this.#signal = signal;
    port.addEventListener('message', (event) => {
      this.#arrivals.push(readRenderedBlockMessage(event.data));
    });
    port.addEventListener('messageerror', () => {
      this.#arrivals.push(fail(unreceivable));
    });
    port.start();
  }

  async run(): Promise<DomainResult<EncodedRender>> {
    this.#reply({ kind: BlockReplyKind.Credit, blocks: BLOCKS_AHEAD });
    try {
      for (;;) {
        const arrival = await this.#arrivals.next(this.#signal);
        if (!arrival.ok) return this.#refused(arrival.failures);
        const message = arrival.value;
        switch (message.kind) {
          case RenderedBlockKind.Block: {
            const written = await this.#write(message.channels);
            if (!written.ok) return this.#refused(written.failures);
            break;
          }
          case RenderedBlockKind.End:
            return await this.#end(message.frames);
          case RenderedBlockKind.Failed:
            this.#port.close();
            return fail(...message.failures);
        }
      }
    } catch (error) {
      // A cancellation is the export's, and the render is told to stop; any
      // other throw is a fault in this runtime, raised as itself.
      if (this.#signal?.aborted === true) this.#refused([cancelled]);
      throw error;
    }
  }

  /** Writes a block and hands its body on, then grants credit for another. */
  async #write(channels: readonly Float32Array[]): Promise<Written> {
    const count = channels[0]?.length ?? 0;
    const body = await this.#writer.write(channels, count, this.#signal);
    if (!body.ok) return body;
    const handed = await this.#handOn(body.value);
    if (!handed.ok) return handed;
    this.#frames += count;
    this.#reply({ kind: BlockReplyKind.Credit, blocks: 1 });
    return succeed(count);
  }

  /** Finishes the file once the render says it made the frames written. */
  async #end(stated: number): Promise<DomainResult<EncodedRender>> {
    this.#port.close();
    if (stated !== this.#frames) return fail(lengthDiffers(stated, this.#frames));
    const finished = await this.#writer.finish(this.#signal);
    return finished.ok ? succeed({ file: finished.value, frames: this.#frames }) : finished;
  }

  #reply(message: RenderedBlockReply): void {
    this.#port.postMessage(message, []);
  }

  #refused(failures: readonly [DomainFailure, ...DomainFailure[]]): DomainResult<never> {
    this.#reply({ kind: BlockReplyKind.Refused, failures });
    this.#port.close();
    return fail(...failures);
  }
}

/**
 * Writes the blocks `port` brings to `writer`, handing each block's body
 * bytes to `handOn` before granting credit for another, until the render
 * ends; answers the finished file, or why there is none. Cancelling `signal`
 * refuses the channel and rejects with its reason.
 */
export async function encodeRenderedBlocks(
  port: MessagePortLike,
  writer: AudioFileWriter,
  handOn: (body: readonly Uint8Array[]) => Promise<DomainResult<undefined>>,
  signal?: CancellationSignal,
): Promise<DomainResult<EncodedRender>> {
  return await new BlockIntake(port, writer, handOn, signal).run();
}
