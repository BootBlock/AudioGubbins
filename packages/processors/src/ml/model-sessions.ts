/**
 * The sessions one pass runs a model in: one for each file the model runs,
 * each opened once for the whole pass with the model's pinned options, from
 * bytes checked against the model's identity, on a runtime checked against it
 * too (ADR-0062).
 *
 * Whatever was opened before a refusal is let go before the refusal is
 * answered, and what was opened is let go together by
 * `ModelSessions.release`, so no path out of a pass leaves a session open.
 */

import {
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';
import type { InferencePort, InferenceSession } from '@audiogubbins/ml-runtime';

import { fileRefusal, runtimeRefusal, type ModelDefinition } from './model-definition.js';
import type { ModelLibrary } from './model-library.js';

/** What a machine-learning processor runs its model with, injected once. */
export interface ModelServices {
  readonly inference: InferencePort;
  readonly models: ModelLibrary;
}

/** A model's sessions, by the path of the file each runs. */
export class ModelSessions {
  readonly #sessions: ReadonlyMap<string, InferenceSession>;

  constructor(sessions: ReadonlyMap<string, InferenceSession>) {
    this.#sessions = sessions;
  }

  /** The session of the file `path`, one the model's definition names. */
  of(path: string): InferenceSession {
    const session = this.#sessions.get(path);
    // The definition names the files and every one was opened, so a path
    // missing here is a fault in the processor that asked.
    if (session === undefined) throw new Error(`The model has no session for ${path}.`);
    return session;
  }

  release(): void {
    for (const session of this.#sessions.values()) session.release();
  }
}

/**
 * The model `definition` names, opened in a session for each of its files, or
 * why it cannot be: a file the library cannot give or that is not the one the
 * build runs, a session the runtime refuses, or a runtime that is not the build
 * the model is pinned to. Files are read and opened one at a time, so a pass
 * holds one file's bytes at once beside the sessions. A cancellation throws, as
 * every cancelled pass does.
 */
export async function openModel(
  definition: ModelDefinition,
  services: ModelServices,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<ModelSessions>> {
  const { pack, version } = definition.identity;
  const opened = new Map<string, InferenceSession>();
  let kept = false;
  try {
    for (const { path } of definition.files) {
      const file = await services.models.file(pack, version, path, signal);
      throwIfCancelled(signal);
      if (!file.ok) return file;
      const checked = fileRefusal(definition, path, file.value);
      if (!checked.ok) return checked;
      const session = await services.inference.open(file.value.bytes, definition.inference, signal);
      if (session.ok) opened.set(path, session.value);
      throwIfCancelled(signal);
      if (!session.ok) return session;
      const runtime = runtimeRefusal(definition, session.value.execution);
      if (!runtime.ok) return runtime;
    }
    kept = true;
    return succeed(new ModelSessions(opened));
  } finally {
    // Refused, cancelled or failed part way, nothing opened may outlive the
    // pass that opened it.
    if (!kept) for (const session of opened.values()) session.release();
  }
}
