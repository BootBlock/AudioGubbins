/**
 * The settings dialogue.
 *
 * REQ-UX-071 asks for progressive disclosure rather than removing advanced
 * controls, so the sections are tabs: everything is present, and nothing is on
 * screen until it is asked for. Each section is its own module, because they
 * share nothing but the tab they sit in and the one way they run a command.
 *
 * Every control runs a command rather than calling a store (REQ-EDIT-073). That
 * is not ceremony: it is what makes the same change reachable from the palette
 * and from a shortcut, and what keeps one place deciding whether a change is
 * currently allowed.
 */

import type { ReactNode } from 'react';

import { ModalDialog, TabSet, type ThemePreferences } from '@audiogubbins/design-system';
import type { VerbosityConfiguration } from '@audiogubbins/diagnostics';
import type { WorkspaceLayout } from '@audiogubbins/workspace';

import type { AudioSettings } from '../state/audio-settings-store.js';
import { Accessibility, Appearance } from './settings/appearance.js';
import { Audio } from './settings/audio.js';
import { Diagnostics } from './settings/diagnostics.js';
import type { RunCommand } from './settings/section.js';
import { Shortcuts, type ShortcutsProps } from './settings/shortcuts.js';
import { Workspaces } from './settings/workspaces.js';

/** What the dialogue needs. */
export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  readonly preferences: ThemePreferences;

  /** Runs a command by identifier, which is how every control acts. */
  readonly run: RunCommand;

  /**
   * What the Shortcuts section shows: the profiles, what is said of their
   * bindings, and the commands a user could bind. Handed on whole, since no
   * other section reads any of it.
   */
  readonly shortcuts: Omit<ShortcutsProps, 'run' | 'unavailableReason'>;

  /** Why a command cannot run now, or `undefined` when it can. */
  readonly unavailableReason: (id: string) => string | undefined;

  readonly diagnosticModeActive: boolean;

  /** When diagnostic mode ends on its own, as text, while it is on. */
  readonly diagnosticModeEnds?: string;

  /** The performance profile, the Custom profile's settings, the background priority and the render mode. */
  readonly audio: AudioSettings;

  /** How much the log records, and which subsystems write to it. */
  readonly verbosity: VerbosityConfiguration;
  readonly logCategories: readonly string[];

  /** The workspace the user is looking at, and the ones they can switch to. */
  readonly layout: WorkspaceLayout;
  readonly available: readonly WorkspaceLayout[];

  /** Which section is showing. */
  readonly section: string;
  readonly onSectionChange: (section: string) => void;
}

/** The settings dialogue. */
export function SettingsDialog(props: SettingsDialogProps): ReactNode {
  const { open, onOpenChange, section, onSectionChange } = props;

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="How AudioGubbins looks, how it moves, how it processes audio, and what it records."
    >
      <TabSet
        label="Settings sections"
        value={section}
        onValueChange={onSectionChange}
        tabs={[
          {
            value: 'appearance',
            label: 'Appearance',
            content: <Appearance preferences={props.preferences} run={props.run} />,
          },
          {
            value: 'accessibility',
            label: 'Accessibility',
            content: <Accessibility preferences={props.preferences} run={props.run} />,
          },
          {
            value: 'workspaces',
            label: 'Workspaces',
            content: (
              <Workspaces
                layout={props.layout}
                available={props.available}
                run={props.run}
                unavailableReason={props.unavailableReason}
              />
            ),
          },
          {
            value: 'shortcuts',
            label: 'Shortcuts',
            content: (
              <Shortcuts
                {...props.shortcuts}
                run={props.run}
                unavailableReason={props.unavailableReason}
              />
            ),
          },
          {
            value: 'audio',
            label: 'Audio',
            content: <Audio settings={props.audio} run={props.run} />,
          },
          {
            value: 'diagnostics',
            label: 'Diagnostics',
            content: (
              <Diagnostics
                diagnosticModeActive={props.diagnosticModeActive}
                {...(props.diagnosticModeEnds === undefined
                  ? {}
                  : { diagnosticModeEnds: props.diagnosticModeEnds })}
                verbosity={props.verbosity}
                categories={props.logCategories}
                run={props.run}
              />
            ),
          },
        ]}
      />
    </ModalDialog>
  );
}
