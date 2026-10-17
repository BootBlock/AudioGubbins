import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';

import { renderThemed } from '../../testing/render-themed.js';
import { ThemeProvider, fixedSystemAppearance } from '../../theme/theme-provider.js';
import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../../tokens/preferences.js';
import { HintProvider } from './tooltips.js';
import { Button } from '../button.js';
import { InfoPopover } from './info-popover.js';
import { Menu } from './menu.js';
import type { MenuGroup } from './menu-entries.js';
import { ModalDialog } from './modal-dialog.js';

describe('ModalDialog', () => {
  const dialog = (onOpenChange = vi.fn()): ReactNode => (
    <ModalDialog
      open
      onOpenChange={onOpenChange}
      title="Reset the workspace"
      description="This returns every panel to its built-in position."
      actions={<Button tone="primary">Reset</Button>}
    >
      <p>The project is not affected.</p>
    </ModalDialog>
  );

  it('announces itself with its title and its description', () => {
    // The description was drawn but not tied to the dialogue, so it was read
    // only by someone who went looking for it. A screen-reader user meets a
    // dialogue with no surrounding context, and the palette's description is
    // the only statement of how to drive it.
    renderThemed(dialog());

    const found = screen.getByRole('dialog', { name: 'Reset the workspace' });
    expect(found).toBeInTheDocument();

    const describedBy = found.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const description = document.getElementById(describedBy ?? '');
    expect(description?.textContent).toBe('This returns every panel to its built-in position.');
  });

  it('says it is modal, which is what keeps the shortcuts off the page behind it', () => {
    // Radix makes the page behind inert and did not say so: the shortcut
    // listener, which reads this, ran the editor's keys behind the settings.
    renderThemed(dialog());

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into itself when it opens', () => {
    renderThemed(dialog());
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement | null,
    );
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    renderThemed(dialog(onOpenChange));

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('puts focus back where it was, even though nothing in the page opened it', async () => {
    // Every AudioGubbins dialogue is opened by a command, so none of them has a
    // trigger to return focus to. Without this the focus would fall to the
    // document body when the dialogue closed, which drops a keyboard user out
    // of the application.
    function Host(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Somewhere else
          </Button>
          <ModalDialog
            open={open}
            onOpenChange={setOpen}
            title="Settings"
            description="Everything about how AudioGubbins looks and behaves."
          >
            <p>Nothing to change yet.</p>
          </ModalDialog>
        </>
      );
    }

    renderThemed(<Host />);

    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
    elsewhere.focus();

    // Opened from the keyboard, so no pointer press moves the focus for us.
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(elsewhere).toHaveFocus();
    });
  });

  it('keeps Tab inside itself while it is open', async () => {
    renderThemed(dialog());

    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab();
      expect(screen.getByRole('dialog')).toContainElement(
        document.activeElement as HTMLElement | null,
      );
    }
  });
});

/**
 * Menus are opened from the keyboard in these tests.
 *
 * Not a convenience: under jsdom, only the first `click` on a menu trigger in a
 * file opens anything. The trigger reports `aria-expanded="false"` immediately
 * afterwards in every later test, whatever the cleanup does, because the menu
 * library keeps module-level layer state that unmounting does not unwind. The
 * keyboard path is unaffected and was verified across five consecutive tests.
 *
 * The pointer path is covered where it can be tested honestly: the end-to-end
 * suite drives a real browser, where the artefact does not exist.
 */
async function openMenu(): Promise<void> {
  screen.getByRole('button', { name: 'Workspace' }).focus();
  await userEvent.keyboard('{Enter}');
}

