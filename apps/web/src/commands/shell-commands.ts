/**
 * Every action the shell can perform: the shell's own, the audio engine's, the
 * editor's and the project system's.
 *
 * REQ-EDIT-073 requires each of these to be reachable the same way from a menu,
 * a shortcut, the palette and a future macro, which is what registering them
 * here achieves. A menu item that called a store method directly would work and
 * would be invisible to the palette, unbindable to a shortcut, and absent from
 * any future automation.
 *
 * The commands are grouped by what they act on, one module each, because they
 * have nothing in common but the shape {@link shellCommand} gives them. Kept in
 * one file, they would put it past the cohesion threshold REQ-EXEC-136.7 sets,
 * and the split is along the seam the categories already describe.
 */

import { AVAILABLE, CommandCategory, unavailable, type Command } from '@audiogubbins/commands';
import type { PanelDescriptor, PanelKind } from '@audiogubbins/workspace';

import { analysisCommands } from './analysis-commands.js';
import { backupCommands } from './backup-commands.js';
import { backupFolderCommands } from './backup-folder-commands.js';
import { compactionCommands } from './compaction-commands.js';
import { auditionCommands } from './audition-commands.js';
import { comparisonCommands } from './comparison-commands.js';
import { historyCommands } from './history-commands.js';
import { libraryApplyCommands } from './library-apply-commands.js';
import { libraryCommands } from './library-commands.js';
import { ownershipCommands } from './ownership-commands.js';
import { packCommands } from './pack-commands.js';
import { deletionCommands } from './project-deletion-commands.js';
import { projectFileCommands } from './project-file-commands.js';
import { projectTransferCommands } from './project-transfer-commands.js';
import { audioImportCommands } from './audio-import-commands.js';
import { quickEditCommands } from './quick-edit-commands.js';
import { rackBuildingCommands } from './rack-building-commands.js';
import { rackClipboardCommands } from './rack-clipboard-commands.js';
import { rackComparisonCommands } from './rack-comparison-commands.js';
import { rackHearingCommands } from './rack-hearing-commands.js';
import { rackParameterCommands } from './rack-parameter-commands.js';
import { rackSlotCommands } from './rack-slot-commands.js';
import { audioCommands } from './audio-commands.js';
import { audioSettingsCommands } from './audio-settings-commands.js';
import { qualityCommands } from './quality-commands.js';
import { recordingCommands } from './recording-commands.js';
import { recordingSettingsCommands } from './recording-settings-commands.js';
import { takeRecordingCommands } from './take-recording-commands.js';
import { takeStackCommands } from './take-commands.js';
import { takeAuditionCommands } from './take-audition-commands.js';
import { interruptedRecordingCommands } from './interrupted-recording-commands.js';
import { diagnosticCommands } from './diagnostic-commands.js';
import { editorAssetCommands } from './editor-asset-commands.js';
import { editorNavigationCommands } from './editor-navigation-commands.js';
import { editorOptionCommands } from './editor-option-commands.js';
import { editorPresentationCommands } from './editor-presentation-commands.js';
import { channelCommands } from './channel-commands.js';
import { clipboardCommands } from './clipboard-commands.js';
import { editCommands } from './edit-commands.js';
import { markerCommands } from './marker-commands.js';
import { regionBoundaryCommands } from './region-boundary-commands.js';
import { regionCommands } from './region-commands.js';
import { regionPropertyCommands } from './region-property-commands.js';
import { splitCommands } from './split-commands.js';
import { timeEditCommands } from './time-edit-commands.js';
import { markerNudgeCommands } from './marker-nudge-commands.js';
import { pictureCommands } from './picture-commands.js';
import { playheadCommands } from './playhead-commands.js';
import { pressureCommands } from './pressure-commands.js';
import { selectionCommands } from './selection-commands.js';
import { selectionPlayheadCommands } from './selection-playhead-commands.js';
import { shellCommand } from './shell-command.js';
import { shortcutCommands } from './shortcut-commands.js';
import { sourceCommands } from './source-commands.js';
import { storageCommands } from './storage-commands.js';
import type { ShellContext } from './shell-context.js';
import { viewCommands } from './view-commands.js';
import { panelCommands } from './panel-commands.js';
import { unreadTextCommands } from './unread-text-commands.js';
import { workspaceCommands } from './workspace-commands.js';

