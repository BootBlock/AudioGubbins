import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';

import type { ModelGate } from '../../assets/model-gate.js';
import { observable } from '../../state/observable.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { SpectralPanel } from './spectral-panel.js';

holdPlatformFiles();

type Ran = (readonly [string, CommandInvocation['arguments']])[];

/** The loop in the editor in use, its spectral selection a rectangle on its right channel. */
async function selectedLoop(): Promise<AudioWindow> {
  const audio = await windowWithAudio();
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', 1000, audio.asset().length);
  context.editorViews.focus('editor');
  audio.window.run('editor.time-format-samples');
  audio.window.run('editor.select-spectral', {
    mask: JSON.stringify({
      shapes: [
        {
          kind: 'rectangle',
          effect: 'add',
          range: { start: 48_000, end: 96_000 },
          band: { low: 300, high: 2_000 },
        },
      ],
      feather: { time: 0, frequency: 0 },
    }),
    combination: 'replace',
    channels: '1',
  });
  return audio;
}

/**
 * Draws the panel over the window's stores, its controls running the
 * window's commands, every one recorded.
 */
function panelOver(audio: AudioWindow, gate: ModelGate = () => undefined): Ran {
  const { context, projects } = audio.window;
  const ran: Ran = [];
  render(
    <SpectralPanel
      title="Spectral"
      context={{
        projects,
        editor: {
          stores: { editorViews: context.editorViews, selections: context.selections },
          assets: context.assets,
        },
        modelGate: observable(gate),
        hearing: context.hearing,
        preferences: context.preferences,
        run: (id, args) => {
          ran.push([id, args]);
          audio.window.run(id, args);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return ran;
}

// Each test imports audio and runs its storage worker in the test's own
// thread, which takes seconds under the whole suite's load.
describe('the Spectral panel', { timeout: 30_000 }, () => {
  it('says the spectral selection in words, and follows a change made from its buttons', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio);

    expect(
      screen.getByText(/^An area from 48,000 to 96,000, 300 Hz to 2 kHz, on channel Right\./u),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(ran).toEqual([['editor.clear-spectral-selection', { view: 'editor' }]]);
    expect(screen.getByText('No area of time and frequency is selected.')).toBeInTheDocument();
  });

  it('attenuates by the decibels typed at the resolution chosen, and lists the edit made', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio);

    const field = screen.getByRole('textbox', { name: 'Attenuate by, in decibels' });
    await userEvent.clear(field);
    await userEvent.type(field, '-6');
    screen.getByRole('combobox', { name: 'Analysed in frames of' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('option', { name: '1,024 samples' }));
    await userEvent.click(screen.getByRole('button', { name: 'Attenuate' }));

    expect(ran.at(-1)).toEqual([
      'spectral.attenuate',
      { view: 'editor', resolution: 1024, decibels: -6 },
    ]);
    await expect
      .poll(() => screen.queryByText(/^Attenuated an area by −6 dB, 48,000 to 96,000, /u) !== null)
      .toBe(true);
  });

  it('says before cleaning up that a processor whose model cannot run will not be heard', async () => {
    const audio = await selectedLoop();
    panelOver(audio, (processor) =>
      processor.typeKey === 'deepfilternet-3' ? 'Its model is not installed.' : undefined,
    );

    screen.getByRole('combobox', { name: 'Clean up with' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('option', { name: 'DeepFilterNet 3' }));

    expect(
      screen.getByText(
        'It can be applied, but it is not heard until it can run: Its model is not installed.',
      ),
    ).toBeInTheDocument();
  });

  it('turns pen pressure off through its command, shown in the brush’s strength', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio);

    await userEvent.click(
      screen.getByRole('switch', { name: 'Let pen pressure set the strength' }),
    );

    expect(ran).toEqual([['tools.use-fixed-strength', undefined]]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole('switch', { name: 'Let pen pressure set the strength' }),
    ).not.toBeChecked();
  });
});
