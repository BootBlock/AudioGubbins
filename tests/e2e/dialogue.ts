import { expect, type Locator, type Page } from '@playwright/test';

import { openPalette, openSettings } from './platform.js';
import { menuBarMenu } from './shell.js';

/**
 * A dialogue, measured and driven the same way by every suite that opens one:
 * the accessibility suite with a mouse and a keyboard, and the touch suite with
 * a finger, where the controls a dialogue holds are drawn taller. The measures
 * are run in the page, and the drivers around them in the test.
 */

/** A box on the page, in CSS pixels from the window's top left corner. */
export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * What of an element the reader can see, and what cuts the rest, with the
 * style, the width and the reach of its outline as the engine reports them.
 */
export interface Sight {
  readonly drawn: Box;
  readonly seen: Box;
  readonly cutBy: readonly string[];
  readonly outline: string;
  readonly width: number;
  readonly reach: number;
}

/**
 * How far apart two edges may be read and still be one edge.
 *
 * An engine draws an edge on a whole device pixel, which at a ratio of one lies
 * up to half a CSS pixel from where the edge is laid out, so a box read against
 * the box that clips it can be read that far past it with nothing cut.
 */
export const HALF_A_PIXEL = 0.5;

/**
 * How much of `node` the reader can see: its box, or with `withRing` the box
 * its focus ring is drawn in, cut on both axes by the window and by every
 * ancestor that clips, with the name of each that cut it.
 *
 * Every ancestor, not the dialogue alone. The part that scrolls and the footer
 * are containers of their own inside the dialogue's box, and read against that
 * box a control or a refusal they cut would still count as in sight. Both axes,
 * because a field wider than its container is cut at the side.
 *
 * Run in the page, where nothing of this module is, so the tolerance an edge is
 * read to is passed in: {@link HALF_A_PIXEL}.
 */
function sightOf(
  node: Element,
  { withRing, tolerance }: { readonly withRing: boolean; readonly tolerance: number },
): Sight {
  const style = getComputedStyle(node);
  const reach = withRing
    ? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
    : 0;
  const box = node.getBoundingClientRect();
  const drawn = {
    top: box.top - reach,
    bottom: box.bottom + reach,
    left: box.left - reach,
    right: box.right + reach,
  };
  const seen = { ...drawn };
  const cutBy: string[] = [];
  const within = (name: string, top: number, left: number, height: number, width: number) => {
    if (
      drawn.top < top - tolerance ||
      drawn.bottom > top + height + tolerance ||
      drawn.left < left - tolerance ||
      drawn.right > left + width + tolerance
    ) {
      cutBy.push(name);
    }
    seen.top = Math.max(seen.top, top);
    seen.bottom = Math.min(seen.bottom, top + height);
    seen.left = Math.max(seen.left, left);
    seen.right = Math.min(seen.right, left + width);
  };
  within('the window', 0, 0, window.innerHeight, window.innerWidth);
  for (let clip = node.parentElement; clip !== null; clip = clip.parentElement) {
    const clipStyle = getComputedStyle(clip);
    if (clipStyle.overflowX === 'visible' && clipStyle.overflowY === 'visible') continue;
    const outer = clip.getBoundingClientRect();
    within(
      clip.className === '' ? clip.tagName : clip.className,
      outer.top + clip.clientTop,
      outer.left + clip.clientLeft,
      clip.clientHeight,
      clip.clientWidth,
    );
  }
  return {
    drawn,
    seen,
    cutBy,
    outline: style.outlineStyle,
    width: Number.parseFloat(style.outlineWidth),
    reach,
  };
}

/**
 * How much of `element` the reader can see, and what cuts it, read in the page:
 * of its box, or with `ring` of the box its focus ring is drawn in.
 */
export async function seenOf(element: Locator, { ring = false } = {}): Promise<Sight> {
  return await element.evaluate(sightOf, { withRing: ring, tolerance: HALF_A_PIXEL });
}

