import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';

import type { ModelGate } from '../../assets/model-gate.js';
import type { VoicedOptions } from '../../commands/voiced-execution.js';
import { observable } from '../../state/observable.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { SpectralPanel } from './spectral-panel.js';

holdPlatformFiles();

type Ran = (readonly [string, CommandInvocation['arguments']])[];

/** The commands a control asked to be spoken of other than as usual, and how. */
type Voiced = (readonly [string, VoicedOptions])[];

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
 * window's commands, every one recorded, and those run with options in
 * `voiced` as well.
 */
function panelOver(
  audio: AudioWindow,
  gate: ModelGate = () => undefined,
  voiced: Voiced = [],
): Ran {
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
        run: (id, args, options) => {
          ran.push([id, args]);
          if (options !== undefined) voiced.push([id, options]);
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

  it('chooses how a shape drawn with no modifier joins the area, for a finger or a pen', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio);
    const modes = screen.getByRole('group', { name: 'Combination mode' });

    expect(within(modes).getByRole('button', { name: 'Replace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(modes).getByRole('button', { name: 'Take away' }));

    expect(ran).toEqual([['editor.spectral-combination-subtract', { view: 'editor' }]]);
    expect(within(modes).getByRole('button', { name: 'Take away' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(modes).getByRole('button', { name: 'Replace' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('adds a band of the time selection to the area, and takes one from it', async () => {
    const audio = await selectedLoop();
    audio.window.run('editor.select-time', { start: 100_000, end: 120_000 });
    const ran = panelOver(audio);

    await userEvent.click(
      screen.getByRole('button', { name: 'Add the band of the time selection' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Take the band of the time selection away' }),
    );

    expect(ran).toEqual([
      ['editor.add-spectral-band', { view: 'editor' }],
      ['editor.subtract-spectral-band', { view: 'editor' }],
    ]);
    expect(
      audio.window.context.selections
        .of(audio.asset().id)
        .spectral?.shapes.map((shape) => shape.effect),
    ).toEqual(['add', 'add', 'subtract']);
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

  it('has its comparisons say so when the edit is being compared already, which it does not show', async () => {
    const audio = await selectedLoop();
    const voiced: Voiced = [];
    panelOver(audio, () => undefined, voiced);
    await audio.window.runAndHear('spectral.attenuate', { view: 'editor' });

    await userEvent.click(await screen.findByRole('button', { name: 'Compare with before it' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Compare with before the latest spectral edit' }),
    );

    expect(voiced).toEqual([
      ['spectral.compare-before-edit', { sayWhenUnchanged: true }],
      ['spectral.compare-before-edit', { sayWhenUnchanged: true }],
    ]);
  });

  it('says before cleaning up that a processor whose model cannot run will not be heard, and then cleans up knowingly', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio, (processor) =>
      processor.typeKey === 'deepfilternet-3' ? 'Its model is not installed.' : undefined,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clean up' }));
    const runnable = ran.at(-1);

    screen.getByRole('combobox', { name: 'Clean up with' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('option', { name: 'DeepFilterNet 3' }));

    expect(
      screen.getByText(
        'It can be applied, but it is not heard until it can run: Its model is not installed.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clean up anyway' }));

    expect(runnable?.[1]).not.toHaveProperty('knowingly');
    expect(ran.at(-1)).toEqual([
      'spectral.process',
      { view: 'editor', resolution: 2048, typeKey: 'deepfilternet-3', knowingly: true },
    ]);
  });

  it('compares each spectral edit listed with before it, naming the edit', async () => {
    const audio = await selectedLoop();
    await audio.window.runAndHear('spectral.heal');
    await audio.window.runAndHear('spectral.remove');
    const edits =
      audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits ?? [];
    const ran = panelOver(audio);

    const buttons = screen.getAllByRole('button', { name: 'Compare with before it' });
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    if (first === undefined) throw new Error('No edit is listed.');
    await userEvent.click(first);

    expect(ran.at(-1)).toEqual([
      'spectral.compare-before-edit',
      { view: 'editor', operationId: edits[0]?.id },
    ]);
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

  it('says how the spectrogram is analysed and drawn, and changes it through its commands', async () => {
    const audio = await selectedLoop();
    const ran = panelOver(audio);

    expect(
      screen.getByText(
        'The spectrogram analyses windows of 2,048 samples through the Blackman–Harris window, overlapping 4 times.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('The spectrogram’s colours span -120 to 0 dBFS.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Longer windows' }));
    await userEvent.click(screen.getByRole('button', { name: 'Raise floor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Greys' }));

    expect(ran).toEqual([
      ['editor.spectrogram-window-longer', { view: 'editor' }],
      ['editor.spectrogram-floor-raise', { view: 'editor' }],
      ['editor.spectrogram-colours-greyscale', { view: 'editor' }],
    ]);
    expect(
      screen.getByText(
        'The spectrogram analyses windows of 4,096 samples through the Blackman–Harris window, overlapping 4 times.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('The spectrogram’s colours span -114 to 0 dBFS.')).toBeInTheDocument();
    expect(screen.getByText('The spectrogram is drawn in greys.')).toBeInTheDocument();
  });
});
