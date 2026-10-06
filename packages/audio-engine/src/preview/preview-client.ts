/**
 * The renders of the preview worker, as a reader in another worker reads them
 * (`cached-streams.ts`, `preview-messages.ts`).
 *
 * Each render opened is named on the port, and each read asks for its frames
 * and waits for them, which the preview worker answers once the render has
 * made them, so a read past what is made waits here as it would beside the
 * producer. A read cancelled stops waiting at once and tells the worker. A
 * reply that cannot be read, or a port that fails, fails every read and every
 * open waiting with the reason, since which of them it answered is unknown.
 */

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

import type { CachedStream, CachedStreamRequest, CachedStreams } from '../pcm/cached-streams.js';
import { MediaReadFailure } from '../pcm/plan-content.js';
import {
  FromPreviewKind,
  ToPreviewKind,
  readFromPreview,
  type CrossedFailure,
  type FromPreview,
  type ToPreview,
} from './preview-messages.js';
import type { PreviewPort } from './preview-port.js';

/** A read waiting for its frames. */
interface PendingRead {
  readonly into: readonly Float32Array[];
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function asFailure(crossed: CrossedFailure): DomainFailure {
  return failure(crossed.code, FailureKind.Rejected, crossed.summary);
}

/** The preview worker's renders over a port. */
export class PreviewClient implements CachedStreams {
  readonly #port: PreviewPort<ToPreview>;
  readonly #ready = new Map<number, (outcome: DomainResult<void>) => void>();
  readonly #reads = new Map<number, PendingRead>();
  #streams = 0;
  #readCount = 0;
  #broken: DomainFailure | undefined;

  constructor(port: PreviewPort<ToPreview>) {
    this.#port = port;
    port.listen(
      (data) => {
        this.#receive(data);
      },
      () => {
        this.#break('A message from the preview worker could not be received.');
      },
    );
  }

  open(request: CachedStreamRequest): CachedStream {
    this.#streams += 1;
    const stream = this.#streams;
    const ready = new Promise<DomainResult<void>>((resolve) => {
      if (this.#broken !== undefined) resolve(fail(this.#broken));
      else this.#ready.set(stream, resolve);
    });
    this.#post({
      kind: ToPreviewKind.Open,
      stream,
      plan: request.plan,
      place: request.place,
      media: request.media,
      quality: request.quality,
      reason: request.reason,
    });
    let released = false;
    return {
      ready,
      read: (start, frames, into, signal) => this.#read(stream, start, frames, into, signal),
      release: () => {
        if (released) return;
        released = true;
        this.#post({ kind: ToPreviewKind.Close, stream });
      },
    };
  }

  #read(
    stream: number,
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    if (this.#broken !== undefined) return Promise.reject(new MediaReadFailure(this.#broken));
    if (signal?.aborted === true) return Promise.reject(cancellationReason(signal));
    this.#readCount += 1;
    const read = this.#readCount;
    return new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        if (!this.#reads.delete(read) || signal === undefined) return;
        this.#post({ kind: ToPreviewKind.Cancel, read });
        reject(cancellationReason(signal));
      };
      this.#reads.set(read, {
        into,
        resolve: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.#post({ kind: ToPreviewKind.Read, stream, read, start, frames, channels: into.length });
    });
  }

  #receive(data: unknown): void {
    const read = readFromPreview(data);
    if (!read.ok) {
      this.#break(read.failures[0].summary);
      return;
    }
    this.#act(read.value);
  }

  #act(message: FromPreview): void {
    switch (message.kind) {
      case FromPreviewKind.Ready: {
        const settle = this.#ready.get(message.stream);
        this.#ready.delete(message.stream);
        settle?.(
          message.declined === undefined ? succeed(undefined) : fail(asFailure(message.declined)),
        );
        return;
      }
      case FromPreviewKind.Samples: {
        const pending = this.#reads.get(message.read);
        if (pending === undefined) return;
        this.#reads.delete(message.read);
        pending.into.forEach((channel, index) => {
          const from = message.channels[index];
          if (from !== undefined) channel.set(from.subarray(0, channel.length));
        });
        pending.resolve();
        return;
      }
      case FromPreviewKind.ReadFailed: {
        const pending = this.#reads.get(message.read);
        this.#reads.delete(message.read);
        pending?.reject(new MediaReadFailure(asFailure(message.failure)));
      }
    }
  }

  #post(message: ToPreview): void {
    if (this.#broken === undefined) this.#port.post(message, []);
  }

  /** Fails everything waiting, and everything after, with `summary`. */
  #break(summary: string): void {
    const broken = failure('preview.channel-failed', FailureKind.Unrecoverable, summary);
    this.#broken ??= broken;
    for (const settle of this.#ready.values()) settle(fail(broken));
    this.#ready.clear();
    for (const pending of this.#reads.values()) pending.reject(new MediaReadFailure(broken));
    this.#reads.clear();
  }
}
