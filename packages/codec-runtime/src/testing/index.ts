/**
 * What another package's tests may take from the codec runtime's test
 * support: the codec module the run built, the prebuilt encoders' modules
 * from the files the application loads, and a file in memory to read
 * through it. The codec worker's tests and the import and export tests read
 * the same module the same way as the runtime's own.
 *
 * Apart from the package's own entry point, and staying apart: an
 * architecture rule refuses any production module that reaches test support.
 */

export { codecModule, codecModuleBytes } from './codec-module.js';
export { memoryBytes } from './memory-bytes.js';
export { type FlacFixture, flacFile, oggOpusFile } from './encoded-fixtures.js';
export { prebuiltEncoderBytes, prebuiltEncoderLoader } from './prebuilt-encoders.js';
export { type PageWorker, pageWorker } from './worker-harness.js';
