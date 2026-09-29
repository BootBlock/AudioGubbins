/**
 * The panels the Phase 01 shell can show.
 *
 * Phase 01 delivers the shell, not the editing (the Phase Packet's user-visible
 * outcome says so plainly: AudioGubbins launches as a polished responsive shell
 * but does not yet edit real audio). So the asset browser, editor and transport
 * say what they are for and which phase brings them, rather than showing a
 * pretend waveform.
 *
 * That is a deliberate distinction from the placeholder REQ-EXEC-181 forbids. A
 * placeholder pretends to be the real thing and fails silently; these state
 * what is not here yet. A user who opens AudioGubbins today should not be shown
 * a fake waveform and left to discover that nothing happens when they click it.
 *
 * Two panels are entirely real, because their subject exists now: the
 * capability surface and the diagnostic log.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button, OptionSelect } from '@audiogubbins/design-system';
import {
  ALL_FEATURES,
  FeatureStatus,
  type CapabilityRegistry,
  type StorageCapabilityAbsence,
} from '@audiogubbins/capabilities';
import {
  LogSeverity,
  allSeverities,
  severityPasses,
  type LogRecord,
  type LogStore,
} from '@audiogubbins/diagnostics';
import { PanelKinds, type OpenPanel, type PanelKind } from '@audiogubbins/workspace';

import { logCategoryName } from '../log-categories.js';
import { ProjectPanelKinds } from '../panel-kinds.js';
import type { LogView, LogViewStore } from '../state/log-view-store.js';
import { ProjectPanel, type ProjectPanelContext } from './project-panels.js';
import { StorageAbsences } from './storage-absences.js';

/** A panel that describes what will live here, and when. */
function ComingInAPhase({
  title,
  purpose,
  phase,
}: {
  readonly title: string;
  readonly purpose: string;
  readonly phase: string;
}): ReactNode {
  return (
    <section className="ag-panel ag-panel-pending">
      <h2 className="ag-panel-title">{title}</h2>
      <p>{purpose}</p>
      <p className="ag-panel-note">Arrives with {phase}.</p>
    </section>
  );
}

