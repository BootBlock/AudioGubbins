import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from '../repository.js';
import { read, sourcesMatching } from './source-reading.js';
import {
  EXCEPTIONS,
  describeViolation,
  literalViolations,
  type LiteralKind,
} from './style-literals.js';

/**
 * REQ-UX-155 clause 155.1: a component's stylesheet takes every colour,
 * length, duration and shadow from a token, and the check names each literal
 * it allows with its reason (`EXCEPTIONS` in `style-literals.ts`).
 *
 * The stylesheets read are every one the application and its packages ship,
 * the design system's components, the workspace adapter's and the
 * application's own, but the token definitions themselves.
 */

/** The stylesheet that declares the tokens, where a literal value is a token's definition. */
const TOKEN_DEFINITIONS = 'packages/design-system/src/styles/tokens.css';

/**
 * The stylesheets not yet brought to the design language, each with the work
 * that brings it there, and which the check skips until then. The redesign
 * rewrites each of these, so a literal in one is that work's to remove, not
 * a regression; a stylesheet added or rewritten to the language is never
 * listed. The list only shrinks: a listed stylesheet with no literal left
 * fails the check until it is taken off, and the list must be empty when
 * Phase 16 passes.
 */
const NOT_YET_IN_THE_LANGUAGE: Readonly<Record<string, string>> = {
  'packages/design-system/src/styles/components.css':
    'WU-16.B: each component group moves its components out into a stylesheet of its own, written to the language; what remains is restyled with its owner.',
  'packages/workspace/src/styles/workspace.css':
    "WU-16.C: the dock chrome and tabs, restyled through the workspace adapter and the engine's theming hooks.",
  'apps/web/src/shell/shell.css':
    'WU-16.C for the shell, WU-16.D for the editing panels and WU-16.E for the processing, export and game-audio panels and every dialogue, whose rules this stylesheet holds.',
};

/** Every stylesheet the check reads. */
const COMPONENT_STYLESHEETS = sourcesMatching('{apps,packages}/*/src/**/*.css')
  .filter((path) => path !== TOKEN_DEFINITIONS)
  .toSorted();

/** A fixture's text, kept as text so no other gate reads it as a stylesheet. */
function fixture(name: string): string {
  return readFileSync(
    inRepository('tests', 'architecture', 'fixtures', 'style-literals', name),
    'utf8',
  );
}

/** Each violation in a stylesheet's text, as its line, kind and literal. */
function found(text: string): readonly (readonly [number, LiteralKind, string])[] {
  return literalViolations('fixture.css', text).map(
    (violation) => [violation.line, violation.kind, violation.text] as const,
  );
}

describe('a literal value in a component stylesheet (REQ-UX-155 clause 155.1)', () => {
  it('refuses a literal colour, length, duration and shadow in every form', () => {
    expect(found(fixture('every-literal.css.txt'))).toEqual([
      [3, 'colour', '#1c1d22'],
      [6, 'colour', 'rgb(255 0 0 / 0.5)'],
      [9, 'colour', 'hsl(210 20% 30%)'],
      [12, 'colour', 'oklch(70% 0.1 195)'],
      [15, 'colour', 'rebeccapurple'],
      [18, 'length', '6px'],
      [21, 'length', '12rem'],
      [24, 'length', '0.06em'],
      [27, 'length', '2px'],
      [30, 'length', '28px'],
      [33, 'duration', '120ms'],
      [36, 'duration', '0.3s'],
      [40, 'shadow', '4px'],
      [40, 'shadow', '12px'],
      [43, 'shadow', '4px'],
      [46, 'length', '40px'],
      [50, 'length', '3px'],
      [54, 'length', '85dvh'],
    ]);
  });

  it('accepts tokens, the stated exceptions, and what only looks like a literal', () => {
    expect(found(fixture('tokens-only.css.txt'))).toEqual([]);
  });

  it('allows each exception for a reason it states', () => {
    expect(EXCEPTIONS.map((exception) => exception.name)).toEqual([
      'zero',
      'hairline',
      'whole viewport',
      'colour keyword',
      'system colour',
      'query condition',
    ]);
    expect(EXCEPTIONS.filter((exception) => exception.reason.length < 40)).toEqual([]);
  });

  it('allows a hairline as a width and never as a duration or a second size', () => {
    expect(found('.a { border-width: 1px; transition-duration: 1ms; padding: 1rem; }')).toEqual([
      [1, 'duration', '1ms'],
      [1, 'length', '1rem'],
    ]);
  });

  it('reads the stylesheets it rules on, so a passing check is not passing vacuously', () => {
    expect(COMPONENT_STYLESHEETS).toEqual(
      expect.arrayContaining(Object.keys(NOT_YET_IN_THE_LANGUAGE)),
    );
    expect(COMPONENT_STYLESHEETS).not.toContain(TOKEN_DEFINITIONS);
  });

  it('writes no literal in a stylesheet brought to the language', () => {
    const violations = COMPONENT_STYLESHEETS.filter(
      (path) => !(path in NOT_YET_IN_THE_LANGUAGE),
    ).flatMap((path) => literalViolations(path, read(path)).map(describeViolation));

    expect(violations).toEqual([]);
  });

  it('lists only stylesheets that exist and still hold a literal', () => {
    // A stylesheet brought to the language comes off the list in the same
    // change, so the check reads it from then on.
    const stale = Object.keys(NOT_YET_IN_THE_LANGUAGE).filter(
      (path) =>
        !COMPONENT_STYLESHEETS.includes(path) || literalViolations(path, read(path)).length === 0,
    );
    expect(stale).toEqual([]);
  });

  it('skips no stylesheet once Phase 16 has passed', () => {
    const ledger = JSON.parse(read('docs/spec/traceability/implementation-ledger.json')) as {
      readonly phases: Readonly<Record<string, { readonly status: string }>>;
    };
    const phase = ledger.phases['16'];
    expect(phase, 'the ledger records Phase 16').toBeDefined();
    if (phase?.status === 'PASS') expect(Object.keys(NOT_YET_IN_THE_LANGUAGE)).toEqual([]);
  });
});
