/**
 * What other packages' tests take from the peak worker's test support: the
 * real worker's core run in the test's own thread behind the port the page
 * talks to, composed as its module composes it, a cache kept in memory, and a
 * subject whose audio is held in memory.
 */

export {
  type LocalPeakOptions,
  LocalPeakWorker,
  MemoryPeakCache,
  memorySubject,
  turn,
} from './peak-rig.js';
