/**
 * The inference runtime this build ships, as the build took it from the bytes
 * it serves (`inference-runtime.ts` beside the build configuration): where its
 * WebAssembly is served on the application's own origin and its SHA-256, and
 * the identity a pinned render records.
 *
 * Reached by `import()` alone, from `model-services.ts`, as the engine's
 * modules are: the build makes this module's source, and nothing that only
 * looks at the page needs it.
 */

import type { RuntimeIdentity, RuntimeSetup } from '@audiogubbins/ml-runtime';
import {
  INFERENCE_RUNTIME_PATH,
  INFERENCE_RUNTIME_SHA256,
  INFERENCE_RUNTIME_VERSION,
} from 'virtual:audiogubbins/inference-runtime';

/** The runtime this build ships, by the digest of the WebAssembly a pinned render runs. */
export const RUNTIME_IN_USE: RuntimeIdentity = {
  name: 'onnxruntime-web',
  version: INFERENCE_RUNTIME_VERSION,
  webAssemblySha256: INFERENCE_RUNTIME_SHA256,
};

/** Where the runtime's file is, on `origin`, and the digest it is held to. */
export function runtimeFiles(origin: string): Omit<RuntimeSetup, 'capabilities'> {
  return {
    filesBase: new URL(INFERENCE_RUNTIME_PATH, origin).href,
    webAssemblySha256: INFERENCE_RUNTIME_SHA256,
  };
}
