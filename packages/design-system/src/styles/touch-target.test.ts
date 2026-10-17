/**
 * The widened hit area of a small control, under each kind of pointer.
 *
 * jsdom neither evaluates a media query nor hit-tests, so the stylesheet is
 * read as the browser's object model reads it, and the rules a page would
 * apply are chosen by the media features of one kind of device: a mouse, or
 * a finger. A media query this test cannot judge fails it, rather than being
 * guessed at.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The media features a device reports, by name. */
type Device = Readonly<Record<string, string>>;

const MOUSE: Device = { pointer: 'fine', 'any-pointer': 'fine', 'forced-colors': 'none' };

const FINGER: Device = { pointer: 'coarse', 'any-pointer': 'coarse', 'forced-colors': 'none' };

const FEATURE = /^\(\s*([a-z-]+)\s*:\s*([a-z-]+)\s*\)$/;

/** Whether a device matches a media query made of features joined by `and`. */
function matches(query: string, device: Device): boolean {
  return query.split(/\s+and\s+/).every((condition) => {
    const feature = FEATURE.exec(condition.trim());
    const name = feature?.[1];
    const value = feature?.[2];
    if (name === undefined || value === undefined || !(name in device)) {
      throw new Error(`The test cannot judge the media query "${query}"`);
    }
    return device[name] === value;
  });
}

/** The style rules a device applies, from a list of rules and the media rules inside it. */
function applied(rules: CSSRuleList, device: Device): readonly CSSStyleRule[] {
  return [...rules].flatMap((rule) => {
    if (rule instanceof CSSMediaRule) {
      return matches(rule.media.mediaText, device) ? applied(rule.cssRules, device) : [];
    }
    return rule instanceof CSSStyleRule ? [rule] : [];
  });
}

/** The base stylesheet, as the page's object model holds it. */
function baseStylesheet(): CSSStyleSheet {
  const style = document.createElement('style');
  // By path: jsdom puts its own `URL` in place of Node's, which the file
  // system does not take.
  style.textContent = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
  document.head.append(style);
  const sheet = style.sheet;
  if (sheet === null) throw new Error('The base stylesheet was not parsed');
  return sheet;
}

/** The size the widened hit area is given, for each rule a device applies to it. */
function widenedArea(device: Device): readonly string[] {
  return applied(baseStylesheet().cssRules, device)
    .filter((rule) => rule.selectorText.includes('.ag-touch-target::after'))
    .map((rule) => rule.style.getPropertyValue('min-inline-size'))
    .filter((size) => size !== '');
}

describe('the touch target', () => {
  it('leaves a mouse the control’s drawn size, so a click never presses its neighbour', () => {
    // An icon button in a compact toolbar sits two pixels from the next; an
    // area widened to 44 pixels reached over it, and a click aimed at one
    // button pressed the other.
    expect(widenedArea(MOUSE)).toEqual([]);
  });

  it('widens a finger’s hit area to the touch target', () => {
    expect(widenedArea(FINGER)).toEqual(['var(--ag-control-minimum-touch-target, 44px)']);
  });
});
