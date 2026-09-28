/**
 * The diagnostic commands: local only, and never transmitted.
 *
 * REQ-PRIV-161 prohibits transmitting anything without express permission and
 * REQ-PRIV-162 prohibits usage analytics, so nothing here has a network path
 * and the package these call into is compiled without one. What a bundle
 * contains and what happens to it are the user's decisions, taken in the shell.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
} from '@audiogubbins/commands';
import { ALL_FEATURES } from '@audiogubbins/capabilities';
import {
  BundleContentKey,
  assembleBundle,
  isLogSeverity,
  renderBundle,
  type BundleSources,
} from '@audiogubbins/diagnostics';

import { logCategoryInSentence } from '../log-categories.js';
import { report, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The media type of an exported report. */
const REPORT_MEDIA_TYPE = 'application/json';

/**
 * What a diagnostic report can be assembled from, right now.
 *
 * Shared by the dialogue, which shows the user what would be included, and the
 * command, which assembles it. REQ-PRIV-161 requires the interface to show the
 * user what will be included before export, and showing one thing and exporting
 * another is exactly what reading both from one place prevents.
 */
export function bundleSourcesFrom(context: ShellContext, notes: string | undefined): BundleSources {
  return {
    environment: context.environment,
    capabilities: context.capabilities.all().map((state) =>
      state.available
        ? { key: state.key, available: true }
        : {
            key: state.key,
            available: false,
            reason: state.reason,
            // A question still in flight, which the feature list beside this
            // one leaves out for the same reason. Without it, a bundle exported
            // in the first moments of a session would report a capability
            // missing and every feature working.
            ...(state.checking === true ? { checking: true } : {}),
          },
    ),
    degradedFeatures: context.capabilities.degradedFeatures(ALL_FEATURES).map((feature) => ({
      featureKey: feature.featureKey,
      explanation: feature.explanation,
    })),
    logs: context.logs.snapshot(),
    performance: context.logs.performanceSnapshot(),
    // No audio processor exists yet, so there is no version to report. An
    // empty map says that honestly; inventing one would not.
    processorVersions: {},
    ...(notes === undefined || notes.trim() === '' ? {} : { reproductionNotes: notes }),
  };
}

/** Every category a report may hold, for reading a selection back from text. */
const CONTENT_KEYS: ReadonlySet<string> = new Set(Object.values(BundleContentKey));

/** Whether a value names a category a report may hold. */
function isContentKey(value: string): value is BundleContentKey {
  return CONTENT_KEYS.has(value);
}

