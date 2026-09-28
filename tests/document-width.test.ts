import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The width the phase's two living documents are wrapped at.
 *
 * The resume note and the evidence are rewritten in place as the work goes, and
 * Markdown's prose wrapping is set to `preserve`, so no formatter re-flows what
 * an edit leaves: a sentence joined onto a line without re-wrapping it leaves a
 * line longer than the paragraph around it, such as one of 122 characters
 * inside an eighty-column paragraph. The width is the one the paragraphs are
 * written at; a width of a hundred would still pass lines of 94 and 98 beside
 * them. The review record is not held here: it is append-only, and its earlier
 * rounds were written at other widths and stay as they were written.
 */

const WIDTH = 80;

const DOCUMENTS = [
  'docs/todo/done/phase-01-application-foundation.md',
  'docs/spec/reviews/phase-01-evidence.md',
] as const;

/** The prose lines of a Markdown document: not a table row, not fenced code, not blank. */
function proseLines(text: string): readonly { readonly number: number; readonly line: string }[] {
  const lines: { number: number; line: string }[] = [];
  let fenced = false;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || line.startsWith('|') || line.trim() === '') continue;
    lines.push({ number: index + 1, line });
  }
  return lines;
}

describe('the width the living documents are wrapped at', () => {
  it.each(DOCUMENTS)('keeps every prose line of %s within eighty columns', (document) => {
    const lines = proseLines(readFileSync(inRepository(document), 'utf8'));

    expect(lines.length).toBeGreaterThan(100);
    expect(
      lines
        .filter(({ line }) => line.length > WIDTH)
        .map(({ number, line }) => `${String(number)}: ${String(line.length)}`),
    ).toEqual([]);
  });

  it('reads a table row and fenced code as neither being prose', () => {
    const wide = 'x'.repeat(WIDTH + 1);

    expect(proseLines(`| ${wide} |\n\`\`\`\n${wide}\n\`\`\`\nprose`)).toEqual([
      { number: 5, line: 'prose' },
    ]);
  });
});
