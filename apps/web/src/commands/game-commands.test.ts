import { beforeEach, describe, expect, it } from 'vitest';

import { FakeDirectoryHandle, installFakeHandles } from '@audiogubbins/browser-storage/testing';
import type { Region } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  destinationPath,
  memberKey,
  namingTemplate,
  type GameAssetGroup,
  type GroupMember,
} from '@audiogubbins/game-audio';
import { BUILT_IN_LIBRARY } from '@audiogubbins/processors';
import { sine } from '@audiogubbins/test-fixtures';

import { gamePolicyView } from '../state/game-policy-view.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { policyValueArgument } from './game-group-commands.js';

holdPlatformFiles();
beforeEach(() => {
  installFakeHandles();
});

const SECOND = 48_000;

function stateOf(audio: AudioWindow) {
  return audio.session.getSnapshot().model.state;
}

function viewOf(audio: AudioWindow) {
  return gamePolicyView(stateOf(audio));
}

/** The project's regions, in the order they lie on the asset. */
function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...stateOf(audio).project.regions.values()].toSorted((a, b) => a.start - b.start);
}

function regionMember(region: Region): GroupMember {
  return { kind: 'region', region: region.id };
}

/** The only group of the project. */
function onlyGroup(audio: AudioWindow): GameAssetGroup {
  const [group, ...others] = viewOf(audio).game.groups.values();
  if (group === undefined || others.length > 0) throw new Error('The project has one group.');
  return group;
}

/** Selects `regions` in the editor in use, as tapping them in the region strip does. */
function select(audio: AudioWindow, regions: readonly [Region, ...Region[]]): void {
  audio.window.context.selections.change(audio.entry, () => ({
    objects: { kind: 'regions', ids: [regions[0].id, ...regions.slice(1).map((one) => one.id)] },
    recency: ['objects'],
  }));
}

/** Why the window refuses `id`, the reasons joined. */
function refusal(audio: AudioWindow, id: string, args?: Record<string, string>): string {
  const ran = audio.window.run(id, args);
  return ran.kind === 'refused'
    ? ran.failures.map((one) => one.summary).join(' ')
    : `not refused: ${ran.kind}`;
}

/** Three seconds of a tone with a region each, open in the editor in use. */
async function steps(): Promise<AudioWindow> {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: 3 * SECOND }),
    name: 'Steps',
    // A second each, longer than the 400 ms a gated loudness reading needs.
    regions: [
      { name: 'Step one', start: 0, end: SECOND },
      { name: 'Step two', start: SECOND, end: 2 * SECOND },
      { name: 'Other', start: 2 * SECOND, end: 3 * SECOND },
    ],
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** The tone with the group "Footsteps" holding its first two regions. */
async function footsteps(): Promise<AudioWindow> {
  const audio = await steps();
  await audio.window.runAndHear('game.new-group', { name: 'Footsteps' });
  const [one, two] = regionsOf(audio);
  if (one === undefined || two === undefined) throw new Error('The tone has its regions.');
  select(audio, [one, two]);
  await audio.window.runAndHear('game.assign-selection');
  return audio;
}

/** The names in the folder `path` leads to from `folder`, sorted. */
async function namesIn(
  folder: FakeDirectoryHandle,
  path: readonly string[] = [],
): Promise<readonly string[]> {
  let at = folder;
  for (const name of path) {
    let inner: FakeDirectoryHandle | undefined;
    for await (const child of at.values()) {
      if (child instanceof FakeDirectoryHandle && child.name === name) inner = child;
    }
    if (inner === undefined) throw new Error(`There is no folder ${name}.`);
    at = inner;
  }
  const names: string[] = [];
  for await (const child of at.values()) names.push(child.name);
  return names.sort();
}

