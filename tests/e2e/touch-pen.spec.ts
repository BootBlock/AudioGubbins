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
 * DevTools protocol, so the page receives what a touch screen and a pen tablet
 * send it.
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

/** The boundary under the page's `x` on `panel`'s surface, as the panel writes it in samples. */
async function boundaryUnder(panel: Locator, x: number): Promise<number> {
  const box = await surfaceOf(panel).boundingBox();
  if (box === null) throw new Error('The surface is not on screen.');
  const { start } = await shownOf(panel);
  return start + (x - box.x - 1) * (await samplesInPixelOf(panel));
}

/** Where on the page boundary `position` is drawn on `panel`'s surface. */
async function pageXOf(panel: Locator, position: number): Promise<number> {
  return (await pointAt(panel, position)).x;
}

/** A pen pressed at `at`, held there as a hand holds one, for `ms`, and lifted. */
async function holdPen(page: Page, at: { x: number; y: number }, ms: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const pen = { button: 'left' as const, clickCount: 1, pointerType: 'pen' as const };
  await session.send('Input.dispatchMouseEvent', {
    ...pen,
    ...at,
    type: 'mousePressed',
    force: 0.4,
  });
  // A pen held still reports its pressure changing, and a pixel of drift.
  for (const [dx, force] of [
    [0, 0.5],
    [1, 0.6],
    [1, 0.55],
  ] as const) {
    await page.waitForTimeout(ms / 4);
    await session.send('Input.dispatchMouseEvent', {
      ...pen,
      x: at.x + dx,
      y: at.y,
      type: 'mouseMoved',
      force,
    });
  }
  await page.waitForTimeout(ms / 4);
  await session.send('Input.dispatchMouseEvent', {
    ...pen,
    ...at,
    type: 'mouseReleased',
    force: 0,
  });
  await session.detach();
}

/** Checks the context actions are open, and chooses Zoom in from them with a finger. */
async function expectContextActions(page: Page): Promise<void> {
  const actions = page.getByRole('menu', { name: 'Editor actions' });
  await expect(actions).toBeVisible();
  await actions.getByRole('menuitem', { name: 'Zoom in' }).tap();
  await expect(actions).toBeHidden();
}

test.describe('the editor under a finger and a pen', () => {
  test('zooms in with a pinch, about the fingers', async ({ page }) => {
    const panel = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, panel, 'Samples');
    const before = await samplesInPixelOf(panel);
    const { x, y } = await middleOf(panel);
    const under = await boundaryUnder(panel, x);

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
    // The fingers spread evenly about `x`, so the audio between them stays
    // there: a zoom about the left edge would carry it hundreds of pixels off.
    expect(Math.abs((await pageXOf(panel, under)) - x)).toBeLessThanOrEqual(1);
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

  test('opens the context actions for a finger held 600 ms that shifts a little', async ({
    page,
  }) => {
    // The menu's own long press waited 700 ms and was given up at the first
    // move, so a hold of 600 ms, or one that moved by two pixels, dropped the
    // tool's press at 500 ms and opened nothing: the gesture did nothing.
    const panel = await openAsset(page, 'Tone bursts');
    const playhead = await readingOf(panel, 'Playhead').innerText();
    const scope = await scopeOf(panel).innerText();
    const at = await middleOf(panel);

    const session = await page.context().newCDPSession(page);
    await touches(session, 'touchStart', [{ id: 0, ...at }]);
    await page.waitForTimeout(200);
    await touches(session, 'touchMove', [{ id: 0, x: at.x + 2, y: at.y + 1 }]);
    await page.waitForTimeout(400);
    await touches(session, 'touchEnd', []);
    await session.detach();

    await expect(readingOf(panel, 'Playhead')).toHaveText(playhead);
    await expect(scopeOf(panel)).toHaveText(scope);
    await expectContextActions(page);
  });

  test('opens the context actions for a pen held still, and does not act as the tool', async ({
    page,
  }) => {
    const panel = await openAsset(page, 'Tone bursts');
    const playhead = await readingOf(panel, 'Playhead').innerText();
    const scope = await scopeOf(panel).innerText();
    const kinds = await recordPointerKinds(page);

    await holdPen(page, await middleOf(panel), 800);

    await expect(readingOf(panel, 'Playhead')).toHaveText(playhead);
    await expect(scopeOf(panel)).toHaveText(scope);
    expect(await kinds()).toContain('pen');
    await expectContextActions(page);
  });
});