/** What this browser offers, and what is reduced because of it. */
export function CapabilitiesPanel({
  title,
  capabilities,
  storageAbsences,
}: {
  readonly title: string;
  readonly capabilities: CapabilityRegistry;

  /** What this browser lacks for keeping projects, and what that costs. */
  readonly storageAbsences: readonly StorageCapabilityAbsence[];
}): ReactNode {
  // Subscribed, so an answer the browser gives late redraws the panel.
  useSyncExternalStore(capabilities.subscribe, capabilities.all);
  const degraded = capabilities.degradedFeatures(ALL_FEATURES);

  return (
    <section className="ag-panel">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        What this browser can do, and what AudioGubbins does where it cannot.
      </p>

      {degraded.length === 0 && storageAbsences.length === 0 ? (
        <p>Every AudioGubbins feature can run at full capability in this browser.</p>
      ) : (
        <ul className="ag-capability-list">
          {degraded.map((feature) => (
            <li key={feature.featureKey} className="ag-capability">
              <span className="ag-capability-name">{feature.label}</span>
              <span className="ag-capability-status" data-ag-status={feature.status}>
                {feature.status === FeatureStatus.Unavailable ? 'Unavailable' : 'Reduced'}
              </span>
              <p className="ag-capability-explanation">{feature.explanation}</p>
              {feature.missingRequired
                .concat(feature.missingPreferred)
                .filter((state) => state.remedy !== undefined)
                .map((state) => (
                  <p key={state.key} className="ag-capability-remedy">
                    {state.remedy}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      )}
      <StorageAbsences absences={storageAbsences} />
    </section>
  );
}

/**
 * The records a reader sees, given the level and the subsystem they chose.
 *
 * A function of its own so the filter can be tested: the panel's own controls
 * are a portalled listbox, which jsdom will open once per file, and this is the
 * decision the controls exist to make.
 */
export function recordsPassing(
  records: readonly LogRecord[],
  threshold: LogSeverity,
  category: string,
): readonly LogRecord[] {
  return records.filter(
    (record) =>
      severityPasses(record.severity, threshold) &&
      (category === 'all' || record.category === category),
  );
}

/** How a record's time is written in the log. */
function formatTime(timestamp: number): string {
  const when = new Date(timestamp);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(when.getSeconds()).padStart(2, '0')}`;
}

/** The recent diagnostic records, and what they cost to keep. */
export function DiagnosticsPanel({
  panelId,
  title,
  logs,
  views,
  diagnosticModeActive,
}: {
  readonly panelId: string;
  readonly title: string;
  readonly logs: LogStore;
  readonly views: LogViewStore;
  readonly diagnosticModeActive: boolean;
}): ReactNode {
  const records = useSyncExternalStore(
    // The log store has no subscription of its own: a logger that notified
    // React on every record would re-render the tree hundreds of times during
    // an import. The panel reads a snapshot when React renders it for another
    // reason, which is enough for a log a person is reading.
    () => () => undefined,
    () => logs.snapshot(),
  );

  const usage = logs.usage();

  // What the reader is looking at, not what is recorded. Filtering a view the
  // user is reading changes nothing about the application, so it is view state
  // rather than a command; the level the log records is set in the settings, by
  // command (REQ-PRIV-165). Held by a store above the dock, which the dock is
  // rebuilt out from under by every arrangement command, and read from here
  // rather than copied, so there is one answer to what this panel is showing.
  useSyncExternalStore(views.subscribe, views.get);
  const { threshold, category } = views.viewOf(panelId);
  const choose = (chosen: Partial<LogView>): void => {
    views.choose(panelId, chosen);
  };

  const categories = [...new Set(records.map((record) => record.category))].sort();
  const shown = recordsPassing(records, threshold, category);

  return (
    <section className="ag-panel">
      <h2 className="ag-panel-title">{title}</h2>

      <p className="ag-panel-note">
        {`${String(usage.recordCount)} messages, about ${String(Math.round(usage.approximateBytes / 1024))} kB. `}
        {usage.droppedRecordCount > 0
          ? `${String(usage.droppedRecordCount)} older messages have been discarded. `
          : ''}
        Nothing here leaves this machine unless you choose to share it.
      </p>

      {diagnosticModeActive && (
        <p className="ag-panel-note" data-ag-status="reduced">
          Diagnostic mode is on, so AudioGubbins is collecting more detail than usual.
        </p>
      )}

      {records.length > 0 && (
        <div className="ag-settings-row" role="group" aria-label="Filter the log">
          <OptionSelect
            label="Show"
            value={threshold}
            options={allSeverities().map((severity) => ({
              value: severity,
              label:
                severity === LogSeverity.Trace ? 'Everything recorded' : `${severity} and above`,
            }))}
            onValueChange={(value) => {
              const chosen = allSeverities().find((severity) => severity === value);
              if (chosen !== undefined) choose({ threshold: chosen });
            }}
          />
          <OptionSelect
            label="From"
            value={category}
            options={[
              { value: 'all', label: 'Every part of AudioGubbins' },
              ...categories.map((one) => ({ value: one, label: logCategoryName(one) })),
            ]}
            onValueChange={(chosen) => {
              choose({ category: chosen });
            }}
          />
        </div>
      )}

      {records.length === 0 ? (
        <p>Nothing has been recorded.</p>
      ) : shown.length === 0 ? (
        <p>Nothing recorded matches the filter.</p>
      ) : (
        <ol className="ag-log">
          {shown
            .slice()
            .reverse()
            .map((record: LogRecord, index) => (
              <li key={`${String(record.timestamp)}-${String(index)}`} className="ag-log-record">
                <span className="ag-log-time">{formatTime(record.timestamp)}</span>
                <span className="ag-log-severity" data-ag-severity={record.severity}>
                  {record.severity}
                </span>
                <span className="ag-log-category">{logCategoryName(record.category)}</span>
                <span className="ag-log-message">{record.message}</span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

/** What a panel needs to draw itself. */
export interface PanelContext extends ProjectPanelContext {
  readonly capabilities: CapabilityRegistry;
  readonly logs: LogStore;
  readonly logViews: LogViewStore;
  readonly diagnosticModeActive: boolean;
  readonly announcement?: { readonly text: string; readonly urgent: boolean };

  /** What this browser lacks for keeping projects. */
  readonly storageAbsences: readonly StorageCapabilityAbsence[];
}

/**
 * The panels a later phase fills, with what each is for and which phase brings
 * it. A placeholder that says so rather than pretends (REQ-EXEC-136.9).
 */
const PENDING_PANELS: ReadonlyMap<PanelKind, { readonly purpose: string; readonly phase: string }> =
  new Map([
    [
      PanelKinds.AssetBrowser,
      {
        purpose: 'The audio in this project, ready to open, rename and organise.',
        phase: 'the project and storage system',
      },
    ],
    [
      PanelKinds.Editor,
      {
        purpose: 'The waveform, the selection and the editing tools.',
        phase: 'the waveform and timeline foundation',
      },
    ],
    [
      PanelKinds.Inspector,
      {
        purpose: 'The properties of whatever you have selected, editable in place.',
        phase: 'core non-destructive editing',
      },
    ],
    [
      PanelKinds.Transport,
      {
        purpose: 'Play, stop, loop, and the output levels.',
        phase: 'the audio engine foundation',
      },
    ],
  ]);

/**
 * Draws whichever panel the workspace asks for, under the title its tab shows.
 *
 * The title is given rather than written here, so a panel's tab, heading and
 * name for a screen reader are one name. Given a heading of its own, a panel
 * could go by a different name in each of the three.
 */
export function renderPanel(panel: OpenPanel, title: string, context: PanelContext): ReactNode {
  switch (panel.kind) {
    case PanelKinds.Capabilities:
      return (
        <CapabilitiesPanel
          title={title}
          capabilities={context.capabilities}
          storageAbsences={context.storageAbsences}
        />
      );

    case ProjectPanelKinds.History:
    case ProjectPanelKinds.Storage:
      return <ProjectPanel kind={panel.kind} title={title} context={context} />;

    case PanelKinds.Diagnostics:
      return (
        <DiagnosticsPanel
          panelId={panel.id}
          title={title}
          logs={context.logs}
          views={context.logViews}
          diagnosticModeActive={context.diagnosticModeActive}
        />
      );

    default: {
      const pending = PENDING_PANELS.get(panel.kind);
      if (pending !== undefined) return <ComingInAPhase title={title} {...pending} />;

      // A layout naming a panel this build does not have is caught before the
      // workspace is mounted, so reaching here means the descriptor map and
      // this switch have drifted apart. Saying so beats rendering nothing.
      return (
        <section className="ag-panel">
          <h2 className="ag-panel-title">This panel is not available</h2>
          <p>{`AudioGubbins does not know how to draw a panel of kind "${panel.kind}".`}</p>
        </section>
      );
    }
  }
}

/** A button that runs a command, for the status bar. */
export function QuickAction({
  label,
  shown,
  onPress,
  disabled,
}: {
  /** What a screen reader says. */
  readonly label: string;

  /**
   * What is drawn, when that is shorter: the start of the label, so the name
   * a voice user says is the one they see (WCAG 2.5.3).
   */
  readonly shown?: string;

  readonly onPress: () => void;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <Button
      tone="quiet"
      compact
      onClick={onPress}
      disabled={disabled}
      {...(shown === undefined ? {} : { label })}
    >
      {shown ?? label}
    </Button>
  );
}
