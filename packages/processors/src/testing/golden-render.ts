/**
 * A machine-learning processor's pinned golden render (ADR-0062) in Node: the
 * real inference runtime running the pack's own files from the pack cache
 * (`pack-cache.ts`), over the case's signal (`ml-goldens.ts`), the output
 * held to the case's SHA-256 of its samples' bytes, as every browser's is.
 *
 * Goldens run in their own project, `ml-golden`, never in `pnpm test`, since
 * they need the packs' files: `pnpm test:ml-golden`, with
 * `AUDIOGUBBINS_PACK_CACHE` naming the cache.
 */

import { realInference } from '@audiogubbins/ml-runtime/testing';

import { PINNED_RUNTIME_SHA256 } from '../ml/model-definition.js';
import { goldenSamples, type MlGolden } from './ml-goldens.js';
import { runtimeWebAssembly, sha256Of } from './model-services.js';
import { packCacheLibrary } from './pack-cache.js';

/** What a golden render made: its length, the digest of its bytes, and how long it took. */
export interface GoldenRender {
  readonly frames: number;
  readonly digest: string;
  readonly seconds: number;
}

/**
 * `golden`'s render (`ml-goldens.ts`), over its model's pack from the cache
 * on the pinned runtime.
 */
export async function goldenRender(golden: MlGolden): Promise<GoldenRender> {
  const services = {
    inference: realInference(runtimeWebAssembly(), PINNED_RUNTIME_SHA256),
    models: packCacheLibrary(golden.model.identity),
  };
  const started = performance.now();
  const measured = await goldenSamples(golden, services);
  const seconds = (performance.now() - started) / 1_000;
  const bytes = new Uint8Array(measured.buffer, measured.byteOffset, measured.byteLength);
  return { frames: measured.length, digest: sha256Of(bytes), seconds };
}
