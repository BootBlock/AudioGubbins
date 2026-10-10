/**
 * Starting the export the Export dialog sets (ADR-0092): what stops it, an
 * export already under way or what `exportBlockers` finds, and once it may,
 * the settings kept as the project's last, a change undo reverses, before
 * the page's export control is handed the export, which records the export
 * itself apart (REQ-STOR-198).
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { setExportSettingsInvocation } from '@audiogubbins/project-commands';

import { exportBlockers } from '../export/export-blockers.js';
import type { ExportDestinationChoice } from '../export/export-types.js';
import type { OpenExportDialog } from '../state/export-dialog-store.js';
import type { Reasons } from '../state/reasons.js';
import { exportParts, type ExportParts } from './export-dialog-opening.js';
import type { ShellContext } from './shell-context.js';

/** The open dialog, or why none is. */
export function openDialog(context: ShellContext): OpenExportDialog | string {
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
 * session; or every reason it cannot start: an export already under way, or
 * what `exportBlockers` finds.
 */
export function startable(context: ShellContext): Startable {
  const dialog = openDialog(context);
  if (typeof dialog === 'string') return refused(dialog);
  const parts = exportParts(context);
  if (typeof parts === 'string') return refused(parts);
  if (parts.session.project !== dialog.project) {
    return refused('The Export dialog is of another project.');
  }
  const run = parts.control.get();
  if (run.kind === 'running') return refused('An export is under way; wait for it, or cancel it.');
  if (run.kind === 'held') {
    return refused(
      'An export waits for a file to be delivered; retry it, deliver it elsewhere, or cancel it.',
    );
  }
  const [first, ...rest] = exportBlockers(
    dialog,
    context.codecs,
    parts.stores.trustedFolders.get(),
  );
  return first === undefined ? { kind: 'ready', dialog, parts } : refused([first, ...rest]);
}

/**
 * Keeps the dialog's settings as the project's last, a change undo reverses,
 * then starts the export to the destination chosen: the sentence saying what
 * came of it, nothing where the person dismissed the destination's dialog, or
 * why it did not start. The Export dialog shuts once a destination is chosen,
 * and opens again with the settings kept.
 */
export async function started(
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
  return await parts.control.start(parts.session, {
    asset: dialog.asset,
    settings: dialog.settings,
    destination: where,
  });
}
