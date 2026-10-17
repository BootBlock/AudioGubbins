/**
 * The shell that draws the application, and the function that mounts it.
 *
 * What the application is built from is `application.ts`, the composition root;
 * this module builds it when it mounts and passes it down, so importing this
 * module reads nothing and probes nothing.
 */

import { StrictMode, useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CapabilityKey } from '@audiogubbins/capabilities';
import { commandId, describePresses, type CommandId } from '@audiogubbins/commands';
import {
  HintProvider,
  NoticeProvider,
  NoticeSurface,
  ThemeProvider,
} from '@audiogubbins/design-system';
import { DockHost, DockStage, titleOf } from '@audiogubbins/workspace';

import { createApplication, type Application } from './application.js';
import type { RunCommand } from './shell/settings/section.js';
import { useShellShortcuts } from './input/use-shell-shortcuts.js';
import { bundleSourcesFrom } from './commands/diagnostic-commands.js';
import type { PanelCommands } from './shell/command-button.js';
import { CommandPalette } from './shell/command-palette.js';
import { dockMotionOf } from './shell/dock-motion.js';
import { panelGlyph } from './shell/panel-glyphs.js';
import { DiagnosticExportDialog } from './shell/diagnostic-export.js';
import { ApplicationFailure, FailureBoundary, PanelFailure } from './shell/failure-boundary.js';
import { shellMenus } from './shell/menus.js';
import { MenuBarRow } from './shell/menu-bar-row.js';
import { panelContextOf } from './shell/panel-context.js';
import { renderPanel } from './shell/panels.js';
import { ProjectBanner } from './shell/project-banner.js';
import { ProjectSurfaces } from './shell/project-surfaces.js';
import { BackupStatus } from './shell/backup-status.js';
import { SaveStatus } from './shell/save-status.js';
import { SettingsDialog } from './shell/settings-dialog.js';
import { InputStatus } from './shell/recording/input-status.js';
import { StatusBar } from './shell/status-bar.js';
import { TooNarrowNotice } from './shell/too-narrow.js';
import { useRecoveryAnnouncement } from './shell/use-recovery-announcement.js';
import { useShellState } from './shell/use-shell-state.js';
import { useProjectState } from './shell/use-project-state.js';
import { useWorkspaceWidth } from './shell/use-workspace-width.js';
import { standingRecovery } from './state/recovery-notices.js';

import '@audiogubbins/design-system/styles/tokens.css';
import '@audiogubbins/design-system/styles/components.css';
import '@audiogubbins/design-system/styles/buttons.css';
import '@audiogubbins/design-system/styles/dials.css';
import '@audiogubbins/design-system/styles/lit-edge.css';
import '@audiogubbins/design-system/styles/overlays.css';
import '@audiogubbins/design-system/styles/fields.css';
import '@audiogubbins/design-system/styles/chrome.css';
import '@audiogubbins/workspace/styles/workspace.css';
import './shell/shell.css';
import './shell/frame.css';
import './shell/status-bar.css';
import './shell/project-banner.css';
import './shell/too-narrow.css';
import './shell/failure-boundary.css';
import './shell/transport-panel.css';
import './shell/command-palette.css';
import './shell/settings/settings.css';
import './shell/asset-browser.css';
import './shell/editor-panel.css';
import './shell/engine-readouts.css';
import './shell/inspector/inspector.css';
import './shell/history/history.css';
import './shell/spectral/spectral.css';
import './shell/recording/recording.css';
import './shell/analysis/analysis.css';
import { timeOfDay } from '@audiogubbins/text';

