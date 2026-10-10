import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * The server of the renderer harness, which the browser suite starts beside
 * the application's preview (`tests/e2e/renderer-harness/`): the editor's
 * renderer on the editor's canvases, drawing the frames the renderer suites
 * choose. A development server: it writes nothing, and the code it serves is
 * the source the application is built from. Beside the application's
 * configuration, as the machine-learning goldens' harness is, and present
 * only for the suite.
 */
export default defineConfig({
  root: join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'tests',
    'e2e',
    'renderer-harness',
  ),
  // Nothing is optimised ahead: a dependency found while a test runs would
  // otherwise reload the page under it.
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { strictPort: true },
});
