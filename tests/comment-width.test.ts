import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { EVERY_WRITTEN_FILE, read } from './architecture/source-reading.js';
import { inRepository } from './repository.js';

/**
 * The width a comment of more than one line is held to, and how it is filled.
 *
 * Prettier wraps code at its print width and leaves comments as they are
 * written, so words appended to a line of a comment are never re-flowed, and
 * words taken from one leave it short in the middle of its paragraph. A
 * comment of one line is not held here: it is a summary or a directive, often
 * longer than a paragraph's lines, and has no paragraph to be re-flowed into.
 */

/** The width Prettier wraps code at, which it leaves a comment's lines past. */
const PRINT_WIDTH = (
  JSON.parse(readFileSync(inRepository('.prettierrc.json'), 'utf8')) as { printWidth: number }
).printWidth;

/**
 * The width this tree's comments are written at, within the print width,
 * which holds code. Every line of a comment of more than one line is held to
 * it, a paragraph of one line among them.
 */
const WRITTEN_AT = 80;

/** Where a comment starts and ends in a file's text, and whether it is a block. */
interface CommentRange {
  readonly pos: number;
  readonly end: number;
  readonly block: boolean;
}

/**
 * Every comment in a script, read by the parser: a `/*` inside a string or a
 * glob is not one.
 */
