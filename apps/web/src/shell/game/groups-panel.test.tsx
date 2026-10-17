import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import type { Region } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { namingTemplate } from '@audiogubbins/game-audio';
import { sine } from '@audiogubbins/test-fixtures';

import { policyValueArgument } from '../../commands/game-changes.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { GroupsPanel } from './groups-panel.js';

holdPlatformFiles();

const SECOND = 48_000;

type Ran = (readonly [string, CommandInvocation['arguments']])[];

/** Draws the panel over the window's stores, its controls running the window's commands. */
function panelOver(audio: AudioWindow): Ran {
  const { context } = audio.window;
  const ran: Ran = [];
  render(
    <GroupsPanel
      title="Asset groups"
      parts={{
        projects: audio.window.projects,
        groups: context.groups.chosen,
        loudness: context.loudness.readings,
        assets: context.assets,
        audioSettings: context.audioSettings,
        codecs: context.codecs.environment,
      }}
      commands={{
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

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...audio.session.getSnapshot().model.state.project.regions.values()].toSorted(
    (a, b) => a.start - b.start,
  );
}

/** Two seconds of a tone, a region each, in the group "Footsteps" inside "Sfx", and "Music" beside. */
async function forest(): Promise<AudioWindow> {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: 2 * SECOND }),
    name: 'Steps',
    regions: [
      { name: 'Step one', start: 0, end: SECOND },
      { name: 'Step two', start: SECOND, end: 2 * SECOND },
    ],
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  await audio.window.runAndHear('game.new-group', { name: 'Sfx' });
  const sfx = context.groups.chosen.get()?.group;
  if (sfx === undefined) throw new Error('The group was made.');
  await audio.window.runAndHear('game.new-group', { name: 'Footsteps', parent: sfx });
  await audio.window.runAndHear('game.new-group', { name: 'Music' });
  const footsteps = [
    ...(audio.session.getSnapshot().model.state.gameAudio?.groups.values() ?? []),
  ].find((one) => one.name === 'Footsteps');
  if (footsteps === undefined) throw new Error('The group was made.');
  const [one, two] = regionsOf(audio);
  if (one === undefined || two === undefined) throw new Error('The tone has its regions.');
  await audio.window.runAndHear('game.assign-selection', {
    group: footsteps.id,
    member: `region:${one.id},region:${two.id}`,
  });
  audio.window.run('game.choose-group', { group: footsteps.id });
  return audio;
}

describe('the Asset groups panel', { timeout: 30_000 }, () => {
  it('shows the forest as a tree whose arrows move, open and close it, Enter choosing a group', async () => {
    const audio = await forest();
    const ran = panelOver(audio);
    const user = userEvent.setup();
    const tree = screen.getByRole('tree', { name: 'Asset groups' });
    const items = () => within(tree).getAllByRole('treeitem');

    expect(items().map((item) => item.getAttribute('aria-level'))).toEqual(['1', '1', '2']);
    // Each item is named in words, and the one chosen says so by its selection.
    expect(items().map((item) => item.getAttribute('aria-label'))).toEqual([
      'Music (0 members)',
      'Sfx (0 members)',
      'Footsteps (2 members)',
    ]);
    expect(items().map((item) => item.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    // One stop in the tab order: the group chosen.
    expect(items().map((item) => item.tabIndex)).toEqual([-1, -1, 0]);

    items()[2]?.focus();
    await user.keyboard('{ArrowLeft}');
    expect(items()[1]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(items()[1]).toHaveAttribute('aria-expanded', 'false');
    expect(items()).toHaveLength(2);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(items()[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items()[0]).toHaveFocus();
    await user.keyboard('{Enter}');

    const music = [
      ...(audio.session.getSnapshot().model.state.gameAudio?.groups.values() ?? []),
    ].find((one) => one.name === 'Music');
    expect(ran).toEqual([['game.choose-group', { group: music?.id }]]);
  });

  it('chooses a group pressed anywhere on its item, its name as well as round it', async () => {
    const audio = await forest();
    const ran = panelOver(audio);
    const user = userEvent.setup();

    await user.click(within(screen.getByRole('tree')).getByText('Music'));

    const music = [
      ...(audio.session.getSnapshot().model.state.gameAudio?.groups.values() ?? []),
    ].find((one) => one.name === 'Music');
    expect(ran).toEqual([['game.choose-group', { group: music?.id }]]);
  });

  it('renames a group in place with F2, and runs the delete command with Delete', async () => {
    const audio = await forest();
    const ran = panelOver(audio);
    const user = userEvent.setup();
    const footsteps = audio.window.context.groups.chosen.get()?.group;
    const [, , item] = within(screen.getByRole('tree')).getAllByRole('treeitem');
    item?.focus();

    await user.keyboard('{F2}');
    const field = screen.getByRole('textbox', { name: 'New name for Footsteps' });
    await user.clear(field);
    await user.type(field, 'Steps{Enter}');
    await user.keyboard('{Delete}');

    expect(ran).toEqual([
      ['game.rename-group', { group: footsteps, name: 'Steps' }],
      ['game.delete-group', { group: footsteps }],
    ]);
  });

  it("lists the chosen group's members with their processing, and its export plan naming each value's owner", async () => {
    const audio = await forest();
    await audio.window.runAndHear('game.apply-preset-to-group', { preset: 'game-wav-16-48k' });
    await audio.window.runAndHear('game.set-policy', {
      field: 'naming',
      value: policyValueArgument(
        'naming',
        expectSuccess(namingTemplate('{group:snake}_{number:2}')),
      ),
    });
    panelOver(audio);

    const members = screen.getByRole('table', { name: 'Members of Sfx/Footsteps' });
    expect(
      within(members)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['“Step one”', '“Step two”']);
    expect(within(members).getAllByText('Inherits')).toHaveLength(2);
    expect(within(members).getAllByText('No loudness target')).toHaveLength(2);
    const plan = screen.getByRole('region', { name: 'Export plan' });
    const planned = within(plan).getAllByRole('listitem')[0];
    if (planned === undefined) throw new Error('The plan lists the member.');
    expect(planned).toHaveTextContent('“Step one” to footsteps_01.wav');
    // Who owns each value of the file is behind the item's hint.
    await userEvent.click(
      within(planned).getByRole('button', {
        name: 'Where the file of “Step one” takes its values from',
      }),
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Profile: Sfx/Footsteps; name: Sfx/Footsteps; folder: not set.',
    );
    expect(plan).toHaveTextContent('2 members are planned and 0 are refused.');
  });

  it('shows a member refused by the export plan with the reason', async () => {
    const audio = await forest();
    panelOver(audio);

    const plan = screen.getByRole('region', { name: 'Export plan' });
    expect(plan).toHaveTextContent('0 members are planned and 2 are refused.');
    expect(plan).toHaveTextContent(/“Step one”: .*export profile/u);
  });
});
