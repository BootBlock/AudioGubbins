import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { LogSeverity, createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  ALL_FEATURES,
  createCapabilityRegistry,
  missingStorageCapabilities,
  type CapabilityEnvironment,
} from '@audiogubbins/capabilities';

import { PanelKinds } from '@audiogubbins/workspace';

import type { Detections } from '../analysis/detection-control.js';
import { EditingPanelKinds, ProjectPanelKinds } from '../panel-kinds.js';
import { createAudioSettingsStore, type AudioSettings } from '../state/audio-settings-store.js';
import { createAudioViewStore, type AudioView } from '../state/audio-view-store.js';
import { createLogViewStore } from '../state/log-view-store.js';
import type { Observable } from '../state/observable.js';
import {
  createRenderStrategyStore,
  type RenderStrategyView,
} from '../state/render-strategy-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { createRendererReports } from '../state/renderer-reports.js';
import { fakePanelParts } from '../testing/editor-fakes.js';
import { buildShellContext } from '../testing/shell-context.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { DiagnosticsPanel, recordsPassing } from './diagnostics-panel.js';
import { CapabilitiesPanel, renderPanel, type PanelContext } from './panels.js';

/**
 * The diagnostic log panel.
 *
 * Drawn here on its own, since a user reaches it only through a preset or a
 * command. A panel that exceeds React's update depth on its first paint throws
 * below the composition root, and with no boundary there to catch it the whole
 * application would be blanked.
 */

/** A store holding one record, so the panel has something to draw. */
function storeWithRecords(count: number) {
  const logs = createLogStore();
  for (let index = 0; index < count; index += 1) {
    logs.write({
      timestamp: 0,
      severity: LogSeverity.Info,
      category: 'shell',
      message: `Record ${String(index)}`,
      fields: {},
    });
  }
  return logs;
}

/** A browser that offers nothing, which is what a degraded one looks like. */
function bareEnvironment(): CapabilityEnvironment {
  return {
    hasOriginPrivateFileSystem: false,
    hasFileSystemAccess: false,
    hasSharedArrayBuffer: false,
    isCrossOriginIsolated: false,
    hasAudioWorklet: false,
    compilesWebAssembly: false,
    validatesWebAssemblySimd: false,
    choosesAudioOutput: false,
    hasWebWorkers: false,
    hasWebGpu: false,
    hasWebGl2: false,
    hasOffscreenCanvas: false,
    hasWebCodecs: false,
    hasMediaDevices: false,
    hasServiceWorker: false,
    hasStorageEstimate: false,
    hasPersistentStorage: false,
    hasPointerEvents: false,
    reportsPointerPressure: false,
    hasLocalStorage: false,
    hasMediaQueries: false,
    hasKeyboardLayoutMap: false,
    comparesNames: false,
    hasVideoFrameCallback: false,
    hasFullscreen: false,
  };
}

/** No meter's levels: one map, as a display's read wants the same value until it changes. */
const NO_METERS = new Map();

/**
 * No panel is a landmark of its own. The dock's tab names a panel and its
 * heading says it again, so a region named by the heading would make a screen
 * reader give the title three times. Asked of one panel only, the others could
 * each get their region back unseen.
 */

describe('what a panel is given', () => {
  it('reads the audio stores and cannot write them, changing them only by a command', () => {
    // Compared exactly, so a store's setter added back to a panel's view of it
    // fails to compile.
    expectTypeOf<PanelContext['audio']>().toEqualTypeOf<Observable<AudioView>>();
    expectTypeOf<PanelContext['audioSettings']>().toEqualTypeOf<Observable<AudioSettings>>();
    expectTypeOf<PanelContext['renderStrategy']>().toEqualTypeOf<Observable<RenderStrategyView>>();
    expectTypeOf<PanelContext['detection']>().toEqualTypeOf<Observable<Detections>>();
  });
});

describe('every panel', () => {
  it.each([
    ...Object.values(PanelKinds),
    ...Object.values(ProjectPanelKinds),
    ...Object.values(EditingPanelKinds),
    'a-kind-this-build-does-not-have',
  ])('draws %s with its heading and no region', (kind) => {
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');
    const shell = buildShellContext().context;
    render(
      <>
        {renderPanel({ id: 'probe', kind }, 'Probe', {
          capabilities: createCapabilityRegistry(
            bareEnvironment(),
            createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
          ),
          logs: createLogStore(),
          logViews: createLogViewStore(),
          diagnosticModeActive: false,
          storageAbsences: [],
          projects: undefined,
          projectsUnavailable: 'This test keeps no projects.',
          audio: createAudioViewStore(),
          audioSettings: createAudioSettingsStore(
            createStateStorage(ephemeralStorage(), logger, () => undefined),
            logger,
          ),
          renderStrategy: createRenderStrategyStore(),
          playhead: () => undefined,
          meters: () => NO_METERS,
          framesRendered: () => 0,
          run: () => true,
          unavailableReason: () => undefined,
          labelFor: (id) => id,
          editor: fakePanelParts(shell, logger),
          detection: shell.detection,
        })}
      </>,
    );

    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toEqual([]);
  });
});

