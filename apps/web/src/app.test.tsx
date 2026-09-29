import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LOADING_TIME, loadTheApplication } from './testing/application-modules.js';
import { PROMPTLY, everythingQueued } from './testing/waiting.js';

/**
 * The composition root builds the application when it is mounted, and not
 * before.
 *
 * Built when the module is evaluated, importing `app.tsx` would read storage,
 * probe the browser and write a log record, against the module's own comment
 * and ADR-0011, which both have the stores created once, in the composition
 * root, and never reached through a module import.
 */

beforeAll(loadTheApplication, LOADING_TIME);

/** What takes down the application the test mounted. */
let unmount: (() => void) | undefined;

afterEach(() => {
  act(() => {
    unmount?.();
  });
  unmount = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.localStorage.clear();
  // What a test set on the navigator and the document themselves, so the
  // browser's own answers show through again.
  Reflect.deleteProperty(window.navigator, 'keyboard');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('the composition root', () => {
  it('reads and writes nothing when the module is imported', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');

    vi.resetModules();
    await import('./app.js');

    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('builds the application when it is mounted, and shows the shell', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');

    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);

    await act(async () => {
      unmount = mount(container);
      await Promise.resolve();
    });

    expect(read).toHaveBeenCalledWith('audiogubbins.preferences');
    expect(await screen.findByRole('menubar', { name: 'Main menu' })).toBeInTheDocument();
  });

  it('answers the settings whether a command they ran was refused, so a refused name stays where it was typed', async () => {
    // The settings empty the name field only once the command it named
    // ran. Each part was tested with a command of the test's own, so an
    // application that answered every command as run wiped a refused name
    // all the same.
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Workspaces' }));

    // A copy of the built-in workspace, which is one the reader can rename.
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const field = screen.getByRole('textbox', { name: 'New name' });
    const rename = screen.getByRole('button', { name: 'Rename' });

    const tooLong = 'w'.repeat(121);
    fireEvent.change(field, { target: { value: tooLong } });
    await userEvent.click(rename);
    expect(field).toHaveValue(tooLong);

    fireEvent.change(field, { target: { value: 'Mastering' } });
    await userEvent.click(rename);
    expect(field).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Current workspace' })).toHaveTextContent(
      'Mastering',
    );
  });

  it('hands the settings the deleted workspaces and the text that could not be read, each where it belongs', async () => {
    // Each section was tested with what a test gave it, so an application
    // that passed it nothing would offer no way back from a deletion and no
    // export of what could not be read.
    window.localStorage.setItem('audiogubbins.workspaces.unreadable', JSON.stringify(['[{']));
    window.localStorage.setItem('audiogubbins.shortcuts.unreadable', JSON.stringify(['{"a"']));
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
      await Promise.resolve();
    });

    await userEvent.click(await screen.findByRole('tab', { name: 'Workspaces' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Restore "Editing copy"' })).toBeInTheDocument();
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
    expect(window.localStorage.getItem('audiogubbins.workspaces.unreadable')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Shortcuts' }));
    expect(
      screen.getByRole('button', {
        name: 'Export the text about your shortcut profiles that could not be read',
      }),
    ).toBeInTheDocument();
  });

  it('takes the application down with it, which React unmounting does not', async () => {
    // `root.unmount()` removes no `visibilitychange` listener and no `focus`
    // listener, so an application left listening reads the browser's layout
    // map again for a page the next test is on, holding a keyboard layout
    // store and a storage with it. The composition root answers what takes
    // that down; this is the call that makes the answer worth having.
    const maps = [new Map([['KeyK', 't']]), new Map([['KeyK', 'k']])];
    Object.defineProperty(window.navigator, 'keyboard', {
      configurable: true,
      value: {
        getLayoutMap: async () => await Promise.resolve(maps.shift() ?? new Map()),
      },
    });

    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);

    await act(async () => {
      unmount = mount(container);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(maps.length).toBe(1);
    }, PROMPTLY);

    act(() => {
      unmount?.();
    });
    unmount = undefined;

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await everythingQueued();

    // Nothing asked again, so the second map is still waiting.
    expect(maps.length).toBe(1);
  });
});
