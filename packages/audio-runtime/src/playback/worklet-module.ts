/**
 * The engine processor's module, added to each audio context once.
 *
 * A context needs the module before it can make the processor's node, and
 * only once: adding it again registers the processor's name a second time,
 * which the worklet refuses. Two loads that overlap share the one addition in
 * flight, and an addition that failed is tried again by the next load.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';

import type { AudioContextPort } from '../context/audio-context-port.js';

/** The processor's module, and the context it has been added to. */
export class WorkletModule {
  readonly #url: string;
  readonly #logger: Logger;
  #registration:
    { readonly port: AudioContextPort; readonly done: Promise<DomainResult<void>> } | undefined;

  constructor(url: string, logger: Logger) {
    this.#url = url;
    this.#logger = logger;
  }

  /** Adds the module to `port`, unless it has it or is being given it. */
  addTo(port: AudioContextPort): Promise<DomainResult<void>> {
    if (this.#registration?.port === port) return this.#registration.done;
    const done = this.#register(port);
    const added = { port, done };
    this.#registration = added;
    void done.then((result) => {
      if (!result.ok && this.#registration === added) this.#registration = undefined;
    });
    return done;
  }

  /** Forgets the context it was added to, which has gone. */
  forget(): void {
    this.#registration = undefined;
  }

  async #register(port: AudioContextPort): Promise<DomainResult<void>> {
    try {
      await port.audioWorklet.addModule(this.#url);
    } catch (error) {
      // The browser rejects a module it could not fetch or evaluate
      // (AbortError, a DOMException), which leaves nothing to play with.
      if (!(error instanceof Error || error instanceof DOMException)) throw error;
      this.#logger.error('The audio processor module could not be loaded.', {
        reason: error.message,
      });
      return fail(
        failure(
          'playback.processor-module-failed',
          FailureKind.Retryable,
          `The audio processor could not be loaded: ${error.message}`,
        ),
      );
    }
    return succeed(undefined);
  }
}
