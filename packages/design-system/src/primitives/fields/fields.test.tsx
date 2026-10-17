import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { OptionSelect } from './option-select.js';
import { TextField } from './text-field.js';

describe('TextField', () => {
  it('points at something outside itself as well as at its own description', () => {
    // The export dialogue's note preview is drawn below the field and the
    // field's description named it: told to look below, a reader who could not
    // see the page had no way there.
    render(
      <>
        <TextField
          label="What happened?"
          description="Optional."
          describedBy="ag-preview"
          value=""
          onValueChange={() => undefined}
        />
        <p id="ag-preview">Your note will be carried as: something.</p>
      </>,
    );

    const field = screen.getByRole('textbox', { name: 'What happened?' });
    expect(field).toHaveAccessibleDescription('Optional. Your note will be carried as: something.');
  });

  it('stops the reader at the bound what reads the value has', () => {
    // Declared on the field rather than cut afterwards, so the reader is
    // stopped at the bound instead of losing words they have written. Every
    // redaction rule reads the note this is for, on the main thread, as they
    // type.
    render(
      <TextField
        label="What happened?"
        maxLength={4_000}
        value=""
        onValueChange={() => undefined}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'What happened?' })).toHaveAttribute(
      'maxlength',
      '4000',
    );
  });
});

describe('OptionSelect', () => {
  it('is reachable by its label and shows the current value', () => {
    renderThemed(
      <OptionSelect
        label="Accent colour"
        value="teal"
        options={[
          { value: 'blue', label: 'Blue' },
          { value: 'teal', label: 'Teal' },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Accent colour' })).toHaveTextContent('Teal');
  });

  it('chooses nothing from a letter typed at it while it is shut', async () => {
    // Every one of these runs a command as it changes, and a command is run
    // deliberately. Asked to press letter keys so the keyboard layout could be
    // learned, a user with focus here switched their shortcut profile instead.
    const chosen = vi.fn();
    renderThemed(
      <OptionSelect
        label="Shortcut profile"
        value="default"
        options={[
          { value: 'default', label: 'AudioGubbins default' },
          { value: 'mine', label: 'My shortcuts' },
        ]}
        onValueChange={chosen}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Shortcut profile' });
    trigger.focus();
    await userEvent.keyboard('m');

    expect(chosen).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('still opens from the keyboard, so the list is reachable', async () => {
    renderThemed(
      <OptionSelect
        label="Shortcut profile"
        value="default"
        options={[
          { value: 'default', label: 'AudioGubbins default' },
          { value: 'mine', label: 'My shortcuts' },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Shortcut profile' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('TextField, as the design language draws it', () => {
  it('says what is wrong with its value under it, and marks itself invalid', () => {
    renderThemed(
      <TextField
        label="Lead-in"
        value="-4"
        onValueChange={vi.fn()}
        unit="ms"
        error="A lead-in cannot be less than 0 ms."
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Lead-in' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('A lead-in cannot be less than 0 ms.');
    expect(screen.getByText('ms')).toBeInTheDocument();
  });

  it('tells the keyboard reaching it from a pointer pressing it, so only the keyboard draws the ring', async () => {
    renderThemed(<TextField label="Folder" value="audio" onValueChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Folder' });
    const box = input.closest('.ag-text-field-box');

    await userEvent.tab();
    expect(box).toHaveAttribute('data-ag-editing', 'keyboard');

    await userEvent.tab();
    expect(box).not.toHaveAttribute('data-ag-editing');

    await userEvent.click(input);
    expect(box).toHaveAttribute('data-ag-editing', 'pointer');
  });

  it('puts the caret in the text when its unit is pressed', async () => {
    renderThemed(<TextField label="Tail" value="50" onValueChange={vi.fn()} unit="ms" />);

    await userEvent.click(screen.getByText('ms'));

    expect(screen.getByRole('textbox', { name: 'Tail' })).toHaveFocus();
  });
});
