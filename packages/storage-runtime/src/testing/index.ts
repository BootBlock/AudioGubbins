/**
 * What another package's tests may take from the storage runtime's test
 * support: a page and a storage worker joined in process, which clones every
 * message as the browser does, and the worker's own composition serving the
 * page at one end of them over storage in memory, so a test runs both sides of
 * the port without a browser.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support.
 */

export { type PortPair, portPair } from './port-pair.js';
export {
  type MemoryStorageOptions,
  type MemoryWorker,
  memoryHostServices,
  serveMemoryStorage,
  steppingClock,
} from './memory-storage.js';
export { type HostServices } from '../host/host-services.js';
