import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  KeyboardConvention,
  commandId,
  commandPressMayBeTaken,
  shortcut,
  shortcutKey,
} from '@audiogubbins/commands';
import { UNKNOWN_LAYOUT, commandLayerOf, keyPress } from '@audiogubbins/input';

import type { ShellContext } from '../../commands/shell-context.js';
import { shippedDefaults } from '../../state/shortcut-layout.js';
import { keyEventOf } from '@audiogubbins/input/testing';
import { AZERTY, DVORAK, NAMED_LAYOUTS } from '../../testing/keyboard-layouts.js';
import { reasonsIn } from '../../testing/command-availability.js';
import { buildShellContext, withoutNaming } from '../../testing/shell-context.js';
import { PROMPTLY } from '../../testing/waiting.js';
import { ReservedList, WaitingList } from './shortcut-notes.js';
import { Shortcuts } from './shortcuts.js';

/**
 * The stylesheets that draw the settings, in the order the application loads
 * them: the design system's tokens and components, then the shell's own.
 */
const STYLESHEETS = [
  createRequire(import.meta.url).resolve('@audiogubbins/design-system/styles/tokens.css'),
  createRequire(import.meta.url).resolve('@audiogubbins/design-system/styles/components.css'),
  join(import.meta.dirname, '..', 'shell.css'),
].map((path) => readFileSync(path, 'utf8'));

/** A style element holding `text`, added to the page. */
function styled(text: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.append(style);
  return style;
}

/**
 * The rules the page's stylesheets draw under forced colours, which a browser
 * in that mode reads after the others.
 */
function forcedColourRules(): string {
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule instanceof CSSMediaRule)
    .filter((rule) => rule.media.mediaText.includes('forced-colors: active'))
    .flatMap((block) => [...block.cssRules].map((rule) => rule.cssText))
    .join('\n');
}

/**
 * Runs `check` over the page drawn as the application draws it, the theme
 * attribute the forced-colour rules are written under included, and takes
 * the styles away again after.
 */
function drawn(check: (forceColours: () => void) => void): void {
  const styles = STYLESHEETS.map(styled);
  document.documentElement.setAttribute('data-ag-theme', 'dark');
  try {
    check(() => {
      styles.push(styled(forcedColourRules()));
    });
  } finally {
    for (const style of styles) style.remove();
    document.documentElement.removeAttribute('data-ag-theme');
  }
}

/**
 * How a control looks at rest: the colour of its text and the pointer over
 * it. What a pointer over it draws is read in a browser.
 */
function lookOf(element: Element | null): { readonly color: string; readonly cursor: string } {
  if (element === null) throw new Error('There is no element to read the look of.');
  const { color, cursor } = getComputedStyle(element);
  return { color, cursor };
}