/** A side of a box. */
type Side = 'top' | 'right' | 'bottom' | 'left';

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * How far a channel of a pixel read in a ring's band may lie from the ring's
 * colour, out of 255, and the pixel still be read as the ring.
 *
 * Each side is read along the middle of its band, which the engine covers
 * whole at every scale the suite runs at: the band is three CSS pixels wide,
 * and it is drawn in whole device pixels. What this allows for is the colour's
 * conversion into the screenshot, and at a ratio of 1.25 a band's edge rounded
 * onto the device pixel read. Another colour painted over the band lies
 * further off.
 */
const RING_TOLERANCE = 32;

/** Where a ring is drawn, in CSS pixels from the window's top left corner. */
interface RingBox {
  readonly drawn: string;
  readonly band: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A part of the window a screenshot is taken of, in whole CSS pixels. */
interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A pixel, in its red, green and blue, and its opacity, from 0 to 255. */
type Pixel = readonly number[];

/**
 * The colour of the ring of `node` as the engine computes it, and the pixels of
 * `png`, a screenshot of `clip`, along the middle of each side of the ring's
 * band in `ring`, its corners left out. Run in the page, which decodes the
 * screenshot as it decodes any image, so the suite needs no decoder of its own.
 */
async function readRingPaint(
  node: Element,
  { png, ring, clip }: { readonly png: string; readonly ring: RingBox; readonly clip: Clip },
): Promise<{ readonly colour: Pixel; readonly sides: Readonly<Record<Side, readonly Pixel[]>> }> {
  const canvas = document.createElement('canvas');
  const drawing = canvas.getContext('2d', { willReadFrequently: true });
  if (drawing === null) throw new Error('The page draws on no canvas.');
  canvas.width = 1;
  canvas.height = 1;
  drawing.fillStyle = getComputedStyle(node).outlineColor;
  drawing.fillRect(0, 0, 1, 1);
  const colour = Array.from(drawing.getImageData(0, 0, 1, 1).data);

  const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  canvas.width = image.width;
  canvas.height = image.height;
  drawing.drawImage(image, 0, 0);
  const pixels = drawing.getImageData(0, 0, image.width, image.height).data;
  const across = image.width / clip.width;
  const down = image.height / clip.height;
  const pixelAt = (x: number, y: number): Pixel => {
    const at = (y * image.width + x) * 4;
    return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, pixels[at + 3] ?? 0];
  };
  const along = (from: number, to: number, scale: number): number[] => {
    const first = Math.ceil(from * scale);
    const count = Math.max(0, Math.floor(to * scale) - first);
    return Array.from({ length: count }, (_, step) => first + step);
  };

  const left = ring.left - clip.x;
  const top = ring.top - clip.y;
  const right = left + ring.width;
  const bottom = top + ring.height;
  const middle = ring.band / 2;
  const columns = along(left + ring.band, right - ring.band, across);
  const rows = along(top + ring.band, bottom - ring.band, down);
  return {
    colour,
    sides: {
      top: columns.map((x) => pixelAt(x, Math.floor((top + middle) * down))),
      right: rows.map((y) => pixelAt(Math.floor((right - middle) * across), y)),
      bottom: columns.map((x) => pixelAt(x, Math.floor((bottom - middle) * down))),
      left: rows.map((y) => pixelAt(Math.floor((left + middle) * across), y)),
    },
  };
}

/**
 * The sides of the focus ring of `element` not painted in the ring's colour
 * where the reader sees them, each named with what is painted there: none where
 * the whole ring is.
 *
 * Read from what the engine paints, a screenshot of the ring's box at the
 * project's scale and in forced colours where the page is in them, each side
 * along the middle of its band against the ring's colour as the engine computes
 * it. {@link seenOf} reads what clips a ring, and this what is painted over it:
 * a descendant positioned over the band, or a scrollbar, is drawn above an
 * outline, and neither the ring's geometry nor `elementFromPoint` can see that,
 * since an outline takes no part in hit testing. The screenshot is taken with
 * every transition finished, so a colour easing in is not read part of the way,
 * and the ring's colour is read after it, once it has finished too.
 */
