import { expect, type Locator, type Page } from '@playwright/test';

/**
 * What both device suites need to drive the shell.
 *
 * The touch tests run on two engines and the pointer and keyboard tests on one,
 * so they live in separate files and share these rather than each keeping a
 * copy that can drift from the other.
 */

/**
 * One of the menus along the top.
 *
 * A menu bar's triggers are menu items rather than buttons, because a menu bar
 * is one control with several menus in it. That is the role Radix gives them
 * and the role a screen reader announces.
 */
export function menuBarMenu(page: Page, label: string) {
  return page.getByRole('menuitem', { name: label, exact: true });
}

/**
 * Opens AudioGubbins with nothing stored, so every run starts equal.
 *
 * Nothing has to be cleared first. Playwright gives each test its own browser
 * context, so the storage starts empty. Opening the page, emptying the storage
 * and reloading would reload the shell while it is still starting; Firefox
 * logs an InvalidStateError for that, with no stack and no error event in the
 * page, and the console test rightly objects.
 */
export async function openFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

/** The middle of a control, in page coordinates. */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The control is not on screen.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Records the pointer kind of every press the page receives.
 *
 * The device tests assert on this as well as on the outcome. Without it a pen
 * test that quietly fell back to a mouse event would still pass, and the thing
 * being tested is precisely that it did not.
 */
export async function recordPointerKinds(page: Page): Promise<() => Promise<string[]>> {
  const presses = await recordPresses(page);
  return async () => (await presses()).map((press) => press.kind);
}

/** One press the page received: what made it, how hard, and at what angle. */
export interface ReceivedPress {
  readonly kind: string;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
}

/** Records every press the page receives, with its kind and its pressure. */
export async function recordPresses(page: Page): Promise<() => Promise<readonly ReceivedPress[]>> {
  await page.evaluate(() => {
    const seen: { kind: string; pressure: number; tiltX: number; tiltY: number }[] = [];
    Object.defineProperty(window, 'agPresses', { value: seen, configurable: true });
    document.addEventListener(
      'pointerdown',
      (event) => {
        seen.push({
          kind: event.pointerType,
          pressure: event.pressure,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
        });
      },
      true,
    );
  });

  return async () =>
    await page.evaluate((): ReceivedPress[] => {
      const presses: unknown = Reflect.get(window, 'agPresses');
      return Array.isArray(presses) ? presses.filter(isPress) : [];

      function isPress(value: unknown): value is ReceivedPress {
        return (
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          typeof value.kind === 'string' &&
          'pressure' in value &&
          typeof value.pressure === 'number' &&
          'tiltX' in value &&
          typeof value.tiltX === 'number' &&
          'tiltY' in value &&
          typeof value.tiltY === 'number'
        );
      }
    });
}
