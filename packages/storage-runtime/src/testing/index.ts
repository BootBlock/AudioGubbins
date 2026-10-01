/**
 * What another package's tests may take from the storage runtime's test
 * support: a page and a storage worker joined in process, which clones every
 * message as the browser does, so a test runs both sides of the port without
 * a browser.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support.
 */

export { type PortPair, portPair } from './port-pair.js';
