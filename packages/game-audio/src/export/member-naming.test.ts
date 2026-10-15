import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { expandNaming, type NamingValues } from './member-naming.js';
import { namingTemplate } from './naming-template.js';

/** 2026-10-10 23:30 UTC. */
const LATE_EVENING = Date.UTC(2026, 9, 10, 23, 30);

const REGION_MEMBER: NamingValues = {
  project: 'Forest Level',
  asset: 'Field Recording 3',
  region: 'Left Step',
  groupName: 'Wet Grass',
  groupPath: ['Footsteps', 'Wet Grass'],
  number: 7,
  count: 12,
  clock: { epochMilliseconds: LATE_EVENING, utcOffsetMinutes: 0 },
  extension: 'ogg',
};

const ASSET_MEMBER: NamingValues = { ...REGION_MEMBER, region: undefined };

function expanded(source: string, values: Partial<NamingValues> = {}): string {
  return expectSuccess(
    expandNaming(expectSuccess(namingTemplate(source)), { ...REGION_MEMBER, ...values }),
  );
}

describe('expanding a naming template for a member', () => {
  it('fills every token', () => {
    expect(
      expanded('{project}|{asset}|{region}|{group}|{group-path}|{number}|{date}|{format}'),
    ).toBe(
      'Forest Level|Field Recording 3|Left Step|Wet Grass|Footsteps_Wet Grass|07|2026-10-10|ogg',
    );
  });

  it('writes every text token in every case', () => {
    const cases = {
      lower: 'wet grass',
      upper: 'WET GRASS',
      snake: 'wet_grass',
      kebab: 'wet-grass',
      pascal: 'WetGrass',
    };
    const values = {
      project: 'Wet Grass',
      asset: 'Wet Grass',
      region: 'Wet Grass',
      groupPath: ['Wet Grass'],
    };
    for (const [modifier, written] of Object.entries(cases)) {
      for (const token of ['project', 'asset', 'region', 'group', 'group-path']) {
        expect(expanded(`{${token}:${modifier}}`, values), `${token}:${modifier}`).toBe(written);
      }
    }
  });

  it('cases the group path as one text, its join a separator like any other', () => {
    expect(expanded('{group-path:kebab}')).toBe('footsteps-wet-grass');
    expect(expanded('{group-path:pascal}')).toBe('FootstepsWetGrass');
    expect(expanded('{group-path:upper}')).toBe('FOOTSTEPS_WET GRASS');
    expect(expanded('{group-path}', { groupPath: ['Root'] })).toBe('Root');
  });

  it("pads {number} to the width of the group's count, or the width asked", () => {
    expect(expanded('{number}', { number: 7, count: 9 })).toBe('7');
    expect(expanded('{number}', { number: 7, count: 10 })).toBe('07');
    expect(expanded('{number}', { number: 7, count: 100 })).toBe('007');
    expect(expanded('{number:1}', { number: 7, count: 100 })).toBe('7');
    expect(expanded('{number:4}', { number: 7, count: 100 })).toBe('0007');
    expect(expanded('{number:6}', { number: 7 })).toBe('000007');
    expect(expanded('{number:2}', { number: 123, count: 200 })).toBe('123');
  });

  it("takes the date from the clock at the caller's offset from UTC", () => {
    const clock = { epochMilliseconds: LATE_EVENING, utcOffsetMinutes: 60 };
    expect(expanded('{date}', { clock })).toBe('2026-10-11');
  });

  it('gives braces in the template as braces, and braces in a value as they are', () => {
    expect(expanded('{{{group}}}', { groupName: 'a}b{' })).toBe('{a}b{}');
  });

  it('names an asset member by every token but {region}', () => {
    const template = expectSuccess(namingTemplate('{asset:snake}_{number}'));
    expect(expectSuccess(expandNaming(template, ASSET_MEMBER))).toBe('field_recording_3_07');
  });

  it('refuses {region} for an asset member, which has no region', () => {
    for (const source of ['{region}', 'x {region:snake}']) {
      const template = expectSuccess(namingTemplate(source));
      const result = expandNaming(template, ASSET_MEMBER);
      expect(expectFailureCode(result)).toBe('game.export-region-token-for-asset');
      expect(result.ok ? undefined : result.failures[0].details).toEqual({ template: source });
    }
  });
});
