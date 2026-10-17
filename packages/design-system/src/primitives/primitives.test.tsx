import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { Button } from './button.js';
import { NoticeProvider } from './announcement.js';
import { HintProvider } from './overlays/tooltips.js';
import { ControlBar, ControlBarButton, ControlBarItem, TabSet, ToggleSwitch } from './controls.js';
import { ValueSlider } from './value-slider.js';

/**
 * Renders inside a theme and the notices, as every AudioGubbins component is.
 * A dialogue shows a notice raised while it is open, so it needs the notices.
 */
function renderThemed(ui: ReactNode) {
  return render(
    <ThemeProvider
      preferences={DEFAULT_THEME_PREFERENCES}
      system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
    >
      <HintProvider>
        <NoticeProvider notice={undefined}>{ui}</NoticeProvider>
      </HintProvider>
    </ThemeProvider>,
  );
}

describe('Button', () => {
  it('is reachable and pressable by name', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Reset layout' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates from the keyboard', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names itself for a screen reader when it shows only an icon', () => {
    renderThemed(<Button iconOnly label="Play" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('does not submit the form it happens to sit in', () => {
    // A toolbar button that submits its surrounding form is a defect that only
    // appears once the form exists, so the type is explicit rather than
    // default.
    renderThemed(<Button>Zoom in</Button>);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('type', 'button');
  });

  it('is not pressable while disabled', async () => {
    const onClick = vi.fn();
    renderThemed(
      <Button onClick={onClick} disabled>
        Delete
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ValueSlider', () => {
  it('announces its value in the unit the user is working in', () => {
    // A bare number is useless on a logarithmic control: the user is thinking
    // in decibels, not in the position of a thumb.
    renderThemed(
      <ValueSlider
        label="Gain"
        value={-6}
        minimum={-60}
        maximum={12}
        step={0.1}
        onValueChange={vi.fn()}
        describeValue={(value) => `${value.toFixed(1)} decibels`}
        displayValue="-6.0 dB"
      />,
    );

    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute(
      'aria-valuetext',
      '-6.0 decibels',
    );
  });

  it('changes by one step from the keyboard', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={onValueChange}
        describeValue={(value) => `${String(value)} decibels`}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith(1);
  });

  it('moves along a scale, a keyboard step a step of the scale, settling at each', async () => {
    // Three decades from 10 to 10,000 in thirty steps: ten to a decade.
    const decades = {
      steps: 30,
      positionOf: (value: number) => Math.log10(value / 10) / 3,
      valueAt: (position: number) => 10 * 1000 ** position,
    };
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    renderThemed(
      <ValueSlider
        label="Frequency"
        value={100}
        minimum={10}
        maximum={10_000}
        scale={decades}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        describeValue={(value) => `${value.toFixed(0)} hertz`}
      />,
    );

    // A tenth of a decade up from 100 Hz.
    const slider = screen.getByRole('slider', { name: 'Frequency' });
    expect(slider).toHaveAttribute('aria-valuenow', '10');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange.mock.calls[0]?.[0]).toBeCloseTo(125.89, 2);
    expect(onValueCommit).toHaveBeenCalledOnce();
    expect(onValueCommit.mock.calls[0]?.[0]).toBeCloseTo(125.89, 2);
  });

  it('reports its range, so a screen reader can say where the value sits', () => {
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={vi.fn()}
        describeValue={String}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Gain' });
    expect(slider).toHaveAttribute('aria-valuemin', '-60');
    expect(slider).toHaveAttribute('aria-valuemax', '12');
  });
});

describe('ToggleSwitch', () => {
  it('is reachable by its label and reports its state', () => {
    renderThemed(<ToggleSwitch label="Diagnostic mode" checked onCheckedChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toBeChecked();
  });

  it('toggles from the keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <ToggleSwitch label="Diagnostic mode" checked={false} onCheckedChange={onCheckedChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('associates its description with the control', () => {
    renderThemed(
      <ToggleSwitch
        label="Diagnostic mode"
        description="Collects more detail for a limited period."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toHaveAccessibleDescription(
      'Collects more detail for a limited period.',
    );
  });
});

describe('TabSet', () => {
  it('names its tab list and shows only the selected panel', () => {
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={vi.fn()}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>Appearance settings</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>Shortcut settings</p> },
        ]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Appearance settings')).toBeInTheDocument();
    expect(screen.queryByText('Shortcut settings')).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={onValueChange}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>A</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>B</p> },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith('shortcuts');
  });
});

describe('ControlBar', () => {
  it('names itself, so a screen reader can say which toolbar this is', () => {
    renderThemed(
      <ControlBar label="Transport">
        <Button>Play</Button>
      </ControlBar>,
    );

    expect(screen.getByRole('toolbar', { name: 'Transport' })).toBeInTheDocument();
  });

  it('costs a keyboard user one Tab stop, not one per button', async () => {
    renderThemed(
      <>
        <ControlBar label="Transport">
          <ControlBarItem>
            <Button>Play</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Stop</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Record</Button>
          </ControlBarItem>
        </ControlBar>
        <Button>After the toolbar</Button>
      </>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After the toolbar' })).toHaveFocus();
  });

  it('moves between its buttons with the arrow keys', async () => {
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarItem>
          <Button>Play</Button>
        </ControlBarItem>
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('keeps a hinted button reachable, so one tooltip does not cost the toolbar its keyboard access', async () => {
    // A hint used to be wrapped around a toolbar item, which dropped the props
    // and the ref the toolbar gives its items. The toolbar then held an item
    // with no element behind it, and the first Tab threw instead of moving
    // focus, taking every button in the toolbar out of keyboard reach.
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" shortcut="Space" onPress={vi.fn()} />
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('runs a hinted button when it is pressed', async () => {
    const onPress = vi.fn();
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" onPress={onPress} />
      </ControlBar>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPress).toHaveBeenCalledOnce();
  });
});
