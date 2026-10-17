import { expect, type Page } from '@playwright/test';

import { buildPresets, PanelKinds } from '../../../packages/workspace/src/presets.js';
import { listedName } from '../../../packages/workspace/src/workspace-name.js';
import { engineMotion, floatingPanels, groupWithTab, landingAreas, splitters } from '../dock.js';
import { openPalette, openSettings } from '../platform.js';
import { menuBarMenu } from '../shell.js';
import { test } from '../test.js';
import {
  firstFrameOf,
  LEVELS,
  longerThanOff,
  named,
  openAt,
  recordMotion,
  riseOf,
  scaleOf,
  slowAnimations,
  viewTransitionMotion,
  type Level,
} from './motion.js';

/**
 * The motion system, read from the browser at each motion level (REQ-UX-222;
 * the design language's MotionSpec).
 *
 * Each kind of motion the shell runs is read as the browser runs it, from
 * `getAnimations()` and the computed style: that it runs at the full level
 * with the movement the language gives it, that at the reduced level it is a
 * fade of the reduced duration with no movement and no loop, and that at the
 * Off level (stored as `minimal`) nothing runs longer than the guard's
 * millisecond. Also that the system's request for reduced motion selects
 * Reduced until the user chooses, and that the docking engine follows the
 * level rather than the system.
 *
 * Every animation runs ten times slower on the page's clock here, through the
 * browser's own animation domain, so a quick one can be read before it ends;
 * the durations each is given, which are what is asserted, are unchanged.
 */

/** How many times slower the page's animations run, so each can be read. */
const SLOW = 10;

/** The name the Workspace menu gives a built-in workspace. */
function presetEntry(displayName: string): string {
  const preset = buildPresets(new Set(Object.values(PanelKinds))).find(
    (one) => one.displayName === displayName,
  );
  if (preset === undefined) throw new Error(`No preset is called ${displayName}.`);
  return listedName(preset);
}

/** Runs a command from the Workspace menu, by the start of its entry's name. */
async function fromWorkspaceMenu(page: Page, entry: RegExp | string): Promise<void> {
  await menuBarMenu(page, 'Workspace').click();
  await page
    .getByRole(
      'menuitem',
      typeof entry === 'string' ? { name: entry, exact: true } : { name: entry },
    )
    .click();
}

/** Floats the Inspector, from the Workspace menu. */
async function floatInspector(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await fromWorkspaceMenu(page, /^Float this panel/);
}

/**
 * Drags the Inspector's tab over the right of the Editor's group and holds it
 * there, as a person aiming at a drop target does.
 */
async function holdInspectorOverEditor(page: Page): Promise<void> {
  const tab = await page.getByRole('tab', { name: 'Inspector', exact: true }).boundingBox();
  const target = await groupWithTab(page, 'Editor').boundingBox();
  if (tab === null || target === null) throw new Error('The tab or the group is not on screen.');
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x + tab.width / 2 + 12, tab.y + tab.height / 2 + 12, { steps: 2 });
  await page.mouse.move(target.x + target.width * 0.85, target.y + target.height / 2, {
    steps: 10,
  });
}

/** The value a motion token resolves to on the document. */
async function token(page: Page, name: string): Promise<string> {
  return await page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

/** Every duration a computed transition lists, in seconds. */
function durations(listed: string): readonly number[] {
  return listed.split(',').map((one) => Number.parseFloat(one));
}

test.describe('the motion level', () => {
  test('is Reduced while the system asks for less motion, until the user chooses one', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, undefined);
    await expect(page.locator('html')).toHaveAttribute('data-ag-motion', 'reduced');
    expect(await token(page, '--ag-motion-moderate')).toBe('120ms');

    // A user who chooses Full while the system asks for less gets Full, and
    // keeps it.
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Accessibility', exact: true }).click();
    await settings
      .getByRole('radiogroup', { name: 'Animation' })
      .getByRole('radio', { name: /^Full/ })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-ag-motion', 'full');
    expect(await token(page, '--ag-motion-moderate')).toBe('240ms');

    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-ag-motion', 'full');
  });

  test('is Full when neither the system nor the user asks for less', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openAt(page, undefined);
    await expect(page.locator('html')).toHaveAttribute('data-ag-motion', 'full');
  });

  test('gives the docking engine its tab movement back for a user who chose Full, whatever the system asks', async ({
    page,
  }) => {
    // The engine switches its tabs' movement off under the system's request,
    // whatever the user chose; the adapter's stylesheet takes that over.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAt(page, LEVELS.full);
    const { tabShift } = await engineMotion(page);
    expect(tabShift.property).toContain('transform');
    expect(Number.parseFloat(tabShift.duration)).toBe(0.16);
  });
});

