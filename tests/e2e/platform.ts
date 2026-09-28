import { expect, type Page } from '@playwright/test';

import { operatingSystemOf, type PlatformSignals } from '@audiogubbins/capabilities';
import {
  PrimaryModifier,
  bindingsFor,
  commandId,
  describeShortcut,
  primaryModifierFor,
  primaryPress,
  shortcut,
  KeyboardConvention,
  type Shortcut,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { UNKNOWN_LAYOUT, type KeyPress } from '@audiogubbins/input';

import {
  BRIGHTNESS_RANGE,
  DEFAULT_THEME_PREFERENCES,
} from '../../packages/design-system/src/tokens/preferences.js';
import { defaultShortcutProfile } from '../../apps/web/src/state/default-shortcuts.js';
import { keyboardConventionFor } from '../../apps/web/src/state/keyboard-convention.js';
import { PREFERENCES_KEY } from '../../apps/web/src/state/preferences-store.js';

/**
 * The keys a browser test presses, for the platform the browser reports.
 *
 * The shipped profile is built for the platform: a Mac user presses Command
 * where a Windows user presses Control, so the key a test presses depends on
 * the browser under test rather than on the machine running the suite. WebKit
 * reports Apple hardware wherever it runs, and the profile it gets binds
 * Command.
 *
 * Nothing here states a binding or a way of writing one. The presses come from
 * the profile the application ships and the text from the function the
 * application writes shortcuts with, so the suite and the application cannot
 * disagree. Written out again here, they would drift apart: a copy of the
 * platform rule would be one more to keep in step with the application's own, a
 * test that pressed Control everywhere would pass vacuously on WebKit, and a
 * copied binding would go on pressing its old key once the profile moved the
 * command to another.
 *
 * The layout is the unknown one, which is what a browser gives before the user
 * has typed anything and what the layout map reports on a US keyboard. Every
 * default's character is then on its US key, which is the key this suite
 * presses.
 */

/** What the page reports about the machine it is running on. */
async function platformSignals(page: Page): Promise<PlatformSignals> {
  return await page.evaluate((): PlatformSignals => {
    // The same three signals the application reads, read the same way.
    const data: unknown = Reflect.get(navigator, 'userAgentData');
    const hint: unknown =
      typeof data === 'object' && data !== null ? Reflect.get(data, 'platform') : undefined;
    return {
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      ...(typeof hint === 'string' && hint !== '' ? { platformHint: hint } : {}),
    };
  });
}

/** The conventions the browser under test writes and reads shortcuts in. */
export async function conventionOf(page: Page): Promise<KeyboardConvention> {
  return keyboardConventionFor(operatingSystemOf(await platformSignals(page)));
}

/** The profile AudioGubbins ships to the browser under test. */
async function shippedProfile(page: Page): Promise<ShortcutProfile> {
  return defaultShortcutProfile(await conventionOf(page), UNKNOWN_LAYOUT);
}

/** One press, as Playwright names a key and its modifiers. */
function asKeyboardArgument(press: KeyPress): string {
  return [
    ...(press.control ? ['Control'] : []),
    ...(press.alt ? ['Alt'] : []),
    ...(press.shift ? ['Shift'] : []),
    ...(press.meta ? ['Meta'] : []),
    press.key,
  ].join('+');
}

/** Presses every press of a shortcut, in order. */
async function press(page: Page, value: Shortcut): Promise<void> {
  for (const one of value.presses) {
    await page.keyboard.press(asKeyboardArgument(one));
  }
}

/** What the shipped profile binds a command to, refusing to guess if it binds nothing. */
async function shortcutFor(page: Page, id: string): Promise<Shortcut> {
  const [binding] = bindingsFor(await shippedProfile(page), commandId(id));
  if (binding === undefined) {
    throw new Error(`The shipped profile binds no shortcut to ${id} on this platform.`);
  }
  return binding;
}

/** Runs a command from the shortcut the shipped profile gives it. */
async function runFromShortcut(page: Page, id: string): Promise<void> {
  await press(page, await shortcutFor(page, id));
}

/** Presses a key with the platform's usual modifier. */
export async function pressPrimary(page: Page, key: string): Promise<void> {
  const modifier = primaryModifierFor(await conventionOf(page));
  await page.keyboard.press(`${modifier === PrimaryModifier.Meta ? 'Meta' : 'Control'}+${key}`);
}

/**
 * Presses the chord prefix.
 *
 * The first press of the palette's own binding, which is where the prefix is
 * decided. Written out here, it would be a second statement of it.
 */
export async function pressPrefix(page: Page): Promise<void> {
  const [first] = (await shortcutFor(page, 'view.command-palette')).presses;
  await page.keyboard.press(asKeyboardArgument(first));
}

/** Opens the command palette from its shortcut. */
export async function openPalette(page: Page): Promise<void> {
  await runFromShortcut(page, 'view.command-palette');
}

/** Opens the settings from their shortcut. */
export async function openSettings(page: Page): Promise<void> {
  await runFromShortcut(page, 'settings.open');
}

/** Brightens the interface once, from its shortcut. */
export async function brighten(page: Page): Promise<void> {
  await runFromShortcut(page, 'view.brighten');
}

/** Darkens the interface once, from its shortcut. */
export async function darken(page: Page): Promise<void> {
  await runFromShortcut(page, 'view.darken');
}

/**
 * Starts every page this test opens at the brightest the control allows, as a
 * reader who left it there would, so the brightness command is refused at its
 * first press. Called before the page is opened.
 *
 * Written as the preferences store writes it, under the store's own key: the
 * shipped defaults with the brightness at the end of its range, and only where
 * nothing is stored, so a reload keeps what the page stored since. Walking
 * there from the middle of the range is ten presses and more; the tests that
 * hold each end of the range walk there with the shortcut, a press at a time.
 */
export async function startAtTheBrightest(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, stored }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, stored);
    },
    {
      key: PREFERENCES_KEY,
      stored: JSON.stringify({
        ...DEFAULT_THEME_PREFERENCES,
        brightness: BRIGHTNESS_RANGE.maximum,
      }),
    },
  );
}

