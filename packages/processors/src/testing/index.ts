/**
 * What processors' tests, here and in the packages that run them, take from
 * this package's test support: running one processor's kernel, and the
 * properties every processor is held to.
 */

export { type PropertyCases, processorProperties } from './processor-properties.js';
export {
  type RunSettings,
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  processorStep,
  processorValues,
  runProcessor,
} from './processor-run.js';
