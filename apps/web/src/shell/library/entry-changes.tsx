/**
 * Renaming and removing a Library entry, each opened in its row: the name
 * typed and the command that gives it, and the removal, asked a second time
 * beside the sentence saying it is for good, as purging a project is.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, ButtonTone, TextField } from '@audiogubbins/design-system';
import type { LibraryEntry } from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import { CommandAction } from '../command-action.js';
import type { PanelCommands } from '../command-button.js';
import { useFocusOnShow } from './row-opening.js';

/** A new name typed for an entry, and the command that gives it. */
export function RenameField({
  entry,
  commands,
  onClose,
}: {
  readonly entry: LibraryEntry;
  readonly commands: PanelCommands;
  readonly onClose: () => void;
}): ReactNode {
  const [name, setName] = useState(entry.name);
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    field.current?.querySelector('input')?.focus();
  }, []);
  const rename = (): void => {
    commands.run('library.rename', { entry: entry.id, name });
    onClose();
  };
  return (
    <div className="ag-library-rename" ref={field}>
      <TextField
        label={`New name for ${quoted(entry.name)}`}
        value={name}
        onValueChange={setName}
        onSubmit={rename}
      />
      <Button compact onClick={onClose}>
        Cancel
      </Button>
      <CommandAction
        id="library.rename"
        label="Rename"
        commands={commands}
        args={{ entry: entry.id, name }}
        refusal={name.trim() === '' ? 'Type the new name.' : undefined}
        tone={ButtonTone.Primary}
      />
    </div>
  );
}

/** Removing an entry, once the person has read that it is for good. */
export function RemoveConfirmation({
  id,
  name,
  commands,
  onKeep,
  onRemoving,
}: {
  readonly id: string;
  readonly name: string;
  readonly commands: PanelCommands;
  readonly onKeep: () => void;
  /** Takes the focus somewhere that stays, since the entry goes once it is removed. */
  readonly onRemoving: () => void;
}): ReactNode {
  const remove = useRef<HTMLButtonElement>(null);
  useFocusOnShow(remove);
  return (
    <div className="ag-library-confirm" role="group" aria-label={`Remove ${name}`}>
      <p className="ag-library-confirm-text">
        {`Removing ${name} from your library is for good. What it was applied to keeps its copy.`}
      </p>
      <div className="ag-library-confirm-actions">
        <Button compact onClick={onKeep}>
          Keep it
        </Button>
        <Button
          ref={remove}
          compact
          tone={ButtonTone.Destructive}
          onClick={() => {
            onRemoving();
            commands.run('library.remove', { entry: id });
          }}
        >
          Remove for good
        </Button>
      </div>
    </div>
  );
}