describe('Menu', () => {
  const groups: readonly MenuGroup[] = [
    {
      key: 'layout',
      items: [
        { key: 'save', label: 'Save layout', shortcut: 'Ctrl+Shift+S', onSelect: vi.fn() },
        { key: 'reset', label: 'Reset layout', onSelect: vi.fn() },
      ],
    },
    {
      key: 'delete',
      items: [
        {
          key: 'delete',
          label: 'Delete layout',
          unavailableReason: 'A built-in layout cannot be deleted.',
          onSelect: vi.fn(),
        },
      ],
    },
  ];

  it('moves through the entries with the arrow keys', async () => {
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();

    // Opening from the keyboard lands on the first entry, so the user is
    // already somewhere rather than having to press down to enter the menu.
    expect(await screen.findByRole('menuitem', { name: /Save layout/ })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Reset layout' })).toHaveFocus();

    // The next entry is unavailable, and the arrow keys land on it all the
    // same, so its reason is read to a keyboard or screen-reader user. The
    // arrow keys passed over it, and only a pointer user could learn why it
    // could not be chosen, or what it said was already in force.
    await userEvent.keyboard('{ArrowDown}');
    const unavailable = screen.getByRole('menuitem', { name: /Delete layout/ });
    expect(unavailable).toHaveFocus();
    expect(unavailable).toHaveAccessibleName(/A built-in layout cannot be deleted\./);
  });

  it('reaches an unavailable entry by typing the start of its name', async () => {
    // The typeahead passed over an entry marked disabled as the arrow keys did,
    // so typing its name found nothing.
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /Save layout/ })).toHaveFocus();
    await userEvent.keyboard('d');

    expect(screen.getByRole('menuitem', { name: /Delete layout/ })).toHaveFocus();
  });

  it('runs nothing when an unavailable entry is chosen, and stays open', async () => {
    const onSelect = vi.fn();
    const one: readonly MenuGroup[] = [
      {
        key: 'g',
        items: [
          { key: 'delete', label: 'Delete layout', unavailableReason: 'Built in.', onSelect },
        ],
      },
    ];
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={one} label="Workspace" />);

    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /Delete layout/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('runs the entry that was chosen', async () => {
    const onSelect = vi.fn();
    const single: readonly MenuGroup[] = [
      { key: 'g', items: [{ key: 'reset', label: 'Reset layout', onSelect }] },
    ];
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={single} label="Workspace" />);

    await openMenu();
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows the shortcut beside an entry, and says in text why an unavailable one cannot be chosen, marked disabled rather than hidden', async () => {
    // Read from one opening, since each is only what the open menu shows.
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();

    // The reason used to be carried only by `aria-description`, which Gecko and
    // WebKit do not implement, on an element the roving focus skips. Text is
    // part of the entry's accessible name, so every assistive technology reads
    // it and every user can see it.
    const entry = await screen.findByRole('menuitem', { name: /Delete layout/ });
    expect(entry).toHaveTextContent('A built-in layout cannot be deleted.');
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Ctrl+Shift+S')).toBeInTheDocument();
  });
});

describe('InfoPopover', () => {
  /*
   * The popover primitive WU-01.B requires. Nothing in this phase opens one, so
   * nothing but these tests exercises it.
   */
  it('opens from its trigger as a named, non-modal surface', async () => {
    renderThemed(
      <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory">
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'About this capability' }));

    const surface = await screen.findByRole('dialog', { name: 'Shared memory' });
    expect(surface).toHaveTextContent('Needs cross-origin isolation.');
    expect(surface).not.toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape and gives focus back to its trigger', async () => {
    renderThemed(
      <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory">
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );
    const trigger = screen.getByRole('button', { name: 'About this capability' });

    await userEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Shared memory' });
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Shared memory' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('follows a caller that controls whether it is open', () => {
    const { rerender } = renderThemed(
      <InfoPopover
        trigger={<Button>About this capability</Button>}
        label="Shared memory"
        open={false}
      >
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <HintProvider>
          <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory" open>
            <p>Needs cross-origin isolation.</p>
          </InfoPopover>
        </HintProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Shared memory' })).toBeInTheDocument();
  });
});

describe('ModalDialog, as the design language lays it out', () => {
  it('closes from a close button where it names one, and keeps a status before its actions', async () => {
    const onOpenChange = vi.fn();
    renderThemed(
      <ModalDialog
        open
        onOpenChange={onOpenChange}
        title="File already exists"
        description="A file called take.wav is already in the folder."
        closeLabel="Close"
        status="Nothing has been written yet."
        actions={<Button>Keep both</Button>}
      >
        <p>Choose what to do with it.</p>
      </ModalDialog>,
    );

    const status = screen.getByText('Nothing has been written yet.');
    const keep = screen.getByRole('button', { name: 'Keep both' });
    expect(status.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('draws no close button where it names none, so focus lands where it always has', () => {
    renderThemed(
      <ModalDialog open onOpenChange={vi.fn()} title="Reset" description="Resets the layout.">
        <p>Nothing else changes.</p>
      </ModalDialog>,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Menu entries with glyphs', () => {
  it('gives every entry of a menu a glyph column once one entry has a glyph', async () => {
    renderThemed(
      <Menu
        trigger={<Button>Workspace</Button>}
        label="Workspace"
        groups={[
          {
            key: 'edit',
            items: [
              { key: 'copy', label: 'Copy', icon: 'copy', onSelect: vi.fn() },
              { key: 'other', label: 'Something else', onSelect: vi.fn() },
            ],
          },
        ]}
      />,
    );

    await openMenu();

    const menu = await screen.findByRole('menu', { name: 'Workspace' });
    expect(menu).toHaveAttribute('data-ag-glyphs');
    const plain = screen.getByRole('menuitem', { name: 'Something else' });
    expect(plain.querySelector('.ag-menu-item-glyph')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy' }).querySelector('svg')).not.toBeNull();
  });
});
