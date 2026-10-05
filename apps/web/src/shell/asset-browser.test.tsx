import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { PageFile } from '@audiogubbins/storage-runtime';
import { sine, wavFile } from '@audiogubbins/test-fixtures';

import { regionEntryId } from '../assets/project-assets.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { AssetBrowserPanel } from './asset-browser.js';

holdPlatformFiles();

/** The labels of the import commands, as the shell's registry gives them. */
const LABELS: Readonly<Record<string, string>> = {
  'file.import-audio': 'Import audio…',
  'file.cancel-import': 'Cancel the import',
};

/**
 * Draws the panel over a window's stores, its controls running the window's
 * commands, and refusing as `unavailableReason` says; gives back its list, and
 * the commands its controls ran.
 */
function browserOver(
  window: ProjectWindow,
  unavailableReason: (id: string) => string | undefined = () => undefined,
) {
  const ran: string[] = [];
  render(
    <AssetBrowserPanel
      title="Asset Browser"
      projects={window.projects}
      projectsUnavailable={undefined}
      catalogue={window.context.assets}
      editorViews={window.context.editorViews}
      commands={{
        run: (id, args) => {
          ran.push(id);
          window.run(id, args);
        },
        unavailableReason,
      }}
      labelFor={(id) => LABELS[id] ?? id}
    />,
  );
  return { list: () => screen.getByRole('list', { name: 'The project’s audio' }), ran };
}

/** A second of a tone, as a WAV file the person chose. */
function chosenWav(): PageFile {
  const bytes = wavFile(sine(440, { length: 48_000 }));
  return {
    bytes: { kind: 'file', file: new File([bytes], 'Harbour.wav') },
    fileName: 'Harbour.wav',
    mediaType: 'audio/wav',
    lastModified: 11,
  };
}

describe('the Asset Browser panel (REQ-STOR-025, REQ-EDIT-014)', () => {
  it('lists the project’s assets with their regions under them, in the project’s order', async () => {
    const audio = await windowWithAudio({
      regions: [
        { name: 'Intro', start: 0, end: 48_000 },
        { name: 'Chorus', start: 96_000, end: 144_000 },
      ],
    });
    const { list } = browserOver(audio.window);

    const regions = await within(list()).findByRole('list', { name: 'Regions of Loop' });
    expect(within(list()).getAllByRole('button')[0]).toHaveTextContent('Loop');
    expect(
      within(regions)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual(['Intro', 'Chorus']);
  });

  it('opens the region pressed in the editor in use, and marks it as the one shown', async () => {
    const audio = await windowWithAudio({ regions: [{ name: 'Intro', start: 0, end: 48_000 }] });
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');
    const { list } = browserOver(audio.window);
    const [region] =
      audio.window.projects.project.session()?.getSnapshot().model.state.project.regions.values() ??
      [];
    if (region === undefined) throw new Error('No region was added.');

    await userEvent.click(await within(list()).findByRole('button', { name: 'Intro' }));

    expect(audio.window.context.editorViews.entry('editor')?.asset).toBe(regionEntryId(region.id));
    expect(within(list()).getByRole('button', { name: 'Intro' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(list()).getByRole('button', { name: 'Loop' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens an asset in a new Editor panel where no editor is in use', async () => {
    const audio = await windowWithAudio();
    const { list } = browserOver(audio.window);
    expect(audio.window.context.editorViews.get().focused).toBeUndefined();

    await userEvent.click(within(list()).getByRole('button', { name: 'Loop' }));

    const panel = audio.window.context.editorViews.get().focused;
    if (panel === undefined) throw new Error('No editor panel was opened.');
    expect(audio.window.context.editorViews.entry(panel)?.asset).toBe(audio.entry);
  });

  it('changes the row of a renamed region in place, keeping every other row', async () => {
    const audio = await windowWithAudio({ regions: [{ name: 'Intro', start: 0, end: 48_000 }] });
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');
    const { list } = browserOver(audio.window);
    const asset = within(list()).getByRole('button', { name: 'Loop' });
    const region = await within(list()).findByRole('button', { name: 'Intro' });
    const row = region.closest('li');
    const [added] =
      audio.window.projects.project.session()?.getSnapshot().model.state.project.regions.values() ??
      [];
    if (added === undefined) throw new Error('No region was added.');

    await audio.window.runAndHear('region.rename', { region: added.id, name: 'Opening' });

    expect(await within(list()).findByRole('button', { name: 'Opening' })).toBe(region);
    expect(region.closest('li')).toBe(row);
    expect(within(list()).getByRole('button', { name: 'Loop' })).toBe(asset);
  });

  it('turns the import control into the one that calls the import off and back, keeping the focus on it', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const { ran } = browserOver(window);
    expect(
      screen.getByText('This project has no audio yet. Import a WAV or AIFF file to add some.'),
    ).toBeInTheDocument();
    window.files.mediaFiles.push(chosenWav());
    const control = screen.getByRole('button', { name: 'Import audio…' });
    control.focus();

    const heard = window.runAndHear('file.import-audio');
    expect(await screen.findByText('Importing "Harbour.wav"…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Cancel the import' })).toBe(control);
    expect(control).toHaveFocus();
    // The command it runs is held to keeping nothing by its own tests; whether
    // it reaches the worker before the read ends is a race this does not judge.
    fireEvent.click(control);
    expect(ran).toContain('file.cancel-import');

    await heard;
    expect(await screen.findByRole('button', { name: 'Import audio…' })).toBe(control);
    expect(control).toHaveFocus();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('offers the import once a project opens, following the project as its command does', async () => {
    const window = await projectWorld().window();
    browserOver(window, () =>
      window.projects.project.session() === undefined ? 'No project is open.' : undefined,
    );
    const control = screen.getByRole('button', { name: 'Import audio…' });
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAccessibleDescription('No project is open.');

    await window.runAndHear('file.create-project', { name: 'Harbour' });

    await expect.poll(() => control.getAttribute('aria-disabled')).toBe('false');
    expect(control).not.toHaveAccessibleDescription();
  });

  it('says why it lists nothing where no project is open', async () => {
    const window = await projectWorld().window();
    browserOver(window);

    expect(screen.getByText('Open or create a project to keep audio in it.')).toBeInTheDocument();
  });
});
