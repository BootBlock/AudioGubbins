import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The server of the component inventory (`tests/e2e/visual/inventory/`), which
 * the browser suite starts beside the application's preview: every shared
 * component of the design system in every state, drawn for the screenshot
 * comparison. A development server, as the other harnesses' are: it writes
 * nothing, and the code it serves is the source the application is built from,
 * compiled by the application's own React plugin. Beside the application's
 * configuration and present only for the suite.
 */
export default defineConfig({
  root: join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'tests',
    'e2e',
    'visual',
    'inventory',
  ),
  plugins: [react()],
  // Nothing is discovered while a capture runs, which would reload the page
  // under it; the CommonJS modules React ships are converted ahead instead,
  // which a page cannot import as they are.
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
  },
  server: { strictPort: true },
});
