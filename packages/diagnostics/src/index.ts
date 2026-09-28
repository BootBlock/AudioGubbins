/**
 * The public contract of AudioGubbins diagnostics.
 *
 * This package has no network path and cannot acquire one: it is compiled
 * without the DOM type definitions, so `fetch`, `XMLHttpRequest` and
 * `navigator.sendBeacon` are not merely forbidden by lint rules but absent from
 * its type environment. REQ-PRIV-162 prohibits usage analytics and REQ-PRIV-161
 * prohibits transmitting anything without express permission; making that
 * structurally impossible is stronger than promising it.
 *
 * Its one AudioGubbins dependency is the version package, which a bundle is
 * stamped from and which logs nothing. Every subsystem logs, so any other
 * dependency here would be a cycle waiting to happen.
 */

export {
  type CorrelationId,
  type LogFieldValue,
  type LogFields,
  type LogRecord,
  LogSeverity,
  type PerformanceRecord,
  type SanitisedStackTrace,
  allSeverities,
  isLogCategory,
  isLogSeverity,
  severityPasses,
} from './log-record.js';

export {
  type LogSink,
  type LogStorageUsage,
  type LogStore,
  type LogStoreLimits,
  createLogStore,
} from './log-store.js';

export {
  type Clock,
  DEFAULT_VERBOSITY,
  type DiagnosticCentre,
  type Logger,
  type VerbosityConfiguration,
  createDiagnosticCentre,
} from './logger.js';

export {
  RedactionReason,
  type RedactionOptions,
  type RedactionSummary,
  redactFields,
  redactRecords,
  redactStack,
  previewRedaction,
  redactText,
  sanitiseStack,
} from './redaction.js';

export {
  BundleContentKey,
  type BundleContentDescription,
  type BundleSelection,
  type BundleSources,
  type CapabilitySummary,
  DEFAULT_BUNDLE_CONTENTS,
  type DegradedFeatureSummary,
  type DiagnosticBundle,
  type EnvironmentSummary,
  LONGEST_NOTE,
  assembleBundle,
  describeBundleContents,
  renderBundle,
} from './bundle.js';
