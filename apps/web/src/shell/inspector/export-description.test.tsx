import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeDirectoryHandle,
  FakeFileHandle,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { codecDescriptor } from '@audiogubbins/codecs';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportSettings } from '@audiogubbins/import-export';
import type { ExportRecord } from '@audiogubbins/project-format';
import { PanelKinds } from '@audiogubbins/workspace';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { ExportControl, ExportDestinationChoice } from '../../export/export-types.js';
import { SHOWN_SETTINGS } from '../../testing/export-states.js';
import { FAKE_ENCODER } from '../../testing/export-fakes.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { HistoryPanel } from '../history/history-panel.js';
import { describeNode } from '../history/history-words.js';
import { InspectorPanel } from './inspector-panel.js';

holdPlatformFiles();
beforeEach(() => {
  installFakeHandles();
});

/** 24-bit WAV of the whole asset, named after the project, as the shown states' default is. */
const SETTINGS: ExportSettings = SHOWN_SETTINGS;

function exportsOf(audio: AudioWindow): ExportControl {
  const { exports } = audio.window.context;
  if (exports === undefined) throw new Error('The window keeps projects, so it exports.');
  return exports;
}

/** Starts an export of the asset to `destination` and waits for it to settle. */
async function exported(audio: AudioWindow, destination: ExportDestinationChoice): Promise<void> {
  await act(async () => {
    expectSuccess(
      await exportsOf(audio).start(audio.session, {
        asset: audio.assetId,
        settings: SETTINGS,
        destination,
      }),
    );
  });
}

/** Runs a command of the window as a control would, failing the test where it is refused. */
function ran(audio: AudioWindow, id: string, args?: Record<string, string>): void {
  act(() => {
    const outcome = audio.window.run(id, args);
    if (outcome.kind === 'refused') throw new Error(outcome.failures[0].summary);
  });
}

/** Draws the Inspector over the window's stores. */
function inspectorOver(audio: AudioWindow): void {
  const { context } = audio.window;
  render(
    <InspectorPanel
      title="Inspector"
      projects={audio.window.projects}
      parts={{
        editorViews: context.editorViews,
        selections: context.selections,
        assets: context.assets,
        labelFor: (id) => id,
        recording: context.recording,
        audioSettings: context.audioSettings,
        exports: context.exports,
        exportSubject: context.exportFocus.subject,
      }}
      commands={{ run: () => undefined, unavailableReason: () => undefined }}
    />,
  );
}

/** Each fact `element` lists itself, not those of what it holds, its term to its detail. */
function factsIn(element: HTMLElement): Readonly<Record<string, string>> {
  const list = element.querySelector(':scope > dl');
  if (!(list instanceof HTMLElement)) throw new Error('No facts are listed here.');
  return Object.fromEntries(
    within(list)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  );
}