// Each test imports a second of audio and runs its storage worker in the
// test's own thread, which takes seconds under the whole suite's load.
describe('the asset group commands (ADR-0101)', { timeout: 30_000 }, () => {
  it('makes a group, chooses it, and makes the next one under a name of its own', async () => {
    const audio = await steps();

    expect(await audio.window.runAndHear('game.new-group')).toBe('Made the group “New group”.');
    const first = onlyGroup(audio);
    expect(audio.window.context.groups.chosen.get()).toEqual({
      group: first.id,
      inspected: true,
    });

    expect(await audio.window.runAndHear('game.new-group')).toBe('Made the group “New group 2”.');
    expect([...viewOf(audio).game.groups.values()].map((one) => one.name)).toEqual([
      'New group',
      'New group 2',
    ]);
  });

  it('renames, nests and refuses to delete a group that holds members, naming it', async () => {
    const audio = await footsteps();
    const footstepsGroup = onlyGroup(audio);
    await audio.window.runAndHear('game.new-group', { name: 'Sfx' });
    const sfx = [...viewOf(audio).game.groups.values()].find((one) => one.name === 'Sfx');
    if (sfx === undefined) throw new Error('The group was made.');

    expect(
      await audio.window.runAndHear('game.move-group', {
        group: footstepsGroup.id,
        parent: sfx.id,
      }),
    ).toBe('Moved the group “Footsteps” inside “Sfx”. Its members inherit from there now.');
    expect(viewOf(audio).pathOf(footstepsGroup.id)).toEqual(['Sfx', 'Footsteps']);
    expect(
      await audio.window.runAndHear('game.rename-group', {
        group: footstepsGroup.id,
        name: 'Steps',
      }),
    ).toBe('Renamed the group “Footsteps” to “Steps”.');

    const refused = await audio.window.runAndHear('game.delete-group', {
      group: footstepsGroup.id,
    });
    expect(refused).toMatch(/Sfx\/Steps/u);
    expect(viewOf(audio).game.groups.has(footstepsGroup.id)).toBe(true);
  });

  it('puts the selected regions in the chosen group inheriting its processing, as one step one undo takes back', async () => {
    const audio = await steps();
    await audio.window.runAndHear('game.new-group', { name: 'Footsteps' });
    const [one, two] = regionsOf(audio);
    if (one === undefined || two === undefined) throw new Error('The tone has its regions.');
    select(audio, [one, two]);

    expect(await audio.window.runAndHear('game.assign-selection')).toBe(
      'Put 2 members in the group “Footsteps”. A member with a rack of its own keeps it; one with none hears the group’s processing.',
    );
    expect(viewOf(audio).membersOf(onlyGroup(audio).id)).toEqual([
      {
        member: regionMember(one),
        group: onlyGroup(audio).id,
        processing: 'inherit',
        overrides: {},
      },
      {
        member: regionMember(two),
        group: onlyGroup(audio).id,
        processing: 'inherit',
        overrides: {},
      },
    ]);

    await audio.window.runAndHear('edit.undo');
    expect(viewOf(audio).game.memberships).toEqual([]);
  });

  it('resolves a field set on the group, overridden on one member and reset to inherited, with its source each time', async () => {
    const audio = await footsteps();
    const group = onlyGroup(audio);
    const [one, two] = regionsOf(audio);
    if (one === undefined || two === undefined) throw new Error('The tone has its regions.');
    const naming = expectSuccess(namingTemplate('{group:snake}_{number:2}'));
    await audio.window.runAndHear('game.set-policy', {
      field: 'naming',
      value: policyValueArgument('naming', naming),
    });
    expect(viewOf(audio).member(regionMember(two)).naming.source).toEqual({
      kind: 'group',
      group: group.id,
      path: ['Footsteps'],
    });

    const own = expectSuccess(namingTemplate('hero_{number}'));
    expect(
      await audio.window.runAndHear('game.set-override', {
        member: `region:${two.id}`,
        field: 'naming',
        value: policyValueArgument('naming', own),
      }),
    ).toBe('“Step two” sets its own naming template now, over its group’s.');
    const overridden = viewOf(audio).member(regionMember(two)).naming;
    expect(overridden.value?.source).toBe('hero_{number}');
    expect(overridden.source).toEqual({ kind: 'override', member: regionMember(two) });
    expect(overridden.shadowed.map((one) => one.value.source)).toEqual([
      '{group:snake}_{number:2}',
    ]);
    expect(viewOf(audio).member(regionMember(one)).naming.source.kind).toBe('group');

    const reset = { member: `region:${two.id}`, field: 'naming' };
    expect(await audio.window.runAndHear('game.reset-override', reset)).toBe(
      '“Step two” inherits its naming template from its group again.',
    );
    expect(viewOf(audio).member(regionMember(two)).naming.source.kind).toBe('group');
    // Reset already, it changes nothing a second time, and says so.
    expect(audio.window.run('game.reset-override', reset).kind).toBe('unchanged');
  });

  it('refuses a value the project does not read, naming the group, and leaves the policy as it was', async () => {
    const audio = await footsteps();

    const said = await audio.window.runAndHear('game.set-policy', {
      field: 'destination',
      value: JSON.stringify(['..']),
    });

    expect(said).not.toMatch(/^Set the destination folder/u);
    expect(onlyGroup(audio).policy.destination).toBeUndefined();
  });

  it("copies a built-in game chain into the project as the group's processing, which its inheriting members hear", async () => {
    const audio = await footsteps();
    const [entry] = BUILT_IN_LIBRARY;
    if (entry === undefined) throw new Error('The build comes with game chains.');

    await audio.window.runAndHear('game.set-policy', { field: 'processing', entry: entry.id });

    const chain = onlyGroup(audio).policy.processing;
    if (chain === undefined || chain === 'none') throw new Error('The group names a chain.');
    expect(stateOf(audio).project.effectChains.has(chain)).toBe(true);
    expect(regionsOf(audio).map((region) => region.rack)).toEqual([chain, chain, undefined]);
  });

  it("copies an export preset's choices into the group's export profile", async () => {
    const audio = await footsteps();

    expect(
      await audio.window.runAndHear('game.apply-preset-to-group', { preset: 'game-wav-16-48k' }),
    ).toMatch(/^The group “Footsteps” exports as /u);
    expect(onlyGroup(audio).policy.exportProfile).toMatchObject({
      format: 'wav',
      choices: { encoding: { kind: 'integer', bits: 16 } },
    });
  });

  it('keeps a split-off part of a member in its group, right after it, with its overrides', async () => {
    const audio = await footsteps();
    const [one, two] = regionsOf(audio);
    if (one === undefined || two === undefined) throw new Error('The tone has its regions.');
    const bus = { member: `region:${one.id}`, field: 'bus', value: JSON.stringify('sfx') };
    await audio.window.runAndHear('game.set-override', bus);
    select(audio, [one]);

    await audio.window.runAndHear('edit.split', { at: SECOND / 2 });

    const memberships = viewOf(audio).game.memberships;
    const regions = regionsOf(audio);
    const half = regions.find((region) => region.start === SECOND / 2);
    if (half === undefined) throw new Error('The region was split.');
    expect(memberships.map((one) => memberKey(one.member))).toEqual([
      memberKey(regionMember(one)),
      memberKey(regionMember(half)),
      memberKey(regionMember(two)),
    ]);
    expect(memberships[1]?.overrides).toEqual(memberships[0]?.overrides);
  });

  it("names the group's regions by the template each resolves to, as one step", async () => {
    const audio = await footsteps();
    const naming = expectSuccess(namingTemplate('{group:snake}_{number:2}'));
    await audio.window.runAndHear('game.set-policy', {
      field: 'naming',
      value: policyValueArgument('naming', naming),
    });

    expect(await audio.window.runAndHear('game.name-members')).toBe(
      'Named 2 regions of the group “Footsteps” by its naming template.',
    );
    expect(regionsOf(audio).map((region) => region.displayName)).toEqual([
      'footsteps_01',
      'footsteps_02',
      'Other',
    ]);
    expect(audio.window.run('game.name-members').kind).toBe('unchanged');
  });
});

