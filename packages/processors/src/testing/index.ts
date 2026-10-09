/**
 * What processors' tests, here and in the packages that run them, take from
 * this package's test support: running one processor's kernel, the properties
 * every processor is held to, a whole-pass type whose measurer a test scripts,
 * DeepFilterNet 3's pack and graphs played on the fake runtime, the processor
 * types that run it from a pack of its stand-ins installed, and the signals the
 * detectors are tested over.
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
export {
  type StandInFile,
  StandInInference,
  deepFilterNetGraphs,
  deepFilterNetPack,
  typesRunningDeepFilterNetFiles,
} from './deepfilternet-stand-in.js';
export { learnedProfile } from './spectral-measures.js';
export { clipped, hiss, mixed, tone } from './detection-signals.js';
export { partials, withClicks } from './repair-signals.js';
