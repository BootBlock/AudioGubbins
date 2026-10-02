/**
 * Writing a bundle or a backup for the user to download, where the browser
 * cannot write into a file or folder they chose (REQ-STOR-105, REQ-EXEC-216).
 *
 * Each chunk becomes a `Blob` as it arrives, which copies it, so the caller may
 * reuse its buffer at once, and which the browser may keep on disk rather than
 * in memory; the whole is joined only by reference. The application makes the
 * download from the finished blob, since starting one is the page's business,
 * not storage's.
 */

import type { ByteSink } from '@audiogubbins/project-format';

import { unshared } from './array-buffer-views.js';

/** A sink whose bytes, once it closes, are one `Blob` (see the module comment). */
export class BlobSink implements ByteSink {
  readonly #mediaType: string;
  readonly #parts: Blob[] = [];
  #state: 'open' | 'closed' | 'aborted' = 'open';

  /** Makes a sink whose blob is of the media type, such as `application/zip`. */
  constructor(mediaType: string) {
    this.#mediaType = mediaType;
  }

  write(chunk: Uint8Array): Promise<void> {
    return this.#whileOpen(() => {
      this.#parts.push(new Blob([unshared(chunk)]));
    });
  }

  close(): Promise<void> {
    return this.#whileOpen(() => {
      this.#state = 'closed';
    });
  }

  abort(): Promise<void> {
    return this.#whileOpen(() => {
      this.#state = 'aborted';
      this.#parts.length = 0;
    });
  }

  /** Everything written, once the sink has closed. */
  blob(): Blob {
    if (this.#state !== 'closed') throw new Error('A sink has a whole blob only once it closes.');
    return new Blob(this.#parts, { type: this.#mediaType });
  }

  /** Takes a step while the sink is open, and rejects, as the port does, once it is not. */
  #whileOpen(step: () => void): Promise<void> {
    if (this.#state !== 'open') {
      return Promise.reject(new Error('A sink cannot be used once it is closed or aborted.'));
    }
    step();
    return Promise.resolve();
  }
}
