import { describe, expect, it } from 'vitest';

import {
  readTemplateSegments,
  tokenAt,
  tokensByName,
  type TemplateToken,
} from './template-syntax.js';

const CASES: ReadonlySet<string> = new Set(['snake', 'kebab']);

const TOKENS: readonly TemplateToken[] = [
  { name: 'asset', summary: 'The sound’s name', description: 'The name.', modifiers: CASES },
  { name: 'number', summary: 'Its place', description: 'Counts.', modifiers: new Set(['2']) },
  { name: 'date', summary: 'The day', description: 'Today.' },
];

const KNOWN = tokensByName(TOKENS);

/** Each segment's kind and text, with a token's problem, for reading at a glance. */
function shape(text: string) {
  return readTemplateSegments(text, KNOWN).map((segment) =>
    segment.kind === 'token'
      ? [segment.kind, segment.text, segment.problem?.kind ?? 'known']
      : [segment.kind, segment.text],
  );
}

describe('reading a template for its highlighting', () => {
  it('finds each token, with its modifier, among the literal text', () => {
    expect(shape('{asset:snake}_{number:2}')).toEqual([
      ['token', '{asset:snake}', 'known'],
      ['text', '_'],
      ['token', '{number:2}', 'known'],
    ]);
    const [first] = readTemplateSegments('{asset:snake}', KNOWN);
    expect(first?.kind === 'token' && first.modifierAt).toBe('{asset'.length);
  });

  it('marks a token the vocabulary does not name, and a modifier its token does not take', () => {
    expect(shape('{take:2}{asset:upper}{date:2}')).toEqual([
      ['token', '{take:2}', 'unknown-token'],
      ['token', '{asset:upper}', 'unaccepted-modifier'],
      ['token', '{date:2}', 'unaccepted-modifier'],
    ]);
  });

  it('reads a doubled brace as one literal brace, and a brace alone as a problem', () => {
    expect(shape('{{v2}}_{asset')).toEqual([
      ['escape', '{{'],
      ['text', 'v2'],
      ['escape', '}}'],
      ['text', '_'],
      ['token', '{', 'lone-brace'],
      ['text', 'asset'],
    ]);
  });

  it('says where each part starts, so it can be drawn under its own text', () => {
    const text = 'a{asset}b{{c';
    const segments = readTemplateSegments(text, KNOWN);
    for (const segment of segments) {
      expect(text.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text);
    }
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('reads every name as known where no vocabulary is given, as an explanation writes one', () => {
    const [token] = readTemplateSegments('{anything:at-all}', undefined);
    expect(token?.kind === 'token' && token.problem).toBeUndefined();
  });

  it('finds the token the caret is inside, and none at its edges', () => {
    const segments = readTemplateSegments('x{asset}y', KNOWN);
    expect(tokenAt(segments, 3)?.text).toBe('{asset}');
    expect(tokenAt(segments, 1)).toBeUndefined();
    expect(tokenAt(segments, 8)).toBeUndefined();
  });
});
