/**
 * Exporting audio from the Export dialog (ADR-0092, REQ-EDIT-008,
 * REQ-EDIT-014): opening it over the asset in the editor, one region, every
 * region or the selection, starting the export it sets, and keeping and
 * removing the person's own presets.
 *
 * Starting keeps the dialog's settings as the project's last, a change undo
 * reverses, and then hands the export to the page's export control, which
 * records the export itself apart in the project's history (REQ-STOR-198).
 * The destination is asked for inside the gesture that starts it, as a
 * browser requires; dismissing that dialog leaves the Export dialog open.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { isWellFormedId, unsafeBrandId, type AssetId } from '@audiogubbins/domain';
import type { ExportRange } from '@audiogubbins/import-export';
import { canonicalJson, writeExportSettings } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { chooseDestination } from '../export/destination-choice.js';
import { IMPORT_EXPORT_MENU } from '../import-export-words.js';
import { ownPresetId, settingsOver } from '../state/stored-export-presets.js';
import { ExportCommand } from './import-export-ids.js';
import { sayWhenSettled, sessionOf } from './project-access.js';
import { availableUnless, report, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

import {
  editorProjectAsset,
  editorSelection,
  exportParts,
  offeredSelection,
  openOver,
} from './export-dialog-opening.js';
import { openDialog, startable, started } from './export-starting.js';

/** Available where an export can be made now and the editor last in use shows audio of the project. */
function editorExportAvailability(context: ShellContext): CommandAvailability {
  const parts = exportParts(context);
  if (typeof parts === 'string') return unavailable(parts);
  const asset = editorProjectAsset(context);
  return typeof asset === 'string' ? unavailable(asset) : AVAILABLE;
}

/** A command opening the dialog over the editor's asset, the range `rangeOf` gives. */
function editorOpening(
  id: string,
  label: string,
  rangeOf: (context: ShellContext) => ExportRange | string,
  keywords: readonly string[],
  availability: (context: ShellContext) => CommandAvailability = editorExportAvailability,
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.File,
    (context) => {
      const shown = editorProjectAsset(context);
      if (typeof shown === 'string') return shown;
      const range = rangeOf(context);
      if (typeof range === 'string') return range;
      return openOver(context, {
        asset: shown.asset,
        range,
        selection: offeredSelection(context),
      });
    },
    { keywords: ['export', 'save', 'render', 'bounce', ...keywords], availability },
  );
}

/** The region an invocation names, with the asset it is of; or why there is none. */
function namedRegion(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly asset: AssetId; readonly range: ExportRange } | string {
  const text = textArgument(invocation, 'region');
  if (text === undefined) return 'Say which region to export.';
  if (!isWellFormedId(text)) return 'There is no such region.';
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const region = session.getSnapshot().model.state.project.regions.get(unsafeBrandId(text));
  if (region === undefined) return 'There is no such region.';
  return { asset: region.assetId, range: { kind: 'region', region: region.id } };
}

function exportRegionCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.Region,
    'Export a region…',
    CommandCategory.File,
    (context, invocation) => {
      const named = namedRegion(context, invocation);
      if (typeof named === 'string') return named;
      return openOver(context, { ...named, selection: undefined });
    },
    {
      keywords: ['export', 'region', 'save', 'render', 'bounce'],
      // Run from a region's row, which names it; the palette has no region to name.
      discoverable: false,
      availability: (context) => {
        const parts = exportParts(context);
        return typeof parts === 'string' ? unavailable(parts) : AVAILABLE;
      },
    },
  );
}

/** Available where the editor's asset can be exported and has regions to export one by one. */
function everyRegionAvailability(context: ShellContext): CommandAvailability {
  const ready = editorExportAvailability(context);
  if (!ready.available) return ready;
  const shown = editorProjectAsset(context);
  const session = context.projects?.project.session();
  const regions = session?.getSnapshot().model.state.project.regions.values() ?? [];
  return typeof shown !== 'string' && [...regions].some((region) => region.assetId === shown.asset)
    ? AVAILABLE
    : unavailable('The asset in the editor has no regions to export one by one.');
}

