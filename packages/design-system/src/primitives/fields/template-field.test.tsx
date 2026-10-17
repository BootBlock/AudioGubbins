import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { renderThemed } from '../../testing/render-themed.js';
import { TextField } from './text-field.js';
import type { TemplateVocabulary } from './template-vocabulary.js';

/**
 * The template field: the text field given a vocabulary of tokens, which it
 * highlights where they are written, lists to insert at the caret, and
 * explains on hover.
 */

const NAMING: TemplateVocabulary = {
  tokens: [
    {
      name: 'asset',
      summary: 'The sound’s name',
      description: <p>The name the sound has in the project.</p>,
      modifiers: new Set(['snake']),
    },
    {
      name: 'number',
      summary: 'Its place in the group',
      description: <p>Counts the sounds in the group from 1.</p>,
      examples: ['step_007 for the seventh sound'],
    },
    { name: 'date', summary: 'The day you export', description: <p>The date, as you export.</p> },
  ],
  insertLabel: 'Insert a token',
  braceHelp: 'To write a brace itself, type it twice.',
  explain: (problem) => ({
    title: 'Not a token',
    body: <p>{problem.kind === 'unknown-token' ? `{${problem.name}} is not a token.` : 'No.'}</p>,
  }),
};

/** A template field holding its own value, as a dialogue holds one. */
function Naming({ initial, template = true }: { initial: string; template?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <TextField
      label="Naming"
      value={value}
      onValueChange={setValue}
      {...(template ? { template: NAMING } : {})}
    />
  );
}

/** The field's input. */
function field(): HTMLInputElement {
  const input = screen.getByRole('textbox', { name: 'Naming' });
  if (!(input instanceof HTMLInputElement)) throw new Error('The field is not an input.');
  return input;
}

/** The highlighting drawn under the field's text. */
function highlighted(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ag-template-mirror [data-ag-segment]')];
}

describe('the template field', () => {
  it('highlights each token where it is written, its modifier apart and an unknown one marked', () => {
    renderThemed(<Naming initial="{asset:snake}_{take}" />);

    const [known, unknown] = highlighted();
    expect(known).toHaveTextContent('{asset:snake}');
    expect(known?.querySelector('.ag-template-modifier')).toHaveTextContent(':snake');
    expect(known).not.toHaveAttribute('data-ag-problem');
    expect(unknown).toHaveTextContent('{take}');
    expect(unknown).toHaveAttribute('data-ag-problem', 'unknown-token');
  });

  it('draws nothing over a plain text field', () => {
    renderThemed(<Naming initial="{asset}" template={false} />);

    expect(document.querySelector('.ag-template-mirror')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Insert a token' })).toBeNull();
  });

  it('opens its token list from a key, inserts the chosen token at the caret, and returns there', async () => {
    renderThemed(<Naming initial="ab" />);
    await userEvent.click(field());
    field().setSelectionRange(1, 1);

    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await screen.findByRole('menu', { name: 'Insert a token' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(field()).toHaveFocus();
    });
    expect(field()).toHaveValue('a{number}b');
    expect(field().selectionStart).toBe('a{number}'.length);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('describes the highlighted token in full, and closes on Escape with the caret where it was', async () => {
    renderThemed(<Naming initial="abc" />);
    await userEvent.click(field());
    field().setSelectionRange(2, 2);

    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await screen.findByRole('menu', { name: 'Insert a token' });
    await userEvent.keyboard('{ArrowDown}');

    const row = screen.getByRole('menuitem', { name: /Its place in the group/ });
    expect(row).toHaveFocus();
    expect(row).toHaveAccessibleDescription(/Counts the sounds in the group from 1/);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(field()).toHaveFocus();
    });
    expect(field()).toHaveValue('abc');
    expect(field().selectionStart).toBe(2);
  });

  it('opens its token list from the braces button inside the field', async () => {
    // From the keyboard, for the reason `overlays.test.tsx` gives: under jsdom
    // a pointer opens a menu once per file.
    renderThemed(<Naming initial="" />);

    screen.getByRole('button', { name: 'Insert a token' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: /The day you export/ })).toBeInTheDocument();
  });

  it('explains the token under the pointer, and says why an unknown one is red', () => {
    // Each token is drawn a hundred pixels on from the one before, so a point
    // along the line falls in one of them.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = Number(this.dataset['agSegment'] ?? -1);
      return DOMRect.fromRect({ x: index * 100, y: 0, width: 80, height: 20 });
    });
    renderThemed(<Naming initial="{asset}_{take}" />);

    fireEvent.pointerMove(field(), { clientX: 210 });

    expect(screen.getByText('Not a token')).toBeInTheDocument();
    expect(screen.getByText('{take} is not a token.')).toBeInTheDocument();
    expect(highlighted()[1]).toHaveAttribute('data-ag-hovered');

    fireEvent.pointerMove(field(), { clientX: 10 });

    expect(screen.queryByText('Not a token')).toBeNull();
    expect(screen.getByText('The name the sound has in the project.')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
