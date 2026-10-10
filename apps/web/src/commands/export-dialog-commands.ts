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
  type Command,
  type CommandAvailability,
  type CommandInvocation,
  unchanged,
} from '@audiogubbins/commands';
import {
  derivedSampleCount,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ExportClock, ExportRange } from '@audiogubbins/import-export';
import { setExportSettingsInvocation } from '@audiogubbins/project-commands';
import { canonicalJson, writeExportSettings } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { quoted } from '@audiogubbins/text';
import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import { assetEntryId } from '../assets/project-entry.js';
import { chooseDestination, destinationProblem } from '../export/destination-choice.js';
import type { ExportDestinationChoice, ExportServices } from '../export/export-types.js';
import { IMPORT_EXPORT_MENU } from '../import-export-words.js';
import type { OpenExportDialog } from '../state/export-dialog-store.js';
import type { ProjectStores } from '../state/project-stores.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import { ownPresetId, settingsOver } from '../state/stored-export-presets.js';
import { focusedEditor, selectedTarget } from './editor-target.js';
import { ExportCommand } from './import-export-ids.js';
import { readyProjects, sayWhenSettled, sessionOf } from './project-access.js';
import { onAsset } from './project-edits.js';
import {
  availableUnless,
  report,
  shellCommand,
  textArgument,
  type BodyAnswer,
} from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why nothing can be exported where the page offers no export. */
const NO_EXPORT = 'This browser offers no export here, since it cannot keep projects.';

/** A time range alone: an export of the selection needs one, and never falls back to the whole. */
const SELECTED_RANGE: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time]),
  whenNothing: 'refuse',
};

/** The moment `now`, with the offset from UTC this page's clock is set to then, for `{date}`. */
function exportClockAt(now: number): ExportClock {
  return {
    epochMilliseconds: now,
    utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
  };
}

/** What an export from the open project is made with: its stores, the page's export and its session. */
interface ExportParts {
  readonly stores: ProjectStores;
  readonly exports: ExportServices;
  readonly session: RemoteProjectSession;
}

/** What an export is made with, or why nothing can be exported now. */
function exportParts(context: ShellContext): ExportParts | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  if (context.exports === undefined) return NO_EXPORT;
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  return { stores, exports: context.exports, session };
}

/** The asset of the open project the editor last in use shows, a region's asset for a region. */
function editorProjectAsset(context: ShellContext): { readonly asset: AssetId } | string {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  const { owner } = target.asset;
  return owner.kind === 'project' ? { asset: owner.asset.id } : owner.reason;
}

/** What the dialog is opened over: the asset, the range, and the selection it may offer. */
interface DialogTarget {
  readonly asset: AssetId;
  readonly range: ExportRange;
  readonly selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined;
}

/**
 * The selection of the editor last in use as a range of its asset, or why
 * there is none: a view of a region shows the region's slice, so its range
 * is moved on by the region's start.
 */
function editorSelection(
  context: ShellContext,
): Extract<ExportRange, { readonly kind: 'selection' }> | string {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  const { owner } = target.asset;
  if (owner.kind === 'session') return owner.reason;
  const selected = selectedTarget(context, target.asset, SELECTED_RANGE);
  if (typeof selected === 'string') return selected;
  if (selected.kind !== 'time') return 'Select a range of time to export.';
  const { start, end } = selected.range;
  return {
    kind: 'selection',
    start: onAsset(owner, start),
    length: derivedSampleCount(end - start),
  };
}

/** The editor's selection, where it has one, as the dialog offers it beside the range it opens with. */
function offeredSelection(
  context: ShellContext,
): Extract<ExportRange, { readonly kind: 'selection' }> | undefined {
  const selection = editorSelection(context);
  return typeof selection === 'string' ? undefined : selection;
}

/** Whether the dialog shows `target` already, as `session`'s project holds it. */
function showing(
  shown: ReturnType<ProjectStores['exportDialog']['get']>,
  session: RemoteProjectSession,
  target: DialogTarget,
): boolean {
  return (
    shown.kind === 'open' &&
    shown.project === session.project &&
    shown.asset === target.asset &&
    canonicalJson(writeExportSettings({ ...shown.settings, range: target.range })) ===
      canonicalJson(writeExportSettings(shown.settings))
  );
}

