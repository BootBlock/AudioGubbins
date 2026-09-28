/**
 * Diagnostics, and what AudioGubbins does with them.
 *
 * REQ-PRIV-161 prohibits transmitting anything without express permission and
 * REQ-PRIV-162 prohibits usage analytics, so what this section offers is
 * control over what is recorded locally and a way to take a copy of it.
 * REQ-PRIV-165 requires the verbosity to be the user's to set, overall and per
 * subsystem: the diagnostic centre does both, and this section is where the
 * user sets them.
 */

import type { ReactNode } from 'react';

import { Button, OptionSelect, ToggleSwitch } from '@audiogubbins/design-system';
import { allSeverities, type VerbosityConfiguration } from '@audiogubbins/diagnostics';

import type { RunCommand } from './section.js';
import { logCategoryInSentence } from '../../log-categories.js';

/** What the diagnostic controls need. */
export interface DiagnosticsProps {
  readonly diagnosticModeActive: boolean;

  /** When diagnostic mode ends on its own, as text, when it is on. */
  readonly diagnosticModeEnds?: string;

  readonly verbosity: VerbosityConfiguration;

  /** The subsystems that write to the log, so each can be given its own level. */
  readonly categories: readonly string[];

  readonly run: RunCommand;
}

/** What each level is called where the user chooses it. */
const SEVERITY_NAMES: Readonly<Record<string, string>> = {
  error: 'Errors only',
  warning: 'Warnings and errors',
  info: 'Information and above',
  debug: 'Debugging detail and above',
  trace: 'Everything',
};

/** The levels, from least recorded to most. */
const SEVERITY_OPTIONS = allSeverities().map((severity) => ({
  value: severity,
  label: SEVERITY_NAMES[severity] ?? severity,
}));

/** Diagnostics and what AudioGubbins does with them. */
export function Diagnostics({
  diagnosticModeActive,
  diagnosticModeEnds,
  verbosity,
  categories,
  run,
}: DiagnosticsProps): ReactNode {
  return (
    <div className="ag-settings-section">
      <p className="ag-settings-note">
        AudioGubbins keeps a diagnostic log on this machine. It contains no audio and no project
        content, and nothing is ever sent anywhere unless you choose to share it. There are no usage
        analytics.
      </p>

      <ToggleSwitch
        label="Diagnostic mode"
        description={
          diagnosticModeActive && diagnosticModeEnds !== undefined
            ? `On until ${diagnosticModeEnds}, collecting everything, on this machine only.`
            : 'Collects everything for thirty minutes, to help investigate a problem.'
        }
        checked={diagnosticModeActive}
        onCheckedChange={(on) => {
          run(on ? 'help.start-diagnostic-mode' : 'help.stop-diagnostic-mode');
        }}
      />

      <OptionSelect
        label="What the log records"
        value={verbosity.defaultSeverity}
        options={SEVERITY_OPTIONS}
        onValueChange={(severity) => {
          run('help.set-verbosity', { severity });
        }}
      />

      {categories.map((category) => (
        <OptionSelect
          key={category}
          label={`What the log records from ${logCategoryInSentence(category)}`}
          value={verbosity.categoryOverrides[category] ?? 'default'}
          options={[{ value: 'default', label: 'The same as above' }, ...SEVERITY_OPTIONS]}
          onValueChange={(severity) => {
            run('help.set-verbosity', { category, severity });
          }}
        />
      ))}

      <div className="ag-settings-row">
        <Button
          onClick={() => {
            run('help.open-diagnostic-export');
          }}
        >
          Export a diagnostic report
        </Button>
      </div>
    </div>
  );
}
