import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCES,
  UNKNOWN_SYSTEM_APPEARANCE,
  oklchToHex,
  resolveTheme,
} from '@audiogubbins/design-system';

/**
 * The colours the page shows before the application exists.
 *
 * They are the only colours written as literals outside the token modules,
 * because they have to be in the page before any script has run: the pre-paint
 * style, the browser-interface colour and the installed application's
 * background. They are written by hand, so without these nothing would say they
 * still match the theme they stand in for: change the default theme and this
 * fails until the page is changed with it.
 */

const APPLICATION_ROOT = join(import.meta.dirname, '..', '..');

/** The default dark theme, as the token system resolves it. */
const DEFAULT_CHROME = resolveTheme(DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE).palette
  .chrome;

const page = readFileSync(join(APPLICATION_ROOT, 'index.html'), 'utf8');
const manifest = JSON.parse(
  readFileSync(join(APPLICATION_ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
) as { background_color: string; theme_color: string };

/** The value a property is given in the page's pre-paint style. */
function prePaint(property: string): string | undefined {
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '';
  return new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`).exec(style)?.[1]?.trim();
}

describe('the colours shown before the application starts', () => {
  const surface = oklchToHex(DEFAULT_CHROME.surfaceBase);
  const text = oklchToHex(DEFAULT_CHROME.textPrimary);

  it('paint the page with the default theme base surface', () => {
    expect(prePaint('background-color')).toBe(surface);
  });

  it('write text in the default theme primary text colour', () => {
    expect(prePaint('color')).toBe(text);
  });

  it('give the browser interface the base surface', () => {
    expect(/<meta name="theme-color" content="([^"]+)"/.exec(page)?.[1]).toBe(surface);
  });

  it('give an installed application the base surface while it starts', () => {
    expect(manifest.background_color).toBe(surface);
    expect(manifest.theme_color).toBe(surface);
  });
});