describe("exporting an asset group's members (ADR-0102)", { timeout: 30_000 }, () => {
  it('refuses a group whose members resolve no export profile, saying why for each, before anything renders', async () => {
    const audio = await footsteps();

    const refused = refusal(audio, 'game.export-group');

    expect(refused).toMatch(/“Step one”: .*export profile/u);
    expect(refused).toMatch(/“Step two”: /u);
    expect(audio.window.exporting.codecs.requests).toEqual([]);
  });

  it('exports each member by its profile and name into the destination folder, leaving the project’s last settings', async () => {
    const audio = await footsteps();
    await audio.window.runAndHear('game.apply-preset-to-group', { preset: 'game-wav-16-48k' });
    const naming = expectSuccess(namingTemplate('{group:snake}_{number:2}'));
    await audio.window.runAndHear('game.set-policy', {
      field: 'naming',
      value: policyValueArgument('naming', naming),
    });
    await audio.window.runAndHear('game.set-policy', {
      field: 'destination',
      value: policyValueArgument('destination', expectSuccess(destinationPath(['sfx']))),
    });
    const folder = new FakeDirectoryHandle('Game sounds', []);
    audio.window.exporting.destinations.folder = folder;

    await audio.window.runAndHear('game.export-group');

    expect(await namesIn(folder, ['sfx'])).toEqual(['footsteps_01.wav', 'footsteps_02.wav']);
    const records = audio.session.getSnapshot().model.exports;
    expect(records.map((record) => record.file?.folder)).toEqual([
      { segments: ['sfx'] },
      { segments: ['sfx'] },
    ]);
    expect(stateOf(audio).exportSettings).toBeUndefined();
  });
});

describe("measuring the group's loudness (ADR-0101)", { timeout: 30_000 }, () => {
  it('measures every member on the detection worker, keeping each reading by its member', async () => {
    const audio = await footsteps();
    const [one, two] = regionsOf(audio);
    if (one === undefined || two === undefined) throw new Error('The tone has its regions.');

    audio.window.run('game.measure-loudness');

    const { readings } = audio.window.context.loudness;
    await expect
      .poll(() => [...readings.get().values()].map((reading) => reading.kind), { timeout: 15_000 })
      .toEqual(['measured', 'measured']);
    const reading = readings.get().get(memberKey(regionMember(one)));
    expect(reading?.kind === 'measured' ? reading.measurement.integratedLufs : undefined).toEqual(
      expect.any(Number),
    );
    expect(readings.get().has(memberKey(regionMember(two)))).toBe(true);
  });
});