/** The commands that control what AudioGubbins records about itself. */
export function diagnosticCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'help.start-diagnostic-mode',
      'Start diagnostic mode',
      CommandCategory.Help,
      (context) => {
        context.diagnostics.startDiagnosticMode();
        context.interaction.announce(
          'Diagnostic mode is on for thirty minutes. AudioGubbins is collecting more detail, on this machine only.',
        );
      },
      {
        keywords: ['diagnostic', 'debug', 'logging', 'trace'],
        description:
          'Collects more detail for thirty minutes, or until you stop it. Nothing leaves this machine unless you choose to share it.',
        availability: (context) =>
          context.diagnostics.isDiagnosticModeActive()
            ? unavailable('Diagnostic mode is already on.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'help.stop-diagnostic-mode',
      'Stop diagnostic mode',
      CommandCategory.Help,
      (context) => {
        context.diagnostics.stopDiagnosticMode();
        context.interaction.announce('Diagnostic mode is off.');
      },
      {
        keywords: ['diagnostic', 'debug', 'logging'],
        availability: (context) =>
          context.diagnostics.isDiagnosticModeActive()
            ? AVAILABLE
            : unavailable('Diagnostic mode is not on.'),
      },
    ),

    shellCommand(
      'help.clear-logs',
      'Clear the diagnostic log',
      CommandCategory.Help,
      (context) => {
        context.logs.clear();
        context.interaction.announce('The diagnostic log is empty.');
      },
      {
        keywords: ['diagnostic', 'log', 'clear', 'empty'],
        availability: (context) =>
          context.logs.usage().recordCount === 0
            ? unavailable('The diagnostic log is already empty.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'help.set-verbosity',
      'Set how much the diagnostic log records',
      CommandCategory.Help,
      (context, invocation) => {
        const severity = textArgument(invocation, 'severity');
        const category = textArgument(invocation, 'category');

        // "default" removes a subsystem's own level, so it follows the overall
        // one again. Any other value has to be a severity.
        if (category !== undefined && severity === 'default') {
          if (context.verbosity.get().categoryOverrides[category] === undefined) {
            return unchanged(
              'diagnostics.category-already-follows',
              `What the log records from ${logCategoryInSentence(category)} already follows the overall level.`,
            );
          }
          return report(
            context,
            context.verbosity.setCategory(category, undefined),
            `What the log records from ${logCategoryInSentence(category)} follows the overall level.`,
          );
        }
        if (severity === undefined || !isLogSeverity(severity)) {
          return 'Choose a level in the Diagnostics settings.';
        }

        if (category === undefined) {
          if (context.verbosity.get().defaultSeverity === severity) {
            return unchanged(
              'diagnostics.level-already-set',
              `The diagnostic log already records ${severity} and above.`,
            );
          }
          context.verbosity.setDefault(severity);
          context.interaction.announce(`The diagnostic log records ${severity} and above.`);
          return undefined;
        }

        if (context.verbosity.get().categoryOverrides[category] === severity) {
          return unchanged(
            'diagnostics.category-level-already-set',
            `The log already records ${severity} and above from ${logCategoryInSentence(category)}.`,
          );
        }
        return report(
          context,
          context.verbosity.setCategory(category, severity),
          `The log records ${severity} and above from ${logCategoryInSentence(category)}.`,
        );
      },
      {
        keywords: ['diagnostic', 'log', 'verbosity', 'level', 'detail'],
        description:
          'Sets how much detail the log keeps, overall or for one part of AudioGubbins. Choose the level in the Diagnostics settings.',
      },
    ),

    shellCommand(
      'help.open-diagnostic-export',
      'Export a diagnostic report',
      CommandCategory.Help,
      (context) => {
        // Opening the dialogue is the whole of this command. REQ-PRIV-161
        // requires the interface to show the user what a report contains before
        // it is exported, so nothing is assembled or written until they have
        // seen the list and chosen to go on.
        context.interaction.setDiagnosticExportOpen(true);
      },
      {
        keywords: ['diagnostic', 'export', 'report', 'share', 'bundle', 'download'],
        description:
          'Shows exactly what a diagnostic report would contain, and saves it to a file only if you choose to.',
        availability: (context) =>
          context.interaction.get().diagnosticExportOpen
            ? unavailable('The diagnostic report is already open.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'help.close-diagnostic-export',
      'Close the diagnostic report dialogue',
      CommandCategory.Help,
      (context) => {
        context.interaction.setDiagnosticExportOpen(false);
      },
      {
        keywords: ['diagnostic', 'export', 'report', 'close', 'dismiss'],
        availability: (context) =>
          context.interaction.get().diagnosticExportOpen
            ? AVAILABLE
            : unavailable('The diagnostic report dialogue is not open.'),
      },
    ),

    shellCommand(
      'help.export-diagnostics',
      'Save the diagnostic report',
      CommandCategory.Help,
      (context, invocation) => {
        // Only the categories the caller names. Nothing is included by default
        // here: a macro or a replayed journal entry cannot widen what the user
        // agreed to in the dialogue.
        const include = new Set(
          (textArgument(invocation, 'include') ?? '').split(',').filter(isContentKey),
        );
        if (include.size === 0) {
          return 'Choose at least one thing to include in the report.';
        }

        const keepFileNames = invocation.arguments?.['keepFileNames'] === true;
        const bundle = assembleBundle(
          bundleSourcesFrom(context, textArgument(invocation, 'notes')),
          { include, redaction: { keepFileNames } },
          context.clock.now(),
        );

        const stamp = new Date(bundle.createdAt).toISOString().replaceAll(':', '-');
        const filename = `audiogubbins-diagnostics-${stamp}.json`;
        const refusal = context.files.save(filename, renderBundle(bundle), REPORT_MEDIA_TYPE);

        if (refusal === undefined) context.interaction.setDiagnosticExportOpen(false);
        return report(
          context,
          refusal === undefined
            ? undefined
            : `${refusal} Nothing was sent anywhere, and you can try again.`,
          `The diagnostic report was saved as "${filename}". It has not been sent anywhere.`,
        );
      },
      {
        keywords: ['diagnostic', 'export', 'report', 'save'],
        description:
          'Saves a diagnostic report with the contents you chose. Choose them in the export dialogue.',
      },
    ),
  ];
}
