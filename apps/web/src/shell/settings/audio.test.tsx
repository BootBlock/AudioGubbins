import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { commandId } from '@audiogubbins/commands';
import { PRESET_SETTINGS, PerformanceProfile, SchedulingPolicy } from '@audiogubbins/audio-engine';
import { MAXIMUM_QUALITY, QualityLevel, namedQualityMode } from '@audiogubbins/domain';

import type { ShellContext } from '../../commands/shell-context.js';
import { busOfShellCommands } from '../../testing/command-availability.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { Audio } from './audio.js';
import type { RunCommand } from './section.js';

const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];

/** Runs the shell's own commands against a context, answering whether one ran. */
function runnerFor(context: ShellContext): RunCommand {
  const bus = busOfShellCommands();
  return (id, args) =>
    bus.execute(context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    }).kind !== 'refused';
}

/** The section over the context's settings, drawn again as they change, as the dialogue draws it. */
function Section({ context }: { readonly context: ShellContext }): ReactNode {
  const settings = useSyncExternalStore(context.audioSettings.subscribe, context.audioSettings.get);
  return (
    <Audio
      settings={settings}
      run={runnerFor(context)}
      recording={context.recording}
      unavailableReason={() => undefined}
    />
  );
}

function field(name: string): HTMLElement {
  return screen.getByRole('textbox', { name });
}

/** The select called `name` within the group `group`. */
function select(group: string, name: string): HTMLElement {
  return within(screen.getByRole('group', { name: group })).getByRole('combobox', { name });
}

/** Opens the select called `name` within `group` from the keyboard, and picks `option`. */
async function choose(group: string, name: string, option: string): Promise<void> {
  const trigger = select(group, name);
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('option', { name: option }));
}

describe('the audio settings', () => {
  it('offers every profile, Custom among them, and shows the one in force', () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    const profile = screen.getByRole('combobox', { name: 'Performance profile' });
    expect(profile).toHaveTextContent('Balanced');
    act(() => {
      context.audioSettings.chooseProfile(PerformanceProfile.Custom);
    });
    expect(profile).toHaveTextContent('Custom');
  });

  it('applies the Custom settings typed, through the command, and shows them applied', () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    fireEvent.change(field('Audio kept ready ahead of playback, in milliseconds'), {
      target: { value: '750' },
    });
    fireEvent.change(field('Render chunk length, in milliseconds'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply the Custom settings' }));

    expect(context.audioSettings.get().custom).toEqual({
      ...BALANCED,
      feedAheadMilliseconds: 750,
      renderChunkMilliseconds: 125,
    });
    expect(field('Audio kept ready ahead of playback, in milliseconds')).toHaveValue('750');
  });

  it('applies a latency in milliseconds as the seconds the engine takes', () => {
    const { context } = buildShellContext();
    context.audioSettings.setCustom({ ...BALANCED, latencyHint: 0.02 });
    render(<Section context={context} />);

    const latency = field('Output latency, in milliseconds');
    expect(latency).toHaveValue('20');
    fireEvent.change(latency, { target: { value: '35' } });
    fireEvent.keyDown(latency, { key: 'Enter' });

    expect(context.audioSettings.get().custom.latencyHint).toBe(0.035);
  });

  it('keeps what was typed when the settings are refused, and changes nothing', () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    fireEvent.change(field('Background jobs at once while playing or editing'), {
      target: { value: 'lots' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply the Custom settings' }));

    expect(context.audioSettings.get().custom).toBe(BALANCED);
    expect(field('Background jobs at once while playing or editing')).toHaveValue('lots');

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(field('Background jobs at once while playing or editing')).toHaveValue('2');
  });

  it('shows the background priority and the render mode in force', () => {
    const { context } = buildShellContext();
    context.audioSettings.choosePriorityPolicy(SchedulingPolicy.Throughput);
    render(<Section context={context} />);

    expect(screen.getByRole('combobox', { name: 'Background priority' })).toHaveTextContent(
      'Background work as fast as possible',
    );
    expect(screen.getByRole('combobox', { name: 'Render mode' })).toHaveTextContent('Automatic');
  });
});

describe('the quality settings', () => {
  it('shows the render quality and every value it sets', () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    expect(select('Render quality', 'Render quality level')).toHaveTextContent('Maximum');
    expect(select('Render quality', 'Resampling')).toHaveTextContent('Maximum');
    expect(select('Render quality', 'Oversampling')).toHaveTextContent('8 times');
    expect(select('Render quality', 'Spectral overlap')).toHaveTextContent('8 frames');
  });

  it('shows the preview following the profile, with the values the profile previews at', () => {
    const { context } = buildShellContext();
    context.audioSettings.chooseProfile(PerformanceProfile.LowLatency);
    render(<Section context={context} />);

    expect(select('Preview quality', 'Preview quality level')).toHaveTextContent('Automatic');
    expect(select('Preview quality', 'Resampling')).toHaveTextContent('Draft');
    expect(select('Preview quality', 'Oversampling')).toHaveTextContent('None');
  });

  it('chooses a level through its command', async () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    await choose('Render quality', 'Render quality level', 'Draft');
    await choose('Preview quality', 'Preview quality level', 'High');

    expect(context.audioSettings.get().renderQuality.level).toBe(QualityLevel.Draft);
    expect(context.audioSettings.get().previewQuality).toEqual(namedQualityMode(QualityLevel.High));
  });

  it('sets one value through the Custom command, keeping the others, and shows Custom', async () => {
    const { context } = buildShellContext();
    render(<Section context={context} />);

    await choose('Render quality', 'Oversampling', '4 times');

    expect(context.audioSettings.get().renderQuality).toEqual({
      level: QualityLevel.Custom,
      settings: { ...MAXIMUM_QUALITY.settings, oversampling: 4 },
    });
    expect(select('Render quality', 'Render quality level')).toHaveTextContent('Custom');
  });
});
