/**
 * The shortcut editor.
 *
 * REQ-UX-066 states that users must be able to fully remap shortcuts, and names
 * named profiles, import and export, conflict detection, reset to defaults and
 * platform-specific representation. Each is done here: a table beside a
 * sentence telling the user remapping "arrives with the phase that adds a
 * shortcut editor", which no phase packet schedules, would be silent scope
 * deferral written into the product's own interface.
 *
 * Every change runs a command (REQ-EDIT-073). The section decides nothing about
 * what is allowed: a reserved combination is refused by the rebinding rule, and
 * the recorder only says so early.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  describeShortcut,
  type CommandId,
  type KeyboardConvention,
  type ShortcutConflict,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { Button, ButtonTone, OptionSelect } from '@audiogubbins/design-system';
import type { KeyEventReading, KeyboardLayout } from '@audiogubbins/input';

import type { Announce } from '../../commands/voiced-execution.js';
import type { ReservedBinding, WaitingDefault } from '../../state/shortcut-layout.js';
import type { RunCommand } from './section.js';
import { ImportProfile } from './import-profile.js';
import { ConflictList, ReservedList, WaitingList } from './shortcut-notes.js';
import {
  NotedButton,
  ReasonedButton,
  SharedReasonNotes,
  useSharedReasons,
  type SharedReasons,
} from './reasoned-button.js';
import { ShortcutRecorder } from './shortcut-recorder.js';
import { UnreadTexts } from './unread-text.js';
import type { UnreadText } from '../../state/text-custody.js';
import { quoted } from '@audiogubbins/text';

/** One command the editor offers. */
export interface EditableCommand {
  readonly id: CommandId;
  readonly label: string;
}

/** What the editor needs. */
export interface ShortcutsProps {
  readonly profile: ShortcutProfile;
  readonly available: readonly ShortcutProfile[];
  readonly conflicts: readonly ShortcutConflict[];

  /** Each binding the platform takes on the keyboard layout as it is known. */
  readonly reserved: readonly ReservedBinding[];

  /** Each default of the profile that waits for the layout to show its keys. */
  readonly waiting: readonly WaitingDefault[];

  /**
   * Why this browser does not say what the keyboard types, when it does not.
   *
   * Said beside the defaults that wait for a key, so the degradation is
   * explained by its cause rather than only described (REQ-EXEC-216).
   */
  readonly layoutMapReason?: string;

  readonly convention: KeyboardConvention;

  /** What the user's keyboard layout types, as far as it is known. */
  readonly layout: KeyboardLayout;

  /** Teaches the layout the character a press made, as the recorder reads each one. */
  readonly learnKey: (reading: KeyEventReading) => void;

  /** Names the key a Command press is asked on now, or none, as the keyboard needs to know. */
  readonly askFor: (code: string | undefined) => void;

  /** Every command a user could bind, in the order they are listed. */
  readonly commands: readonly EditableCommand[];

  /**
   * What each command is called, so every list beside the table names commands
   * rather than identifiers: the conflicts, what the browser takes, and the
   * defaults waiting for a key.
   */
  readonly labelFor: (id: CommandId) => string;

  readonly run: RunCommand;

  /**
   * Says something to the user, in the same words spoken and shown.
   *
   * Everything else here is said by the command that was run. A file the
   * section refuses before reading it never reaches a command, so it has to
   * be said from here or not at all.
   */
  readonly announce: Announce;

  /** Why a command cannot run now, or `undefined` when it can. */
  readonly unavailableReason: (id: string) => string | undefined;

  /** What there is of the profiles' text that could not be read. */
  readonly unread: readonly UnreadText[];
}

