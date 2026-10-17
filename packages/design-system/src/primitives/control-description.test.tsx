import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { renderThemed } from '../testing/render-themed.js';
import { Check } from './buttons/check.js';
import { RadioGroup } from './buttons/radio-group.js';
import { ToggleSwitch } from './buttons/toggle-switch.js';
import type { ControlDescription } from './control-description.js';
import { OptionSelect } from './fields/option-select.js';
import { TextField } from './fields/text-field.js';
import { ValueSlider } from './value-slider.js';

const TEXT = 'What is monitored is never recorded.';

const HINTED: ControlDescription = { hintLabel: 'About monitoring', text: TEXT };

/** Each control that takes a description, drawn with one, and the role it is found by. */
const CONTROLS: readonly (readonly [
  name: string,
  role: string,
  draw: (description: ControlDescription) => ReactNode,
])[] = [
  [
    'ToggleSwitch',
    'switch',
    (description) => (
      <ToggleSwitch
        label="Monitoring"
        description={description}
        checked={false}
        onCheckedChange={vi.fn()}
      />
    ),
  ],
  [
    'Check',
    'checkbox',
    (description) => (
      <Check label="Monitoring" description={description} checked onCheckedChange={vi.fn()} />
    ),
  ],
  [
    'RadioGroup',
    'radio',
    (description) => (
      <RadioGroup
        label="Input"
        value="monitoring"
        options={[{ value: 'monitoring', label: 'Monitoring', description }]}
        onValueChange={vi.fn()}
      />
    ),
  ],
  [
    'OptionSelect',
    'combobox',
    (description) => (
      <OptionSelect
        label="Monitoring"
        description={description}
        value="on"
        options={[{ value: 'on', label: 'On' }]}
        onValueChange={vi.fn()}
      />
    ),
  ],
  [
    'ValueSlider',
    'slider',
    (description) => (
      <ValueSlider
        label="Monitoring"
        description={description}
        value={0}
        minimum={0}
        maximum={1}
        step={0.1}
        onValueChange={vi.fn()}
        describeValue={String}
      />
    ),
  ],
  [
    'TextField',
    'textbox',
    (description) => (
      <TextField label="Monitoring" description={description} value="" onValueChange={vi.fn()} />
    ),
  ],
];

describe('a control’s description', () => {
  it.each(CONTROLS)('%s keeps it standing under the label by default', (_name, role, draw) => {
    renderThemed(draw(TEXT));

    expect(screen.getByRole(role)).toHaveAccessibleDescription(TEXT);
    expect(screen.getByText(TEXT)).not.toHaveClass('ag-visually-hidden');
    expect(screen.queryByRole('button', { name: 'About monitoring' })).toBeNull();
  });

  it.each(CONTROLS)(
    '%s keeps it behind an (i) when asked, still describing the control',
    async (_name, role, draw) => {
      // Text economy takes the words off the page, never from what a reader
      // who cannot see it is told as focus reaches the control.
      renderThemed(draw(HINTED));

      const control = screen.getByRole(role);
      expect(control).toHaveAccessibleDescription(TEXT);
      expect(screen.getByText(TEXT)).toHaveClass('ag-visually-hidden');

      const hint = screen.getByRole('button', { name: 'About monitoring' });
      // Beside the control, never inside it: inside a radio or a label, a
      // press on the (i) would make the choice too.
      expect(control).not.toContainElement(hint);
      await userEvent.click(hint);
      expect(await screen.findByRole('dialog', { name: 'About monitoring' })).toHaveTextContent(
        TEXT,
      );
    },
  );

  it('leaves a check as it was when its (i) is pressed', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <Check
        label="Monitoring"
        description={HINTED}
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'About monitoring' }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('a label kept for a screen reader alone', () => {
  it.each([
    [
      'OptionSelect',
      'combobox',
      <OptionSelect
        key="select"
        label="Shortcut profile"
        labelHidden
        value="default"
        options={[{ value: 'default', label: 'Default' }]}
        onValueChange={vi.fn()}
      />,
    ],
    [
      'ValueSlider',
      'slider',
      <ValueSlider
        key="slider"
        label="Shortcut profile"
        labelHidden
        value={0}
        minimum={0}
        maximum={1}
        step={1}
        onValueChange={vi.fn()}
        describeValue={String}
      />,
    ],
    [
      'TextField',
      'textbox',
      <TextField
        key="field"
        label="Shortcut profile"
        labelHidden
        value=""
        onValueChange={vi.fn()}
      />,
    ],
  ] as const)('%s is still named by it', (_name, role, control) => {
    renderThemed(control);

    expect(screen.getByRole(role, { name: 'Shortcut profile' })).toBeInTheDocument();
    expect(screen.getByText('Shortcut profile').closest('.ag-visually-hidden')).not.toBeNull();
  });
});

describe('a slider’s visible label', () => {
  it('may be shorter than the name a screen reader says', () => {
    // A row of sliders has room for "Mix"; the reader who cannot see the row
    // is told which mix.
    renderThemed(
      <ValueSlider
        label="Mix of the reverb"
        visibleLabel="Mix"
        value={0.5}
        minimum={0}
        maximum={1}
        step={0.01}
        onValueChange={vi.fn()}
        describeValue={String}
      />,
    );

    expect(screen.getByRole('slider', { name: 'Mix of the reverb' })).toBeInTheDocument();
    expect(screen.getByText('Mix')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Mix of the reverb')).toHaveClass('ag-visually-hidden');
  });
});