export async function unpaintedSides(element: Locator): Promise<readonly string[]> {
  const ring = await element.evaluate((node): RingBox => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const band = Number.parseFloat(style.outlineWidth);
    const reach = band + Number.parseFloat(style.outlineOffset);
    return {
      drawn: style.outlineStyle,
      band,
      left: box.left - reach,
      top: box.top - reach,
      width: box.width + 2 * reach,
      height: box.height + 2 * reach,
    };
  });
  expect(ring.drawn, 'no ring is drawn to read').toBe('solid');

  const clip: Clip = {
    x: Math.floor(ring.left),
    y: Math.floor(ring.top),
    width: Math.ceil(ring.left + ring.width) - Math.floor(ring.left),
    height: Math.ceil(ring.top + ring.height) - Math.floor(ring.top),
  };
  const shot = await element.page().screenshot({ clip, animations: 'disabled' });
  const { colour, sides } = await element.evaluate(readRingPaint, {
    png: shot.toString('base64'),
    ring,
    clip,
  });

  const [red = 0, green = 0, blue = 0, opacity = 0] = colour;
  expect(opacity, 'the ring is translucent, so what it paints is not its colour alone').toBe(255);
  const named = ([r = 0, g = 0, b = 0]: Pixel): string =>
    `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
  return SIDES.flatMap((side) => {
    const read = sides[side];
    if (read.length === 0) return [`${side}: no pixel of its band is read`];
    const unlike = read.filter(
      ([r = 0, g = 0, b = 0]) =>
        Math.max(Math.abs(r - red), Math.abs(g - green), Math.abs(b - blue)) > RING_TOLERANCE,
    );
    const [first] = unlike;
    return first === undefined
      ? []
      : [
          `${side}: ${String(unlike.length)} of ${String(read.length)} pixels are not the ring's ${named(colour)}, among them ${named(first)}`,
        ];
  });
}

/**
 * The room inside the padding of a dialogue's part that scrolls, beside the
 * room the tallest control in it needs with its focus ring drawn around it. Run
 * in the page, on the part that scrolls.
 *
 * Every control, whatever its lines. The stylesheet keeps room for a control of
 * one line, and a control that wraps is one that room does not hold, which is a
 * failure this reports rather than one it steps round.
 *
 * Every control but one hidden from assistive technology, which is left out:
 * the shell hides a control that way only where no reader is to use it, so no
 * ring is drawn on it for the room to hold.
 *
 * The ring's reach is read as the design system writes it, drawn as a length,
 * so the measure does not take it from the padding it is checking.
 */
export function roomForAControl(part: Element): { readonly room: number; readonly needed: number } {
  const style = getComputedStyle(part);
  const room =
    part.clientHeight -
    Number.parseFloat(style.paddingTop) -
    Number.parseFloat(style.paddingBottom);

  const probe = document.createElement('div');
  probe.style.blockSize = 'var(--ag-focus-ring-reach)';
  part.append(probe);
  const reach = probe.getBoundingClientRect().height;
  probe.remove();

  const heights = Array.from(
    part.querySelectorAll('button, input, select, [role="combobox"]'),
    (control) =>
      control.closest('[aria-hidden="true"]') === null ? control.getBoundingClientRect().height : 0,
  );
  return { room, needed: Math.max(0, ...heights) + 2 * reach };
}

/**
 * Presses Tab until `control` holds focus, as a keyboard reader reaches it, so
 * its ring is drawn as they see it.
 *
 * One press at least. A control a dialogue opens on is then reached with Tab as
 * well, round the dialogue's focus trap, and never counted as reached with no
 * press made.
 */
