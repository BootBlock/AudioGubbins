import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { commandId } from '@audiogubbins/commands';

import type { ShellContext } from '../../commands/shell-context.js';
import { busOfShellCommands, reasonsIn } from '../../testing/command-availability.js';
import { rememberInput } from '../../state/recording-settings.js';
import { listedInput } from '../../testing/recording-fakes.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { everythingQueued } from '../../testing/waiting.js';
import { RecordingInput } from './recording-input.js';

/**
 * The section over `context`'s settings, drawn again as they change, as the
 * Audio settings draw it, and every command it ran.
 */
function sectionOver(context: ShellContext) {
  const bus = busOfShellCommands();
  const ran: string[] = [];
  function Section(): ReactNode {
    const settings = useSyncExternalStore(
      context.audioSettings.subscribe,
      context.audioSettings.get,
    );
    return (
      <RecordingInput
        settings={settings.recording}
        recording={context.recording}
        run={(id, args) => {
          ran.push(id);
          return (
            bus.execute(context, {
              commandId: commandId(id),
              ...(args === undefined ? {} : { arguments: args }),
            }).kind !== 'refused'
          );
        }}
        unavailableReason={reasonsIn(context)}
      />
    );
  }
  return { ran, view: render(<Section />) };
}

/** Lets what showing the section asked of the browser answer. */
async function answered(): Promise<void> {
  await act(async () => {
    await everythingQueued();
  });
}

describe("the Audio settings' recording input", () => {
  it('watches the inputs while shown, and opens none', async () => {
    const { context, recording } = buildShellContext();
    const { view } = sectionOver(context);
    await answered();
    expect(recording.media.watched()).toBe(true);
    expect(recording.media.requests).toEqual([]);
    view.unmount();
    expect(recording.media.watched()).toBe(false);
  });

  it('lists the inputs by name, and chooses one only by its command, remembering it', async () => {
    const { context, recording } = buildShellContext();
    recording.media.devices = [
      listedInput('interface', 'Studio interface'),
      listedInput('desk', 'Desk microphone'),
    ];
    const { ran } = sectionOver(context);
    await answered();
    const group = screen.getByRole('group', { name: 'Recording input' });
    const chooser = within(group).getByRole('combobox', { name: 'Input' });
    chooser.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('option', { name: 'Desk microphone' }));
    expect(ran).toEqual(['recording.choose-input']);
    expect(context.audioSettings.get().recording.input?.id).toBe('desk');
  });

  it("names the browser's default input, and the permission, where none is listed", async () => {
    const { context, recording } = buildShellContext();
    recording.media.devices = [];
    sectionOver(context);
    await answered();
    expect(screen.getByText("Input: The browser's default input.")).toBeInTheDocument();
    expect(
      screen.getByText('The browser asks for the microphone when you first arm an input.'),
    ).toBeInTheDocument();
  });

  it('discloses what the profile asks for, and what this browser offers no control of', async () => {
    const { context } = buildShellContext();
    sectionOver(context);
    await answered();
    await userEvent.click(screen.getByText('What Raw/Studio asks the browser for'));
    expect(screen.getByText('Echo cancellation: off')).toBeVisible();
    expect(
      screen.getByText('Voice isolation: off, which this browser offers no control of'),
    ).toBeVisible();
  });

  it('keeps the seconds before Record only by its command, with the seconds given', async () => {
    const { context } = buildShellContext();
    const { ran } = sectionOver(context);
    await answered();
    await userEvent.click(screen.getByRole('switch', { name: 'Keep the seconds before Record' }));
    expect(ran).toEqual(['recording.set-retrospective']);
    expect(context.audioSettings.get().recording.retrospective).toEqual({ on: true, seconds: 10 });
  });

  it('lets monitoring start by itself only with a profile marked as used with headphones', async () => {
    const { context } = buildShellContext();
    context.audioSettings.reviseRecording(
      rememberInput({ id: 'interface', label: 'Studio interface' }),
    );
    sectionOver(context);
    await answered();
    const automatic = screen.getByRole('switch', {
      name: 'Start monitoring by itself with this input and profile',
    });
    expect(automatic).toBeDisabled();
    expect(
      screen.getByText(
        'Only a profile used with headphones starts monitoring by itself; mark the profile first.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('switch', { name: 'Raw/Studio is used with headphones' }),
    );
    expect(
      screen.getByRole('switch', {
        name: 'Start monitoring by itself with this input and profile',
      }),
    ).toBeEnabled();
  });
});
