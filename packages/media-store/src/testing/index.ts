/**
 * What another package's tests may take from the media store's test support: an
 * in-memory storage tree that can crash and fill up, and the sources, tokens
 * and sharing of the storage-wide lock its tests are driven with.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support.
 */

export {
  type MemoryTreeOptions,
  type TornWrite,
  MemoryStorageTree,
  SimulatedCrash,
} from './memory-tree.js';

export {
  type ObservedSource,
  countingTokens,
  generatedBytes,
  generatedSource,
  memorySource,
} from './byte-sources.js';

export { type CountedSharing, countedSharing } from './sharing.js';