/**
 * Runs the brightness command past the end of its range, where it is
 * unavailable: refused, and said politely, because what it asks for holds
 * already. The page is started there by {@link startAtTheBrightest}.
 */
export async function refuseBrightening(page: Page): Promise<void> {
  await brighten(page);
  await expect(
    page.locator('.ag-live-regions', { hasText: 'already at its brightest' }),
    'Brighten was not refused: the page was not started at the brightest',
  ).toHaveCount(1);
}

/**
 * Settles which layer the system reads a Command press by, where that question
 * exists, to the reading a keyboard that does not switch gives.
 *
 * On Apple hardware a layout can type one set of characters and another while
 * Command is held, so a default whose character sits away from its US key has
 * no right place until a Command press shows which layer the system reads. The
 * shortcut waits until then, and the settings say so. One press settles it,
 * which is what a user's first Command shortcut does; everywhere else there is
 * no layer and this presses nothing.
 *
 * The press is dispatched rather than typed, because what settles the reading
 * is the character the press carries and the machine running the suite decides
 * that. `page.keyboard.press('Meta+KeyV')` reports `key: 'v'` on the US
 * keyboard this runs on, and against a stubbed map that types `k` there the
 * application would read a keyboard that switches under Command — the opposite
 * of the layout the caller stubbed. Both readings write a press the same way,
 * so an assertion on the written text could not tell them apart.
 *
 * A dispatched event is the test's own and is untrusted, so nothing here is
 * evidence about the engine. What `commandLayerOf` rests on — that macOS
 * browsers put the Command layer's character in `event.key` — is not measured
 * by this suite and cannot be, because the layer is macOS's and the keyboard
 * is the one running the suite. The caller presses a real key beside this to
 * show the half the engine does decide: that a Command press reaches the
 * listener at all.
 */
export async function settleCommandLayer(
  page: Page,
  key: { readonly code: string; readonly types: string },
): Promise<void> {
  if ((await conventionOf(page)) !== KeyboardConvention.Apple) return;
  await page.evaluate((press) => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: press.code,
        key: press.types,
        metaKey: true,
        bubbles: true,
      }),
    );
  }, key);
}

/**
 * How this browser writes one press of a key with the usual modifier, so an
 * assertion on shortcut text is right on every platform.
 *
 * Asked of the application's own writer, so the rule that Apple puts Shift
 * before Command with no separator and everywhere else writes `Ctrl+Shift+`
 * with a plus is stated once.
 */
export async function writtenPress(page: Page, key: string): Promise<string> {
  const convention = await conventionOf(page);
  return describeShortcut(
    shortcut(primaryPress(key, primaryModifierFor(convention))),
    convention,
    UNKNOWN_LAYOUT,
  );
}
