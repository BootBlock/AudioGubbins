/**
 * Assembling a diagnostic bundle the user can inspect and then choose to share.
 *
 * REQ-PRIV-161 governs this file completely. AudioGubbins never transmits
 * anything without express permission, there is no silent crash reporting, and
 * the interface must show the user what a bundle contains *before* they submit
 * or export it.
 *
 * Nothing here transmits. The package is compiled without the DOM type
 * definitions, so it has no `fetch` to call even if a later change tried, and
 * the lint rules forbid one being introduced. The bundle is a value; what
 * happens to it is the user's decision, taken in the shell.
 *
 * The contents list below is the whole of what a bundle may hold. It is a
 * closed set rather than an open object, because REQ-PRIV-161 requires that
 * materially new data categories need renewed explicit consent, and a category
 * cannot be added here without changing this type and its consent description.
 */

import { wholeCharactersWithin } from '@audiogubbins/text';
import { PRODUCT_VERSION, SCHEMA_VERSIONS } from '@audiogubbins/version';
import type { LogRecord, PerformanceRecord } from './log-record.js';
import {
  redactFields,
  redactRecords,
  redactText,
  type RedactionOptions,
  type RedactionSummary,
} from './redaction.js';

/**
 * What the user is told the bundle will contain.
 *
 * Each entry pairs a stable key with British-English text the consent dialogue
 * shows. The key is what a remembered consent preference is scoped to, so that
 * adding a category later cannot be covered by consent given for the old set.
 */
export interface BundleContentDescription {
  readonly key: BundleContentKey;
  readonly label: string;

  /** How many items of this kind the bundle holds, where counting is meaningful. */
  readonly itemCount?: number;
}

/** A category of information a bundle may hold. */
export const BundleContentKey = {
  ProductVersion: 'product-version',
  Environment: 'environment',
  Capabilities: 'capabilities',
  DegradedFeatures: 'degraded-features',
  Logs: 'logs',
  PerformanceMeasurements: 'performance-measurements',
  SchemaVersions: 'schema-versions',
  ProcessorVersions: 'processor-versions',
  ReproductionNotes: 'reproduction-notes',
} as const;

/** A category of information a bundle may hold. */
export type BundleContentKey = (typeof BundleContentKey)[keyof typeof BundleContentKey];

/**
 * Where the application is running.
 *
 * Supplied by the caller rather than read here: this package has no
 * `navigator`. REQ-PRIV-161 permits browser and operating-system information in
 * a bundle.
 */
export interface EnvironmentSummary {
  /** Browser name and version, for example `Firefox 141`. */
  readonly browser: string;

  /** Operating system name, for example `Windows`. Never a machine name. */
  readonly operatingSystem: string;

  /** Whether the application is running as an installed progressive web app. */
  readonly installed: boolean;
}

/** A capability and whether it is available. */
export interface CapabilitySummary {
  readonly key: string;
  readonly available: boolean;

  /** Why it is unavailable, where that is known. */
  readonly reason?: string;

  /**
   * Whether the browser is still being asked, rather than having answered no.
   *
   * A question in flight is neither present nor missing, and the feature list
   * beside this one leaves it out for that reason. Were it reported here as
   * unavailable with nothing to tell the two apart, a bundle exported in the
   * first moments of a session would say a capability was missing while the
   * same bundle reports every feature working.
   */
  readonly checking?: boolean;
}

/** A feature running in a reduced form, and what that costs the user. */
export interface DegradedFeatureSummary {
  readonly featureKey: string;
  readonly explanation: string;
}

/** What the caller offers for inclusion. */
export interface BundleSources {
  readonly environment: EnvironmentSummary;
  readonly capabilities: readonly CapabilitySummary[];
  readonly degradedFeatures: readonly DegradedFeatureSummary[];
  readonly logs: readonly LogRecord[];
  readonly performance: readonly PerformanceRecord[];

  /**
   * Processor and model implementation versions present in this build.
   *
   * REQ-PRIV-161 permits version identifiers; REQ-REPO-187 keeps them distinct
   * from the product version, so they travel as their own map.
   */
  readonly processorVersions: Readonly<Record<string, number>>;

  /**
   * Free text the user deliberately wrote to describe what they were doing.
   *
   * REQ-PRIV-161 excludes user-entered free-form content unless deliberately
   * included, so this is present only when the user typed it into the dialogue.
   */
  readonly reproductionNotes?: string;
}

/** What the user chose to include. */
export interface BundleSelection {
  readonly include: ReadonlySet<BundleContentKey>;
  readonly redaction?: RedactionOptions;
}

