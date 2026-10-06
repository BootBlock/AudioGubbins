/**
 * A machine-learning processor's pinned golden render (ADR-0062): the real
 * inference runtime, in Node, running the pack's own files from the pack
 * cache (`pack-cache.ts`), over a signal the test makes, the output held to
 * one SHA-256 of its samples' bytes.
 *
 * Goldens run in their own project, `ml-golden`, never in `pnpm test`, since
 * they need the packs' files: `pnpm test:ml-golden`, with
 * `AUDIOGUBBINS_PACK_CACHE` naming the cache.
 */

import { expectSuccess } from '@audiogubbins/domain/testing';
import { realInference } from '@audiogubbins/ml-runtime/testing';

import type { ProcessorType } from '../framework/processor-type.js';
import { PINNED_RUNTIME_SHA256, type ModelDefinition } from '../ml/model-definition.js';
import type { ModelServices } from '../ml/model-sessions.js';
import { modelPassOf, passOver } from './model-runs.js';
import { runtimeWebAssembly, sha256Of } from './model-services.js';
import { packCacheLibrary } from './pack-cache.js';
import type { RunSettings } from './processor-run.js';

/** What a golden render made: its length, the digest of its bytes, and how long it took. */
export interface GoldenRender {
  readonly frames: number;
  readonly digest: string;
  readonly seconds: number;
}

/**
 * The pass of the type `make` makes, over `model`'s pack from the cache on the
 * pinned runtime, for `settings`, over `input`, given in chunks of 16 384.
 */
export async function goldenRender(
  make: (services: ModelServices) => ProcessorType,
  model: ModelDefinition,
  settings: RunSettings,
  input: readonly Float32Array[],
): Promise<GoldenRender> {
  const type = make({
    inference: realInference(runtimeWebAssembly(), PINNED_RUNTIME_SHA256),
    models: packCacheLibrary(model.identity),
  });
  const started = performance.now();
  const measured = expectSuccess(await passOver(modelPassOf(type, settings), input, [16_384]));
  const seconds = (performance.now() - started) / 1_000;
  if (!(measured instanceof Float32Array)) throw new Error('A model pass makes samples.');
  const bytes = new Uint8Array(measured.buffer, measured.byteOffset, measured.byteLength);
  return { frames: measured.length, digest: sha256Of(bytes), seconds };
}
