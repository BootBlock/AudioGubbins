import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { regionEntryId } from '../../assets/project-entry.js';
import { shellCommands } from '../../commands/shell-commands.js';
import type { ProjectWindow } from '../../testing/project-context.js';
import { DESCRIPTORS } from '../../testing/shell-context.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { InspectorPanel } from './inspector-panel.js';

holdPlatformFiles();

/** Each command's label, by its identifier, as the registry gives it. */
const LABELS: ReadonlyMap<string, string> = new Map(
  shellCommands(DESCRIPTORS).map((command) => [String(command.id), command.label]),
);

/**
 * Draws the Inspector over a window's stores, its controls running the
 * window's commands, and gives back what those commands refused.
 */
function inspectorOver(window: ProjectWindow): readonly string[] {
  const { context } = window;
  const refusals: string[] = [];
  render(
    <InspectorPanel
      title="Inspector"
      projects={window.projects}
      parts={{
        editorViews: context.editorViews,
        selections: context.selections,
        assets: context.assets,
        labelFor: (id) => LABELS.get(id) ?? id,
      }}
      commands={{
        run: (id, args) => {
          const ran = window.run(id, args);
          if (ran.kind === 'refused') refusals.push(ran.failures[0].summary);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return refusals;
}

/** The loop imported with a region "Intro" over its first second, open in the editor in use. */
async function loopInView(): Promise<AudioWindow> {
  const audio = await windowWithAudio({ regions: [{ name: 'Intro', start: 0, end: 48_000 }] });
  audio.window.context.editorViews.open('editor', audio.asset());
  audio.window.context.editorViews.focus('editor');
  return audio;
}

/** The project's one region. */
function regionOf(audio: AudioWindow) {
  const [region] = audio.session.getSnapshot().model.state.project.regions.values();
  if (region === undefined) throw new Error('No region was added.');
  return region;
}

/** Shows the region in the editor in use, as a view of its own. */
async function regionInView(audio: AudioWindow): Promise<void> {
  const entry = regionEntryId(regionOf(audio).id);
  await expect.poll(() => audio.window.context.assets.find(entry)).toBeDefined();
  audio.window.run('editor.open-asset', { view: 'editor', asset: entry });
}

/** The list of edits under the heading `heading`. */
function editsUnder(heading: string): HTMLElement {
  const list = screen.getByRole('heading', { name: heading }).nextElementSibling;
  if (!(list instanceof HTMLElement)) throw new Error(`Nothing follows ${heading}.`);
  return list;
}

describe('the Inspector panel (WU-05.D)', () => {
  it('says what to do where no editor shows audio', async () => {
    const audio = await windowWithAudio();
    inspectorOver(audio.window);

    expect(
      screen.getByText('Open audio in an editor to see its properties here.'),
    ).toBeInTheDocument();
  });

  it('states the asset’s source and the audio shape its reader found, with no edits', async () => {
    const audio = await loopInView();
    inspectorOver(audio.window);

    const facts = screen.getByRole('heading', { name: 'Asset: Loop' }).nextElementSibling;
    if (!(facts instanceof HTMLElement)) throw new Error('No facts follow the heading.');
    expect(
      within(facts)
        .getAllByRole('definition')
        .map((detail) => detail.textContent),
    ).toEqual([
      'Copied into the project',
      'Loop.wav',
      'WAV',
      '48 kHz',
      '16-bit integer, little-endian',
      '2 channels: Left, Right',
      '6.000 s, 288000 frames',
    ]);
    expect(screen.getByText('None. It plays as its source does.')).toBeInTheDocument();
  });

  it('changes the gain by the decibels typed, through the gain command, and lists the edit', async () => {
    const audio = await loopInView();
    inspectorOver(audio.window);
    const user = userEvent.setup();

    const field = screen.getByRole('textbox', { name: 'Gain in decibels' });
    await user.clear(field);
    await user.type(field, '-6');
    await user.click(screen.getByRole('button', { name: 'Change the gain' }));

    await expect.poll(() => editsUnder('Its edits').textContent).toMatch(/^Gain of −6 dB, from /u);
    await expect.poll(() => audio.window.said).toContain('Gain of -6 dB on all of Loop.');
  });

  it('asks for a number where the gain field is empty, rather than making a gain of 0 dB', async () => {
    const audio = await loopInView();
    const refusals = inspectorOver(audio.window);
    const user = userEvent.setup();

    await user.clear(screen.getByRole('textbox', { name: 'Gain in decibels' }));
    await user.click(screen.getByRole('button', { name: 'Change the gain' }));

    expect(refusals).toEqual(['Say how many decibels to change the gain by.']);
    expect(
      audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits,
    ).toEqual([]);
  });

  it('fades with the shape chosen', async () => {
    const audio = await loopInView();
    inspectorOver(audio.window);
    const user = userEvent.setup();

    screen.getByRole('combobox', { name: 'Fade shape' }).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('option', { name: 'Equal power' }));
    await user.click(screen.getByRole('button', { name: 'Fade out' }));

    await expect
      .poll(() => editsUnder('Its edits').textContent)
      .toMatch(/^Fade out, equal power, from /u);
  });

  it('shows the one region selected in a view of its asset, and asks for a view of its own to loop it', async () => {
    const audio = await loopInView();
    const region = regionOf(audio);
    audio.window.context.selections.change(audio.entry, () => ({
      objects: { kind: 'regions', ids: [region.id] },
      recency: ['objects'],
    }));
    inspectorOver(audio.window);

    expect(screen.getByRole('heading', { name: 'Region: Intro' })).toBeInTheDocument();
    expect(
      screen.getByText('Open the region in a view of its own to loop a part of it.'),
    ).toBeInTheDocument();
  });

  it('names the channels each edit changed by the layout it was made on', async () => {
    const audio = await loopInView();
    await regionInView(audio);
    await audio.window.runAndHear('edit.swap-channels');
    // Made on the asset from the region's view, between the region's two swaps.
    await audio.window.runAndHear('edit.convert-layout', { layout: 'surround5_1' });
    await audio.window.runAndHear('edit.swap-channels', {
      first: 'Centre',
      second: 'Surround left',
    });
    inspectorOver(audio.window);

    const swaps = within(editsUnder('Its own processing'))
      .getAllByRole('listitem')
      .map((item) => item.textContent.replace(/, from .*$/u, ''));
    expect(swaps).toEqual(['Swapped Left and Right', 'Swapped Centre and Surround left']);
  });

  it('renames and tags the region through its commands, and follows an undo', async () => {
    const audio = await loopInView();
    await regionInView(audio);
    inspectorOver(audio.window);
    const user = userEvent.setup();

    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Opening{Enter}');
    expect(await screen.findByRole('heading', { name: 'Region: Opening' })).toBeInTheDocument();
    // The same field, still where the person was typing.
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(name);
    expect(name).toHaveFocus();
    const tags = screen.getByRole('textbox', { name: 'Tags, separated by commas' });
    await user.type(tags, 'gravel, footstep{Enter}');
    await expect.poll(() => regionOf(audio).tags).toEqual(['footstep', 'gravel']);
    expect(tags).toHaveValue('footstep, gravel');
    expect(tags).toHaveFocus();

    await audio.window.runAndHear('edit.undo');
    await audio.window.runAndHear('edit.undo');

    expect(await screen.findByRole('heading', { name: 'Region: Intro' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Intro');
  });

  it('loops the region shown over the selection with the crossfade typed, and stops it', async () => {
    const audio = await loopInView();
    await regionInView(audio);
    audio.window.run('editor.select-time', { start: 12_000, end: 36_000 });
    inspectorOver(audio.window);
    const user = userEvent.setup();

    const crossfade = screen.getByRole('textbox', { name: 'Crossfade in frames' });
    await user.clear(crossfade);
    await user.type(crossfade, '480{Enter}');

    expect(
      await screen.findByText(
        /^It loops between .* of the region, with a crossfade of 480 frames\.$/u,
      ),
    ).toBeInTheDocument();
    expect(regionOf(audio).loop).toMatchObject({
      start: 12_000,
      end: 36_000,
      crossfadeLength: 480,
    });
    const stop = screen.getByRole('button', { name: 'Stop the region looping' });
    await user.click(stop);
    expect(await screen.findByText('It does not loop.')).toBeInTheDocument();
    // Kept, saying why it cannot be pressed now, so the focus stays on it.
    expect(stop).toHaveFocus();
    expect(stop).toHaveAttribute('aria-disabled', 'true');
    expect(stop).toHaveAccessibleDescription('Intro does not loop.');
  });

  it('never shows a name typed for one region as another’s of the same name', async () => {
    const audio = await windowWithAudio({
      regions: [
        { name: 'Intro', start: 0, end: 48_000 },
        { name: 'Intro', start: 96_000, end: 144_000 },
      ],
    });
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');
    const [first, second] = audio.session.getSnapshot().model.state.project.regions.values();
    if (first === undefined || second === undefined) throw new Error('No regions were added.');
    const select = (id: typeof first.id): void => {
      audio.window.context.selections.change(audio.entry, () => ({
        objects: { kind: 'regions', ids: [id] },
        recency: ['objects'],
      }));
    };
    select(first.id);
    inspectorOver(audio.window);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' draft');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Intro draft');
    act(() => {
      select(second.id);
    });

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Intro');
  });

  it('says audio of the session keeps no edits', async () => {
    const audio = await windowWithAudio();
    audio.window.run('editor.open-asset', { view: 'editor', asset: 'test:loop' });
    inspectorOver(audio.window);

    expect(
      screen.getByText(
        'It is not part of the project, so it keeps no edits. Import a file to edit it.',
      ),
    ).toBeInTheDocument();
  });
});