/** A diagnostic bundle, ready to inspect, export, or discard. */
export interface DiagnosticBundle {
  /** Version of the bundle format itself (REQ-REPO-187). */
  readonly schemaVersion: number;

  /** The AudioGubbins release that produced it. */
  readonly productVersion: string;

  /** Milliseconds since the Unix epoch. */
  readonly createdAt: number;

  /** Exactly what this bundle holds, in the words the user was shown. */
  readonly contents: readonly BundleContentDescription[];

  /** What redaction removed while assembling it. */
  readonly redactionSummary: RedactionSummary;

  readonly environment?: EnvironmentSummary;
  readonly capabilities?: readonly CapabilitySummary[];
  readonly degradedFeatures?: readonly DegradedFeatureSummary[];
  readonly logs?: readonly LogRecord[];
  readonly performance?: readonly PerformanceRecord[];
  readonly schemaVersions?: Readonly<Record<string, number>>;
  readonly processorVersions?: Readonly<Record<string, number>>;
  readonly reproductionNotes?: string;
}

/**
 * The longest reproduction note a report carries.
 *
 * An account of a fault, which is a paragraph or two: four thousand characters
 * is several times the longest anyone writes. It is a bound on cost rather than
 * on expression. Every redaction rule reads the note, the export dialogue
 * redacts it on the main thread as the reader types, and an unbounded paste — a
 * console transcript, a `set` dump — would multiply every rule's cost by its
 * length. The field declares the same number, so the reader is stopped at it
 * rather than having their words cut afterwards. A note that reaches the bundle
 * longer than that is cut on a whole character, so the report never carries
 * half of one.
 */
export const LONGEST_NOTE = 4_000;

/**
 * Categories included unless the user removes them.
 *
 * Reproduction notes are absent: they exist only when the user has written
 * them. Nothing that could carry project content, audio or a filename is here.
 */
export const DEFAULT_BUNDLE_CONTENTS: ReadonlySet<BundleContentKey> = new Set([
  BundleContentKey.ProductVersion,
  BundleContentKey.Environment,
  BundleContentKey.Capabilities,
  BundleContentKey.DegradedFeatures,
  BundleContentKey.Logs,
  BundleContentKey.PerformanceMeasurements,
  BundleContentKey.SchemaVersions,
  BundleContentKey.ProcessorVersions,
]);

/** British-English descriptions shown in the consent dialogue. */
const CONTENT_LABELS: Record<BundleContentKey, string> = {
  [BundleContentKey.ProductVersion]: 'The AudioGubbins version and build identifier',
  [BundleContentKey.Environment]: 'Your browser and operating system, without any machine name',
  [BundleContentKey.Capabilities]: 'Which browser capabilities this device offers',
  [BundleContentKey.DegradedFeatures]: 'Which features are running in a reduced form, and why',
  [BundleContentKey.Logs]:
    'Recent diagnostic messages, with paths, credentials and network addresses removed',
  [BundleContentKey.PerformanceMeasurements]: 'How long recent operations took',
  [BundleContentKey.SchemaVersions]: 'Version numbers of the stored formats, without any content',
  [BundleContentKey.ProcessorVersions]: 'Version numbers of the audio processors in this build',
  [BundleContentKey.ReproductionNotes]: 'The notes you wrote describing what happened',
};

/**
 * What the Logs category says where the reader chose to keep file names.
 *
 * The type's own doc calls `contents` "exactly what this bundle holds, in the
 * words the user was shown". With the toggle on, the logs carry
 * `<path>/take.wav` and `<url>/interview.wav`, so the one sentence above, given
 * whichever way the toggle is set, would say paths had been removed where a
 * part of each is kept.
 *
 * Built from that sentence rather than written out again: written out, the two
 * could be reworded apart and disagree about what the bundle holds, and the
 * test that guards them reads each half on its own.
 */
const LOGS_WITH_FILE_NAMES = `${CONTENT_LABELS[BundleContentKey.Logs]}, but the last part of each file name kept`;

/**
 * Describes what a bundle would contain, without building it.
 *
 * REQ-PRIV-161 requires the interface to show the user what will be included
 * *before* submission. That means the description has to be available before
 * the bundle exists, so this is a separate function rather than a field read
 * off a bundle the user has not yet agreed to.
 */