/** The shortcut editor. */
export function Shortcuts(props: ShortcutsProps): ReactNode {
  const {
    profile,
    available,
    conflicts,
    reserved,
    waiting,
    layoutMapReason,
    convention,
    layout,
    learnKey,
    askFor,
    commands,
    labelFor,
    run,
    announce,
    unavailableReason,
    unread,
  } = props;
  const [editing, setEditing] = useState<CommandId | undefined>(undefined);

  const naming = useNamingReasons(unavailableReason);

  /** Every binding a command has, written for this platform. */
  const bindingsOf = (id: CommandId): readonly string[] =>
    profile.bindings
      .filter((binding) => binding.commandId === id)
      .map((binding) => describeShortcut(binding.shortcut, convention, layout));

  return (
    <div className="ag-settings-section">
      <ProfileHeader
        profile={profile}
        available={available}
        run={run}
        announce={announce}
        unavailableReason={unavailableReason}
        naming={naming}
      />
      <UnreadTexts unread={unread} run={run} />
      <ConflictList
        conflicts={conflicts}
        convention={convention}
        layout={layout}
        labelFor={labelFor}
      />
      <ReservedList reserved={reserved} labelFor={labelFor} />
      <WaitingList
        waiting={waiting}
        labelFor={labelFor}
        layout={layout}
        convention={convention}
        {...(layoutMapReason === undefined ? {} : { layoutMapReason })}
        askFor={askFor}
      />

      <table className="ag-shortcut-table">
        <caption className="ag-visually-hidden">Keyboard shortcuts</caption>
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Shortcut</th>
            <th scope="col">
              <span className="ag-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {commands.map((command) => (
            <ShortcutRow
              key={command.id}
              command={command}
              bound={bindingsOf(command.id)}
              editing={editing === command.id}
              convention={convention}
              layout={layout}
              learnKey={learnKey}
              onEdit={(next) => {
                setEditing(next ? command.id : undefined);
              }}
              run={run}
              naming={naming}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The controls of the section that name something. */
type NamingControl = 'import' | 'change' | 'remove';

/**
 * Why each control that names something cannot be used now, said once above
 * the table: the built-in shortcuts are changed in a copy, which is named, and
 * a profile imported is named too. Where names cannot be compared while the
 * built-in shortcuts are in force, every row's Change and Remove is
 * unavailable for the one reason.
 */
function useNamingReasons(
  unavailableReason: (id: string) => string | undefined,
): SharedReasons<NamingControl> {
  return useSharedReasons({
    import: unavailableReason('shortcuts.import'),
    change: unavailableReason('shortcuts.rebind'),
    remove: unavailableReason('shortcuts.unbind'),
  });
}

/**
 * Which profile is in force, the others the user can switch to, what is done
 * to it, and why a control that names something cannot be used now.
 */
function ProfileHeader(props: {
  readonly profile: ShortcutProfile;
  readonly available: readonly ShortcutProfile[];
  readonly run: RunCommand;
  readonly announce: Announce;
  readonly unavailableReason: (id: string) => string | undefined;
  readonly naming: SharedReasons<NamingControl>;
}): ReactNode {
  const { profile, available, run, announce, unavailableReason, naming } = props;

  return (
    <>
      <p className="ag-settings-note">
        {profileNote(profile, naming.idOf('change') === undefined)}
      </p>
      <SharedReasonNotes reasons={naming} />

      <OptionSelect
        label="Shortcut profile"
        value={profile.id}
        options={available.map((one) => ({ value: one.id, label: one.displayName }))}
        onValueChange={(profileId) => {
          run('shortcuts.switch-to', { profileId });
        }}
      />

      <ProfileActions
        run={run}
        announce={announce}
        unavailableReason={unavailableReason}
        importReasonId={naming.idOf('import')}
      />
    </>
  );
}

/**
 * What the profile in force is. The built-in one is changed in a copy, and
 * where no copy can be made, it promises none: why is said beneath it.
 */
function profileNote(profile: ShortcutProfile, changeable: boolean): string {
  if (!profile.builtIn) return `These are your ${quoted(profile.displayName)} shortcuts.`;
  return changeable
    ? 'These are the shortcuts AudioGubbins ships with. Changing one keeps these as they are and makes a copy for your changes.'
    : 'These are the shortcuts AudioGubbins ships with. A copy is needed to change them, and none can be made.';
}

/**
 * What is done to the profile as a whole: reset, export, import and delete.
 * Reset and Delete read their commands' availability, with the reason beside
 * each: disabled by whether the profile was built in, each would decide for
 * itself what the commands decide, and say nothing. Import's reason is said
 * above, once for it and for every row that shares it.
 */
function ProfileActions(props: {
  readonly run: RunCommand;
  readonly announce: Announce;
  readonly unavailableReason: (id: string) => string | undefined;
  readonly importReasonId: string | undefined;
}): ReactNode {
  const { run, announce, unavailableReason, importReasonId } = props;

  return (
    <div className="ag-settings-row">
      <ReasonedButton
        reason={unavailableReason('shortcuts.reset')}
        onPress={() => {
          run('shortcuts.reset');
        }}
      >
        Reset to the defaults
      </ReasonedButton>
      <Button
        onClick={() => {
          run('shortcuts.export');
        }}
      >
        Export
      </Button>
      <ImportProfile run={run} announce={announce} reasonId={importReasonId} />
      <ReasonedButton
        tone={ButtonTone.Destructive}
        reason={unavailableReason('shortcuts.delete')}
        onPress={() => {
          run('shortcuts.delete');
        }}
      >
        Delete profile
      </ReasonedButton>
    </div>
  );
}

/** What one row of the table needs. */
interface ShortcutRowProps {
  readonly command: EditableCommand;

  /** The command's bindings, written for this platform. */
  readonly bound: readonly string[];

  /** Whether this row is recording a new combination. */
  readonly editing: boolean;

  readonly convention: KeyboardConvention;
  readonly layout: KeyboardLayout;
  readonly learnKey: (reading: KeyEventReading) => void;

  /** Starts recording for this row, or stops. */
  readonly onEdit: (editing: boolean) => void;

  readonly run: RunCommand;

  /** Why its Change and its Remove cannot be used now, said above the table. */
  readonly naming: SharedReasons<NamingControl>;
}

/**
 * Where focus goes when a control a row drew is taken away: back to the row's
 * Change button.
 *
 * Save, Cancel and Remove each unmount while they hold focus, and left there,
 * the dialogue's focus scope would put focus on the dialogue itself: a keyboard
 * or screen-reader user would start again at the top of the settings rather
 * than at the row they were working in. `editing` and `bindings` are what
 * change when one of those controls goes.
 */
function useFocusBackToChange(
  editing: boolean,
  bindings: number,
): {
  readonly changeButton: RefObject<HTMLButtonElement | null>;
  readonly closing: (act: () => void) => void;
} {
  const changeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!returnFocus.current || editing) return;
    returnFocus.current = false;
    changeButton.current?.focus();
  }, [editing, bindings]);

  return {
    changeButton,
    // Runs a control that unmounts itself, and takes focus back to Change.
    closing: (act) => {
      returnFocus.current = true;
      act();
    },
  };
}

