/**
 * Where the Export dialog's files go (ADR-0092, REQ-GODOT-046): a file or a
 * folder the person is asked for as the export starts, where the browser
 * gives dialogs, a folder they keep trusted, or a download, and what is done
 * with a name taken in a folder.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import type { CollisionPolicy } from '@audiogubbins/import-export';

import type { ExportServices } from '../../export/export-types.js';
import type {
  ExportDestinationDraft,
  ExportDialogStore,
  OpenExportDialog,
} from '../../state/export-dialog-store.js';
import { POLICY_WORDS } from './export-words.js';
import { ChoiceField, type Choice } from './setting-fields.js';

const POLICIES: readonly Choice<CollisionPolicy>[] = (
  ['prompt', 'rename', 'skip', 'overwrite'] as const
).map((value) => ({
  value,
  label: `${POLICY_WORDS[value].charAt(0).toUpperCase()}${POLICY_WORDS[value].slice(1)}`,
}));

/** A destination, as the dialog lists it. */
interface DestinationChoice {
  readonly key: string;
  readonly label: string;
  readonly draft: (policy: CollisionPolicy) => ExportDestinationDraft;
}

/** The destinations this browser offers: a file and a folder where it gives dialogs, each trusted folder, a download. */
function destinationChoices(
  dialogs: boolean,
  trusted: readonly { readonly key: string; readonly name: string }[],
): readonly DestinationChoice[] {
  return [
    ...(dialogs
      ? [
          { key: 'file', label: 'A file you name', draft: () => ({ kind: 'file' }) as const },
          {
            key: 'folder',
            label: 'A folder you choose',
            draft: (policy: CollisionPolicy) => ({ kind: 'folder', policy }) as const,
          },
        ]
      : []),
    ...trusted.map((folder) => ({
      key: `trusted:${folder.key}`,
      label: `“${folder.name}”, kept trusted`,
      draft: (policy: CollisionPolicy) =>
        ({ kind: 'trusted-folder', key: folder.key, policy }) as const,
    })),
    { key: 'download', label: 'A download', draft: () => ({ kind: 'download' }) as const },
  ];
}

/** The key a destination is listed by. */
function destinationKey(destination: ExportDestinationDraft): string {
  return destination.kind === 'trusted-folder' ? `trusted:${destination.key}` : destination.kind;
}

/** Where the files go, and what is done with a name taken there. */
export function DestinationControls({
  open,
  exports,
  dialog,
}: {
  readonly open: OpenExportDialog;
  readonly exports: ExportServices;
  readonly dialog: ExportDialogStore;
}): ReactNode {
  const trusted = useSyncExternalStore(
    exports.destinations.trusted.subscribe,
    exports.destinations.trusted.get,
  );
  const choices = destinationChoices(open.dialogs, trusted);
  const { destination } = open;
  const policy =
    destination.kind === 'folder' || destination.kind === 'trusted-folder'
      ? destination.policy
      : 'prompt';
  const key = destinationKey(destination);
  return (
    <fieldset className="ag-settings-group">
      <legend>Destination</legend>
      <ChoiceField
        label="Deliver to"
        value={choices.find((choice) => choice.key === key) ?? choices[0]}
        choices={choices.map((choice) => ({ value: choice, label: choice.label }))}
        onChoose={(choice) => {
          if (choice !== undefined) dialog.chooseDestination(choice.draft(policy));
        }}
      />
      {(destination.kind === 'folder' || destination.kind === 'trusted-folder') && (
        <ChoiceField
          label="Where a name is taken"
          value={policy}
          choices={POLICIES}
          onChoose={(chosen) => {
            dialog.chooseDestination({ ...destination, policy: chosen });
          }}
        />
      )}
    </fieldset>
  );
}
