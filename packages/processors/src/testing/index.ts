/**
 * What processors' tests, here and in the packages that run them, take from
 * this package's test support: running one processor's kernel, the properties
 * every processor is held to, a whole-pass type whose measurer a test
 * scripts, and the signals the detectors are tested over.
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
export { delayingProcessor } from './delaying-processor.js';
export { recurrentType } from './recurrent-model.js';
export { learnedProfile } from './spectral-measures.js';
export { clipped, hiss, mixed, tone } from './detection-signals.js';
export { partials, withClicks } from './repair-signals.js';
