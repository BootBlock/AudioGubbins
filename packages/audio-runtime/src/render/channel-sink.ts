/**
 * A render sink in the render worker that sends its chunks over a message
 * port straight to the worker consuming them, as an export's blocks go to the
 * codec worker without passing through the page (ADR-0092).
 *
 * The renderer overwrites a block once its write settles, so each chunk is
 * copied into arrays of its own and those are transferred. A write waits for
 * the consumer's credit (`rendered-block-messages.ts`), so a slow encoder
 * slows the render rather than a queue of audio growing. A consumer that
 * refuses stops the render with its reasons, and a cancelled render's waiting
 * write rejects with the cancellation. The render worker ends the channel
 * once the render ends, with its length or its failures, and closes it.
 */

import {
  FailureKind,
  cancellationReason,
  failure,
  type CancellationSignal,
  type DomainFailure,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  BlockReplyKind,
  RenderedBlockKind,
  readRenderedBlockReply,
  type AudioFrameBlock,
  type MessagePortLike,
  type RenderSink,
  type RenderedBlockMessage,
} from '@audiogubbins/audio-engine';

/** A sink whose chunks go over `port`, and the ends of the channel. */
export class ChannelSink implements RenderSink {
  readonly #port: MessagePortLike;
  readonly #signal: CancellationSignal;
  #credit = 0;
  #refusal: readonly DomainFailure[] | undefined;
  /** The renderer writes one chunk at a time, so at most one write waits. */
  #waiting: (() => void) | undefined;
  #closed = false;

  constructor(port: MessagePortLike, signal: CancellationSignal) {
    this.#port = port;
    this.#signal = signal;
    port.addEventListener('message', (event) => {
      this.#reply(event.data);
    });
    port.addEventListener('messageerror', () => {
      this.#refuse([
        failure(
          'render.block-reply-unreceivable',
          FailureKind.Unrecoverable,
          "A reply from the rendered audio's consumer could not be received.",
        ),
      ]);
    });
    port.start();
  }

  async write(block: AudioFrameBlock): Promise<void> {
    while (this.#credit === 0 && this.#refusal === undefined) await this.#creditGranted();
    if (this.#refusal !== undefined) {
      // A plain error, as the engine throws for a source it cannot read: the
      // render worker fails the job with it rather than raising a fault.
      throw new Error(
        `The rendered audio's consumer refused it: ${this.#refusal.map((one) => one.summary).join(' ')}`,
      );
    }
    this.#credit -= 1;
    const channels = block.channels.map((channel) => channel.slice(0, block.frames));
    this.#send(
      { kind: RenderedBlockKind.Block, channels },
      channels.map((channel) => channel.buffer),
    );
  }

  /** Ends the channel after the last chunk: the render made `frames` frames. */
  end(frames: SampleCount): void {
    this.#send({ kind: RenderedBlockKind.End, frames }, []);
    this.close();
  }

  /** Ends the channel with the failures that ended the render. */
  abandon(failures: readonly [DomainFailure, ...DomainFailure[]]): void {
    this.#send({ kind: RenderedBlockKind.Failed, failures }, []);
    this.close();
  }

  /** Closes the port. A second call does nothing. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#port.close();
  }

  #send(message: RenderedBlockMessage, transfer: ArrayBuffer[]): void {
    // A consumer that refused has gone; what it was sent after is nobody's.
    if (this.#closed || this.#refusal !== undefined) return;
    this.#port.postMessage(message, transfer);
  }

  #reply(data: unknown): void {
    const read = readRenderedBlockReply(data);
    if (!read.ok) {
      this.#refuse(read.failures);
      return;
    }
    const reply = read.value;
    if (reply.kind === BlockReplyKind.Refused) this.#refuse(reply.failures);
    else this.#credit += reply.blocks;
    this.#wake();
  }

  #refuse(failures: readonly DomainFailure[]): void {
    this.#refusal ??= failures;
    this.#wake();
  }

  #wake(): void {
    const wake = this.#waiting;
    this.#waiting = undefined;
    wake?.();
  }

  #creditGranted(): Promise<void> {
    const signal = this.#signal;
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(cancellationReason(signal));
        return;
      }
      const abandon = (): void => {
        this.#waiting = undefined;
        reject(cancellationReason(signal));
      };
      signal.addEventListener('abort', abandon, { once: true });
      this.#waiting = () => {
        signal.removeEventListener('abort', abandon);
        resolve();
      };
    });
  }
}
