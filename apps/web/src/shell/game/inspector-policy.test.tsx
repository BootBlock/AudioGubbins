import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import type { Region } from '@audiogubbins/domain';
import type { GameAssetGroup } from '@audiogubbins/game-audio';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { namingTemplate } from '@audiogubbins/game-audio';
import { BUILT_IN_LIBRARY } from '@audiogubbins/processors';
import { sine } from '@audiogubbins/test-fixtures';
import { PanelKinds } from '@audiogubbins/workspace';

import { policyValueArgument } from '../../commands/game-changes.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { InspectorPanel } from '../inspector/inspector-panel.js';

holdPlatformFiles();

const SECOND = 48_000;

type Ran = (readonly [string, CommandInvocation['arguments']])[];

/** Draws the Inspector over the window's stores, its controls running the window's commands. */
function inspectorOver(audio: AudioWindow): Ran {
  const { context } = audio.window;
  const ran: Ran = [];
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
        modelGate: context.modelGate,
        groups: context.groups.chosen,
        preferences: context.preferences,
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

function groupNamed(audio: AudioWindow, name: string): GameAssetGroup {
  const groups = audio.session.getSnapshot().model.state.gameAudio?.groups.values() ?? [];
  const group = [...groups].find((one) => one.name === name);
  if (group === undefined) throw new Error(`There is no group ${name}.`);
  return group;
}

function onlyRegion(audio: AudioWindow): Region {
  const [region] = audio.session.getSnapshot().model.state.project.regions.values();
  if (region === undefined) throw new Error('The tone has its region.');
  return region;
}

/** The group of the field headed `heading`. */
function field(heading: string): HTMLElement {
  return screen.getByRole('group', { name: heading });
}

/** A tone with one region in "Footsteps" inside "Sfx", whose naming Sfx sets. */
async function nested(): Promise<AudioWindow> {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: SECOND }),
    name: 'Steps',
    regions: [{ name: 'Step', start: 0, end: SECOND }],
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  await audio.window.runAndHear('game.new-group', { name: 'Sfx' });
  const sfx = groupNamed(audio, 'Sfx');
  await audio.window.runAndHear('game.new-group', { name: 'Footsteps', parent: sfx.id });
  await audio.window.runAndHear('game.set-policy', {
    group: sfx.id,
    field: 'naming',
    value: policyValueArgument('naming', expectSuccess(namingTemplate('sfx_{number}'))),
  });
  await audio.window.runAndHear('game.assign-selection', {
    group: groupNamed(audio, 'Footsteps').id,
    member: `region:${onlyRegion(audio).id}`,
  });
  return audio;
}

