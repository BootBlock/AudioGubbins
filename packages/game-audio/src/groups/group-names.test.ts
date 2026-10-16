import { describe, expect, it } from 'vitest';

import { groupNameKey, groupNameProblem, pathText } from './group-names.js';

describe('a group’s name (ADR-0101)', () => {
  it.each(['Footsteps', 'Wood doors', 'Ωμέγα', '中文', 'x', 'x'.repeat(128)])(
    'takes %s',
    (name) => {
      expect(groupNameProblem(name)).toBeUndefined();
    },
  );

  it.each([
    ['empty', '', /1 to 128 characters long; this one is 0/],
    ['longer than 128', 'x'.repeat(129), /this one is 129/],
    ['a path, not a segment', 'Footsteps/Grass', /holds no “\/”/],
    ['a control character', 'Foot\tsteps', /control character/],
    ['a space at an end', ' Footsteps', /no space at either end/],
    ['decomposed, not NFC', 'Café', /NFC/],
  ])('refuses one %s', (_, name, problem) => {
    expect(groupNameProblem(name)).toMatch(problem);
  });

  it('compares siblings by NFC lower case, so case and composition alone do not tell them apart', () => {
    expect(groupNameKey('CAFÉ')).toBe(groupNameKey('café'));
    expect(groupNameKey('Grass')).not.toBe(groupNameKey('Gravel'));
  });

  it('writes a path from the root with "/"', () => {
    expect(pathText(['SFX', 'Footsteps', 'Grass'])).toBe('SFX/Footsteps/Grass');
  });
});