describe('importing a shortcut profile', () => {
  /** The section with an import control, and what it said and ran. */
  function importControl() {
    const { context } = buildShellContext();
    const shortcuts = context.shortcuts.get();
    const run = vi.fn();
    const announce = vi.fn();

    render(
      <Shortcuts
        askFor={() => undefined}
        profile={shortcuts.profile}
        available={shortcuts.available}
        conflicts={shortcuts.conflicts}
        reserved={shortcuts.reserved}
        waiting={shortcuts.waiting}
        convention={context.convention}
        layout={UNKNOWN_LAYOUT}
        learnKey={() => undefined}
        commands={[]}
        labelFor={(id) => id}
        run={run}
        announce={announce}
        unavailableReason={() => undefined}
      />,
    );

    return { run, announce, field: screen.getByLabelText('Import') };
  }

  /** A file of the size given, whose text nothing is expected to read. */
  function fileOf(size: number): File {
    const file = new File(['{}'], 'shortcuts.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  it('refuses a file larger than any profile before reading it, and says so', async () => {
    // A profile is something users share, so the file need not be the
    // reader's own, and nothing bounded it: the whole of it was read into
    // memory and parsed whatever its size.
    const { run, announce, field } = importControl();

    await userEvent.upload(field, fileOf(512 * 1024));

    expect(run).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('larger than 256 kB'),
      true,
      expect.objectContaining({ refusal: true }),
    );
  });

  it('reads a file within the bound', async () => {
    // So the rule above is a bound rather than a refusal of every file.
    const { run, announce, field } = importControl();

    await userEvent.upload(field, fileOf(1024));

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledWith('shortcuts.import', { text: '{}' });
    }, PROMPTLY);
    expect(announce).not.toHaveBeenCalled();
  });

  it('says so when the file cannot be read at all', async () => {
    // A file removed between choosing it and reading it, or one the browser
    // will not open. Unhandled, the reader chose a file and nothing happened.
    const { run, announce, field } = importControl();
    const file = fileOf(1024);
    vi.spyOn(file, 'text').mockRejectedValue(new Error('gone'));

    await userEvent.upload(field, file);

    await vi.waitFor(() => {
      expect(announce).toHaveBeenCalledWith(
        'That file could not be read. Nothing was imported.',
        true,
        expect.objectContaining({ refusal: true }),
      );
    }, PROMPTLY);
    expect(run).not.toHaveBeenCalled();
  });

  it('draws the Import label as a working button where a profile can be imported', () => {
    importControl();
    drawn((forceColours) => {
      const label = screen.getByLabelText('Import').closest('label');
      const working = screen.getByRole('button', { name: 'Export' });
      expect(lookOf(label)).toEqual(lookOf(working));
      forceColours();
      expect(lookOf(label)).toEqual(lookOf(working));
    });
  });
});

