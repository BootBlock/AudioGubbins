import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * CLAUDE.md loads into every agent session, so every character it holds costs
 * every task. These budgets are the mechanism behind its "Keep this file small"
 * rule: detail belongs in a memory note that a short rule names, not in the
 * file itself. Raising a budget needs the maintainer's agreement, so treat a
 * failure here as a prompt to shorten or replace a rule.
 */
const GUIDE_BUDGET = 10_000;
const SECTION_BUDGET = 1_200;
const POINTER_BUDGET = 600;

const readGuide = (name: string): string =>
  readFileSync(inRepository(name), 'utf8').replaceAll('\r\n', '\n');

interface Section {
  readonly heading: string;
  readonly length: number;
}

/**
 * Splits on level-2 headings. The text before the first one is the preamble,
 * which carries the authority statement and is budgeted like any other section.
 */
const splitSections = (guide: string): readonly Section[] => {
  const sections: Section[] = [];
  let heading = 'preamble';
  let body: string[] = [];

  const flush = (): void => {
    sections.push({ heading, length: body.join('\n').length });
  };

  for (const line of guide.split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3);
      body = [line];
      continue;
    }
    body.push(line);
  }
  flush();

  return sections;
};

describe('agent guide budgets', () => {
  const guide = readGuide('CLAUDE.md');

  it('keeps CLAUDE.md within its whole-file budget', () => {
    expect(guide.length).toBeLessThanOrEqual(GUIDE_BUDGET);
  });

  it('keeps every CLAUDE.md section within its budget', () => {
    const oversized = splitSections(guide)
      .filter((section) => section.length > SECTION_BUDGET)
      .map((section) => `${section.heading} (${String(section.length)})`);

    expect(oversized).toEqual([]);
  });

  it('keeps AGENTS.md a pointer rather than a copy', () => {
    const pointer = readGuide('AGENTS.md');

    expect(pointer.length).toBeLessThanOrEqual(POINTER_BUDGET);
    expect(pointer).toContain('CLAUDE.md');
  });
});
