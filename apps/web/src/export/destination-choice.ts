/**
 * Where an export the Export dialog starts is delivered: the destination the
 * dialog holds, made into one the export can deliver to. A file or a folder
 * is asked for now, inside the gesture that starts the export, since a
 * browser lets a page open its dialogs and grant writing only then
 * (REQ-EXEC-216); a trusted folder and a download need no asking.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { PlannedFile } from '@audiogubbins/import-export';

import type { ExportDestinationDraft } from '../state/export-dialog-store.js';
import type { ExportDestinations } from '../io/export-destinations.js';
import type { ExportDestinationChoice } from './export-types.js';

/** Why a save dialog's one file cannot take an export of several. */
function oneFileProblem(files: number): string {
  return `This export makes ${String(files)} files, and a save dialog names one; choose a folder.`;
}

/**
 * Why the dialog's destination cannot take the planned files, or `undefined`
 * where it can: a save dialog names one file, and a trusted folder must still
 * be kept.
 */
export function destinationProblem(
  destination: ExportDestinationDraft,
  files: readonly PlannedFile[],
  trusted: readonly { readonly key: string }[],
): string | undefined {
  if (destination.kind === 'file' && files.length > 1) return oneFileProblem(files.length);
  if (
    destination.kind === 'trusted-folder' &&
    !trusted.some((one) => one.key === destination.key)
  ) {
    return 'The folder chosen is no longer kept trusted; choose another.';
  }
  return undefined;
}

/** The name a save dialog suggests for a planned file. */
export function suggestedName(file: PlannedFile): string {
  return `${file.name.stem}.${file.name.extension}`;
}

/**
 * The destination `draft` is delivered to, asking the person for a file or a
 * folder where it says to: `undefined` where they dismissed the dialog.
 * Called inside the gesture that starts the export.
 */
export async function chooseDestination(
  draft: ExportDestinationDraft,
  first: PlannedFile,
  destinations: ExportDestinations,
): Promise<DomainResult<ExportDestinationChoice | undefined>> {
  switch (draft.kind) {
    case 'download':
      return succeed({ kind: 'download' });
    case 'trusted-folder':
      return succeed(draft);
    case 'file':
      // A download, where the browser gives no save dialog.
      return succeed(await destinations.chooseFile(suggestedName(first)));
    case 'folder': {
      const chosen = await destinations.chooseFolder();
      if (!chosen.ok || chosen.value === undefined) return chosen.ok ? succeed(undefined) : chosen;
      return succeed({ kind: 'folder', handle: chosen.value, policy: draft.policy });
    }
  }
}
