import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator, type Project } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import type { GroupMember } from '../groups/membership.js';
import { validateGameAudioState } from '../groups/state-validation.js';
import { worldAsset, worldProject, worldRegion } from '../testing/random-game-state.js';
import { memberNames, memberNamings, type RegionMember, type RegionName } from './member-names.js';
import { namingTemplate } from './naming-template.js';

/** 2026-10-16 23:30 UTC, the 17th an hour east. */
const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16, 23, 30), utcOffsetMinutes: 60 };

const ambienceId = 'group-ambience' as GameAssetGroupId;
const birdsId = 'group-birds' as GameAssetGroupId;

/**
 * Ambience ⊃ Birds. Birds holds four regions of one dawn recording, assigned
 * in the order wren, robin, owl, lark; Ambience holds the wind asset. The
 * crow region is in no group.
 */
function world(): {
  project: Project;
  state: GameAudioState;
  /** Wren, robin, owl and lark, in the order they were assigned. */
  birds: readonly [RegionMember, RegionMember, RegionMember, RegionMember];
  crow: RegionMember;
  wind: GroupMember;
} {
  const ids = createDeterministicIdGenerator(21);
  const dawn = worldAsset(ids, 'Dawn chorus');
  const windAsset = worldAsset(ids, 'Wind');
  const regions = ['Wren', 'Robin', 'Owl', 'Lark', 'Crow'].map((name) =>
    worldRegion(ids, dawn, name),
  );
  const project = {
    ...worldProject(ids, { assets: [dawn, windAsset], regions }),
    displayName: 'Forest',
  };
  const [wren, robin, owl, lark, crow] = regions.map((one): RegionMember => ({
    kind: 'region',
    region: one.id,
  }));
  if (
    wren === undefined ||
    robin === undefined ||
    owl === undefined ||
    lark === undefined ||
    crow === undefined
  ) {
    throw new Error('The fixture has five regions.');
  }
  const groups: GameAssetGroup[] = [
    { id: ambienceId, name: 'Ambience', policy: {} },
    { id: birdsId, name: 'Birds', parent: ambienceId, policy: {} },
  ];
  const wind: GroupMember = { kind: 'asset', asset: windAsset.id };
  const joined = (member: GroupMember, group: GameAssetGroupId) =>
    ({ member, group, processing: 'own', overrides: {} }) as const;
  const state = expectSuccess(
    validateGameAudioState(project, {
      groups: new Map(groups.map((group) => [group.id, group])),
      memberships: [
        joined(wren, birdsId),
        joined(wind, ambienceId),
        joined(robin, birdsId),
        joined(owl, birdsId),
        joined(lark, birdsId),
      ],
      scenarios: new Map(),
    }),
  );
  return { project, state, birds: [wren, robin, owl, lark], crow, wind };
}

function names(items: readonly RegionName[]): readonly (string | readonly string[])[] {
  return items.map((item) =>
    item.kind === 'named' ? item.name : item.failures.map((one) => one.code),
  );
}

describe("a member's naming values", () => {
  it("are its project's, asset's and region's names, its group's name and path, and its place in the group", () => {
    const { project, state, birds } = world();
    const namingOf = memberNamings(project, state);
    expect(expectSuccess(namingOf(birds[2]))).toEqual({
      project: 'Forest',
      asset: 'Dawn chorus',
      region: 'Owl',
      groupName: 'Birds',
      groupPath: ['Ambience', 'Birds'],
      number: 3,
      count: 4,
    });
  });

  it("count a group's members in the order they were assigned, apart from other groups'", () => {
    const { project, state, birds, wind } = world();
    const namingOf = memberNamings(project, state);
    expect(birds.map((member) => expectSuccess(namingOf(member)).number)).toEqual([1, 2, 3, 4]);
    expect(expectSuccess(namingOf(wind))).toMatchObject({
      asset: 'Wind',
      region: undefined,
      groupName: 'Ambience',
      groupPath: ['Ambience'],
      number: 1,
      count: 1,
    });
  });
});

describe('naming regions from a template', () => {
  it('gives each region its name in the order asked, numbered by its place in its group, not in the list', () => {
    const { project, state, birds } = world();
    const template = expectSuccess(
      namingTemplate('{group-path:snake}_{number:2}_{region:upper} {date}'),
    );
    const asked = [birds[3], birds[1]];
    expect(names(memberNames(project, state, asked, template, CLOCK))).toEqual([
      'ambience_birds_04_LARK 2026-10-17',
      'ambience_birds_02_ROBIN 2026-10-17',
    ]);
  });

  it('refuses a region in no group, and names the rest', () => {
    const { project, state, birds, crow } = world();
    const template = expectSuccess(namingTemplate('{group} {number}'));
    const items = memberNames(project, state, [crow, ...birds.slice(0, 1)], template, CLOCK);
    expect(names(items)).toEqual([['game.member-in-no-group'], 'Birds 1']);
    const [refused] = items;
    expect(refused?.kind === 'refused' ? refused.failures[0].summary : undefined).toBe(
      'The region “Crow” is in no group, so no group names or numbers it; add it to one.',
    );
  });

  it('refuses a region the project does not hold', () => {
    const { project, state, birds } = world();
    const gone: RegionMember = {
      kind: 'region',
      region: createDeterministicIdGenerator(99).next(),
    };
    const template = expectSuccess(namingTemplate('{region}'));
    expect(
      names(memberNames(project, state, [gone, ...birds.slice(0, 1)], template, CLOCK)),
    ).toEqual([['game.member-unknown'], 'Wren']);
  });

  it("refuses a template naming {format}, a file's extension, which no region's name has", () => {
    const { project, state, birds } = world();
    const template = expectSuccess(namingTemplate('{region}.{format}'));
    expect(names(memberNames(project, state, birds.slice(0, 2), template, CLOCK))).toEqual([
      ['game.region-name-format-token'],
      ['game.region-name-format-token'],
    ]);
  });

  it('refuses a name with nothing but spaces in it', () => {
    const { project, state, birds } = world();
    const template = expectSuccess(namingTemplate(' {region:snake} '));
    const blank = { ...project, regions: new Map(project.regions) };
    const [wren] = birds;
    const region = blank.regions.get(wren.region);
    if (region === undefined) throw new Error('The fixture has a wren.');
    blank.regions.set(wren.region, { ...region, displayName: '— ' });
    expect(names(memberNames(blank, state, birds.slice(0, 2), template, CLOCK))).toEqual([
      ['game.member-name-empty'],
      ' robin ',
    ]);
  });
});
