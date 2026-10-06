/**
 * Receiving a pack's files into the store (ADR-0062): what is missing of each
 * file, in the manifest's order, one file at a time, from where the store's
 * bytes of it end, so a pause, a failure or a restart loses nothing that
 * arrived and a resume asks the source only for the rest.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import { refOf, type ModelPackManifest } from './manifest.js';
import { sourceOverran, type PackSource } from './pack-source.js';
import type { PackStore } from './pack-store.js';

/**
 * Stages `manifest`'s version in `store` and answers the bytes kept of it, file
 * by file in order, which a download, a resume or a retry counts from.
 */
export async function stagedTotal(
  store: PackStore,
  manifest: ModelPackManifest,
): Promise<DomainResult<number>> {
  const staging = await store.stage(manifest);
  if (!staging.ok) return staging;
  let received = 0;
  for (const [index, file] of manifest.files.entries()) {
    const kept = await store.stagedBytes(refOf(manifest), index);
    if (!kept.ok) return kept;
    received += Math.min(kept.value, file.bytes);
  }
  return succeed(received);
}

/** How a download of every file ended. */
export type Arrival =
  | { readonly kind: 'arrived' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'failed'; readonly result: DomainFailureResult };

/** A storage refusal met through a sink, which rejects where the store's methods answer. */
function storageRefused(refusal: TreeFailure): DomainFailure {
  return failure(
    'model-pack.storage-refused',
    // A full storage may take the write once room is made; an unreachable one
    // will not until the platform lets it.
    refusal.kind === TreeFailureKind.Unavailable
      ? FailureKind.Unrecoverable
      : FailureKind.Retryable,
    'The storage refused to keep the pack.',
    { details: { refusal: refusal.kind } },
  );
}

/** Runs a sink's work, answering the storage's refusal as a result. */
async function sinkWork(work: () => Promise<void>): Promise<DomainResult<void>> {
  try {
    await work();
    return succeed(undefined);
  } catch (error) {
    if (error instanceof TreeFailure) return fail(storageRefused(error));
    throw error;
  }
}

/**
 * Receives what is missing of each file of `manifest`, in order and one at a
 * time, from where the store's bytes of it end, keeping every run that arrives;
 * `from` is the bytes already kept, which `progressed` is told the count grows
 * from.
 */
export async function receiveMissing(
  store: PackStore,
  manifest: ModelPackManifest,
  source: PackSource,
  from: number,
  progressed: (received: number) => void,
  signal: AbortSignal,
): Promise<Arrival> {
  const ref = refOf(manifest);
  let received = from;
  for (const [index, file] of manifest.files.entries()) {
    const kept = await store.stagedBytes(ref, index);
    if (!kept.ok) return { kind: 'failed', result: kept };
    // More than the file holds cannot be appended to; the check refuses it.
    if (kept.value >= file.bytes) continue;
    const sink = await store.append(ref, index);
    if (!sink.ok) return { kind: 'failed', result: sink };

    let written = kept.value;
    const range = { pack: manifest, file, offset: kept.value };
    const read = await source.read(
      range,
      async (chunk) => {
        // The source is held to its file's end here too, since the store
        // keeps whatever it is handed.
        if (written + chunk.length > file.bytes) return sourceOverran(range);
        const wrote = await sinkWork(async () => {
          await sink.value.write(chunk);
        });
        if (!wrote.ok) return wrote;
        written += chunk.length;
        received += chunk.length;
        progressed(received);
        return succeed(undefined);
      },
      signal,
    );
    // Closed however the run ended, so every byte it took is kept for a
    // resume: a sink only grows, so a write the storage refused part way
    // leaves the bytes before it as they were, and the check reads them all.
    const ending = await sinkWork(async () => {
      await sink.value.close();
    });
    if (signal.aborted) return { kind: 'stopped' };
    if (!read.ok) return { kind: 'failed', result: read };
    if (!ending.ok) return { kind: 'failed', result: ending };
  }
  return { kind: 'arrived' };
}
