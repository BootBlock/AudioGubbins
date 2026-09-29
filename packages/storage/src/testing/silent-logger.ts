/**
 * A logger that keeps nothing, for tests that drive code which logs.
 */

import type { Logger } from '@audiogubbins/diagnostics';

/** A logger that keeps nothing. */
export function silentLogger(): Logger {
  const logger: Logger = {
    category: 'storage',
    error: () => undefined,
    warning: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    measured: () => undefined,
    forOperation: () => logger,
  };
  return logger;
}