export function describeBundleContents(
  sources: BundleSources,
  selection: BundleSelection,
): readonly BundleContentDescription[] {
  const counts: Partial<Record<BundleContentKey, number>> = {
    [BundleContentKey.Capabilities]: sources.capabilities.length,
    [BundleContentKey.DegradedFeatures]: sources.degradedFeatures.length,
    [BundleContentKey.Logs]: sources.logs.length,
    [BundleContentKey.PerformanceMeasurements]: sources.performance.length,
    [BundleContentKey.SchemaVersions]: Object.keys(SCHEMA_VERSIONS).length,
    [BundleContentKey.ProcessorVersions]: Object.keys(sources.processorVersions).length,
  };

  const descriptions: BundleContentDescription[] = [];
  for (const key of Object.values(BundleContentKey)) {
    if (!selection.include.has(key)) continue;
    if (key === BundleContentKey.ReproductionNotes && sources.reproductionNotes === undefined) {
      continue;
    }

    const itemCount = counts[key];
    descriptions.push({
      key,
      label:
        key === BundleContentKey.Logs && selection.redaction?.keepFileNames === true
          ? LOGS_WITH_FILE_NAMES
          : CONTENT_LABELS[key],
      ...(itemCount === undefined ? {} : { itemCount }),
    });
  }
  return descriptions;
}

/**
 * Builds a bundle from what the user agreed to include.
 *
 * Every text-carrying field is redacted on the way in, including the user's own
 * reproduction notes: a person describing a problem very often pastes the path
 * of the file it happened to, and REQ-PRIV-161 excludes full local paths.
 */
export function assembleBundle(
  sources: BundleSources,
  selection: BundleSelection,
  createdAt: number,
): DiagnosticBundle {
  const redaction = selection.redaction ?? {};
  const included = (key: BundleContentKey): boolean => selection.include.has(key);

  const redactedLogs = included(BundleContentKey.Logs)
    ? redactRecords(sources.logs, redaction)
    : redactRecords([], redaction);

  const counts = { ...redactedLogs.summary.counts };

  const performance = included(BundleContentKey.PerformanceMeasurements)
    ? sources.performance.map((record): PerformanceRecord => ({
        timestamp: record.timestamp,
        category: redactText(record.category, counts, redaction),
        operation: redactText(record.operation, counts, redaction),
        durationMs: record.durationMs,
        fields: redactFields(record.fields, counts, redaction),
        ...(record.correlationId === undefined
          ? {}
          : { correlationId: redactText(record.correlationId, counts, redaction) }),
      }))
    : undefined;

  const degradedFeatures = included(BundleContentKey.DegradedFeatures)
    ? sources.degradedFeatures.map((feature): DegradedFeatureSummary => ({
        featureKey: feature.featureKey,
        explanation: redactText(feature.explanation, counts, redaction),
      }))
    : undefined;

  const capabilities = included(BundleContentKey.Capabilities)
    ? sources.capabilities.map((capability): CapabilitySummary => {
        const reason =
          capability.reason === undefined
            ? undefined
            : redactText(capability.reason, counts, redaction);
        return {
          key: capability.key,
          available: capability.available,
          ...(reason === undefined ? {} : { reason }),
          // A question still in flight, carried through rather than rebuilt
          // away: the summary is built again here, and rebuilt without it, a
          // bundle exported in the first moments of a session would report a
          // capability missing while the degraded-feature list beside it, built
          // from the same registry in the same call, reports every feature
          // working.
          ...(capability.checking === true ? { checking: true } : {}),
        };
      })
    : undefined;

  const notes =
    included(BundleContentKey.ReproductionNotes) && sources.reproductionNotes !== undefined
      ? redactText(
          wholeCharactersWithin(sources.reproductionNotes, LONGEST_NOTE),
          counts,
          redaction,
        )
      : undefined;

  return {
    schemaVersion: SCHEMA_VERSIONS.diagnosticBundle,
    productVersion: PRODUCT_VERSION,
    createdAt,
    contents: describeBundleContents(sources, selection),
    redactionSummary: { counts },
    ...(included(BundleContentKey.Environment) ? { environment: sources.environment } : {}),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(degradedFeatures === undefined ? {} : { degradedFeatures }),
    ...(included(BundleContentKey.Logs) ? { logs: redactedLogs.records } : {}),
    ...(performance === undefined ? {} : { performance }),
    ...(included(BundleContentKey.SchemaVersions) ? { schemaVersions: SCHEMA_VERSIONS } : {}),
    ...(included(BundleContentKey.ProcessorVersions)
      ? { processorVersions: sources.processorVersions }
      : {}),
    ...(notes === undefined ? {} : { reproductionNotes: notes }),
  };
}

/**
 * Renders a bundle as the JSON text the user downloads.
 *
 * Indented, because the point of an inspectable bundle is that the user can
 * open it and read it before deciding to send it anywhere.
 */
export function renderBundle(bundle: DiagnosticBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