/** Available where the editor's asset can be exported and a range of it is selected. */
function selectionAvailability(context: ShellContext): CommandAvailability {
  const ready = editorExportAvailability(context);
  if (!ready.available) return ready;
  const selection = editorSelection(context);
  return availableUnless(typeof selection === 'string' ? selection : undefined);
}

function startCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.Start,
    'Start the export',
    CommandCategory.File,
    (context) => {
      const ready = startable(context);
      if (ready.kind === 'refused') return ready.reasons;
      const { dialog, parts } = ready;
      const [first] = dialog.planned.ok ? dialog.planned.value : [];
      if (first === undefined) return 'This export makes no file.';
      // Asked now, inside the person's gesture, which is when a browser opens its dialogs.
      const destination = chooseDestination(dialog.destination, first, parts.exports.destinations);
      sayWhenSettled(context, started(dialog, parts, destination), (said) => said);
      return undefined;
    },
    {
      keywords: ['export', 'start', 'save', 'render', 'bounce'],
      availability: (context) => {
        const ready = startable(context);
        if (ready.kind === 'ready') return AVAILABLE;
        return unavailable(typeof ready.reasons === 'string' ? ready.reasons : ready.reasons[0]);
      },
    },
  );
}

function closeCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.CloseDialog,
    'Close the Export dialog',
    CommandCategory.File,
    (context) =>
      context.projects?.exportDialog.close() === true
        ? undefined
        : 'The Export dialog is not open.',
    {
      keywords: ['close', 'export', 'dialog'],
      availability: (context) => {
        const dialog = openDialog(context);
        return availableUnless(typeof dialog === 'string' ? dialog : undefined);
      },
    },
  );
}

function savePresetCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.SavePreset,
    'Save the export settings as a preset',
    CommandCategory.File,
    (context, invocation) => {
      const dialog = openDialog(context);
      if (typeof dialog === 'string') return dialog;
      const name = textArgument(invocation, 'name') ?? '';
      const kept = context.preferences
        .get()
        .exportPresets.find((preset) => preset.id === ownPresetId(name));
      if (
        kept !== undefined &&
        canonicalJson(writeExportSettings(settingsOver(kept.settings, dialog.settings.range))) ===
          canonicalJson(writeExportSettings(dialog.settings))
      ) {
        return unchanged(
          'export.preset-kept-already',
          `The preset ${quoted(name)} keeps these settings already.`,
        );
      }
      return report(
        context,
        context.preferences.keepExportPreset(name, dialog.settings),
        `The preset ${quoted(name)} is kept.`,
      );
    },
    {
      keywords: ['preset', 'save', 'export', 'keep'],
      availability: (context) => {
        const dialog = openDialog(context);
        return availableUnless(typeof dialog === 'string' ? dialog : undefined);
      },
    },
  );
}

function removePresetCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.RemovePreset,
    'Remove an export preset',
    CommandCategory.File,
    (context, invocation) => {
      const id = textArgument(invocation, 'preset');
      if (id === undefined) return 'Say which preset to remove.';
      const preset = context.preferences.get().exportPresets.find((one) => one.id === id);
      return report(
        context,
        context.preferences.removeExportPreset(id),
        `The preset ${quoted(preset?.name ?? id)} is removed.`,
      );
    },
    {
      keywords: ['preset', 'remove', 'delete', 'export'],
      // Run from a preset's own row, which names it.
      discoverable: false,
      availability: (context) =>
        context.preferences.get().exportPresets.length === 0
          ? unavailable('You keep no export presets.')
          : AVAILABLE,
    },
  );
}

/** The Export dialog's commands. */
export function exportDialogCommands(): readonly Command<ShellContext>[] {
  return [
    editorOpening(
      ExportCommand.Audio,
      IMPORT_EXPORT_MENU.exportAudio,
      () => ({ kind: 'project' }),
      ['audio', 'file'],
    ),
    exportRegionCommand(),
    editorOpening(
      ExportCommand.EveryRegion,
      'Export every region…',
      () => ({ kind: 'every-region' }),
      ['regions', 'every', 'batch'],
      everyRegionAvailability,
    ),
    editorOpening(
      ExportCommand.Selection,
      'Export the selection…',
      editorSelection,
      ['selection', 'range'],
      selectionAvailability,
    ),
    startCommand(),
    closeCommand(),
    savePresetCommand(),
    removePresetCommand(),
  ];
}
