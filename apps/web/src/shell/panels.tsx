/**
 * The panels the shell can show: the capability surface, the diagnostic log
 * (`diagnostics-panel.tsx`), the transport, which plays an asset or the test
 * signal and renders the test signal (`transport-panel.tsx`), the editor, one
 * view of an asset (`editor-panel.tsx`), the reference picture
 * (`picture-panel.tsx`), the project's audio in the Asset Browser
 * (`asset-browser.tsx`), the properties of what the editor acts on in the
 * Inspector (`inspector/inspector-panel.tsx`), what the assistants found in the
 * Analysis panel (`analysis/analysis-panel.tsx`), the saved chains and presets
 * in the Library (`library/library-panel.tsx`), the rack of what the editor
 * acts on in the Effects rack (`rack/rack-panel.tsx`), the model packs in the
 * Model packs panel (`packs/pack-manager-panel.tsx`), the input, monitoring and
 * latency in the Recording panel (`recording/recording-panel.tsx`), the
 * spectral selection, tools and edits in the Spectral panel
 * (`spectral/spectral-panel.tsx`), a region's loop in the Loop panel
 * (`loop/loop-panel.tsx`), the asset groups in the Asset groups panel
 * (`game/groups-panel.tsx`), and the project system's History and Storage
 * panels (`project-panels.tsx`). Each is handed the panel context
 * (`panel-context.ts`), or only the parts of it it reads (`panel-parts.ts`).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import {
  ALL_FEATURES,
  FeatureStatus,
  type CapabilityRegistry,
  type StorageCapabilityAbsence,
} from '@audiogubbins/capabilities';
import { PanelKinds, type OpenPanel } from '@audiogubbins/workspace';

import type { RecordingParts } from '../recording/recording-part.js';
import { EditingPanelKinds, ModelPanelKinds, ProjectPanelKinds } from '../panel-kinds.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import type { Observable } from '../state/observable.js';
import { AnalysisPanel } from './analysis/analysis-panel.js';
import { AssetBrowserPanel } from './asset-browser.js';
import type { PanelCommands } from './command-button.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { EditorPanel } from './editor-panel.js';
import { GroupsPanel } from './game/groups-panel.js';
import { InspectorPanel } from './inspector/inspector-panel.js';
import { LibraryPanel } from './library/library-panel.js';
import { LoopPanel } from './loop/loop-panel.js';
import { PackManagerPanel } from './packs/pack-manager-panel.js';
import type { PanelContext } from './panel-context.js';
import {
  analysisPartsOf,
  groupsPartsOf,
  libraryPartsOf,
  loopPartsOf,
  packPartsOf,
} from './panel-parts.js';
import { PicturePanel } from './picture-panel.js';
import { ProjectPanel } from './project-panels.js';
import { RackPanel } from './rack/rack-panel.js';
import { SpectralPanel } from './spectral/spectral-panel.js';
import { GamePreviewPanel } from './preview/preview-panel.js';
import { RecordingDiagnosticsList } from './recording/recording-diagnostics-list.js';
import { RecordingPanel } from './recording/recording-panel.js';
import { useRecordingDiagnostics, useWatchedInputs } from './recording/use-recording.js';
import { RendererReportList } from './renderer-report-list.js';
import { SpectrogramDspReading } from './spectrogram-dsp-reading.js';
import { StorageAbsences } from './storage-absences.js';
import { TransportPanel } from './transport-panel.js';

/**
 * What the browser and the hardware can do for a recording, found by asking
 * them while the panel is shown (`REQ-PWA-077`): the inputs and the
 * permission are watched, and no input is opened.
 */
function RecordingCapability({
  recording,
  audioSettings,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;
  readonly commands: PanelCommands;
}): ReactNode {
  useWatchedInputs(recording);
  const reading = useRecordingDiagnostics(recording, audioSettings);
  return (
    <div>
      <h3>Recording with this browser and hardware</h3>
      <RecordingDiagnosticsList reading={reading} commands={commands} />
    </div>
  );
}

/** What this browser offers, and what is reduced because of it. */
export function CapabilitiesPanel({
  title,
  capabilities,
  editor,
  storageAbsences,
  recording,
  audioSettings,
  commands,
}: {
  readonly title: string;
  readonly capabilities: CapabilityRegistry;
  /** What each editor view's renderer tried and draws with, and which DSP the spectrogram worker runs. */
  readonly editor: Pick<EditorPanelParts, 'rendererReports' | 'spectrogramDsp'>;
  /** What this browser lacks for keeping projects, and what that costs. */
  readonly storageAbsences: readonly StorageCapabilityAbsence[];
  /** The input, for what recording can do here. */
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;
  /** How a recording diagnostic's action runs its command. */
  readonly commands: PanelCommands;
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
      <RecordingCapability
        recording={recording}
        audioSettings={audioSettings}
        commands={commands}
      />
      <RendererReportList reports={editor.rendererReports} />
      <SpectrogramDspReading dsp={editor.spectrogramDsp} />
    </section>
  );
}

