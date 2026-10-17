import { expect, type Locator, type Page } from '@playwright/test';

/**
 * What the motion suite reads from the browser: the animations and transitions
 * the page runs, and how each starts.
 *
 * Every reading is the browser's own: `getAnimations()` for what runs, and the
 * computed style for how it is timed and where it starts. Nothing here reads a
 * stylesheet, so a rule that never matched, or one another rule overrode, is
 * caught as surely as one that was never written.
 */

/** A motion level as the design language names it, and as it is stored. */
export interface Level {
  readonly name: 'full' | 'reduced' | 'off';

  /** The preference's stored value; Off is stored as `minimal`. */
  readonly stored: 'full' | 'reduced' | 'minimal';

  /** The motion tokens at this level, in milliseconds. */
  readonly instant: number;
  readonly quick: number;
  readonly moderate: number;
  readonly deliberate: number;
}

/** The three levels, at the durations MotionSpec states for each. */
export const LEVELS = {
  full: { name: 'full', stored: 'full', instant: 90, quick: 160, moderate: 240, deliberate: 360 },
  reduced: {
    name: 'reduced',
    stored: 'reduced',
    instant: 60,
    quick: 90,
    moderate: 120,
    deliberate: 150,
  },
  off: { name: 'off', stored: 'minimal', instant: 0, quick: 0, moderate: 0, deliberate: 0 },
} as const satisfies Readonly<Record<Level['name'], Level>>;

/**
 * The longest any animation runs at the Off level: the guard in the design
 * system's `tokens.css` holds every animation and transition to a millisecond.
 */
const OFF_LONGEST = 1;

/**
 * Opens AudioGubbins at a motion level chosen in its preferences, or at none
 * chosen, so the system's request decides.
 */
