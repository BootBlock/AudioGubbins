/**
 * The panels the Phase 01 shell can show.
 *
 * The shell arrived before the editing, so the asset browser, the editor and
 * the inspector say what they are for and which phase brings them, rather than
 * showing a pretend waveform.
 *
 * That is a deliberate distinction from the placeholder REQ-EXEC-181 forbids. A
 * placeholder pretends to be the real thing and fails silently; these state
 * what is not here yet. A user who opens AudioGubbins today should not be shown
 * a fake waveform and left to discover that nothing happens when they click it.
 *
 * Three panels are entirely real, because their subject exists now: the
 * capability surface, the diagnostic log (`diagnostics-panel.tsx`), and the
 * transport, which plays and renders the audio engine's test signal
 * (`transport-panel.tsx`).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import { ALL_FEATURES, FeatureStatus, type CapabilityRegistry } from '@audiogubbins/capabilities';
import type { LogStore } from '@audiogubbins/diagnostics';
import { PanelKinds, type OpenPanel, type PanelKind } from '@audiogubbins/workspace';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { MeterLevels } from '@audiogubbins/audio-runtime';

import type { ShellContext } from '../commands/shell-context.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { RenderStrategyView } from '../state/render-strategy-store.js';
import type { LogViewStore } from '../state/log-view-store.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { TransportPanel } from './transport-panel.js';

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
}: {
  readonly title: string;
  readonly capabilities: CapabilityRegistry;
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

      {degraded.length === 0 ? (
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
    </section>
  );
}

/** What a panel needs to draw itself. */
export interface PanelContext {
  readonly capabilities: CapabilityRegistry;
  readonly logs: LogStore;
  readonly logViews: LogViewStore;
  readonly diagnosticModeActive: boolean;
  readonly announcement?: { readonly text: string; readonly urgent: boolean };

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

  /** Runs a command a panel's control names. */
  readonly run: (id: string) => void;

  /** Why a command cannot run now, or `undefined`, as the menus say it. */
  readonly unavailableReason: (id: string) => string | undefined;
}

/**
 * What a panel reads, from the shell's context, and how its controls run a
 * command and ask why one cannot run: as every other surface does, so a
 * panel's button and the palette entry of the same name are one action.
 */
export function panelContextOf(
  context: ShellContext,
  run: (id: string) => void,
  unavailableReason: (id: string) => string | undefined,
): PanelContext {
  return {
    capabilities: context.capabilities,
    logs: context.logs,
    logViews: context.logViews,
    diagnosticModeActive: context.diagnostics.isDiagnosticModeActive(),
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
      return <CapabilitiesPanel title={title} capabilities={context.capabilities} />;

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
