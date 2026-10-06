import { MemoryPackStore } from './testing/memory-pack-store.js';
import { describePackStoreContract } from './testing/store-contract.js';

// The installer's tests run over this store, so it is held to the contract the
// storage's store is: what they prove of it holds of the store that ships.
describePackStoreContract('in memory', () => new MemoryPackStore());
