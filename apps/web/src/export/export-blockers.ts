/**
 * What stops the Export dialog's export from starting, as the person is told
 * it while they set it up and as its start command refuses it: the reasons
 * the import-export package's planning gives, the codec this browser cannot
 * write (naming those it can instead), and a destination that cannot take
 * the files. One list, so the dialog and the command never disagree.
 */

import type { CodecCapability } from '@audiogubbins/codecs';
import type { CodecLookup } from '@audiogubbins/import-export';

import type { CodecServices } from '../codecs/codec-services.js';
import type { OpenExportDialog } from '../state/export-dialog-store.js';
import type { KeptTrustedFolder, TrustedFoldersState } from '../state/trusted-folders-store.js';
import { destinationProblem } from './destination-choice.js';

/** Why a codec cannot write here, with the codecs that can instead, by their names. */
export function unavailableSentence(
  capability: Extract<CodecCapability, { readonly kind: 'unavailable' }>,
  codecs: CodecLookup,
): string {
  const names = capability.alternatives.map((codec) => codecs(codec)?.name ?? codec);
  if (names.length === 0) return capability.reason;
  const last = names.at(-1) ?? '';
  const listed = names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
  return `${capability.reason} ${listed} can be written here instead.`;
}

/** The folders kept trusted, as far as they have been read. */
export function keptFolders(state: TrustedFoldersState): readonly KeptTrustedFolder[] {
  return state.kind === 'read' ? state.folders : [];
}

/** Every reason the dialog's export cannot start, in the order to read them; none where it can. */
export function exportBlockers(
  dialog: OpenExportDialog,
  codecs: Pick<CodecServices, 'capability'>,
  trusted: TrustedFoldersState,
): readonly string[] {
  if (!dialog.planned.ok) return dialog.planned.failures.map((failure) => failure.summary);
  const files = dialog.planned.value;
  const [first] = files;
  const capability =
    first === undefined ? undefined : codecs.capability(first.target.codec, 'write');
  const destination = destinationProblem(dialog.destination, files, keptFolders(trusted));
  return [
    ...(capability?.kind === 'unavailable'
      ? [unavailableSentence(capability, dialog.context.codecs)]
      : []),
    ...(destination === undefined ? [] : [destination]),
  ];
}
