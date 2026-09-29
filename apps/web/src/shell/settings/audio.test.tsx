import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { commandId } from '@audiogubbins/commands';
import { PRESET_SETTINGS, PerformanceProfile, SchedulingPolicy } from '@audiogubbins/audio-engine';

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
  return <Audio settings={settings} run={runnerFor(context)} />;
}

function field(name: string): HTMLElement {
  return screen.getByRole('textbox', { name });
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
