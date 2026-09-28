/**
 * Setup for the projects that render React components.
 *
 * Adds the jsdom gaps, the jest-dom matchers, and an unmount between tests.
 * Without the unmount a component from one test is still in the document during
 * the next, so a query that should find one element finds two and the failure
 * names the wrong test.
 */

import './browser-globals.js';

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