describe("the Inspector's game policy (ADR-0101)", { timeout: 30_000 }, () => {
  it("shows a chosen group's every field with its source, and what its own value hides", async () => {
    const audio = await nested();
    const footsteps = groupNamed(audio, 'Footsteps');
    audio.window.run('game.choose-group', { group: footsteps.id });
    inspectorOver(audio);

    expect(screen.getByRole('heading', { name: 'Asset group: Sfx/Footsteps' })).toBeInTheDocument();
    // The value, and where it comes from in the field's source chip.
    expect(field('Naming template')).toHaveTextContent('“sfx_{number}”');
    expect(field('Naming template')).toHaveTextContent('Inherited from Sfx');
    expect(field('Loudness target')).toHaveTextContent('Not set');
    expect(field('Loudness target')).toHaveTextContent(
      'Its members are measured against no target.',
    );
    expect(
      within(field('Naming template')).queryByRole('button', { name: 'Reset to inherited' }),
    ).toBeNull();

    await audio.window.runAndHear('game.set-policy', {
      group: footsteps.id,
      field: 'naming',
      value: policyValueArgument('naming', expectSuccess(namingTemplate('step_{number}'))),
    });

    expect(field('Naming template')).toHaveTextContent('“step_{number}”');
    expect(field('Naming template')).toHaveTextContent('Set on this group');
    expect(field('Naming template')).toHaveTextContent('It hides “sfx_{number}”, set on Sfx.');
    expect(
      within(field('Naming template')).getByRole('button', { name: 'Reset to inherited' }),
    ).toBeInTheDocument();
  });

  it("overrides a member's field from the value it inherits, says so, and resets it", async () => {
    const audio = await nested();
    const region = onlyRegion(audio);
    // The editor brought into use, as tapping in it does, takes the Inspector
    // back from the group the commands above chose.
    const { workspace } = audio.window.context;
    expect(workspace.openPanel(PanelKinds.AssetBrowser)).toBeUndefined();
    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    audio.window.context.selections.change(audio.entry, () => ({
      objects: { kind: 'regions', ids: [region.id] },
      recency: ['objects'],
    }));
    const ran = inspectorOver(audio);
    const user = userEvent.setup();

    expect(
      screen.getByRole('heading', { name: 'Game policy, in “Sfx/Footsteps”' }),
    ).toBeInTheDocument();
    expect(field('Naming template')).toHaveTextContent('“sfx_{number}”');
    expect(field('Naming template')).toHaveTextContent('Inherited from Sfx');
    expect(field('Processing')).toHaveTextContent('It inherits its group’s processing.');

    await user.click(within(field('Naming template')).getByRole('button', { name: 'Override…' }));
    const typed = within(field('Naming template')).getByRole('textbox', {
      name: 'Naming template',
    });
    // The editor starts from the value the member inherits.
    expect(typed).toHaveValue('sfx_{number}');
    await user.clear(typed);
    await user.type(typed, 'hero');
    await user.click(
      within(field('Naming template')).getByRole('button', { name: 'Override on this member' }),
    );
    await expect
      .poll(() => field('Naming template').textContent)
      .toContain('Overridden on this region');
    expect(field('Naming template')).toHaveTextContent('“hero”');
    expect(field('Naming template')).toHaveTextContent('It hides “sfx_{number}”, set on Sfx.');

    await user.click(
      within(field('Naming template')).getByRole('button', { name: 'Reset to inherited' }),
    );
    await expect.poll(() => field('Naming template').textContent).toContain('Inherited from Sfx');
    expect(field('Naming template')).toHaveTextContent('“sfx_{number}”');
    expect(ran.map(([id]) => id)).toEqual(['game.set-override', 'game.reset-override']);
  });

  it('refuses a template the game vocabulary does not read beside the control, running nothing', async () => {
    const audio = await nested();
    const footsteps = groupNamed(audio, 'Footsteps');
    audio.window.run('game.choose-group', { group: footsteps.id });
    const ran = inspectorOver(audio);
    const user = userEvent.setup();

    await user.click(within(field('Naming template')).getByRole('button', { name: 'Set here…' }));
    const typed = within(field('Naming template')).getByRole('textbox', {
      name: 'Naming template',
    });
    await user.clear(typed);
    await user.type(typed, '{{nonsense}');
    await user.click(
      within(field('Naming template')).getByRole('button', { name: 'Set on this group' }),
    );

    expect(ran).toEqual([]);
  });

  it('says of a member that owns its processing what a reset to inherited would give it', async () => {
    const audio = await nested();
    const region = onlyRegion(audio);
    const [entry] = BUILT_IN_LIBRARY;
    if (entry === undefined) throw new Error('The build comes with game chains.');
    await audio.window.runAndHear('game.set-policy', {
      group: groupNamed(audio, 'Footsteps').id,
      field: 'processing',
      entry: entry.id,
    });
    await audio.window.runAndHear('game.own-processing', { member: `region:${region.id}` });
    await audio.window.runAndHear('rack.remove-rack', { target: `region:${region.id}` });
    const { workspace } = audio.window.context;
    expect(workspace.openPanel(PanelKinds.AssetBrowser)).toBeUndefined();
    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    audio.window.context.selections.change(audio.entry, () => ({
      objects: { kind: 'regions', ids: [region.id] },
      recency: ['objects'],
    }));
    inspectorOver(audio);

    expect(field('Processing')).toHaveTextContent(
      /It owns its processing\. It has no rack\. Inheriting, its rack would run .+\./u,
    );
    expect(
      within(field('Processing')).getByRole('button', { name: 'Reset to inherited' }),
    ).toBeInTheDocument();
  });
});
