/**
 * Which of REQ-AUDIO-139's conditions holds for each machine-learning
 * processor a project names, as this page can tell (ADR-0062).
 *
 * Decided by the model packs' own rule (`availabilityOf`) from what the
 * installer keeps, read from the storage worker, the runtime this build ships,
 * what the device offers local inference, as the capabilities registry says,
 * and the browser's SHA-256 a pack's model hash is taken with. The catalogue is
 * not asked: opening a project fetches nothing, and no automatic download is
 * offered, so a missing pack is a required model unavailable until the person
 * installs it. The answer is read again whenever an installation changes, so a
 * pack installed or removed is reflected at once. A browser that keeps no packs
 * runs no model at all (`NO_PACK_STORAGE`).
 *
 * A processor that cannot run is unavailable with its condition and reason;
 * the project stays valid, its instances keep their settings, and what they
 * process is shown as unavailable, saying why, until the pack is present.
 */

import type { LocalInferenceSupport } from '@audiogubbins/model-packs';
import {
  availabilityOf,
  nobleTextSha256,
  type AvailabilityContext,
  type Installation,
  type PackAvailability,
} from '@audiogubbins/model-packs';
import type { RuntimeIdentity } from '@audiogubbins/ml-runtime';
import { succeed, type DomainResult, type ProcessorInstance } from '@audiogubbins/domain';

import { observable, type Observable } from '../state/observable.js';

/** What the installer keeps, as the storage client answers it. */
export interface InstalledPacks {
  installations(signal?: AbortSignal): Promise<DomainResult<readonly Installation[]>>;
  /** Hears each change of an installation, until the answer is called. */
  listen(listener: () => void): () => void;
}

/** What availability is decided from, beside what the installer keeps. */
export interface AvailabilityParts {
  /** What the installer keeps, absent where this browser keeps no packs. */
  readonly packs: InstalledPacks | undefined;
  /** The runtime this build ships, loaded when first needed. */
  readonly runtime: () => Promise<RuntimeIdentity>;
  /** What the device offers local inference, read when it is needed. */
  readonly device: () => LocalInferenceSupport;
  /**
   * Told why availability could not be read, which leaves it unknown: no
   * entry is refused for it, and a render that finds a model missing says so.
   */
  readonly unknown: (reason: string) => void;
}

/**
 * What local inference can do in a browser that keeps no model packs: nothing,
 * since a model runs only from a pack kept and checked here. Of REQ-AUDIO-139's
 * five conditions that is a model unavailable because of the browser's
 * capability, not a required model unavailable: no pack can be installed in
 * this browser, so installing one is no remedy, and a person told the model is
 * missing would look for one to install.
 */
export const NO_PACK_STORAGE: LocalInferenceSupport = {
  status: 'unavailable',
  explanation: 'This browser cannot keep model packs, so no model can run in it.',
  missingRequired: [],
  missingPreferred: [],
};

/** How far the page can tell availability: not yet, or from a context. */
export type KnownAvailability =
  { readonly kind: 'unknown' } | { readonly kind: 'known'; readonly context: AvailabilityContext };

/** Availability as the page knows it, and what reads it afresh. */
export interface ModelAvailabilityStore extends Observable<KnownAvailability> {
  /** The context as the installer keeps it now, read afresh. */
  readonly current: (signal?: AbortSignal) => Promise<DomainResult<AvailabilityContext>>;
  readonly dispose: () => void;
}

/** The context of `installations`, with what else availability needs. */
function contextOf(
  installations: readonly Installation[],
  runtime: RuntimeIdentity,
  parts: AvailabilityParts,
): AvailabilityContext {
  return {
    packs: installations.flatMap(({ manifest, state }) =>
      manifest === undefined ? [] : [{ manifest, state }],
    ),
    catalogue: [],
    runtime,
    device: parts.packs === undefined ? NO_PACK_STORAGE : parts.device(),
    sha256: nobleTextSha256,
  };
}

/**
 * The store (see the module comment), read when first listened to and again
 * whenever an installation changes.
 */
export function createModelAvailabilityStore(parts: AvailabilityParts): ModelAvailabilityStore {
  const value = observable<KnownAvailability>({ kind: 'unknown' });
  const current = async (signal?: AbortSignal): Promise<DomainResult<AvailabilityContext>> => {
    const runtime = await parts.runtime();
    if (parts.packs === undefined) return succeed(contextOf([], runtime, parts));
    const read = await parts.packs.installations(signal);
    return read.ok ? succeed(contextOf(read.value, runtime, parts)) : read;
  };
  let reading = 0;
  const refresh = (): void => {
    reading += 1;
    const mine = reading;
    current().then(
      (read) => {
        // A later reading answers for a later state.
        if (mine === reading && read.ok) value.set({ kind: 'known', context: read.value });
        else if (!read.ok) parts.unknown(read.failures[0].summary);
      },
      (error: unknown) => {
        parts.unknown(error instanceof Error ? error.message : String(error));
      },
    );
  };
  // Read once something listens, and followed from then on, so a page that
  // shows no project reads nothing of the packs or the runtime.
  let stopListening: (() => void) | undefined;
  return {
    get: value.get,
    subscribe: (listener) => {
      if (stopListening === undefined) {
        stopListening = parts.packs?.listen(refresh) ?? ((): void => undefined);
        refresh();
      }
      return value.subscribe(listener);
    },
    current,
    dispose: () => {
      stopListening?.();
    },
  };
}

/**
 * Which condition holds for `processor`, or nothing where it runs no model;
 * every machine-learning processor needs its model, the one its instance was
 * made with.
 */
export function processorAvailability(
  processor: ProcessorInstance,
  context: AvailabilityContext,
): PackAvailability | undefined {
  const model = processor.version.model;
  if (model === undefined) return undefined;
  return availabilityOf(
    { role: 'processor', typeKey: processor.typeKey, required: true, model },
    context,
  );
}
