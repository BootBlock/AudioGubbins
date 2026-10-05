/**
 * The panels the shell can show: the capability surface, the diagnostic log
 * (`diagnostics-panel.tsx`), the transport, which plays an asset or the test
 * signal and renders the test signal (`transport-panel.tsx`), the editor, one
 * view of an asset (`editor-panel.tsx`), the reference picture
 * (`picture-panel.tsx`), the project's audio in the Asset Browser
 * (`asset-browser.tsx`), the properties of what the editor acts on in the
 * Inspector (`inspector/inspector-panel.tsx`), and the project system's
 * History and Storage panels (`project-panels.tsx`).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import {
  ALL_FEATURES,
  FeatureStatus,
  type CapabilityRegistry,
  type StorageCapabilityAbsence,
} from '@audiogubbins/capabilities';
import type { LogStore } from '@audiogubbins/diagnostics';
import { PanelKinds, type OpenPanel } from '@audiogubbins/workspace';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { MeterLevels } from '@audiogubbins/audio-runtime';

import type { ShellContext } from '../commands/shell-context.js';
import { ProjectPanelKinds } from '../panel-kinds.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { RenderStrategyView } from '../state/render-strategy-store.js';
import type { LogViewStore } from '../state/log-view-store.js';
import { AssetBrowserPanel } from './asset-browser.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { EditorPanel } from './editor-panel.js';
import { InspectorPanel } from './inspector/inspector-panel.js';
import { PicturePanel } from './picture-panel.js';
import { ProjectPanel, type ProjectPanelContext } from './project-panels.js';
import { RendererReportList } from './renderer-report-list.js';
import type { RunCommand } from './settings/section.js';
import { StorageAbsences } from './storage-absences.js';
import { TransportPanel } from './transport-panel.js';

/** What this browser offers, and what is reduced because of it. */
export function CapabilitiesPanel({
  title,
  capabilities,
  renderers,
  storageAbsences,
}: {
  readonly title: string;
  readonly capabilities: CapabilityRegistry;
  /** What each editor view's renderer tried and draws with. */
  readonly renderers: EditorPanelParts['rendererReports'];
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
      <RendererReportList reports={renderers} />
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

  /**
   * What the audio engine is doing, which the Transport panel shows. Read
   * alone, as the next two are: a panel changes them only through the commands
   * it runs, never by writing a store (`CLAUDE.md` G2).
   */
  readonly audio: Observable<AudioView>;

  /** The person's audio settings, and how the latest render was planned, which it shows too. */
  readonly audioSettings: Observable<AudioSettings>;
  readonly renderStrategy: Observable<RenderStrategyView>;

  /** The frame the listener hears now, at the context's rate. */
  readonly playhead: () => number | undefined;

  /** Each meter's latest levels, which the Transport panel reads once a display frame. */
  readonly meters: () => ReadonlyMap<NodeId, MeterLevels>;

  /** The frames the running render has reached, which the Transport panel reads likewise. */
  readonly framesRendered: () => number;

  /** What the Editor and Picture panels are given. */
  readonly editor: EditorPanelParts;
}

/**
 * What a panel reads, from the shell's context, and how its controls run a
 * command and ask why one cannot run: as every other surface does, so a panel's
 * button and the palette entry of the same name are one action.
 */
export function panelContextOf(
  {
    context,
    editorPanels,
  }: { readonly context: ShellContext; readonly editorPanels: EditorPanelParts },
  run: RunCommand,
  unavailableReason: (id: string) => string | undefined,
): PanelContext {
  return {
    editor: editorPanels,
    capabilities: context.capabilities,
    logs: context.logs,
    logViews: context.logViews,
    diagnosticModeActive: context.diagnostics.isDiagnosticModeActive(),
    storageAbsences: context.storageAbsences,
    projects: context.projects,
    projectsUnavailable: unavailableReason('file.projects'),
    audio: context.audio,
    audioSettings: context.audioSettings,
    renderStrategy: context.renderStrategy,
    playhead: () => context.playback.audiblePosition(),
    meters: () => context.playback.meters(),
    framesRendered: () => context.rendering.framesRendered(),
    run,
    unavailableReason,
  };
}

/** The capability surface and the editing panels, or `undefined` for another kind. */
function editingPanel(panel: OpenPanel, title: string, context: PanelContext): ReactNode {
  switch (panel.kind) {
    case PanelKinds.Capabilities:
      return (
        <CapabilitiesPanel
          title={title}
          capabilities={context.capabilities}
          renderers={context.editor.rendererReports}
          storageAbsences={context.storageAbsences}
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