function scriptComments(path: string, text: string): readonly CommentRange[] {
  const kind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.[mc]?js$/u.test(path)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map<number, CommentRange>();
  const take = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      found.set(range.pos, {
        pos: range.pos,
        end: range.end,
        block: range.kind === ts.SyntaxKind.MultiLineCommentTrivia,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    take(ts.getLeadingCommentRanges(text, node.getFullStart()));
    take(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return [...found.values()].toSorted((one, other) => one.pos - other.pos);
}

/** Every comment in a stylesheet, which has block comments alone. */
function stylesheetComments(text: string): readonly CommentRange[] {
  return Array.from(text.matchAll(/\/\*[\s\S]*?\*\//gu), (match) => ({
    pos: match.index,
    end: match.index + match[0].length,
    block: true,
  }));
}

/** A line of a comment, with where it is. */
interface CommentLine {
  readonly number: number;
  readonly line: string;
}

/**
 * The lines of every comment in a file that runs to two lines or more: a block
 * comment whose opening and closing are on different lines, and a run of two
 * or more line comments, each alone on its line, one under another.
 */
function paragraphLines(path: string, text: string): readonly CommentLine[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  // The last line starting at or before an offset, found by halving.
  const lineAt = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const comments = path.endsWith('.css') ? stylesheetComments(text) : scriptComments(path, text);

  const numbers = new Set<number>();
  let run: number[] = [];
  const endRun = (): void => {
    if (run.length > 1) for (const number of run) numbers.add(number);
    run = [];
  };
  for (const comment of comments) {
    const first = lineAt(comment.pos);
    if (comment.block) {
      endRun();
      const last = lineAt(comment.end - 1);
      if (last > first) for (let number = first; number <= last; number += 1) numbers.add(number);
      continue;
    }
    // A directive to the linter is read by a tool and cannot be wrapped, so it
    // is no line of the paragraph above it.
    const written = (lines[first] ?? '').trimStart();
    if (!written.startsWith('//') || /^\/\/\s*eslint-/u.test(written)) {
      endRun();
      continue;
    }
    if (run.length > 0 && run.at(-1) !== first - 1) endRun();
    run.push(first);
  }
  endRun();

  return [...numbers]
    .toSorted((one, other) => one - other)
    .map((index) => ({ number: index + 1, line: (lines[index] ?? '').replace(/\r$/u, '') }));
}

/**
 * The mark a line of a comment begins with, and the indent before it. A line
 * of a stylesheet's comment may have none.
 */
const MARK = /^\s*(?:\{\/\*|\/\*\*?|\*\/\}?|\*|\/\/)/u;

/** A line's text inside its comment: without the marks and the indent. */
function bodyOf(line: string): string {
  return line
    .replace(MARK, '')
    .replace(/\*\/\}?\s*$/u, '')
    .trim();
}

/**
 * How far a line's text is indented inside its comment: the spaces after its
 * mark, or before its text where it has no mark.
 */
function indentOf(line: string): number {
  const inside = line.replace(MARK, '');
  return inside.length - inside.trimStart().length;
}

/**
 * The paragraphs of a file's comments of more than one line, from their
 * lines: the runs of lines with text between the lines of a comment that have
 * none.
 */
function paragraphsOf(lines: readonly CommentLine[]): readonly (readonly CommentLine[])[] {
  const paragraphs: CommentLine[][] = [];
  let current: CommentLine[] = [];
  let previous = -1;
  for (const line of lines) {
    if (line.number !== previous + 1 || bodyOf(line.line) === '') {
      if (current.length > 0) paragraphs.push(current);
      current = [];
    }
    if (bodyOf(line.line) !== '') current.push(line);
    previous = line.number;
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

/** The lines of a paragraph that run past the width comments are written at. */
function pastTheWidth(paragraph: readonly CommentLine[]): readonly CommentLine[] {
  return paragraph.filter(({ line }) => line.length > WRITTEN_AT);
}

/**
 * The words of a line of a comment. A code span and an inline tag are each one
 * word with whatever is written against them, because neither can be broken
 * across two lines and still be read as what it is.
 */
function wordsOf(body: string): readonly string[] {
  return body.match(/(?:`[^`]*`|\{@[^}]*\}|[^\s`]|`)+/gu) ?? [];
}

/** Whether a line of a comment fences code: it begins with three backticks. */
const fences = (body: string): boolean => body.startsWith('```');

/**
 * The columns at which a line's text resumes after a run of two spaces or
 * more. Its marks are read as spaces, and its code spans, which may hold any
 * spaces, as text.
 */
function columnsOf(line: string): ReadonlySet<number> {
  const masked = line
    .replace(MARK, (mark) => ' '.repeat(mark.length))
    .replace(/\*\/\}?\s*$/u, (close) => ' '.repeat(close.length))
    .replaceAll(/`[^`]*`/gu, (span) => '`'.repeat(span.length));
  return new Set(
    Array.from(masked.matchAll(/(?<=\S) {2,}(?=\S)/gu), (run) => run.index + run[0].length),
  );
}

/**
 * Which lines of a paragraph have a column of a table: a run of spaces after
 * which the text resumes where the text of the line above or below it resumes
 * after one too. Two spaces in prose, after a full stop, line up with none.
 */
function alignedLines(paragraph: readonly CommentLine[]): readonly boolean[] {
  const columns = paragraph.map(({ line }) => columnsOf(line));
  return columns.map((own, index) => {
    const aligned = (beside: ReadonlySet<number> | undefined): boolean =>
      beside !== undefined && [...own].some((column) => beside.has(column));
    return aligned(columns[index - 1]) || aligned(columns[index + 1]);
  });
}

/** Whether a line of a comment begins an item of a list, or a tag. */
const beginsAnItem = (body: string): boolean => /^(?:[-*+]|\d+[.)]|@\w+)(?:\s|$)/u.test(body);

/**
 * Which lines of a paragraph are laid out rather than filled: a line of a
 * table, a fence around code, and a line indented deeper than the paragraph's
 * first, such as a usage example. A line under an item of a list or a tag is
 * in that item, whose words run on under its mark, and is filled.
 */
function laidOutLines(paragraph: readonly CommentLine[]): readonly boolean[] {
  const aligned = alignedLines(paragraph);
  let first: number | undefined;
  // The lines above the one being read that each line after them is deeper
  // than, and whether each is in an item. With those at its indent or deeper
  // taken off, the last is the line it is written under.
  const above: { readonly indent: number; readonly inAnItem: boolean }[] = [];
  return paragraph.map(({ line }, index) => {
    const body = bodyOf(line);
    const indent = indentOf(line);
    first ??= indent;
    while ((above.at(-1)?.indent ?? -1) >= indent) above.pop();
    const inAnItem = beginsAnItem(body) || (above.at(-1)?.inAnItem ?? false);
    above.push({ indent, inAnItem });
    const table = body.startsWith('|') || aligned[index] === true;
    return table || fences(body) || (indent > first && !inAnItem);
  });
}

/**
 * The numbers of the lines of a file's comments that are code between two
 * fences, which is written as it runs rather than filled, from their lines.
 */
function fencedLines(lines: readonly CommentLine[]): ReadonlySet<number> {
  const fenced = new Set<number>();
  let inside = false;
  let previous = -1;
  for (const { number, line } of lines) {
    if (number !== previous + 1) inside = false;
    previous = number;
    if (fences(bodyOf(line))) inside = !inside;
    else if (inside) fenced.add(number);
  }
  return fenced;
}

/**
 * A file's comments of more than one line, read once for every rule: their
 * lines, their paragraphs, and which of their lines are code between fences.
 */
interface FileComments {
  readonly lines: readonly CommentLine[];
  readonly paragraphs: readonly (readonly CommentLine[])[];
  readonly fenced: ReadonlySet<number>;
}

/** A file's comments of more than one line, read from its text. */
function commentsOf(path: string, text: string): FileComments {
  const lines = paragraphLines(path, text);
  return { lines, paragraphs: paragraphsOf(lines), fenced: fencedLines(lines) };
}

/**
 * The lines of a file's comment paragraphs left short: a line the first word
 * of the next would fit on, within the width its paragraph is written at and
 * within the width comments are written at. A line of a table or of code, and
 * a line before an item of a list or a tag, are laid out and never short.
 */
function shortLines({ paragraphs, fenced }: FileComments): readonly CommentLine[] {
  return paragraphs.flatMap((paragraph) => {
    const room = Math.min(WRITTEN_AT, Math.max(...paragraph.map(({ line }) => line.length)));
    const laidOut = laidOutLines(paragraph);
    return paragraph.filter((one, index) => {
      const next = paragraph[index + 1];
      if (next === undefined || fenced.has(one.number) || fenced.has(next.number)) return false;
      const following = bodyOf(next.line);
      if (laidOut[index] === true || laidOut[index + 1] === true || beginsAnItem(following)) {
        return false;
      }
      const [word = ''] = wordsOf(following);
      return one.line.length + 1 + word.length <= room;
    });
  });
}

/**
 * The lines of a file's comments that open a code span or an inline tag and
 * leave it for the next line to close, which reads as two fragments where
 * one was written. Three marks together fence code and open no span, and a
 * tag's braces inside a code span are code.
 */
function brokenSpans({ lines, fenced }: FileComments): readonly CommentLine[] {
  return lines.filter(({ number, line }) => {
    if (fenced.has(number)) return false;
    const body = bodyOf(line).replaceAll('```', '');
    if ((body.match(/`/gu) ?? []).length % 2 === 1) return true;
    return /\{@[^}]*$/u.test(body.replaceAll(/`[^`]*`/gu, ''));
  });
}

/**
 * The comments of each file of the tree, read by the first rule that asks for
 * a file's and kept for the rest: a file is read and parsed once, not once for
 * each rule.
 */
const TREE_COMMENTS = new Map<string, FileComments>();

/** A file of the tree's comments of more than one line. */
function commentsIn(path: string): FileComments {
  let comments = TREE_COMMENTS.get(path);
  if (comments === undefined) {
    comments = commentsOf(path, read(path));
    TREE_COMMENTS.set(path, comments);
  }
  return comments;
}

/**
 * Where each of a set of lines is, in each file of the tree, with its length.
 * A tree read as empty has no such line, so every rule over it would pass.
 */
function inTheTree(lines: (comments: FileComments) => readonly CommentLine[]): readonly string[] {
  expect(EVERY_WRITTEN_FILE.length).toBeGreaterThan(100);
  return EVERY_WRITTEN_FILE.flatMap((path) =>
    lines(commentsIn(path)).map(
      ({ number, line }) => `${path}:${String(number)}: ${String(line.length)}`,
    ),
  );
}

describe('the width a comment is wrapped at', () => {
  it('writes comments at a width within the print width, which Prettier leaves them past', () => {
    expect(WRITTEN_AT).toBeLessThanOrEqual(PRINT_WIDTH);
  });

  it('keeps every line of a comment of more than one line within the width comments are written at', () => {
    expect(inTheTree(({ paragraphs }) => paragraphs.flatMap(pastTheWidth))).toEqual([]);
  });

  it('leaves no line of a comment short of the first word of the line after it', () => {
    expect(inTheTree(shortLines)).toEqual([]);
  });

  it('breaks no line of a comment inside a code span or an inline tag', () => {
    expect(inTheTree(brokenSpans)).toEqual([]);
  });

  it('reads a paragraph as the lines of one comment between those with no text', () => {
    const long = `// ${'word '.repeat(16)}more`;
    const text = [
      '/**',
      ' * A first paragraph of two lines, the second',
      ' * shorter.',
      ' *',
      ` * ${'even '.repeat(15)}`,
      ` * ${'even '.repeat(15)}`,
      ' */',
      '// A run of line comments whose last line is appended to,',
      '// past the width the rest is written at:',
      long,
      // A line past the width beside one within it, a paragraph of one line
      // past it, and a paragraph whose every line is past it.
      '/*',
      ` * ${'x'.repeat(77)}`,
      ` * ${'x'.repeat(79)}`,
      ' *',
      ` * ${'y'.repeat(79)}`,
      ' *',
      ` * ${'z'.repeat(78)}`,
      ` * ${'z'.repeat(80)}`,
      ' */',
    ].join('\n');

    const { paragraphs } = commentsOf('example.ts', text);
    expect(paragraphs.map((one) => one.map(({ number }) => number))).toEqual([
      [2, 3],
      [5, 6],
      [8, 9, 10],
      [12, 13],
      [15],
      [17, 18],
    ]);
    expect(paragraphs.flatMap(pastTheWidth).map(({ number }) => number)).toEqual([
      10, 13, 15, 17, 18,
    ]);
  });

  it('reads a line as short where the first word of the next fits on it, a code span or a tag as one word', () => {
    const text = [
      '/**',
      ' * The first line of this paragraph stops short of the width,',
      ' * leaving room for the word that begins the next line, which fits there.',
      ' *',
      ' * A line followed by a code span, which is one word,',
      ' * `however many words it holds` and the rest of the line after it.',
      ' *',
      ' * A line followed by an inline tag, which is one word too,',
      ' * {@link aNameLongerThanTheRoomLeft} and the rest of the line after it.',
      ' *',
      ' * The forms a list takes:',
      ' * - an item, which begins a line of its own whatever room is left above,',
      ' *   and runs on under its own mark.',
      ' * - another.',
      ' *',
      ' *   name       what it is',
      ' *   other      a column laid out with spaces',
      ' *',
      ' * A paragraph wrapped',
      ' * narrow, at a width',
      ' * of its own.',
      ' *',
      ' * ```',
      ' * x;',
      ' * y = longer;',
      ' * ```',
      ' *',
      ' * A line before a tag stops short,',
      ' * @param name a tag, which begins a line of its own whatever room is left.',
      ' *',
      ' * A paragraph whose first line runs on to set the width it is written at,',
      ' * and whose last line stops short:',
      ' * ```',
      ' * y;',
      ' * ```',
      ' *',
      ' * Usage:',
      ' *   node tools/check.mjs',
      ' *   node tools/check.mjs --record <file>',
      ' *',
      ' * A line whose code span holds `two  spaces` stops short,',
      ' * leaving room for the word that begins the next line, which fits there.',
      ' *',
      ' * A list whose item is left short:',
      ' * - an item left short',
      ' *   before the words that run on under its own mark.',
      ' *',
      ' * A sentence ends here.  The next stops short,',
      ' * leaving room for the word that begins the next line, which fits there.',
      ' *',
      ' * The span in `x  y` leaves this line short,',
      ' * the span in `x  y` under it lines up, and no table is read from the two.',
      ' */',
    ].join('\n');

    expect(shortLines(commentsOf('example.ts', text)).map(({ number }) => number)).toEqual([
      2, 41, 45, 48, 51,
    ]);
  });

  it('reads a code span left open at the end of a line, and no fence as one', () => {
    const text = [
      '/**',
      ' * A code span broken across `two',
      ' * lines` of a comment, and one `whole` on its line.',
      ' */',
      '// A line comment whose span `closes` on it,',
      '// and three marks, ```, which fence code.',
      '/**',
      ' * ```',
      ' * const tick = `;',
      ' * ```',
      ' */',
    ].join('\n');

    expect(brokenSpans(commentsOf('example.ts', text)).map(({ number }) => number)).toEqual([2, 3]);
  });

  it('reads an inline tag left open at the end of a line, and none closed on it or in code', () => {
    const text = [
      '/**',
      ' * A side group dragged wider than {@link',
      ' * EDGE_SHARE} reads as two fragments, and {@link WHOLE} as one word.',
      ' * A brace in code, `{@link`, opens no tag.',
      ' */',
    ].join('\n');

    expect(brokenSpans(commentsOf('example.ts', text)).map(({ number }) => number)).toEqual([2]);
  });

  it('reads a block comment and a run of line comments, and no comment of one line', () => {
    const text = [
      '/** one line */',
      '// alone',
      "const glob = 'packages/*/src';",
      '/**',
      ' * inside',
      ' */',
      '// first',
      '// second',
      'const x = 1; // trailing',
      '// after code',
      '// eslint-disable-next-line no-console -- a directive',
      'console.log(x);',
    ].join('\n');

    expect(paragraphLines('example.ts', text).map(({ number }) => number)).toEqual([4, 5, 6, 7, 8]);
  });

  it('reads a stylesheet comment of more than one line, and none of one', () => {
    const text = ['/* one */', 'a { color: red; }', '/*', '  inside', '*/'].join('\n');

    expect(paragraphLines('example.css', text).map(({ number }) => number)).toEqual([3, 4, 5]);
  });
});