/**
 * The surfaces a user opens rather than the things they change.
 *
 * Shutting one is a command as well as opening it. Were one opened by a command
 * and closed by a write to the store, the palette could be opened from a macro,
 * a menu, the palette itself and a shortcut, and closed from nowhere but the
 * dialogue's own dismissal. ADR-0013 makes a shell action a command or nothing,
 * and a rule holds the interface to it.
 */
function surfaceCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'view.command-palette',
      'Show the command palette',
      CommandCategory.View,
      (context) => {
        context.interaction.setPaletteOpen(true);
      },
      {
        keywords: ['command', 'palette', 'search', 'run', 'find'],
        availability: (context) =>
          context.interaction.get().paletteOpen
            ? unavailable('The command palette is already open.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'view.close-command-palette',
      'Close the command palette',
      CommandCategory.View,
      (context) => {
        context.interaction.setPaletteOpen(false);
      },
      {
        keywords: ['command', 'palette', 'close', 'dismiss', 'hide'],
        availability: (context) =>
          context.interaction.get().paletteOpen
            ? AVAILABLE
            : unavailable('The command palette is not open.'),
      },
    ),

    shellCommand(
      'settings.open',
      'Settings',
      CommandCategory.Settings,
      (context) => {
        context.interaction.setSettingsOpen(true);
      },
      {
        keywords: ['settings', 'preferences', 'options', 'configure'],
        availability: (context) =>
          context.interaction.get().settingsOpen
            ? unavailable('The settings are already open.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'settings.close',
      'Close settings',
      CommandCategory.Settings,
      (context) => {
        context.interaction.setSettingsOpen(false);
      },
      {
        keywords: ['settings', 'preferences', 'close', 'dismiss', 'hide'],
        availability: (context) =>
          context.interaction.get().settingsOpen
            ? AVAILABLE
            : unavailable('Settings are not open.'),
      },
    ),
  ];
}

/** Every command that changes the person's preferences: how the interface looks, and the pressure choice. */
function preferenceCommands(): readonly Command<ShellContext>[] {
  return [...viewCommands(), ...pressureCommands()];
}

/** Every command of the project system: its projects, their history and the storage. */
function projectSystemCommands(): readonly Command<ShellContext>[] {
  return [
    ...projectFileCommands(),
    ...deletionCommands(),
    ...projectTransferCommands(),
    ...audioImportCommands(),
    ...quickEditCommands(),
    ...backupCommands(),
    ...backupFolderCommands(),
    ...historyCommands(),
    ...comparisonCommands(),
    ...auditionCommands(),
    ...compactionCommands(),
    ...ownershipCommands(),
    ...storageCommands(),
    ...sourceCommands(),
  ];
}

/**
 * Builds every shell command.
 *
 * The panel descriptors are passed rather than imported, because they are the
 * composition root's decision about what this build contains. A command module
 * that reached for them directly would be deciding it for itself.
 */
export function shellCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  return [
    ...preferenceCommands(),
    ...workspaceCommands(),
    ...panelCommands(descriptors),
    ...surfaceCommands(),
    ...shortcutCommands(),
    ...unreadTextCommands(),
    ...diagnosticCommands(),
    ...projectSystemCommands(),
    ...audioCommands(),
    ...audioSettingsCommands(),
    ...qualityCommands(),
    ...recordingCommands(),
    ...recordingSettingsCommands(),
    ...takeRecordingCommands(),
    ...takeStackCommands(),
    ...takeAuditionCommands(),
    ...interruptedRecordingCommands(),
    ...editorAssetCommands(),
    ...editorNavigationCommands(),
    ...editorPresentationCommands(),
    ...editorOptionCommands(),
    ...selectionCommands(),
    ...selectionPlayheadCommands(),
    ...markerCommands(),
    ...markerNudgeCommands(),
    ...clipboardCommands(),
    ...editCommands(),
    ...timeEditCommands(),
    ...channelCommands(),
    ...regionCommands(),
    ...regionBoundaryCommands(),
    ...regionPropertyCommands(),
    ...splitCommands(),
    ...analysisCommands(),
    ...rackBuildingCommands(),
    ...rackSlotCommands(),
    ...rackParameterCommands(),
    ...rackClipboardCommands(),
    ...rackComparisonCommands(),
    ...rackHearingCommands(),
    ...libraryCommands(),
    ...libraryApplyCommands(),
    ...packCommands(),
    ...playheadCommands(),
    ...pictureCommands(),
  ];
}
