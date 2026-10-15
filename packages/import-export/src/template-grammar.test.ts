import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  escapeTemplateText,
  readTemplate,
  type TemplatePart,
  type TemplateVocabulary,
} from './template-grammar.js';

type Token = 'name' | 'count' | 'day';

const VOCABULARY: TemplateVocabulary<Token> = {
  tokens: new Set<Token>(['name', 'count', 'day']),
  modifiers: new Map<Token, ReadonlySet<string>>([
    ['name', new Set(['lower', 'upper'])],
    ['count', new Set(['2', '3'])],
  ]),
  noun: 'test template',
  refusalCode: 'test.template-invalid',
};

function read(template: string): readonly TemplatePart<Token>[] {
  return expectSuccess(readTemplate(template, VOCABULARY));
}

function refusal(template: string): string {
  const result = readTemplate(template, VOCABULARY);
  expect(expectFailureCode(result)).toBe('test.template-invalid');
  return result.ok ? '' : result.failures.map((one) => one.summary).join(' ');
}

/** The text a template's parts spell, its tokens as they were written. */
function spelled(parts: readonly TemplatePart<Token>[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      return part.modifier === undefined ? `<${part.token}>` : `<${part.token}:${part.modifier}>`;
    })
    .join('');
}

describe('the template grammar', () => {
  it('reads text, tokens and the modifiers given them, in order', () => {
    expect(read('Take {name:upper} - {count} on {day}.')).toEqual([
      { kind: 'text', text: 'Take ' },
      { kind: 'token', token: 'name', modifier: 'upper' },
      { kind: 'text', text: ' - ' },
      { kind: 'token', token: 'count' },
      { kind: 'text', text: ' on ' },
      { kind: 'token', token: 'day' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('gives a token written without a modifier no modifier at all', () => {
    expect(read('{name}')).toEqual([{ kind: 'token', token: 'name' }]);
  });

  it('reads doubled braces as braces, and a colon outside a token as text', () => {
    expect(spelled(read('{{{name}}} a:b {{x}}'))).toBe('{<name>} a:b {x}');
  });

  it('refuses a token outside the vocabulary, listing the vocabulary in its order', () => {
    expect(refusal('{place}')).toBe(
      'The test template names {place}, which is not one of {name}, {count} and {day}.',
    );
  });

  it('refuses a modifier on a token that takes none', () => {
    expect(refusal('{day:lower}')).toBe(
      'The test template gives {day} the modifier "lower", but {day} takes no modifier.',
    );
  });

  it('refuses a modifier the token does not take, an empty one and one holding a colon', () => {
    expect(refusal('{count:4}')).toBe(
      'The test template gives {count} the modifier "4", which is not one of 2 and 3.',
    );
    expect(refusal('{name:}')).toContain('the modifier ""');
    expect(refusal('{name:lower:upper}')).toContain('the modifier "lower:upper"');
  });

  it('refuses a brace standing alone, and an empty template', () => {
    for (const template of ['{', '}', 'a { b', '{name}}', '{{name}']) {
      expect(refusal(template)).toBe(
        'A brace in a test template opens or closes a token; write {{ or }} for the brace itself.',
      );
    }
    expect(refusal('  ')).toBe('A test template cannot be empty.');
  });
});

describe('escaping text into a template', () => {
  it('reads back as exactly the text, whatever braces and token names it holds', () => {
    for (const text of ['{name}', '}{', '{{', 'a {count:2} b', 'plain', '{:}']) {
      const escaped = escapeTemplateText(text);
      const parts = read(escaped);
      expect(parts.every((part) => part.kind === 'text')).toBe(true);
      expect(spelled(parts)).toBe(text);
    }
  });

  it('doubles each brace and leaves everything else', () => {
    expect(escapeTemplateText('a{b}c')).toBe('a{{b}}c');
  });
});
