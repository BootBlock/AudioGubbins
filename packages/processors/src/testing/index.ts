/**
 * What processors' tests, here and in the packages that run them, take from
 * this package's test support: running one processor's kernel, the properties
 * every processor is held to, and a whole-pass type whose measurer a test
 * scripts.
 */

export { type PropertyCases, processorProperties } from './processor-properties.js';
export {
  type Change,
  type RunSettings,
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  processorKernelOf,
  processorStep,
  processorValues,
  runProcessor,
} from './processor-run.js';
export { type PassCounts, type PassScript, scriptedWholePass } from './scripted-whole-pass.js';
export { learnedProfile } from './spectral-measures.js';
