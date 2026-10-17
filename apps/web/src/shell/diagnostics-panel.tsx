/**
 * The Diagnostics panel: the recent records of the diagnostic log, filtered
 * as the person reading them chose, and what keeping them costs.
 *
 * Drawn in the design language: what the log holds as its header's sub-line,
 * diagnostic mode as a strip of the accent, and each record a row, its
 * severity told by its word and its glyph (sections 10 and 11).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  EmptyState,
  Hint,
  Icon,
  IconSize,
  OptionSelect,
  PanelHeader,
  type IconName,
} from '@audiogubbins/design-system';
import {
  LogSeverity,
  allSeverities,
  severityPasses,
  type LogRecord,
  type LogStore,
} from '@audiogubbins/diagnostics';

import { logCategoryName } from '../log-categories.js';
import type { LogView, LogViewStore } from '../state/log-view-store.js';
import { timeOfDay } from '@audiogubbins/text';

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

/** The glyph each severity is drawn with beside its word, where it has one. */
const SEVERITY_GLYPHS: Readonly<Partial<Record<LogSeverity, IconName>>> = {
  [LogSeverity.Error]: 'error',
  [LogSeverity.Warning]: 'warning',
  [LogSeverity.Info]: 'information',
};

/** What the log holds and what it costs, and what it has discarded to keep within its bound. */
function usageWords(usage: ReturnType<LogStore['usage']>): string {
  const held = `${String(usage.recordCount)} messages, about ${String(Math.round(usage.approximateBytes / 1024))} kB.`;
  return usage.droppedRecordCount > 0
    ? `${held} ${String(usage.droppedRecordCount)} older messages have been discarded.`
    : held;
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
    <section className="ag-panel ag-stacked-panel ag-diagnostics">
      <PanelHeader
        title={title}
        icon="diagnostics"
        subLabel={usageWords(usage)}
        actions={
          <Hint label="About the diagnostic log">
            Nothing here leaves this machine unless you choose to share it.
          </Hint>
        }
      />

      {diagnosticModeActive && (
        <p className="ag-diagnostics-mode">
          <Icon name="diagnostic-mode" size={IconSize.Inline} />
          Diagnostic mode is on, so AudioGubbins is collecting more detail than usual.
        </p>
      )}

      {records.length > 0 && (
        <div className="ag-control-row" role="group" aria-label="Filter the log">
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
        <EmptyState icon="diagnostics" title="Nothing has been recorded." />
      ) : shown.length === 0 ? (
        <EmptyState icon="diagnostics" title="Nothing recorded matches the filter." />
      ) : (
        <ol className="ag-log">
          {shown
            .slice()
            .reverse()
            .map((record: LogRecord, index) => {
              const glyph = SEVERITY_GLYPHS[record.severity];
              return (
                <li key={`${String(record.timestamp)}-${String(index)}`} className="ag-log-record">
                  <span className="ag-log-time">{timeOfDay(record.timestamp)}</span>
                  <span className="ag-log-severity" data-ag-severity={record.severity}>
                    {glyph !== undefined && <Icon name={glyph} size={IconSize.Inline} />}
                    {record.severity}
                  </span>
                  <span className="ag-log-category">{logCategoryName(record.category)}</span>
                  <span className="ag-log-message">{record.message}</span>
                </li>
              );
            })}
        </ol>
      )}
    </section>
  );
}
