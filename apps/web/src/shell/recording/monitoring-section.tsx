/**
 * The Recording panel's monitoring (`REQ-REC-091`): its state, shown for as
 * long as the panel is, apart from the input's; the one control that turns it
 * on or off and the confirmation a feedback risk asks for; the project's rack
 * it is monitored through, if any; and how late the monitored signal is heard.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import { monitoringLatency } from '@audiogubbins/recording';

import { MONITOR_THROUGH, TOGGLE_MONITORING } from '../../commands/recording-commands.js';
import type { MonitoringView } from '../../recording/monitoring-control.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { millisecondsText, monitoringText } from '../../recording/recording-words.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** The value the rack choice shows for monitoring through no rack. */
const DRY = '';

/** The open project's assets that have a rack, which monitoring may run through. */
function useRackedAssets(projects: ProjectStores | undefined): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  if (open?.kind !== 'open') return [];
  return [...open.snapshot.model.state.project.assets.values()].flatMap((asset) =>
    asset.rack === undefined ? [] : [{ id: asset.id, name: asset.displayName }],
  );
}

/** How late the monitored signal is, and how much of it the chain adds. */
function latencyText(view: MonitoringView): string | undefined {
  const { monitoring } = view;
  if (monitoring.kind === 'unavailable') return undefined;
  const latency = monitoringLatency(monitoring.context.path);
  const { route, rate } = monitoring.context.path;
  const chain =
    route.kind === 'chain' && route.verdict.live
      ? ` The rack adds ${millisecondsText(route.verdict.latency / rate)}.`
      : '';
  const atLeast = latency.inputKnown && view.outputKnown ? '' : 'at least ';
  return `The monitored signal is heard ${atLeast}${millisecondsText(latency.seconds)} after it is played.${chain}`;
}

/** The monitoring part of the Recording panel. */
export function MonitoringSection({
  recording,
  projects,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const view = useSyncExternalStore(
    recording.monitoring.view.subscribe,
    recording.monitoring.view.get,
  );
  const racked = useRackedAssets(projects);
  const latency = latencyText(view);
  return (
    <div>
      <h3>Monitoring</h3>
      <p data-ag-status={view.monitoring.kind === 'on' ? 'reduced' : undefined}>
        {monitoringText(view)}
      </p>
      <div className="ag-settings-row">
        <CommandButton
          id={TOGGLE_MONITORING}
          label={view.monitoring.kind === 'on' ? 'Turn monitoring off' : 'Turn monitoring on'}
          commands={commands}
        />
        {view.monitoring.kind === 'confirming' && (
          <CommandButton
            id="recording.confirm-monitoring"
            label="Monitor anyway"
            commands={commands}
          />
        )}
      </div>
      {racked.length > 0 && (
        <OptionSelect
          label="Monitor through"
          value={view.chain?.asset ?? DRY}
          options={[
            { value: DRY, label: 'No rack: the dry input' },
            ...racked.map((asset) => ({ value: asset.id, label: `The rack of ${asset.name}` })),
          ]}
          onValueChange={(asset) => {
            if (asset === (view.chain?.asset ?? DRY)) return;
            if (asset === DRY) commands.run('recording.monitor-dry');
            else commands.run(MONITOR_THROUGH, { asset });
          }}
        />
      )}
      {latency !== undefined && <p className="ag-panel-note">{latency}</p>}
      <p className="ag-panel-note">
        What is monitored is never recorded: the recording is the dry input.
      </p>
    </div>
  );
}