/** The application. */
function AudioGubbins({ application }: { readonly application: Application }) {
  const { context, registry, bus, logger, convention, appearance, descriptors, rearrange, run } =
    application;

  const {
    preferences,
    workspace,
    interaction,
    shortcuts,
    verbosity,
    audioSettings,
    keyboardLayout,
    persistence,
    missingCapabilities,
    resolvedTheme,
    diagnosticModeEndsAt,
    logCategories,
    paletteShortcut,
    editableCommands,
  } = useShellState(application);

  const [settingsSection, setSettingsSection] = useState('appearance');
  const project = useProjectState(context.storageRoot, context.projects);

  /**
   * Why this browser does not say what the keyboard types, where it does not.
   *
   * Nothing while it is still being asked: a capability that has not answered
   * is not among those missing, which is no cause of a wait.
   */
  const layoutMapReason = missingCapabilities.find(
    (one) => one.key === CapabilityKey.KeyboardLayoutMap,
  )?.reason;

  /** What a command is called, so no surface has to show its identifier. */
  const labelFor = useCallback((id: CommandId) => registry.get(id)?.label ?? id, [registry]);

  const { announce } = context.interaction;

  /** Runs a command a settings surface names by its identifier. */
  const runNamed: RunCommand = useCallback(
    (id, args, options) => run(commandId(id), args, options).kind !== 'refused',
    [run],
  );

  /** Why a command a settings surface names cannot run now, as the menus say it. */
  const unavailableReason: PanelCommands['unavailableReason'] = (id, args) => {
    const availability = bus.availability(context, commandId(id), args);
    return availability.available ? undefined : availability.reason;
  };

  // One list of the notices standing, for the announcement and the status
  // bar alike, so each says what the other shows.
  const recovery = standingRecovery(workspace, shortcuts);
  useRecoveryAnnouncement(recovery, announce);
  useWorkspaceWidth(announce);

  useShellShortcuts(application);

  // Built on every render rather than remembered. Whether an entry can be
  // chosen is read from whichever store its command reads, and a remembered
  // list of the stores it depends on would go out of date the first time a
  // command read one not on it: the theme entries would stay greyed after the
  // theme changed.
  const menus = shellMenus({
    registry,
    context,
    profile: shortcuts.profile,
    convention,
    layout: keyboardLayout,
    descriptors,
    workspace,
    run,
  });

  const pendingChordText = describePresses(interaction.pendingChord, convention, keyboardLayout);

  const dockMotion = useMemo(() => dockMotionOf(resolvedTheme), [resolvedTheme]);

  return (
    <ThemeProvider preferences={preferences} system={appearance}>
      <HintProvider>
        <NoticeProvider notice={interaction.announcement}>
          <div className="ag-app">
            <MenuBarRow
              menus={menus}
              paletteShortcut={paletteShortcut}
              onCommands={() => {
                run(commandId('view.command-palette'));
              }}
            />

            <ProjectBanner
              root={context.storageRoot}
              project={context.projects?.project}
              quickEdit={context.projects?.quickEdit}
              interrupted={context.projects?.interrupted}
              run={runNamed}
              announce={announce}
            />

            {/* Focusable, so the reader can be put back at the workspace when
              the window is widened past the declared minimum again. */}
            <main className="ag-workspace" tabIndex={-1}>
              <DockStage
                // The dock builds its arrangement when it mounts, so a change
                // made outside it needs it to mount again. The revision moves
                // only for those; a drag the engine itself reported leaves it
                // alone, which is what stops a remount from undoing the drag.
                // The stage builds it again under the new key, in a view
                // transition where the motion level has one.
                arrangement={{
                  key: `${workspace.layout.id}:${String(workspace.revision)}`,
                  layout: workspace.layout,
                }}
                motion={dockMotion}
              >
                {(shown) => (
                  <DockHost
                    key={shown.key}
                    layout={shown.layout}
                    descriptors={descriptors}
                    // The resolved theme, not the preference: given the preference,
                    // in system mode on a light system the engine would get the
                    // dark class while the shell drew light. Every variable that
                    // differs is overridden by the workspace stylesheet today, so
                    // nothing would show; one engine upgrade and it would.
                    dark={resolvedTheme.dark}
                    memory={application.dockMemory}
                    motion={dockMotion}
                    glyph={panelGlyph}
                    onArrangementChange={rearrange}
                    renderPanel={(panel) => (
                      // One boundary per panel, so a panel that throws costs the
                      // user that panel and not the application around it.
                      <FailureBoundary
                        part={`panel:${panel.kind}`}
                        logger={logger}
                        notice={({ failure, retry }) => (
                          <PanelFailure
                            title={titleOf(panel, descriptors)}
                            failure={failure}
                            retry={retry}
                          />
                        )}
                      >
                        {renderPanel(
                          panel,
                          titleOf(panel, descriptors),
                          panelContextOf(application, runNamed, unavailableReason),
                        )}
                      </FailureBoundary>
                    )}
                  />
                )}
              </DockStage>
              <TooNarrowNotice />
            </main>

            <StatusBar
              workspaceName={workspace.layout.displayName}
              pendingChord={pendingChordText}
              diagnosticModeActive={context.diagnostics.isDiagnosticModeActive()}
              persistence={persistence}
              recovery={recovery}
              missingCapabilities={missingCapabilities.length + context.storageAbsences.length}
              saving={
                <>
                  <SaveStatus open={project.open} run={runNamed} announce={announce} />
                  {context.projects !== undefined && (
                    <BackupStatus
                      backups={context.projects.backups}
                      run={runNamed}
                      announce={announce}
                    />
                  )}
                </>
              }
              input={<InputStatus recording={context.recording} announce={announce} />}
              run={run}
            />

            {/*
              Mounted while it is shut, not only while it is open. A dialogue
              remembers where focus has been by listening from the moment it
              mounts, so one that mounted as it opened would have nothing to go
              back to, and would drop the user on the document body when it
              closed.
            */}
            <CommandPalette
              open={interaction.paletteOpen}
              onClose={() => {
                run(commandId('view.close-command-palette'));
              }}
              commands={registry.all()}
              profile={shortcuts.profile}
              convention={convention}
              layout={keyboardLayout}
              onRun={run}
              context={context}
            />

            <SettingsDialog
              open={interaction.settingsOpen}
              onOpenChange={(open) => {
                if (!open) run(commandId('settings.close'));
              }}
              preferences={preferences}
              shortcuts={{
                profile: shortcuts.profile,
                available: shortcuts.available,
                conflicts: shortcuts.conflicts,
                reserved: shortcuts.reserved,
                waiting: shortcuts.waiting,
                // Why the layout is not known already, where the browser does
                // not say: the defaults that wait for a key say their cause.
                ...(layoutMapReason === undefined ? {} : { layoutMapReason }),
                commands: editableCommands,
                convention,
                layout: keyboardLayout,
                learnKey: context.keyboardLayout.learn,
                askFor: context.interaction.askForCommandPress,
                labelFor,
                announce,
                unread: shortcuts.unread,
              }}
              unavailableReason={unavailableReason}
              diagnosticModeActive={context.diagnostics.isDiagnosticModeActive()}
              {...(diagnosticModeEndsAt === undefined
                ? {}
                : {
                    diagnosticModeEnds: timeOfDay(diagnosticModeEndsAt),
                  })}
              verbosity={verbosity}
              audio={audioSettings}
              recording={context.recording}
              logCategories={logCategories}
              layout={workspace.layout}
              available={workspace.available}
              deleted={workspace.deleted}
              workspaceUnread={workspace.unread}
              projects={context.projects}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              run={runNamed}
            />

            <DiagnosticExportDialog
              open={interaction.diagnosticExportOpen}
              onOpenChange={(open) => {
                if (!open) run(commandId('help.close-diagnostic-export'));
              }}
              sourcesFor={(notes) => bundleSourcesFrom(context, notes)}
              run={runNamed}
            />

            <ProjectSurfaces
              context={context}
              root={context.storageRoot}
              projects={context.projects}
              exports={context.exports}
              presets={preferences.exportPresets}
              codecs={context.codecs}
              section={interaction.projectsSection}
              run={runNamed}
              unavailableReason={unavailableReason}
            />

            <NoticeSurface />
          </div>
        </NoticeProvider>
      </HintProvider>
    </ThemeProvider>
  );
}

/**
 * Builds the application and mounts it.
 *
 * A failure while building it is shown rather than thrown past: a composition
 * root that throws leaves the page empty, which is the failure the boundary
 * below exists to prevent once the application is running.
 *
 * Answers what takes it down again, so that a test that mounts it leaves no
 * application listening to the page for the next.
 */
export function mount(container: HTMLElement): () => void {
  const root = createRoot(container);

  let application: Application;
  try {
    application = createApplication();
  } catch (failure) {
    root.render(<ApplicationFailure failure={failure} />);
    return () => {
      root.unmount();
    };
  }

  // The application's own teardown before React's. What the composition root
  // registered on the document and the window is outside React, and
  // `root.unmount()` removes none of it.
  const unmount = (): void => {
    application.dispose();
    root.unmount();
  };

  root.render(
    <StrictMode>
      <FailureBoundary
        part="application"
        logger={application.logger}
        notice={({ failure }) => <ApplicationFailure failure={failure} />}
      >
        <AudioGubbins application={application} />
      </FailureBoundary>
    </StrictMode>,
  );
  return unmount;
}