export async function openAt(page: Page, level: Level | undefined): Promise<void> {
  await page.addInitScript(
    ({ stored }) => {
      // Seeded once, before the application reads it: a reload keeps whatever
      // the test chose since.
      if (sessionStorage.getItem('motion-seeded') !== null) return;
      sessionStorage.setItem('motion-seeded', 'yes');
      if (stored === null) return;
      localStorage.setItem(
        'audiogubbins.preferences',
        JSON.stringify({ schemaVersion: 3, motion: stored }),
      );
    },
    { stored: level?.stored ?? null },
  );
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

/**
 * Slows every animation in the page by the factor given, through the browser's
 * own animation domain, so a test can read one before it ends. The durations
 * each animation is given are unchanged; only the document's clock runs slow.
 */
export async function slowAnimations(page: Page, factor: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Animation.enable');
  await session.send('Animation.setPlaybackRate', { playbackRate: 1 / factor });
}

/** One animation or transition the page ran, as the browser reports it. */
export interface SeenMotion {
  /** `CSSAnimation`, `CSSTransition` or `Animation` (a script's). */
  readonly kind: string;

  /** The animation's name, or the property a transition moves. */
  readonly name: string;

  /** The element's classes, or the document's for a view transition. */
  readonly target: string;

  /** The pseudo-element it runs on, such as `::view-transition-group(ag-dock)`. */
  readonly pseudo: string;

  /** Its duration in milliseconds. */
  readonly duration: number;

  /** How many times it runs; `Infinity` for a loop. */
  readonly iterations: number;

  /** Its timing function. */
  readonly easing: string;
}

/**
 * Records every animation and transition the page runs, from now until `span`
 * milliseconds have passed, while `act` drives the page, each read on every
 * frame, so one that starts and ends between two readings by a test is still
 * seen. The span is the page's wall clock, so it outlasts animations slowed by
 * {@link slowAnimations} only if it is given room for them.
 */
export async function recordMotion(
  page: Page,
  act: () => Promise<void>,
  span = 2500,
): Promise<readonly SeenMotion[]> {
  const recording = page.evaluate(async (lasting): Promise<SeenMotion[]> => {
    const seen = new Map<Animation, SeenMotion>();
    const describe = (animation: Animation): SeenMotion => {
      const effect = animation.effect;
      const keyframes = effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
      const target = effect instanceof KeyframeEffect ? effect.target : null;
      return {
        kind: animation.constructor.name,
        name:
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? animation.transitionProperty
              : animation.id,
        target: target instanceof Element ? (target.getAttribute('class') ?? '') : '',
        pseudo: effect instanceof KeyframeEffect ? (effect.pseudoElement ?? '') : '',
        duration: Number(effect?.getTiming().duration ?? 0),
        iterations: effect?.getTiming().iterations ?? 1,
        // A CSS animation's timing function is on its keyframes; a
        // transition's, and a script's, on its effect.
        easing:
          animation instanceof CSSAnimation
            ? (keyframes[0]?.easing ?? '')
            : (effect?.getTiming().easing ?? ''),
      };
    };
    const ends = performance.now() + lasting;
    while (performance.now() < ends) {
      for (const animation of document.getAnimations()) {
        if (!seen.has(animation)) seen.set(animation, describe(animation));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return [...seen.values()];
  }, span);
  await act();
  return await recording;
}

/** The motions seen of one name. */
export function named(seen: readonly SeenMotion[], name: string): readonly SeenMotion[] {
  return seen.filter((motion) => motion.name === name);
}

/** Every motion seen that lasted longer than the Off level allows. */
export function longerThanOff(seen: readonly SeenMotion[]): readonly SeenMotion[] {
  return seen.filter((motion) => motion.duration > OFF_LONGEST);
}

/** Every motion seen on a view transition's pseudo-elements. */
export function viewTransitionMotion(seen: readonly SeenMotion[]): readonly SeenMotion[] {
  return seen.filter((motion) => motion.pseudo.startsWith('::view-transition'));
}

/** Where an element's running animation of a name starts: its first frame, read from the browser. */
export interface FirstFrame {
  readonly opacity: string;
  readonly transform: string;
  readonly translate: string;
  readonly scale: string;
  readonly duration: number;
  readonly easing: string;
}

/**
 * Holds an element's running animation of a name at its start and reads the
 * element's style there, then lets it run on. Waits for the animation, which
 * an overlay starts as it opens.
 */
export async function firstFrameOf(element: Locator, name: string): Promise<FirstFrame> {
  await expect
    .poll(
      async () =>
        await element.evaluate(
          (node, wanted) =>
            node
              .getAnimations()
              .some(
                (animation) =>
                  animation instanceof CSSAnimation && animation.animationName === wanted,
              ),
          name,
        ),
      { message: `no ${name} animation ran` },
    )
    .toBe(true);

  return await element.evaluate((node, wanted) => {
    const animation = node
      .getAnimations()
      .find((one) => one instanceof CSSAnimation && one.animationName === wanted);
    if (animation === undefined)
      throw new Error(`The ${wanted} animation ended before it was read.`);
    animation.pause();
    animation.currentTime = 0;
    const style = getComputedStyle(node);
    const effect = animation.effect;
    const frame = {
      opacity: style.opacity,
      transform: style.transform,
      translate: style.translate,
      scale: style.scale,
      duration: Number(effect?.getTiming().duration ?? 0),
      easing: effect instanceof KeyframeEffect ? (effect.getKeyframes()[0]?.easing ?? '') : '',
    };
    animation.play();
    return frame;
  }, name);
}

/** The scale a CSS transform matrix draws at, along its first axis. */
export function scaleOf(transform: string): number {
  if (transform === 'none') return 1;
  const values = /matrix\(([^)]+)\)/.exec(transform)?.[1]?.split(',').map(Number);
  return values?.[0] ?? Number.NaN;
}

/** How far a CSS transform matrix moves along the block axis, in pixels. */
export function riseOf(transform: string): number {
  if (transform === 'none') return 0;
  const values = /matrix\(([^)]+)\)/.exec(transform)?.[1]?.split(',').map(Number);
  return values?.[5] ?? Number.NaN;
}
