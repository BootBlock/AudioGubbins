/**
 * A stylesheet read as the CSS Syntax Module reads it: tokens, then the rules,
 * declarations and at-rules they make up.
 *
 * The literal-value rule needs what a pattern over the text cannot give it: a
 * number with its unit, the function it is an argument of, the property it is
 * the value of, and whether it is in a declaration at all or in a selector, a
 * comment, a string or a media query. The stylesheet transformer the build
 * uses parses each value into its own typed form, which loses what the source
 * said: `transparent` and `rgb(0 0 0 / 0)` come back as one colour, and a
 * declaration carries no position to report. So the source is tokenised here,
 * to the specification's token kinds, with each token's line and column.
 */

/** A token of the stylesheet, with where it starts. */
export type CssToken = { readonly line: number; readonly column: number } & (
  | { readonly type: 'whitespace' }
  | { readonly type: 'string' }
  | { readonly type: 'url' }
  | { readonly type: 'ident'; readonly value: string }
  | { readonly type: 'function'; readonly name: string }
  | { readonly type: 'at-keyword'; readonly name: string }
  | { readonly type: 'hash'; readonly value: string }
  | { readonly type: 'number'; readonly value: number; readonly text: string }
  | { readonly type: 'percentage'; readonly value: number; readonly text: string }
  | {
      readonly type: 'dimension';
      readonly value: number;
      readonly unit: string;
      readonly text: string;
    }
  | { readonly type: Punctuation }
  | { readonly type: 'delim'; readonly value: string }
);

/** The punctuation tokens, which carry nothing but their kind. */
type Punctuation = 'colon' | 'semicolon' | 'comma' | '(' | ')' | '[' | ']' | '{' | '}';

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_CHARACTER = /[\w\u0080-￿-]/;
const NAME_START = /[A-Za-z_\u0080-￿]/;

/** Whether the text at `index` starts an identifier, as §4.3.9 decides it. */
function startsIdentifier(text: string, index: number): boolean {
  const first = text[index] ?? '';
  const second = text[index + 1] ?? '';
  if (first === '-') {
    return (
      NAME_START.test(second) || second === '-' || (second === '\\' && text[index + 2] !== '\n')
    );
  }
  if (first === '\\') return second !== '\n' && second !== '';
  return NAME_START.test(first);
}

/** Whether the text at `index` starts a number. */
function startsNumber(text: string, index: number): boolean {
  return NUMBER.test(text.slice(index, index + 3));
}

/** The name starting at `index`, escapes kept as written, and where it ends. */
function readName(text: string, index: number): { readonly name: string; readonly end: number } {
  let end = index;
  while (end < text.length) {
    if (text[end] === '\\' && text[end + 1] !== '\n') end += 2;
    else if (NAME_CHARACTER.test(text[end] ?? '')) end += 1;
    else break;
  }
  return { name: text.slice(index, end), end };
}

/** Where a quoted string starting at `index` ends, past its closing quote or at a line break. */
function stringEnd(text: string, index: number): number {
  const quote = text[index];
  let end = index + 1;
  while (end < text.length && text[end] !== quote && text[end] !== '\n') {
    end += text[end] === '\\' ? 2 : 1;
  }
  return end + 1;
}

const PUNCTUATION: Readonly<Record<string, Punctuation>> = {
  ':': 'colon',
  ';': 'semicolon',
  ',': 'comma',
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '{': '{',
  '}': '}',
};

/** The tokens of a stylesheet, with comments left out, as a browser leaves them out. */
export function tokenise(text: string): readonly CssToken[] {
  const tokens: CssToken[] = [];
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lineStarts.push(index + 1);
  }
  let line = 0;
  const at = (offset: number): { line: number; column: number } => {
    while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? Infinity) <= offset) line += 1;
    return { line: line + 1, column: offset - (lineStarts[line] ?? 0) + 1 };
  };

  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? '';
    const position = at(index);

    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2);
      index = close === -1 ? text.length : close + 2;
    } else if (/\s/.test(character)) {
      while (/\s/.test(text[index] ?? '')) index += 1;
      tokens.push({ ...position, type: 'whitespace' });
    } else if (character === '"' || character === "'") {
      index = stringEnd(text, index);
      tokens.push({ ...position, type: 'string' });
    } else if (startsNumber(text, index)) {
      const number = NUMBER.exec(text.slice(index))?.[0] ?? '';
      const value = Number(number);
      index += number.length;
      if (text[index] === '%') {
        index += 1;
        tokens.push({ ...position, type: 'percentage', value, text: `${number}%` });
      } else if (startsIdentifier(text, index)) {
        const { name, end } = readName(text, index);
        index = end;
        tokens.push({
          ...position,
          type: 'dimension',
          value,
          unit: name.toLowerCase(),
          text: `${number}${name}`,
        });
      } else {
        tokens.push({ ...position, type: 'number', value, text: number });
      }
    } else if (startsIdentifier(text, index)) {
      const { name, end } = readName(text, index);
      index = end;
      if (text[index] === '(') {
        index += 1;
        if (name.toLowerCase() === 'url' && !/^\s*['"]/.test(text.slice(index))) {
          // An unquoted address is one token to its closing parenthesis.
          const close = text.indexOf(')', index);
          index = close === -1 ? text.length : close + 1;
          tokens.push({ ...position, type: 'url' });
        } else {
          tokens.push({ ...position, type: 'function', name: name.toLowerCase() });
        }
      } else {
        tokens.push({ ...position, type: 'ident', value: name });
      }
    } else if (character === '@' && startsIdentifier(text, index + 1)) {
      const { name, end } = readName(text, index + 1);
      index = end;
      tokens.push({ ...position, type: 'at-keyword', name: name.toLowerCase() });
    } else if (character === '#' && NAME_CHARACTER.test(text[index + 1] ?? '')) {
      const { name, end } = readName(text, index + 1);
      index = end;
      tokens.push({ ...position, type: 'hash', value: name });
    } else {
      index += 1;
      const punctuation = PUNCTUATION[character];
      tokens.push(
        punctuation === undefined
          ? { ...position, type: 'delim', value: character }
          : { ...position, type: punctuation },
      );
    }
  }
  return tokens;
}
