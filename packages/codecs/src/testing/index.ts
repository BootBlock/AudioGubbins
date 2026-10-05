/**
 * What a test may take from the codecs' test support: bytes in memory that
 * record their reads, and deterministic writers of every WAV and AIFF form the
 * readers read, so no binary fixture is stored (REQ-REPO-191).
 *
 * Apart from the package's own entry point, and staying apart: an architecture
 * rule refuses any production module that reaches test support.
 */

export {
  type MemoryBytes,
  type MemoryBytesOptions,
  type ReadRequest,
  memoryBytes,
} from './memory-bytes.js';

export { type FixtureChannel, type FixtureChunk } from './sample-writing.js';

export { type WavEncoding, type WavOptions, writeWav } from './wav-writer.js';

export { type AiffOptions, channelLayoutBody, writeAiff } from './aiff-writer.js';
