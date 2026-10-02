import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { commandId } from '@audiogubbins/commands';

import type { ShellContext } from '../../commands/shell-context.js';
import { busOfShellCommands, reasonsIn } from '../../testing/command-availability.js';
import { buildShellContext, withoutNaming } from '../../testing/shell-context.js';
import type { RunCommand } from './section.js';
import { Workspaces } from './workspaces.js';

/** Runs the shell's own commands against a context, answering whether one ran. */
function runnerFor(context: ShellContext): RunCommand {
  const bus = busOfShellCommands();
  return (id, args) =>
    bus.execute(context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    }).kind !== 'refused';
}

/** Why nothing can be named, as the commands that name say it. */
const NAMING_UNAVAILABLE =
  'Naming workspaces and shortcut profiles is unavailable in this browser; the Capabilities panel says why.';

/**
 * The workspace controls in the settings. Their buttons stay in the tab order
 * with their reasons beside them: disabled, they would leave it and say
 * nothing. Reset is unavailable with its reason on a workspace with nothing to
 * reset, as the menu shows it.
 */
describe('the workspace settings', () => {
  it('sends the typed name from the button, and the field only sends its own', () => {
    // What an empty field means is the whole difference between the two routes,
    // so each is held to it here. The button never runs with nothing typed,
    // because its reason stops it.
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn();
    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );

    const field = screen.getByRole('textbox', { name: 'New name' });
    const rename = screen.getByRole('button', { name: 'Rename' });
    fireEvent.change(field, { target: { value: 'Mine' } });
    fireEvent.click(rename);

    // With nothing typed, the button sends nothing, and Enter in the field
    // sends the name the field shows, the workspace's own.
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(rename);
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(run.mock.calls).toEqual([
      [
        'workspace.rename',
        { layoutId: layout.id, displayName: 'Mine' },
        { sayWhenUnchanged: true },
      ],
      [
        'workspace.rename',
        { layoutId: layout.id, displayName: layout.displayName },
        { sayWhenUnchanged: true },
      ],
    ]);
  });

  it('keeps an unavailable button reachable, with the reason beside it, and runs nothing', async () => {
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn();
    const reasons: Readonly<Record<string, string>> = {
      'workspace.reset': '"Editing" is already as it ships.',
      'workspace.delete': 'A built-in workspace cannot be deleted. Reset it instead.',
    };

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={(id) => reasons[id]}
      />,
    );

    const reset = screen.getByRole('button', { name: 'Reset to how it ships' });
    expect(reset).toHaveAttribute('aria-disabled', 'true');
    expect(reset).not.toBeDisabled();
    expect(reset).toHaveAccessibleDescription('"Editing" is already as it ships.');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAccessibleDescription(
      'A built-in workspace cannot be deleted. Reset it instead.',
    );

    reset.focus();
    expect(reset).toHaveFocus();
    await userEvent.click(reset);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing typed', ''],
    ['spaces alone', '   '],
  ])(
    'asks for a new name before Rename, with %s, and never sends an empty one',
    async (_what, typed) => {
      // A rename to an empty name is refused outright, and the field must still
      // be emptiable: bound to the workspace's own name whenever nothing was
      // typed, the old name came back the moment the last character went, and
      // the next key was appended to it. Spaces alone are no name either, and
      // read untrimmed they were sent as one.
      const { context } = buildShellContext();
      context.workspace.saveAs('Mine');
      const { layout, available } = context.workspace.get();
      const run = vi.fn();

      render(
        <Workspaces
          layout={layout}
          available={available}
          deleted={[]}
          unread={[]}
          run={run}
          unavailableReason={() => undefined}
        />,
      );
      const rename = screen.getByRole('button', { name: 'Rename' });
      const field = screen.getByLabelText('New name');
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('placeholder', 'Mine');

      await userEvent.clear(field);
      if (typed !== '') await userEvent.type(field, typed);

      expect(field).toHaveValue(typed);
      expect(rename).toHaveAccessibleDescription('Type a new name to rename it.');
      await userEvent.click(rename);
      expect(run).not.toHaveBeenCalled();

      // Enter asks for the name the field shows, the workspace's own, so the
      // command says why nothing changes. It returned in silence.
      await userEvent.type(field, '{Enter}');
      expect(run.mock.calls).toEqual([
        [
          'workspace.rename',
          { layoutId: layout.id, displayName: 'Mine' },
          { sayWhenUnchanged: true },
        ],
      ]);
    },
  );

  it('renames to a name the workspace has already, and lets the command say so', async () => {
    // The settings declined a name the workspace has already, with a sentence
    // of their own; the command answers it, politely, as it answers every
    // other caller.
    const { context } = buildShellContext();
    context.workspace.saveAs('Mine');
    const { layout, available } = context.workspace.get();
    const run = vi.fn();

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Mine' } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(run).toHaveBeenCalledWith(
      'workspace.rename',
      { layoutId: layout.id, displayName: 'Mine' },
      { sayWhenUnchanged: true },
    );
  });

  it('renames from the field as from the button, so Enter says why it cannot', async () => {
    // Enter on a built-in workspace did nothing and said nothing, while the
    // button beside it gave the reason.
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn();

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => 'A built-in workspace keeps its name. Duplicate it first.'}
      />,
    );

    const field = screen.getByLabelText('New name');
    fireEvent.change(field, { target: { value: `${layout.displayName} again` } });
    await userEvent.type(field, '{Enter}');

    expect(run).toHaveBeenCalledWith(
      'workspace.rename',
      { layoutId: layout.id, displayName: `${layout.displayName} again` },
      { sayWhenUnchanged: true },
    );
  });

  it('says what the name field is for, and what a name has to be, in a few words', () => {
    const { context } = buildShellContext();
    const builtIn = context.workspace.get();
    const view = render(
      <Workspaces
        layout={builtIn.layout}
        available={builtIn.available}
        deleted={[]}
        unread={[]}
        run={vi.fn()}
        unavailableReason={() => undefined}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveAccessibleDescription(
      'Duplicate a built-in workspace to make one you can rename. Duplicate uses the name typed here, or names the copy after this workspace. Each workspace needs its own name, of up to 120 characters.',
    );
    view.unmount();

    context.workspace.saveAs('Mine');
    const mine = context.workspace.get();
    render(
      <Workspaces
        layout={mine.layout}
        available={mine.available}
        deleted={[]}
        unread={[]}
        run={vi.fn()}
        unavailableReason={() => undefined}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveAccessibleDescription(
      'Renaming changes what the Workspace menu calls it. Duplicate uses the name typed here, or names the copy after this workspace. Each workspace needs its own name, of up to 120 characters.',
    );
  });

  it('keeps a name the command refuses in the field, and empties it once one is taken', async () => {
    // A name refused as too long was wiped from the field, so the reader had
    // to type it again to correct it. The bound is said before one is typed.
    const { context } = buildShellContext();
    context.workspace.saveAs('Mine');
    const { layout, available } = context.workspace.get();
    let taken = false;
    const run = vi.fn(() => taken);

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'New name' });
    expect(field).toHaveAccessibleDescription(
      'Renaming changes what the Workspace menu calls it. Duplicate uses the name typed here, or names the copy after this workspace. Each workspace needs its own name, of up to 120 characters.',
    );

    fireEvent.change(field, { target: { value: 'Refused' } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(field).toHaveValue('Refused');
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(field).toHaveValue('Refused');

    taken = true;
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(field).toHaveValue('');
    fireEvent.change(field, { target: { value: 'Copied' } });
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(field).toHaveValue('');
  });

  it('keeps a name another workspace has in the field, from Rename and Duplicate alike', async () => {
    // A screen reader says "Mixing" and "mixing" alike, so the second is the
    // name of the first, and is refused where it is typed.
    const { context } = buildShellContext();
    context.workspace.saveAs('Mixing');
    context.workspace.saveAs('Mine');
    const { layout, available } = context.workspace.get();

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={runnerFor(context)}
        unavailableReason={() => undefined}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'New name' });

    fireEvent.change(field, { target: { value: 'mixing' } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(field).toHaveValue('mixing');
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(field).toHaveValue('mixing');

    expect(context.workspace.get().available).toEqual(available);
    expect(context.workspace.get().layout.displayName).toBe('Mine');
  });

  it('lists a built-in workspace marked, as the Workspace menu does', async () => {
    const { context } = buildShellContext();
    context.workspace.saveAs('Mine');
    const { layout, available } = context.workspace.get();

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={vi.fn()}
        unavailableReason={() => undefined}
      />,
    );
    const user = userEvent.setup();
    screen.getByRole('combobox', { name: 'Current workspace' }).focus();
    await user.keyboard('{Enter}');

    const labels = screen.getAllByRole('option').map((one) => one.textContent);
    expect(labels).toContain('Editing (built in)');
    expect(labels).toContain('Mine');
  });

  it('gives a copy the name typed, whatever its length, and leaves a copy nobody named to the command', () => {
    // A typed name was made the base of "<name> copy" and cut to fit, so a
    // name Rename refused was taken by Duplicate as something else. It is
    // the copy's name now, refused as Rename refuses it.
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn(() => true);

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'New name' });
    const duplicateAs = (typed: string): unknown => {
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
      return run.mock.lastCall;
    };

    expect(duplicateAs('Mixing')).toEqual([
      'workspace.duplicate',
      { layoutId: layout.id, displayName: 'Mixing' },
    ]);

    const long = 'w'.repeat(200);
    expect(duplicateAs(long)).toEqual([
      'workspace.duplicate',
      { layoutId: layout.id, displayName: long },
    ]);

    expect(duplicateAs('   ')).toEqual(['workspace.duplicate', { layoutId: layout.id }]);
  });

  it('offers Duplicate with its reason where names cannot be compared', async () => {
    // Rename, Reset and Delete beside it gave their reasons before a press, as
    // the menus do, and Duplicate was offered as working until it was pressed,
    // with the field saying how it names a copy that cannot be made.
    const { context } = buildShellContext();
    const without = withoutNaming(context);
    const builtIn = context.workspace.get();
    expect(builtIn.layout.builtIn).toBe(true);
    const run = vi.fn(() => true);
    const view = render(
      <Workspaces
        layout={builtIn.layout}
        available={builtIn.available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={reasonsIn(without)}
      />,
    );

    const duplicate = screen.getByRole('button', { name: 'Duplicate' });
    expect(duplicate).toHaveAttribute('aria-disabled', 'true');
    expect(duplicate).toHaveAccessibleDescription(NAMING_UNAVAILABLE);
    const field = screen.getByRole('textbox', { name: 'New name' });
    fireEvent.change(field, { target: { value: 'Mixing' } });
    await userEvent.click(duplicate);
    expect(run).not.toHaveBeenCalled();
    expect(field).toHaveValue('Mixing');
    expect(field).toHaveAccessibleDescription('A built-in workspace keeps its name.');
    view.unmount();

    // A workspace the user made is described by what renaming it does, and
    // not by a copy.
    context.workspace.saveAs('Mine');
    const mine = context.workspace.get();
    render(
      <Workspaces
        layout={mine.layout}
        available={mine.available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={reasonsIn(without)}
      />,
    );
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveAccessibleDescription(
      NAMING_UNAVAILABLE,
    );
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveAccessibleDescription(
      'Renaming changes what the Workspace menu calls it. Each workspace needs its own name, of up to 120 characters.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(run).not.toHaveBeenCalled();
  });

  it('says why a built-in workspace keeps its name, advising a copy only where Duplicate can make one', () => {
    // Beside a Duplicate that said why it could not run, Rename's reason told
    // the reader to duplicate the workspace first.
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    expect(layout.builtIn).toBe(true);
    /** The Rename button, over the reasons the commands give in `where`. */
    const renameIn = (where: ShellContext): HTMLElement => {
      render(
        <Workspaces
          layout={layout}
          available={available}
          deleted={[]}
          unread={[]}
          run={vi.fn()}
          unavailableReason={reasonsIn(where)}
        />,
      );
      return screen.getByRole('button', { name: 'Rename' });
    };

    const without = renameIn(withoutNaming(context));
    expect(without).toHaveAttribute('aria-disabled', 'true');
    expect(without).toHaveAccessibleDescription('A built-in workspace keeps its name.');
    cleanup();

    const withNaming = renameIn(context);
    expect(withNaming).toHaveAttribute('aria-disabled', 'true');
    expect(withNaming).toHaveAccessibleDescription(
      'A built-in workspace keeps its name. Duplicate it first.',
    );
  });

  it('runs a button that can be used, and says nothing beside it', async () => {
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn();

    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );

    const reset = screen.getByRole('button', { name: 'Reset to how it ships' });
    expect(reset).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(reset);
    expect(run).toHaveBeenCalledWith('workspace.reset', { layoutId: layout.id });
  });

  it('offers the workspace deleted last back, named on its button, through the command', async () => {
    // A deletion was one press with no way back.
    const { context } = buildShellContext();
    const run = runnerFor(context);
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.save-as', { displayName: 'Mastering' });
    run('workspace.delete', { layoutId: 'mastering' });
    const show = (): void => {
      const { layout, available, deleted } = context.workspace.get();
      render(
        <Workspaces
          layout={layout}
          available={available}
          deleted={deleted}
          unread={[]}
          run={run}
          unavailableReason={reasonsIn(context)}
        />,
      );
    };
    show();

    await userEvent.click(screen.getByRole('button', { name: 'Restore "Mastering"' }));

    expect(context.workspace.get().available.map((one) => one.displayName)).toContain('Mastering');
    expect(context.workspace.get().deleted).toEqual([]);
    cleanup();
    show();
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
  });

  it('offers the text that could not be read to export, and asks before discarding it', async () => {
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    const run = vi.fn(() => true);
    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[
          { about: 'layout', setAside: 0, leftInPlace: 1 },
          { about: 'collection', setAside: 2, leftInPlace: 1 },
        ]}
        run={run}
        unavailableReason={() => undefined}
      />,
    );

    expect(
      screen.getByText(
        'One text about the workspace on screen that could not be read is left where it was found, for want of room to set it aside.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 texts about your saved workspaces that could not be read are set aside, and one more is left where it was found, for want of room to set it aside.',
      ),
    ).toBeInTheDocument();

    // Each button named for what it acts on, so two are never alike.
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Export the text about your saved workspaces that could not be read',
      }),
    );
    expect(run).toHaveBeenLastCalledWith('settings.export-unread-text', { about: 'collection' });

    // The discard cannot be undone, so it is asked for twice, and focus goes
    // to the choice that loses nothing.
    const discard = screen.getByRole('button', {
      name: 'Discard the text about your saved workspaces that could not be read',
    });
    await userEvent.click(discard);
    expect(run).toHaveBeenCalledTimes(1);
    const keep = screen.getByRole('button', {
      name: 'Keep it, the text about your saved workspaces that could not be read',
    });
    expect(keep).toHaveFocus();
    expect(keep).toHaveAccessibleDescription(
      'Discarding deletes this text for good, and nothing can bring it back. Export it first to keep a copy.',
    );

    await userEvent.click(keep);
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', {
        name: 'Discard the text about your saved workspaces that could not be read',
      }),
    ).toHaveFocus();

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Discard the text about your saved workspaces that could not be read',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Discard for good the text about your saved workspaces that could not be read',
      }),
    );
    expect(run).toHaveBeenLastCalledWith('settings.discard-unread-text', { about: 'collection' });
    expect(screen.getByRole('group', { name: 'Text that could not be read' })).toHaveFocus();
  });

  it('shows nothing of text that could not be read where there is none', () => {
    const { context } = buildShellContext();
    const { layout, available } = context.workspace.get();
    render(
      <Workspaces
        layout={layout}
        available={available}
        deleted={[]}
        unread={[]}
        run={vi.fn()}
        unavailableReason={() => undefined}
      />,
    );

    expect(screen.queryByRole('group', { name: 'Text that could not be read' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();
  });
});