describe('the diagnostic log panel', () => {
  it('shows the records it holds, newest first', () => {
    // Drawn at all, it holds the defect of an external store value read as a
    // fresh copy of the records, which React compared with itself, found
    // changed, and rendered again past its update depth. So does every other
    // test that draws the panel.
    render(
      <DiagnosticsPanel
        panelId="diagnostics"
        title="Diagnostics"
        logs={storeWithRecords(3)}
        views={createLogViewStore()}
        diagnosticModeActive={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    // Not a landmark of its own, nor anything drawn only once it holds records:
    // the dock's tab names the panel, and the heading says it again.
    expect(screen.queryAllByRole('region')).toEqual([]);
    const entries = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(entries[0]).toContain('Record 2');
    expect(entries[2]).toContain('Record 0');
  });

  it('shows what the reader chose to see when it is drawn again', async () => {
    // A refused drag, and every arrangement command made outside the dock,
    // build the dock again with every panel in it. Kept in the panel, a log
    // filtered to its errors showed everything again after each.
    //
    // The reader chooses here rather than starting from a filter already
    // recorded: written that way, nothing would call the panel's own handler,
    // so deleting the line that records the choice would leave this test
    // passing and only the browser suite to catch it.
    const logs = storeWithRecords(2);
    logs.write({
      timestamp: 0,
      severity: LogSeverity.Error,
      category: 'storage',
      message: 'The write failed.',
      fields: {},
    });
    const views = createLogViewStore();

    const panel = (): ReactNode => (
      <DiagnosticsPanel
        panelId="diagnostics"
        title="Diagnostics"
        logs={logs}
        views={views}
        diagnosticModeActive={false}
      />
    );
    const first = render(panel());

    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    const user = userEvent.setup();
    screen.getByRole('combobox', { name: 'Show' }).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('option', { name: 'error and above' }));

    expect(views.get().byPanel.get('diagnostics')).toEqual({
      threshold: LogSeverity.Error,
      category: 'all',
    });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('The write failed.'),
    ]);

    first.unmount();
    render(panel());

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('The write failed.'),
    ]);
  });

  it('forgets what a closed panel was filtered to, so its identifier comes back clean', () => {
    // A closed panel's identifier is handed back to the next panel of its
    // kind. Nothing ever removed an entry, so a Diagnostics panel closed and
    // opened again came back filtered to what the panel the user closed had
    // been showing, which nobody chose.
    const views = createLogViewStore();
    views.choose('diagnostics', { threshold: LogSeverity.Error });
    views.choose('diagnostics:2', { category: 'storage' });

    views.forgetClosed(['diagnostics:2']);

    expect(views.viewOf('diagnostics')).toEqual({
      threshold: LogSeverity.Trace,
      category: 'all',
    });
    expect(views.viewOf('diagnostics:2')).toEqual({
      threshold: LogSeverity.Trace,
      category: 'storage',
    });
  });

  it('says so when nothing has been recorded', () => {
    render(
      <DiagnosticsPanel
        panelId="diagnostics"
        title="Diagnostics"
        logs={createLogStore()}
        views={createLogViewStore()}
        diagnosticModeActive={false}
      />,
    );

    expect(screen.getByText('Nothing has been recorded.')).toBeInTheDocument();
  });

  it('says when diagnostic mode is collecting more than usual', () => {
    // REQ-PRIV-165 requires a clear indication while the mode is active.
    render(
      <DiagnosticsPanel
        panelId="diagnostics"
        title="Diagnostics"
        logs={createLogStore()}
        views={createLogViewStore()}
        diagnosticModeActive
      />,
    );

    expect(screen.getByText(/collecting more detail than usual/)).toBeInTheDocument();
  });
});

/**
 * The capability surface, with something to report.
 *
 * REQ-EXEC-216 requires an unsupported capability to be represented explicitly.
 * The registry's own tests prove the reason and the remedy exist; these prove a
 * user is shown them, which a test that opens the panel on Chromium cannot,
 * since nothing is missing there and the empty branch is the only one reached.
 */