describe('the shortcut settings', () => {
  it('gives each profile action the reason its command gives, and runs nothing it refuses', async () => {
    // Reset and Delete were disabled whenever the profile was built in, a rule
    // of the section's own: they left the tab order and said nothing.
    const { context } = buildShellContext();
    const shortcuts = context.shortcuts.get();
    const run = vi.fn();
    const reasons: Readonly<Record<string, string>> = {
      'shortcuts.reset': 'The default shortcuts are already in force.',
      'shortcuts.delete': 'The built-in profile cannot be deleted.',
    };

    render(
      <Shortcuts
        askFor={() => undefined}
        profile={shortcuts.profile}
        available={shortcuts.available}
        conflicts={shortcuts.conflicts}
        reserved={shortcuts.reserved}
        waiting={shortcuts.waiting}
        convention={context.convention}
        layout={UNKNOWN_LAYOUT}
        learnKey={() => undefined}
        commands={[]}
        labelFor={(id) => id}
        run={run}
        announce={() => undefined}
        unavailableReason={(id) => reasons[id]}
      />,
    );

    const reset = screen.getByRole('button', { name: 'Reset to the defaults' });
    const remove = screen.getByRole('button', { name: 'Delete profile' });
    expect(reset).toHaveAttribute('aria-disabled', 'true');
    expect(reset).toHaveAccessibleDescription('The default shortcuts are already in force.');
    expect(remove).toHaveAccessibleDescription('The built-in profile cannot be deleted.');

    await userEvent.click(reset);
    await userEvent.click(remove);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the shortcut settings where names cannot be compared', () => {
  const UNAVAILABLE =
    'Naming workspaces and shortcut profiles is unavailable in this browser; the Capabilities panel says why.';
  const dark = commandId('view.theme-dark');
  const light = commandId('view.theme-light');

  /**
   * The settings over the stores of a browser whose names cannot be compared,
   * with a bound command and an unbound one, each control's availability read
   * from the shell's own commands, as the menus read it.
   */
  function settingsWithoutNaming(makeProfile: (context: ShellContext) => void = () => undefined) {
    const { context } = buildShellContext();
    makeProfile(context);
    const without = withoutNaming(context);
    const { profile } = context.shortcuts.get();
    const run = vi.fn(() => true);
    const announce = vi.fn();

    render(
      <Shortcuts
        askFor={() => undefined}
        profile={{
          ...profile,
          bindings: [{ commandId: dark, shortcut: shortcut(keyPress('KeyG', { control: true })) }],
        }}
        available={[profile]}
        conflicts={[]}
        reserved={[]}
        waiting={[]}
        convention={context.convention}
        layout={UNKNOWN_LAYOUT}
        learnKey={() => undefined}
        commands={[
          { id: dark, label: 'Dark theme' },
          { id: light, label: 'Light theme' },
        ]}
        labelFor={(id) => id}
        run={run}
        announce={announce}
        unavailableReason={reasonsIn(without)}
      />,
    );

    return { run, announce, builtIn: profile.builtIn };
  }

  /** Chooses a file to import, and answers whether its text was read. */
  async function importAFile(): Promise<boolean> {
    const file = new File(['{}'], 'shortcuts.json', { type: 'application/json' });
    const read = vi.spyOn(file, 'text');
    await userEvent.upload(screen.getByLabelText('Import'), file);
    return read.mock.calls.length > 0;
  }

  it('says above the table that no shortcut can be changed where names cannot be compared, and offers no control as working', async () => {
    // The built-in shortcuts are changed in a copy, which is named, and a
    // profile imported is named too. Offered as working, Change opened the
    // recorder and Import chose and read a file before either was refused,
    // and the note above them promised a copy that could not be made.
    const { run, announce, builtIn } = settingsWithoutNaming();
    expect(builtIn).toBe(true);

    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(1);
    const note = screen.getByText(UNAVAILABLE);
    expect(note.compareDocumentPosition(screen.getByRole('table'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const controls = [
      screen.getByRole('button', { name: 'Change the shortcut for Dark theme' }),
      screen.getByRole('button', { name: 'Remove the shortcut for Dark theme' }),
      screen.getByRole('button', { name: 'Change the shortcut for Light theme' }),
      screen.getByLabelText('Import'),
    ];
    for (const control of controls) {
      expect(control).toHaveAttribute('aria-disabled', 'true');
      expect(control).toHaveAttribute('aria-describedby', note.id);
      expect(control).toHaveAccessibleDescription(UNAVAILABLE);
    }

    for (const button of controls.slice(0, 3)) await userEvent.click(button);
    expect(screen.queryByRole('textbox', { name: /^Shortcut for / })).toBeNull();
    expect(await importAFile()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();

    expect(
      screen.getByText(/^These are the shortcuts AudioGubbins ships with\./),
    ).toHaveTextContent(
      /^These are the shortcuts AudioGubbins ships with\. A copy is needed to change them, and none can be made\.$/,
    );
  });

  it('draws the Import label as an unavailable button where no profile can be imported', () => {
    // The input was unavailable and described, and opened no picker, but the
    // label a user sees and presses kept the look of a working button.
    settingsWithoutNaming();
    drawn((forceColours) => {
      const label = screen.getByLabelText('Import').closest('label');
      const unavailable = screen.getByRole('button', {
        name: 'Change the shortcut for Dark theme',
      });
      const working = screen.getByRole('button', { name: 'Export' });
      expect(unavailable).toHaveAttribute('aria-disabled', 'true');
      expect(lookOf(unavailable)).not.toEqual(lookOf(working));
      expect(lookOf(label)).toEqual(lookOf(unavailable));

      forceColours();
      expect(lookOf(unavailable).color).not.toBe(lookOf(working).color);
      expect(lookOf(label)).toEqual(lookOf(unavailable));
    });
  });

  it('changes a profile the user made as ever where names cannot be compared, and says that none can be imported', async () => {
    // A profile the user made is changed in place, which names nothing.
    const { run, builtIn } = settingsWithoutNaming((context) => {
      context.shortcuts.rebind(light, shortcut(keyPress('KeyJ', { control: true })));
    });
    expect(builtIn).toBe(false);

    const [note, ...more] = screen.getAllByText(UNAVAILABLE);
    expect(more).toEqual([]);
    const importing = screen.getByLabelText('Import');
    expect(importing).toHaveAttribute('aria-disabled', 'true');
    expect(importing).toHaveAttribute('aria-describedby', note?.id);
    expect(await importAFile()).toBe(false);

    const remove = screen.getByRole('button', { name: 'Remove the shortcut for Dark theme' });
    expect(remove).toHaveAttribute('aria-disabled', 'false');
    expect(remove).not.toHaveAttribute('aria-describedby');
    await userEvent.click(remove);
    expect(run).toHaveBeenCalledWith('shortcuts.unbind', { commandId: dark });
    await userEvent.click(
      screen.getByRole('button', { name: 'Change the shortcut for Light theme' }),
    );
    expect(screen.getByRole('textbox', { name: 'Shortcut for Light theme' })).toBeInTheDocument();
  });
});

describe('what the shortcut settings say beside the table', () => {
  it('gives each binding of a command the browser takes a row of its own', () => {
    // Keyed by the command alone, two rows shared a React key, which leaves
    // React unable to tell them apart when the list changes. One command can
    // carry two such bindings, which an imported file can hold.
    const id = commandId('view.toggle-palette');
    const complaints: unknown[][] = [];
    const reporting = vi.spyOn(console, 'error').mockImplementation((...args) => {
      complaints.push(args);
    });

    try {
      render(
        <ReservedList
          reserved={[
            {
              commandId: id,
              shortcut: shortcut(keyPress('KeyW', { control: true })),
              reason: 'a',
            },
            {
              commandId: id,
              shortcut: shortcut(keyPress('KeyT', { control: true })),
              reason: 'b',
            },
          ]}
          labelFor={() => 'Show the command palette'}
        />,
      );
    } finally {
      reporting.mockRestore();
    }

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(complaints.map((one) => String(one[0])).join(' ')).not.toContain('same key');
  });

  it('says a binding left to the browser is one a browser or the system may take first, or one a reader relies on it for, never one the browser took', () => {
    // The table holds a press a browser or the system takes before the page on
    // any supported browser, and a press that reaches the page but that a
    // reader relies on the browser for, and AudioGubbins answers none of them
    // anywhere, so that an exported profile means one thing on every machine.
    // Told that the browser took the press, a reader on a browser that would
    // have delivered it would be given a cause that is false there, and would
    // read "Change them below" as advice about the browser. So the sentence
    // says what a browser or the system may do, and never what the browser did.
    render(
      <ReservedList
        reserved={[
          {
            commandId: commandId('workspace.close-panel'),
            shortcut: shortcut(keyPress('KeyW', { control: true })),
            reason: 'Ctrl+W: The browser closes the tab with it.',
          },
          {
            commandId: commandId('view.toggle-palette'),
            shortcut: shortcut(keyPress('KeyA', { control: true, meta: true })),
            reason:
              'Ctrl+Win+A: The operating system may keep a combination with the Windows or Super key for itself.',
          },
          {
            commandId: commandId('view.brighten'),
            shortcut: shortcut(keyPress('Minus', { control: true })),
            reason:
              'Ctrl+Minus: The browser zooms the page with it, which you may need for larger text, so it is kept for the browser.',
          },
        ]}
        labelFor={(id) => id}
      />,
    );

    const group = screen.getByRole('group', { name: 'Left to the browser or the system' });
    expect(group).toHaveTextContent(
      'On this keyboard, 3 shortcuts are ones that a browser or the system may take before the page sees them, or that are left to the browser because you may rely on them there. AudioGubbins does not answer them on any browser. Change them below.',
    );
    expect(group.textContent).not.toMatch(/taken by the browser|the browser took/i);
    expect(within(group).getAllByRole('listitem')).toHaveLength(3);
    expect(group).toHaveTextContent('so it is kept for the browser.');
    // Each row names the command and then its reason, which is a sentence of
    // its own: joined by a comma, a capital followed it mid-sentence.
    expect(within(group).getAllByRole('listitem')[2]).toHaveTextContent(
      'view.brighten — Ctrl+Minus: The browser zooms the page with it',
    );
  });

  it('counts the keys it names, not the defaults, and names each key once', () => {
    // A default can wait for two characters, and two defaults for one. The
    // sentence counted the defaults, and then every mention of a key: it asked
    // for one key while the list named two, and the list named K once for each
    // default that waited for it.
    const labels: Record<string, string> = {
      'view.toggle-palette': 'Show the command palette',
      'workspace.save-as': 'Save the workspace as a new one',
    };
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k', 'p'],
            waitsForCommandLayer: false,
          },
          {
            commandId: commandId('workspace.save-as'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
        ]}
        labelFor={(id) => labels[id] ?? id}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent('types their characters. Press each key named below');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The key that types "K": Show the command palette, Save the workspace as a new one',
      'The key that types "P": Show the command palette',
    ]);
  });

  it('asks for one key where every default waits for the same one', () => {
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
          {
            commandId: commandId('workspace.save-as'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
        ]}
        labelFor={(id) => id}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent('types their character. Press the key named below');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('names both characters one default waits for as its characters', () => {
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k', 'p'],
            waitsForCommandLayer: false,
          },
        ]}
        labelFor={(id) => id}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      'One default shortcut has no key yet: AudioGubbins has not seen where your keyboard types its characters.',
    );
  });

  it('says that Caps Lock has to be off, since nothing is learned while it is on', () => {
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
        ]}
        labelFor={(id) => id}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      'Press the key named below once on its own, with Caps Lock off, anywhere in AudioGubbins',
    );
  });

  it('names why the layout is not known already, where the browser does not say', () => {
    // On a browser with no layout map the defaults wait for keys, and the list
    // explained the wait without its cause.
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
        ]}
        labelFor={() => 'Show the command palette'}
        layoutMapReason="This browser does not tell AudioGubbins what your keyboard types on each key."
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      'This browser does not tell AudioGubbins what your keyboard types on each key.',
    );
  });

  it('asks for a press made with Command, where that is what a default waits for', () => {
    // Told to press the key its character is on, a user whose keyboard may
    // type another layout under Command pressed it and saw nothing happen:
    // the key is known, and which layer the system reads is not.
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          { commandId: commandId('settings.open'), characters: [], waitsForCommandLayer: true },
        ]}
        labelFor={() => 'Open the settings'}
        layout={DVORAK}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent(
      'One default shortcut waits for a press made with Command. Some keyboards type another layout while Command is held, and until one press shows whether yours does, there is no key it can safely go on. Hold Command and press the key that types "C" once, with Caps Lock off, while this note is on screen.',
    );
    expect(group).not.toHaveTextContent('no key yet');
    expect(screen.getByRole('listitem')).toHaveTextContent('Open the settings');
  });

  it('names the key a Command press is asked on while it names one, and no longer once it is gone', () => {
    // The keyboard keeps the browser from acting on the press only while it is
    // asked for. Kept from it whenever a default waited, the same press was
    // Copy on plain Dvorak, anywhere in the application.
    const askFor = vi.fn();
    const waiting = [
      { commandId: commandId('settings.open'), characters: [], waitsForCommandLayer: true },
    ];
    const view = render(
      <WaitingList
        askFor={askFor}
        waiting={waiting}
        labelFor={() => 'Open the settings'}
        layout={DVORAK}
        convention={KeyboardConvention.Apple}
      />,
    );
    expect(askFor.mock.calls).toEqual([['KeyI']]);

    view.rerender(
      <WaitingList
        askFor={askFor}
        waiting={[]}
        labelFor={() => 'Open the settings'}
        layout={DVORAK}
        convention={KeyboardConvention.Apple}
      />,
    );
    expect(askFor.mock.calls).toEqual([['KeyI'], [undefined]]);

    // Where no key can be named, nothing is asked for.
    const none = vi.fn();
    render(
      <WaitingList
        askFor={none}
        waiting={waiting}
        labelFor={() => 'Open the settings'}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );
    expect(none).not.toHaveBeenCalled();
  });

  it('names a key a Command press is read from and the page receives, on every layout a default waits on', () => {
    // The whole of what the note is for: the reader presses the key it names
    // and the wait ends. Named by sorting the characters the waiting defaults
    // are written as, it asked an Apple reader for the key that types a comma
    // — a comma is not a letter, and no reading is taken from that press.
    // Named by the layout's own order instead, it asked for the key that types
    // "a" on AZERTY, which is where a US keyboard has Q: read is not
    // delivered, and macOS quits the browser with that press.
    const asked: string[] = [];

    for (const [name, layout] of NAMED_LAYOUTS) {
      const shipped = shippedDefaults(KeyboardConvention.Apple, () => layout);
      const waiting = shipped.waitingIn(shipped.profile(), () => true);
      if (!waiting.some((each) => each.waitsForCommandLayer)) continue;

      const view = render(
        <WaitingList
          askFor={() => undefined}
          waiting={waiting}
          labelFor={(id) => id}
          layout={layout}
          convention={KeyboardConvention.Apple}
        />,
      );
      const said = view.getByRole('group', { name: 'Waiting for your keyboard' }).textContent;
      view.unmount();

      const named = /press the key that types "(.+?)" once/u.exec(said)?.[1];
      if (named === undefined) {
        // No key was named, so the note says why and where to go instead
        // rather than trailing off or naming one anyway.
        expect([name, said]).toEqual([
          name,
          expect.stringContaining('Set these shortcuts yourself in the table below.'),
        ]);
        asked.push(`${name}: none`);
        continue;
      }
      asked.push(`${name}: ${named}`);

      // The press the reader makes: the key that types the character the note
      // named, held with Command. What the key event carries is the layout's
      // own character where the system reads no other layer, and the letter a
      // US layout types on that key where it reads one. Either is an answer;
      // a character the reading is not taken from is none.
      const character = named.toLowerCase();
      const code = layout.keyTyping(character);
      expect([name, code]).toEqual([name, expect.stringMatching(/^Key[A-Z]$/u)]);
      const held = keyEventOf(String(code), character, { metaKey: true });

      expect([name, commandLayerOf(held, layout)]).toEqual([name, 'the same']);
      expect([
        name,
        commandLayerOf({ ...held, key: String(code).slice(3).toLowerCase() }, layout),
      ]).toEqual([name, 'another layout']);

      // And the press arrives, under either reading of the layout. Which of
      // the two the system reads is what the press is meant to settle, so a
      // key is only safe to ask for when neither reading is a combination the
      // browser or the system takes before the page. The rule is the command
      // layer's, and held there against both layouts by its own tests.
      expect([
        name,
        commandPressMayBeTaken(String(code), layout, KeyboardConvention.Apple),
      ]).toEqual([name, false]);
    }

    // Which layouts ask, and for what, so a change that stops the note asking
    // at all is not read as every layout passing. Apple hardware and a layout
    // that moves a default's character: Dvorak moves every one of them, AZERTY
    // the comma alone. Dvorak's answer is not the first key it offers — that
    // one opens a browser window with Command — and AZERTY has no answer at
    // all, because it moves four letters and each of them is read either as
    // the key that quits the browser or as the key that closes the tab.
    expect(asked).toEqual(['Dvorak: C', 'AZERTY: none']);
  });

  it('says no key can be asked for, where the platform takes every one the layout offers', () => {
    // AZERTY, which is the layout this note is for. It moves four letters — a
    // and q, z and w — and every one of them is read either as the key macOS
    // quits the browser with or as the key the browser closes the tab with.
    // Naming one of those would be worse than naming none: the reader who
    // followed the note would lose the page and settle nothing, so the note
    // says so and points at the table where the binding can be set by hand.
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          { commandId: commandId('settings.open'), characters: [], waitsForCommandLayer: true },
        ]}
        labelFor={() => 'Open the settings'}
        layout={AZERTY}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent(
      'Every key of yours that could show it may be one your browser or your system takes before AudioGubbins sees it, so there is no press to ask you for. Set these shortcuts yourself in the table below.',
    );
    expect(group).not.toHaveTextContent('press the key that types');
    expect(screen.getByRole('listitem')).toHaveTextContent('Open the settings');
  });

  it('says that no key of the reader can show it, where the layout has shown none', () => {
    // A browser that offers no layout map knows nothing of a key until the
    // user has typed it plainly, so there may be no key to name at all. Named
    // from the waiting defaults, the sentence asked for the key that types
    // "", which is no key, and the reader had nothing to press.
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          { commandId: commandId('settings.open'), characters: [], waitsForCommandLayer: true },
        ]}
        labelFor={() => 'Open the settings'}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent(
      'AudioGubbins has not seen a key of yours that can show it: it has to be a letter key your layout moved from where a US keyboard has it. Keep typing with Caps Lock off, and if your keyboard has one it is named here. You can also set these shortcuts yourself in the table below.',
    );
    expect(group).not.toHaveTextContent('press the key that types');
  });

  it('asks for both presses where a default waits for a key and another for the Command layer', () => {
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          {
            commandId: commandId('view.toggle-palette'),
            characters: ['k'],
            waitsForCommandLayer: false,
          },
          { commandId: commandId('settings.open'), characters: [], waitsForCommandLayer: true },
        ]}
        labelFor={(id) => id}
        layout={AZERTY}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent('One default shortcut has no key yet');
    expect(group).toHaveTextContent('One default shortcut waits for a press made with Command');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('names one key in the singular', () => {
    render(
      <WaitingList
        askFor={() => undefined}
        waiting={[
          { commandId: commandId('view.brighten'), characters: ['ß'], waitsForCommandLayer: false },
        ]}
        labelFor={() => 'Brighten the interface'}
        layout={UNKNOWN_LAYOUT}
        convention={KeyboardConvention.Apple}
      />,
    );

    const group = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(group).toHaveTextContent('Press the key named below once on its own');
    expect(screen.getByRole('listitem')).toHaveTextContent(
      // In capitals `ß` is `SS`, two letters no keycap shows, so the character
      // itself stands here. The settings had a second naming rule that always
      // upper-cased, so a key's label and this line could disagree.
      'The key that types "ß": Brighten the interface',
    );
  });
});