/** The section the heading `name` heads. */
function sectionNamed(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** The project's one export record. */
function onlyRecord(audio: AudioWindow): ExportRecord {
  const [record] = audio.session.getSnapshot().model.exports;
  if (record === undefined) throw new Error('Nothing was recorded.');
  return record;
}

const SETTINGS_WORDS =
  'WAV, 24-bit integer at 48 kHz, the channels kept as they are, with no dither.';

describe('the Inspector describing an export (REQ-EDIT-072)', () => {
  it('describes the last export, its settings and each file with where it went', async () => {
    const audio = await windowWithAudio();
    inspectorOver(audio);
    await exported(audio, {
      kind: 'folder',
      handle: new FakeDirectoryHandle('Game sounds', []),
      policy: 'prompt',
    });

    ran(audio, ExportCommand.Inspect);

    const batch = sectionNamed('The last export');
    expect(factsIn(batch)).toMatchObject({
      'Where it is': '“Harbour.wav” is exported.',
      Exports: 'The whole asset',
      Settings: SETTINGS_WORDS,
      'Named by': '“{project}”',
    });
    const files = within(batch).getByRole('list', { name: 'Files of the export' });
    const [file] = within(files).getAllByRole('listitem');
    if (file === undefined) throw new Error('No file is listed.');
    expect(within(file).getByRole('heading', { name: 'Harbour.wav' })).toBeInTheDocument();
    expect(factsIn(file)).toMatchObject({
      'Where it is': 'Exported',
      Of: 'The whole asset',
      'Where it goes':
        'Into “Game sounds”, where you are asked what to do with a file whose name is taken.',
    });
  });

  it('follows a file held after a refused delivery as it is delivered elsewhere, under the name it took', async () => {
    const audio = await windowWithAudio();
    inspectorOver(audio);
    await exported(audio, {
      kind: 'folder',
      handle: new FakeDirectoryHandle('Game sounds', [
        new FakeFileHandle(new File(['old'], 'Harbour.wav')),
      ]),
      policy: 'skip',
    });
    ran(audio, ExportCommand.Inspect);
    const held = sectionNamed('The export waiting');
    const [file] = within(held).getAllByRole('listitem');
    if (file === undefined) throw new Error('No file is listed.');
    expect(factsIn(file)['Where it is']).toMatch(/^Not delivered: /u);

    const exports = exportsOf(audio);
    const state = exports.get();
    const job = state.kind === 'held' ? state.batch.jobs[0]?.id : undefined;
    await act(async () => {
      expectSuccess(
        await exports.deliverElsewhere(audio.session, job ?? '', {
          kind: 'folder',
          handle: new FakeDirectoryHandle('Elsewhere', [
            new FakeFileHandle(new File(['old'], 'Harbour.wav')),
          ]),
          policy: 'rename',
        }),
      );
    });

    const ended = sectionNamed('The last export');
    const [delivered] = within(ended).getAllByRole('listitem');
    if (delivered === undefined) throw new Error('No file is listed.');
    // Under the name it was written as, which the rename changed.
    expect(within(delivered).getByRole('heading', { name: 'Harbour (2).wav' })).toBeVisible();
    expect(factsIn(delivered)).toMatchObject({
      'Where it is': 'Exported',
      'Where it goes':
        'Into “Elsewhere”, where a file whose name is taken is kept, and the export named “name (2)” and on.',
    });
  });

  it('describes an export the history records, opened from the History panel', async () => {
    const audio = await windowWithAudio();
    const { projects } = audio.window;
    await exported(audio, {
      kind: 'folder',
      handle: new FakeDirectoryHandle('Game sounds', []),
      policy: 'prompt',
    });
    const record = onlyRecord(audio);
    render(
      <HistoryPanel
        title="History"
        project={projects.project}
        review={projects.review}
        rowOrders={projects.rowOrders}
        run={(id, args) => audio.window.run(id, args).kind !== 'refused'}
        unavailableReason={() => undefined}
        labelFor={(id) => id}
      />,
    );
    inspectorOver(audio);

    await userEvent.click(
      screen.getByRole('button', { name: 'Describe the export “Harbour.wav” in the Inspector' }),
    );

    expect(audio.window.context.exportFocus.subject.get()).toEqual({
      kind: 'record',
      record: record.id,
    });
    const node = audio.session
      .getSnapshot()
      .model.history.nodes.get(audio.session.getSnapshot().model.history.cursor);
    expect(factsIn(sectionNamed('Export: “Harbour.wav”'))).toMatchObject({
      'From the point': node === undefined ? '' : describeNode(node),
      File: '“Harbour.wav”',
      Exports: 'The whole asset',
      Settings: SETTINGS_WORDS,
      'Encoded as': `${codecDescriptor(FAKE_ENCODER.id).name} by AudioGubbins 0.1.0`,
      'Its bytes': 'The project gives the same bytes on every machine.',
      'SHA-256': record.file?.sha256 ?? '',
      'Where it went': 'Into “Game sounds”.',
      'How it ended': 'Every file was written.',
    });
  });

  it('gives the Inspector back to the editor once one is brought into use', async () => {
    const audio = await windowWithAudio();
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');
    inspectorOver(audio);
    await exported(audio, { kind: 'download' });
    ran(audio, ExportCommand.Inspect);
    expect(sectionNamed('The last export')).toBeInTheDocument();

    act(() => {
      expect(audio.window.context.workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    });

    expect(screen.queryByRole('region', { name: 'The last export' })).toBeNull();
    expect(screen.getByRole('heading', { name: /^Asset: / })).toBeInTheDocument();
  });
});