describe('the capability panel', () => {
  it('names each reduced feature, what it means and what can be done about it', () => {
    const registry = createCapabilityRegistry(
      bareEnvironment(),
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
    );

    render(
      <CapabilitiesPanel
        title="Capabilities"
        capabilities={registry}
        renderers={createRendererReports()}
        storageAbsences={[]}
      />,
    );

    expect(screen.getAllByText(/Unavailable|Reduced/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recording/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/secure connection|current version|headers/i).length,
    ).toBeGreaterThan(0);

    // What each reduction means. `Recording` above is satisfied by the
    // feature's name alone, so without this the explanation would be asserted
    // by nothing.
    const explanations = [...document.querySelectorAll('.ag-capability-explanation')].map(
      (element) => element.textContent,
    );
    expect(explanations).toEqual(
      registry.degradedFeatures(ALL_FEATURES).map((feature) => feature.explanation),
    );
    expect(explanations.length).toBeGreaterThan(0);
  });

  it('explains a missing keyboard layout map where the status bar sends the reader', () => {
    // Firefox and Safari have no map. The status bar counted it, and the panel
    // it opens said nothing of it, its cause or its remedy.
    const registry = createCapabilityRegistry(
      { ...bareEnvironment(), hasLocalStorage: true, hasMediaQueries: true },
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
    );

    render(
      <CapabilitiesPanel
        title="Capabilities"
        capabilities={registry}
        renderers={createRendererReports()}
        storageAbsences={[]}
      />,
    );

    expect(screen.getByText('Default shortcuts on your keyboard from the start')).toBeVisible();
    expect(
      screen.getByText(/This browser does not tell AudioGubbins what your keyboard types/),
    ).toBeVisible();
    // And what to do about it, with the condition: a reader who followed the
    // status bar here, pressed the key with Caps Lock on and saw nothing
    // happen was given no cause anywhere.
    expect(screen.getByText(/with Caps Lock off, anywhere in AudioGubbins/)).toBeVisible();
    // Both kinds of wait. On Apple hardware a default whose character sits
    // away from its US key waits for a press made with Command, which no key
    // press ends, and this panel sent the reader to press the key instead.
    // Made in the settings, which keep that press from the browser while they
    // ask for it and nowhere else.
    expect(
      screen.getByText(
        /On Apple hardware, a default may instead wait for you to press its key with Command while the Shortcuts settings, which name the key, are open\./,
      ),
    ).toBeVisible();
  });

  it('gives every reduced feature a status a reader can act on', () => {
    const registry = createCapabilityRegistry(
      bareEnvironment(),
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
    );

    render(
      <CapabilitiesPanel
        title="Capabilities"
        capabilities={registry}
        renderers={createRendererReports()}
        storageAbsences={[]}
      />,
    );

    const statuses = screen.getAllByText(/^(Unavailable|Reduced)$/);
    expect(statuses.map((status) => status.getAttribute('data-ag-status'))).toEqual(
      registry.degradedFeatures(ALL_FEATURES).map((feature) => feature.status),
    );
  });
});

describe('filtering the diagnostic log', () => {
  /** Records of two severities in two subsystems. */
  const records = [
    {
      timestamp: 0,
      severity: LogSeverity.Info,
      category: 'shell',
      message: 'Started.',
      fields: {},
    },
    {
      timestamp: 1,
      severity: LogSeverity.Error,
      category: 'shell',
      message: 'Failed.',
      fields: {},
    },
    { timestamp: 2, severity: LogSeverity.Info, category: 'commands', message: 'Ran.', fields: {} },
  ];

  it('keeps what passes the level the reader chose', () => {
    // The panel's filter is what a requirement rests on, and these drive it:
    // without them, replacing the whole expression with `records` would leave
    // every test passing.
    const shown = recordsPassing(records, LogSeverity.Error, 'all');

    expect(shown.map((record) => record.message)).toEqual(['Failed.']);
  });

  it('keeps only the subsystem the reader chose', () => {
    const shown = recordsPassing(records, LogSeverity.Trace, 'commands');

    expect(shown.map((record) => record.message)).toEqual(['Ran.']);
  });

  it('keeps everything when the reader has chosen neither', () => {
    expect(recordsPassing(records, LogSeverity.Trace, 'all')).toHaveLength(3);
  });

  it('can leave nothing, which is what the panel says the filter did', () => {
    expect(recordsPassing(records, LogSeverity.Error, 'commands')).toEqual([]);
  });
});

describe('what the browser lacks for keeping projects', () => {
  it('lists each missing part with what AudioGubbins does instead and what can be done', () => {
    const registry = createCapabilityRegistry(
      bareEnvironment(),
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
    );
    const absences = missingStorageCapabilities({
      originPrivateFileSystem: true,
      locks: undefined,
      openBroadcastChannel: undefined,
      persistence: undefined,
      estimate: undefined,
      pickers: undefined,
      indexedDb: undefined,
      subtle: undefined,
      randomBytes: undefined,
      hostYielding: { kind: 'none' },
    });

    render(
      <CapabilitiesPanel
        title="Capabilities"
        capabilities={registry}
        renderers={createRendererReports()}
        storageAbsences={absences}
      />,
    );

    const keeping = screen.getByRole('group', { name: 'Keeping projects' });
    expect(
      within(keeping).getByText(
        'This browser cannot agree between tabs which one may change a project.',
      ),
    ).toBeVisible();
    expect(
      within(keeping).getByText(
        /Projects open read-only, so two tabs can never overwrite each other\./,
      ),
    ).toBeVisible();
    expect(
      within(keeping).getAllByText(
        'Open AudioGubbins from its https:// address rather than an insecure one.',
      ),
    ).not.toEqual([]);
  });
});