export async function tabTo(page: Page, control: Locator): Promise<void> {
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab');
    if (await control.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(control, 'Tab does not reach the control').toBeFocused();
}

/**
 * Lengthens the refusal in `dialog` until it is taller than the dialogue shows
 * at once, as no refusal this shell raises is, and scrolls the dialogue back to
 * its top. The dialogue then scrolls as a whole, and the end of the refusal is
 * out of sight until the reader scrolls to it. Gives the refusal.
 */
export async function lengthenRefusal(dialog: Locator): Promise<Locator> {
  const notice = dialog.locator('.ag-dialog-notice');
  await notice.evaluate((element) => {
    const dialogue = element.closest('[role="dialog"]');
    if (dialogue === null) throw new Error('The refusal is not in a dialogue.');
    const once = element.textContent;
    for (let times = 0; times < 400; times += 1) {
      if (element.getBoundingClientRect().height > dialogue.clientHeight) break;
      element.textContent = `${element.textContent} ${once}`;
    }
    dialogue.scrollTop = 0;
  });
  expect(
    await dialog.evaluate((element) => element.scrollHeight > element.clientHeight),
    'the refusal does not fill the dialogue',
  ).toBe(true);
  return notice;
}

/**
 * What the page recorded of the scrolls of whatever holds an element, and of
 * the presses of some keys, in the order it received them.
 */
export interface ScrollOrder {
  /** How many of those scrolls have ended. */
  readonly ended: number;

  /** Whether one of them has moved and not yet ended. */
  readonly scrolling: boolean;

  /**
   * Each press of the keys, in the order made, named as Playwright names a
   * press, with the modifiers held: a press of `Control+ArrowUp`, as the
   * brightness shortcut is, is not a press of `ArrowUp`.
   */
  readonly pressed: readonly string[];

  /** Each of those presses the page received while a scroll had not ended. */
  readonly early: readonly string[];
}

/**
 * Has every page this test opens record, from before it loads, the order in
 * which its scrolls moved and ended and its keys were pressed, which
 * {@link scrollUntilInSight} waits on and {@link scrollOrderOf} reads. Called
 * before the page is opened.
 *
 * From before it loads, so a scroll the page makes of its own is recorded
 * however soon it comes after the test acts, and its end with it: a refusal
 * scrolls the dialogue to the control that raised it. Captured on the window,
 * which every scroll, every end of one and every key press reaches before any
 * listener of the page's own.
 */
export async function recordScrollOrder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const order: { kind: string; target: EventTarget | null; key: string }[] = [];
    Object.defineProperty(window, 'agScrollOrder', { value: order, configurable: true });
    for (const kind of ['scroll', 'scrollend', 'keydown']) {
      window.addEventListener(
        kind,
        (event) => {
          const held =
            event instanceof KeyboardEvent
              ? [
                  ...(event.ctrlKey ? ['Control'] : []),
                  ...(event.altKey ? ['Alt'] : []),
                  ...(event.shiftKey ? ['Shift'] : []),
                  ...(event.metaKey ? ['Meta'] : []),
                  event.key,
                ]
              : [];
          order.push({ kind, target: event.target, key: held.join('+') });
        },
        true,
      );
    }
  });
}

/**
 * What the page recorded, since it loaded, of the scrolls of whatever holds
 * `element` and of the presses of `keys`. Run in the page.
 *
 * A scroll is open from the first time it moves to the end the engine says of
 * it, so a press is early where anything holding the element moved and had not
 * ended when the press arrived.
 */
function readScrollOrder(element: Element, keys: readonly string[]): ScrollOrder {
  const recorded: unknown = Reflect.get(window, 'agScrollOrder');
  if (!Array.isArray(recorded)) {
    throw new Error('The page records no scroll order: it was opened before recordScrollOrder.');
  }
  const entries: readonly unknown[] = recorded;
  const open = new Set<Node>();
  const pressed: string[] = [];
  const early: string[] = [];
  let ended = 0;
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('kind' in entry) ||
      !('target' in entry) ||
      !('key' in entry) ||
      typeof entry.key !== 'string'
    ) {
      continue;
    }
    if (entry.kind === 'keydown') {
      if (!keys.includes(entry.key)) continue;
      pressed.push(entry.key);
      if (open.size > 0) early.push(`${entry.key}, press ${String(pressed.length)}`);
    } else if (entry.target instanceof Node && entry.target.contains(element)) {
      if (entry.kind === 'scroll') {
        open.add(entry.target);
      } else {
        open.delete(entry.target);
        ended += 1;
      }
    }
  }
  return { ended, scrolling: open.size > 0, pressed, early };
}

