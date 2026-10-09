import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { inferenceRuntime } from './inference-runtime.js';
import { modelPackServing } from './model-pack-serving.js';

/**
 * The server of the machine-learning goldens' harness, which the browser suite
 * starts beside the application's preview (`tests/e2e/ml-golden.spec.ts`): the
 * harness page (`tests/e2e/ml-golden/`), the inference runtime's WebAssembly
 * and the built packs, on one origin, by the application's own plugins, so the
 * runtime is the file the application serves, under the digest it states, and
 * the packs are served from `AUDIOGUBBINS_PACK_CACHE` as the development server
 * serves them. A development server: it writes nothing, and the code it serves
 * is the source the application is built from. Beside the application's
 * configuration, whose plugins it takes, and like the preview's request log,
 * present only for the suite.
 */
export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'e2e', 'ml-golden'),
  plugins: [inferenceRuntime(), modelPackServing()],
  // Nothing is optimised ahead: a dependency found while a golden runs would
  // otherwise reload the page under it.
  optimizeDeps: { noDiscovery: true, include: [] },
  worker: { format: 'es' as const },
  server: { strictPort: true },
});
