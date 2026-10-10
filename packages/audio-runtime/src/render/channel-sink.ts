/**
 * A render sink in the render worker that sends its chunks over a message
 * port straight to the worker consuming them, as an export's blocks go to the
 * codec worker without passing through the page (ADR-0092).
 *
 * The channel speaks import-export's rendered stream: blocks, then one end
 * with the frames rendered or the failure that ended the render, each sent
 * only on the receiver's credit, the end included (`stream-messages.ts`). The
 * renderer overwrites a block once its write settles, so each chunk is copied
 * into arrays of its own and those are transferred. A write waits for credit,
 * so a slow encoder slows the render rather than a queue of audio growing; a
 * receiver that refuses stops the render with its reason, and a cancelled
 * render's waiting write rejects with the cancellation. The render worker
 * ends the channel once the render ends, and closes it.
 */

import {
  FailureKind,
  cancellationReason,
  failure,
  type CancellationSignal,
  type DomainFailure,
  type SampleCount,
} from '@audiogubbins/domain';
import type { AudioFrameBlock, MessagePortLike, RenderSink } from '@audiogubbins/audio-engine';
import { readStreamReceiverMessage, type RenderedStreamMessage } from '@audiogubbins/import-export';

/** A sink whose chunks go over `port`, and the ends of the channel. */
export class ChannelSink implements RenderSink {
  readonly #port: MessagePortLike;
  readonly #signal: CancellationSignal;
  #credit = 0;
  #refusal: DomainFailure | undefined;
  /** The renderer writes one chunk at a time, and the end follows the last, so one waits at most. */
  #waiting: (() => void) | undefined;
  #closed = false;
  /** Whether the end is being sent, which is sent once. */
  #ending = false;

  constructor(port: MessagePortLike, signal: CancellationSignal) {
    this.#port = port;
    this.#signal = signal;
    port.addEventListener('message', (event) => {
      this.#reply(event.data);
    });
    port.addEventListener('messageerror', () => {
      this.#refuse(
        failure(
          'render.stream-reply-unreceivable',
          FailureKind.Unrecoverable,
          "A reply from the rendered audio's receiver could not be received.",
        ),
      );
    });
    port.start();
  }

  async write(block: AudioFrameBlock): Promise<void> {
    await this.#creditGranted(this.#signal);
    if (this.#refusal !== undefined) {
      // A plain error, as the engine throws for a source it cannot read: the
      // render worker fails the job with it rather than raising a fault.
      throw new Error(`The rendered audio's receiver refused it: ${this.#refusal.summary}`);
    }
    const channels = block.channels.map((channel) => channel.slice(0, block.frames));
    this.#send(
      { kind: 'block', channels, frames: block.frames },
      channels.map((channel) => channel.buffer),
    );
  }

  /** Ends the channel after the last chunk, on the receiver's credit: the render made `frames` frames. */
  async end(frames: SampleCount): Promise<void> {
    await this.#endWith({ kind: 'end', frames }, this.#signal);
  }

  /**
   * Ends the channel with the failure that ended the render, once the
   * receiver's credit allows, whether or not the render was cancelled: the
   * receiver is told why no more is coming. The render's job does not wait
   * on it, and the worker that ends with the job ends the wait too.
   */
  abandon(reason: DomainFailure): void {
    void this.#endWith({ kind: 'failed', failure: reason }, undefined);
  }

  /** Closes the port, ending any wait for credit. A second call does nothing. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#port.close();
    this.#wake();
  }

  async #endWith(
    message: RenderedStreamMessage,
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    if (this.#closed || this.#ending) return;
    this.#ending = true;
    try {
      await this.#creditGranted(signal);
      if (this.#refusal === undefined) this.#send(message, []);
    } finally {
      this.close();
    }
  }

  #send(message: RenderedStreamMessage, transfer: ArrayBuffer[]): void {
    if (this.#closed) return;
    this.#credit -= 1;
    this.#port.postMessage(message, transfer);
  }

  #reply(data: unknown): void {
    const read = readStreamReceiverMessage(data);
    if (!read.ok) this.#refuse(read.failures[0]);
    else if (read.value.kind === 'refused') this.#refuse(read.value.failure);
    else this.#credit += read.value.credit;
    this.#wake();
  }

  #refuse(reason: DomainFailure): void {
    this.#refusal ??= reason;
    this.#wake();
  }

  #wake(): void {
    const wake = this.#waiting;
    this.#waiting = undefined;
    wake?.();
  }

  /** Waits until there is credit, the receiver refused, or the channel closed; rejects when `signal` is cancelled. */
  async #creditGranted(signal: CancellationSignal | undefined): Promise<void> {
    while (this.#credit === 0 && this.#refusal === undefined && !this.#closed) {
      await new Promise<void>((resolve, reject) => {
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
        this.#waiting = () => {
          signal.removeEventListener('abort', abandon);
          resolve();
        };
      });
    }
  }
}
