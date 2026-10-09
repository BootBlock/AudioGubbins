/**
 * What another package's tests may take from the engine's test support.
 *
 * A declared entry point, so a test elsewhere reaches it by a path the manifest
 * offers rather than past the package into its source. The runtime's and the
 * application's tests build the same graphs, count the same DSP objects, read
 * the same module, hold audio to the same fingerprint and measure the audio
 * thread's allocations the same way as the engine's own: written out again in
 * each package, the copies would drift apart.
 *
 * Apart from the package's own entry point, and staying apart: an
 * architecture rule refuses any production module that reaches test support,
 * whatever path it takes.
 */

export { QUANTA, allocatedBy, type Run } from './allocation.js';
export { countingDsp, type CountingDsp } from './counting-dsp.js';
export { dspModuleBytes, dspModuleExports } from './dsp-module.js';
export { distinctChannels, graphOf, named, nodeOf, wire } from './graph-builders.js';
export { fingerprint } from './pcm-fingerprint.js';
export { NO_CHAIN_PROCESSING, PLAIN_PLAN_PROCESSING } from './plan-processing.js';
export { RACKED_ASSET, memoryFile, rackedMedia, rackedPlan } from './racked-plan.js';
export { SCALING_REASON, scalingChain, type ScalingRuns } from './scaling-chain.js';
export { crossingThreads } from './thread-crossing.js';