/**
 * Opens the Export dialog over `target`, planned against the asset as the
 * project now holds it; or why it cannot open. A dialog showing the target
 * already is left as the person set it.
 */
function openOver(context: ShellContext, target: DialogTarget): BodyAnswer {
  const parts = exportParts(context);
  if (typeof parts === 'string') return parts;
  const { stores, exports, session } = parts;
  if (showing(stores.exportDialog.get(), session, target)) {
    return unchanged('export.dialog-open-already', 'The Export dialog shows this already.');
  }
  const editorAsset = context.assets.find(assetEntryId(target.asset));
  if (editorAsset === undefined) return 'The asset to export is not open in this session yet.';
  const { state } = session.getSnapshot().model;
  const planned = exports.contextOf(editorAsset, state);
  if (!planned.ok) return reasonsOf(planned.failures);
  stores.exportDialog.open({
    project: session.project,
    asset: target.asset,
    context: planned.value,
    clock: exportClockAt(context.clock.now()),
    range: target.range,
    selection: target.selection,
    kept: state.exportSettings,
    dialogs: exports.destinations.dialogs,
  });
  return undefined;
}

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

/** The open dialog, or why none is. */
function openDialog(context: ShellContext): OpenExportDialog | string {
  const shown = context.projects?.exportDialog.get();
  return shown?.kind === 'open' ? shown : 'The Export dialog is not open.';
}

/** An export ready to start from the open dialog, or every reason it is not. */
type Startable =
  | { readonly kind: 'ready'; readonly dialog: OpenExportDialog; readonly parts: ExportParts }
  | { readonly kind: 'refused'; readonly reasons: string | Reasons };

function refused(reasons: string | Reasons): Startable {
  return { kind: 'refused', reasons };
}

/**
 * The open dialog's export, ready to start, with the page's export and the
 * session; or every reason it cannot start: the settings' own, as the
 * package plans them, the destination's, or an export already under way.
 */
function startable(context: ShellContext): Startable {
  const dialog = openDialog(context);
  if (typeof dialog === 'string') return refused(dialog);
  const parts = exportParts(context);
  if (typeof parts === 'string') return refused(parts);
  if (parts.session.project !== dialog.project) {
    return refused('The Export dialog is of another project.');
  }
  const run = parts.exports.control.get();
  if (run.kind === 'running') return refused('An export is under way; wait for it, or cancel it.');
  if (run.kind === 'held') {
    return refused(
      'An export waits for a file to be delivered; retry it, deliver it elsewhere, or cancel it.',
    );
  }
  if (!dialog.planned.ok) return refused(reasonsOf(dialog.planned.failures));
  const problem = destinationProblem(
    dialog.destination,
    dialog.planned.value,
    parts.exports.destinations.trusted.get(),
  );
  return problem === undefined ? { kind: 'ready', dialog, parts } : refused(problem);
}

/**
 * Keeps the dialog's settings as the project's last, a change undo reverses,
 * then starts the export to the destination chosen: the sentence saying what
 * came of it, nothing where the person dismissed the destination's dialog, or
 * why it did not start. The Export dialog shuts once a destination is chosen,
 * and opens again with the settings kept.
 */
async function started(
  dialog: OpenExportDialog,
  parts: ExportParts,
  destination: Promise<DomainResult<ExportDestinationChoice | undefined>>,
): Promise<DomainResult<string | undefined>> {
  const chosen = await destination;
  if (!chosen.ok) return chosen;
  const where = chosen.value;
  if (where === undefined) return succeed(undefined);
  parts.stores.exportDialog.close();
  const kept = await parts.session.run(setExportSettingsInvocation(dialog.settings));
  if (!kept.ok) return kept;
  return await parts.exports.control.start(parts.session, {
    asset: dialog.asset,
    settings: dialog.settings,
    destination: where,
  });
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
