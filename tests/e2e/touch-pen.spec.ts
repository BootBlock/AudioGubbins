import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

import {
  openAsset,
  pointAt,
  readingOf,
  samplesInPixelOf,
  scopeOf,
  shownOf,
  surfaceOf,
  writeTimesAs,
} from './editor.js';
import { recordPointerKinds } from './shell.js';
import { test } from './test.js';

/**
 * The editor under a finger and a pen (the packet's `test:touch-pen`,
 * REQ-UX-005, REQ-UX-067): two fingers pinch to zoom and drag to pan, a pen
 * selects as the tool does, and a finger held still opens the context actions
 * without doing what the tool would (Phase 01's F-188).
 *
 * The touches and the pen are the browser's own events, sent through the
 * DevTools protocol, so the page receives what a touch screen and a pen
 * tablet send it.
 */

/** A point of contact the protocol takes. */
interface Contact {
  readonly x: number;
  readonly y: number;
  readonly id: number;
}

async function touches(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: readonly Contact[],
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: [...points] });
}

/** Two fingers from `from` to `to`, a pair of contacts each, in steps. */
async function twoFingers(
  page: Page,
  from: readonly [Contact, Contact],
  to: readonly [Contact, Contact],
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await touches(session, 'touchStart', from);
  for (let step = 1; step <= 10; step += 1) {
    const between = (one: Contact, other: Contact): Contact => ({
      id: one.id,
      x: one.x + ((other.x - one.x) * step) / 10,
      y: one.y + ((other.y - one.y) * step) / 10,
    });
    await touches(session, 'touchMove', [between(from[0], to[0]), between(from[1], to[1])]);
  }
  await touches(session, 'touchEnd', []);
  await session.detach();
}

/** The middle of the first lane of `panel`'s surface. */
async function middleOf(panel: Locator): Promise<{ x: number; y: number }> {
  const box = await surfaceOf(panel).boundingBox();
  if (box === null) throw new Error('The surface is not on screen.');
  return { x: box.x + box.width / 2, y: box.y + 42 + (box.height - 42) / 4 };
}

test.describe('the editor under a finger and a pen', () => {
  test('zooms in with a pinch, about the fingers', async ({ page }) => {
    const panel = await openAsset(page, 'Tone bursts');
    const before = await samplesInPixelOf(panel);
    const { x, y } = await middleOf(panel);

    await twoFingers(
      page,
      [
        { id: 0, x: x - 40, y },
        { id: 1, x: x + 40, y },
      ],
      [
        { id: 0, x: x - 160, y },
        { id: 1, x: x + 160, y },
      ],
    );

    await expect.poll(async () => await samplesInPixelOf(panel)).toBeLessThan(before / 2);
  });

  test('pans with two fingers, the view following them', async ({ page }) => {
    const panel = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, panel, 'Samples');
    await surfaceOf(panel).press('ArrowUp');
    await surfaceOf(panel).press('ArrowUp');
    await surfaceOf(panel).press('End');
    const before = await shownOf(panel);
    const { x, y } = await middleOf(panel);

    // Dragged right, the fingers bring what is to the left into view.
    await twoFingers(
      page,
      [
        { id: 0, x: x - 100, y },
        { id: 1, x: x + 100, y },
      ],
      [
        { id: 0, x: x + 100, y },
        { id: 1, x: x + 300, y },
      ],
    );

    await expect.poll(async () => (await shownOf(panel)).start).toBeLessThan(before.start);
  });

  test('selects time with a pen, as the tool does with a mouse', async ({ page }) => {
    const panel = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, panel, 'Samples');
    await surfaceOf(panel).press('s');
    const kinds = await recordPointerKinds(page);
    const from = await pointAt(panel, 100_000);
    const to = await pointAt(panel, 200_000);

    const session = await page.context().newCDPSession(page);
    const pen = { button: 'left' as const, clickCount: 1, pointerType: 'pen' as const };
    await session.send('Input.dispatchMouseEvent', {
      ...pen,
      ...from,
      type: 'mousePressed',
      force: 0.6,
    });
    for (let step = 1; step <= 10; step += 1) {
      await session.send('Input.dispatchMouseEvent', {
        ...pen,
        x: from.x + ((to.x - from.x) * step) / 10,
        y: from.y,
        type: 'mouseMoved',
        force: 0.6,
      });
    }
    await session.send('Input.dispatchMouseEvent', {
      ...pen,
      ...to,
      type: 'mouseReleased',
      force: 0,
    });
    await session.detach();

    await expect(scopeOf(panel)).toHaveText(/^(99|100),\d{3} to (199|200),\d{3} on channel Left$/u);
    expect(await kinds()).toContain('pen');
  });

  test('opens the context actions on a long press, and does not act as the tool', async ({
    page,
  }) => {
    const panel = await openAsset(page, 'Tone bursts');
    const playhead = await readingOf(panel, 'Playhead').innerText();
    const at = await middleOf(panel);

    const session = await page.context().newCDPSession(page);
    await touches(session, 'touchStart', [{ id: 0, ...at }]);
    await page.waitForTimeout(1_000);
    await touches(session, 'touchEnd', []);
    await session.detach();

    const actions = page.getByRole('menu', { name: 'Editor actions' });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('menuitem', { name: 'Zoom in' })).toBeVisible();
    await expect(readingOf(panel, 'Playhead')).toHaveText(playhead);

    await actions.getByRole('menuitem', { name: 'Zoom in' }).tap();
    await expect(actions).toBeHidden();
  });
});
