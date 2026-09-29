/**
 * The storage worker: the one place projects and media are written to the
 * origin-private file system, through synchronous access handles, which every
 * floor browser offers only inside a dedicated worker (ADR-0020, REQ-STOR-021).
 *
 * The application's own module rather than the storage package's, because the
 * worker's root is read through the capabilities package, where the browser is
 * asked for anything (REQ-EXEC-136.4). The page starts it from
 * `project-services.ts`, and Vite builds it as a module of its own.
 */

import { serveOriginPrivateTree } from '@audiogubbins/browser-storage';
import { readOriginPrivateRoot } from '@audiogubbins/capabilities';

serveOriginPrivateTree(self, readOriginPrivateRoot(navigator));