/** The checks of one level, each kind of motion in turn. */
function checksAt(level: Level): void {
  const full = level.name === 'full';
  const off = level.name === 'off';

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openAt(page, level);
    await slowAnimations(page, SLOW);
  });

  test('writes the level onto the document, and the durations it gives every motion', async ({
    page,
  }) => {
    await expect(page.locator('html')).toHaveAttribute('data-ag-motion', level.stored);
    expect(
      await Promise.all(
        ['instant', 'quick', 'moderate', 'deliberate'].map(
          async (name) => await token(page, `--ag-motion-${name}`),
        ),
      ),
    ).toEqual(
      [level.instant, level.quick, level.moderate, level.deliberate].map(
        (milliseconds) => `${String(milliseconds)}ms`,
      ),
    );
  });

  test('eases hover feedback over the instant duration', async ({ page }) => {
    const trigger = menuBarMenu(page, 'File');
    const listed = await trigger.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    for (const seconds of durations(listed)) {
      expect(seconds * 1000).toBeCloseTo(off ? 1 : level.instant, 3);
    }
  });

  test('grows a menu from its trigger, or only fades it, or opens it at once', async ({ page }) => {
    if (off) {
      const seen = await recordMotion(page, async () => {
        await menuBarMenu(page, 'File').click();
      });
      await expect(page.getByRole('menu')).toBeVisible();
      expect(longerThanOff(seen)).toEqual([]);
      return;
    }
    await menuBarMenu(page, 'File').click();
    const frame = await firstFrameOf(page.getByRole('menu'), 'ag-overlay-enter');
    expect(frame.duration).toBe(level.quick);
    expect(Number(frame.opacity)).toBe(0);
    expect(scaleOf(frame.transform)).toBeCloseTo(full ? 0.96 : 1, 3);
    expect(Math.abs(riseOf(frame.transform))).toBeCloseTo(full ? 4 : 0, 3);
  });

  test('raises a tooltip with a fade, rising only at the full level', async ({ page }) => {
    const commands = page.getByRole('button', { name: 'Commands', exact: true });
    if (off) {
      const seen = await recordMotion(page, async () => {
        await commands.hover();
        await expect(page.getByRole('tooltip')).toBeVisible();
      });
      expect(longerThanOff(seen)).toEqual([]);
      return;
    }
    await commands.hover();
    const frame = await firstFrameOf(page.getByRole('tooltip'), 'ag-overlay-enter');
    expect(frame.duration).toBe(level.instant);
    expect(Number(frame.opacity)).toBe(0);
    expect(scaleOf(frame.transform)).toBeCloseTo(1, 3);
    expect(Math.abs(riseOf(frame.transform))).toBeCloseTo(full ? 4 : 0, 3);
  });

  test('brings a dialogue in over its scrim, rising only at the full level', async ({ page }) => {
    if (off) {
      const seen = await recordMotion(page, async () => {
        await openSettings(page);
      });
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
      expect(longerThanOff(seen)).toEqual([]);
      return;
    }
    await openSettings(page);
    const frame = await firstFrameOf(
      page.getByRole('dialog', { name: 'Settings' }),
      'ag-dialogue-enter',
    );
    expect(frame.duration).toBe(level.moderate);
    expect(Number(frame.opacity)).toBe(0);
    expect(scaleOf(frame.transform)).toBeCloseTo(full ? 0.98 : 1, 3);
    expect(riseOf(frame.transform)).toBeCloseTo(full ? 8 : 0, 3);
    const scrim = await firstFrameOf(page.locator('.ag-dialog-overlay'), 'ag-scrim-enter');
    expect(scrim.duration).toBe(level.moderate);
    expect(Number(scrim.opacity)).toBe(0);
  });

  test('brings the command palette in as a dialogue', async ({ page }) => {
    if (off) {
      const seen = await recordMotion(page, async () => {
        await openPalette(page);
      });
      await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
      expect(longerThanOff(seen)).toEqual([]);
      return;
    }
    await openPalette(page);
    const frame = await firstFrameOf(
      page.getByRole('dialog', { name: 'Run a command' }),
      'ag-dialogue-enter',
    );
    expect(frame.duration).toBe(level.moderate);
    expect(scaleOf(frame.transform)).toBeCloseTo(full ? 0.98 : 1, 3);
  });

  test('floats a panel through a view transition, morphing its group only at the full level', async ({
    page,
  }) => {
    const seen = viewTransitionMotion(
      await recordMotion(page, async () => {
        await floatInspector(page);
      }),
    );

    if (off) {
      // Built at once: no view transition is started at all.
      expect(seen).toEqual([]);
      await expect(floatingPanels(page)).toHaveCount(1);
      return;
    }

    const groups = seen.filter((motion) => motion.pseudo.startsWith('::view-transition-group('));
    const morphs = groups.filter((motion) => motion.pseudo.includes('ag-dock-group-'));
    for (const group of groups) expect(group.duration).toBe(level.moderate);
    if (full) {
      expect(morphs.length).toBeGreaterThan(0);
      for (const morph of morphs) expect(morph.duration).toBe(level.moderate);
    } else {
      // A cross-fade of the whole dock, with no group morphing.
      expect(morphs).toEqual([]);
      expect(groups.map((motion) => motion.pseudo)).toEqual(['::view-transition-group(ag-dock)']);
    }
  });

  test("breathes a floating panel's halo at the full level alone", async ({ page }) => {
    await floatInspector(page);
    const floating = floatingPanels(page).first();
    await expect(floating).toBeVisible();
    const loops = await floating.evaluate((element) =>
      element
        .getAnimations()
        .filter((animation) => animation instanceof CSSAnimation)
        .map((animation) => ({
          name: animation instanceof CSSAnimation ? animation.animationName : '',
          duration: Number(animation.effect?.getTiming().duration ?? 0),
          iterations: animation.effect?.getTiming().iterations ?? 1,
        })),
    );
    expect(loops).toEqual(
      full ? [{ name: 'ag-dock-float-halo', duration: 3200, iterations: Infinity }] : [],
    );
  });

  test('closes a panel by shrinking its group back and fading it at the full level', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
    const seen = viewTransitionMotion(
      await recordMotion(page, async () => {
        await fromWorkspaceMenu(page, /^Close this panel/);
      }),
    );
    const closing = named(seen, 'ag-dock-group-close');
    if (full) {
      expect(closing.length).toBe(1);
      expect(closing[0]?.duration).toBe(level.quick);
      expect(closing[0]?.pseudo).toMatch(/^::view-transition-old\(ag-dock-group-\d+\)$/);
    } else {
      expect(closing).toEqual([]);
    }
    if (off) expect(seen).toEqual([]);
  });

  test('switches workspace with the old one settling back and the new one coming forward', async ({
    page,
  }) => {
    const seen = viewTransitionMotion(
      await recordMotion(page, async () => {
        await fromWorkspaceMenu(page, presetEntry('Recording'));
      }),
    );
    if (off) {
      expect(seen).toEqual([]);
      return;
    }
    const leaving = seen.filter((motion) => motion.pseudo === '::view-transition-old(ag-dock)');
    const arriving = seen.filter((motion) => motion.pseudo === '::view-transition-new(ag-dock)');
    expect(leaving.map((motion) => motion.name)).toContain(
      full ? 'ag-dock-workspace-out' : '-ua-view-transition-fade-out',
    );
    expect(arriving.map((motion) => motion.name)).toContain(
      full ? 'ag-dock-workspace-in' : '-ua-view-transition-fade-in',
    );
    for (const motion of [...leaving, ...arriving]) {
      expect(motion.duration).toBe(level.deliberate);
    }
  });

  test('slides a notice in from the trailing edge and runs its time bar down', async ({ page }) => {
    // Floating a panel says so in a notice.
    if (off) {
      const seen = await recordMotion(page, async () => {
        await floatInspector(page);
      });
      const bar = named(seen, 'ag-notice-time');
      // The time bar keeps the notice's time, in steps of a second.
      expect(bar.length).toBe(1);
      expect(bar[0]?.easing).toMatch(/^steps\(/);
      expect(longerThanOff(seen.filter((motion) => motion.name !== 'ag-notice-time'))).toEqual([]);
      return;
    }
    await floatInspector(page);
    const notice = page.locator('.ag-notice');
    const frame = await firstFrameOf(notice, 'ag-notice-enter');
    expect(frame.duration).toBe(level.moderate);
    expect(Number(frame.opacity)).toBe(0);
    expect(frame.easing.startsWith('linear(')).toBe(full);
    expect(frame.translate === 'none' ? 0 : Math.abs(Number.parseFloat(frame.translate))).toBe(
      full ? 16 : 0,
    );
    const bar = await firstFrameOf(notice.locator('.ag-notice-time'), 'ag-notice-time');
    expect(bar.easing).toBe('linear');
  });

  test('springs the drop compass in and grows the landing area, which glows at the full level', async ({
    page,
  }) => {
    await holdInspectorOverEditor(page);
    const landing = landingAreas(page).first();
    await expect(landing).toBeVisible();
    const compass = groupWithTab(page, 'Editor').locator('.ag-dock-compass');
    await expect(compass).toBeVisible();

    const compassTransitions = await compass.evaluate((element) =>
      element
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => {
          const effect = animation.effect;
          const first = effect instanceof KeyframeEffect ? effect.getKeyframes()[0] : undefined;
          return {
            property: animation instanceof CSSTransition ? animation.transitionProperty : '',
            duration: Number(effect?.getTiming().duration ?? 0),
            // A transition's timing function is its effect's, not a keyframe's.
            easing: effect?.getTiming().easing ?? '',
            from: String(first?.['scale'] ?? first?.['opacity'] ?? ''),
          };
        }),
    );
    const landingMotion = await landing.evaluate((element) =>
      element.getAnimations().map((animation) => ({
        kind: animation.constructor.name,
        name:
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? animation.transitionProperty
              : '',
        duration: Number(animation.effect?.getTiming().duration ?? 0),
        iterations: animation.effect?.getTiming().iterations ?? 1,
      })),
    );
    await page.mouse.up();

    const scale = compassTransitions.find((one) => one.property === 'scale');
    const opacity = compassTransitions.find((one) => one.property === 'opacity');
    const glow = landingMotion.find((one) => one.name === 'ag-dock-landing-glow');

    if (full) {
      expect(scale).toMatchObject({ duration: level.deliberate, from: '0.82' });
      expect(scale?.easing.startsWith('linear(')).toBe(true);
      expect(opacity?.duration).toBe(level.deliberate);
      expect(glow).toMatchObject({ duration: 2500, iterations: Infinity });
    } else if (off) {
      for (const one of [...compassTransitions, ...landingMotion]) {
        expect(one.duration).toBeLessThanOrEqual(1);
      }
    } else {
      // A fade alone: no spring, no growth, and a glow that holds still.
      expect(scale).toBeUndefined();
      expect(opacity).toMatchObject({ duration: level.deliberate, easing: 'linear' });
      expect(glow).toBeUndefined();
    }
  });

  test('pulses a splitter under the pointer at the full level alone', async ({ page }) => {
    const splitter = splitters(page).first();
    const box = await splitter.boundingBox();
    if (box === null) throw new Error('No splitter is on screen.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation instanceof CSSAnimation &&
                    animation.animationName === 'ag-dock-splitter-pulse',
                )
                .map((animation) => animation.effect?.getTiming().iterations ?? 1)[0],
          ),
      )
      .toBe(full ? Infinity : undefined);
  });

  test("sets the docking engine's own motion from the level", async ({ page }) => {
    const engine = await engineMotion(page);
    expect(engine.dropTarget).toBe(`${String(level.instant)}ms`);
    expect(engine.dropTargets).toBe(`${String(level.moderate)}ms`);
    expect(engine.sash).toEqual({ duration: `${String(level.instant)}ms`, delay: '0s' });
    // A shifting tab moves over the quick duration at the full level; at the
    // reduced level only its colours ease, and off, nothing runs.
    expect(engine.tabShift.property.includes('transform')).toBe(level.name !== 'reduced');
    expect(Number.parseFloat(engine.tabShift.duration) * 1000).toBeCloseTo(
      off ? 1 : level.quick,
      3,
    );
    if (full) expect(engine.tabShift.easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });
}

test.describe('at the full level', () => {
  checksAt(LEVELS.full);
});

test.describe('at the reduced level', () => {
  checksAt(LEVELS.reduced);
});

test.describe('at the off level', () => {
  checksAt(LEVELS.off);
});