/**
 * What the page recorded of the scrolls of whatever holds `element` and of the
 * presses of `keys`, from a page opened after {@link recordScrollOrder}.
 */
export async function scrollOrderOf(
  element: Locator,
  keys: readonly string[],
): Promise<ScrollOrder> {
  return await element.evaluate(readScrollOrder, keys);
}

/**
 * Whether `element` stayed where it was over two frames. Run in the page.
 *
 * An engine says a scroll moved in the frame after it moved, so once an element
 * has held still over two, every scroll that moved it has been said, and a
 * record of the page's scrolls holds each of them.
 */
async function heldOverTwoFrames(element: Element): Promise<boolean> {
  const before = element.getBoundingClientRect().top;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
  return element.getBoundingClientRect().top === before;
}

/**
 * How the next turn of a gesture knows that the scroll before it is over.
 *
 * `ends`: the engine ends the scroll and says so with `scrollend`, as every
 * engine here does for the scroll it animates for a key. Chromium draws the
 * last frame of that scroll some tens of milliseconds before it ends it, and a
 * key pressed between the two scrolls nothing: the key reaches the page,
 * nothing cancels it, and the scroll it asks for is lost. That is the engine's
 * behaviour, and a keyboard reader who presses in that gap meets it as well:
 * nothing in the page can keep the press. The refusal read alike twice is not
 * that end: read a few milliseconds apart, the two readings can both fall
 * between that frame and the end, and a key pressed on them is lost in most
 * runs there. The ends are read from the order the page records, so the page
 * is opened after {@link recordScrollOrder}.
 *
 * `stops`: the refusal stops moving, read alike a tenth of a second apart.
 * Firefox and WebKit say no end of the scroll a test's wheel makes, nor
 * Chromium of the one a finger driven through its protocol makes.
 */
export type Settling = 'ends' | 'stops';

/**
 * Scrolls a dialogue a turn at a time, each turn made by `turn`, until the
 * `edge` of the refusal `notice` is in sight, and fails naming `gesture` where
 * it never is.
 *
 * That edge is asserted out of sight first, so a refusal already in sight does
 * not pass with no turn made. Each turn has to move the refusal the way it
 * scrolls, so a gesture the dialogue does not answer fails at once rather than
 * after every turn, and each turn waits until the scroll before it `settles`.
 *
 * The first turn waits as well, because the dialogue can be scrolling before
 * any turn is made: a refusal scrolls it to the control that raised it, and
 * {@link lengthenRefusal} scrolls it back to its top. A key pressed before that
 * scroll ends meets the gap {@link Settling} describes. So where scrolls end,
 * the first turn waits until the refusal has held still over two frames and
 * every scroll of the dialogue the page recorded has ended: the two frames, so
 * a scroll that moved is in the record before the record is read.
 */
