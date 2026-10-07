/**
 * What another package's tests take from the model packs' test support: the
 * pack store's contract, which the storage's store is held to as the in-memory
 * one is, the sample manifests it is run with, and a source of packs in memory,
 * which a storage worker in memory downloads from in place of the network.
 *
 * Apart from the package's own entry point: an architecture rule refuses any
 * production module that reaches test support.
 */

export { describePackStoreContract } from './store-contract.js';
export { ANY_SHA256, type SampleOptions, sampleManifest, type TestPack } from './sample-packs.js';
export { MemorySource, type RecordedRead, type SourceOptions } from './memory-pack-source.js';
