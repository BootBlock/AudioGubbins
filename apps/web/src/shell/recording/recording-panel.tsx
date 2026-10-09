/**
 * The Recording panel (`ADR-0070`, `ADR-0072`, `REQ-UX-058`): the input and
 * its levels, the takes as they are made, the project's take stacks,
 * monitoring, the latency and its calibration, and the recording diagnostics,
 * each a control that runs a command and a reading of the recording part.
 *
 * Opening the panel watches the inputs and the permission, and opens no input:
 * only arming or calibrating opens one, which the panel's own controls do.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import type { RecordingParts } from '../../recording/recording-part.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { InputSection } from './input-section.js';
import { LatencySection } from './latency-section.js';
import { MonitoringSection } from './monitoring-section.js';
import { RecordSection } from './record-section.js';
import { TakeStacksSection } from './take-stacks-section.js';
import { RecordingDiagnosticsList } from './recording-diagnostics-list.js';
import { useInputView, useRecordingDiagnostics, useWatchedInputs } from './use-recording.js';

/** What the Recording panel reads, and how it runs its commands. */
export interface RecordingPanelParts {
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;
  readonly projects: ProjectStores | undefined;
}

/** The Recording panel. */
export function RecordingPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: RecordingPanelParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { recording, audioSettings } = parts;
  useWatchedInputs(recording);
  const view = useInputView(recording);
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get).recording;
  const diagnostics = useRecordingDiagnostics(recording, audioSettings);
  return (
    <section className="ag-panel ag-recording">
      <h2 className="ag-panel-title">{title}</h2>
      <InputSection recording={recording} view={view} settings={settings} commands={commands} />
      <RecordSection
        recording={recording}
        view={view}
        settings={settings}
        projects={parts.projects}
        commands={commands}
      />
      <TakeStacksSection projects={parts.projects} commands={commands} />
      <MonitoringSection recording={recording} projects={parts.projects} commands={commands} />
      <LatencySection recording={recording} view={view} settings={settings} commands={commands} />
      <details>
        <summary>
          {diagnostics.entries.length === 0
            ? 'Recording diagnostics'
            : `Recording diagnostics: ${String(diagnostics.entries.length)}`}
        </summary>
        <RecordingDiagnosticsList reading={diagnostics} commands={commands} />
      </details>
    </section>
  );
}
