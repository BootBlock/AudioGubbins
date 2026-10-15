import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { namingTemplate } from './naming-template.js';
import { NAMING_TOKENS } from './naming-vocabulary.js';

function refusal(source: string): string {
  const result = namingTemplate(source);
  expect(expectFailureCode(result)).toBe('game.naming-template-invalid');
  return result.ok ? '' : result.failures[0].summary;
}

describe('a naming template', () => {
  it('keeps its source and reads its parts once, when it is made', () => {
    expect(expectSuccess(namingTemplate('{group:snake}_{number:2}'))).toEqual({
      source: '{group:snake}_{number:2}',
      parts: [
        { kind: 'token', token: 'group', modifier: 'snake' },
        { kind: 'text', text: '_' },
        { kind: 'token', token: 'number', modifier: '2' },
      ],
    });
  });

  it('reads every token of the game vocabulary', () => {
    for (const token of NAMING_TOKENS) {
      expect(expectSuccess(namingTemplate(`{${token}}`)).parts).toEqual([{ kind: 'token', token }]);
    }
  });

  it('gives every text token every case modifier', () => {
    for (const token of ['project', 'asset', 'region', 'group', 'group-path']) {
      for (const modifier of ['lower', 'upper', 'snake', 'kebab', 'pascal']) {
        expectSuccess(namingTemplate(`{${token}:${modifier}}`));
      }
    }
  });

  it('pads {number} to 1 to 6 digits and no other width', () => {
    for (const width of ['1', '2', '3', '4', '5', '6']) {
      expectSuccess(namingTemplate(`{number:${width}}`));
    }
    expect(refusal('{number:7}')).toBe(
      'The naming template gives {number} the modifier "7", which is not one of 1, 2, 3, 4, 5 and 6.',
    );
    expect(refusal('{number:02}')).toContain('the modifier "02"');
  });

  it('refuses a case on a token that is not text', () => {
    for (const token of ['number', 'date', 'format']) {
      expect(refusal(`{${token}:snake}`)).toContain('the modifier "snake"');
    }
    expect(refusal('{date:upper}')).toBe(
      'The naming template gives {date} the modifier "upper", but {date} takes no modifier.',
    );
  });

  it("refuses a token outside the game vocabulary, the export's batch index among them", () => {
    expect(refusal('{index}')).toBe(
      'The naming template names {index}, which is not one of {project}, {asset}, {region}, {group}, {group-path}, {number}, {date} and {format}.',
    );
  });

  it('refuses a brace alone and an empty template', () => {
    expect(refusal('{group')).toContain('write {{ or }}');
    expect(refusal('')).toBe('A naming template cannot be empty.');
  });
});