/** One command, its bindings, and the controls that change them. */
function ShortcutRow(props: ShortcutRowProps): ReactNode {
  const { command, bound, editing, convention, layout, learnKey, onEdit, run, naming } = props;

  const { changeButton, closing } = useFocusBackToChange(editing, bound.length);

  return (
    <tr>
      <th scope="row">{command.label}</th>
      <td className="ag-shortcut-keys">
        {editing ? (
          <ShortcutRecorder
            commandLabel={command.label}
            convention={convention}
            layout={layout}
            learnKey={learnKey}
            onSave={(shortcut) => {
              closing(() => {
                // Said when the shortcut recorded is already the command's: the
                // recorder closes on Save, and would otherwise close in
                // silence.
                run(
                  'shortcuts.rebind',
                  { commandId: command.id, shortcut },
                  { sayWhenUnchanged: true },
                );
                onEdit(false);
              });
            }}
            onCancel={() => {
              closing(() => {
                onEdit(false);
              });
            }}
          />
        ) : bound.length === 0 ? (
          <span className="ag-shortcut-none">None</span>
        ) : (
          bound.join(' or ')
        )}
      </td>
      <td>
        {!editing && (
          <div className="ag-settings-row">
            <NotedButton
              ref={changeButton}
              compact
              label={`Change the shortcut for ${command.label}`}
              reasonId={naming.idOf('change')}
              onPress={() => {
                onEdit(true);
              }}
            >
              Change
            </NotedButton>
            {bound.length > 0 && (
              <NotedButton
                compact
                label={`Remove the shortcut for ${command.label}`}
                reasonId={naming.idOf('remove')}
                onPress={() => {
                  closing(() => {
                    run('shortcuts.unbind', { commandId: command.id });
                  });
                }}
              >
                Remove
              </NotedButton>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