describe('where focus goes in the shortcut table', () => {
  const id = commandId('view.theme-dark');

  /** The table with one command, bound or not, and what it ran. */
  function table(bound: boolean) {
    const { context } = buildShellContext();
    const profile = {
      ...context.shortcuts.get().profile,
      bindings: bound
        ? [{ commandId: id, shortcut: shortcut(keyPress('KeyG', { control: true })) }]
        : [],
    };
    const run = vi.fn();
    const element = (current: typeof profile) => (
      <Shortcuts
        askFor={() => undefined}
        profile={current}
        available={[current]}
        conflicts={[]}
        reserved={[]}
        waiting={[]}
        convention={context.convention}
        layout={UNKNOWN_LAYOUT}
        learnKey={() => undefined}
        commands={[{ id, label: 'Dark theme' }]}
        labelFor={() => 'Dark theme'}
        run={run}
        announce={() => undefined}
        unavailableReason={() => undefined}
      />
    );
    const rendered = render(element(profile));
    return {
      run,
      rerender: (next: typeof profile) => {
        rendered.rerender(element(next));
      },
      profile,
    };
  }

  const change = () => screen.getByRole('button', { name: 'Change the shortcut for Dark theme' });

  it.each(['Save', 'Cancel'])(
    'takes focus back to Change after %s, rather than to the top of the settings',
    async (button) => {
      // The recorder unmounts while its button holds focus, and the dialogue
      // then put focus on itself: a keyboard or screen-reader user started
      // again at the top rather than at the row they were working in.
      table(false);
      await userEvent.click(change());
      const field = screen.getByRole('textbox', { name: 'Shortcut for Dark theme' });
      fireEvent.keyDown(field, { code: 'KeyY', key: 'y', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' });

      await userEvent.click(screen.getByRole('button', { name: button }));

      expect(change()).toHaveFocus();
    },
  );

  it('takes focus back to Change after Remove, which takes itself away', async () => {
    const { rerender, profile } = table(true);
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove the shortcut for Dark theme' }),
    );
    rerender({ ...profile, bindings: [] });

    expect(change()).toHaveFocus();
  });

  it('passes on the request from the recorder to say an unchanged shortcut', async () => {
    // The recorder closes on Save, and a shortcut already the command's closed
    // it in silence: the request to say so is what makes it heard.
    const { run } = table(false);
    await userEvent.click(change());
    const field = screen.getByRole('textbox', { name: 'Shortcut for Dark theme' });
    fireEvent.keyDown(field, { code: 'KeyY', key: 'y', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(run).toHaveBeenCalledWith(
      'shortcuts.rebind',
      {
        commandId: id,
        shortcut: shortcutKey(shortcut(keyPress('KeyY', { control: true, shift: true }))),
      },
      { sayWhenUnchanged: true },
    );
  });
});
