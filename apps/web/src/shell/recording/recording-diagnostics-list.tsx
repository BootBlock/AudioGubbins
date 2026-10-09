/**
 * The recording diagnostics (`REQ-REC-094`, `REQ-REC-097`, `REQ-PWA-077`):
 * what the browser and the hardware can do for a recording, each shortfall
 * with what it affects, why, its practical impact and what would improve it.
 *
 * Informative rather than alarmist: the list sits in the panel and the
 * Capabilities panel and never stands between the person and their work, and
 * only an entry that stops recording altogether is marked as needing them. An
 * entry the application can act on offers that action as a command's button,
 * which the person presses or leaves.
 */

import type { ReactNode } from 'react';

import {
  DiagnosticSeverity,
  type DiagnosticAction,
  type RecordingDiagnostic,
} from '@audiogubbins/recording';

import { RESTART_AT_INPUT_RATE } from '../../commands/recording-commands.js';
import type { DiagnosticsReading } from '../../recording/input-diagnostics.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

/** Hertz, on a button. */
const HERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** What each severity is shown as, and the status it is drawn with. */
const SEVERITY: Readonly<
  Record<DiagnosticSeverity, { readonly label: string; readonly status: string }>
> = {
  [DiagnosticSeverity.Blocking]: { label: 'Needs you', status: 'unavailable' },
  [DiagnosticSeverity.Warning]: { label: 'Reduced', status: 'reduced' },
  [DiagnosticSeverity.Information]: { label: 'Note', status: 'available' },
};

/**
 * The command each kind of action runs, and the words on its button: keyed by
 * every kind, so a kind the recording package adds is given its command here or
 * fails to compile.
 */
const ACTIONS: Readonly<
  Record<
    DiagnosticAction['kind'],
    { readonly command: string; readonly label: (action: DiagnosticAction) => string }
  >
> = {
  'restart-at-input-rate': {
    command: RESTART_AT_INPUT_RATE,
    label: (action) => `Restart the audio engine at ${HERTZ.format(action.rate)} Hz`,
  },
};

/** The button that runs an entry's action. */
function ActionButton({
  action,
  commands,
}: {
  readonly action: DiagnosticAction;
  readonly commands: PanelCommands;
}): ReactNode {
  const { command, label } = ACTIONS[action.kind];
  return <CommandButton id={command} label={label(action)} commands={commands} compact />;
}

function Entry({
  entry,
  commands,
}: {
  readonly entry: RecordingDiagnostic;
  readonly commands: PanelCommands;
}): ReactNode {
  const severity = SEVERITY[entry.severity];
  return (
    <li className="ag-capability">
      <span className="ag-capability-name">{entry.affects}</span>
      <span className="ag-capability-status" data-ag-status={severity.status}>
        {severity.label}
      </span>
      <p className="ag-capability-explanation">{entry.why}</p>
      <p className="ag-capability-explanation">{entry.impact}</p>
      <p className="ag-capability-remedy">{entry.improve}</p>
      {entry.action !== undefined && <ActionButton action={entry.action} commands={commands} />}
    </li>
  );
}

/** The diagnostics known so far, and what is said of those not yet known. */
export function RecordingDiagnosticsList({
  reading,
  commands,
}: {
  readonly reading: DiagnosticsReading;
  readonly commands: PanelCommands;
}): ReactNode {
  const { entries, complete } = reading;
  return (
    <>
      {entries.length > 0 && (
        <ul className="ag-capability-list" aria-label="Recording diagnostics">
          {entries.map((entry) => (
            <Entry key={entry.kind} entry={entry} commands={commands} />
          ))}
        </ul>
      )}
      {complete ? (
        entries.length === 0 && (
          <p>Recording runs at full capability with this browser and hardware.</p>
        )
      ) : (
        <p className="ag-panel-note">
          What the input and the output can do is checked once an input is armed or something plays.
        </p>
      )}
    </>
  );
}
