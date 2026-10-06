/**
 * The preview worker's end of one reader's port: it opens the renders the
 * reader asks for from the producer, answers each read once the render has
 * made its frames, and lets go of everything the reader held when the reader
 * closes a render or the port is let go (`preview-messages.ts`).
 *
 * A message it cannot read is answered where it can be, so no read waits for
 * ever on a message that was lost: a read of a stream it does not hold fails
 * with the reason, and an unreadable message closes the reader's port, which
 * fails everything the reader waits on there.
 */

import {
  createCancellationSource,
  type CancellationSource,
  type DomainFailure,
} from '@audiogubbins/domain';

import type { CachedStream, CachedStreams } from '../pcm/cached-streams.js';
import { MediaReadFailure } from '../pcm/plan-content.js';
import {
  FromPreviewKind,
  ToPreviewKind,
  readToPreview,
  type CrossedFailure,
  type FromPreview,
  type ToPreview,
} from './preview-messages.js';
import type { PreviewPort } from './preview-port.js';

/** The code and summary of a failure, which a structured clone can carry. */
function crossed({ code, summary }: DomainFailure): CrossedFailure {
  return { code, summary };
}

/** One reader's renders and reads, served over its port. */
export class PreviewService {
  readonly #port: PreviewPort<FromPreview>;
  readonly #renders: CachedStreams;
  readonly #streams = new Map<number, CachedStream>();
  readonly #reads = new Map<
    number,
    { readonly stream: number; readonly cancel: CancellationSource }
  >();
  #closed = false;

  constructor(port: PreviewPort<FromPreview>, renders: CachedStreams) {
    this.#port = port;
    this.#renders = renders;
    port.listen(
      (data) => {
        this.#receive(data);
      },
      () => {
        this.close();
      },
    );
  }

  /** Lets go of every render the reader holds, and of the port. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const read of this.#reads.values()) read.cancel.cancel();
    this.#reads.clear();
    for (const stream of this.#streams.values()) stream.release();
    this.#streams.clear();
    this.#port.close();
  }

  #receive(data: unknown): void {
    const read = readToPreview(data);
    // A reader that sends what this cannot read is a wiring fault: whatever it
    // waits on would wait for ever, so its port is let go, failing it all.
    if (!read.ok) this.close();
    else this.#act(read.value);
  }

  #act(message: ToPreview): void {
    switch (message.kind) {
      case ToPreviewKind.Open:
        this.#open(message);
        return;
      case ToPreviewKind.Read:
        void this.#read(message);
        return;
      case ToPreviewKind.Cancel:
        this.#reads.get(message.read)?.cancel.cancel();
        this.#reads.delete(message.read);
        return;
      case ToPreviewKind.Close:
        this.#streams.get(message.stream)?.release();
        this.#streams.delete(message.stream);
        for (const [id, read] of this.#reads) {
          if (read.stream !== message.stream) continue;
          read.cancel.cancel();
          this.#reads.delete(id);
        }
    }
  }

  #open(message: Extract<ToPreview, { readonly kind: typeof ToPreviewKind.Open }>): void {
    this.#streams.get(message.stream)?.release();
    const stream = this.#renders.open({
      plan: message.plan,
      place: message.place,
      media: message.media,
      quality: message.quality,
      ...(message.reason === undefined ? {} : { reason: message.reason }),
    });
    this.#streams.set(message.stream, stream);
    void stream.ready.then((ready) => {
      this.#post({
        kind: FromPreviewKind.Ready,
        stream: message.stream,
        declined: ready.ok ? undefined : crossed(ready.failures[0]),
      });
    });
  }

  async #read(message: Extract<ToPreview, { readonly kind: typeof ToPreviewKind.Read }>) {
    const stream = this.#streams.get(message.stream);
    if (stream === undefined) {
      this.#post({
        kind: FromPreviewKind.ReadFailed,
        read: message.read,
        failure: {
          code: 'preview.stream-not-open',
          summary: 'A render was read that was not open, or was closed.',
        },
      });
      return;
    }
    const cancel = createCancellationSource();
    this.#reads.set(message.read, { stream: message.stream, cancel });
    const channels = Array.from(
      { length: message.channels },
      () => new Float32Array(message.frames),
    );
    try {
      await stream.read(message.start, message.frames, channels, cancel.signal);
      if (!this.#reads.delete(message.read)) return;
      this.#post(
        { kind: FromPreviewKind.Samples, read: message.read, channels },
        channels.map((channel) => channel.buffer),
      );
    } catch (error) {
      if (!this.#reads.delete(message.read)) return;
      this.#post({
        kind: FromPreviewKind.ReadFailed,
        read: message.read,
        failure:
          error instanceof MediaReadFailure
            ? crossed(error.failure)
            : {
                code: 'preview.read-fault',
                summary: error instanceof Error ? error.message : String(error),
              },
      });
    }
  }

  #post(message: FromPreview, transfer: readonly ArrayBuffer[] = []): void {
    if (!this.#closed) this.#port.post(message, transfer);
  }
}