export async function scrollUntilInSight(
  notice: Locator,
  edge: 'start' | 'end',
  gesture: string,
  settles: Settling,
  turn: () => Promise<void>,
): Promise<void> {
  const edgeOf = async (): Promise<number> =>
    await notice.evaluate(
      (element, which) => element.getBoundingClientRect()[which === 'end' ? 'bottom' : 'top'],
      edge,
    );
  const inSight = async (): Promise<boolean> => {
    const { seen } = await seenOf(notice);
    const at = await edgeOf();
    return edge === 'end' ? seen.bottom >= at - HALF_A_PIXEL : seen.top <= at + HALF_A_PIXEL;
  };

  expect(await inSight(), `the ${edge} of the refusal is in sight before the ${gesture}`).toBe(
    false,
  );

  const order = async (): Promise<ScrollOrder> => await scrollOrderOf(notice, []);

  // Where the engine ends each scroll: after a turn, until a scroll has ended
  // since and none is still moving, and before the first, until nothing moves.
  const ends = async (since: ScrollOrder | undefined): Promise<void> => {
    await expect
      .poll(
        async () => {
          if (since === undefined) {
            return (await notice.evaluate(heldOverTwoFrames)) && !(await order()).scrolling;
          }
          const now = await order();
          return now.ended > since.ended && !now.scrolling;
        },
        {
          message:
            since === undefined
              ? `the scroll before the first ${gesture} does not end`
              : `the scroll the ${gesture} began does not end`,
        },
      )
      .toBe(true);
  };

  // Nothing read before the first poll, so the first reading is compared with
  // the next, a tenth of a second on, and not with one taken a few milliseconds
  // before it, within a frame of the scroll.
  const rests = async (): Promise<void> => {
    let last = Number.NaN;
    await expect
      .poll(
        async () => {
          const now = await edgeOf();
          const still = now === last;
          last = now;
          return still;
        },
        {
          message: `the dialogue does not come to rest before the next ${gesture}`,
          intervals: [100],
        },
      )
      .toBe(true);
  };

  const settled: (since: ScrollOrder | undefined) => Promise<void> =
    settles === 'ends' ? ends : rests;

  await settled(undefined);
  for (let made = 0; made < 40 && !(await inSight()); made += 1) {
    const before = await edgeOf();
    const since = settles === 'ends' ? await order() : undefined;
    await turn();
    const moved = expect.poll(edgeOf, {
      message: `the ${gesture} does not scroll the dialogue`,
      timeout: 2_000,
    });
    await (edge === 'end' ? moved.toBeLessThan(before) : moved.toBeGreaterThan(before));
    await settled(since);
  }
  expect(await inSight(), `the ${gesture} cannot scroll to the ${edge} of the refusal`).toBe(true);
}

/**
 * The font size every text field of the shell is drawn at, beside the size the
 * density in force gives it, opened as a reader opens each: the palette's
 * field, which is written in the large text, and the fields of the export
 * dialogue and the settings, in the body's. None is left open.
 */
export async function fieldTextSizes(
  page: Page,
): Promise<
  readonly { readonly field: string; readonly drawn: number; readonly density: number }[]
> {
  const sizes = async (fields: Locator, token: string) =>
    await fields.evaluateAll(
      (found, property) =>
        found.map((field) => ({
          field:
            field.getAttribute('aria-label') ??
            (field instanceof HTMLInputElement ? (field.labels?.[0]?.textContent ?? '') : ''),
          drawn: Number.parseFloat(getComputedStyle(field).fontSize),
          density: Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(property),
          ),
        })),
      token,
    );

  await openPalette(page);
  const palette = await sizes(
    page.getByRole('dialog', { name: 'Run a command' }).getByRole('combobox'),
    '--ag-text-large',
  );
  await page.keyboard.press('Escape');

  await menuBarMenu(page, 'Help').click();
  await page.getByRole('menuitem', { name: 'Export a diagnostic report' }).click();
  const exporting = await sizes(
    page.getByRole('dialog', { name: 'Export a diagnostic report' }).getByRole('textbox'),
    '--ag-text-body',
  );
  await page.keyboard.press('Escape');

  await openSettings(page);
  await page.getByRole('tab', { name: 'Workspaces' }).click();
  const settings = await sizes(
    page.getByRole('dialog', { name: 'Settings' }).getByRole('textbox'),
    '--ag-text-body',
  );
  await page.keyboard.press('Escape');

  expect(palette, 'the palette has no field').toHaveLength(1);
  expect(exporting.length, 'the export dialogue has no field').toBeGreaterThan(0);
  expect(settings.length, 'the settings have no field').toBeGreaterThan(0);
  return [...palette, ...exporting, ...settings];
}
