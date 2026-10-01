/**
 * The public contract of the AudioGubbins storage runtime.
 *
 * The browser host of project storage (ADR-0022): the storage core runs in one
 * dedicated worker, and the page talks to it through a typed port, whose two
 * sides call each other's operations by one table and send each other events.
 * The page hands the port the worker as an endpoint, and the worker hands it
 * its own global scope. Everything absent from this list is internal and may
 * change without being a breaking change (REQ-REPO-186).
 */

export { type PortEndpoint } from './protocol/port-channel.js';
