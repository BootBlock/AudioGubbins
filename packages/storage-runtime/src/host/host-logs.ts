/**
 * The storage worker's loggers, whose records cross to the page.
 *
 * The worker keeps no records of its own: the page's diagnostic centre keeps
 * the application's, holds the verbosity the person chose and its diagnostic
 * mode, and redacts every record alike when a report is made. So the worker's
 * loggers send every record they make on the `log` stream, at any severity,
 * and the page admits each by its own verbosity, as it admits the records its
 * own loggers make (`DiagnosticCentre.relay`). A record is a value of fields
 * that cannot hold audio or a project, so it is sent as it is.
 */

import {
  LogSeverity,
  createDiagnosticCentre,
  type Clock,
  type VerbosityConfiguration,
} from '@audiogubbins/diagnostics';

import type { HostChannel } from '../protocol/storage-operations.js';
import type { HostLogs } from './host-services.js';

/** Every record, since the page decides which it keeps. */
const EVERY_RECORD: VerbosityConfiguration = {
  defaultSeverity: LogSeverity.Trace,
  categoryOverrides: {},
};

/** Loggers whose every record is sent on the channel's `log` stream, timed by `clock`. */
export function hostLogs(channel: HostChannel, clock: Clock): HostLogs {
  return createDiagnosticCentre(
    {
      write: (record) => {
        channel.emit('log', { kind: 'record', record });
      },
      writePerformance: (record) => {
        channel.emit('log', { kind: 'performance', record });
      },
    },
    clock,
    EVERY_RECORD,
  );
}
