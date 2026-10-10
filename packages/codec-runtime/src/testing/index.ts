/**
 * What another package's tests may take from the codec runtime's test
 * support: the codec module and the encoder modules the run built, the files
 * the application loads, and a file in memory to read through them. The codec worker's tests and the import and export tests read
 * the same module the same way as the runtime's own.
 *
 * Apart from the package's own entry point, and staying apart: an
 * architecture rule refuses any production module that reaches test support.
 */

export { codecModule, codecModuleBytes } from './codec-module.js';
export { memoryBytes } from './memory-bytes.js';
export { type FlacFixture, flacFile, oggOpusFile } from './encoded-fixtures.js';
export { encoderModuleBytes, encoderModuleLoader } from './encoder-modules.js';