/** The capability surface and the editing panels, or `undefined` for another kind. */
function editingPanel(panel: OpenPanel, title: string, context: PanelContext): ReactNode {
  switch (panel.kind) {
    case PanelKinds.Capabilities:
      return (
        <CapabilitiesPanel
          title={title}
          capabilities={context.capabilities}
          editor={context.editor}
          storageAbsences={context.storageAbsences}
          recording={context.recording}
          audioSettings={context.audioSettings}
          commands={context}
        />
      );
    case ProjectPanelKinds.History:
    case ProjectPanelKinds.Storage:
      return <ProjectPanel kind={panel.kind} title={title} context={context} />;
    case PanelKinds.Editor:
      return <EditorPanel panel={panel.id} title={title} parts={context.editor} />;
    case PanelKinds.Picture:
      return <PicturePanel title={title} parts={context.editor} />;
    case PanelKinds.AssetBrowser:
      return (
        <AssetBrowserPanel
          title={title}
          projects={context.projects}
          projectsUnavailable={context.projectsUnavailable}
          catalogue={context.editor.assets}
          editorViews={context.editor.stores.editorViews}
          commands={context}
          labelFor={context.editor.labelFor}
        />
      );
    case PanelKinds.Inspector:
      return (
        <InspectorPanel
          title={title}
          projects={context.projects}
          parts={{
            editorViews: context.editor.stores.editorViews,
            selections: context.editor.stores.selections,
            assets: context.editor.assets,
            labelFor: context.editor.labelFor,
            recording: context.recording,
            audioSettings: context.audioSettings,
            exports: context.exports,
            exportSubject: context.exportSubject,
            modelGate: context.modelGate,
            groups: context.groups,
            preferences: context.preferences,
          }}
          commands={context}
        />
      );
    default:
      return undefined;
  }
}

/**
 * Draws whichever panel the workspace asks for, under the title its tab shows.
 *
 * The title is given rather than written here, so a panel's tab, heading and
 * name for a screen reader are one name. Given a heading of its own, a panel
 * could go by a different name in each of the three.
 */
export function renderPanel(panel: OpenPanel, title: string, context: PanelContext): ReactNode {
  switch (panel.kind) {
    case PanelKinds.Transport:
      return (
        <TransportPanel
          title={title}
          assets={context.editor.assets}
          audio={context.audio}
          audioSettings={context.audioSettings}
          renderStrategy={context.renderStrategy}
          capabilities={context.capabilities}
          playhead={context.playhead}
          meters={context.meters}
          framesRendered={context.framesRendered}
          run={context.run}
          unavailableReason={context.unavailableReason}
          editorViews={context.editor.stores.editorViews}
          hearing={context.hearing}
        />
      );

    case EditingPanelKinds.Analysis:
      return <AnalysisPanel title={title} parts={analysisPartsOf(context)} commands={context} />;

    case EditingPanelKinds.Library:
      return <LibraryPanel title={title} parts={libraryPartsOf(context)} commands={context} />;

    case EditingPanelKinds.Rack:
      return <RackPanel title={title} context={context} />;

    case PanelKinds.Spectral:
      return <SpectralPanel title={title} context={context} />;

    case PanelKinds.GameGroups:
      return <GroupsPanel title={title} parts={groupsPartsOf(context)} commands={context} />;

    case PanelKinds.LoopEditor:
      return <LoopPanel title={title} parts={loopPartsOf(context)} commands={context} />;

    case PanelKinds.GamePreview:
      return <GamePreviewPanel title={title} context={context} />;

    case ModelPanelKinds.ModelPacks:
      return <PackManagerPanel title={title} parts={packPartsOf(context)} commands={context} />;

    case PanelKinds.Recording:
      return (
        <RecordingPanel
          title={title}
          parts={{
            recording: context.recording,
            audioSettings: context.audioSettings,
            projects: context.projects,
          }}
          commands={context}
        />
      );

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
      const editing = editingPanel(panel, title, context);
      if (editing !== undefined) return editing;

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
   * What is drawn, when that is shorter: the start of the label, so the name a
   * voice user says is the one they see (WCAG 2.5.3).
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
