/**
 * The workspaces the user has, and what they can do to them.
 *
 * REQ-UX-058 states with `shall` that users can create, save, duplicate,
 * rename, reset, delete and switch rapidly between layouts. The Workspace menu
 * switches between them; this is where the three that need a name are done,
 * because a command cannot open a dialogue and wait for one: it runs from a
 * macro and from a shortcut as well as from a menu.
 *
 * Every control runs a command with the workspace named as an argument, which
 * is the target resolution REQ-EDIT-073 requires rather than a second route
 * into the store.
 */

import { useState, type ReactNode } from 'react';

import { ButtonTone, OptionSelect, TextField } from '@audiogubbins/design-system';
import { LONGEST_WORKSPACE_NAME, listedName, type WorkspaceLayout } from '@audiogubbins/workspace';

import { ReasonedButton } from './reasoned-button.js';
import type { RunCommand } from './section.js';

/** What the workspace controls need. */
export interface WorkspacesProps {
  /** The layout the user is looking at. */
  readonly layout: WorkspaceLayout;

  /** Every layout they can switch to. */
  readonly available: readonly WorkspaceLayout[];

  readonly run: RunCommand;

  /**
   * Why a command cannot run now, or `undefined` when it can: the answer the
   * menus give, so the dialogue and the menu say the same about one workspace.
   */
  readonly unavailableReason: (id: string) => string | undefined;
}

/** The workspaces the user has. */
export function Workspaces({
  layout,
  available,
  run,
  unavailableReason,
}: WorkspacesProps): ReactNode {
  // The typed name is this section's own state, not the workspace's. A field
  // bound straight to the layout would rename it on every keystroke, so a user
  // halfway through typing would have a workspace called "My w".
  const [name, setName] = useState('');

  /**
   * Empties the field once the command it named ran. A name the command
   * refuses stays in the field, so the reader can correct it rather than
   * type it again.
   */
  const emptyWhenRan = (ran: boolean): void => {
    if (ran) setName('');
  };

  /**
   * The new name, or nothing while none has been typed.
   *
   * Spaces alone are no name: read untrimmed, typing them would ask the store
   * for a name it refuses.
   */
  const chosen = name.trim();

  /** Why Duplicate cannot run now, or `undefined` when it can. */
  const duplicateProblem = unavailableReason('workspace.duplicate');

  /** Why Rename cannot run now, or `undefined` when it can. */
  const renameProblem =
    unavailableReason('workspace.rename') ??
    (chosen === '' ? 'Type a new name to rename it.' : undefined);

  // One command for a rename, from the field and from the button, so Enter on
  // a built-in workspace gives the reason the button beside it gives, which
  // the command gives when it runs. A command that finds the name unchanged
  // says so, as a control the user commits with.
  const renameTo = (displayName: string): void => {
    emptyWhenRan(
      run('workspace.rename', { layoutId: layout.id, displayName }, { sayWhenUnchanged: true }),
    );
  };

  /*
   * What an empty field means is the whole difference between the two routes,
   * so it is written once, here.
   *
   * The button waits for a new name and says so beside it, through
   * `renameProblem`, so it never runs with nothing typed. Enter in a field with
   * nothing typed asks for the name the field shows, the workspace's own, so
   * the command says why nothing changes: its refusal on a built-in workspace,
   * and otherwise that the workspace is already called that, where returning in
   * silence would tell a keyboard user nothing and sending the empty field
   * would ask for no name, which is refused assertively.
   */
  const renameFrom = (source: 'the button' | 'the field'): void => {
    renameTo(chosen === '' && source === 'the field' ? layout.displayName : chosen);
  };

  return (
    <div className="ag-settings-section">
      <p className="ag-settings-note">
        A workspace remembers where the panels are and nothing else. Switching between them never
        changes anything in your project.
      </p>

      <OptionSelect
        label="Current workspace"
        value={layout.id}
        options={available.map((one) => ({ value: one.id, label: listedName(one) }))}
        onValueChange={(layoutId) => {
          run('workspace.switch-to', { layoutId });
          setName('');
        }}
      />

      <div className="ag-settings-row">
        <TextField
          label="New name"
          // The name typed, so the field can be emptied: showing the
          // workspace's own name whenever nothing is typed would draw the old
          // name back the moment the last character goes, and the next key
          // would be appended to it. The placeholder shows what it is called
          // now.
          value={name}
          placeholder={layout.displayName}
          description={nameFieldDescription(layout, duplicateProblem === undefined)}
          onValueChange={setName}
          onSubmit={() => {
            renameFrom('the field');
          }}
        />

        <ReasonedButton
          reason={renameProblem}
          onPress={() => {
            renameFrom('the button');
          }}
        >
          Rename
        </ReasonedButton>

        <ReasonedButton
          reason={duplicateProblem}
          onPress={() => {
            emptyWhenRan(run('workspace.duplicate', duplicateArguments(layout.id, chosen)));
          }}
        >
          Duplicate
        </ReasonedButton>
      </div>

      <div className="ag-settings-row">
        <ReasonedButton
          reason={unavailableReason('workspace.reset')}
          onPress={() => {
            run('workspace.reset', { layoutId: layout.id });
          }}
        >
          Reset to how it ships
        </ReasonedButton>

        <ReasonedButton
          tone={ButtonTone.Destructive}
          reason={unavailableReason('workspace.delete')}
          onPress={() => {
            run('workspace.delete', { layoutId: layout.id });
            setName('');
          }}
        >
          Delete
        </ReasonedButton>
      </div>
    </div>
  );
}

/**
 * What Duplicate asks the command for: a copy under the name typed, which the
 * store refuses as it refuses a rename, or with none typed a copy the store
 * names as it names one from the menu.
 */
function duplicateArguments(layoutId: string, chosen: string): Readonly<Record<string, string>> {
  return chosen === '' ? { layoutId } : { layoutId, displayName: chosen };
}

/**
 * What the name field is for, which on a built-in workspace is not a rename:
 * the reason is said beside the Rename button, and when Enter is pressed. It
 * says that Duplicate names the copy from it, where a copy can be made, and
 * what a name has to be, before one is typed rather than only when one is
 * refused. A screen reader says this on every visit to the field, so it stays
 * short: the name a copy is given is said when the copy is made, and why no
 * copy can be made is said beside Duplicate.
 *
 * Where no copy can be made, a built-in workspace takes no name from the
 * field, and it says only that.
 */
function nameFieldDescription(layout: WorkspaceLayout, copies: boolean): string {
  if (layout.builtIn && !copies) return 'A built-in workspace keeps its name.';
  const purpose = layout.builtIn
    ? 'Duplicate a built-in workspace to make one you can rename.'
    : 'Renaming changes what the Workspace menu calls it.';
  const copy = copies
    ? ' Duplicate uses the name typed here, or names the copy after this workspace.'
    : '';
  return `${purpose}${copy} Each workspace needs its own name, of up to ${String(LONGEST_WORKSPACE_NAME)} characters.`;
}
