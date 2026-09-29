/**
 * The shell that draws the application, and the function that mounts it.
 *
 * What the application is built from is `application.ts`, the composition root;
 * this module builds it when it mounts and passes it down, so importing this
 * module reads nothing and probes nothing.
 */

import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CapabilityKey } from '@audiogubbins/capabilities';
import { commandId, describePresses, type CommandId } from '@audiogubbins/commands';
import {
  ControlBar,
  ControlBarButton,
  HintProvider,
  MenuBar,
  MenuBarMenu,
  NoticeProvider,
  NoticeSurface,
  ThemeProvider,
} from '@audiogubbins/design-system';
import { DockHost, titleOf } from '@audiogubbins/workspace';

import { createApplication, type Application } from './application.js';
import type { RunCommand } from './shell/settings/section.js';
import { useShellShortcuts } from './input/use-shell-shortcuts.js';
import { bundleSourcesFrom } from './commands/diagnostic-commands.js';
import { CommandPalette } from './shell/command-palette.js';
import { DiagnosticExportDialog } from './shell/diagnostic-export.js';
import { ApplicationFailure, FailureBoundary, PanelFailure } from './shell/failure-boundary.js';
import { shellMenus } from './shell/menus.js';
import { panelContextOf, renderPanel } from './shell/panels.js';
import { SettingsDialog } from './shell/settings-dialog.js';
import { StatusBar } from './shell/status-bar.js';
import { TooNarrowNotice } from './shell/too-narrow.js';
import { useRecoveryAnnouncement } from './shell/use-recovery-announcement.js';
import { useShellState } from './shell/use-shell-state.js';
import { useWorkspaceWidth } from './shell/use-workspace-width.js';
import { standingRecovery } from './state/recovery-notices.js';

import '@audiogubbins/design-system/styles/tokens.css';
import '@audiogubbins/design-system/styles/components.css';
import '@audiogubbins/workspace/styles/workspace.css';
import './shell/shell.css';

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
  const unavailableReason = (id: string): string | undefined => {
    const availability = bus.availability(context, commandId(id));
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

  return (
    <ThemeProvider preferences={preferences} system={appearance}>
      <HintProvider>
        <NoticeProvider notice={interaction.announcement}>
          <div className="ag-app">
            <header className="ag-menu-bar">
              {/*
                The document's one `h1`, and the name the menu bar shows. Every
                panel titles itself with an `h2` and the too-narrow notice does
                too, so without it the heading structure would begin at the
                second level with nothing above it, and below the declared width
                it would be a single `h2` alone. Written as a hidden heading of
                its own it would stand between the banner and the main region,
                belonging to neither, so a reader moving by landmark would never
                meet it and the name would be on the page twice.
              */}
              <h1 className="ag-product-name">AudioGubbins</h1>

              {/*
                The menus and the actions beside them are separate bars, because
                they are separate things to a screen reader: a menu bar holds
                menus and nothing else. A button that runs a command is not a
                menu, so it sits in its own toolbar rather than pretending.
              */}
              <MenuBar label="Main menu">
                {menus.map((menu) => (
                  <MenuBarMenu key={menu.label} label={menu.label} groups={menu.groups} />
                ))}
              </MenuBar>

              <ControlBar label="Quick actions">
                <ControlBarButton
                  label="Commands"
                  hint="Run a command"
                  {...(paletteShortcut === undefined ? {} : { shortcut: paletteShortcut })}
                  onPress={() => {
                    run(commandId('view.command-palette'));
                  }}
                />
              </ControlBar>
            </header>

            {/* Focusable, so the reader can be put back at the workspace when
              the window is widened past the declared minimum again. */}
            <main className="ag-workspace" tabIndex={-1}>
              <DockHost
                // The dock builds its arrangement when it mounts, so a change
                // made outside it needs it to mount again. The revision moves
                // only for those; a drag the engine itself reported leaves it
                // alone, which is what stops a remount from undoing the drag.
                key={`${workspace.layout.id}:${String(workspace.revision)}`}
                layout={workspace.layout}
                descriptors={descriptors}
                // The resolved theme, not the preference: given the preference,
                // in system mode on a light system the engine would get the
                // dark class while the shell drew light. Every variable that
                // differs is overridden by the workspace stylesheet today, so
                // nothing would show; one engine upgrade and it would.
                dark={resolvedTheme.dark}
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
                      panelContextOf(context, runNamed, unavailableReason),
                    )}
                  </FailureBoundary>
                )}
              />
              <TooNarrowNotice />
            </main>

            <StatusBar
              workspaceName={workspace.layout.displayName}
              pendingChord={pendingChordText}
              diagnosticModeActive={context.diagnostics.isDiagnosticModeActive()}
              unsaved={persistence.unsaved}
              recovery={recovery}
              missingCapabilities={missingCapabilities.length}
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
              }}
              unavailableReason={unavailableReason}
              diagnosticModeActive={context.diagnostics.isDiagnosticModeActive()}
              {...(diagnosticModeEndsAt === undefined
                ? {}
                : {
                    diagnosticModeEnds: new Date(diagnosticModeEndsAt).toLocaleTimeString('en-GB'),
                  })}
              verbosity={verbosity}
              audio={audioSettings}
              logCategories={logCategories}
              layout={workspace.layout}
              available={workspace.available}
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
